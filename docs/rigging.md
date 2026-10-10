# Rigging, animation, IK, and secondary motion

The prelude creates ordinary Three.js bones, skins, morph tracks, and animation
clips. Rotations use **degrees**, time uses **seconds**, and Y is up. GLB and
`.blend` exports keep supported skeletons and animations. Bake procedural IK and
spring motion into clips to make them portable.

## Try it

Save this as `output/arm.ts`. It builds a two-bone arm, skins a subdivided
cylinder to it with blended weights at the elbow, and registers a `Wave` clip:

```ts
import { bindSkin, clip, cylinder, material, rig } from "js3";

export default function buildModel() {
  const arm = rig([
    { name: "Upper" },
    { name: "Lower", parent: "Upper", position: [0, 1, 0] },
  ], { name: "arm" });
  bindSkin(
    cylinder(0.1, 2, {
      name: "sleeve",
      heightSegments: 16,
      position: [0, 1, 0],
      material: material("#527d82"),
    }),
    arm,
    {
      weights: ({ position }) => {
        const lower = Math.max(0, Math.min(1, (position[1] - 0.8) / 0.4));
        return { Upper: 1 - lower, Lower: lower };
      },
    },
  );
  clip(arm, "Wave", [{
    target: "Lower",
    property: "rotation",
    keys: [[0, [0, 0, 0]], [1, [0, 0, 90]], [2, [0, 0, 0]]],
  }]);
  return arm;
}
```

```sh
js3 open output/arm.ts
js3 inspect output/arm.ts --json
js3 screenshot output/arm.ts output/arm-wave.png --clip Wave --time 1
js3 frames output/arm.ts output/arm-wave --clip Wave --fps 24
js3 build output/arm.ts output/arm --clip Wave --time 1 --json
js3 export output/arm.ts output/arm.blend
```

The viewer shows clip selection, play/pause, a time slider, speed, and a loop
checkbox when the model has animations. It starts in **Authored pose** and
renders on demand while paused. Selecting Authored pose restores the original
transforms and morph weights. Reloading a model resets playback. `open`
explicitly opens a window; batch commands and `headless` use headless Chromium.

`inspect --json` lists names, durations, and track counts under
`inspection.animations`. `--clip NAME --time SECONDS` selects an exact frame for
inspection, screenshots, builds, or imposters; time defaults to zero and clamps
at the endpoint. It also works with `open` and `headless` for initial placement.
`export` includes all clips and the authored pose. `build` uses the selected
frame for its PNG/report, while its GLB retains the authored pose and all clips.

`frames` requires `--clip`. It writes `frame-00000.png`, subsequent PNGs, and
`manifest.json` with filenames, timestamps, revision, dimensions, clip, and
frame rate. `--start` and `--duration` restrict capture to a window inside the
clip. The default is 24 fps; limits are 240 fps and 3,600 frames per invocation.
The end time is exclusive, like video: 24 frames span one second at times 0
through 23/24. Use `screenshot` for the exact endpoint. No wall clock is
advanced and PNGs contain no toolbar. A source rebuild during capture causes an
error. Use the manifest to enumerate outputs; unrelated or older PNGs are left
alone. The default deadline is 120 seconds; increase `--timeout` for long
captures.

The camera stays fixed during a sequence. Set `preview.target`,
`preview.radius`, and `preview.direction` to include the full motion. `--view`
overrides authored framing. Skin bounds in inspection and manual fitting reflect
the sampled pose.

## Bones and poses

```ts
import { applyPose, boneChain, resetPose, rig } from "js3";

const model = rig([
  { name: "Body", position: [0, 1, 0] },
  { name: "Head", parent: "Body", position: [0, .5, 0] },
  ...boneChain("Tail", [[0, 0, 0], [0, -.2, -.2], [0, -.4, -.3]], {
    parent: "Body",
  }),
], { name: "character" });
applyPose(model, { Head: { rotation: [0, 25, 0] } });
resetPose(model);
```

`rig(definitions, options?)` returns a `Rig`, a Group with `bones[name]` and
`skeleton`. Definitions take `name`, optional `parent`, `position`, degree
`rotation`, and positive `scale`. They may appear in any order. Missing parents,
cycles, and duplicate names fail early. Transforms are parent-local by default;
`{space: "model"}` makes every definition relative to the rig group, before its
group transform. Sheared local transforms are rejected. Options also accept a
group name, position, rotation, and scale.

`boneChain(prefix, points, {parent?})` returns definitions named `prefix_0`,
`prefix_1`, etc. Points are in the chain parent's local frame; the helper turns
successive points into local offsets. Use these definitions with the default
local-space `rig()` mode. The last point is a tip bone.

