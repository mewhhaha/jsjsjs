"""Prepare MakeHuman's stock assets once; the viewer only needs the resulting GLB.

blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-stock-human.py -- \
  /path/to/mpfb2/src /path/to/unpacked/system-assets /tmp/mpfb-work examples/stock-human

MPFB source and asset-pack provenance are recorded in examples/stock-human/CREDITS.md.
No Blender preferences or installed add-ons are changed.
"""

import json
from pathlib import Path
import sys
import struct

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
source, assets, work, destination = map(Path, args[:4])
female = len(args) > 4 and args[4] == "female"
hair_name = args[5] if len(args) > 5 else "short04"
proxy_name = args[6] if len(args) > 6 else None
source, assets, work, destination = [p.resolve() for p in (source, assets, work, destination)]
destination.mkdir(parents=True, exist_ok=True)
work.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(source))

# MPFB normally resolves paths through an installed Blender extension. Give this
# temporary source import its own paths instead; never write to user preferences.
bpy.utils.extension_path_user = lambda package, path="", create=False: str(work / path)
import mpfb

preferences = {"mpfb_user_data": str(work), "mh_user_data": str(assets)}
mpfb.get_preference = preferences.get
mpfb.register()

from mpfb.services.humanservice import HumanService
from mpfb.services.targetservice import TargetService
from mpfb.services.exportservice import ExportService

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
macro = TargetService.get_default_macro_info_dict()
macro.update(gender=0.0 if female else 1.0, age=0.5 if female else 0.45,
             muscle=0.3 if female else 0.55, weight=0.43 if female else 0.45)
if female:
    macro.update(cupsize=.72, firmness=.68, proportions=.65, height=.58)
macro["race"] = {"caucasian": 1.0, "asian": 0.0, "african": 0.0}
human = HumanService.create_human(macro_detail_dict=macro)
human.name = "StockFemale" if female else "StockMale"
details = {}
if female:
    # Adult, stylized feminine silhouette; facial changes stay within stock targets.
    details = {
        'torso/measure-waist-circ-decr': .30,
        'hip/hip-scale-horiz-incr': .32,
        'chin/chin-width-decr': .24,
        'chin/chin-height-decr': .10,
        'cheek/l-cheek-bones-incr': .16,
        'cheek/r-cheek-bones-incr': .16,
        'mouth/mouth-upperlip-volume-incr': .30,
        'mouth/mouth-lowerlip-volume-incr': .24,
        'eyes/l-eye-scale-incr': .10,
        'eyes/r-eye-scale-incr': .10,
        'nose/nose-scale-horiz-decr': .15,
        'neck/neck-scale-horiz-decr': .10,
    }
    for name, weight in details.items():
        TargetService.load_target(human, str(source/'mpfb/data/targets'/(name+'.target.gz')), weight=weight)
    bpy.context.view_layer.update()
skin_name = "young_caucasian_female" if female else "middleage_caucasian_male"
HumanService.set_character_skin(
    str(assets / "skins" / skin_name / (skin_name + ".mhmat")),
    human, skin_type="GAMEENGINE",
)
rig = HumanService.add_builtin_rig(human, "game_engine")
proxy = None
if proxy_name:
    proxy = HumanService.add_mhclo_asset(
        str(assets / 'proxymeshes' / proxy_name / (proxy_name+'.proxy')),
        human, asset_type='Proxymeshes', subdiv_levels=0, material_type='NONE')
    proxy.data.materials.clear()
    proxy.data.materials.append(human.data.materials[0].copy())
for folder, name, kind in [
    ("eyes", "low-poly", "Eyes"),
    ("eyebrows", "eyebrow001", "Eyebrows"),
    ("eyelashes", "eyelashes01", "Eyelashes"),
    ("teeth", "teeth_base", "Teeth"),
    ("hair", hair_name, "Hair"),
    ("clothes", "female_casualsuit01" if female else "male_casualsuit01", "Clothes"),
    ("clothes", "shoes05" if female else "shoes01", "Clothes"),
]:
    if name == "none":
        continue
    HumanService.add_mhclo_asset(
        str(assets / folder / name / (name + ".mhclo")), human,
        asset_type=kind, subdiv_levels=0, material_type="GAMEENGINE",
    )

