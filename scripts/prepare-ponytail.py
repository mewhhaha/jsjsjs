"""Fit a separately skinned ponytail to the female source, with a spring-bone chain.

blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-ponytail.py -- \
  /path/to/mpfb2/src /path/to/system-assets examples/female-source/source.blend examples/female-hair
"""
import bpy
import json
from mathutils import Vector, Matrix
from pathlib import Path
import struct
import sys
import tempfile

source, assets, female, output = [Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]]
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(female))
work = Path(tempfile.mkdtemp(prefix='workshop-ponytail-'))
sys.path.insert(0, str(source))
bpy.utils.extension_path_user = lambda package, path='', create=False: str(work/path)
import mpfb
mpfb.get_preference = {'mpfb_user_data':str(work), 'mh_user_data':str(assets)}.get
mpfb.register()
from mpfb.services.humanservice import HumanService

body = bpy.data.objects['StockFemale']
head_matrix = body.parent.matrix_world @ body.parent.data.bones['head'].matrix_local
hair = HumanService.add_mhclo_asset(
    str(assets/'hair/ponytail01/ponytail01.mhclo'), body,
    asset_type='Hair', subdiv_levels=0, material_type='GAMEENGINE')
bpy.context.view_layer.update()
world = hair.matrix_world.copy()
positions = [world @ v.co for v in hair.data.vertices]

# Classify connected stock hair cards into the scalp cap and hanging tail.
adjacency = {v.index:set() for v in hair.data.vertices}
for edge in hair.data.edges:
    a,b = edge.vertices
    adjacency[a].add(b)
    adjacency[b].add(a)
seen, tail_vertices = set(), set()
for seed in adjacency:
    if seed in seen:
        continue
    pending, island = [seed], []
    seen.add(seed)
    while pending:
        i = pending.pop()
        island.append(i)
        for neighbor in adjacency[i]:
            if neighbor not in seen:
                seen.add(neighbor)
                pending.append(neighbor)
    low_z = min(positions[i].z for i in island)
    front_y = min(positions[i].y for i in island)
    if low_z < head_matrix.translation.z-.12 and front_y > head_matrix.translation.y+.05:
        tail_vertices.update(island)
assert tail_vertices and len(tail_vertices) < len(positions)

for obj in list(bpy.data.objects):
    if obj != hair:
        bpy.data.objects.remove(obj, do_unlink=True)
hair.parent = None
hair.matrix_world = Matrix.Identity(4)
for vertex, position in zip(hair.data.vertices, positions):
    vertex.co = position
hair.modifiers.clear()
hair.vertex_groups.clear()
hair.name = 'PonytailHair'

armature = bpy.data.armatures.new('PonytailSkeleton')
rig = bpy.data.objects.new('PonytailRig', armature)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
anchor = armature.edit_bones.new('HairAnchor')
anchor.head = head_matrix.translation
anchor.tail = head_matrix @ Vector((0,.1,0))
anchor.align_roll(head_matrix.to_3x3().col[2])
root_z = max(positions[i].z for i in tail_vertices)
tip_z = min(positions[i].z for i in tail_vertices)
centers = []
for i in range(7):
    z = root_z + (tip_z-root_z)*i/6
    nearest = sorted(tail_vertices, key=lambda v:abs(positions[v].z-z))[:80]
    centers.append(Vector((sum(positions[v].x for v in nearest)/len(nearest),
                           sum(positions[v].y for v in nearest)/len(nearest),z)))
previous = anchor
names = []
for i in range(6):
    name = f'Ponytail_{i+1:02}'
    bone = armature.edit_bones.new(name)
    bone.head, bone.tail = centers[i], centers[i+1]
    bone.parent = previous
    bone.use_connect = i > 0
    previous = bone
    names.append(name)
bpy.ops.object.mode_set(mode='OBJECT')
groups = [hair.vertex_groups.new(name=name) for name in ['HairAnchor']+names]
for vertex in hair.data.vertices:
    if vertex.index not in tail_vertices:
        groups[0].add([vertex.index],1,'REPLACE')
        continue
    t = min(5,max(0,6*(root_z-vertex.co.z)/(root_z-tip_z)))
    lower = int(t)
    blend = t-lower
    groups[lower+1].add([vertex.index],1-blend,'REPLACE')
    if blend > 0 and lower < 5:
        groups[lower+2].add([vertex.index],blend,'REPLACE')
modifier = hair.modifiers.new('Hair deformation','ARMATURE')
modifier.object = rig
hair.parent = rig
for polygon in hair.data.polygons:
    polygon.use_smooth = True
material = hair.data.materials[0]
material.name = 'Ponytail_strands'
for node in material.node_tree.nodes:
    if node.type == 'BSDF_PRINCIPLED':
        node.inputs['Roughness'].default_value = .48
        node.inputs['Metallic'].default_value = 0
        node.inputs['Emission Strength'].default_value = 0

metadata = {
    'attachmentBone':'head', 'anchorBone':'HairAnchor',
    'chains':[{'bones':names, 'restLengths':[(centers[i+1]-centers[i]).length for i in range(6)]}],
    'fixedScalpVertices':len(positions)-len(tail_vertices),
    'tailVertices':len(tail_vertices),
    'triangles':sum(len(p.vertices)-2 for p in hair.data.polygons),
    'units':'meters',
    'simulation':'No baked simulation; drive local bone rotations with a spring-bone solver.',
}
hair['hairPhysics'] = metadata
rig['attachmentBone'] = 'head'
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output/'source.blend'), compress=True)
bpy.ops.export_scene.gltf(filepath=str(output/'ponytail.glb'), export_format='GLB',
                         export_animations=False, export_extras=True, export_morph=False)
path = output/'ponytail.glb'
raw = path.read_bytes()
length = struct.unpack_from('<I',raw,12)[0]
doc = json.loads(raw[20:20+length])
roots = doc['scenes'][doc.get('scene',0)]['nodes']
for node in doc['nodes']:
    skin_children = [i for i in node.get('children',[]) if 'skin' in doc['nodes'][i]]
    if skin_children:
        assert not any(k in node for k in ('matrix','translation','rotation','scale'))
        node['children'] = [i for i in node['children'] if i not in skin_children]
        roots.extend(skin_children)
for material in doc['materials']:
    material['alphaMode'] = 'MASK'
    material['alphaCutoff'] = .4
    material['doubleSided'] = True
data = json.dumps(doc,separators=(',',':')).encode()
data += b' '*(-len(data)%4)
tail = raw[20+length:]
path.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(data)+len(tail))+
                 struct.pack('<I4s',len(data),b'JSON')+data+tail)
(output/'physics.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('PONYTAIL_READY',json.dumps(metadata),flush=True)