`applyPose(root, pose)` accepts named objects or bones. For each specified
object, rotation is a local quaternion offset after rest, position is an offset
from rest, and scale multiplies rest scale. Omitted properties of that object
return to rest; objects omitted from the pose stay as they are. Applying a pose
twice gives the same result. `resetPose(root)` restores captured transforms.
Rigs capture rest on creation. Call `captureRestPose(importedScene)` before
posing an imported model; call it again only to intentionally replace that
reference. Bind skin while the bones are at rest.

Names must be unique within a lookup root. `Rig.clone()` copies the skeleton,
rest data, and animation targets, while sharing geometry and materials. Clone
the whole rig so all skin bones are included. Give clips unique names when
composing multiple animated characters.

## Skinning and attachments

```ts
import { bindSkin, box, rig } from "js3";

const arm = rig([
  { name: "Upper" },
  { name: "Lower", parent: "Upper", position: [0, 1, 0] },
]);
const skin = bindSkin(box([.2, 2, .2], { position: [0, 1, 0] }), arm, {
  weights: ({ position }) => {
    const lower = Math.max(0, Math.min(1, (position[1] - .8) / .4));
    return { Upper: 1 - lower, Lower: lower };
  },
});
```

`bindSkin(mesh, rig, options)` clones geometry, shares materials, and returns a
SkinnedMesh. An unparented source is interpreted in rig-local space and added to
the rig. An existing source must be inside the rig subtree; its replacement
keeps its placement and children. The source geometry stays unchanged. Use
sufficiently subdivided geometry around bending joints: weights cannot add
missing vertices.

Choose one weight source:

- `weights: "Head"` for a rigid single-bone binding.
- `weights: { Upper: .4, Lower: .6 }` for constant named weights.
- `weights: [...]` for one weight record per geometry position.
- `weights: ({index, position, localPosition}) => ({...})` for computed weights.
  Position is rig-local; localPosition is geometry-local.
- `envelopes: [{bone: "Upper", end: "Lower", radius: .3, falloff: 2}]` for
  segment-distance falloff. End may be a bone name or rig-local XYZ; omitting it
  creates a spherical envelope. Use `fallbackBone` explicitly if vertices
  outside every envelope should bind there.

Weights must be finite and nonnegative. The strongest four are retained and
normalized per vertex. Unknown bones, unweighted vertices, wrong vertex counts,
and invalid envelopes fail before replacing the mesh. Simple envelopes suit
tubes, tails, and locks; complex characters need authored weights. Skinned
meshes disable frustum culling by default so moving limbs remain visible.

`attachToBone(root, "Hand_L", prop, {space: "local"})` parents a prop to a bone.
Local space is the default: existing local transforms become offsets from the
bone. `{space: "world"}` preserves world placement while reparenting. Cycles and
world attachments requiring shear are rejected. A rigid wig can attach to a
head; flexible hair needs mesh skin weights.

## Clips, sampling, and morphs

```ts
import { clip, sampleAnimation } from "js3";

clip(arm, "Bend", [{
  target: "Lower",
  property: "rotation",
  keys: [[0, [0, 0, 0]], [1, [0, 0, 90]], [2, [0, 0, 0]]],
}]);
sampleAnimation(arm, "Bend", .5);
```

`clip(root, name, tracks, {duration?})` registers and returns an AnimationClip.
A target is an unambiguous name or an object reference inside root. Tracks use
UUID bindings, so nested rigs can repeat bone names. Clip names must be unique
across the composition. The viewer and exporter collect nested clips.

| Property     | Key value      | Convention                                                |
| ------------ | -------------- | --------------------------------------------------------- |
| `rotation`   | `[x, y, z]`    | Degree Euler XYZ offsets from rest, stored as quaternions |
| `position`   | `[x, y, z]`    | Local translation offset from rest                        |
| `scale`      | `[x, y, z]`    | Positive multipliers of rest scale                        |
| `quaternion` | `[x, y, z, w]` | Absolute local rotation, normalized on creation           |
| `morph`      | number         | Absolute influence; also requires `morph: "Smile"`        |

Set `relative: false` for absolute local rotation/position/scale keys. Default
interpolation is `"linear"` (spherical for quaternions); `"step"` is also
available. Times must be finite, nonnegative, and strictly increasing. Duration
defaults to the last key and must include every key. Repeated properties,
missing targets, and invalid morph names fail early. For rotations exceeding
180°, insert intermediate keys to describe the path. Morph tracks animate
existing geometry morph targets; they do not generate facial expressions.

`sampleAnimation(root, nameOrClip, seconds, {loop?})` pauses at an absolute
time. It clamps to the endpoint unless `{loop: true}` wraps it. Seeks in any
order yield the same frame. `resetAnimation(root)` releases this convenience
sampler and restores the original transforms and morph weights.

For an application loop, use `new AnimationPlayer(root)`, then
`play(name?, {loop?, speed?})`, `update(deltaSeconds)`, `pause()`,
`seek(seconds, name?, {loop?})`, `reset()`, and `dispose()`. Its `state`
contains clips, the selected clip, time, duration, playing, loop, and speed.
Speed must be positive. It reads no wall clock. Use one controller per model; do
not run independent mixers and the convenience sampler on the same objects.
Native AnimationMixer and AnimationAction remain available for layering,
crossfades, and additive blending.

