# Human head and interchangeable hair grooms

Preview the collection from this checkout:

```sh
js3 open examples/haircuts.ts
js3 open examples/haircuts-profiles.ts
js3 open examples/hair-cartoon.ts
js3 open examples/hair-cartoon-bob.ts
```

The cartoon examples add a sculpted quiff and a layered bob. Their reusable
`hairLock()` prelude helper builds closed, tapered locks with ordinary
exportable materials. See [sculpted hair and visual review](hair-lookdev.md) for
the API, repeatable lighting captures, and a full-strand Cycles comparison
workflow.

`js3 open examples/hair-bun.ts` shows a separate authored updo with a swept,
uneven fringe, curved temple locks, and a folded rear knot. Its wig builder is
`buildMessyBun()` in `examples/haircuts/messy-bun.ts`; the compact knot is built
by `addBunFolds()` in `examples/haircuts/bun-folds.ts`.

This groom uses continuous paths from the hairline into the gather, rounded card
cross-sections, and shared guides for each lock. Short hairs soften the temple
boundary, while finer child curves provide highlights and escaping ends. The
fringe's middle layers overlap, with separation concentrated at its uneven tips.
The bun has a dense crossing interior beneath three folded outer locks. These
choices keep the major shapes coherent while allowing fine variation.

The updo now uses the [editable groom pipeline](grooms.md).
`buildMessyBunGroom()` returns its named guides and layers; the same generated
fibers supply its baked card maps and native strand geometry. High, medium, and
low detail levels share the bake. `examples/hair-bun-lod.ts` demonstrates live
distance switching. `js3 build` saves the editable JSON and baked maps beside
the GLB.

```sh
js3 build examples/hair-bun.ts output/hair-bun --software --timeout 180000
js3 export examples/hair-bun.ts output/hair-bun/model.blend --software --timeout 180000
```

For a close-up, change `STYLE` in `examples/haircut.ts` and run:

```sh
js3 open examples/haircut.ts
js3 screenshot examples/haircut.ts output/haircut-side.png --view right --software
js3 build examples/haircut.ts output/haircut --software
```

| Style ID    | Groom                       |
| ----------- | --------------------------- |
| `bald`      | Fitting reference           |
| `buzz`      | Short stubble               |
| `crop`      | Short layered crop          |
| `side-part` | Asymmetric swept part       |
| `bob`       | Chin-length parted bob      |
| `waves`     | Loose shoulder-length waves |
| `curls`     | Curly crop                  |
| `ponytail`  | Gathered ponytail           |
| `braids`    | Twin three-lock braids      |

The head is a cropped, smoothed derivative of the licensed MakeHuman mesh
already used in this repository, with its skin and eye textures. See
[asset credits](../examples/haircuts/assets/CREDITS.md). It retains the source
mesh's facial topology, including eyelids, lips, nostrils, and ear cartilage.

The older style catalog uses layered alpha-masked hair cards and fine individual
strands. Its procedural atlas contains distinct fibers with variable lengths,
tapered ends, and sparse edges. Each card follows an authored guide; varying its
width, root, length, and depth gives the groom layered coverage. Longitudinal
tangents and fiber normal textures provide directional highlights. Cards and
individual fibers replace the former solid lock meshes.

This is a procedural grooming example, not a reproduction of Expedition 33's
assets or its complete character pipeline. The visual reference is the natural
strand flow and breakup in
[Amandine Marest's Maelle portfolio](https://amarest.artstation.com/projects/zx4K6Q).
These assets have no character rig, automatic fitting, or simulated hair. The
older catalog uses Three.js physical-material anisotropy and has no LOD chain.
The updo and layered fur example use the dedicated hair preview shader and
shared-source detail levels. Guide grooms also compile their complete fiber
density into a volume for directional light attenuation when preview shadows are
enabled. This softens light through sparse edges while blocking it through dense
locks. The preview still lacks multiple scattering between fibers; the
[groom guide](grooms.md) explains the supported approximations and export
fallback.

## Reuse and export

`examples/wig.ts` returns the selected wig without the head:

```sh
js3 build examples/wig.ts output/wig --software
js3 export examples/wig.ts output/wig/model.blend --software --timeout 120000
```

The GLB embeds alpha and normal textures, card geometry, colors and anisotropy.
The Blender export preserves cards as meshes and converts the separate loose
fiber batches to native Hair Curves. The many fibers painted into a card's
texture are not individually editable curves.

`examples/haircuts/catalog.ts` exports `HAIRCUTS`, synchronous
`buildWig(style)`, and asynchronous `buildHaircut(style)`. The head loader
caches the GLB and clones it for each bust. `await buildHaircut(style)` returns
named `base-head` and `wig-<style>` children, so the wig can be replaced
independently.

The fitting coordinate system is Y-up, face toward +Z. The scalp ellipsoid is
centered on `[0, 0.78, 0]`, with radii `[0.472, 0.636, 0.413]`. `scalpPoint()`
corrects this surface using radial samples of the actual head mesh in
`assets/scalp.json`. Keep head and wig under a common parent when transforming
them; a different head needs fitting.

The clipped, curly, and updo examples use many individual fibers. The curly
groom and updo are dense development assets intended for close inspection.
Retain centerlines for offline rendering, or bake/decimate and author LODs for a
game's runtime budget. The report from `js3 inspect` gives exact geometry
counts.

The general-purpose `hairCards()` helper is available from `js3` and in
`js3 types`. See [the card guide](hair-cards.md) for authoring your own paths.
