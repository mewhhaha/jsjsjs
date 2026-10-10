import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  createGroom,
  createGroomGuideSampler,
  generateGroomStrands,
  type GuideGroom,
  parseGroom,
  serializeGroom,
} from "../src/hair/groom-data.ts";

function source(): GuideGroom {
  return {
    version: 1,
    seed: 882,
    name: "parted layered coat",
    layers: [
      {
        id: "soft-undercoat",
        kind: "undercoat",
        children: 12,
        radius: .001,
        tipRadius: .0001,
        clump: .45,
        frizz: .006,
        lengthVariation: .2,
        flyaways: .15,
        color: "#291b13",
        tipColor: "#72523c",
        roughness: .65,
      },
      {
        id: "long-guards",
        kind: "guard",
        children: 5,
        radius: .002,
        clump: .25,
        lengthVariation: .1,
        color: "#a28761",
        roughness: .35,
      },
    ],
    guides: [
      {
        id: "left-001",
        layer: "soft-undercoat",
        region: "left-parting",
        points: [[-1, 0, 0], [-1, .1, 0], [-1.2, 1, .1]],
        width: [.1, .08, .015],
        normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        root: {
          surfaceId: "scalp",
          triangleIndex: 217,
          barycentric: [.2, .3, .5],
          uv: [.14, .83],
        },
      },
      {
        id: "right-001",
        layer: "long-guards",
        region: "right-parting",
        points: [[1, 0, 0], [1.2, .8, .1], [1.3, 2, 0]],
        width: .2,
      },
    ],
  };
}

Deno.test("editable groom JSON roundtrips named layers, partings, normals and persistent roots", () => {
  const input = source();
  const groom = createGroom(input);
  assertEquals(groom, input);
  assertEquals(parseGroom(serializeGroom(groom)), groom);
  input.guides[0].points[0][0] = 99;
  input.guides[0].normals![0][0] = 99;
  input.guides[0].root!.barycentric[0] = 99;
  input.guides[0].root!.uv![0] = 99;
  input.layers[0].radius = 99;
  assertEquals(groom, source());
  const derived = generateGroomStrands(groom, { segments: 8 });
  assertEquals(derived.source, groom);
  derived.source.guides[0].root!.barycentric[0] = .8;
  assertEquals(groom.guides[0].root!.barycentric, [.2, .3, .5]);
});

Deno.test("fiber IDs and paths survive guide reorder, unrelated additions and density changes", () => {
  const input = source();
  const full = generateGroomStrands(input, { segments: 12 });
  assertEquals(full, generateGroomStrands(input, { segments: 12 }));
  assertEquals(full.strands.length, 17);
  const lookup = new Map(full.strands.map((fiber) => [fiber.id, fiber]));
  const reordered = source();
  reordered.guides.reverse();
  reordered.layers.reverse();
  reordered.guides.push({
    id: "unrelated-new-guide",
    layer: "soft-undercoat",
    points: [[8, 0, 0], [8, 2, 0]],
    width: .1,
  });
  for (
    const fiber of generateGroomStrands(reordered, { segments: 12 }).strands
  ) {
    if (lookup.has(fiber.id)) assertEquals(fiber, lookup.get(fiber.id));
  }
  const medium = generateGroomStrands(input, { density: .5, segments: 12 });
  const low = generateGroomStrands(input, { density: .1, segments: 12 });
  const mediumIds = new Set(medium.strands.map((fiber) => fiber.id));
  for (const fiber of medium.strands) assertEquals(fiber, lookup.get(fiber.id));
  for (const fiber of low.strands) {
    assertEquals(fiber, lookup.get(fiber.id));
    assert(mediumIds.has(fiber.id));
  }
  const sparse = generateGroomStrands(input, { density: .00001 });
  assertEquals(sparse.strands.length, input.guides.length);
  assertEquals(new Set(sparse.strands.map((fiber) => fiber.guideId)).size, 2);
  assertEquals(generateGroomStrands(input, { density: 0 }).strands, []);
});

Deno.test("groom child roots stay attached while clump, frizz and length are edited", () => {
  const input = source();
  const before = generateGroomStrands(input);
  input.layers[0].clump = 1;
  input.layers[0].frizz = .1;
  input.layers[0].flyaways = 1;
  input.layers[0].lengthVariation = 1;
  input.guides[1].points[2] = [20, 20, 20];
  const after = generateGroomStrands(input);
  before.strands.forEach((fiber, i) => {
    assertEquals(after.strands[i].points[0], fiber.points[0]);
    if (fiber.layer === "soft-undercoat") {
      assertEquals(fiber.region, "left-parting");
      assertEquals(fiber.guideId, "left-001");
      assert(fiber.points[0][0] >= -1.051 && fiber.points[0][0] <= -.949);
      assertAlmostEquals(fiber.points[0][1], 0);
      assertAlmostEquals(fiber.points[0][2], 0);
    }
  });
  assertEquals(after.source.guides[0].root, source().guides[0].root);
});

