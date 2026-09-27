# Modeling compositions

These helpers return fresh, editable Three.js meshes or groups. They accept
`material`, `name`, `position`, degree-based `rotation`, and `scale`. Dimensions
use your chosen unit. Repeated assemblies also accept `preview`, and their
individual parts have stable names for later editing. Unless transformed, the
repeated assemblies stand on Y=0, have width centered along X, and depth
centered along Z. They consist of separate meshes; intersecting parts are not
automatically fused into a single solid.

## Repeated assemblies

```ts
import { fence, grille, louvers, material, railing, shelving } from "js3";

const steel = material({ color: "#434a51", metalness: 0.8 });
const guard = railing({ width: 4, postSpacing: 1, material: steel });
const pickets = fence({ width: 3, slatCount: 10, topProfile: "pointed" });
const vent = grille({ verticalCount: 5, horizontalCount: 2 });
const shutter = louvers({ count: 6, angle: 45 });
const bookcase = shelving({ count: 5, support: "sides" });
```

All counts must be safe integers. Invalid dimensions, negative spacing, parts
that do not fit, and combinations of a count with its corresponding spacing
throw `RangeError`. Counts and clearances are geometric choices, not building
code or structural calculations.

### `railing(options)`

| Option                     | Default          | Meaning                                                      |
| -------------------------- | ---------------- | ------------------------------------------------------------ |
| `width`, `height`, `depth` | `3`, `1`, `0.12` | Total outer dimensions                                       |
| `postWidth`                | `0.1`            | Width of each full-height post                               |
| `postCount`                | Derived          | At least 2, including both end posts                         |
| `postSpacing`              | `1`              | Maximum center-to-center spacing, exclusive with `postCount` |
| `railCount`                | `2`              | `1` for top rail, `2` adds a middle rail                     |
| `railHeight`               | `0.08`           | Vertical rail thickness                                      |
| `railMaterial`             | `material`       | Optional material override for rails                         |

Posts have their outer faces at the two ends of the total width. Intermediate
posts are evenly spaced. The top rail is flush with the total height; the middle
rail is centered at half the height. Rails and posts use the full depth.
Components are named `post_0`, `post_1`, etc., `rail_top`, and `rail_middle`.

### `fence(options)`

| Option                     | Default                          | Meaning                                          |
| -------------------------- | -------------------------------- | ------------------------------------------------ |
| `width`, `height`, `depth` | `3`, `1.5`, `0.12`               | Total outer dimensions                           |
| `slatWidth`, `slatDepth`   | `0.18`, `depth / 2`              | Front picket dimensions                          |
| `slatCount`                | `9`                              | Number of pickets, at least 1                    |
| `slatSpacing`              | Unset                            | Maximum clear gap; replaces the default count    |
| `topProfile`               | `"flat"`                         | `"flat"` or triangular `"pointed"` tips          |
| `tipHeight`                | `min(slatWidth / 2, height / 4)` | Pointed tip height; must not exceed `height / 4` |
| `railHeight`               | `0.1`                            | Backing rail height; less than `height / 4`      |
| `railMaterial`             | `material`                       | Optional backing rail material                   |

Pickets sit toward +Z. Two backing rails use the remaining depth and sit at one
quarter and three quarters of the total height. Clear gaps are equal between
pickets and at both edges. The rails span the full width. `slatDepth` must be
smaller than `depth`. Components are named `slat_0`, `slat_1`, etc., and
`rail_0`, `rail_1`.

### `grille(options)`

| Option                                 | Default         | Meaning                                                               |
| -------------------------------------- | --------------- | --------------------------------------------------------------------- |
| `width`, `height`, `depth`             | `2`, `2`, `0.1` | Total outer dimensions                                                |
| `frameWidth`                           | `0.1`           | Border width on each edge                                             |
| `barWidth`                             | `0.05`          | Width of vertical bars and height of horizontal bars                  |
| `verticalCount`, `horizontalCount`     | `4`, `4`        | Interior bars; either can be zero                                     |
| `verticalSpacing`, `horizontalSpacing` | Unset           | Maximum clear gap in that direction; replaces the corresponding count |
| `barMaterial`                          | `material`      | Optional interior bar material                                        |

