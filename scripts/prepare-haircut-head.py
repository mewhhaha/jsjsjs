"""Derive the wig fitting bust from the bundled CC0 MakeHuman source.

blender -b --factory-startup --python-exit-code 1 \
  --python scripts/prepare-haircut-head.py

Uses only already bundled meshes and textures; no add-on is required.
"""

import json
import math
from pathlib import Path
import struct
import subprocess

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "examples/haircuts/assets"
DEST.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT / "examples/female-source/source.blend"))

# Blender source is Z-up with the face pointing -Y. GLB export changes axes to
# the viewer's Y-up/+Z-forward frame. Use the crown as the shared attachment
# landmark; facial features and the ear cartilage come from the source mesh.
SCALE_X = 5.8
SCALE_Y = 4.3
SCALE_Z = 5.8
CROWN_Z = 1.7035615444
DEPTH_CENTER = -0.051
CUT_Z = CROWN_Z - 2.02 / SCALE_Z

keep = {
    "StockFemale": "head_skin",
    "StockFemale.low-poly": "eyes",
    "StockFemale.eyebrow001": "eyebrows",
    "StockFemale.eyelashes01": "eyelashes",
    "StockFemale.teeth_base": "teeth",
    "StockFemale.female_casualsuit01": "jacket",
}
sources = [obj for obj in bpy.context.scene.objects if obj.name in keep]
baked = []
depsgraph = bpy.context.evaluated_depsgraph_get()
for source in sources:
    name = keep[source.name]
    # The evaluated source bakes the phenotype, helper mask and neutral pose,
    # without retaining any rig or dependency on the MPFB add-on.
    data = bpy.data.meshes.new_from_object(source.evaluated_get(depsgraph))
    mesh = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(mesh)
    mesh.matrix_world = source.matrix_world.copy()
    if name in {"head_skin", "jacket"}:
        bm = bmesh.new()
        bm.from_mesh(data)
        result = bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
            plane_co=Vector((0, 0, CUT_Z - .02)), plane_no=Vector((0, 0, 1)),
            clear_inner=True, clear_outer=False, dist=0.000001,
        )
        boundary = [edge for edge in bm.edges if edge.is_boundary
                    and all(abs(v.co.z - CUT_Z + .02) < 0.00001 for v in edge.verts)]
        if boundary:
            bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
        bm.to_mesh(data)
        bm.free()
    for polygon in data.polygons:
        polygon.use_smooth = True
    # Two subdivision steps preserve the source's facial loops, lips, nostrils,
    # eyelids and ears; no procedural replacement facial geometry is involved.
    if name not in {"eyebrows", "eyelashes", "teeth"}:
        modifier = mesh.modifiers.new("Portrait surface", "SUBSURF")
        modifier.levels = 2 if name != "jacket" else 1
        modifier.render_levels = modifier.levels
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if name in {"head_skin", "jacket"}:
        # Cut after smoothing so the stand sits on a genuinely flat plane.
        bm = bmesh.new()
        bm.from_mesh(mesh.data)
        bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
            plane_co=Vector((0, 0, CUT_Z)), plane_no=Vector((0, 0, 1)),
            clear_inner=True, clear_outer=False, dist=.000001,
        )
        boundary = [edge for edge in bm.edges if edge.is_boundary
                    and all(abs(v.co.z - CUT_Z) < .00001 for v in edge.verts)]
        if boundary:
            caps = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
            for face in caps["faces"]:
                face.smooth = False
            # Separate the planar cut's normals from the curved cloth surface.
            bmesh.ops.split_edges(bm, edges=boundary)
        bm.to_mesh(mesh.data)
        bm.free()
    if name == "eyes":
        # The portrait adaptation's irises are larger than the stock atlas.
        # Adjust sampling around each iris to preserve adult eye proportions.
        for uv in mesh.data.uv_layers.active.data:
            u, v = uv.uv
            cx, cy = (.704, .70) if u + v > 1 else (.296, .295)
            uv.uv = ((u - cx) * 1.18 + cx, (v - cy) * 1.18 + cy)
    for vertex in mesh.data.vertices:
        x, y, z = vertex.co
        # Narrow only the lower shoulder crop to a portrait stand footprint;
        # the head, ears, neck and collar retain their source proportions.
        shoulder = max(0, min(1, (1.46 - z) / (1.46 - CUT_Z)))
        width = 1 - 0.35 * shoulder
        vertex.co = Vector((x * SCALE_X * width,
                            (y - DEPTH_CENTER) * SCALE_Y,
                            1.4 + (z - CROWN_Z) * SCALE_Z))
    mesh.data.update()
    baked.append(mesh)

for obj in list(bpy.context.scene.objects):
    if obj not in baked:
        bpy.data.objects.remove(obj, do_unlink=True)