Deno.test("optional depth preserves the legacy RNG sequence and survives source roundtrips", async () => {
  const input: GuideGroom = {
    version: 1,
    seed: 882,
    layers: [{
      id: "hair",
      children: 6,
      radius: .001,
      tipRadius: .0001,
      clump: .45,
      frizz: .006,
      lengthVariation: .2,
      flyaways: .15,
    }],
    guides: [{
      id: "left-001",
      layer: "hair",
      points: [[-1, 0, 0], [-1, .1, 0], [-1.2, 1, .1]],
      width: [.1, .08, .015],
      normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
    }],
  };
  const legacy = generateGroomStrands(input, { segments: 8 }).strands;
  // Captured before the depth option existed. This protects all existing
  // positions, radii, shades, selection IDs and random draws, not just roots.
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(legacy)),
    ),
  );
  assertEquals(
    Array.from(digest, (n) => n.toString(16).padStart(2, "0")).join(""),
    "0c52c79eb9106607e26819c4d0e94c209628f15d2473aa7b33f35a8e07f49eda",
  );
  input.layers[0].depth = .09;
  assertEquals(generateGroomStrands(input, { segments: 8 }).strands, legacy);
  const detached = createGroom(input);
  assertEquals(parseGroom(serializeGroom(detached)), detached);
  input.layers[0].depth = .4;
  assertEquals(detached.layers[0].depth, .09);
});

Deno.test("layer depth adds transverse volume without moving roots, ends or unrelated fibers", () => {
  const input = source();
  input.layers[0] = {
    id: "soft-undercoat",
    children: 128,
    radius: .001,
    lengthVariation: 0,
    clump: .3,
    frizz: 0,
    flyaways: 0,
    depth: 0,
  };
  input.guides[0].points = [[0, 0, 0], [0, .5, 0], [0, 1, 0]];
  input.guides[0].width = .2;
  const flat = generateGroomStrands(input, { segments: 12 }).strands;
  input.layers[0].depth = .5;
  const deep = generateGroomStrands(input, { segments: 12 }).strands;
  const midpointDepths: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i], b = deep[i];
    if (a.layer === "long-guards") {
      assertEquals(b, a);
      continue;
    }
    assertEquals(b.id, a.id);
    assertEquals(b.points[0], a.points[0]);
    assertEquals(b.radii, a.radii);
    assertEquals(b.guideT, a.guideT);
    assertEquals(b.shade, a.shade);
    for (let j = 0; j < a.points.length; j++) {
      assertEquals(b.points[j].slice(0, 2), a.points[j].slice(0, 2));
      assertAlmostEquals(a.points[j][2], 0);
      assert(b.points[j][2] >= 0 && b.points[j][2] <= .1);
    }
    assertAlmostEquals(b.points.at(-1)![2], a.points.at(-1)![2], 1e-14);
    midpointDepths.push(b.points[6][2]);
  }
  // A genuinely filled cross-section, not a single translated sheet.
  assert(Math.min(...midpointDepths) < .02);
  assert(Math.max(...midpointDepths) > .08);
  const mean = midpointDepths.reduce((sum, n) => sum + n, 0) /
    midpointDepths.length;
  assert(mean > .035 && mean < .065);
});

Deno.test("child taper and source arc coordinates respect independent undercoat and guard settings", () => {
  const input = source();
  const result = generateGroomStrands(input, { segments: 10 });
  for (const fiber of result.strands) {
    const layer = input.layers.find((layer) => layer.id === fiber.layer)!;
    assertEquals(fiber.radii[0], layer.radius);
    assertAlmostEquals(fiber.radii.at(-1)!, layer.tipRadius ?? 0);
    assertEquals(fiber.guideT[0], 0);
    assert(
      fiber.guideT.at(-1)! <= 1 &&
        fiber.guideT.at(-1)! >= 1 - layer.lengthVariation!,
    );
    assertEquals(fiber.points.length, 11);
    for (let i = 0; i < fiber.points.length; i++) {
      assert(fiber.points[i].every(Number.isFinite));
      if (i) {
        assert(fiber.guideT[i] > fiber.guideT[i - 1]);
        assert(fiber.radii[i] <= fiber.radii[i - 1]);
      }
    }
  }
  const changed = source();
  changed.layers[0].radius *= 3;
  changed.layers[0].frizz = .4;
  const guardsBefore = result.strands.filter((fiber) =>
    fiber.layer === "long-guards"
  );
  const guardsAfter = generateGroomStrands(changed, { segments: 10 }).strands
    .filter((fiber) => fiber.layer === "long-guards");
  assertEquals(guardsAfter, guardsBefore);
});

