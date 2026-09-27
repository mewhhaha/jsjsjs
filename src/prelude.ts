/** Small modeling helpers. Y is up; dimensions use your chosen unit; rotations use degrees. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
export * from "./vessels.ts";
export * from "./profiles.ts";
export * from "./assemblies.ts";
export * from "./operations.ts";
export * from "./strand-data.ts";
export * from "./strands.ts";
export * from "./hair-cards.ts";
export * from "./strand-presets.ts";
export * from "./groom-data.ts";
export * from "./groom-cards.ts";
export * from "./groom.ts";
export * from "./groom-volume-data.ts";
export * from "./groom-volume-shadows.ts";
export * from "./hair-shading.ts";
export * from "./stylized-hair.ts";
export {
  applyPose,
  attachToBone,
  bindSkin,
  boneChain,
  type BoneDefinition,
  type BoneWeights,
  captureRestPose,
  humanoidRig,
  type Pose,
  type PoseTransform,
  resetPose,
  Rig,
  rig,
  type RigOptions,
  type SkinBindingOptions,
  type SkinEnvelope,
  type SkinVertex,
} from "./rigging.ts";
export * from "./animation.ts";
export * from "./rig-motion.ts";

export {
  ramp,
  type RampOptions,
  stairs,
  type StairsOptions,
} from "./stairs.ts";
export { arch, type ArchOptions } from "./arch.ts";
export {
  column,
  type ColumnOptions,
  type CompositionOptions,
  gableRoof,
  type GableRoofOptions,
  wall,
  type WallOpening,
  type WallOptions,
} from "./architecture.ts";

export { THREE };
export type XYZ = readonly [number, number, number];
export type Axis = "x" | "y" | "z";
export type ModelFactory = () => THREE.Object3D | Promise<THREE.Object3D>;

/** Optional viewer settings, stored on the root object's userData.preview. */
export interface PreviewOptions {
  background?: THREE.ColorRepresentation;
  grid?: boolean;
  exposure?: number;
  target?: XYZ;
  direction?: XYZ;
  radius?: number;
  padding?: number;
  lighting?: {
    hemisphere?: number;
    key?: number;
    fill?: number;
    /** Enable model-fitted soft key/fill shadows. Default false. */
    shadows?: boolean;
    /** Use source-fiber volume attenuation for guide grooms. Default true with shadows. */
    hairShadows?: boolean;
    /** Directional hair optical-depth grid resolution, 16–192. Default 96. */
    hairShadowResolution?: number;
    /** Local hair occlusion of ambient/environment light, 0–1. Default 1 with shadows. */
    hairAmbientOcclusion?: number;
    /** Ambient visibility grid resolution, 16–96. Default 64. */
    hairAmbientResolution?: number;
    /** Ambient occlusion distance in world units. Default 12% of the groom bounds' largest extent. */
    hairAmbientDistance?: number;
  };
}
export interface TransformOptions {
  name?: string;
  position?: XYZ;
  /** Euler XYZ angles in degrees, unlike native Three.js rotations. */
  rotation?: XYZ;
  scale?: number | XYZ;
}
export interface MeshOptions extends TransformOptions {
  material?: THREE.Material | THREE.Material[];
}
export interface GroupOptions extends TransformOptions {
  preview?: PreviewOptions;
}
export interface RoundedBoxOptions extends MeshOptions {
  segments?: number;
}
export interface SphereOptions extends MeshOptions {
  widthSegments?: number;
  heightSegments?: number;
}
export interface CylinderOptions extends MeshOptions {
  /** Defaults to the bottom radius; use zero for a cone. */
  radiusTop?: number;
  radialSegments?: number;
  heightSegments?: number;
  openEnded?: boolean;
}
export interface ExtrudeOptions extends MeshOptions {
  depth?: number;
  steps?: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelSegments?: number;
}
export interface LatheOptions extends MeshOptions {
  segments?: number;
  /** Start and sweep angles in degrees. */
  startAngle?: number;
  sweep?: number;
}
export interface TubeOptions extends MeshOptions {
  radius?: number;
  tubularSegments?: number;
  radialSegments?: number;
  closed?: boolean;
}
export interface RadialOptions extends GroupOptions {
  /** Start and total sweep in degrees. Full circles omit the duplicate endpoint. */
  startAngle?: number;
  sweep?: number;
  /** Rotate each object's local +X direction outward (before its own rotation). */
  orient?: boolean;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}
