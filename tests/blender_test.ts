import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "node:path";
import { exportBlend } from "../src/blender.ts";

const executable = Deno.env.get("JS3_BLENDER") ||
  Deno.env.get("THREEJS_BLENDER") || "blender";
let available = true;
try {
  available = new Deno.Command(executable, {
    args: ["--background", "--version"],
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
} catch {
  available = false;
}
if (!available) {
  console.error("Skipping Blender integration test: Blender is not installed.");
}

async function blender(script: string, args: string[]) {
  const result = await new Deno.Command(executable, {
    args: [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python-exit-code",
      "1",
      "--python",
      script,
      "--",
      ...args,
    ],
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  assertEquals(
    result.code,
    0,
    decoder.decode(result.stdout) + decoder.decode(result.stderr),
  );
}

Deno.test({
  name:
    "Blender bridge saves native scenes, packed textures, rigs and animations headlessly",
  ignore: !available,
  fn: async () => {
    const directory = await Deno.makeTempDir({ prefix: "js3 blend test " });
    try {
      const fixture = join(directory, "fixture.py");
      const glb = join(directory, "fixture.glb");
      const output = join(directory, "result.blend");
      const entry = join(directory, "my model.ts");
      await Deno.writeTextFile(entry, "export default () => 'source entry';\n");
      await Deno.writeTextFile(
        fixture,
        `import bpy, sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
root = bpy.data.objects.new('ModelRoot', None)
bpy.context.collection.objects.link(root)
root.location = (1, 2, 3)
bpy.ops.mesh.primitive_cube_add()
mesh = bpy.context.object
mesh.name = 'TexturedPart'
mesh.parent = root
mesh.location = (2, 0, 0)
mesh.scale = (1, 2, 3)
material = bpy.data.materials.new('CopperPaint')
material.use_nodes = True
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = bpy.data.images.new('EmbeddedColor', width=2, height=2)
texture.image.pixels = [0.8, 0.3, 0.1, 1.0] * 4
texture.image.pack()
shader = material.node_tree.nodes.get('Principled BSDF')
material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
mesh.data.materials.append(material)
bpy.ops.object.armature_add(location=(10, 0, 0))
rig = bpy.context.object
rig.name = 'TestRig'
bpy.ops.mesh.primitive_cube_add(location=(10, 0, 0))
skin = bpy.context.object
skin.name = 'SkinnedPart'
skin.parent = rig
skin.matrix_parent_inverse = rig.matrix_world.inverted()
weights = skin.vertex_groups.new(name='Bone')
weights.add(list(range(len(skin.data.vertices))), 1.0, 'REPLACE')
modifier = skin.modifiers.new('Armature', 'ARMATURE')
modifier.object = rig
bone = rig.pose.bones['Bone']
bone.rotation_mode = 'XYZ'
bone.rotation_euler = (0, 0, 0)
bone.keyframe_insert(data_path='rotation_euler', frame=1)
bone.rotation_euler = (0, 0, 0.5)
bone.keyframe_insert(data_path='rotation_euler', frame=24)
bpy.context.scene.frame_end = 24
bpy.context.scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format='GLB', export_animations=True)
`,
      );
      await blender(fixture, [glb]);
      const bytes = await Deno.readFile(glb);
      await exportBlend(bytes, output, {
        signal: AbortSignal.timeout(60_000),
        sourceFile: entry,
      });
      assert((await Deno.stat(output)).size > 0);
      const verify = join(directory, "verify.py");
      await Deno.writeTextFile(
        verify,
        `import bpy, sys
bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
assert bpy.app.background
mesh = bpy.data.objects['TexturedPart']
assert mesh.type == 'MESH' and len(mesh.data.polygons) > 0
assert mesh.parent.name == 'ModelRoot'
assert all(abs(a-b) < 1e-5 for a,b in zip(mesh.location, (2,0,0)))
assert all(abs(a-b) < 1e-5 for a,b in zip(mesh.scale, (1,2,3)))
assert all(abs(a-b) < 1e-5 for a,b in zip(mesh.parent.location, (1,2,3)))
assert mesh.data.materials[0].name == 'CopperPaint'
images = [node.image for node in mesh.data.materials[0].node_tree.nodes if node.type == 'TEX_IMAGE']
assert images and all(image.packed_file for image in images)
assert any(obj.type == 'ARMATURE' for obj in bpy.data.objects)
assert any(mod.type == 'ARMATURE' for mod in bpy.data.objects['SkinnedPart'].modifiers)
assert len(bpy.data.actions) > 0
assert not any(obj.type in ('CAMERA', 'LIGHT') for obj in bpy.data.objects)
assert bpy.data.texts['my model.ts'].as_string() == "export default () => 'source entry';\\n"
`,
      );
      await blender(verify, [output]);
      const original = await Deno.readFile(output);
      await assertRejects(
        () =>
          exportBlend(new Uint8Array([1, 2, 3]), output, {
            signal: AbortSignal.timeout(60_000),
          }),
        Error,
        "Blender export failed",
      );
      assertEquals(await Deno.readFile(output), original);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50);
      try {
        await assertRejects(() =>
          exportBlend(bytes, output, { signal: controller.signal })
        );
      } finally {
        clearTimeout(timer);
      }
      assertEquals(await Deno.readFile(output), original);
      for await (const child of Deno.readDir(directory)) {
        assert(!child.name.startsWith(".js3-blend-"));
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("Blender bridge reports missing executables and cleans staging files", async () => {
  const directory = await Deno.makeTempDir();
  const previous = Deno.env.get("JS3_BLENDER");
  Deno.env.set("JS3_BLENDER", join(directory, "missing-blender"));
  try {
    await assertRejects(
      () =>
        exportBlend(new Uint8Array(), join(directory, "model.blend"), {
          signal: new AbortController().signal,
        }),
      Error,
      "Blender executable not found",
    );
    const entries = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry.name);
    assertEquals(entries, []);
  } finally {
    if (previous === undefined) Deno.env.delete("JS3_BLENDER");
    else Deno.env.set("JS3_BLENDER", previous);
    await Deno.remove(directory, { recursive: true });
  }
});