Deno.test("guide sampling follows arc length and yields orthonormal outward/side frames", () => {
  const guide = source().guides[0];
  guide.points = [[0, 0, 0], [0, .1, 0], [0, 2, 0]];
  guide.width = [.2, .2, .2];
  const sample = createGroomGuideSampler(guide);
  assertEquals(sample(.5).position, [0, 1, 0]);
  assertEquals(sample(.5).normal, [0, 0, 1]);
  assertEquals(sample(.5).tangent, [0, 1, 0]);
  assertEquals(sample(.5).side, [-1, 0, 0]);
  guide.points[2][1] = 50;
  assertEquals(sample(.5).position, [0, 1, 0]);
  const curved = createGroomGuideSampler({
    id: "loop",
    layer: "hair",
    points: [[0, 0, 0], [0, 1, 0], [.2, 1, .3], [.2, 0, .3], [0, 0, .1]],
    width: .1,
  });
  for (let i = 0; i <= 80; i++) {
    const frame = curved(i / 80);
    for (const key of ["normal", "side", "tangent"] as const) {
      assertAlmostEquals(Math.hypot(...frame[key]), 1, 1e-9);
    }
    assertAlmostEquals(
      frame.normal.reduce((sum, n, k) => sum + n * frame.tangent[k], 0),
      0,
      1e-9,
    );
    assertAlmostEquals(
      frame.side.reduce((sum, n, k) => sum + n * frame.tangent[k], 0),
      0,
      1e-9,
    );
  }
  assertThrows(() => sample(-.1));
  assertThrows(() => sample(NaN));
});

Deno.test("groom validation rejects invalid documents, bindings, layers and unsafe allocations", () => {
  const invalid: ((groom: GuideGroom) => void)[] = [
    (groom) => groom.guides = [],
    (groom) => groom.layers = [],
    (groom) => groom.seed = NaN,
    (groom) => groom.guides.push(groom.guides[0]),
    (groom) => groom.layers.push(groom.layers[0]),
    (groom) => groom.guides[0].layer = "missing",
    (groom) => groom.guides[0].id = "",
    (groom) => groom.guides[0].points[1] = [...groom.guides[0].points[0]],
    (groom) => groom.guides[0].points[1][0] = Infinity,
    (groom) => groom.guides[0].points = [[0, 0, 0], [1e-200, 0, 0], [1, 0, 0]],
    (groom) =>
      groom.guides[0].points[1] = new Array(3) as [number, number, number],
    (groom) => groom.guides[0].width = [1],
    (groom) => groom.guides[0].width = -1,
    (groom) => groom.guides[0].width = 0,
    (groom) => groom.guides[0].normals![0] = [0, 0, 0],
    (groom) => groom.guides[0].root!.triangleIndex = -1,
    (groom) => groom.guides[0].root!.barycentric = [1, 1, 1],
    (groom) => groom.guides[0].root!.uv![0] = NaN,
    (groom) => groom.layers[0].children = 0,
    (groom) => groom.layers[0].radius = 0,
    (groom) => groom.layers[0].tipRadius = 2,
    (groom) => groom.layers[0].clump = 2,
    (groom) => groom.layers[0].depth = -1,
    (groom) => groom.layers[0].depth = 1.01,
    (groom) => groom.layers[0].depth = NaN,
    (groom) => groom.layers[0].depth = Infinity,
    (groom) => groom.layers[0].frizz = -1,
  ];
  for (const edit of invalid) {
    const groom = source();
    edit(groom);
    assertThrows(() => createGroom(groom));
  }
  assertThrows(() => parseGroom("null"));
  assertThrows(() => parseGroom('{"version":2}'));
  assertThrows(() =>
    parseGroom(serializeGroom(source()).replace('"children":', '"childrn":'))
  );
  assertThrows(() => generateGroomStrands(source(), { density: 2 }));
  assertThrows(() => generateGroomStrands(source(), { segments: 129 }));
  const large = source();
  large.layers[0].children = 512;
  large.guides = Array.from({ length: 391 }, (_, i) => ({
    ...large.guides[0],
    id: `dense-${i}`,
  }));
  assertThrows(() => createGroom(large), RangeError, "children");
  large.guides.length = 200;
  assertThrows(
    () => generateGroomStrands(large, { segments: 128 }),
    RangeError,
    "points",
  );
});