function positive(value: number, name: string, allowZero = false): number {
  finite(value, name);
  if (allowZero ? value < 0 : value <= 0) {
    throw new RangeError(
      `${name} must be ${allowZero ? "nonnegative" : "positive"}`,
    );
  }
  return value;
}
function segments(value: number, name: string, minimum = 1): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}
function vector(value: XYZ, name: string): THREE.Vector3 {
  if (value.length !== 3) {
    throw new RangeError(`${name} must have three components`);
  }
  value.forEach((n) => finite(n, name));
  return new THREE.Vector3(...value);
}
function dimensions(size: XYZ): void {
  vector(size, "size");
  size.forEach((n) => positive(n, "size"));
}
function sweepAngle(value: number): number {
  positive(value, "sweep");
  if (value > 360) throw new RangeError("sweep must be <= 360 degrees");
  return THREE.MathUtils.degToRad(value);
}

/** Create a standard physically based material; reuse it across meshes. */
export function material(
  options: THREE.ColorRepresentation | THREE.MeshStandardMaterialParameters =
    {},
): THREE.MeshStandardMaterial {
  const parameters =
    typeof options === "string" || typeof options === "number" ||
      options instanceof THREE.Color
      ? { color: options }
      : options;
  return new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0,
    ...parameters,
  });
}

/** Set supplied local transforms in place, returning the same object. */
export function transform<T extends THREE.Object3D>(
  object: T,
  options: TransformOptions,
): T {
  if (options.position !== undefined) {
    object.position.copy(vector(options.position, "position"));
  }
  if (options.rotation !== undefined) {
    const angles = vector(options.rotation, "rotation").multiplyScalar(
      Math.PI / 180,
    );
    object.rotation.set(angles.x, angles.y, angles.z, "XYZ");
  }
  if (options.scale !== undefined) {
    const scale = typeof options.scale === "number"
      ? new THREE.Vector3().setScalar(finite(options.scale, "scale"))
      : vector(options.scale, "scale");
    if (scale.x === 0 || scale.y === 0 || scale.z === 0) {
      throw new RangeError("scale must be nonzero");
    }
    object.scale.copy(scale);
  }
  if (options.name !== undefined) object.name = options.name;
  object.updateMatrix();
  return object;
}
function mesh<G extends THREE.BufferGeometry>(
  geometry: G,
  options: MeshOptions,
): THREE.Mesh<G> {
  return transform(
    new THREE.Mesh(geometry, options.material ?? material()),
    options,
  );
}