Spacing includes clear gaps between the frame and the first/last bars. Interior
bars do not duplicate frame edges. Crossings overlap, and spaces between bars
are genuinely empty. `verticalCount: 0, horizontalCount: 0` gives an empty
frame. Components are named `frame_left`, `frame_right`, `frame_bottom`,
`frame_top`, `vertical_0`, etc., and `horizontal_0`, etc.

### `louvers(options)`

| Option                       | Default         | Meaning                               |
| ---------------------------- | --------------- | ------------------------------------- |
| `width`, `height`, `depth`   | `2`, `2`, `0.3` | Total outer frame dimensions          |
| `frameWidth`                 | `0.1`           | Border width                          |
| `count`                      | `6`             | Number of horizontal slats            |
| `slatThickness`, `slatDepth` | `0.04`, `depth` | Unrotated slat dimensions             |
| `angle`                      | `45`            | X rotation in degrees, from -90 to 90 |
| `slatMaterial`               | `material`      | Optional slat material                |

Slats span the inside width and have equal clear vertical gaps after rotation.
Their rotated depth must fit inside the frame; when changing angle, reducing
`slatDepth` may be necessary. Rotated slats must leave a positive vertical gap.
The frame uses the same names as `grille`; slats use `slat_0`, `slat_1`, etc.

### `shelving(options)`

| Option                     | Default         | Meaning                                           |
| -------------------------- | --------------- | ------------------------------------------------- |
| `width`, `height`, `depth` | `2`, `2`, `0.5` | Total outer dimensions                            |
| `count`                    | `5`             | Number of shelves, at least 1                     |
| `thickness`                | `0.05`          | Shelf thickness                                   |
| `support`                  | `"posts"`       | Four corner `"posts"` or two full-depth `"sides"` |
| `supportWidth`             | `0.06`          | Post width/depth or sidewall thickness            |
| `shelfMaterial`            | `material`      | Optional shelf material                           |

Shelves span between the side supports and use the full depth. The bottom shelf
starts at Y=0, the top shelf ends at `height`, and intermediate shelves have
equal vertical spacing. With `count: 1`, the single shelf is at the bottom.
Supports always span the full height. Components are named `shelf_0`, etc., and
either `post_0_0`, `post_0_1`, `post_1_0`, `post_1_1`, or `side_left`,
`side_right`.

## Paths and profiles

These helpers return meshes and accept `material`, `name`, `position`, degree
`rotation`, and `scale`. Hollow shapes have actual inner walls and annular end
faces: their ends remain open through the bore.

```ts
import {
  elbow,
  gutter,
  handrail,
  hose,
  molding,
  pipe,
  sweepProfile,
} from "js3";

const drain = pipe({ radius: 0.12, wallThickness: 0.02, length: 1 });
const bend = elbow({ radius: 0.12, bendRadius: 0.4, angle: 90 });
const flexible = hose([[0, 0, 0], [0, 1, 0], [1, 1.5, 0]], { radius: 0.1 });
const trough = gutter({ width: 0.4, height: 0.2, length: 3 });
const rail = handrail([[0, 0, 0], [0, 1, 0], [2, 2, 0]]);
const trim = molding(
  [[0, 0], [0.2, 0], [0.2, 0.05], [0.1, 0.05], [0.1, 0.15], [0, 0.15]],
  [[0, 0, 0], [0, 2, 0]],
);
```

| Helper                                 | Options and defaults                                                                       | Geometry and origin                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `pipe(options)`                        | `radius: 0.15`, `wallThickness: 0.025`, `length: 1`, `radialSegments: 32`                  | Straight hollow pipe along +Y, bottom at Y=0                                         |
| `elbow(options)`                       | `radius: 0.1`, `wallThickness: 0.02`, `bendRadius: 0.4`, `angle: 90`, `radialSegments: 24` | Hollow circular bend in XY, beginning at `[bendRadius, 0, 0]` and sweeping toward +Y |
| `hose(path, options)`                  | `radius: 0.1`, `wallThickness: 0.02`, `radialSegments: 24`                                 | Hollow circular section swept along the path                                         |
| `handrail(path, options)`              | `radius: 0.04`, `radialSegments: 20`                                                       | Solid circular section with closed end caps                                          |
| `gutter(options)`                      | `width: 0.3`, `height: 0.2`, `length: 2`, `wallThickness: 0.02`                            | Open U trough along Z, centered in X/Z, bottom at Y=0                                |
| `sweepProfile(profile, path, options)` | `steps: 64`, `curveSegments: 24`                                                           | Closed arbitrary profile, including `THREE.Shape` holes, with end caps               |
| `molding(profile, path, options)`      | Same sweep options                                                                         | Decorative trim using the supplied cross-section                                     |

