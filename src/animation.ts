import * as THREE from "three";
import type { XYZ } from "./primitives.ts";
import {
  checkedVector,
  degrees,
  resolveTarget,
  restTransform,
} from "./internal.ts";

export type AnimationKey<T> = readonly [seconds: number, value: T];
interface TrackBase {
  target: string | THREE.Object3D;
  interpolation?: "linear" | "step";
}
export type ClipTrack =
  & TrackBase
  & (
    | {
      property: "rotation" | "position" | "scale";
      keys: readonly AnimationKey<XYZ>[];
      /** Default true: degree rotations, translation offsets and scale multipliers relative to rest. */
      relative?: boolean;
    }
    | {
      property: "quaternion";
      keys: readonly AnimationKey<readonly [number, number, number, number]>[];
    }
    | {
      property: "morph";
      morph: string;
      keys: readonly AnimationKey<number>[];
    }
  );
export interface ClipOptions {
  /** Defaults to the last key time. Must be positive and include all keys. */
  duration?: number;
}

/** Build and register an ordinary AnimationClip on root.animations. Targets use UUIDs for composition. */
export function clip(
  root: THREE.Object3D,
  name: string,
  definitions: readonly ClipTrack[],
  options: ClipOptions = {},
): THREE.AnimationClip {
  if (!name.trim() || animationClips(root).some((c) => c.name === name)) {
    throw new Error(`Animation names must be nonempty and unique: ${name}`);
  }
  if (!definitions.length) {
    throw new Error("An animation needs at least one track.");
  }
  const paths = new Set<string>();
  let lastTime = 0;
  const tracks = definitions.map((definition): THREE.KeyframeTrack => {
    const object = resolveTarget(root, definition.target);
    const base = restTransform(object);
    let previousTime = -1;
    if (!definition.keys.length) {
      throw new Error("An animation track needs keys.");
    }
    const times = definition.keys.map(([time]) => {
      if (!Number.isFinite(time) || time < 0 || time <= previousTime) {
        throw new Error(
          "Key times must be finite, nonnegative and strictly increasing.",
        );
      }
      previousTime = time;
      lastTime = Math.max(lastTime, time);
      return time;
    });
    const interpolation = definition.interpolation ?? "linear";
    if (!["linear", "step"].includes(interpolation)) {
      throw new Error("Interpolation must be linear or step.");
    }
    const mode = interpolation === "step"
      ? THREE.InterpolateDiscrete
      : THREE.InterpolateLinear;
    let path: string;
    let track: THREE.KeyframeTrack;
    if (definition.property === "morph") {
      const mesh = object as THREE.Mesh;
      const index = mesh.morphTargetDictionary?.[definition.morph];
      if (
        index === undefined || !mesh.morphTargetInfluences ||
        index >= mesh.morphTargetInfluences.length
      ) throw new Error(`Unknown morph target: ${definition.morph}`);
      if (/[\[\]]/.test(definition.morph)) {
        throw new Error("Morph names in tracks cannot contain brackets.");
      }
      path = `${object.uuid}.morphTargetInfluences[${definition.morph}]`;
      const values = definition.keys.map(([, value]) => {
        if (!Number.isFinite(value)) {
          throw new Error("Morph weights must be finite.");
        }
        return value;
      });
      track = new THREE.NumberKeyframeTrack(path, times, values, mode);
    } else if (
      definition.property === "rotation" || definition.property === "quaternion"
    ) {
      path = `${object.uuid}.quaternion`;
      let previous: THREE.Quaternion | undefined;
      const values = definition.keys.flatMap(([, value]) => {
        let q: THREE.Quaternion;
        if (definition.property === "rotation") {
          q = degrees(value as XYZ);
          if (definition.relative !== false) q.premultiply(base.quaternion);
        } else {
          if (value.length !== 4 || !value.every(Number.isFinite)) {
            throw new Error("Quaternion keys need four finite components.");
          }
          q = new THREE.Quaternion().fromArray(value);
          if (q.lengthSq() < 1e-12) {
            throw new Error("Quaternion keys cannot be zero.");
          }
          q.normalize();
        }
        // Equivalent signs should not create a long arc when exported or interpolated.
        if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        previous = q;
        return q.toArray();
      });
      track = new THREE.QuaternionKeyframeTrack(path, times, values, mode);
    } else {
      path = `${object.uuid}.${definition.property}`;
      const values = definition.keys.flatMap(([, value]) => {
        const v = checkedVector(value, definition.property);
        if (
          definition.property === "scale" && [v.x, v.y, v.z].some((n) => n <= 0)
        ) throw new Error("Animated scales must be positive.");
        if (definition.relative !== false) {
          if (definition.property === "position") v.add(base.position);
          else v.multiply(base.scale);
        }
        return v.toArray();
      });
      track = new THREE.VectorKeyframeTrack(path, times, values, mode);
    }
    if (paths.has(path)) throw new Error(`Duplicate animation track: ${path}`);
    paths.add(path);
    if (!track.validate()) throw new Error(`Invalid animation track: ${path}`);
    return track;
  });
  const duration = options.duration ?? lastTime;
  if (!Number.isFinite(duration) || duration <= 0 || duration < lastTime) {
    throw new Error(
      "Clip duration must be positive, finite and include every key.",
    );
  }
  const result = new THREE.AnimationClip(name, duration, tracks);
  root.animations.push(result);
  return result;
}

