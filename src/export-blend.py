"""Import portable GLB scene data and save a self-contained Blender document."""

import os
import sys
import json
import math
import struct

import bpy


def strand_metadata(source):
    """Read JSON directly: Blender custom properties may stringify nested arrays."""
    with open(source, "rb") as stream:
        header = stream.read(12)
        if len(header) != 12 or header[:4] != b"glTF":
            return {}
        while chunk := stream.read(8):
            size, kind = struct.unpack("<II", chunk)
            data = stream.read(size)
            if kind == 0x4E4F534A:
                document = json.loads(data)
                return {
                    node["extras"]["threejsStrandId"]: node["extras"]["threejsStrands"]
                    for node in document.get("nodes", [])
                    if isinstance(node.get("extras"), dict)
                    and "threejsStrandId" in node["extras"]
                    and "threejsStrands" in node["extras"]
                }
    return {}


def finite_number(value):
    return (
        isinstance(value, (float, int))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_strand_limits(settings):
    strands, guides = settings.get("strands"), settings.get("guides", [])
    if not isinstance(strands, list) or not isinstance(guides, list):
        raise ValueError("Invalid js3 strand or guide list")
    if len(strands) > 20_000 or len(guides) > 20_000:
        raise ValueError("js3 strand export supports at most 20000 strands or guides per groom")
    points = 0
    for path in strands:
        if not isinstance(path, dict) or not isinstance(path.get("points"), list):
            raise ValueError("Invalid js3 strand record")
        points += len(path["points"])
    for path in guides:
        if not isinstance(path, list):
            raise ValueError("Invalid js3 guide record")
        points += len(path)
    if points > 2_000_000:
        raise ValueError("js3 strand export supports at most 2000000 points per groom")


def native_curves(name, paths, parent, guides=False):
    """Create editable Blender hair curves with the same local basis as glTF import."""
    sizes, positions, radii, shades = [], [], [], []
    for strand in paths:
        if not guides and not isinstance(strand, dict):
            raise ValueError("Invalid js3 strand record")
        points = strand if guides else strand.get("points")
        if not isinstance(points, list) or len(points) < 2:
            raise ValueError("Invalid js3 strand: each curve needs at least two points")
        widths = [0.001] * len(points) if guides else strand.get("radii")
        if not isinstance(widths, list) or len(points) != len(widths):
            raise ValueError(
                "Invalid js3 strand: each curve needs matching points and radii"
            )
        for point, radius in zip(points, widths):
            if (
                not isinstance(point, list)
                or len(point) != 3
                or not all(finite_number(v) for v in point)
            ):
                raise ValueError("Invalid js3 strand point")
            if not finite_number(radius) or radius < 0:
                raise ValueError("Invalid js3 strand radius")
            positions.extend((point[0], -point[2], point[1]))
            radii.append(radius)
        shade = 1.0 if guides else strand.get("shade", 1.0)
        if not finite_number(shade) or shade < 0:
            raise ValueError("Invalid js3 strand shade")
        shades.append(shade)
        sizes.append(len(points))
    data = bpy.data.hair_curves.new(name)
    if not hasattr(data, "add_curves"):
        raise RuntimeError(
            "Native strand export requires Blender with editable Hair Curves.add_curves support"
        )
    if sizes:
        data.add_curves(sizes)
        # Linear interpolation matches the exported preview polyline exactly.
        data.set_types(type="POLY")
        data.attributes["position"].data.foreach_set("vector", positions)
    radius_attribute = data.attributes.new("radius", "FLOAT", "POINT")
    shade_attribute = data.attributes.new("threejs_shade", "FLOAT", "CURVE")
    if sizes:
        radius_attribute.data.foreach_set("value", radii)
        shade_attribute.data.foreach_set("value", shades)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj["threejs_native_strands"] = not guides
    obj["threejs_groom_guides"] = guides
    if guides:
        obj.hide_render = True
        obj.hide_set(True)
    return obj


def strand_material(name, settings):
    roughness, variation = settings.get("roughness", 0.4), settings.get("colorVariation", 0.15)
    if not finite_number(roughness) or not 0 <= roughness <= 1:
        raise ValueError("Invalid js3 strand material roughness")
    if not finite_number(variation) or variation < 0:
        raise ValueError("Invalid js3 strand material color variation")
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.parametrization = "COLOR"
    hair.inputs["Roughness"].default_value = roughness
    info = nodes.new("ShaderNodeHairInfo")
    gradient = nodes.new("ShaderNodeValToRGB")
    root_color = settings.get("color", [0.12, 0.06, 0.025])
    tip_color = settings.get("tipColor", root_color)
    for element, color in zip(gradient.color_ramp.elements, [root_color, tip_color]):
        if (
            not isinstance(color, list)
            or len(color) != 3
            or not all(finite_number(v) for v in color)
        ):
            raise ValueError("Invalid js3 strand material color")
        element.color = (*color, 1)
    shade = nodes.new("ShaderNodeAttribute")
    shade.attribute_name = "threejs_shade"
    centered = nodes.new("ShaderNodeMath")
    centered.operation = "SUBTRACT"
    centered.inputs[1].default_value = 1
    varied = nodes.new("ShaderNodeMath")
    varied.operation = "MULTIPLY_ADD"
    varied.inputs[1].default_value = variation / 0.2
    varied.inputs[2].default_value = 1
    nonnegative = nodes.new("ShaderNodeMath")
    nonnegative.operation = "MAXIMUM"
    nonnegative.inputs[1].default_value = 0
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs["Fac"].default_value = 1
    links.new(info.outputs["Intercept"], gradient.inputs["Fac"])
    links.new(gradient.outputs["Color"], multiply.inputs[1])
    links.new(shade.outputs["Fac"], centered.inputs[0])
    links.new(centered.outputs[0], varied.inputs[0])
    links.new(varied.outputs[0], nonnegative.inputs[0])
    links.new(nonnegative.outputs[0], multiply.inputs[2])
    links.new(multiply.outputs["Color"], hair.inputs["Color"])
    links.new(hair.outputs["BSDF"], output.inputs["Surface"])
    return material


def restore_strands(source):
    metadata = strand_metadata(source)
    if not metadata:
        return
    if not hasattr(bpy.data, "hair_curves"):
        raise RuntimeError(
            "Native strand export requires Blender with editable Hair Curves.add_curves support"
        )
    restored, restored_ids = 0, set()
    for parent in list(bpy.context.scene.objects):
        identifier = parent.get("threejsStrandId")
        if identifier not in metadata:
            continue
        settings = metadata[identifier]
        if (
            not isinstance(settings, dict)
            or settings.get("version") != 1
            or not isinstance(settings.get("strands"), list)
        ):
            raise ValueError("Unsupported js3 strand metadata")
        validate_strand_limits(settings)
        representation = settings.get("representation", "tubes")
        if representation not in ("tubes", "ribbons"):
            raise ValueError("Unsupported js3 strand representation")
        previews = [
            child for child in parent.children_recursive
            if child.get("threejsStrandPreview")
        ]
        strands = native_curves(parent.name + "_strands", settings["strands"], parent)
        strands["threejs_seed"] = settings.get("seed", 0)
        strands.data.materials.append(
            strand_material(parent.name + "_hair", settings.get("material", {}))
        )
        guides = settings.get("guides", [])
        if guides:
            native_curves(parent.name + "_guides", guides, parent, guides=True)
        if representation == "ribbons":
            # Native Hair Curves have round cross-sections. Preserve the actual
            # grass/ribbon profile for rendering while retaining editable paths.
            strands.hide_render = True
            strands.hide_set(True)
            note = "Ribbon meshes remain visible; editable centerline curves and guides are hidden."
        else:
            for preview in previews:
                preview.hide_render = True
                preview.hide_set(True)
            note = "Editable hair curves are visible; guides and polygon previews are hidden."
        parent["threejs_strand_note"] = note + " Static geometry; no dynamics or scalp attachment."
        restored += 1
        restored_ids.add(identifier)
    if restored_ids != set(metadata):
        raise RuntimeError("Could not match strand metadata to imported glTF objects")
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene["threejs_strand_groups"] = restored


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) not in (2, 4):
        raise ValueError("Expected input.glb output.blend [source.ts source-name]")
    source, destination = args[:2]
    # --factory-startup excludes the user's startup file; remove its default
    # cube, light and camera so the document contains only exported model data.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    result = bpy.ops.import_scene.gltf(filepath=source)
    if "FINISHED" not in result:
        raise RuntimeError("Blender could not import the GLB scene")
    restore_strands(source)
    if len(args) == 4:
        with open(args[2], encoding="utf-8") as entry:
            text = bpy.data.texts.new(args[3])
            text.write(entry.read())
        bpy.context.scene["threejs_source_entry"] = args[3]
        bpy.context.scene["threejs_source_note"] = (
            "Entry TypeScript source only; imported helpers and assets are not bundled."
        )
    # glTF import generally packs embedded images already; explicitly pack all
    # resources so the resulting file never depends on the temporary GLB path.
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.preferences.filepaths.file_preview_type = "NONE"
    result = bpy.ops.wm.save_as_mainfile(
        filepath=os.path.abspath(destination), check_existing=False
    )
    if "FINISHED" not in result:
        raise RuntimeError("Blender could not save the .blend document")


if __name__ == "__main__":
    main()