`hose`, `handrail`, `elbow`, and `molding` also accept the sweep options. Paths
accept a native `THREE.Curve<THREE.Vector3>` or an array of XYZ points. Two
points make a straight path; three or more use smooth centripetal Catmull–Rom
interpolation. Supply a native curve for precise control. Profiles accept a
`THREE.Shape` or at least three 2D points enclosing a nonzero area. Profile
coordinates follow the curve's Frenet normal/binormal frame.

`wallThickness` must be smaller than the pipe radius. An elbow's `bendRadius`
must exceed its outer pipe radius, and its angle must lie strictly between 0 and
360 degrees. Radial segments must be integers at least 3; sweep steps and curve
segments must be positive integers. Paths need positive length and finite
points; consecutive points must differ. Keep swept sections small enough to
avoid self-intersections on tight bends: this is a geometric sweep, with no
automatic union or intersection repair.

## Frames and recessed faces

Frames are editable groups of named parts. They stand in the XY plane, centered
in X/Z, with their outer bottom at Y=0. The front is +Z. Common options are
`openingWidth: 1`, `openingHeight: 1.5`, `thickness: 0.1` (border width), and
`depth: 0.1`, plus the standard material and transform options.

| Helper                   | Additional options                               | Behavior                                                                   |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `frame(options)`         | None                                             | Four bars surrounding an empty rectangular opening                         |
| `doorframe(options)`     | None                                             | Two jambs and lintel; opening reaches Y=0                                  |
| `windowFrame(options)`   | `mullions: 0`, `transoms: 0`                     | Evenly spaced vertical/horizontal interior bars, counted separately        |
| `pictureFrame(options)`  | `backing: false`, `backingThickness: depth / 4`  | Optional backing flush with the rear face                                  |
| `recessedPanel(options)` | `recess: depth / 2`, `panelThickness: depth / 4` | Solid inset panel; recess measures from the frame front to the panel front |

```ts
import { doorframe, pictureFrame, recessedPanel, windowFrame } from "js3";

const doorway = doorframe({ openingWidth: 0.9, openingHeight: 2.1 });
const window = windowFrame({ openingWidth: 1.4, mullions: 1, transoms: 1 });
const picture = pictureFrame({ backing: true });
const cabinet = recessedPanel({
  depth: 0.12,
  recess: 0.05,
  panelThickness: 0.03,
});
```

Frame parts are named `left`, `right`, `top`, and (except doors) `bottom`.
Additional parts are named `mullion-1`, `transom-1`, etc., `backing`, or
`panel`. Divider counts must be nonnegative integers and leave positive
openings. Backing thickness must fit the frame depth; `recess + panelThickness`
must also fit. Intersecting divider bars remain separate meshes.

## Connectors and supports

These helpers return individual meshes with the standard material and transform
options. Dimensions must be positive and finite; impossible fits throw
`RangeError`.

| Helper                             | Options and defaults                                                                                                                                             | Geometry and origin                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `beamBetween(start, end, options)` | `width: 0.1`, `depth: 0.1`; optional `radius`, `radialSegments: 24`                                                                                              | Rectangular beam between distinct XYZ endpoints; supplying `radius` selects a round beam. Transform options apply after endpoint positioning |
| `bracket(options)`                 | `width: 0.5`, `height: 0.5`, `depth: 0.15`, `thickness: 0.05`                                                                                                    | Solid L in XY from `[0, 0]`, centered along Z                                                                                                |
| `flange(options)`                  | `radius: 0.3`, `innerRadius: 0.12`, `thickness: 0.04`, `boltCount: 4`, `boltRadius: 0.025`, `boltCircleRadius: (radius + innerRadius) / 2`, `radialSegments: 48` | Horizontal annular plate with actual bolt holes; bottom at Y=0                                                                               |
| `gusset(options)`                  | `width: 0.5`, `height: 0.5`, `depth: 0.05`                                                                                                                       | Right triangular prism in XY from `[0, 0]`, centered along Z                                                                                 |