/** Box centered at its origin, sized [width, height, depth]. */
export function box(
  size: XYZ = [1, 1, 1],
  options: MeshOptions = {},
): THREE.Mesh<THREE.BoxGeometry> {
  dimensions(size);
  return mesh(new THREE.BoxGeometry(...size), options);
}
/** Rounded box with the same outer dimensions as box; radius must fit the smallest side. */
export function roundedBox(
  size: XYZ = [1, 1, 1],
  radius = 0.1,
  options: RoundedBoxOptions = {},
): THREE.Mesh<RoundedBoxGeometry> {
  dimensions(size);
  positive(radius, "radius");
  if (radius > Math.min(...size) / 2) {
    throw new RangeError("radius exceeds half the smallest dimension");
  }
  return mesh(
    new RoundedBoxGeometry(
      ...size,
      segments(options.segments ?? 3, "segments"),
      radius,
    ),
    options,
  );
}
export function sphere(
  radius = 0.5,
  options: SphereOptions = {},
): THREE.Mesh<THREE.SphereGeometry> {
  return mesh(
    new THREE.SphereGeometry(
      positive(radius, "radius"),
      segments(options.widthSegments ?? 32, "widthSegments", 3),
      segments(options.heightSegments ?? 16, "heightSegments", 2),
    ),
    options,
  );
}
/** Centered Y-axis cylinder. radius is the bottom radius; radiusTop can make cones. */
export function cylinder(
  radius = 0.5,
  height = 1,
  options: CylinderOptions = {},
): THREE.Mesh<THREE.CylinderGeometry> {
  return mesh(
    new THREE.CylinderGeometry(
      positive(options.radiusTop ?? radius, "radiusTop", true),
      positive(radius, "radius"),
      positive(height, "height"),
      segments(options.radialSegments ?? 32, "radialSegments", 3),
      segments(options.heightSegments ?? 1, "heightSegments"),
      options.openEnded ?? false,
    ),
    options,
  );
}
/** Extrude an XY profile along +Z; bevels are disabled by default. */
export function extrude(
  shapes: THREE.Shape | THREE.Shape[],
  options: ExtrudeOptions = {},
): THREE.Mesh<THREE.ExtrudeGeometry> {
  if (Array.isArray(shapes) && shapes.length === 0) {
    throw new RangeError("shapes must not be empty");
  }
  const curveSegments = segments(options.curveSegments ?? 12, "curveSegments");
  for (const shape of Array.isArray(shapes) ? shapes : [shapes]) {
    const extracted = shape.extractPoints(curveSegments);
    for (const ring of [extracted.shape, ...extracted.holes]) {
      for (const point of ring) {
        finite(point.x, "profile x");
        finite(point.y, "profile y");
      }
      if (ring.length < 3 || THREE.ShapeUtils.area(ring) === 0) {
        throw new RangeError(
          "extrude profiles and holes must enclose nonzero area",
        );
      }
    }
  }
  return mesh(
    new THREE.ExtrudeGeometry(shapes, {
      depth: positive(options.depth ?? 1, "depth"),
      steps: segments(options.steps ?? 1, "steps"),
      curveSegments,
      bevelEnabled: options.bevelEnabled ?? false,
      bevelThickness: positive(
        options.bevelThickness ?? 0.1,
        "bevelThickness",
        true,
      ),
      bevelSize: positive(options.bevelSize ?? 0.1, "bevelSize", true),
      bevelSegments: segments(options.bevelSegments ?? 3, "bevelSegments"),
    }),
    options,
  );
}
/** Revolve [radius, y] profile points around Y. Endpoints on the axis close the ends. */
export function lathe(
  points: readonly (readonly [number, number])[],
  options: LatheOptions = {},
): THREE.Mesh<THREE.LatheGeometry> {
  if (points.length < 2) {
    throw new RangeError("lathe requires at least two profile points");
  }
  const profile = points.map(([r, y]) =>
    new THREE.Vector2(
      positive(r, "profile radius", true),
      finite(y, "profile y"),
    )
  );
  if (
    !profile.some((p) => p.x > 0) || profile.every((p) => p.equals(profile[0]))
  ) {
    throw new RangeError("lathe profile must have nonzero radius and length");
  }
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].equals(profile[i - 1])) {
      throw new RangeError("profile has repeated consecutive points");
    }
  }
  return mesh(
    new THREE.LatheGeometry(
      profile,
      segments(options.segments ?? 32, "segments", 3),
      THREE.MathUtils.degToRad(finite(options.startAngle ?? 0, "startAngle")),
      sweepAngle(options.sweep ?? 360),
    ),
    options,
  );
}
/** Smooth tube through points (centripetal Catmull–Rom), or along a native Three.js curve. */
export function tube(
  path: readonly XYZ[] | THREE.Curve<THREE.Vector3>,
  options: TubeOptions = {},
): THREE.Mesh<THREE.TubeGeometry> {
  let curve: THREE.Curve<THREE.Vector3>;
  if (Array.isArray(path)) {
    const points = path.map((p) => vector(p, "path point"));
    const closed = options.closed ?? false;
    if (points.length < (closed ? 3 : 2)) {
      throw new RangeError(
        "tube needs at least two points (three when closed)",
      );
    }
    for (let i = 1; i < points.length; i++) {
      if (points[i].equals(points[i - 1])) {
        throw new RangeError("path has repeated consecutive points");
      }
    }
    if (closed && points[0].equals(points[points.length - 1])) {
      throw new RangeError("closed path must omit its duplicated endpoint");
    }
    curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  } else {
    curve = path as THREE.Curve<THREE.Vector3>;
  }
  positive(curve.getLength(), "path length");
  return mesh(
    new THREE.TubeGeometry(
      curve,
      segments(options.tubularSegments ?? 64, "tubularSegments"),
      positive(options.radius ?? 0.1, "radius"),
      segments(options.radialSegments ?? 12, "radialSegments", 3),
      options.closed ?? false,
    ),
    options,
  );
}
/** Add children to a new group (reparents them); optionally configure its viewer preview. */
export function group(
  children: readonly THREE.Object3D[] = [],
  options: GroupOptions = {},
): THREE.Group {
  const result = transform(new THREE.Group(), options);
  if (children.length) result.add(...children);
  if (options.preview !== undefined) {
    result.userData.preview = structuredClone({
      ...options.preview,
      background: options.preview.background instanceof THREE.Color
        ? options.preview.background.getHex()
        : options.preview.background,
    });
  }
  return result;
}

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const result = new THREE.Box3().setFromObject(object, true);
  if (result.isEmpty()) throw new RangeError("object has no geometry bounds");
  [...result.min.toArray(), ...result.max.toArray()].forEach((n) =>
    finite(n, "bounds")
  );
  return result;
}
function moveWorld<T extends THREE.Object3D>(
  object: T,
  delta: THREE.Vector3,
): T {
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false);
    if (object.parent.matrixWorld.determinant() === 0) {
      throw new RangeError(
        "cannot position an object under a singular parent transform",
      );
    }
    const inverse = object.parent.matrixWorld.clone().invert();
    delta.applyMatrix4(inverse).sub(new THREE.Vector3().applyMatrix4(inverse));
  }
  object.position.add(delta);
  object.updateMatrix();
  object.updateWorldMatrix(false, true);
  return object;
}
/** Move selected world-space bounds centers to zero. Mutates and returns object. */
export function center<T extends THREE.Object3D>(object: T, axes = "xyz"): T {
  if (!/^[xyz]+$/.test(axes)) {
    throw new RangeError("axes must contain x, y, or z");
  }
  const delta = bounds(object).getCenter(new THREE.Vector3()).negate();
  for (const axis of ["x", "y", "z"] as const) {
    if (!axes.includes(axis)) delta[axis] = 0;
  }
  return moveWorld(object, delta);
}
/** Place the lowest world-space bound at y (default zero). */
export function ground<T extends THREE.Object3D>(object: T, y = 0): T {
  return moveWorld(
    object,
    new THREE.Vector3(0, finite(y, "y") - bounds(object).min.y, 0),
  );
}
/** Align matching world-space edges/centers; omitted axes stay in place. */
export function align<T extends THREE.Object3D>(
  object: T,
  target: THREE.Object3D | THREE.Box3,
  axes: Partial<Record<Axis, "min" | "center" | "max">> = {
    x: "center",
    y: "center",
    z: "center",
  },
): T {
  const source = bounds(object);
  const destination = target instanceof THREE.Box3 ? target : bounds(target);
  if (destination.isEmpty()) {
    throw new RangeError("target has no geometry bounds");
  }
  const delta = new THREE.Vector3();
  for (const axis of ["x", "y", "z"] as const) {
    const edge = axes[axis];
    if (edge === undefined) continue;
    if (!["min", "center", "max"].includes(edge)) {
      throw new RangeError("alignment must be min, center, or max");
    }
    delta[axis] = edge === "center"
      ? (destination.min[axis] + destination.max[axis] - source.min[axis] -
        source.max[axis]) / 2
      : destination[edge][axis] - source[edge][axis];
    finite(delta[axis], "alignment");
  }
  return moveWorld(object, delta);
}

