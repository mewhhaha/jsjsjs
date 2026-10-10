import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import {
  type BakedGroomCards,
  bakeGroomCards,
} from "../src/hair/groom-cards.ts";
import {
  type GeneratedGroom,
  generateGroomStrands,
  type GroomFiber,
  type GuideGroom,
} from "../src/hair/groom-data.ts";
import { hairCards, hairCardTextures } from "../src/hair/hair-cards.ts";
import { compileGroom, renderGroom } from "../src/hair/groom.ts";

function fixture(): GeneratedGroom {
  return {
    version: 1,
    seed: 19,
    source: {
      version: 1,
      seed: 19,
      layers: [{ id: "coat", children: 2, radius: .03 }],
      guides: [{
        id: "forelock",
        layer: "coat",
        region: "left-part",
        points: [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
        normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        width: 1,
      }],
    },
    strands: [
      {
        id: "left",
        guideId: "forelock",
        layer: "coat",
        points: [[.25, 0, -.05], [.25, .8, -.05], [.25, 1.6, -.05]],
        radii: [.03, .03, .03],
        guideT: [0, .4, .8],
        shade: .8,
      },
      {
        id: "right",
        guideId: "forelock",
        layer: "coat",
        points: [[-.25, 0, .05], [-.25, 1, .05], [-.25, 2, .05]],
        radii: [.03, .03, .03],
        guideT: [0, .5, 1],
        shade: 1,
      },
    ],
  };
}

const settings = { textureSize: 256, tileWidth: 64, tileHeight: 128 };
function pixel(baked: BakedGroomCards, u: number, v: number, tileIndex = 0) {
  const tile = baked.atlas.tiles[tileIndex];
  const x = Math.round(
    (tile.u0 + (tile.u1 - tile.u0) * u) * baked.atlas.width - .5,
  );
  const y = Math.round(
    (tile.v0 + (tile.v1 - tile.v0) * v) * baked.atlas.height - .5,
  );
  return (y * baked.atlas.width + x) * 4;
}

Deno.test("groom bake preserves real fiber spacing, length, direction and depth", () => {
  const generated = fixture(), original = structuredClone(generated);
  const baked = bakeGroomCards(generated, settings);
  assertEquals(generated, original);
  assertEquals(baked.guides[0].sourceGuideId, "forelock");
  assertEquals(baked.guides[0].region, "left-part");
  assertEquals(baked.guides[0].variant, 0);
  assertEquals(baked.report.fiberCount, 2);
  assertEquals(baked.report.bytes, baked.atlas.width * baked.atlas.height * 20);
  const left = pixel(baked, .25, .4), right = pixel(baked, .75, .4);
  assert(baked.atlas.data[left + 3] > 200);
  assert(baked.atlas.data[right + 3] > 200);
  assertEquals(
    baked.atlas.data[pixel(baked, .5, .4) + 3],
    0,
    "No invented core between sparse fibers",
  );
  assertEquals(
    baked.atlas.data[pixel(baked, .25, .92) + 3],
    0,
    "The shorter fiber must end at its actual endpoint",
  );
  assert(
    baked.atlas.data[pixel(baked, .75, .92) + 3] > 200,
    "Full-length fibers must not receive an arbitrary early cutoff",
  );
  assertEquals(baked.atlas.tangentData![left], 128);
  assertEquals(baked.atlas.tangentData![left + 1], 255);
  assert(baked.atlas.depthData![right] > baked.atlas.depthData![left] + 100);
  assertAlmostEquals(baked.tiles[0].depthMin, -.08);
  assertAlmostEquals(baked.tiles[0].depthMax, .08);
  assertAlmostEquals(baked.atlas.attributeData![left] / 255, .5, .02);
  assertAlmostEquals(baked.atlas.attributeData![right] / 255, .4, .02);
  assert(
    baked.atlas.normalData.some((value, at) =>
      at % 4 === 0 && Math.abs(value - 128) > 30
    ),
  );
  for (let y = 0; y < baked.atlas.height; y++) {
    assertEquals(baked.atlas.data[(y * baked.atlas.width) * 4 + 3], 0);
  }
});

Deno.test("groom atlas is deterministic and responds to the actual clump geometry", () => {
  const generated = fixture();
  const a = bakeGroomCards(generated, settings);
  const reordered = structuredClone(generated);
  reordered.strands.reverse();
  const b = bakeGroomCards(reordered, settings);
  for (
    const key of [
      "data",
      "normalData",
      "tangentData",
      "depthData",
      "attributeData",
    ] as const
  ) assertEquals(a.atlas[key], b.atlas[key]);
  const edited = structuredClone(generated);
  const p = edited.strands[0].points[1];
  edited.strands[0].points[1] = [p[0] - .2, p[1], p[2] + .12];
  const c = bakeGroomCards(edited, settings);
  assertNotEquals(a.atlas.data, c.atlas.data);
  assertNotEquals(a.atlas.normalData, c.atlas.normalData);
  assertNotEquals(a.atlas.depthData, c.atlas.depthData);
  assert(c.atlas.tangentData!.some((value, at) => at % 4 === 0 && value > 140));
  assert(c.atlas.tangentData!.some((value, at) => at % 4 === 0 && value < 116));
});

Deno.test("fiber tessellation does not create opaque beads at segment joins", () => {
  const sparse = fixture();
  sparse.strands = [{
    id: "thin",
    guideId: "forelock",
    layer: "coat",
    points: [[0, 0, 0], [0, 2, 0]],
    radii: [.004, .004],
    guideT: [0, 1],
    shade: 1,
  }];
  const dense = structuredClone(sparse);
  const fiber = dense.strands[0];
  fiber.points = Array.from({ length: 17 }, (_, i) => [0, i / 8, 0]);
  fiber.radii = fiber.points.map(() => .004);
  fiber.guideT = fiber.points.map((_, i) => i / 16);
  const a = bakeGroomCards(sparse, settings),
    b = bakeGroomCards(dense, settings);
  for (let at = 3; at < a.atlas.data.length; at += 4) {
    assertAlmostEquals(a.atlas.data[at], b.atlas.data[at], 1);
  }
  const maximum = Math.max(
    ...Array.from(a.atlas.data).filter((_, at) => at % 4 === 3),
  );
  assert(
    maximum > 0 && maximum < 130,
    "Subpixel fibers must retain fractional coverage",
  );
});

Deno.test("slanted subpixel fibers retain physical coverage in stretched atlas tiles", () => {
  const base = fixture();
  base.source.guides[0].width = .04;
  base.strands = [{
    id: "thin",
    guideId: "forelock",
    layer: "coat",
    points: [[0, 0, 0], [0, 2, 0]],
    radii: [.00022, .00022],
    guideT: [0, 1],
    shade: 1,
  }];
  const slanted = structuredClone(base);
  slanted.strands[0].points = [[-.01, 0, 0], [.01, 2, 0]];
  const rowCoverage = (baked: BakedGroomCards) => {
    let sum = 0;
    for (let row = 10; row < 50; row++) {
      const tile = baked.atlas.tiles[0];
      const y = Math.round(
        (tile.v0 + (tile.v1 - tile.v0) * row / 60) * baked.atlas.height - .5,
      );
      for (let x = 0; x < baked.atlas.width; x++) {
        sum += baked.atlas.data[(y * baked.atlas.width + x) * 4 + 3] / 255;
      }
    }
    return sum / 40;
  };
  for (const tileHeight of [64, 256]) {
    const straight = bakeGroomCards(base, { ...settings, tileHeight });
    const bent = bakeGroomCards(slanted, { ...settings, tileHeight });
    const expected = .00044 / .04 * (settings.tileWidth - 5);
    assertAlmostEquals(rowCoverage(straight), expected, .02);
    assertAlmostEquals(rowCoverage(bent), expected, .02);
  }
});

Deno.test("baked cards use transported curved guide frames and expand for real flyaways", () => {
  const source: GuideGroom = {
    version: 1,
    seed: 321,
    layers: [{
      id: "guard",
      children: 12,
      radius: .004,
      frizz: .04,
      flyaways: .4,
      lengthVariation: .2,
    }],
    guides: [{
      id: "bent",
      layer: "guard",
      points: [[0, 0, 0], [0, .6, 0], [.3, 1, .2], [.6, .9, .4]],
      width: [.06, .1, .08, .01],
    }],
  };
  const generated = generateGroomStrands(source, { segments: 16 });
  const baked = bakeGroomCards(generated, settings);
  assertEquals(baked.guides[0].points, source.guides[0].points);
  assert(baked.report.coveredPixels > 100);
  const sourceWidth = source.guides[0].width as number[];
  const widths = baked.guides[0].width as number[];
  assert(widths.every((width, i) => width >= sourceWidth[i]));
  assert(widths.some((width, i) => width > sourceWidth[i]));
  const mesh = hairCards(baked.guides, { atlas: baked.atlas })
    .children[0] as THREE.Mesh;
  for (const attribute of Object.values(mesh.geometry.attributes)) {
    assert(Array.from(attribute.array).every(Number.isFinite));
  }
});

Deno.test("selected guide IDs preserve unique tiles beyond the eight procedural variants", () => {
  const base = fixture();
  base.source.guides = Array.from(
    { length: 10 },
    (_, i) => ({ ...structuredClone(base.source.guides[0]), id: `guide-${i}` }),
  );
  base.strands = base.source.guides.flatMap((guide) =>
    fixture().strands.map((fiber): GroomFiber => ({
      ...fiber,
      id: `${guide.id}/${fiber.id}`,
      guideId: guide.id,
    }))
  );
  const baked = bakeGroomCards(base, {
    ...settings,
    guideIds: base.source.guides.map((guide) => guide.id).reverse(),
  });
  assertEquals(baked.guides[0].sourceGuideId, "guide-9");
  assertEquals(baked.guides[9].variant, 9);
  const custom = new THREE.MeshPhysicalMaterial({
    alphaTest: .17,
    normalScale: new THREE.Vector2(.8, .8),
    anisotropy: .9,
  });
  const object = hairCards(baked.guides, {
    atlas: baked.atlas,
    material: custom,
  });
  const mesh = object.children[0] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshPhysicalMaterial
  >;
  assertEquals(mesh.material, custom);
  assertEquals(mesh.material.alphaTest, .17);
  assertEquals(mesh.material.normalScale.x, .8);
  assertEquals(object.userData.threejsHairCards.atlasVariants, 10);
  const textures = hairCardTextures(baked.atlas);
  assertEquals(textures, hairCardTextures(baked.atlas));
  assertEquals(custom.map, textures.map);
  assertEquals(custom.normalMap, textures.normalMap);
  assertEquals(custom.anisotropyMap, textures.anisotropyMap);
  assertEquals(custom.anisotropyRotation, 0);
  assertEquals(textures.map.colorSpace, THREE.SRGBColorSpace);
  assertEquals(textures.depthMap!.colorSpace, THREE.NoColorSpace);
  assertEquals(textures.attributeMap!.image.data, baked.atlas.attributeData);
  const uv = mesh.geometry.getAttribute("uv");
  assertAlmostEquals(uv.getX(9 * 6), baked.atlas.tiles[9].u0, 1e-6);
});

Deno.test("empty clumps stay transparent and invalid bake inputs and budgets fail", () => {
  const empty = fixture();
  empty.strands = [];
  const baked = bakeGroomCards(empty, settings);
  assertEquals(baked.report.fiberCount, 0);
  assertEquals(baked.report.coveredPixels, 0);
  assertEquals(baked.tiles[0].depthMin, 0);
  assertEquals(baked.tiles[0].depthMax, 0);
  assertThrows(() => bakeGroomCards(fixture(), { guideIds: [] }), RangeError);
  assertThrows(
    () => bakeGroomCards(fixture(), { guideIds: ["missing"] }),
    RangeError,
  );
  assertThrows(
    () => bakeGroomCards(fixture(), { guideIds: ["forelock", "forelock"] }),
    RangeError,
  );
  assertThrows(
    () => bakeGroomCards(fixture(), { textureSize: 300 }),
    RangeError,
  );
  assertThrows(
    () => bakeGroomCards(fixture(), { tileWidth: 8, gutter: 3 }),
    RangeError,
  );
  assertThrows(() => bakeGroomCards(fixture(), { maxBytes: 1024 }), RangeError);
  assertThrows(
    () => bakeGroomCards(fixture(), { widthPadding: .9 }),
    RangeError,
  );
  const invalid = fixture();
  invalid.strands[0].guideT[1] = NaN;
  assertThrows(() => bakeGroomCards(invalid), RangeError);
  const invalidAtlas = { ...baked.atlas, tangentData: new Uint8Array(4) };
  assertThrows(
    () => hairCards(baked.guides, { atlas: invalidAtlas }),
    RangeError,
  );
  assertThrows(
    () =>
      hairCards([{ ...baked.guides[0], variant: 1 }], { atlas: baked.atlas }),
    RangeError,
  );
});

Deno.test("sharp-turn groom LODs retain source arc texture coordinates", () => {
  const source: GuideGroom = {
    version: 1,
    seed: 71,
    layers: [{ id: "hair", children: 4, radius: .005 }],
    guides: [{
      id: "elbow",
      layer: "hair",
      points: [[0, 0, 0], [0, 1, 0], [1, 1, 0]],
      width: .1,
      normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
    }],
  };
  const compiled = compileGroom(source, {
    segments: 12,
    atlas: { textureSize: 128 },
  });
  const tile = compiled.baked.atlas.tiles[0];
  for (
    const [lod, segments, columns] of [["high", 18, 3], ["medium", 10, 2], [
      "low",
      5,
      2,
    ]] as const
  ) {
    const object = renderGroom(compiled, { lod, representation: "cards" });
    const mesh = object.children[0].children[0] as THREE.Mesh;
    const uv = mesh.geometry.getAttribute("uv");
    for (let row = 0; row <= segments; row++) {
      const sourceArc = (uv.getY(row * columns) - tile.v0) /
        (tile.v1 - tile.v0);
      assertAlmostEquals(sourceArc, row / segments, 1e-6);
    }
  }
});

Deno.test("explicit card arc coordinates support trimmed geometry and reject invalid parameterizations", () => {
  const guide = {
    points: [[0, 0, 0], [0, .1, 0], [0, 2, 0]] as [number, number, number][],
    width: .1,
    arcT: [.2, .4, .7],
  };
  const object = hairCards([guide], {
    textureSize: 128,
    color: "#000000",
    tipColor: "#ffffff",
    colorVariation: 0,
  });
  const mesh = object.children[0] as THREE.Mesh;
  const uv = mesh.geometry.getAttribute("uv");
  const middleFraction = (uv.getY(2) - uv.getY(0)) / (uv.getY(4) - uv.getY(0));
  assertAlmostEquals(middleFraction, .4, 1e-6);
  for (
    const arcT of [
      [0, 1],
      [0, .5, .5],
      [0, .7, .6],
      [-.1, .5, 1],
      [0, .5, 1.1],
      [0, NaN, 1],
    ]
  ) {
    assertThrows(
      () => hairCards([{ ...guide, arcT }], { textureSize: 128 }),
      RangeError,
    );
  }
});
