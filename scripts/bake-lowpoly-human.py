"""Bake a rigged low-poly derivative of the stock GLB, using Blender headlessly.

blender -b --factory-startup --python-exit-code 1 --python scripts/bake-lowpoly-human.py -- \
  examples/stock-human/base.glb examples/lowpoly-human
Optional third/fourth arguments supply UV-aligned skin albedo and normal images.
"""
import bpy
import bmesh
import json
from pathlib import Path
import struct
import sys

args = sys.argv[sys.argv.index('--') + 1:]
source, destination = [Path(p).resolve() for p in args[:2]]
destination.mkdir(parents=True, exist_ok=True)
skin_albedo = Path(args[2]).resolve() if len(args) > 2 else destination / 'skin-albedo.png'
skin_normal = Path(args[3]).resolve() if len(args) > 3 else destination / 'skin-source-normal.png'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
female = 'StockFemale' in bpy.data.objects
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.render.bake.margin = 12
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.025
scene.render.bake.max_ray_distance = 0.06
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '8'
bpy.context.preferences.filepaths.save_version = 0

ratios = {'body': .24, 'male_casualsuit01': .14, 'shoes01': .20,
          'teeth_base': .05, 'short04': 1.0, 'eyebrow001': 1.0,
          'eyelashes01': 1.0, 'low-poly': 1.0}
if female:
    body_triangles = sum(len(p.vertices)-2 for p in bpy.data.objects['StockFemale'].data.polygons)
    ratios.update(body=.75 if body_triangles < 5000 else .075, female_casualsuit01=.15, shoes05=.075,
                  eyebrow001=.5, eyelashes01=.5)
bake_kinds = ('body', 'male_casualsuit01', 'female_casualsuit01', 'shoes01', 'shoes05')
report = {}
for obj in list(scene.objects):
    if obj.type == 'MESH' and not obj.data.materials:
        bpy.data.objects.remove(obj, do_unlink=True)
    elif female and obj.type == 'MESH' and 'teeth_base' in obj.name:
        bpy.data.objects.remove(obj, do_unlink=True)
meshes = [o for o in scene.objects if o.type == 'MESH']

def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def image_node(material, name, size, color=False):
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    node = material.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    material.node_tree.nodes.active = node
    return node

