import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "node:path";
import * as THREE from "three";
import { exportBlend } from "../src/blender.ts";

const executable = Deno.env.get("JS3_BLENDER") ||
  Deno.env.get("THREEJS_BLENDER") || "blender";
let available = false;
try {
  available = new Deno.Command(executable, {
    args: ["--background", "--version"],
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
} catch { /* Blender is an optional exporter dependency. */ }

// A portable glTF fixture avoids requiring a browser and independently checks
// metadata conversion, including nested, nonuniform transforms on every axis.
function fixture(invalid = false, representation = "tubes") {
  const root = new THREE.Group();
  root.position.set(4, 5, 6);
  root.rotation.set(0.2, 0.3, 0.4);
  root.scale.set(1.2, 0.8, 1.4);
  const group = new THREE.Group();
  group.position.set(1, 2, 3);
  group.rotation.set(0.6, -0.2, 0.1);
  group.scale.set(2, 3, 4);
  root.add(group);
  root.updateMatrixWorld(true);
  const points = [[0.1, 0.2, 0.3], [0.4, 0.6, -0.2], [0.7, 1, -0.5]];
  const expected = points.map((p) => {
    const v = new THREE.Vector3(...p).applyMatrix4(group.matrixWorld);
    return [v.x, -v.z, v.y];
  });
  const document = {
    asset: { version: "2.0", generator: "js3 strand export integration" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: "Outer",
        translation: root.position.toArray(),
        rotation: root.quaternion.toArray(),
        scale: root.scale.toArray(),
        children: [1, 3],
      },
      {
        name: "Fur",
        translation: group.position.toArray(),
        rotation: group.quaternion.toArray(),
        scale: group.scale.toArray(),
        children: [2],
        extras: {
          threejsStrandId: "test-strands",
          threejsStrands: {
            version: 1,
            representation,
            seed: 42,
            strands: [
              { points, radii: invalid ? [0.1] : [0.1, 0.05, 0], shade: 0.8 },
              { points: [[1, 2, 3], [2, 3, 4]], radii: [0.2, 0], shade: 1.1 },
            ],
            guides: [[[0, 0, 0], [0, 1, 0]]],
            material: {
              color: [0.12, 0.08, 0.03],
              tipColor: [0.3, 0.2, 0.1],
              roughness: 0.35,
              colorVariation: 0.1,
            },
          },
        },
      },
      {
        name: "StrandPreview",
        mesh: 0,
        extras: { threejsStrandPreview: true },
      },
      { name: "UnrelatedMesh", mesh: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength + 8 + 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + paddedLength);
  bytes.set(json, 20);
  view.setUint32(20 + paddedLength, 36, true);
  view.setUint32(24 + paddedLength, 0x004e4942, true);
  bytes.set(
    new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
    28 + paddedLength,
  );
  return { bytes, expected };
}

Deno.test({
  name:
    "Blender strands preserve native editable curves, radii, guides and world transforms",
  ignore: !available,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "js3-strand-blend-",
    });
    try {
      const output = join(directory, "fur.blend");
      const { bytes, expected } = fixture();
      await exportBlend(bytes, output, { signal: AbortSignal.timeout(60_000) });
      const verify = join(directory, "verify.py");
      await Deno.writeTextFile(
        verify,
        `import bpy, sys
bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
assert bpy.app.background
curves = bpy.data.objects['Fur_strands']
assert curves.type == 'CURVES'
assert curves.parent.name == 'Fur'
assert curves.parent.parent.name == 'Outer'
assert len(curves.data.curves) == 2
assert len(curves.data.points) == 5
assert curves['threejs_seed'] == 42
expected = ${JSON.stringify(expected)}
for point, target in zip(curves.data.points, expected):
    world = curves.matrix_world @ point.position
    assert all(abs(a-b) < 1e-5 for a,b in zip(world, target)), (world, target)
assert all(abs(p.radius-r) < 1e-6 for p,r in zip(curves.data.points, [0.1,0.05,0,0.2,0]))
assert all(abs(p.value-r) < 1e-6 for p,r in zip(curves.data.attributes['threejs_shade'].data, [0.8,1.1]))
assert curves.hide_get() == curves.hide_render == (sys.argv[-2] == 'ribbons')
guides = bpy.data.objects['Fur_guides']
assert guides.type == 'CURVES' and len(guides.data.curves) == 1
assert guides.hide_get() and guides.hide_render
preview = bpy.data.objects['StrandPreview']
assert preview.type == 'MESH'
assert preview.hide_get() == preview.hide_render == (sys.argv[-2] == 'tubes')
ordinary = bpy.data.objects['UnrelatedMesh']
assert not ordinary.hide_get() and not ordinary.hide_render
assert bpy.context.scene['threejs_strand_groups'] == 1
assert bpy.context.scene.render.engine == 'CYCLES'
material = curves.data.materials[0]
assert any(n.type == 'BSDF_HAIR_PRINCIPLED' for n in material.node_tree.nodes)
assert any(n.type == 'HAIR_INFO' for n in material.node_tree.nodes)
variation = next(n for n in material.node_tree.nodes if n.type == 'MATH' and n.operation == 'MULTIPLY_ADD')
assert abs(variation.inputs[1].default_value - 0.5) < 1e-6
`,
      );
      const verifyBlend = async (file: string, representation: string) => {
        const result = await new Deno.Command(executable, {
          args: [
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            verify,
            "--",
            representation,
            file,
          ],
          env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(
          result.code,
          0,
          new TextDecoder().decode(result.stdout) +
            new TextDecoder().decode(result.stderr),
        );
      };
      await verifyBlend(output, "tubes");
      assert((await Deno.stat(output)).size > 0);
      const original = await Deno.readFile(output);
      await assertRejects(
        () =>
          exportBlend(fixture(true).bytes, output, {
            signal: AbortSignal.timeout(60_000),
          }),
        Error,
        "matching points and radii",
      );
      assertEquals(await Deno.readFile(output), original);
      const ribbonOutput = join(directory, "ribbons.blend");
      await exportBlend(fixture(false, "ribbons").bytes, ribbonOutput, {
        signal: AbortSignal.timeout(60_000),
      });
      await verifyBlend(ribbonOutput, "ribbons");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});