if proxy:
    # Leave a ring of skin under garment openings. A coarse proxy otherwise
    # loses whole faces at the collar/cuffs when high-resolution masks transfer.
    for modifier in proxy.modifiers:
        if modifier.type != 'MASK' or not modifier.invert_vertex_group:
            continue
        group = proxy.vertex_groups[modifier.vertex_group]
        hidden = {v.index for v in proxy.data.vertices
                  if any(g.group == group.index and g.weight > 0 for g in v.groups)}
        rim = set()
        for edge in proxy.data.edges:
            a, b = edge.vertices
            if (a in hidden) != (b in hidden):
                rim.add(a if a in hidden else b)
        if rim:
            group.remove(list(rim))

# Keep the editable, complete source with its stock target keys and clothing masks.
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(destination / "source.blend"), compress=True)

# Collapse phenotype keys at their current values, then bake only visibility masks.
# Preserve the armature modifier and the original stock weights.
bpy.context.view_layer.objects.active = human
mixed = human.shape_key_add(name="ExportShape", from_mix=True)
positions = [vertex.co.copy() for vertex in mixed.data]
human.shape_key_clear()
for vertex, position in zip(human.data.vertices, positions):
    vertex.co = position
human.data.update()
bpy.context.view_layer.update()
ExportService.bake_modifiers_remove_helpers(
    human, bake_masks=True, bake_subdiv=False, remove_helpers=True,
)
if proxy:
    human_name = human.name
    bpy.data.objects.remove(human, do_unlink=True)
    proxy.name = human_name
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    for poly in obj.data.polygons:
        poly.use_smooth = True
    for modifier in list(obj.modifiers):
        if modifier.type == "SUBSURF":
            obj.modifiers.remove(modifier)
    # Four influences match the Three.js skinning pipeline.
    for group in list(obj.vertex_groups):
        if group.name not in rig.data.bones:
            obj.vertex_groups.remove(group)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)

for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            node.inputs["Roughness"].default_value = 0.72
            node.inputs["Metallic"].default_value = 0
            node.inputs["Emission Strength"].default_value = 0

bpy.ops.export_scene.gltf(
    filepath=str(destination / "base.glb"), export_format="GLB",
    export_animations=False, export_morph=False, export_extras=False,
    export_yup=True, export_skins=True, export_tangents=True,
)
# MPFB's GameEngine material wires alpha on every surface, so Blender exports
# even solid skin as BLEND. Correct the portable asset, not just our viewer:
# opaque skin/clothes and depth-tested cutouts for the hair/eyebrow/lash cards.
glb_path = destination / "base.glb"
glb = glb_path.read_bytes()
json_size = struct.unpack_from("<I", glb, 12)[0]
document = json.loads(glb[20:20 + json_size])
armature_index = next(i for i, node in enumerate(document["nodes"]) if node.get("name") == rig.name)
armature_node = document["nodes"][armature_index]
assert not any(key in armature_node for key in ("matrix", "translation", "rotation", "scale"))
# The armature wrapper is identity; make skinned meshes scene roots, as glTF
# defines their transforms through the joints rather than through mesh parents.
mesh_roots = [i for i in armature_node["children"] if "skin" in document["nodes"][i]]
armature_node["children"] = [i for i in armature_node["children"] if i not in mesh_roots]
document["scenes"][document.get("scene", 0)]["nodes"].extend(mesh_roots)
for material in document["materials"]:
    cutout = any(name in material["name"] for name in ("eyebrow", "eyelashes", hair_name))
    material["alphaMode"] = "MASK" if cutout else "OPAQUE"
    if cutout:
        material["alphaCutoff"] = 0.4
encoded = json.dumps(document, separators=(",", ":")).encode()
encoded += b" " * (-len(encoded) % 4)
tail = glb[20 + json_size:]
glb_path.write_bytes(
    struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail))
    + struct.pack("<I4s", len(encoded), b"JSON") + encoded + tail
)
manifest = {
    "source": "MakeHuman / MPFB stock basemesh and game_engine rig",
    "bones": [bone.name for bone in rig.data.bones],
    "meshes": {obj.name: len(obj.data.polygons) for obj in bpy.context.scene.objects if obj.type == "MESH"},
    "phenotype": macro,
    "detail_targets": details,
    "triangles": sum(document["accessors"][p["indices"]]["count"] // 3 for m in document["meshes"] for p in m["primitives"]),
}
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("STOCK_HUMAN_READY", json.dumps(manifest))