The browser API has `animationState()`, `playAnimation(name?, options?)`,
`pauseAnimation()`, `sampleAnimation(name, seconds, options?)`, and
`resetAnimation()`. Export and imposter capture lock the animation while reading
it, then restore playback. `js3 types` emits all signatures, including
`js3/api`, into the portable declaration bundle.

## Humanoid preset and IK

`humanoidRig({height: 1.8, fingers: false, name: "actor"})` creates a T-pose
skeleton facing +Z, with identity neutral bone rotations. Height spans Root to
HeadTip; left is +X. It contains Root, Hips, Spine, Chest, Neck, Head, HeadTip,
and paired Shoulder, UpperArm, Forearm, Hand, HandTip, Thigh, Shin, Foot, and
Toe bones with `_L` / `_R` suffixes. Optional fingers add Thumb0_L through
Thumb3_L, and equivalent Index, Middle, Ring, Pinky, and right-side chains.
These are starting proportions, not an automatic mesh rigger or engine humanoid
mapping.

```ts
solveTwoBoneIK(character, {
  root: "UpperArm_L",
  mid: "Forearm_L",
  tip: "Hand_L",
  target: [.45, 1.3, .4],
  pole: [.7, 1.1, -.3],
});
```

`solveTwoBoneIK(model, options)` solves a direct root → mid → tip chain. Target
and pole are model-local unless `space: "world"` is set. The pole controls
elbow/knee bending; `weight` blends the result from zero to one. The solver
keeps segment lengths, clamps unreachable goals, and returns
`{reached, distance, tip}` with the final tip in world space. Bones and
ancestors must have positive uniform scale. It does not implement whole-body IK,
joint-angle limits, or retargeting. Three.js's CCDIKSolver addon is available
for other chains.

## Hair, tail, and accessory dynamics

```ts
const names = ["Hair_0", "Hair_1", "Hair_2", "Hair_3"];
const spring = springChain(character, names, {
  stiffness: 32,
  damping: 5,
  gravity: [0, -3, 0],
  radius: .01,
  colliders: [{
    type: "sphere",
    object: character.bones.Head,
    center: [0, .035, 0],
    radius: .125,
  }],
});
bakeAnimation(character, "Hair_motion", {
  duration: 3,
  fps: 60,
  targets: ["Head", ...names],
  update(time, delta) {
    applyPose(character, {
      Head: { rotation: [0, Math.sin(time * 3) * 25, 0] },
    });
    if (time === 0) spring.reset();
    spring.update(delta);
  },
});
```

`springChain(root, names, options?)` uses fixed-step Verlet particles, velocity
damping, rest-shape attraction, segment-length constraints, and sphere/capsule
point collisions. Names describe a direct chain; the last bone is a tip. Its
parent may animate. Call `update(deltaSeconds)` after posing the parent.
`reset()` clears velocity and restores the initial chain rotations. Options
include world-space gravity/wind accelerations, stiffness/damping, collision
point radius, `step` (default 1/120 s), and iterations (default 8). Updates
accept 0–1 seconds; split larger intervals into smaller steps. Unstable
combinations of stiffness and step are rejected.

Spheres use `{type: "sphere", center, radius}`; capsules use
`{type: "capsule", start, end, radius}`. Points are world-space unless `object`
supplies a local frame; its scale also scales the collider radius. Bones and
ancestors need positive uniform scale.

This is a lightweight secondary-motion solver for skinned locks, cards, tails,
and accessories. It does not simulate every fiber, self-collide, sweep fast
collisions, or enforce continuous contact along each segment. Use short enough
segments and suitable colliders. It does not automatically skin groom meshes or
deform the density volumes used by hair shadows/AO. Those volumes support rigid
movement; disable volume hair shadows/AO for deforming grooms or supply updated
volumes.

`bakeAnimation(root, name, {duration, fps, targets, update})` calls update in
time order from zero and stores absolute position/quaternion/scale tracks. It
includes the exact endpoint and restores original scene transforms and morph
weights afterward, including on failure. Include every changed object in
targets; morph changes need separate `clip()` tracks. Limits are 10,000 steps
and 240 fps. Dynamics are deterministic for the same initial state, inputs, and
bake rate. Reset/recreate the spring before repeating a bake. Spring motion is
not automatically seamless at loop boundaries; use one-shot playback or simulate
a settling period before baking a periodic cycle.

GLB and `.blend` preserve the resulting keys, skins, and supported morphs. The
TypeScript source retains procedural IK and spring controls; Blender receives
ordinary bones and keyframes, not Blender IK constraints or dynamics modifiers.
OBJ contains no rig or animation.
