/** Hollow paths, frames, and structural parts. Dimensions use Y-up coordinates. */
import * as THREE from "three";
import {
  box,
  group,
  material,
  type MeshOptions,
  transform,
  type XYZ,
} from "./primitives.ts";
import { integer, positive, vector } from "./validate.ts";

export type Profile = THREE.Shape | readonly (readonly [number, number])[];
export type SweepPath = THREE.Curve<THREE.Vector3> | readonly XYZ[];
export interface SweepProfileOptions extends MeshOptions {
  steps?: number;
  curveSegments?: number;
}
export interface PipeOptions extends MeshOptions {
  radius?: number;
  wallThickness?: number;
  length?: number;
  radialSegments?: number;
}
export interface HoseOptions extends SweepProfileOptions {
  radius?: number;
  wallThickness?: number;
  radialSegments?: number;
}
export interface ElbowOptions extends HoseOptions {
  bendRadius?: number;
  /** Bend in the XY plane, starting at [bendRadius, 0, 0], in degrees. */
  angle?: number;
}
export interface HandrailOptions extends SweepProfileOptions {
  radius?: number;
  radialSegments?: number;
}
export interface GutterOptions extends MeshOptions {
  width?: number;
  height?: number;
  length?: number;
  wallThickness?: number;
}
export interface FrameOptions extends MeshOptions {
  openingWidth?: number;
  openingHeight?: number;
  thickness?: number;
  depth?: number;
}
export interface WindowFrameOptions extends FrameOptions {
  /** Number of evenly spaced vertical bars. */
  mullions?: number;
  /** Number of evenly spaced horizontal bars. */
  transoms?: number;
}
export interface PictureFrameOptions extends FrameOptions {
  backing?: boolean;
  backingThickness?: number;
}
export interface RecessedPanelOptions extends FrameOptions {
  /** Distance between the frame's front and the panel's front. */
  recess?: number;
  panelThickness?: number;
}
export interface BeamBetweenOptions extends MeshOptions {
  width?: number;
  depth?: number;
  /** Providing radius selects a round beam instead of a rectangular one. */
  radius?: number;
  radialSegments?: number;
}
export interface BracketOptions extends MeshOptions {
  width?: number;
  height?: number;
  depth?: number;
  thickness?: number;
}
export interface FlangeOptions extends MeshOptions {
  radius?: number;
  innerRadius?: number;
  thickness?: number;
  boltCount?: number;
  boltRadius?: number;
  boltCircleRadius?: number;
  radialSegments?: number;
}
export interface GussetOptions extends MeshOptions {
  width?: number;
  height?: number;
  depth?: number;
}
function mesh(
  geometry: THREE.BufferGeometry,
  options: MeshOptions,
): THREE.Mesh {
  return transform(
    new THREE.Mesh(geometry, options.material ?? material()),
    options,
  );
}
function pathCurve(path: SweepPath): THREE.Curve<THREE.Vector3> {
  if (path instanceof THREE.Curve) {
    const points = path.getPoints(32);
    if (
      points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite)) ||
      !(path.getLength() > 0)
    ) throw new RangeError("path must be finite with positive length");
    return path;
  }
  if (path.length < 2) throw new RangeError("path needs at least two points");
  const points = path.map((p) => vector(p, "path point"));
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceToSquared(points[i - 1]) === 0) {
      throw new RangeError("consecutive path points must differ");
    }
  }
  return points.length === 2
    ? new THREE.LineCurve3(points[0], points[1])
    : new THREE.CatmullRomCurve3(points);
}
function profileShape(profile: Profile): THREE.Shape {
  if (profile instanceof THREE.Shape) {
    const { shape, holes } = profile.extractPoints(12);
    if (
      shape.length < 3 || [...shape, ...holes.flat()].some((p) =>
        !Number.isFinite(p.x) || !Number.isFinite(p.y)
      ) || Math.abs(THREE.ShapeUtils.area(shape)) < 1e-12
    ) {
      throw new RangeError("profile must have a finite nonzero area");
    }
    return profile;
  }
  if (
    profile.length < 3 ||
    profile.some((p) => p.length !== 2 || !p.every(Number.isFinite))
  ) throw new RangeError("profile needs at least three finite 2D points");
  const points = profile.map((p) => new THREE.Vector2(...p));
  if (Math.abs(THREE.ShapeUtils.area(points)) < 1e-12) {
    throw new RangeError("profile must have nonzero area");
  }
  return new THREE.Shape(points);
}
function circle(
  radius: number,
  segments: number,
  x = 0,
  y = 0,
): THREE.Vector2[] {
  return Array.from(
    { length: segments },
    (_, i) =>
      new THREE.Vector2(
        x + radius * Math.cos(i * Math.PI * 2 / segments),
        y + radius * Math.sin(i * Math.PI * 2 / segments),
      ),
  );
}
function ring(
  radius: number,
  thickness: number,
  segments: number,
): THREE.Shape {
  positive(radius, "radius");
  positive(thickness, "wallThickness");
  if (thickness >= radius) {
    throw new RangeError("wallThickness must be smaller than radius");
  }
  const shape = new THREE.Shape(circle(radius, segments));
  shape.holes.push(
    new THREE.Path(circle(radius - thickness, segments).reverse()),
  );
  return shape;
}
/** Sweep a closed cross-section along a path, including end caps and any Shape holes.
 * Profile coordinates follow Three.js Frenet normal/binormal frames. Point paths
 * with more than two points use smooth centripetal Catmull–Rom interpolation.
 */