```ts
import { beamBetween, bracket, flange, gusset } from "js3";

const brace = beamBetween([0, 0, 0], [1, 2, 0], { width: 0.15, depth: 0.1 });
const support = bracket({ width: 0.4, height: 0.6, thickness: 0.05 });
const mount = flange({ radius: 0.4, innerRadius: 0.15, boltCount: 6 });
const stiffener = gusset({ width: 0.3, height: 0.5, depth: 0.04 });
```

Set `flange({ innerRadius: 0 })` for a closed central plate, or `boltCount: 0`
for no bolt holes. Bolt holes must lie entirely within the plate and must not
touch each other or either annular boundary. Bracket thickness must be smaller
than both leg dimensions.

## Gallery

[The shape gallery](../examples/shapes.ts) lays out every new shape helper in
named display tiles, including both basin variants. Each tile scales its model
uniformly to fit, so displayed size does not indicate the helper's default size.

```sh
js3 build examples/shapes.ts output/shapes --json
```

## Hollow containers

These shapes have actual inside surfaces, outside surfaces, and floor thickness.
Their open tops are empty space. Unless transformed, the origin is the bottom
center and Y is up. `basin`, `bowl`, `tray`, and `planter` return meshes. `cup`
and `tank` return groups with named editable parts. Every helper accepts the
standard material and transform options.

### `basin(options)`

| Option                             | Default                          | Meaning                                                                                |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `shape`                            | `"round"`                        | `"round"` or `"rectangular"`                                                           |
| `radius`                           | `0.5`                            | Round basin outer radius at its top                                                    |
| `width`, `depth`                   | `1`, `1`                         | Rectangular basin outer dimensions at its top                                          |
| `height`                           | `0.5`                            | Floor underside to wall top, excluding optional lip                                    |
| `wallThickness`, `bottomThickness` | `0.05`, `0.05`                   | Horizontal wall thickness and vertical floor thickness                                 |
| `taper`                            | `0`                              | Top radius/half-extent minus bottom radius/half-extent; positive widens toward the top |
| `cornerRadius`                     | `min(0.1, width / 2, depth / 2)` | Rectangular outer top corner radius                                                    |
| `rimWidth`, `rimHeight`            | `0`, `0`                         | Outward lip extension and extra height; both must be positive to enable a lip          |
| `drainRadius`                      | `0`                              | Actual circular hole through the floor; zero closes it                                 |
| `segments`                         | `48`                             | Circumference detail, integer at least 8                                               |

Walls, floor, and drain must fit within the basin. A rectangular basin can have
rounded corners, tapered sides, and a circular drain together. Its segment count
is rounded upward to a multiple of four, with extra straight-edge endpoints.
Thicknesses measure along the horizontal/vertical axes, not normal to tapered
walls.

```ts
import { basin, cup, planter, tank, tray } from "js3";

const sink = basin({
  shape: "rectangular",
  width: 1.2,
  depth: 0.8,
  height: 0.4,
  cornerRadius: 0.15,
  taper: 0.08,
  drainRadius: 0.04,
  rimWidth: 0.03,
  rimHeight: 0.02,
});
const servingTray = tray({ width: 1.5, depth: 0.9 });
const mug = cup({ handle: true });
const flowerpot = planter({ drainRadius: 0.05 });
const openStorage = tank({ shape: "rectangular", closed: false });
```

