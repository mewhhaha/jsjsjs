import * as THREE from "three";
import type { TransformOptions, XYZ } from "./primitives.ts";
import {
  checkedVector,
  degrees,
  resolveTarget,
  rest,
  restTransform,
} from "./internal.ts";

export interface BoneDefinition extends TransformOptions {
  name: string;
  parent?: string;
}
export interface RigOptions extends TransformOptions {
  /** Definitions normally use parent-local transforms. */
  space?: "local" | "model";
}
export interface PoseTransform {
  /** Local XYZ Euler offsets in degrees, composed after the rest rotation. */
  rotation?: XYZ;
  /** Local translation offset from rest. */
  position?: XYZ;
  /** Multiplier of rest scale. */
  scale?: number | XYZ;
}
export type Pose = Readonly<Record<string, PoseTransform>>;

/** Capture a new reference pose, including on an imported model. Call before posing it. */
export function captureRestPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    rest.delete(object);
    restTransform(object);
  });
}

/** A normal Group containing named Bones and a Three.js Skeleton. */
export class Rig extends THREE.Group {
  private namedBones: Readonly<Record<string, THREE.Bone>> = Object.freeze(
    Object.create(null),
  );
  private boneSkeleton = new THREE.Skeleton();
  get bones(): Readonly<Record<string, THREE.Bone>> {
    return this.namedBones;
  }
  get skeleton(): THREE.Skeleton {
    return this.boneSkeleton;
  }

