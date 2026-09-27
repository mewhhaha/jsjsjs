import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { fur, grass } from "../src/strand-presets.ts";
import { type StrandData } from "../src/strand-data.ts";
import { THREE } from "../src/prelude.ts";

function emitter() {
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(2, 3, 4);
  return surface;
}

function data(group: THREE.Group): StrandData {
  return group.userData.threejsStrands;
}

Deno.test("grass grows above a transformed emitter with fixed roots and tapered wind-bent blades", () => {
  const surface = emitter();
  const blades = grass(surface, { roots: { count: 24, seed: 11 } });
  assertEquals(blades.parent, null);
  assertEquals(surface.parent, null);
  assertEquals(surface.position.toArray(), [2, 3, 4]);
  for (const strand of data(blades).strands) {
    const root = strand.points[0];
    const tip = strand.points.at(-1)!;
    assertAlmostEquals(root[1], 3, 1e-6);
    assert(root[0] >= 1 && root[0] <= 3);
    assert(root[2] >= 3 && root[2] <= 5);
    assert(tip[1] > root[1]);
    assert(tip[0] > root[0]);
    assertEquals(strand.radii.at(-1), 0);
  }
  const mesh = blades.children[0] as THREE.Mesh;
  assert(mesh.geometry.index!.count > 0);
  for (const attribute of ["position", "normal", "tangent", "uv", "color"]) {
    assert(
      Array.from(mesh.geometry.getAttribute(attribute).array).every(
        Number.isFinite,
      ),
    );
  }
});

Deno.test("fur preset permits complete groom overrides and reproduces seeded geometry", () => {
  const options = {
    roots: { count: 18, seed: 53 },
    groom: {
      length: 0.5,
      lengthVariation: 0,
      radius: 0.01,
      segments: 3,
      direction: [0, 0, 0] as const,
      bend: [0, 0, 0] as const,
      frizz: { amplitude: 0, frequency: 0 },
    },
    render: { color: "#654321", name: "custom coat" },
  };
  const before = structuredClone(options);
  const coat = fur(emitter(), options);
  const other = fur(emitter(), options);
  assertEquals(options, before);
  assertEquals(coat.name, "custom coat");
  assertEquals(data(coat), data(other));
  for (const strand of data(coat).strands) {
    assertEquals(strand.points.length, 4);
    assertAlmostEquals(strand.points.at(-1)![1] - strand.points[0][1], 0.5);
    assertAlmostEquals(strand.radii[0], 0.01);
    assertEquals(strand.radii.at(-1), 0);
  }
  const a = coat.children[0] as THREE.Mesh;
  const b = other.children[0] as THREE.Mesh;
  assertEquals(
    a.geometry.getAttribute("position").array,
    b.geometry.getAttribute("position").array,
  );
});

Deno.test("preset density masks and render transforms are independently applied once", () => {
  const coat = fur(emitter(), {
    roots: {
      count: 20,
      seed: 9,
      density: (root) => root.position[0] > 2 ? 1 : 0,
    },
    groom: { length: 0.03 },
    render: { position: [10, 0, 0] },
  });
  assertEquals(coat.position.toArray(), [10, 0, 0]);
  assert(
    data(coat).strands.every((strand) =>
      strand.points[0][0] > 2 && strand.points[0][0] <= 3
    ),
  );
  coat.updateWorldMatrix(true, true);
  assert(new THREE.Box3().setFromObject(coat).min.x > 11.9);
});