for low in meshes:
    active(low)
    mat = low.data.materials[0]
    kind = 'body' if low.name in ('StockMale', 'StockFemale') else low.name.split('.')[-1]
    if female and kind == 'female_casualsuit01':
        # glTF splits vertices at UV seams. Rejoin coincident garment vertices
        # before reduction so the two sides cannot collapse into visible cracks.
        # UVs live on face corners and survive this topology weld.
        bm = bmesh.new()
        bm.from_mesh(low.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
        bm.to_mesh(low.data)
        bm.free()
    if female and kind == 'body':
        # This clothed export has full-length trousers and shoes. Remove the
        # leftover lower-leg skin from the transferred stock clothing mask;
        # its large proxy triangles can cross the reduced trouser cuffs.
        bm = bmesh.new()
        bm.from_mesh(low.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < .55], context='VERTS')
        bm.to_mesh(low.data)
        bm.free()
    # Imported stock GLB has no morphs: skin weights and UVs survive collapse.
    original_triangles = sum(len(p.vertices)-2 for p in low.data.polygons)
    high = low.copy()
    high.data = low.data.copy()
    scene.collection.objects.link(high)
    high.name = low.name + '_bake_source'
    high.data.materials.clear()
    high_mat = mat.copy()
    high.data.materials.append(high_mat)
    low.data.materials[0] = mat.copy()
    mat = low.data.materials[0]
    mat.name = 'Lowpoly_' + kind
    tree = high_mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')

    if kind == 'body' and skin_albedo.exists():
        for link in list(tree.links):
            if link.to_node == bsdf and link.to_socket.name == 'Base Color':
                tex = tree.nodes.new('ShaderNodeTexImage')
                tex.image = bpy.data.images.load(str(skin_albedo))
                tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        low_bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(skin_albedo), check_existing=True)
        mat.node_tree.links.new(tex.outputs['Color'], low_bsdf.inputs['Base Color'])
    if kind == 'body' and skin_normal.exists():
        tex = tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(skin_normal))
        tex.image.colorspace_settings.name = 'Non-Color'
        detail_normal = tree.nodes.new('ShaderNodeNormalMap')
        tree.links.new(tex.outputs['Color'], detail_normal.inputs['Color'])
        tree.links.new(detail_normal.outputs['Normal'], bsdf.inputs['Normal'])

    # Geometric source curvature and existing cloth normal detail are baked
    # together with subtle procedural microrelief. This is not scan-derived data.
    if kind in bake_kinds:
        noise = tree.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 650 if kind == 'body' else 380
        noise.inputs['Detail'].default_value = 2
        bump = tree.nodes.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value = .00010 if kind == 'body' else .00018
        bump.inputs['Strength'].default_value = .35
        bump.invert = kind == 'body'
        if bsdf.inputs['Normal'].is_linked:
            tree.links.new(bsdf.inputs['Normal'].links[0].from_socket, bump.inputs['Normal'])
        tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # One subdivision level on the bake source only. The exported mesh stays low.
    if kind in bake_kinds:
        subdiv = high.modifiers.new('Bake source surface', 'SUBSURF')
        subdiv.levels = 1
        subdiv.render_levels = 1

    active(low)
    if ratios[kind] < 1:
        decimate = low.modifiers.new('Game mesh', 'DECIMATE')
        decimate.ratio = ratios[kind]
        decimate.use_collapse_triangulate = True
        preserve = None
        if kind == 'body' or (female and kind == 'female_casualsuit01'):
            # Keep eyelid/lip rims, garment openings and UV seams intact.
            bm = bmesh.new()
            bm.from_mesh(low.data)
            bm.verts.ensure_lookup_table()
            boundaries = [v.index for v in bm.verts if v.is_boundary]
            bm.free()
            preserve = low.vertex_groups.new(name='LOD_collapse')
            preserve.add(list(range(len(low.data.vertices))), 1.0, 'REPLACE')
            if boundaries:
                preserve.add(boundaries, 0.0, 'REPLACE')
            decimate.vertex_group = preserve.name
            decimate.vertex_group_factor = 1.0
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        if 'LOD_collapse' in low.vertex_groups:
            low.vertex_groups.remove(low.vertex_groups['LOD_collapse'])
    if female and kind == 'female_casualsuit01':
        # Give the coarse garment clearance above the independently reduced
        # body, especially at the collar and sleeve openings.
        for vertex in low.data.vertices:
            vertex.co += vertex.normal * .006
        low.data.update()
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    triangles = sum(len(p.vertices)-2 for p in low.data.polygons)
    report[kind] = {'source_triangles': original_triangles, 'triangles': triangles}
    print('LOWPOLY', kind, original_triangles, '->', triangles, flush=True)

    if kind in bake_kinds:
        size = 1024 if kind.startswith('shoes') else 2048
        normal = image_node(mat, kind + '_normal', size)
        high.select_set(True)
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        normal.image.filepath_raw = str(destination / (kind + '-normal.png'))
        normal.image.save()
        low_tree = mat.node_tree
        low_bsdf = next(n for n in low_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        normal_map = low_tree.nodes.new('ShaderNodeNormalMap')
        low_tree.links.new(normal.outputs['Color'], normal_map.inputs['Color'])
        low_tree.links.new(normal_map.outputs['Normal'], low_bsdf.inputs['Normal'])

        # Spatially stable, UV-baked roughness variation with conservative ranges.
        roughness = image_node(mat, kind + '_roughness', size)
        active(low)
        scene.render.bake.use_selected_to_active = False
        grain = low_tree.nodes.new('ShaderNodeTexNoise')
        grain.inputs['Scale'].default_value = 180
        grain.inputs['Detail'].default_value = 3
        ramp = low_tree.nodes.new('ShaderNodeMapRange')
        ramp.inputs['To Min'].default_value = .43 if kind == 'body' else .56 if kind == 'shoes01' else .72
        ramp.inputs['To Max'].default_value = .63 if kind == 'body' else .72 if kind == 'shoes01' else .9
        low_tree.links.new(grain.outputs['Fac'], ramp.inputs['Value'])
        emission = low_tree.nodes.new('ShaderNodeEmission')
        low_tree.links.new(ramp.outputs['Result'], emission.inputs['Color'])
        output = next(n for n in low_tree.nodes if n.type == 'OUTPUT_MATERIAL')
        low_tree.links.new(emission.outputs[0], output.inputs['Surface'])
        bpy.ops.object.bake(type='EMIT')
        roughness.image.filepath_raw = str(destination / (kind + '-roughness.png'))
        roughness.image.save()
        low_tree.links.new(low_bsdf.outputs[0], output.inputs['Surface'])
        low_tree.links.new(roughness.outputs['Color'], low_bsdf.inputs['Roughness'])
        low_tree.nodes.remove(emission)
        scene.render.bake.use_selected_to_active = True
    bpy.data.objects.remove(high, do_unlink=True)

for obj in meshes:
    active(obj)
    obj.data.calc_loop_triangles()
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

for material in bpy.data.materials:
    if material.name == 'Lowpoly_body':
        for node in material.node_tree.nodes:
            if node.type == 'NORMAL_MAP':
                node.inputs['Strength'].default_value = 0.28
    if material.name == 'Lowpoly_low-poly':
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Roughness'].default_value = 0.12

bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(destination / 'source.blend'), compress=True)
bpy.ops.export_scene.gltf(filepath=str(destination / 'character.glb'), export_format='GLB',
                         export_animations=False, export_morph=False, export_tangents=True)

# Identity armature wrappers may be introduced by the Blender importer.
path = destination / 'character.glb'
raw = path.read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+length])
for material in doc['materials']:
    if material['name'] == 'Lowpoly_body':
        material['normalTexture']['scale'] = 0.28
    if material['name'] == 'Lowpoly_low-poly':
        material['pbrMetallicRoughness']['roughnessFactor'] = 0.12
roots = doc['scenes'][doc.get('scene', 0)]['nodes']
for node in doc['nodes']:
    if 'children' not in node:
        continue
    skinned = [i for i in node['children'] if 'skin' in doc['nodes'][i]]
    if skinned:
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
        node['children'] = [i for i in node['children'] if i not in skinned]
        roots.extend(skinned)
data = json.dumps(doc, separators=(',', ':')).encode()
data += b' ' * (-len(data) % 4)
tail = raw[20+length:]
path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20+len(data)+len(tail)) + struct.pack('<I4s', len(data), b'JSON') + data + tail)
report['total_triangles'] = sum(v['triangles'] for v in report.values())
(destination / 'manifest.json').write_text(json.dumps(report, indent=2)+'\n')
print('BAKED_CHARACTER_READY', report, flush=True)
