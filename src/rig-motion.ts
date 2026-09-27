import * as THREE from "three";
import type { XYZ } from "./prelude.ts";
import { checkedVector, resolveTarget } from "./rigging.ts";

function bone(root: THREE.Object3D, name: string): THREE.Bone {
  const object = resolveTarget(root, name);
  if (!(object as THREE.Bone).isBone) throw new Error(`${name} is not a bone.`);
  return object as THREE.Bone;
}
function uniformScale(object: THREE.Object3D): void {
  for (
    let current: THREE.Object3D | null = object;
    current;
    current = current.parent
  ) {
    const { x, y, z } = current.scale;
    if (!(x > 0) || Math.abs(x - y) > 1e-6 || Math.abs(x - z) > 1e-6) {
      throw new Error(
        "IK and spring chains require positive, uniform ancestor scales.",
      );
    }
  }
}
function aim(object: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (from.lengthSq() < 1e-16 || to.lengthSq() < 1e-16) return;
  const world = object.getWorldQuaternion(new THREE.Quaternion());
  world.premultiply(
    new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()),
  );
  const parent = object.parent?.getWorldQuaternion(new THREE.Quaternion()) ??
    new THREE.Quaternion();
  object.quaternion.copy(parent.invert().multiply(world));
  object.updateWorldMatrix(false, true);
}

export interface TwoBoneIKOptions {
  root: string;
  mid: string;
  tip: string;
  target: XYZ;
  /** Point toward which the elbow or knee bends. */
  pole: XYZ;
  /** Default model: target and pole are in the supplied model root's local space. */
  space?: "model" | "world";
  weight?: number;
}
export interface IKResult {
  reached: boolean;
  distance: number;
  /** Final tip in world space. */
  tip: XYZ;
}

/** Analytic two-segment limb IK, without stretching. Unreachable goals clamp to reach. */
export function solveTwoBoneIK(
  model: THREE.Object3D,
  options: TwoBoneIKOptions,
): IKResult {
  const a = bone(model, options.root),
    b = bone(model, options.mid),
    c = bone(model, options.tip);
  if (b.parent !== a || c.parent !== b) {
    throw new Error("Two-bone IK requires a direct root → mid → tip chain.");
  }
  const weight = options.weight ?? 1;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error("IK weight must be in [0, 1].");
  }
  if (options.space && !["model", "world"].includes(options.space)) {
    throw new Error("IK space must be model or world.");
  }
  uniformScale(c);
  model.updateWorldMatrix(true, true);
  const target = checkedVector(options.target, "IK target"),
    pole = checkedVector(options.pole, "IK pole");
  if (options.space !== "world") {
    target.applyMatrix4(model.matrixWorld);
    pole.applyMatrix4(model.matrixWorld);
  }
  const p0 = a.getWorldPosition(new THREE.Vector3()),
    p1 = b.getWorldPosition(new THREE.Vector3()),
    p2 = c.getWorldPosition(new THREE.Vector3());
  const l1 = p0.distanceTo(p1), l2 = p1.distanceTo(p2);
  if (Math.min(l1, l2) < 1e-8) {
    throw new Error("IK segments must have nonzero length.");
  }
  const originalA = a.quaternion.clone(), originalB = b.quaternion.clone();
  const direction = target.clone().sub(p0), distance = direction.length();
  if (distance < 1e-8) direction.copy(p2).sub(p0);
  if (direction.lengthSq() < 1e-16) direction.set(0, 1, 0);
  direction.normalize();
  const reach = THREE.MathUtils.clamp(
    distance,
    Math.abs(l1 - l2) + 1e-8,
    l1 + l2 - 1e-8,
  );
  const bend = pole.clone().sub(p0).addScaledVector(
    direction,
    -pole.clone().sub(p0).dot(direction),
  );
  if (bend.lengthSq() < 1e-16) {
    bend.copy(p1).sub(p0).addScaledVector(
      direction,
      -p1.clone().sub(p0).dot(direction),
    );
  }
  if (bend.lengthSq() < 1e-16) {
    bend.copy(
      Math.abs(direction.x) < .8
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0),
    );
    bend.addScaledVector(direction, -bend.dot(direction));
  }
  bend.normalize();
  const x = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const elbow = p0.clone().addScaledVector(direction, x).addScaledVector(
    bend,
    y,
  );
  const end = p0.clone().addScaledVector(direction, reach);
  aim(a, p1.clone().sub(p0), elbow.clone().sub(p0));
  const newMid = b.getWorldPosition(new THREE.Vector3()),
    newTip = c.getWorldPosition(new THREE.Vector3());
  aim(b, newTip.sub(newMid), end.sub(newMid));
  a.quaternion.slerpQuaternions(originalA, a.quaternion.clone(), weight);
  b.quaternion.slerpQuaternions(originalB, b.quaternion.clone(), weight);
  model.updateWorldMatrix(true, true);
  const tip = c.getWorldPosition(new THREE.Vector3());
  const error = tip.distanceTo(target);
  return {
    reached: error <= (l1 + l2) * 1e-5,
    distance: error,
    tip: tip.toArray(),
  };
}