function fresh(object: THREE.Object3D, seen: Set<THREE.Object3D>): void {
  if (seen.has(object) || object.parent) {
    throw new Error(
      "repeat factories must return a fresh, unparented object each time",
    );
  }
  seen.add(object);
}
/** Make count fresh objects; step is added to each object's local position times its index. */
export function repeat(
  count: number,
  step: XYZ,
  factory: (index: number) => THREE.Object3D,
): THREE.Group {
  segments(count, "count");
  const offset = vector(step, "step");
  const result = new THREE.Group();
  const seen = new Set<THREE.Object3D>();
  for (let i = 0; i < count; i++) {
    const object = factory(i);
    fresh(object, seen);
    object.position.addScaledVector(offset, i);
    object.updateMatrix();
    result.add(object);
  }
  return result;
}
/** Arrange fresh objects on the XZ plane. Partial sweeps include both endpoints. */
export function radial(
  count: number,
  radius: number,
  factory: (index: number, angleRadians: number) => THREE.Object3D,
  options: RadialOptions = {},
): THREE.Group {
  segments(count, "count");
  positive(radius, "radius", true);
  const sweep = sweepAngle(options.sweep ?? 360);
  const start = THREE.MathUtils.degToRad(
    finite(options.startAngle ?? 0, "startAngle"),
  );
  const result = group([], options);
  const seen = new Set<THREE.Object3D>();
  const divisor = (options.sweep ?? 360) === 360
    ? count
    : Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const angle = start + sweep * i / divisor;
    const object = factory(i, angle);
    fresh(object, seen);
    object.position.add(
      new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
    );
    if (options.orient) {
      object.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -angle,
        ),
      );
    }
    object.updateMatrix();
    result.add(object);
  }
  return result;
}
/** Reflect about the local origin using a negative-scale wrapper; reparents object.
 * Native mesh winding is unchanged. Bake transforms and fix winding for mesh formats that need it.
 */
export function mirror(object: THREE.Object3D, axis: Axis = "x"): THREE.Group {
  if (!["x", "y", "z"].includes(axis)) {
    throw new RangeError("axis must be x, y, or z");
  }
  const result = group([object]);
  result.scale[axis] = -1;
  result.updateMatrix();
  return result;
}
