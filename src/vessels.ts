/** Hollow vessels and curved shells. Y is up; origins are at the bottom center. */
import * as THREE from "three";
import { material, type MeshOptions, transform } from "./primitives.ts";
import { finite, integer, positive } from "./validate.ts";

type Point = readonly [number, number];
function count(n = 48): number {
  return integer(n, 8, Infinity, "segments");
}
function mesh(geometry: THREE.BufferGeometry, o: MeshOptions): THREE.Mesh {
  return transform(new THREE.Mesh(geometry, o.material ?? material()), o);
}
function revolved(
  profile: readonly Point[],
  o: MeshOptions,
  segments = 48,
): THREE.Mesh {
  const points = [...profile, profile[0]].map(([x, y]) =>
    new THREE.Vector2(x, y)
  );
  return mesh(new THREE.LatheGeometry(points, count(segments)), o);
}

export interface BasinOptions extends MeshOptions {
  shape?: "round" | "rectangular";
  radius?: number;
  width?: number;
  depth?: number;
  height?: number;
  wallThickness?: number;
  bottomThickness?: number;
  /** Top radius (or half-width/depth) minus bottom radius. Positive flares outward. */
  taper?: number;
  cornerRadius?: number;
  /** Outward rim extension; rim height adds to total height. Set both to enable a lip. */
  rimWidth?: number;
  rimHeight?: number;
  /** Circular hole through the floor. Zero closes the floor. */
  drainRadius?: number;
  segments?: number;
}

/** Watertight shell with an open top; optional drain is an actual through-hole. */
export function basin(o: BasinOptions = {}): THREE.Mesh {
  const shape = o.shape ?? "round";
  if (shape !== "round" && shape !== "rectangular") {
    throw new RangeError("unknown basin shape");
  }
  const h = positive(o.height ?? .5, "height");
  const w = positive(o.wallThickness ?? .05, "wallThickness");
  const b = positive(o.bottomThickness ?? .05, "bottomThickness");
  const t = finite(o.taper ?? 0, "taper");
  const rw = positive(o.rimWidth ?? 0, "rimWidth", true);
  const rh = positive(o.rimHeight ?? 0, "rimHeight", true);
  if ((rw === 0) !== (rh === 0)) {
    throw new RangeError(
      "rimWidth and rimHeight must both be positive or both zero",
    );
  }
  const drain = positive(o.drainRadius ?? 0, "drainRadius", true);
  const n = count(o.segments);
  const rx = shape === "round"
    ? positive(o.radius ?? .5, "radius")
    : positive(o.width ?? 1, "width") / 2;
  const rz = shape === "round" ? rx : positive(o.depth ?? 1, "depth") / 2;
  const min = Math.min(rx, rz);
  if (b >= h || w >= min - Math.max(t, 0)) {
    throw new RangeError("wall or bottom thickness does not fit basin");
  }
  const floorInset = t * (1 - b / h) + w;
  if (drain >= min - Math.max(floorInset, w)) {
    throw new RangeError("drainRadius must fit inside the floor and opening");
  }
  // Profiles wind from outer floor to top, down the inside, and back under the floor.
  if (shape === "round") {
    const p: Point[] = [[rx - t, 0], [rx, h]];
    if (rw) p.push([rx + rw, h], [rx + rw, h + rh], [rx - w, h + rh]);
    else p.push([rx - w, h]);
    p.push([rx - floorInset, b], [drain, b], [drain, 0]);
    return revolved(p, o, n);
  }
  const cr = positive(
    o.cornerRadius ?? Math.min(.1, min),
    "cornerRadius",
    true,
  );
  if (cr > min) throw new RangeError("cornerRadius must fit the rectangle");
  type Ring = { inset: number; y: number; circle?: number };
  const rings: Ring[] = [{ inset: t, y: 0 }, { inset: 0, y: h }];
  if (rw) {
    rings.push({ inset: -rw, y: h }, { inset: -rw, y: h + rh }, {
      inset: w,
      y: h + rh,
    });
  } else rings.push({ inset: w, y: h });
  rings.push({ inset: floorInset, y: b }, { inset: 0, y: b, circle: drain }, {
    inset: 0,
    y: 0,
    circle: drain,
  });
  const steps = Math.ceil(n / 4);
  const vertices: number[] = [];
  for (const ring of rings) {
    const r = Math.max(0, cr - ring.inset);
    for (let q = 0; q < 4; q++) {
      const cx = (q === 0 || q === 3 ? 1 : -1) * (rx - ring.inset - r);
      const cz = (q < 2 ? 1 : -1) * (rz - ring.inset - r);
      for (let k = 0; k <= steps; k++) {
        const a = (q + k / steps) * Math.PI / 2;
        vertices.push(
          ring.circle === undefined
            ? cx + r * Math.cos(a)
            : ring.circle * Math.cos(a),
          ring.y,
          ring.circle === undefined
            ? cz + r * Math.sin(a)
            : ring.circle * Math.sin(a),
        );
      }
    }
  }
  return mesh(ringSurface(vertices, rings.length, 4 * (steps + 1)), o);
}

