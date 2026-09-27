"""Fit MakeHuman long01 as a separate, physics-ready flowing hair asset.

blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-flowing-hair.py -- \
  /path/to/mpfb2/src /path/to/system-assets examples/female-source/source.blend examples/female-flowing-hair
"""
import bpy
import json
import math
from mathutils import Matrix, Vector
from pathlib import Path
import struct
import sys
import tempfile


source, assets, female, output = [Path(p).resolve() for p in sys.argv[sys.argv.index('--') + 1:]]
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(female))
work = Path(tempfile.mkdtemp(prefix='workshop-flowing-hair-'))
sys.path.insert(0, str(source))
bpy.utils.extension_path_user = lambda package, path='', create=False: str(work / path)
import mpfb
mpfb.get_preference = {'mpfb_user_data': str(work), 'mh_user_data': str(assets)}.get
mpfb.register()
from mpfb.services.humanservice import HumanService


body = bpy.data.objects['StockFemale']
head_matrix = body.parent.matrix_world @ body.parent.data.bones['head'].matrix_local
hair = HumanService.add_mhclo_asset(
    str(assets / 'hair/long01/long01.mhclo'), body,
    asset_type='Hair', subdiv_levels=0, material_type='GAMEENGINE')
bpy.context.view_layer.update()
world = hair.matrix_world.copy()
positions = [world @ vertex.co for vertex in hair.data.vertices]

# Fit in the body's rest-world metres, adding a very small, gradual outward
# sweep to the tips. The crown and roots retain their exact MPFB fit.
# Start deformation below the ear line, keeping the cap and temple coverage
# rigid when the hanging lengths move.
root_z = head_matrix.translation.z - .085
tip_z = min(position.z for position in positions)
assert root_z - tip_z > .4
for position in positions:
    progress = max(0., min(1., (root_z - position.z) / (root_z - tip_z)))
    sweep = max(0., (progress - .20) / .80) ** 2
    position.x += math.copysign(.012 * sweep, position.x) if abs(position.x) > .018 else 0.
    position.y += .004 * sweep

for obj in list(bpy.data.objects):
    if obj != hair:
        bpy.data.objects.remove(obj, do_unlink=True)
hair.parent = None
hair.matrix_world = Matrix.Identity(4)
for vertex, position in zip(hair.data.vertices, positions):
    vertex.co = position
hair.modifiers.clear()
hair.vertex_groups.clear()
hair.name = 'FlowingHair'

# Five widthwise chains leave the long side locks and the centre of the back
# independently addressable. Each bone follows the fitted mesh downwards.
chain_specs = [
    ('HairLeft', -.105),
    ('HairLeftBack', -.052),
    ('HairBack', 0.),
    ('HairRightBack', .052),
    ('HairRight', .105),
]
sections = 6
levels = [root_z + (tip_z - root_z) * i / sections for i in range(sections + 1)]


def center_at(target_x, z):
    # The long01 cards curve from the sides of the head toward the back.
    # A local mean keeps each rest chain in the corresponding hair volume.
    near = sorted(positions, key=lambda p: ((p.z-z)/.035)**2 + ((p.x-target_x)/.045)**2)[:65]
    y = sum(p.y for p in near) / len(near)
    return Vector((target_x, y, z))


armature = bpy.data.armatures.new('FlowingHairSkeleton')
rig = bpy.data.objects.new('FlowingHairRig', armature)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
anchor = armature.edit_bones.new('HairAnchor')
anchor.head = head_matrix.translation
anchor.tail = head_matrix @ Vector((0, .1, 0))
anchor.align_roll(head_matrix.to_3x3().col[2])
chains = []
for prefix, target_x in chain_specs:
    points = [center_at(target_x, z) for z in levels]
    previous = anchor
    names = []
    for index in range(sections):
        name = f'{prefix}_{index + 1:02}'
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = points[index], points[index + 1]
        bone.parent = previous
        bone.use_connect = index > 0
        previous = bone
        names.append(name)
    chains.append({'name': prefix, 'bones': names,
                   'restLengths': [(points[i + 1] - points[i]).length for i in range(sections)]})
