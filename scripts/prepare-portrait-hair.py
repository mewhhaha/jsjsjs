"""Reduce the flowing hair cards for the portrait, retaining UVs and the rig.

blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-portrait-hair.py
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
import struct


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'examples/female-flowing-hair/flowing.glb'
OUTPUT = ROOT / 'examples/female-portrait/hair.glb'
TARGET_TRIANGLES = 1800

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE), merge_vertices=True)
hair = bpy.data.objects['FlowingHair']
rig = hair.parent
assert rig and rig.type == 'ARMATURE'
for obj in list(bpy.data.objects):
    if obj not in (hair, rig):
        bpy.data.objects.remove(obj, do_unlink=True)
before = sum(len(p.vertices) - 2 for p in hair.data.polygons)
bones = [bone.name for bone in rig.data.bones]

# Keep original UV islands disconnected across seams while reducing their
# interiors. Boundary and seam vertices are discouraged from collapsing so the
# alpha-masked silhouettes of the strand cards keep their shape.
bm = bmesh.new()
bm.from_mesh(hair.data)
bm.verts.ensure_lookup_table()
uv = bm.loops.layers.uv.active
protected = set()
for edge in bm.edges:
    seam = edge.is_boundary
    if len(edge.link_loops) == 2:
        a, b = edge.link_loops
        for vertex in edge.verts:
            auv = a[uv].uv if a.vert == vertex else a.link_loop_next[uv].uv
            buv = b[uv].uv if b.vert == vertex else b.link_loop_next[uv].uv
            seam |= (auv - buv).length > 1e-6
    if seam:
        edge.seam = True
        protected.update(vertex.index for vertex in edge.verts)
bm.to_mesh(hair.data)
bm.free()
group = hair.vertex_groups.new(name='PortraitReduction')
group.add(list(range(len(hair.data.vertices))), 1., 'REPLACE')
if protected:
    group.add(sorted(protected), .05, 'REPLACE')
bpy.context.view_layer.objects.active = hair
hair.select_set(True)
modifier = hair.modifiers.new('Portrait card reduction', 'DECIMATE')
modifier.ratio = TARGET_TRIANGLES / before
modifier.use_collapse_triangulate = True
modifier.vertex_group = group.name
modifier.vertex_group_factor = 10.
# Place the reduction ahead of deformation so weights are interpolated in rest
# space and no armature transform can become baked into the card geometry.
bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
bpy.ops.object.modifier_apply(modifier=modifier.name)
hair.vertex_groups.remove(hair.vertex_groups['PortraitReduction'])
hair.data.update()
after = sum(len(p.vertices) - 2 for p in hair.data.polygons)
assert 1500 <= after <= 2000, after
assert all(math.isfinite(value) for vertex in hair.data.vertices for value in vertex.co)
assert hair.data.uv_layers.active
assert len(hair.vertex_groups) == len(bones)
assert all(vertex.groups for vertex in hair.data.vertices)
assert all(abs(sum(group.weight for group in vertex.groups)-1) < .002
           for vertex in hair.data.vertices)
assert any(m.type == 'ARMATURE' and m.object == rig for m in hair.modifiers)
hair['portraitTriangles'] = after
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB',
                          export_animations=False, export_extras=True, export_morph=False)

# Match flowing.glb: the skinned mesh lives at the glTF scene root. The viewer
# attaches HairAnchor to the body head; parenting the mesh under the skeleton
# as well would apply the attachment transform twice.
raw = OUTPUT.read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + length])
roots = doc['scenes'][doc.get('scene', 0)]['nodes']
for node in doc['nodes']:
    skinned = [i for i in node.get('children', []) if 'skin' in doc['nodes'][i]]
    if skinned:
        assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
        node['children'] = [i for i in node['children'] if i not in skinned]
        roots.extend(i for i in skinned if i not in roots)
for material in doc['materials']:
    material['alphaMode'] = 'MASK'
    material['alphaCutoff'] = .5
    material['doubleSided'] = True
assert len(doc['skins']) == 1
assert len(doc['skins'][0]['joints']) == len(bones)
assert any(node.get('name') == 'HairAnchor' for node in doc['nodes'])
assert all(i in roots for i, node in enumerate(doc['nodes']) if 'skin' in node)
binary = raw[28 + length:]


def values(accessor_index):
    accessor = doc['accessors'][accessor_index]
    view = doc['bufferViews'][accessor['bufferView']]
    component = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[accessor['componentType']]
    count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    fmt = '<' + component * count
    stride = view.get('byteStride', struct.calcsize(fmt))
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return [struct.unpack_from(fmt, binary, start + i * stride)
            for i in range(accessor['count'])]


exported_vertices = 0
exported_triangles = 0
for mesh in doc['meshes']:
    for primitive in mesh['primitives']:
        assert {'POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'} <= primitive['attributes'].keys()
        attributes = primitive['attributes']
        positions = values(attributes['POSITION'])
        indices = [row[0] for row in values(primitive['indices'])]
        assert all(math.isfinite(c) for position in positions for c in position)
        assert max(indices) < len(positions)
        assert all(0 <= joint < len(bones) for row in values(attributes['JOINTS_0']) for joint in row)
        assert all(abs(sum(row) - 1.) < 1e-5 for row in values(attributes['WEIGHTS_0']))
        exported_vertices += len(positions)
        exported_triangles += len(indices) // 3
assert exported_triangles == after
assert doc.get('images') and all('bufferView' in img for img in doc['images'])
data = json.dumps(doc, separators=(',', ':')).encode()
data += b' ' * (-len(data) % 4)
tail = raw[20 + length:]
OUTPUT.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(data) + len(tail)) +
                   struct.pack('<I4s', len(data), b'JSON') + data + tail)
manifest = {
    'source': 'examples/female-flowing-hair/flowing.glb',
    'sourceTriangles': before,
    'triangles': after,
    'vertices': exported_vertices,
    'bones': len(bones),
    'anchorBone': 'HairAnchor',
    'boundaryAndSeamVerticesProtected': len(protected),
    'embeddedOriginalTexture': True,
    'alphaMode': 'MASK',
    'doubleSided': True,
    'meshAtSceneRoot': True,
}
OUTPUT.with_name('hair-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('PORTRAIT_HAIR_READY', json.dumps(manifest), flush=True)