/** Collect nested clips once; clip names must be unique across a composition. */
export function animationClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const clips = new Map<string, THREE.AnimationClip>();
  const names = new Set<string>();
  root.traverse((object) => {
    for (const clip of object.animations) {
      if (clips.has(clip.uuid)) continue;
      if (!clip.name || names.has(clip.name)) {
        throw new Error(
          `Animation names must be nonempty and unique: ${clip.name}`,
        );
      }
      if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
        throw new Error(
          `Animation ${clip.name} needs a positive, finite duration.`,
        );
      }
      clips.set(clip.uuid, clip);
      names.add(clip.name);
    }
  });
  return [...clips.values()];
}

export interface AnimationState {
  clips: { name: string; duration: number; tracks: number }[];
  clip: string | null;
  time: number;
  duration: number;
  playing: boolean;
  loop: boolean;
  speed: number;
}
export interface AnimationPlayOptions {
  loop?: boolean;
  speed?: number;
}
export interface AnimationSampleOptions {
  /** Default false: clamp at the last frame, including the exact endpoint. */
  loop?: boolean;
}

/** One controller per model. Sampling is absolute and independent of the order of previous seeks. */
export class AnimationPlayer {
  readonly clips: readonly THREE.AnimationClip[];
  readonly mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | undefined;
  private selected: THREE.AnimationClip | undefined;
  private seconds = 0;
  private running = false;
  private looping = true;
  private rate = 1;
  private disposed = false;

  constructor(readonly root: THREE.Object3D, clips = animationClips(root)) {
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) {
      for (const track of clip.tracks) {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        if (!THREE.PropertyBinding.findNode(root, parsed.nodeName)) {
          throw new Error(
            `Animation ${clip.name} has an unknown target: ${track.name}`,
          );
        }
      }
    }
  }

  get state(): AnimationState {
    return {
      clips: this.clips.map((c) => ({
        name: c.name,
        duration: c.duration,
        tracks: c.tracks.length,
      })),
      clip: this.selected?.name ?? null,
      time: this.seconds,
      duration: this.selected?.duration ?? 0,
      playing: this.running,
      loop: this.looping,
      speed: this.rate,
    };
  }

  private select(name?: string): THREE.AnimationClip {
    if (this.disposed) throw new Error("Animation player has been disposed.");
    const selected = name === undefined
      ? this.selected ?? this.clips[0]
      : this.clips.find((c) => c.name === name);
    if (!selected) {
      throw new Error(`Unknown animation: ${name ?? "(model has no clips)"}`);
    }
    if (this.selected !== selected) {
      this.mixer.stopAllAction();
      this.selected = selected;
      this.action = this.mixer.clipAction(selected);
      this.seconds = 0;
    }
    return selected;
  }

  /** Seek without advancing the clock. Always pauses playback. */
  seek(
    time: number,
    name?: string,
    options: AnimationSampleOptions = {},
  ): AnimationState {
    if (!Number.isFinite(time) || time < 0) {
      throw new Error("Animation time must be finite and nonnegative.");
    }
    const selected = this.select(name);
    this.running = false;
    this.seconds = options.loop
      ? time % selected.duration
      : Math.min(time, selected.duration);
    const action = this.action!;
    action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).play();
    action.clampWhenFinished = true;
    action.time = this.seconds;
    action.paused = true;
    this.mixer.update(0);
    this.root.updateWorldMatrix(true, true);
    this.root.traverse((object) => {
      const skin = object as THREE.SkinnedMesh;
      if (skin.isSkinnedMesh) {
        skin.skeleton.update();
        // Box3 and camera fitting must describe the current pose as well.
        skin.computeBoundingBox();
        skin.computeBoundingSphere();
      }
    });
    return this.state;
  }

  play(name?: string, options: AnimationPlayOptions = {}): AnimationState {
    const speed = options.speed ?? this.rate;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error("Playback speed must be positive and finite.");
    }
    const selected = this.select(name);
    this.looping = options.loop ?? this.looping;
    this.rate = speed;
    this.seek(this.seconds >= selected.duration ? 0 : this.seconds);
    this.running = true;
    return this.state;
  }

  pause(): AnimationState {
    this.running = false;
    return this.state;
  }

  /** Seconds, not milliseconds. No wall clock is read by this class. */
  update(delta: number): AnimationState {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new Error("Animation delta must be finite and nonnegative.");
    }
    if (!this.running || !this.selected) return this.state;
    const time = this.seconds + delta * this.rate;
    const keepPlaying = this.looping || time < this.selected.duration;
    this.seek(time, undefined, { loop: this.looping });
    this.running = keepPlaying;
    return this.state;
  }

  /** Restore the authored transforms and morph weights saved by the mixer. */
  reset(): AnimationState {
    this.mixer.stopAllAction();
    this.running = false;
    this.seconds = 0;
    this.selected = undefined;
    this.action = undefined;
    this.root.updateWorldMatrix(true, true);
    this.root.traverse((object) => {
      const skin = object as THREE.SkinnedMesh;
      if (skin.isSkinnedMesh) {
        skin.skeleton.update();
        skin.computeBoundingBox();
        skin.computeBoundingSphere();
      }
    });
    return this.state;
  }

  dispose(): void {
    this.reset();
    this.mixer.uncacheRoot(this.root);
    this.disposed = true;
  }
}