bpy.ops.object.mode_set(mode='OBJECT')

groups = {'HairAnchor': hair.vertex_groups.new(name='HairAnchor')}
for chain in chains:
    for name in chain['bones']:
        groups[name] = hair.vertex_groups.new(name=name)


def width_weights(x):
    centers = [value for _, value in chain_specs]
    if x <= centers[0]:
        return [(0, 1.)]
    if x >= centers[-1]:
        return [(len(centers)-1, 1.)]
    for i in range(len(centers)-1):
        if centers[i] <= x <= centers[i+1]:
            blend = (x-centers[i]) / (centers[i+1]-centers[i])
            return [(i, 1.-blend), (i+1, blend)]
    raise AssertionError(x)


fixed_count = 0
chain_vertices = {chain['name']: 0 for chain in chains}
for vertex in hair.data.vertices:
    z = vertex.co.z
    if z >= root_z:
        groups['HairAnchor'].add([vertex.index], 1., 'REPLACE')
        fixed_count += 1
        continue
    depth = min(sections, max(0., sections * (root_z-z)/(root_z-tip_z)))
    segment = min(sections-1, int(depth))
    blend = depth-segment
    if segment == 0:
        groups['HairAnchor'].add([vertex.index], 1.-blend, 'REPLACE')
        if blend == 0:
            fixed_count += 1
    for chain_index, width in width_weights(vertex.co.x):
        chain = chains[chain_index]
        chain_vertices[chain['name']] += 1
        if segment == 0:
            groups[chain['bones'][0]].add([vertex.index], width*blend, 'REPLACE')
        else:
            groups[chain['bones'][segment-1]].add([vertex.index], width*(1.-blend), 'REPLACE')
            groups[chain['bones'][segment]].add([vertex.index], width*blend, 'REPLACE')

modifier = hair.modifiers.new('Hair deformation', 'ARMATURE')
modifier.object = rig
hair.parent = rig
for polygon in hair.data.polygons:
    polygon.use_smooth = True
material = hair.data.materials[0]
material.name = 'FlowingHair_strands'
for node in material.node_tree.nodes:
    if node.type == 'BSDF_PRINCIPLED':
        node.inputs['Roughness'].default_value = .9
        node.inputs['Metallic'].default_value = 0
        node.inputs['Emission Strength'].default_value = 0

metadata = {
    'attachmentBone': 'head',
    'anchorBone': 'HairAnchor',
    'chains': chains,
    'fixedScalpVertices': fixed_count,
    'hangingVertices': len(positions)-fixed_count,
    'chainVertexCounts': chain_vertices,
    'vertices': len(positions),
    'triangles': sum(len(p.vertices)-2 for p in hair.data.polygons),
    'units': 'meters',
    'simulation': 'No baked simulation; drive local chain bone rotations with a hair solver.',
}
hair['hairPhysics'] = metadata
rig['attachmentBone'] = 'head'
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output/'source.blend'), compress=True)
bpy.ops.export_scene.gltf(filepath=str(output/'flowing.glb'), export_format='GLB',
                          export_animations=False, export_extras=True, export_morph=False)

# Keep the skinned mesh at the glTF scene root so head.attach(HairAnchor) can
# place the rest-world skeleton and mesh together without a double transform.
path = output/'flowing.glb'
raw = path.read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+length])
roots = doc['scenes'][doc.get('scene', 0)]['nodes']
for node in doc['nodes']:
    skin_children = [i for i in node.get('children', []) if 'skin' in doc['nodes'][i]]
    if skin_children:
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
        node['children'] = [i for i in node['children'] if i not in skin_children]
        roots.extend(skin_children)
for gltf_material in doc['materials']:
    gltf_material['alphaMode'] = 'MASK'
    gltf_material['alphaCutoff'] = .5
    gltf_material['doubleSided'] = True
data = json.dumps(doc, separators=(',', ':')).encode()
data += b' ' * (-len(data) % 4)
tail = raw[20+length:]
path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20+len(data)+len(tail)) +
                 struct.pack('<I4s', len(data), b'JSON') + data + tail)
(output/'physics.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('FLOWING_HAIR_READY', json.dumps(metadata), flush=True)