for mesh in baked:
    for old in list(mesh.data.materials):
        material = old.copy()
        material.name = f"portrait_{mesh.name}"
        mesh.data.materials[mesh.data.materials.find(old.name)] = material
        nodes, links = material.node_tree.nodes, material.node_tree.links
        principled = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
        principled.inputs["Roughness"].default_value = .62
        principled.inputs["Metallic"].default_value = 0
        principled.inputs["Emission Strength"].default_value = 0
        for link in list(links):
            if link.to_node == principled and link.to_socket.name == "Alpha":
                if mesh.name not in {"eyebrows", "eyelashes"}:
                    links.remove(link)
        principled.inputs["Alpha"].default_value = 1
        if mesh.name == "head_skin":
            image = bpy.data.images.load(str(ROOT / "examples/female/skin-albedo.png"))
            image.name = "CC0_Margaret_Toigo_Freckles"
            for node in nodes:
                if node.type == "TEX_IMAGE":
                    node.image = image
        elif mesh.name == "eyes":
            image = bpy.data.images.load(str(ROOT / "examples/female-portrait/eyes-albedo.png"))
            for node in nodes:
                if node.type == "TEX_IMAGE":
                    node.image = image
            principled.inputs["Roughness"].default_value = .2
        elif mesh.name == "jacket":
            # Preserve the actual lapel/collar mesh but use an understated
            # garment material so the hairstyle remains the subject.
            for link in list(links):
                if link.to_node == principled:
                    links.remove(link)
            for node in list(nodes):
                if node != principled and node.type != "OUTPUT_MATERIAL":
                    nodes.remove(node)
            principled.inputs["Base Color"].default_value = (.045, .06, .065, 1)
            principled.inputs["Roughness"].default_value = .87

# Radial lookup of the actual subdivided scalp for the procedural guide roots.
# Coordinates here remain Blender's X/-Y/Z until the GLB export converts them.
head = next(mesh for mesh in baked if mesh.name == "head_skin")
surface = BVHTree.FromPolygons([vertex.co for vertex in head.data.vertices],
                              [polygon.vertices for polygon in head.data.polygons])
rows, columns, theta_max = 65, 128, 2.15
origin = Vector((0, 0, .78))
factors = []
for row in range(rows):
    theta = theta_max * row / (rows - 1)
    for column in range(columns):
        phi = 2 * math.pi * column / columns
        direction = Vector((.472 * math.sin(theta) * math.sin(phi),
                            -.413 * math.sin(theta) * math.cos(phi),
                            .636 * math.cos(theta)))
        hit, normal, index, distance = surface.ray_cast(origin, direction.normalized())
        factors.append(round(distance / direction.length, 6) if hit else 1)
scalp = {"rows": rows, "columns": columns, "thetaMax": theta_max,
         "center": [0, .78, 0], "radii": [.472, .636, .413],
         "factors": factors}
(DEST / "scalp.json").write_text(json.dumps(scalp) + "\n")

bpy.data.orphans_purge(do_recursive=True)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(DEST / "head.blend"), compress=True)
bpy.ops.export_scene.gltf(
    filepath=str(DEST / "head.glb"), export_format="GLB",
    export_animations=False, export_morph=False, export_extras=False,
    export_yup=True, export_skins=False, export_tangents=False,
)

# Small facial overlays retain their soft alpha; the anatomical skin is opaque.
path = DEST / "head.glb"
glb = path.read_bytes()
size = struct.unpack_from("<I", glb, 12)[0]
document = json.loads(glb[20:20 + size])
for material in document["materials"]:
    overlay = any(word in material["name"] for word in ("eyebrows", "eyelashes"))
    material["alphaMode"] = "BLEND" if overlay else "OPAQUE"
    if overlay:
        material.pop("alphaCutoff", None)
        material["doubleSided"] = True
encoded = json.dumps(document, separators=(",", ":")).encode()
encoded += b" " * (-len(encoded) % 4)
tail = glb[20 + size:]
path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail))
                 + struct.pack("<I4s", len(encoded), b"JSON") + encoded + tail)
manifest = {
    "source": "../../female-source/source.blend; MakeHuman Community / MPFB CC0 graphical assets",
    "skin": "Margaret Toigo, Freckles skin, CC0; ../../female/skin-albedo.png",
    "eyes": "../../female-portrait/eyes-albedo.png; generated adaptation of CC0 eye atlas",
    "license": "../../stock-human/LICENSE.md",
    "frame": {"up": "+Y", "face": "+Z", "crownY": 1.4, "bustBaseY": -.62},
    "sourceTransform": {"scaleX": SCALE_X, "scaleY": SCALE_Y, "scaleZ": SCALE_Z,
                        "sourceCrownZ": CROWN_Z, "sourceDepthCenter": DEPTH_CENTER},
    "meshes": {mesh.name: len(mesh.data.polygons) for mesh in baked},
    "triangles": sum(document["accessors"][p["indices"]]["count"] // 3
                     for mesh in document["meshes"] for p in mesh["primitives"]),
    "rigged": False,
}
(DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
subprocess.run(["deno", "fmt", str(DEST / "manifest.json"), str(DEST / "scalp.json")],
               check=True)
print("HAIRCUT_HEAD_READY", json.dumps(manifest))