/** Connect closed cross-section rings, including the final ring to the first. */
function ringSurface(
  vertices: number[],
  rows: number,
  columns: number,
): THREE.BufferGeometry {
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const a = j * columns + i;
      const b = ((j + 1) % rows) * columns + i;
      const c = ((j + 1) % rows) * columns + (i + 1) % columns;
      const d = j * columns + (i + 1) % columns;
      indices.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export interface BowlOptions extends MeshOptions {
  radius?: number;
  height?: number;
  wallThickness?: number;
  bottomThickness?: number;
  segments?: number;
}
/** Rounded bowl with a small flat foot and a curved hollow interior. */
export function bowl(o: BowlOptions = {}): THREE.Mesh {
  const r = positive(o.radius ?? .5, "radius"),
    h = positive(o.height ?? .35, "height");
  const w = positive(o.wallThickness ?? .04, "wallThickness"),
    b = positive(o.bottomThickness ?? w, "bottomThickness");
  if (w >= r * .3 || b >= h) {
    throw new RangeError("bowl thickness does not fit");
  }
  const p: Point[] = [[0, 0], [r * .3, 0]];
  for (let i = 1; i <= 24; i++) {
    const a = i / 24 * Math.PI / 2;
    p.push([r * (.3 + .7 * Math.sin(a)), h * (1 - Math.cos(a))]);
  }
  for (let i = 24; i >= 0; i--) {
    const a = i / 24 * Math.PI / 2;
    p.push([
      (r - w) * (.3 + .7 * Math.sin(a)),
      b + (h - b) * (1 - Math.cos(a)),
    ]);
  }
  p.push([0, b]);
  return revolved(p, o, o.segments);
}
export interface TrayOptions extends BasinOptions {}
/** Shallow rounded rectangular basin, default 1 x .7 x .12. */
export function tray(o: TrayOptions = {}): THREE.Mesh {
  return basin({
    shape: "rectangular",
    width: 1,
    depth: .7,
    height: .12,
    wallThickness: .025,
    bottomThickness: .025,
    ...o,
  });
}
export interface CupOptions extends BasinOptions {
  handle?: boolean;
  handleRadius?: number;
  handleThickness?: number;
}
/** Cylindrical drinking cup; handle is a separately editable vertical torus. */
export function cup(o: CupOptions = {}): THREE.Group {
  const r = positive(o.radius ?? .35, "radius"),
    h = positive(o.height ?? .6, "height");
  const paint = o.material ?? material();
  const g = new THREE.Group();
  const {
    name: _name,
    position: _position,
    rotation: _rotation,
    scale: _scale,
    ...geometryOptions
  } = o;
  const body = basin({
    wallThickness: .035,
    bottomThickness: .04,
    ...geometryOptions,
    radius: r,
    height: h,
    material: paint,
  });
  body.name = "body";
  g.add(body);
  if (o.handle !== false) {
    const hr = positive(o.handleRadius ?? h * .28, "handleRadius"),
      ht = positive(o.handleThickness ?? .035, "handleThickness");
    if (ht >= hr || 2 * (hr + ht) > h) {
      throw new RangeError("handle must fit cup height");
    }
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(hr, ht, 12, count(o.segments)),
      paint,
    );
    handle.position.set(
      (o.shape === "rectangular" ? (o.width ?? 1) / 2 : r) + hr * .6,
      h / 2,
      0,
    );
    handle.name = "handle";
    g.add(handle);
  }
  return transform(g, o);
}
export interface PlanterOptions extends BasinOptions {}
/** Flared plant pot, default radius .5, height .65, taper .1, and drain radius .04. */
export function planter(o: PlanterOptions = {}): THREE.Mesh {
  return basin({
    height: .65,
    taper: .1,
    drainRadius: .04,
    rimWidth: .035,
    rimHeight: .045,
    ...o,
  });
}
export interface TankOptions extends BasinOptions {
  closed?: boolean;
  lidThickness?: number;
}
/** Large storage tank; closed by default, with a separately editable top lid. */
export function tank(o: TankOptions = {}): THREE.Group {
  const paint = o.material ?? material();
  const h = positive(o.height ?? 2, "height"),
    r = positive(o.radius ?? 1, "radius");
  const {
    name: _name,
    position: _position,
    rotation: _rotation,
    scale: _scale,
    ...geometryOptions
  } = o;
  const body = basin({
    ...geometryOptions,
    height: h,
    radius: r,
    material: paint,
  });
  body.name = "body";
  const g = new THREE.Group();
  g.add(body);
  if (o.closed !== false) {
    const thickness = positive(
      o.lidThickness ?? o.wallThickness ?? .05,
      "lidThickness",
    );
    let geometry: THREE.BufferGeometry;
    if (o.shape === "rectangular") {
      // A solid rounded rectangle extrusion gives the lid its exact requested thickness.
      const shape = roundedRectangle(
        o.width ?? 1,
        o.depth ?? 1,
        o.cornerRadius ?? Math.min(.1, (o.width ?? 1) / 2, (o.depth ?? 1) / 2),
      );
      geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
        curveSegments: 12,
      });
      geometry.rotateX(-Math.PI / 2);
    } else {
      geometry = new THREE.CylinderGeometry(r, r, thickness, count(o.segments));
      geometry.translate(0, thickness / 2, 0);
    }
    const lid = new THREE.Mesh(geometry, paint);
    lid.position.y = h + (o.rimHeight ?? 0);
    lid.name = "lid";
    g.add(lid);
  }
  return transform(g, o);
}
function roundedRectangle(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return s;
}