export function sweepProfile(
  profile: Profile,
  path: SweepPath,
  options: SweepProfileOptions = {},
): THREE.Mesh {
  const shape = profileShape(profile);
  return mesh(
    new THREE.ExtrudeGeometry(shape, {
      extrudePath: pathCurve(path),
      steps: integer(options.steps ?? 64, 1, Infinity, "steps"),
      curveSegments: integer(
        options.curveSegments ?? 24,
        1,
        Infinity,
        "curveSegments",
      ),
      bevelEnabled: false,
    }),
    options,
  );
}
/** Decorative solid molding swept from a caller-provided cross-section. */
export function molding(
  profile: Profile,
  path: SweepPath,
  options: SweepProfileOptions = {},
): THREE.Mesh {
  return sweepProfile(profile, path, options);
}
/** Open-ended hollow pipe on Y, with its bottom at Y=0. */
export function pipe(options: PipeOptions = {}): THREE.Mesh {
  const shape = ring(
    options.radius ?? 0.15,
    options.wallThickness ?? 0.025,
    integer(options.radialSegments ?? 32, 3, Infinity, "radialSegments"),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: positive(options.length ?? 1, "length"),
    bevelEnabled: false,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  return mesh(geometry, options);
}
/** Hollow hose: the annular end caps leave the interior bore open. */
export function hose(path: SweepPath, options: HoseOptions = {}): THREE.Mesh {
  return sweepProfile(
    ring(
      options.radius ?? 0.1,
      options.wallThickness ?? 0.02,
      integer(options.radialSegments ?? 24, 3, Infinity, "radialSegments"),
    ),
    path,
    options,
  );
}
/** Hollow circular pipe bend in XY; neither endpoint is plugged. */
export function elbow(options: ElbowOptions = {}): THREE.Mesh {
  const radius = positive(options.radius ?? 0.1, "radius");
  const bend = positive(options.bendRadius ?? 0.4, "bendRadius");
  const angle = positive(options.angle ?? 90, "angle");
  if (angle >= 360 || bend <= radius) {
    throw new RangeError(
      "angle must be < 360 and bendRadius must exceed radius",
    );
  }
  class Arc extends THREE.Curve<THREE.Vector3> {
    constructor() {
      super();
    }
    override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
      const a = t * THREE.MathUtils.degToRad(angle);
      return target.set(bend * Math.cos(a), bend * Math.sin(a), 0);
    }
  }
  return hose(new Arc(), { ...options, radius });
}
/** Solid round rail along a path, with capped ends. */
export function handrail(
  path: SweepPath,
  options: HandrailOptions = {},
): THREE.Mesh {
  return sweepProfile(
    new THREE.Shape(
      circle(
        positive(options.radius ?? 0.04, "radius"),
        integer(options.radialSegments ?? 20, 3, Infinity, "radialSegments"),
      ),
    ),
    path,
    options,
  );
}
/** U-shaped open trough, centered in X/Z, bottom at Y=0; ends remain open. */
export function gutter(options: GutterOptions = {}): THREE.Mesh {
  const w = positive(options.width ?? 0.3, "width"),
    h = positive(options.height ?? 0.2, "height"),
    l = positive(options.length ?? 2, "length"),
    t = positive(options.wallThickness ?? 0.02, "wallThickness");
  if (2 * t >= w || t >= h) {
    throw new RangeError("wallThickness must leave an open gutter");
  }
  const shape = profileShape([
    [-w / 2, 0],
    [w / 2, 0],
    [w / 2, h],
    [w / 2 - t, h],
    [w / 2 - t, t],
    [-w / 2 + t, t],
    [-w / 2 + t, h],
    [-w / 2, h],
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: l,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -l / 2);
  return mesh(geometry, options);
}
function frameDimensions(options: FrameOptions) {
  return {
    w: positive(options.openingWidth ?? 1, "openingWidth"),
    h: positive(options.openingHeight ?? 1.5, "openingHeight"),
    t: positive(options.thickness ?? 0.1, "thickness"),
    d: positive(options.depth ?? 0.1, "depth"),
  };
}
function frameParts(options: FrameOptions, bottom: boolean): THREE.Group {
  const { w, h, t, d } = frameDimensions(options);
  const paint = options.material ?? material();
  const parts = [
    box([t, h + (bottom ? 2 : 1) * t, d], {
      material: paint,
      name: "left",
      position: [-(w + t) / 2, (h + (bottom ? 2 : 1) * t) / 2, 0],
    }),
    box([t, h + (bottom ? 2 : 1) * t, d], {
      material: paint,
      name: "right",
      position: [(w + t) / 2, (h + (bottom ? 2 : 1) * t) / 2, 0],
    }),
    box([w, t, d], {
      material: paint,
      name: "top",
      position: [0, h + (bottom ? 1.5 : 0.5) * t, 0],
    }),
  ];
  if (bottom) {
    parts.push(
      box([w, t, d], {
        material: paint,
        name: "bottom",
        position: [0, t / 2, 0],
      }),
    );
  }
  return group(parts, options);
}
/** Empty rectangular frame in XY, centered in X/Z with outer bottom at Y=0. */
export function frame(options: FrameOptions = {}): THREE.Group {
  return frameParts(options, true);
}
/** Door jambs and lintel; the opening meets the floor, without a bottom bar. */
export function doorframe(options: FrameOptions = {}): THREE.Group {
  return frameParts(options, false);
}
/** Window surround with optional evenly spaced vertical/horizontal dividers. */
export function windowFrame(options: WindowFrameOptions = {}): THREE.Group {
  const { w, h, t, d } = frameDimensions(options);
  const n = integer(options.mullions ?? 0, 0, Infinity, "mullions"),
    m = integer(options.transoms ?? 0, 0, Infinity, "transoms");
  if (n * t >= w || m * t >= h) {
    throw new RangeError("dividers must leave positive openings");
  }
  const paint = options.material ?? material();
  const result = frame({ ...options, material: paint });
  for (let i = 0; i < n; i++) {
    result.add(
      box([t, h, d], {
        material: paint,
        name: `mullion-${i + 1}`,
        position: [-w / 2 + (i + 1) * (w + t) / (n + 1) - t / 2, t + h / 2, 0],
      }),
    );
  }
  for (let i = 0; i < m; i++) {
    result.add(
      box([w, t, d], {
        material: paint,
        name: `transom-${i + 1}`,
        position: [0, t + (i + 1) * (h + t) / (m + 1) - t / 2, 0],
      }),
    );
  }
  return result;
}
/** Picture surround, optionally closed by a backing flush with its rear (-Z). */
export function pictureFrame(options: PictureFrameOptions = {}): THREE.Group {
  const { w, h, t, d } = frameDimensions(options);
  const b = positive(options.backingThickness ?? d / 4, "backingThickness");
  if (b > d) throw new RangeError("backingThickness must fit depth");
  const paint = options.material ?? material();
  const result = frame({ ...options, material: paint });
  if (options.backing ?? false) {
    result.add(
      box([w, h, b], {
        material: paint,
        name: "backing",
        position: [0, t + h / 2, -d / 2 + b / 2],
      }),
    );
  }
  return result;
}
/** A framed panel whose face is recessed from the surround's +Z front. */
export function recessedPanel(options: RecessedPanelOptions = {}): THREE.Group {
  const { w, h, t, d } = frameDimensions(options);
  const r = positive(options.recess ?? d / 2, "recess", true),
    p = positive(options.panelThickness ?? d / 4, "panelThickness");
  if (r + p > d) throw new RangeError("recess + panelThickness must fit depth");
  const paint = options.material ?? material();
  const result = frame({ ...options, material: paint });
  result.add(
    box([w, h, p], {
      name: "panel",
      material: paint,
      position: [0, t + h / 2, d / 2 - r - p / 2],
    }),
  );
  return result;
}
/** Beam with cross-section perpendicular to two local endpoints. Transform options apply afterward. */
export function beamBetween(
  start: XYZ,
  end: XYZ,
  options: BeamBetweenOptions = {},
): THREE.Mesh {
  const a = vector(start, "start"),
    b = vector(end, "end"),
    delta = b.clone().sub(a),
    length = positive(delta.length(), "endpoint distance");
  const geometry = options.radius === undefined
    ? new THREE.BoxGeometry(
      positive(options.width ?? 0.1, "width"),
      length,
      positive(options.depth ?? 0.1, "depth"),
    )
    : new THREE.CylinderGeometry(
      positive(options.radius, "radius"),
      options.radius,
      length,
      integer(options.radialSegments ?? 24, 3, Infinity, "radialSegments"),
    );
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    ),
  );
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return mesh(geometry, options);
}
/** Solid L bracket in XY, from [0,0], with centered Z depth. */
export function bracket(options: BracketOptions = {}): THREE.Mesh {
  const w = positive(options.width ?? 0.5, "width"),
    h = positive(options.height ?? 0.5, "height"),
    d = positive(options.depth ?? 0.15, "depth"),
    t = positive(options.thickness ?? 0.05, "thickness");
  if (t >= Math.min(w, h)) {
    throw new RangeError("thickness must fit both bracket legs");
  }
  const geometry = new THREE.ExtrudeGeometry(
    profileShape([[0, 0], [w, 0], [w, t], [t, t], [t, h], [0, h]]),
    { depth: d, bevelEnabled: false },
  );
  geometry.translate(0, 0, -d / 2);
  return mesh(geometry, options);
}
/** Horizontal annular flange with real bolt holes, bottom at Y=0. */
export function flange(options: FlangeOptions = {}): THREE.Mesh {
  const r = positive(options.radius ?? 0.3, "radius"),
    inner = positive(options.innerRadius ?? 0.12, "innerRadius", true),
    thickness = positive(options.thickness ?? 0.04, "thickness"),
    n = integer(options.boltCount ?? 4, 0, Infinity, "boltCount"),
    s = integer(options.radialSegments ?? 48, 3, Infinity, "radialSegments");
  if (inner >= r) {
    throw new RangeError("innerRadius must be smaller than radius");
  }
  const br = positive(options.boltRadius ?? 0.025, "boltRadius"),
    bc = positive(
      options.boltCircleRadius ?? (r + inner) / 2,
      "boltCircleRadius",
    );
  if (
    n > 0 &&
    (bc - br <= inner || bc + br >= r ||
      (n > 1 && br >= bc * Math.sin(Math.PI / n)))
  ) {
    throw new RangeError(
      "bolt holes must fit flange without touching each other or its boundaries",
    );
  }
  const shape = new THREE.Shape(circle(r, s));
  if (inner > 0) shape.holes.push(new THREE.Path(circle(inner, s).reverse()));
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n;
    shape.holes.push(
      new THREE.Path(
        circle(
          br,
          Math.max(12, Math.floor(s / 2)),
          bc * Math.cos(a),
          bc * Math.sin(a),
        ).reverse(),
      ),
    );
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  return mesh(geometry, options);
}
/** Right triangular support in XY, from [0,0], with centered Z depth. */
export function gusset(options: GussetOptions = {}): THREE.Mesh {
  const w = positive(options.width ?? 0.5, "width"),
    h = positive(options.height ?? 0.5, "height"),
    d = positive(options.depth ?? 0.05, "depth");
  const geometry = new THREE.ExtrudeGeometry(
    profileShape([[0, 0], [w, 0], [0, h]]),
    { depth: d, bevelEnabled: false },
  );
  geometry.translate(0, 0, -d / 2);
  return mesh(geometry, options);
}