export type SpringCollider =
  | { type: "sphere"; center: XYZ; radius: number; object?: THREE.Object3D }
  | {
    type: "capsule";
    start: XYZ;
    end: XYZ;
    radius: number;
    object?: THREE.Object3D;
  };
export interface SpringChainOptions {
  /** Acceleration in world units / second². Default [0, -9.81, 0]. */
  gravity?: XYZ;
  wind?: XYZ;
  /** Rest-shape attraction in 1/second². Default 45. */
  stiffness?: number;
  /** Velocity decay in 1/second. Default 7. */
  damping?: number;
  /** Fixed step in seconds, 1/240–1/30. Default 1/120. */
  step?: number;
  iterations?: number;
  /** Point collision radius in world units. Default 0. */
  radius?: number;
  /** Collider points are world-space, or local to the supplied object. */
  colliders?: readonly SpringCollider[];
}

/** Fixed-step Verlet secondary motion for a bone chain. Bake it for portable playback. */
export class SpringChain {
  readonly bones: readonly THREE.Bone[];
  private points: THREE.Vector3[] = [];
  private previous: THREE.Vector3[] = [];
  private readonly base: THREE.Vector3[];
  private readonly rotations: THREE.Quaternion[];
  private readonly gravity: THREE.Vector3;
  private readonly wind: THREE.Vector3;
  private readonly stiffness: number;
  private readonly damping: number;
  private readonly step: number;
  private readonly iterations: number;
  private readonly radius: number;
  private accumulator = 0;

  constructor(
    readonly model: THREE.Object3D,
    names: readonly string[],
    readonly options: SpringChainOptions = {},
  ) {
    if (names.length < 2 || new Set(names).size !== names.length) {
      throw new Error("Spring chain needs at least two unique bones.");
    }
    this.bones = names.map((name) => bone(model, name));
    this.bones.forEach((bone, i) => {
      if (i && bone.parent !== this.bones[i - 1]) {
        throw new Error(
          "Spring chain bones must be direct parent/child links.",
        );
      }
      uniformScale(bone);
    });
    this.gravity = checkedVector(options.gravity ?? [0, -9.81, 0], "gravity");
    this.wind = checkedVector(options.wind ?? [0, 0, 0], "wind");
    this.stiffness = options.stiffness ?? 45;
    this.damping = options.damping ?? 7;
    this.step = options.step ?? 1 / 120;
    this.iterations = options.iterations ?? 8;
    this.radius = options.radius ?? 0;
    if (
      ![this.stiffness, this.damping, this.radius].every((v) =>
        Number.isFinite(v) && v >= 0
      ) || !Number.isFinite(this.step) || this.step < 1 / 240 ||
      this.step > 1 / 30 || !Number.isInteger(this.iterations) ||
      this.iterations < 1 || this.iterations > 64 ||
      this.stiffness * this.step * this.step > .5
    ) {
      throw new Error(
        "Invalid spring parameters; reduce stiffness or step for stability.",
      );
    }
    model.updateWorldMatrix(true, true);
    const parentInverse =
      (this.bones[0].parent?.matrixWorld ?? new THREE.Matrix4()).clone()
        .invert();
    this.base = this.bones.map((bone) =>
      bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(parentInverse)
    );
    if (
      this.base.some((point, i) =>
        i > 0 && point.distanceTo(this.base[i - 1]) < 1e-8
      )
    ) throw new Error("Spring segments must have nonzero length.");
    this.rotations = this.bones.map((bone) => bone.quaternion.clone());
    for (const collider of options.colliders ?? []) {
      if (!(collider.radius > 0 && Number.isFinite(collider.radius))) {
        throw new Error("Collider radius must be positive and finite.");
      }
      if (collider.type === "sphere") {
        checkedVector(collider.center, "collider center");
      } else if (collider.type === "capsule") {
        checkedVector(collider.start, "capsule start");
        checkedVector(collider.end, "capsule end");
      } else throw new Error("Collider type must be sphere or capsule.");
      if (collider.object) uniformScale(collider.object);
    }
    this.reset();
  }