export interface VaseOptions extends MeshOptions {
  radius?: number;
  height?: number;
  neckRadius?: number;
  wallThickness?: number;
  bottomThickness?: number;
  segments?: number;
}
export interface BottleOptions extends VaseOptions {
  neckHeight?: number;
}
export interface UrnOptions extends VaseOptions {
  footRadius?: number;
}
function hollowProfile(
  outside: Point[],
  w: number,
  b: number,
  o: MeshOptions,
  segments?: number,
): THREE.Mesh {
  if (b >= outside[1][1] || outside.some(([r]) => r <= w)) {
    throw new RangeError(
      "wall or bottom thickness does not fit vessel profile",
    );
  }
  const inside: Point[] = outside.map(([r, y], i) => [r - w, i === 0 ? b : y]);
  return revolved(
    [[0, 0], ...outside, ...inside.reverse(), [0, b]],
    o,
    segments,
  );
}
function vesselDimensions(o: VaseOptions) {
  const r = positive(o.radius ?? .5, "radius"),
    h = positive(o.height ?? 1, "height");
  const neck = positive(o.neckRadius ?? r * .48, "neckRadius");
  const w = positive(o.wallThickness ?? .035, "wallThickness"),
    b = positive(o.bottomThickness ?? .05, "bottomThickness");
  if (neck > r) throw new RangeError("neckRadius must not exceed radius");
  return { r, h, neck, w, b };
}
/** Open-neck vase with a wide belly and flared lip. */
export function vase(o: VaseOptions = {}): THREE.Mesh {
  const { r, h, neck, w, b } = vesselDimensions(o);
  return hollowProfile(
    [[r * .55, 0], [r * .8, h * .18], [r, h * .42], [r * .9, h * .65], [
      neck,
      h * .85,
    ], [neck * 1.1, h]],
    w,
    b,
    o,
    o.segments,
  );
}
/** Hollow bottle with a straight body, sloping shoulder, and open cylindrical neck. */
export function bottle(o: BottleOptions = {}): THREE.Mesh {
  const { r, h, neck, w, b } = vesselDimensions({
    radius: .3,
    height: 1.2,
    neckRadius: .12,
    ...o,
  });
  const nh = positive(o.neckHeight ?? h * .22, "neckHeight");
  if (nh >= h * .65) {
    throw new RangeError("neckHeight must be less than 65% of height");
  }
  return hollowProfile(
    [[r, 0], [r, (h - nh) * .8], [neck, h - nh], [neck, h]],
    w,
    b,
    o,
    o.segments,
  );
}
/** Hollow urn with a narrow foot, rounded angular belly, and flared open mouth. */
export function urn(o: UrnOptions = {}): THREE.Mesh {
  const { r, h, neck, w, b } = vesselDimensions({ height: 1.2, ...o });
  const foot = positive(o.footRadius ?? r * .5, "footRadius");
  if (foot > r) throw new RangeError("footRadius must not exceed radius");
  return hollowProfile(
    [
      [foot, 0],
      [foot, h * .1],
      [r * .65, h * .2],
      [r, h * .5],
      [r * .8, h * .7],
      [neck, h * .85],
      [Math.min(r, neck * 1.4), h],
    ],
    w,
    b,
    o,
    o.segments,
  );
}
export interface PedestalOptions extends MeshOptions {
  radius?: number;
  height?: number;
  shaftRadius?: number;
  baseHeight?: number;
  capHeight?: number;
  segments?: number;
}
/** Turned solid stand with a broad plinth, narrow shaft, and broad display cap. */
export function pedestal(o: PedestalOptions = {}): THREE.Mesh {
  const r = positive(o.radius ?? .5, "radius"),
    h = positive(o.height ?? 1, "height");
  const shaft = positive(o.shaftRadius ?? r * .45, "shaftRadius");
  const base = positive(o.baseHeight ?? h * .12, "baseHeight"),
    cap = positive(o.capHeight ?? h * .1, "capHeight");
  if (shaft > r || 1.5 * (base + cap) >= h) {
    throw new RangeError("pedestal dimensions do not fit");
  }
  return revolved(
    [
      [0, 0],
      [r, 0],
      [r, base],
      [shaft, base * 1.5],
      [shaft, h - cap * 1.5],
      [r, h - cap],
      [r, h],
      [0, h],
    ],
    o,
    o.segments,
  );
}
export interface KnobOptions extends MeshOptions {
  radius?: number;
  height?: number;
  stemRadius?: number;
  stemHeight?: number;
  segments?: number;
}
/** Solid turned knob with a mounting stem and rounded mushroom grip. */
export function knob(o: KnobOptions = {}): THREE.Mesh {
  const r = positive(o.radius ?? .2, "radius"),
    h = positive(o.height ?? .3, "height");
  const stem = positive(o.stemRadius ?? r * .4, "stemRadius"),
    sh = positive(o.stemHeight ?? h * .35, "stemHeight");
  if (stem >= r || sh >= h) throw new RangeError("knob stem must fit grip");
  const p: Point[] = [[0, 0], [stem, 0], [stem, sh], [r * .8, sh]];
  for (let i = 0; i <= 16; i++) {
    const a = i / 16 * Math.PI / 2;
    p.push([r * Math.cos(a), sh + (h - sh) * Math.sin(a)]);
  }
  return revolved(p, o, o.segments);
}
export interface DomeOptions extends MeshOptions {
  radius?: number;
  height?: number;
  /** Omit for a solid dome. Positive thickness produces a hollow shell with open underside. */
  thickness?: number;
  segments?: number;
}
export interface HemisphereOptions extends Omit<DomeOptions, "height"> {}
/** Ellipsoidal cap. Shell thickness uses concentric radius/height offsets. */
export function dome(o: DomeOptions = {}): THREE.Mesh {
  const r = positive(o.radius ?? .5, "radius"),
    h = positive(o.height ?? r * .6, "height");
  const t = positive(o.thickness ?? 0, "thickness", true);
  if (t >= Math.min(r, h)) throw new RangeError("thickness must fit dome");
  const p: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = i / 32 * Math.PI / 2;
    p.push([r * Math.cos(a), h * Math.sin(a)]);
  }
  if (t) {
    for (let i = 32; i >= 0; i--) {
      const a = i / 32 * Math.PI / 2;
      p.push([(r - t) * Math.cos(a), (h - t) * Math.sin(a)]);
    }
  } else p.push([0, 0]);
  return revolved(p, o, o.segments);
}
/** Half-sphere, optionally hollow with an open underside. */
export function hemisphere(o: HemisphereOptions = {}): THREE.Mesh {
  return dome({ ...o, height: o.radius ?? .5 });
}
export interface ConeOptions extends MeshOptions {
  radius?: number;
  height?: number;
  thickness?: number;
  segments?: number;
}
/** Pointed cone. A positive thickness leaves its underside open and a solid tip. */
export function cone(o: ConeOptions = {}): THREE.Mesh {
  const r = positive(o.radius ?? .5, "radius"),
    h = positive(o.height ?? 1, "height"),
    t = positive(o.thickness ?? 0, "thickness", true);
  if (t >= r) throw new RangeError("thickness must be less than radius");
  return revolved(
    t
      ? [[r, 0], [0, h], [0, h * (1 - t / r)], [r - t, 0]]
      : [[0, 0], [r, 0], [0, h]],
    o,
    o.segments,
  );
}
export interface FunnelOptions extends MeshOptions {
  radius?: number;
  height?: number;
  neckRadius?: number;
  neckHeight?: number;
  wallThickness?: number;
  segments?: number;
}
/** Open-mouth conical funnel with an open straight throat; radii measure outer surfaces. */
export function funnel(o: FunnelOptions = {}): THREE.Mesh {
  const r = positive(o.radius ?? .5, "radius"),
    h = positive(o.height ?? .7, "height");
  const neck = positive(o.neckRadius ?? .1, "neckRadius"),
    nh = positive(o.neckHeight ?? h * .3, "neckHeight");
  const t = positive(o.wallThickness ?? .025, "wallThickness");
  if (neck >= r || nh >= h || t >= neck) {
    throw new RangeError("funnel neck and wall must fit");
  }
  return revolved(
    [[neck, 0], [neck, nh], [r, h], [r - t, h], [neck - t, nh], [neck - t, 0]],
    o,
    o.segments,
  );
}
export interface CanopyOptions extends MeshOptions {
  width?: number;
  depth?: number;
  rise?: number;
  thickness?: number;
  segments?: number;
}
/** Barrel-vault canopy: an arched shell spanning X, extruded along Z, open underneath. */
export function canopy(o: CanopyOptions = {}): THREE.Mesh {
  const w = positive(o.width ?? 2, "width"),
    d = positive(o.depth ?? 1.5, "depth"),
    rise = positive(o.rise ?? .5, "rise");
  const t = positive(o.thickness ?? .05, "thickness");
  if (t >= Math.min(rise, w / 2)) {
    throw new RangeError("thickness must fit canopy");
  }
  const n = count(o.segments ?? 32);
  const shape = new THREE.Shape();
  // Parabolic arch with vertical thickness: exact width, rise and thickness.
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + w * i / n, y = rise * (1 - (2 * x / w) ** 2) + t;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const x = -w / 2 + w * i / n;
    shape.lineTo(x, rise * (1 - (2 * x / w) ** 2));
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return mesh(g, o);
}