| Helper             | Defaults and distinctions                                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bowl(options)`    | Curved round bowl: `radius: 0.5`, `height: 0.35`, `wallThickness: 0.04`, `bottomThickness: wallThickness`, `segments: 48`. A small flat foot supports the rounded body.                                                                                              |
| `tray(options)`    | Basin options, defaulting to rectangular `width: 1`, `depth: 0.7`, `height: 0.12`, `wallThickness: 0.025`, `bottomThickness: 0.025`.                                                                                                                                 |
| `cup(options)`     | Basin options, default `radius: 0.35`, `height: 0.6`, `wallThickness: 0.035`, `bottomThickness: 0.04`. `handle: true`, `handleRadius: height * 0.28`, `handleThickness: 0.035`. Parts are `body` and optional `handle`; the vertical torus handle extends toward +X. |
| `planter(options)` | Basin options, default `height: 0.65`, `taper: 0.1`, `drainRadius: 0.04`, `rimWidth: 0.035`, `rimHeight: 0.045`. Set `drainRadius: 0` for a sealed pot, or both rim dimensions to zero to omit the lip.                                                              |
| `tank(options)`    | Basin options, default `radius: 1`, `height: 2`, `closed: true`, `lidThickness: wallThickness`. Parts are `body` and optional `lid`. The lid adds its thickness above wall/lip height; `closed: false` leaves the top open.                                          |

## Revolved vessels and turned solids

All these helpers return individual meshes, with bottom-centered origins and
`segments: 48` by default. Vase, bottle, and urn are hollow with open necks and
closed floors. Their `wallThickness` is a radial offset, and their outer
profiles use straight segments between shaping stations.

| Helper              | Options and defaults                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vase(options)`     | `radius: 0.5`, `height: 1`, `neckRadius: radius * 0.48`, `wallThickness: 0.035`, `bottomThickness: 0.05`. Wide belly and flared lip; the lip radius is `neckRadius * 1.1`.                    |
| `bottle(options)`   | Vase options with `radius: 0.3`, `height: 1.2`, `neckRadius: 0.12`, and `neckHeight: height * 0.22`. Straight body, shoulder, and straight open neck.                                         |
| `urn(options)`      | Vase options with `height: 1.2` and `footRadius: radius * 0.5`. Narrow foot, broad belly, and flared mouth.                                                                                   |
| `pedestal(options)` | Solid stand: `radius: 0.5`, `height: 1`, `shaftRadius: radius * 0.45`, `baseHeight: height * 0.12`, `capHeight: height * 0.1`. Base and cap connect to the shaft through tapered transitions. |
| `knob(options)`     | Solid mushroom grip: `radius: 0.2`, `height: 0.3`, `stemRadius: radius * 0.4`, `stemHeight: height * 0.35`. Stem starts at the bottom center.                                                 |

Necks, feet, stems, and wall thicknesses must fit within their bodies. Bottle
neck height must be less than 65% of total height. Pedestal base/cap dimensions
must leave room for their transitions and the shaft.

## Caps and curved shells

These helpers return meshes with bottom-centered origins. For `dome`,
`hemisphere`, and `cone`, omitting `thickness` (or setting it to zero) makes a
solid shape with a closed bottom. Positive `thickness` creates a shell with an
open underside. The funnel always has an open mouth and throat; the canopy
always has clear space underneath.

| Helper                | Options and defaults                                                                                                | Shape                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `dome(options)`       | `radius: 0.5`, `height: radius * 0.6`, `thickness: 0`, `segments: 48`                                               | Ellipsoidal cap; a shell subtracts thickness from both inner radius and height        |
| `hemisphere(options)` | `radius: 0.5`, `thickness: 0`, `segments: 48`                                                                       | Half sphere; height equals radius                                                     |
| `cone(options)`       | `radius: 0.5`, `height: 1`, `thickness: 0`, `segments: 48`                                                          | Pointed cone; shell thickness is radial at the base, with a solid tip                 |
| `funnel(options)`     | `radius: 0.5`, `height: 0.7`, `neckRadius: 0.1`, `neckHeight: height * 0.3`, `wallThickness: 0.025`, `segments: 48` | Conical mouth above a straight open throat; radii measure outer surfaces              |
| `canopy(options)`     | `width: 2`, `depth: 1.5`, `rise: 0.5`, `thickness: 0.05`, `segments: 32`                                            | Parabolic barrel vault across X, extruded along Z; total height is `rise + thickness` |

```ts
import { canopy, dome, funnel, hemisphere } from "js3";

const roof = dome({ radius: 2, height: 1, thickness: 0.08 });
const lampshade = hemisphere({ radius: 0.4, thickness: 0.02 });
const hopper = funnel({ radius: 0.8, height: 1, neckRadius: 0.15 });
const shelter = canopy({ width: 4, depth: 3, rise: 1, thickness: 0.08 });
```
