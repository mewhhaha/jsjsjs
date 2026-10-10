import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  packGroomReference,
  referenceAttachments,
} from "../scripts/export-groom-reference.ts";
import { blenderCommand } from "../src/blender.ts";
import { createGroom, generateGroomStrands } from "../src/hair/groom-data.ts";
import { blenderAvailable } from "./support.ts";

const source = () =>
  createGroom({
    version: 1,
    seed: 71,
    name: "full-density-reference-test",
    layers: [{
      id: "outer",
      children: 7,
      radius: .007,
      tipRadius: .0001,
      color: "#71472e",
      tipColor: "#ae8153",
      roughness: .4,
    }, {
      id: "flyaways",
      children: 3,
      radius: .003,
      kind: "flyaway",
    }],
    guides: [{
      id: "swoop",
      layer: "outer",
      points: [[-.25, 1, 0], [0, .6, .15], [.15, .1, 0]],
      normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
      width: .3,
    }, {
      id: "loose",
      layer: "flyaways",
      points: [[.25, 1, 0], [.35, .6, .2], [.45, .15, .1]],
      normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
      width: .05,
    }],
  });

Deno.test("reference packing retains every source child, radius, layer and transform", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "threejs-groom-reference-",
  });
  try {
    const groom = source();
    const original = structuredClone(groom);
    const matrix = new THREE.Matrix4().makeTranslation(1, 2, 3).toArray();
    const attachments = referenceAttachments([
      { name: "high LOD", matrixWorld: matrix },
      { name: "low LOD", matrixWorld: matrix },
    ]);
    assertEquals(attachments.length, 1);
    const packed = await packGroomReference(groom, directory, {
      segments: 4,
      attachments,
    });
    assertEquals(groom, original);
    assertEquals(packed.generation.density, 1);
    assertEquals(packed.counts, {
      guides: 2,
      fibers: 10,
      points: 50,
      instances: 1,
      renderedFibers: 10,
    });
    assertEquals(packed.attachments, attachments);
    const bytes = await Deno.readFile(join(directory, "fibers.bin"));
    const data = new DataView(bytes.buffer);
    assertEquals(bytes.length, packed.byteLength);
    const expected = generateGroomStrands(groom, { segments: 4 });
    for (const layer of packed.layers) {
      const fibers = expected.strands.filter((fiber) =>
        fiber.layer === layer.id
      );
      let cursor = 0;
      fibers.forEach((fiber, i) => {
        assertEquals(
          data.getUint32(layer.sizes.byteOffset + i * 4, true),
          fiber.points.length,
        );
        assertAlmostEquals(
          data.getFloat32(layer.shades.byteOffset + i * 4, true),
          fiber.shade,
          1e-6,
        );
        for (let j = 0; j < fiber.points.length; j++, cursor++) {
          for (let axis = 0; axis < 3; axis++) {
            assertAlmostEquals(
              data.getFloat32(
                layer.positions.byteOffset + (cursor * 3 + axis) * 4,
                true,
              ),
              fiber.points[j][axis],
              1e-6,
            );
          }
          assertAlmostEquals(
            data.getFloat32(layer.radii.byteOffset + cursor * 4, true),
            fiber.radii[j],
            1e-8,
          );
        }
      });
    }
    assertEquals(
      JSON.parse(await Deno.readTextFile(join(directory, "groom.json"))),
      groom,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("reference attachments reject unusable transforms", () => {
  assertThrows(() => referenceAttachments([]), RangeError);
  assertThrows(
    () => referenceAttachments([{ name: "broken", matrixWorld: [] }]),
    TypeError,
  );
  const matrix = new THREE.Matrix4().toArray();
  matrix[3] = .1;
  assertThrows(
    () => referenceAttachments([{ name: "projective", matrixWorld: matrix }]),
    RangeError,
  );
  matrix[3] = 0;
  matrix[0] = 0;
  assertThrows(
    () => referenceAttachments([{ name: "singular", matrixWorld: matrix }]),
    RangeError,
  );
});

const available = blenderAvailable();

Deno.test({
  name:
    "Cycles reference renders native full-density curves headlessly with source transforms",
  ignore: !available,
  async fn() {
    const directory = await Deno.makeTempDir({
      prefix: "js3-cycles-reference-",
    });
    try {
      const groom = source();
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(.1, .2, -.1),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(.1, -.2, .1)),
        new THREE.Vector3(1.1, .9, 1.2),
      );
      await packGroomReference(groom, directory, {
        segments: 4,
        attachments: [{ name: "groom", matrixWorld: transform.toArray() }],
      });
      const command = blenderCommand(
        fileURLToPath(
          new URL("../scripts/render-groom-reference.py", import.meta.url),
        ),
        [
          "--source",
          join(directory, "reference.json"),
          "--output",
          directory,
          "--resolution",
          "64x80",
          "--samples",
          "2",
          "--view",
          "front,profile",
          "--radius",
          ".7",
          "--target",
          ".1,.7,0",
        ],
      );
      const rendered = await command.output();
      assert(rendered.success, new TextDecoder().decode(rendered.stderr));
      const report = JSON.parse(
        await Deno.readTextFile(join(directory, "report.json")),
      );
      assertEquals(report.background, true);
      assertEquals(report.counts.fibers, 10);
      assertEquals(report.counts.points, 50);
      assertEquals(report.settings.engine, "CYCLES");
      assertEquals(report.settings.resolution, [64, 80]);
      assertEquals(report.settings.generation.density, 1);
      assertEquals(
        report.renders.map((render: { view: string }) => render.view),
        ["front", "profile"],
      );
      assert((await Deno.stat(join(directory, "studio-front.png"))).size > 100);
      assert(
        (await Deno.stat(join(directory, "studio-profile.png"))).size > 100,
      );
      const fiber = generateGroomStrands(groom, { segments: 4 }).strands[0];
      const point = new THREE.Vector3(...fiber.points[0]).applyMatrix4(
        transform,
      );
      const expected = [point.x, -point.z, point.y];
      const camera = new THREE.PerspectiveCamera(38, 64 / 80, .0007, 70);
      const vertical = THREE.MathUtils.degToRad(19);
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = .7 / Math.sin(Math.min(vertical, horizontal)) * 1.04;
      camera.position.set(.1, .7, distance);
      camera.lookAt(.1, .7, 0);
      camera.updateMatrixWorld();
      const landmarks = [[0, 1.1, .4], [0, .78, .4], [0, .1, .3], [.5, .3, 0]];
      const projected = landmarks.map((p) => {
        const v = new THREE.Vector3(...p).project(camera);
        return [(v.x + 1) / 2, (v.y + 1) / 2];
      });
      const script = join(directory, "verify.py");
      await Deno.writeTextFile(
        script,
        `import bpy, sys, math
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
assert bpy.app.background
objects = [o for o in bpy.context.scene.objects if o.type == 'CURVES']
assert len(objects) == 2
assert sum(len(o.data.curves) for o in objects) == 10
assert sum(len(o.data.points) for o in objects) == 50
assert not any(o.type == 'MESH' for o in bpy.context.scene.objects)
o = bpy.data.objects['groom/outer']
p = o.matrix_world @ o.data.attributes['position'].data[0].vector
assert max(abs(a-b) for a,b in zip(p, ${JSON.stringify(expected)})) < 0.000001
assert abs(o.data.attributes['radius'].data[0].value - ${
          fiber.radii[0]
        }) < 0.000001
assert bpy.data.texts['groom.json'].as_string()
for o in objects:
    assert o['threejs_full_density']
    hair = [n for n in o.data.materials[0].node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfHairPrincipled'][0]
    assert hair.parametrization == 'COLOR'
assert bpy.context.scene.render.engine == 'CYCLES'
for p, expected in zip(${JSON.stringify(landmarks)}, ${
          JSON.stringify(projected)
        }):
    projected = world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, Vector((p[0], -p[2], p[1])))
    assert max(abs(a-b) for a,b in zip(projected[:2], expected)) < 0.000001
`,
      );
      const verified = await blenderCommand(script, [
        join(directory, "reference.blend"),
      ]).output();
      assert(verified.success, new TextDecoder().decode(verified.stderr));
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});