  constructor(
    definitions?: readonly BoneDefinition[],
    options: RigOptions = {},
  ) {
    super();
    // Object3D.clone constructs its subclasses without arguments, then copies them.
    if (definitions === undefined) return;
    if (!definitions.length) throw new Error("A rig needs at least one bone.");
    if (definitions.length > 65535) {
      throw new Error("A rig supports at most 65535 bones.");
    }
    if (options.space && !["local", "model"].includes(options.space)) {
      throw new Error("Rig space must be local or model.");
    }
    const bones: Record<string, THREE.Bone> = Object.create(null);
    const specs = new Map<string, BoneDefinition>();
    for (const spec of definitions) {
      if (!spec.name.trim() || specs.has(spec.name)) {
        throw new Error(`Bone names must be nonempty and unique: ${spec.name}`);
      }
      specs.set(spec.name, spec);
      const bone = new THREE.Bone();
      bone.name = spec.name;
      if (spec.position) {
        bone.position.copy(checkedVector(spec.position, "position"));
      }
      if (spec.rotation) bone.quaternion.copy(degrees(spec.rotation));
      if (spec.scale !== undefined) bone.scale.copy(scaleVector(spec.scale));
      bone.updateMatrix();
      bones[spec.name] = bone;
    }
    const matrices = new Map(
      Object.entries(bones).map(([name, bone]) => [name, bone.matrix.clone()]),
    );
    const visited = new Set<string>(), visiting = new Set<string>();
    const link = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Bone parent cycle at ${name}.`);
      visiting.add(name);
      const spec = specs.get(name)!;
      if (spec.parent !== undefined) {
        if (!specs.has(spec.parent)) {
          throw new Error(`Unknown parent bone: ${spec.parent}`);
        }
        link(spec.parent);
        bones[spec.parent].add(bones[name]);
        if (options.space === "model") {
          const matrix = matrices.get(spec.parent)!.clone().invert().multiply(
            matrices.get(name)!,
          );
          matrix.decompose(
            bones[name].position,
            bones[name].quaternion,
            bones[name].scale,
          );
          bones[name].updateMatrix();
          if (
            matrix.elements.some((v, i) =>
              Math.abs(v - bones[name].matrix.elements[i]) > 1e-6
            )
          ) {
            throw new Error(
              "Model-space bones cannot require sheared local transforms.",
            );
          }
        }
      } else this.add(bones[name]);
      visiting.delete(name);
      visited.add(name);
    };
    definitions.forEach(({ name }) => link(name));
    this.name = options.name ?? "rig";
    if (options.position) {
      this.position.copy(checkedVector(options.position, "position"));
    }
    if (options.rotation) this.quaternion.copy(degrees(options.rotation));
    if (options.scale !== undefined) {
      this.scale.copy(scaleVector(options.scale));
    }
    this.namedBones = Object.freeze(bones);
    this.updateMatrixWorld(true);
    this.boneSkeleton = new THREE.Skeleton(
      definitions.map(({ name }) => bones[name]),
    );
    captureRestPose(this);
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    const copies = new Map<THREE.Object3D, THREE.Object3D>();
    const visit = (original: THREE.Object3D, copied: THREE.Object3D) => {
      copies.set(original, copied);
      if (recursive) {
        original.children.forEach((child, i) =>
          visit(child, copied.children[i])
        );
      }
    };
    visit(source, this);
    const skeletons = new Map<THREE.Skeleton, THREE.Skeleton>();
    const copySkeleton = (skeleton: THREE.Skeleton) => {
      let copied = skeletons.get(skeleton);
      if (!copied) {
        const bones = skeleton.bones.map((bone) => {
          const target = copies.get(bone) as THREE.Bone | undefined;
          if (!target) {
            throw new Error(
              "Clone the whole rig so every skin bone is included.",
            );
          }
          return target;
        });
        copied = new THREE.Skeleton(
          bones,
          skeleton.boneInverses.map((inverse) => inverse.clone()),
        );
        skeletons.set(skeleton, copied);
      }
      return copied;
    };
    const animationCopies = new Map<THREE.AnimationClip, THREE.AnimationClip>();
    const uuids = new Map(
      [...copies].map(([original, copied]) => [original.uuid, copied.uuid]),
    );
    for (const [original, copied] of copies) {
      const base = rest.get(original);
      if (base) {
        rest.set(copied, {
          position: base.position.clone(),
          quaternion: base.quaternion.clone(),
          scale: base.scale.clone(),
        });
      }
      if (recursive && (original as THREE.SkinnedMesh).isSkinnedMesh) {
        (copied as THREE.SkinnedMesh).skeleton = copySkeleton(
          (original as THREE.SkinnedMesh).skeleton,
        );
      }
      copied.animations = original.animations.map((animation) => {
        const existing = animationCopies.get(animation);
        if (existing) return existing;
        const result = animation.clone();
        animationCopies.set(animation, result);
        for (const track of result.tracks) {
          const name =
            THREE.PropertyBinding.parseTrackName(track.name).nodeName;
          const uuid = uuids.get(name);
          if (uuid) track.name = track.name.replace(name, uuid);
        }
        return result;
      });
      if (recursive && original instanceof Rig && copied instanceof Rig) {
        copied.boneSkeleton = copySkeleton(original.skeleton);
        copied.namedBones = Object.freeze(
          Object.assign(
            Object.create(null),
            Object.fromEntries(
              Object.entries(original.bones).map((
                [name, bone],
              ) => [name, copies.get(bone)]),
            ),
          ),
        );
      }
    }
    return this;
  }
}

export function rig(
  definitions: readonly BoneDefinition[],
  options: RigOptions = {},
): Rig {
  return new Rig(definitions, options);
}

/** Points are in the chain parent's local space. Names are prefix_0, prefix_1, … */
export function boneChain(
  prefix: string,
  points: readonly XYZ[],
  options: { parent?: string } = {},
): BoneDefinition[] {
  if (!prefix.trim() || points.length < 2) {
    throw new Error("A bone chain needs a name and at least two points.");
  }
  const vectors = points.map((p) => checkedVector(p, "chain point"));
  return vectors.map((p, i) => {
    const offset = i ? p.clone().sub(vectors[i - 1]) : p;
    if (i && offset.lengthSq() < 1e-16) {
      throw new Error("Adjacent chain points must differ.");
    }
    return {
      name: `${prefix}_${i}`,
      parent: i ? `${prefix}_${i - 1}` : options.parent,
      position: offset.toArray(),
    };
  });
}

function scaleVector(scale: number | XYZ): THREE.Vector3 {
  const v = checkedVector(
    typeof scale === "number" ? [scale, scale, scale] : scale,
    "scale",
  );
  if ([v.x, v.y, v.z].some((n) => n <= 0)) {
    throw new Error("Rig and pose scales must be positive.");
  }
  return v;
}

/** Apply rest-relative transforms. Reapplying the same pose never accumulates. */
export function applyPose(root: THREE.Object3D, pose: Pose): void {
  const pending = Object.entries(pose).map(([name, value]) => {
    const object = resolveTarget(root, name), base = restTransform(object);
    return {
      object,
      position: base.position.clone().add(
        checkedVector(value.position ?? [0, 0, 0], "pose position"),
      ),
      quaternion: base.quaternion.clone().multiply(
        degrees(value.rotation ?? [0, 0, 0]),
      ),
      scale: base.scale.clone().multiply(scaleVector(value.scale ?? 1)),
    };
  });
  for (const { object, position, quaternion, scale } of pending) {
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    object.scale.copy(scale);
    object.updateMatrix();
  }
  root.updateWorldMatrix(true, true);
}

/** Restore every captured transform, leaving geometry, weights and clips intact. */
export function resetPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    const base = rest.get(object);
    if (!base) return;
    object.position.copy(base.position);
    object.quaternion.copy(base.quaternion);
    object.scale.copy(base.scale);
    object.updateMatrix();
  });
  root.updateWorldMatrix(true, true);
}

export type BoneWeights = Readonly<Record<string, number>>;
export interface SkinVertex {
  index: number;
  /** Vertex in rig-local coordinates at binding time. */
  position: XYZ;
  localPosition: XYZ;
}
export interface SkinEnvelope {
  bone: string;
  /** Segment ends at this bone, or at an explicit rig-local point. Defaults to the bone itself. */
  end?: string | XYZ;
  radius: number;
  /** Positive exponent controlling the distance falloff. Default 2. */
  falloff?: number;
}
export interface SkinBindingOptions {
  /** One bone, constant weights, per-vertex weights, or a callback. */
  weights?:
    | string
    | BoneWeights
    | readonly BoneWeights[]
    | ((vertex: SkinVertex) => BoneWeights);
  /** Simple distance envelopes; mutually exclusive with weights. */
  envelopes?: readonly SkinEnvelope[];
  /** Explicit fallback for vertices outside every envelope. Otherwise binding fails. */
  fallbackBone?: string;
}

/** Bind a mesh at rest. Replaces it in its rig subtree, or adds an unparented mesh to the rig. */
export function bindSkin(
  source: THREE.Mesh,
  target: Rig,
  options: SkinBindingOptions,
): THREE.SkinnedMesh {
  if (
    (source as THREE.SkinnedMesh).isSkinnedMesh ||
    (source as THREE.InstancedMesh).isInstancedMesh
  ) {
    throw new Error("bindSkin expects an ordinary, unskinned Mesh.");
  }
  if ((options.weights === undefined) === (options.envelopes === undefined)) {
    throw new Error("Choose either weights or envelopes for bindSkin.");
  }
  if (source.parent) resolveTarget(target, source);
  for (const bone of Object.values(target.bones)) {
    const base = restTransform(bone);
    if (
      bone.position.distanceTo(base.position) > 1e-7 ||
      1 - Math.abs(bone.quaternion.dot(base.quaternion)) > 1e-7 ||
      bone.scale.distanceTo(base.scale) > 1e-7
    ) {
      throw new Error(
        "Bind skin in the rest pose, before applying a pose or animation.",
      );
    }
  }
  target.updateWorldMatrix(true, true);
  source.updateMatrix();
  const meshWorld = source.parent
    ? source.matrixWorld
    : target.matrixWorld.clone().multiply(source.matrix);
  const toRig = target.matrixWorld.clone().invert().multiply(meshWorld);
  const indices = new Map(
    target.skeleton.bones.map((bone, i) => [bone.name, i]),
  );
  const requireBone = (name: string) => {
    const index = indices.get(name);
    if (index === undefined) throw new Error(`Unknown weight bone: ${name}`);
    return index;
  };
  if (options.fallbackBone !== undefined) requireBone(options.fallbackBone);
  const rigInverse = target.matrixWorld.clone().invert();
  const bonePoint = (name: string) => {
    requireBone(name);
    return target.bones[name].getWorldPosition(new THREE.Vector3())
      .applyMatrix4(rigInverse);
  };
  const envelopes = options.envelopes?.map((envelope) => {
    requireBone(envelope.bone);
    if (
      !(envelope.radius > 0 && Number.isFinite(envelope.radius)) ||
      !((envelope.falloff ?? 2) > 0 && Number.isFinite(envelope.falloff ?? 2))
    ) {
      throw new Error(
        "Envelope radius and falloff must be finite and positive.",
      );
    }
    const start = bonePoint(envelope.bone);
    return {
      ...envelope,
      segment: new THREE.Line3(
        start,
        typeof envelope.end === "string"
          ? bonePoint(envelope.end)
          : envelope.end
          ? checkedVector(envelope.end, "envelope end")
          : start.clone(),
      ),
    };
  });
  const positions = source.geometry.getAttribute("position");
  if (!positions?.count) throw new Error("Skin geometry needs positions.");
  if (
    Array.isArray(options.weights) && options.weights.length !== positions.count
  ) throw new Error("Per-vertex weight count must match geometry positions.");
  const skinIndices = new Uint16Array(positions.count * 4),
    skinWeights = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    const local = new THREE.Vector3().fromBufferAttribute(positions, i);
    const p = local.clone().applyMatrix4(toRig);
    let weights: BoneWeights;
    if (envelopes) {
      const computed: Record<string, number> = Object.create(null);
      for (const envelope of envelopes) {
        const distance = p.distanceTo(
          envelope.segment.closestPointToPoint(p, true, new THREE.Vector3()),
        );
        computed[envelope.bone] = (computed[envelope.bone] ?? 0) +
          Math.pow(
            Math.max(0, 1 - distance / envelope.radius),
            envelope.falloff ?? 2,
          );
      }
      if (!Object.values(computed).some((w) => w > 0) && options.fallbackBone) {
        computed[options.fallbackBone] = 1;
      }
      weights = computed;
    } else {
      const input = options.weights!;
      weights = typeof input === "string"
        ? { [input]: 1 }
        : typeof input === "function"
        ? input({
          index: i,
          position: p.toArray(),
          localPosition: local.toArray(),
        })
        : Array.isArray(input)
        ? input[i]
        : input as BoneWeights;
    }
    const entries = Object.entries(weights).map(([name, weight]) => {
      const index = requireBone(name);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`Invalid skin weight on vertex ${i}: ${name}`);
      }
      return { index, weight };
    }).filter(({ weight }) => weight > 0).sort((a, b) =>
      b.weight - a.weight || a.index - b.index
    ).slice(0, 4);
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(
        `Unweighted vertex ${i}; provide weights or an explicit fallbackBone.`,
      );
    }
    entries.forEach(({ index, weight }, j) => {
      skinIndices[i * 4 + j] = index;
      skinWeights[i * 4 + j] = weight / total;
    });
  }
  const geometry = source.geometry.clone();
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );
  const mesh = new THREE.SkinnedMesh(geometry, source.material);
  THREE.Object3D.prototype.copy.call(mesh, source, false);
  mesh.morphTargetDictionary = source.morphTargetDictionary
    ? { ...source.morphTargetDictionary }
    : undefined;
  mesh.morphTargetInfluences = source.morphTargetInfluences?.slice();
  const parent = source.parent ?? target;
  parent.add(mesh);
  if (source.parent) parent.remove(source);
  for (const child of [...source.children]) mesh.add(child);
  mesh.updateWorldMatrix(true, true);
  // Adding a skin after moving/reparenting the rig must not leave earlier skins
  // using inverse binds from a different world-space reference.
  target.skeleton.calculateInverses();
  target.traverse((object) => {
    const skin = object as THREE.SkinnedMesh;
    if (
      object === mesh ||
      (skin.isSkinnedMesh && skin.skeleton === target.skeleton)
    ) {
      skin.bind(target.skeleton, skin.matrixWorld);
    }
  });
  // Animated bounds change; default culling on the rest bounds can hide limbs.
  mesh.frustumCulled = false;
  return mesh;
}

/** Attach a prop, wig, or accessory. Local uses its existing local transform; world preserves placement. */
export function attachToBone<T extends THREE.Object3D>(
  root: THREE.Object3D,
  boneName: string,
  object: T,
  options: { space?: "local" | "world" } = {},
): T {
  const bone = resolveTarget(root, boneName);
  if (!(bone as THREE.Bone).isBone) {
    throw new Error(`${boneName} is not a bone.`);
  }
  for (
    let parent: THREE.Object3D | null = bone;
    parent;
    parent = parent.parent
  ) {
    if (parent === object) {
      throw new Error(
        "Attachment would create a hierarchy cycle.",
      );
    }
  }
  const space = options.space ?? "local";
  if (!["local", "world"].includes(space)) {
    throw new Error("Attachment space must be local or world.");
  }
  if (space === "world") {
    bone.updateWorldMatrix(true, false);
    object.updateWorldMatrix(true, false);
    const matrix = bone.matrixWorld.clone().invert().multiply(
      object.matrixWorld,
    );
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    matrix.decompose(p, q, s);
    const recomposed = new THREE.Matrix4().compose(p, q, s);
    if (
      !recomposed.elements.every(Number.isFinite) ||
      matrix.elements.some((v, i) =>
        Math.abs(v - recomposed.elements[i]) > 1e-6
      )
    ) {
      throw new Error(
        "World attachment cannot preserve a sheared or singular transform.",
      );
    }
    bone.add(object);
    object.position.copy(p);
    object.quaternion.copy(q);
    object.scale.copy(s);
  } else bone.add(object);
  object.updateWorldMatrix(true, true);
  return object;
}

/** A simple Y-up, +Z-facing, T-pose biped. Dimensions are proportions of height. */
export function humanoidRig(
  options: { height?: number; name?: string; fingers?: boolean } = {},
): Rig {
  const height = options.height ?? 1.8;
  if (!(height > 0 && Number.isFinite(height))) {
    throw new Error("Humanoid height must be positive and finite.");
  }
  const definitions: BoneDefinition[] = [];
  const add = (name: string, parent: string | undefined, p: XYZ) =>
    definitions.push({
      name,
      parent,
      position: p.map((v) => v * height) as unknown as XYZ,
    });
  add("Root", undefined, [0, 0, 0]);
  add("Hips", "Root", [0, .52, 0]);
  add("Spine", "Hips", [0, .61, 0]);
  add("Chest", "Spine", [0, .73, 0]);
  add("Neck", "Chest", [0, .84, 0]);
  add("Head", "Neck", [0, .91, 0]);
  add("HeadTip", "Head", [0, 1, 0]);
  for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    add(`Shoulder_${side}`, "Chest", [.07 * sign, .80, 0]);
    add(`UpperArm_${side}`, `Shoulder_${side}`, [.12 * sign, .80, 0]);
    add(`Forearm_${side}`, `UpperArm_${side}`, [.29 * sign, .80, 0]);
    add(`Hand_${side}`, `Forearm_${side}`, [.43 * sign, .80, 0]);
    add(`HandTip_${side}`, `Hand_${side}`, [.49 * sign, .80, 0]);
    add(`Thigh_${side}`, "Hips", [.07 * sign, .50, 0]);
    add(`Shin_${side}`, `Thigh_${side}`, [.07 * sign, .27, .015]);
    add(`Foot_${side}`, `Shin_${side}`, [.07 * sign, .045, 0]);
    add(`Toe_${side}`, `Foot_${side}`, [.07 * sign, .025, .10]);
    if (options.fingers) {
      for (
        const [finger, z, length] of [
          ["Thumb", .024, .045],
          ["Index", .013, .065],
          ["Middle", 0, .072],
          ["Ring", -.013, .063],
          ["Pinky", -.024, .052],
        ] as const
      ) {
        for (let i = 0; i < 4; i++) {
          add(
            `${finger}${i}_${side}`,
            i ? `${finger}${i - 1}_${side}` : `Hand_${side}`,
            [(.462 + length * i / 3) * sign, .80, z],
          );
        }
      }
    }
  }
  return rig(definitions, { name: options.name ?? "humanoid", space: "model" });
}
