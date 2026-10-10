import { assert, assertEquals, assertThrows } from "@std/assert";
import * as THREE from "three";
import { buildFurGroom } from "./fixtures/groom-fur.ts";
import {
  buildGroom,
  buildGroomLODs,
  compileGroom,
  createGroom,
  type GroomDetail,
  type GroomRenderOptions,
  type GuideGroom,
  renderGroom,
  serializeGroom,
} from "../src/prelude.ts";

function source(): GuideGroom {
  return createGroom({
    version: 1,
    seed: 781,
    name: "layered coat",
    layers: [
      {
        id: "undercoat",
        kind: "undercoat",
        children: 48,
        radius: .001,
        clump: .4,
        color: "#543a28",
      },
      {
        id: "guards",
        kind: "guard",
        children: 16,
        radius: .002,
        frizz: .003,
        color: "#785632",
      },
      { id: "loose", kind: "flyaway", children: 2, radius: .0005 },
    ],
    guides: Array.from({ length: 18 }, (_, i) => ({
      id: `guide-${i}`,
      layer: i < 8 ? "undercoat" : i < 16 ? "guards" : "loose",
      region: i < 8 ? "left" : "right",
      points: [[i * .06, 0, 0], [i * .06, .2, .015], [i * .06 + .03, .4, 0]],
      normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
      width: [.06, .05, .01],
    })),
  });
}

function ids(group: THREE.Object3D): Set<string> {
  const result = new Set<string>();
  group.traverse((child) => {
    for (const id of child.userData.groomFiberIds ?? []) result.add(id);
  });
  return result;
}

function materials(group: THREE.Object3D): THREE.MeshPhysicalMaterial[] {
  const result: THREE.MeshPhysicalMaterial[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      assert(!Array.isArray(mesh.material));
      result.push(mesh.material as THREE.MeshPhysicalMaterial);
    }
  });
  return result;
}

Deno.test("groom LODs preserve baked card coverage with smaller geometry and stable fiber subsets", () => {
  const input = source();
  const original = serializeGroom(input);
  const compiled = compileGroom(input, { atlas: { textureSize: 256 } });
  assert(compiled.volume);
  assertEquals(
    compiled.volume.statistics.fibers,
    compiled.generated.strands.length,
  );
  const levels = (["high", "medium", "low"] as GroomDetail[]).map((lod) =>
    renderGroom(compiled, { lod })
  );
  const stats = levels.map((level) => level.userData.threejsGroom.statistics);
  // Render LOD selection must not thin the source density used for shadows.
  assertEquals(stats.map((s) => s.volume.storedMass), [
    compiled.volume.statistics.storedMass,
    compiled.volume.statistics.storedMass,
    compiled.volume.statistics.storedMass,
  ]);
  assertEquals(stats.map((s) => s.renderedCards), [16, 16, 16]);
  assert(stats[0].triangles > stats[1].triangles);
  assert(stats[1].triangles > stats[2].triangles);
  assert(stats[0].vertices > stats[1].vertices);
  assert(stats[1].vertices > stats[2].vertices);
  assert(stats[0].renderedStrands >= stats[1].renderedStrands);
  assert(stats[1].renderedStrands >= stats[2].renderedStrands);
  const selections = levels.map(ids);
  for (const id of selections[2]) assert(selections[1].has(id));
  for (const id of selections[1]) assert(selections[0].has(id));
  assertEquals(ids(renderGroom(compiled)), selections[0]);
  const maps = levels.map((level) =>
    materials(level.getObjectByName("undercoat-cards")!)[0].map
  );
  assert(maps[0] === maps[1] && maps[1] === maps[2]);
  assert(maps[0] !== null);
  assertEquals(serializeGroom(input), original);
  assertEquals(compiled.generated.source, input);
  input.guides[0].points[0][0] = 99;
  assertEquals(compiled.generated.source.guides[0].points[0][0], 0);
});

Deno.test("one source supports complete native fibers, baked cards, hybrid and portable shading", () => {
  const input = source();
  const compiled = compileGroom(input, { atlas: { textureSize: 256 } });
  const curves = renderGroom(compiled, { representation: "strands" });
  assertEquals(ids(curves).size, compiled.generated.strands.length);
  assertEquals(curves.userData.threejsGroom.statistics.renderedCards, 0);
  for (const child of curves.children) {
    assert(child.userData.threejsStrands);
  }
  const cards = renderGroom(compiled, {
    representation: "cards",
    shading: "standard",
    alphaTest: .12,
  });
  assertEquals(ids(cards).size, 0);
  assertEquals(
    cards.userData.threejsGroom.statistics.renderedCards,
    input.guides.length,
  );
  assertEquals(cards.userData.threejsGroom.source, input);
  for (const material of materials(cards)) {
    assert(material.map && material.normalMap && material.anisotropyMap);
    assertEquals(material.userData.threejsGroomShading, undefined);
    assertEquals(material.alphaTest, .12);
  }
  const simple = buildGroom(input, {
    atlas: { textureSize: 256 },
    lod: "low",
    representation: "cards",
    name: "portable wig",
  });
  assertEquals(simple.name, "portable wig");
  assertEquals(simple.userData.threejsGroom.lod, "low");
  for (
    const option of [
      { lod: "typo" },
      { representation: "typo" },
      {
        shading: "typo",
      },
      { alphaTest: -1 },
      { alphaTest: 1.1 },
      { alphaTest: NaN },
    ]
  ) {
    assertThrows(() => renderGroom(compiled, option as GroomRenderOptions));
  }
  const noVolume = compileGroom(input, {
    atlas: { textureSize: 256 },
    volume: false,
  });
  assertEquals(noVolume.volume, undefined);
  assertEquals(
    renderGroom(noVolume).userData.threejsGroomVolume,
    undefined,
  );
});

Deno.test("live groom LOD selects one level with distance and stores the source once", () => {
  const input = source();
  const lod = buildGroomLODs(input, {
    atlas: { textureSize: 256 },
    distances: [0, 3, 6],
  });
  assertEquals(lod.levels.length, 3);
  assertEquals(lod.levels.map((level) => level.distance), [0, 3, 6]);
  assertEquals(lod.children.map((child) => child.visible), [
    true,
    false,
    false,
  ]);
  assertEquals(lod.userData.threejsGroomSource, input);
  assert(lod.children.every((child) => !child.userData.threejsGroom.source));
  const camera = new THREE.PerspectiveCamera();
  for (const [distance, index] of [[1, 0], [4, 1], [8, 2], [1, 0]]) {
    camera.position.set(0, 0, distance);
    camera.updateMatrixWorld();
    lod.update(camera);
    assertEquals(lod.getCurrentLevel(), index);
    assertEquals(
      lod.children.filter((child) => child.visible),
      [lod.levels[index].object],
    );
  }
  assertThrows(() =>
    buildGroomLODs(input, {
      atlas: { textureSize: 256 },
      distances: [0, 6, 3],
    })
  );
});

Deno.test("curved fur fibers retain nonnegative tapered radii after LOD resampling", () => {
  const compiled = compileGroom(buildFurGroom(), {
    atlas: { textureSize: 1024 },
  });
  for (const lod of ["high", "medium", "low"] as const) {
    const coat = renderGroom(compiled, { lod });
    assert(coat.userData.threejsGroom.statistics.triangles > 0);
    for (const child of coat.children) {
      const metadata = child.userData.threejsStrands;
      if (!metadata) continue;
      assert(child.userData.groomFiberIds.length > 0);
    }
  }
});