  /** Restore this chain's initial local rotations and clear velocity. Leaves its parent animation alone. */
  reset(): void {
    this.bones.forEach((bone, i) => bone.quaternion.copy(this.rotations[i]));
    this.model.updateWorldMatrix(true, true);
    this.points = this.bones.map((bone) =>
      bone.getWorldPosition(new THREE.Vector3())
    );
    this.previous = this.points.map((point) => point.clone());
    this.accumulator = 0;
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0 || delta > 1) {
      throw new Error(
        "Spring delta must be in [0, 1] seconds; advance large intervals in smaller steps.",
      );
    }
    uniformScale(this.bones[0]);
    this.model.updateWorldMatrix(true, true);
    const parentWorld = this.bones[0].parent?.matrixWorld ??
      new THREE.Matrix4();
    const goals = this.base.map((p) => p.clone().applyMatrix4(parentWorld));
    const anchor = this.bones[0].getWorldPosition(new THREE.Vector3());
    const offset = anchor.clone().sub(goals[0]);
    goals.forEach((goal) => goal.add(offset));
    const lengths = goals.slice(1).map((p, i) => p.distanceTo(goals[i]));
    const colliders = (this.options.colliders ?? []).map((collider) => {
      collider.object?.updateWorldMatrix(true, false);
      if (collider.object) uniformScale(collider.object);
      const matrix = collider.object?.matrixWorld ?? new THREE.Matrix4();
      const scale = new THREE.Vector3().setFromMatrixScale(matrix).x;
      return {
        radius: collider.radius * scale + this.radius,
        start: checkedVector(
          collider.type === "sphere" ? collider.center : collider.start,
          "collider",
        ).applyMatrix4(matrix),
        end: checkedVector(
          collider.type === "sphere" ? collider.center : collider.end,
          "collider",
        ).applyMatrix4(matrix),
      };
    });
    const collide = (point: THREE.Vector3, fallback: THREE.Vector3) => {
      for (const collider of colliders) {
        const center = new THREE.Line3(collider.start, collider.end)
          .closestPointToPoint(point, true, new THREE.Vector3());
        const direction = point.clone().sub(center),
          distance = direction.length();
        if (distance >= collider.radius) continue;
        if (distance < 1e-8) {
          direction.copy(fallback).sub(center);
          if (direction.lengthSq() < 1e-16) direction.set(0, 0, 1);
        }
        point.copy(center).addScaledVector(
          direction.normalize(),
          collider.radius,
        );
      }
    };
    this.accumulator += delta;
    while (this.accumulator + 1e-12 >= this.step) {
      this.points[0].copy(anchor);
      this.previous[0].copy(anchor);
      for (let i = 1; i < this.points.length; i++) {
        const point = this.points[i], old = point.clone();
        const velocity = point.clone().sub(this.previous[i]).multiplyScalar(
          Math.exp(-this.damping * this.step),
        );
        const acceleration = goals[i].clone().sub(point).multiplyScalar(
          this.stiffness,
        ).add(this.gravity).add(this.wind);
        point.add(velocity).addScaledVector(
          acceleration,
          this.step * this.step,
        );
        this.previous[i].copy(old);
      }
      for (let iteration = 0; iteration < this.iterations; iteration++) {
        for (let i = 1; i < this.points.length; i++) {
          const direction = this.points[i].clone().sub(this.points[i - 1]);
          if (direction.lengthSq() < 1e-16) {
            direction.copy(goals[i]).sub(goals[i - 1]);
          }
          this.points[i].copy(this.points[i - 1]).addScaledVector(
            direction.normalize(),
            lengths[i - 1],
          );
          collide(this.points[i], goals[i]);
        }
      }
      this.accumulator -= this.step;
    }
    // Reconstruct rotations, retaining bone lengths and each segment's existing twist.
    for (let i = 0; i < this.bones.length - 1; i++) {
      const start = this.bones[i].getWorldPosition(new THREE.Vector3());
      const end = this.bones[i + 1].getWorldPosition(new THREE.Vector3());
      aim(this.bones[i], end.sub(start), this.points[i + 1].clone().sub(start));
    }
    this.model.updateWorldMatrix(true, true);
  }
}

export function springChain(
  root: THREE.Object3D,
  names: readonly string[],
  options: SpringChainOptions = {},
): SpringChain {
  return new SpringChain(root, names, options);
}
