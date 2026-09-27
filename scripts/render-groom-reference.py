"""Render packed full-density GuideGroom fibers as native Cycles Hair Curves.

Prefer export-groom-reference.ts, which derives the packed input from groom.json.
Direct use: blender --background --factory-startup --disable-autoexec \
  --python-exit-code 1 --python scripts/render-groom-reference.py -- \
  --source output/reference/packed/reference.json --output output/reference

Hair model documentation:
https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/hair_principled.html
Curve bulk API: https://docs.blender.org/api/current/bpy.types.Curves.html
"""

import argparse
import json
import math
from pathlib import Path
import sys
import time

import bpy
from mathutils import Matrix, Vector
import numpy as np


BASIS = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
PRESETS = json.loads(Path(__file__).with_name("hair-review-presets.json").read_text())
VIEWS = PRESETS["views"]


def finite_vector(value):
    try:
        result = tuple(float(v) for v in value.split(","))
    except ValueError as error:
        raise argparse.ArgumentTypeError("Expected three finite comma-separated numbers") from error
    if len(result) != 3 or not all(math.isfinite(v) for v in result):
        raise argparse.ArgumentTypeError("Expected three finite comma-separated numbers")
    return result


def positive(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("Expected a positive finite number")
    return number


def resolution(value):
    parts = value.lower().split("x")
    try:
        width, height = (int(parts[0]), int(parts[0])) if len(parts) == 1 else map(int, parts)
    except (ValueError, TypeError) as error:
        raise argparse.ArgumentTypeError("Resolution must be N or WIDTHxHEIGHT") from error
    if not 16 <= width <= 8192 or not 16 <= height <= 8192:
        raise argparse.ArgumentTypeError("Resolution dimensions must be between 16 and 8192")
    return width, height


def view_names(value):
    names = list(VIEWS) if value == "all" else value.split(",")
    if len(set(names)) != len(names) or any(name not in VIEWS for name in names):
        raise argparse.ArgumentTypeError("Choose unique comma-separated views: " + ", ".join(VIEWS) + ", or all")
    return names


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Packed reference.json")
    parser.add_argument("--head", type=Path, help="Optional head/scene GLB without hair cards")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preset", choices=("studio", "backlight", "grazing"), default="studio")
    parser.add_argument("--view", type=view_names, default=["three-quarter"],
                        help="Comma-separated front,profile,back,three-quarter, or all")
    parser.add_argument("--resolution", type=resolution, default=(800, 1000))
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--target", type=finite_vector, default=PRESETS["camera"]["target"])
    parser.add_argument("--radius", type=positive, default=PRESETS["camera"]["radius"])
    parser.add_argument("--fov", type=positive, default=PRESETS["camera"]["fov"])
    parser.add_argument("--padding", type=positive, default=PRESETS["camera"]["padding"])
    parser.add_argument("--device", choices=("CPU", "AUTO", "CUDA", "OPTIX", "HIP", "ONEAPI", "METAL"), default="CPU")
    arguments = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if not 1 <= arguments.samples <= 4096 or not 1 <= arguments.fov < 175:
        parser.error("Samples must be 1–4096 and FOV must be 1–174 degrees")
    return arguments


def safe_child(directory, name):
    path = (directory / name).resolve()
    if path.parent != directory.resolve():
        raise ValueError("Packed input files must be directly beside reference.json")
    return path


def read_section(binary, spec, kind, components, count):
    size = count * components * 4
    offset = spec.get("byteOffset")
    if (spec.get("type") != kind or spec.get("components") != components
            or spec.get("count") != count or spec.get("byteLength") != size
            or type(offset) is not int or offset < 0 or offset % 4
            or offset + size > len(binary)):
        raise ValueError("Invalid packed fiber buffer section")
    values = np.frombuffer(binary, dtype="<f4" if kind == "float32" else "<u4",
                           count=count * components, offset=offset)
    if kind == "float32" and not np.isfinite(values).all():
        raise ValueError("Packed fibers contain non-finite coordinates or values")
    return values


def hair_material(name, settings):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    supported = {item.identifier for item in hair.bl_rna.properties["model"].enum_items} if hasattr(hair, "model") else set()
    if "HUANG" in supported:
        hair.model = "HUANG"
    hair.parametrization = "COLOR"
    roughness = settings["roughness"]
    if not isinstance(roughness, (int, float)) or not 0 <= roughness <= 1:
        raise ValueError("Invalid layer roughness")
    hair.inputs["Roughness"].default_value = roughness
    if "Radial Roughness" in hair.inputs:
        hair.inputs["Radial Roughness"].default_value = roughness
    if "Aspect Ratio" in hair.inputs:
        # Circular source fibers have no authored elliptical cross-section.
        hair.inputs["Aspect Ratio"].default_value = 1
    if "Random Roughness" in hair.inputs:
        hair.inputs["Random Roughness"].default_value = .08
    info = nodes.new("ShaderNodeHairInfo")
    gradient = nodes.new("ShaderNodeValToRGB")
    for stop, color in zip(gradient.color_ramp.elements, (settings["color"], settings["tipColor"])):
        if len(color) != 3 or not all(isinstance(v, (float, int)) and math.isfinite(v) and v >= 0 for v in color):
            raise ValueError("Invalid linear layer color")
        stop.color = (*color, 1)
    shade = nodes.new("ShaderNodeAttribute")
    shade.attribute_name = "threejs_shade"
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs["Fac"].default_value = 1
    links.new(info.outputs["Intercept"], gradient.inputs["Fac"])
    links.new(gradient.outputs["Color"], multiply.inputs[1])
    links.new(shade.outputs["Fac"], multiply.inputs[2])
    links.new(multiply.outputs["Color"], hair.inputs["Color"])
    links.new(hair.outputs["BSDF"], output.inputs["Surface"])
    return material, getattr(hair, "model", "CHIANG")


def native_groom(path):
    manifest = json.loads(path.read_text())
    if manifest.get("format") != "threejs-groom-reference" or manifest.get("version") != 1:
        raise ValueError("Expected a threejs-groom-reference version 1 bundle")
    if manifest.get("generation", {}).get("density") != 1 or manifest.get("byteOrder") != "little":
        raise ValueError("Reference bundle must contain full-density little-endian fibers")
    binary = safe_child(path.parent, manifest["binary"]).read_bytes()
    if len(binary) != manifest["byteLength"]:
        raise ValueError("Packed fiber buffer length does not match its manifest")
    if manifest["counts"]["fibers"] > 200_000 or manifest["counts"]["points"] > 4_000_000:
        raise ValueError("Reference source exceeds 200000 fibers or 4000000 points")
    materials, counts, models = [], {"fibers": 0, "points": 0}, set()
    for layer in manifest["layers"]:
        n, p = layer["fibers"], layer["points"]
        sizes = read_section(binary, layer["sizes"], "uint32", 1, n)
        if np.any(sizes < 2) or int(sizes.sum()) != p:
            raise ValueError("Curve sizes do not cover the packed points")
        positions = read_section(binary, layer["positions"], "float32", 3, p).reshape((-1, 3))
        radii = read_section(binary, layer["radii"], "float32", 1, p)
        shades = read_section(binary, layer["shades"], "float32", 1, n)
        if np.any(radii < 0) or np.any(shades < 0):
            raise ValueError("Negative curve radius or shade")
        # Coordinate conversion exactly matches Blender's glTF importer.
        converted = np.empty_like(positions)
        converted[:, 0], converted[:, 1], converted[:, 2] = positions[:, 0], -positions[:, 2], positions[:, 1]
        curves = bpy.data.hair_curves.new(layer["id"])
        curves.add_curves(sizes.tolist())
        curves.set_types(type="POLY")
        curves.attributes["position"].data.foreach_set("vector", converted.ravel())
        curves.attributes.new("radius", "FLOAT", "POINT").data.foreach_set("value", radii)
        curves.attributes.new("threejs_shade", "FLOAT", "CURVE").data.foreach_set("value", shades)
        material, model = hair_material(layer["id"] + "_principled_hair", layer["material"])
        curves.materials.append(material)
        materials.append(material.name)
        models.add(model)
        for attachment in manifest["attachments"]:
            matrix = np.asarray(attachment["matrixWorld"], dtype=np.float64)
            if matrix.size != 16 or not np.isfinite(matrix).all():
                raise ValueError("Invalid groom attachment matrix")
            matrix = Matrix(matrix.reshape((4, 4), order="F").tolist())
            if abs(matrix.determinant()) < 1e-15:
                raise ValueError("Groom attachment matrix must be invertible")
            obj = bpy.data.objects.new(attachment["name"] + "/" + layer["id"], curves)
            bpy.context.collection.objects.link(obj)
            obj.matrix_world = BASIS @ matrix @ BASIS.inverted()
            obj["threejs_groom_layer"] = layer["id"]
            obj["threejs_full_density"] = True
        counts["fibers"] += n
        counts["points"] += p
    if any(counts[key] != manifest["counts"][key] for key in counts):
        raise ValueError("Layer counts differ from the reference manifest")
    source = safe_child(path.parent, manifest["source"]).read_text()
    bpy.data.texts.new("groom.json").write(source)
    bpy.context.scene["threejs_reference_source"] = str(path.resolve())
    bpy.context.scene["threejs_full_density_fibers"] = counts["fibers"]
    return manifest, sorted(models)


def world_point(source):
    return Vector((source[0], -source[2], source[1]))


def aim(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def linear_color(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values)


def setup_lighting(preset, target, radius):
    settings = PRESETS["lighting"][preset]
    for kind in ("key", "fill"):
        light = bpy.data.lights.new(kind.title(), "SUN")
        light.energy = settings[kind]
        light.color = linear_color(settings[kind + "Color"])
        light.angle = math.radians(2)
        obj = bpy.data.objects.new(kind.title(), light)
        bpy.context.collection.objects.link(obj)
        obj.location = world_point(target) + world_point(settings[kind + "Direction"]).normalized() * radius * 3
        aim(obj, world_point(target))
    world = bpy.data.worlds.new("Reference studio")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    coordinates = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    remap = nodes.new("ShaderNodeMath")
    remap.operation = "MULTIPLY_ADD"
    remap.inputs[1].default_value, remap.inputs[2].default_value = .5, .5
    color = nodes.new("ShaderNodeMixRGB")
    color.inputs[1].default_value = (*linear_color(settings["groundColor"]), 1)
    color.inputs[2].default_value = (*linear_color(settings["skyColor"]), 1)
    ambient = nodes.new("ShaderNodeBackground")
    # A lit world integrates over directions, unlike Three's per-normal hemi term.
    # This explicit conversion is approximate; the report does not claim parity.
    ambient.inputs["Strength"].default_value = settings["hemisphere"] * .25
    backdrop = nodes.new("ShaderNodeBackground")
    backdrop.inputs["Color"].default_value = (*linear_color(PRESETS["background"]), 1)
    backdrop.inputs["Strength"].default_value = 1
    path = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    output = nodes.new("ShaderNodeOutputWorld")
    # Background Object coordinates are the world ray direction (no object).
    links.new(coordinates.outputs["Object"], separate.inputs[0])
    links.new(separate.outputs["Z"], remap.inputs[0])
    links.new(remap.outputs[0], color.inputs[0])
    links.new(color.outputs[0], ambient.inputs["Color"])
    links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(ambient.outputs[0], mix.inputs[1])
    links.new(backdrop.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    bpy.context.scene.world = world
    return {"sharedPreset": settings, "directLights": "SUN; intensity and linearized color copied from Three",
            "sunAngleDegrees": 2, "world": "linear sky/ground gradient by world ray Z",
            "worldStrength": settings["hemisphere"] * .25,
            "note": "World integration, path tracing and AgX differ from Three hemisphere lighting, shadow maps and ACES; radiometric parity is not claimed."}


def setup_camera(view, args):
    camera = bpy.data.cameras.new("Camera_" + view)
    camera.sensor_fit = "VERTICAL"
    camera.sensor_height = 24
    camera.lens = camera.sensor_height / (2 * math.tan(math.radians(args.fov / 2)))
    camera.clip_start, camera.clip_end = args.radius / 1000, args.radius * 100
    obj = bpy.data.objects.new("Camera_" + view, camera)
    bpy.context.collection.objects.link(obj)
    aspect = args.resolution[0] / args.resolution[1]
    vertical = math.radians(args.fov / 2)
    horizontal = math.atan(math.tan(vertical) * aspect)
    distance = args.radius / math.sin(min(vertical, horizontal)) * args.padding
    target = world_point(args.target)
    obj.location = target + world_point(VIEWS[view]).normalized() * distance
    aim(obj, target)
    return obj


def setup_device(requested):
    if requested == "CPU":
        bpy.context.scene.cycles.device = "CPU"
        return "CPU"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    candidates = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL") if requested == "AUTO" else (requested,)
    for backend in candidates:
        try:
            preferences.compute_device_type = backend
            preferences.refresh_devices()
            devices = [device for device in preferences.devices if device.type == backend]
            if not devices:
                continue
            for device in preferences.devices:
                device.use = device.type == backend
            bpy.context.scene.cycles.device = "GPU"
            return backend
        except (TypeError, RuntimeError):
            continue
    if requested != "AUTO":
        raise RuntimeError("Requested Cycles device is unavailable: " + requested)
    bpy.context.scene.cycles.device = "CPU"
    return "CPU"


def main():
    if not bpy.app.background:
        raise RuntimeError("Reference rendering must run with blender --background")
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    if args.head:
        bpy.ops.import_scene.gltf(filepath=str(args.head.resolve()))
        # An exported hybrid scene would invalidate the full-strand comparison.
        for obj in bpy.context.scene.objects:
            if any(key in obj for key in ("threejsGroom", "threejsHairCards", "threejsStrands")):
                raise ValueError("--head must contain only the head/scene, without groom representations")
    manifest, models = native_groom(args.source.resolve())
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    device = setup_device(args.device)
    scene.cycles.samples = args.samples
    scene.cycles.seed = manifest["generation"]["seed"] % 2147483647
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = .015
    scene.cycles.max_bounces = 12
    scene.cycles.transmission_bounces = 12
    scene.cycles.transparent_max_bounces = 16
    if hasattr(scene.cycles, "curve_shape"):
        scene.cycles.curve_shape = "THICK"
    scene.render.resolution_x, scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = math.log2(PRESETS["exposure"])
    lighting = setup_lighting(args.preset, args.target, args.radius)
    selected_views = args.view
    cameras = {view: setup_camera(view, args) for view in selected_views}
    scene.camera = cameras[selected_views[0]]
    scene.render.filepath = str((args.output / (args.preset + "-" + selected_views[0] + ".png")).resolve())
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.preferences.filepaths.file_preview_type = "NONE"
    blend = args.output / "reference.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend.resolve()), compress=True)
    report = {
        "format": "threejs-cycles-reference", "version": 1,
        "blender": bpy.app.version_string, "background": bpy.app.background,
        "source": str(args.source.resolve()), "head": str(args.head.resolve()) if args.head else None,
        "representation": "native Hair Curves, full source density; no cards",
        "counts": manifest["counts"], "hairModels": models,
        "settings": {"engine": "CYCLES", "device": device, "samples": args.samples,
                     "resolution": list(args.resolution), "preset": args.preset,
                     "generation": manifest["generation"], "colorManagement": "AgX",
                     "target": list(args.target), "radius": args.radius,
                     "verticalFovDegrees": args.fov, "padding": args.padding,
                     "exposureStops": scene.view_settings.exposure, "lighting": lighting},
        "blend": str(blend.resolve()), "renders": [],
    }
    for view, camera in cameras.items():
        scene.camera = camera
        path = args.output / (args.preset + "-" + view + ".png")
        scene.render.filepath = str(path.resolve())
        before = time.monotonic()
        bpy.ops.render.render(write_still=True)
        report["renders"].append({"view": view, "path": str(path.resolve()),
                                  "seconds": round(time.monotonic() - before, 3)})
        report["seconds"] = round(time.monotonic() - started, 3)
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("THREEJS_CYCLES_REFERENCE " + json.dumps(report))


if __name__ == "__main__":
    main()