const samplers = new WeakMap<THREE.Object3D, AnimationPlayer>();
/** Deterministic convenience sampler. Call resetAnimation to restore the authored pose. */
export function sampleAnimation(
  root: THREE.Object3D,
  animation: string | THREE.AnimationClip,
  time: number,
  options: AnimationSampleOptions = {},
): AnimationState {
  let player = samplers.get(root);
  const clips = animationClips(root);
  if (typeof animation !== "string" && !clips.includes(animation)) {
    clips.push(animation);
  }
  if (
    !player || clips.length !== player.clips.length ||
    clips.some((c, i) => c !== player!.clips[i])
  ) {
    player?.dispose();
    player = new AnimationPlayer(root, clips);
    samplers.set(root, player);
  }
  return player.seek(
    time,
    typeof animation === "string" ? animation : animation.name,
    options,
  );
}
export function resetAnimation(root: THREE.Object3D): void {
  samplers.get(root)?.dispose();
  samplers.delete(root);
}

/** Bake procedural IK or secondary motion into portable position/quaternion/scale tracks. */
export function bakeAnimation(
  root: THREE.Object3D,
  name: string,
  options: {
    duration: number;
    fps?: number;
    targets: readonly (string | THREE.Object3D)[];
    /** Called in increasing time order, including t=0 and the exact endpoint. */
    update: (time: number, delta: number) => void;
  },
): THREE.AnimationClip {
  const fps = options.fps ?? 30;
  if (
    !Number.isFinite(fps) || fps <= 0 || fps > 240 ||
    !Number.isFinite(options.duration) || options.duration <= 0
  ) {
    throw new Error(
      "Bake duration must be positive and fps must be in (0, 240].",
    );
  }
  const count = Math.ceil(options.duration * fps);
  if (count > 10000 || !options.targets.length) {
    throw new Error("Bake needs targets and at most 10000 time steps.");
  }
  const targets = options.targets.map((target) => resolveTarget(root, target));
  if (new Set(targets).size !== targets.length) {
    throw new Error("Bake targets must be unique.");
  }
  const snapshot: {
    object: THREE.Object3D;
    p: THREE.Vector3;
    q: THREE.Quaternion;
    s: THREE.Vector3;
    morph?: number[];
  }[] = [];
  root.traverse((object) =>
    snapshot.push({
      object,
      p: object.position.clone(),
      q: object.quaternion.clone(),
      s: object.scale.clone(),
      morph: (object as THREE.Mesh).morphTargetInfluences?.slice(),
    })
  );
  const tracks = targets.flatMap((target) => [
    {
      target,
      property: "position" as const,
      relative: false,
      keys: [] as AnimationKey<XYZ>[],
    },
    {
      target,
      property: "quaternion" as const,
      keys: [] as AnimationKey<readonly [number, number, number, number]>[],
    },
    {
      target,
      property: "scale" as const,
      relative: false,
      keys: [] as AnimationKey<XYZ>[],
    },
  ]);
  try {
    let previous = 0;
    for (let i = 0; i <= count; i++) {
      const time = Math.min(i / fps, options.duration);
      options.update(time, time - previous);
      previous = time;
      for (const track of tracks) {
        if (track.property === "quaternion") {
          track.keys.push([time, track.target.quaternion.toArray()]);
        } else track.keys.push([time, track.target[track.property].toArray()]);
      }
    }
    return clip(root, name, tracks, { duration: options.duration });
  } finally {
    for (const { object, p, q, s, morph } of snapshot) {
      object.position.copy(p);
      object.quaternion.copy(q);
      object.scale.copy(s);
      if (morph) (object as THREE.Mesh).morphTargetInfluences = morph;
    }
    root.updateWorldMatrix(true, true);
  }
}
