"""Render an exportBeauty package with Blender's CPU Cycles and Open Image Denoise."""
import argparse
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

import bpy
from mathutils import Matrix, Vector
import numpy as np


def xyz(value):
    """Convert three.js coordinates to the glTF importer's Blender coordinates."""
    x, y, z = value
    return Vector((x, -z, y))


def aim(obj, direction, up="Y"):
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("-Z", up)


def light(scene, name, kind, position=None):
    data = bpy.data.lights.new(name, kind)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    if position is not None:
        obj.location = xyz(position)
    return obj


def lighting(scene, prefix, meta):
    w, h = (meta["sky"][k] for k in ("width", "height"))
    pixels = np.fromfile(Path(f"{prefix}.sky.f32"), dtype="<f4").reshape(h, w, 3)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = pixels[::-1]  # Blender buffers start at the bottom.
    img = bpy.data.images.new("Oriented world sky", width=w, height=h, float_buffer=True)
    img.pixels.foreach_set(rgba.ravel())
    world = bpy.data.worlds.new("World sky")
    scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = img
    env.interpolation = "Linear"
    # The exported world has the app's environment intensity baked in. The preset
    # can independently scale the visible background (including through window panes).
    daylight = meta["preset"] in {"day", "golden"}
    interior_daylight = meta["interior"] and daylight
    fill = (1.4 if interior_daylight else 1.12) if daylight else 1.0
    background = nodes["Background"]
    background.inputs["Strength"].default_value = fill
    strength = meta["backgroundScale"] * (0.85 if interior_daylight else 1.0)
    if strength != fill:
        rays = nodes.new("ShaderNodeLightPath")
        mix = nodes.new("ShaderNodeMixRGB")
        mix.inputs[1].default_value = (fill, fill, fill, 1)
        mix.inputs[2].default_value = (strength, strength, strength, 1)
        links.new(rays.outputs["Is Camera Ray"], mix.inputs[0])
        links.new(mix.outputs[0], background.inputs["Strength"])
    links.new(env.outputs["Color"], background.inputs["Color"])

    solar = meta["sun"]
    if solar["intensity"] > 0:
        sun = light(scene, "Sun", "SUN")
        sun.data.energy = solar["intensity"]
        sun.data.color = solar["color"]
        spread = 1.85 if interior_daylight else 1.25 if daylight else 1.0
        sun.data.angle = math.radians(max(0.53, 2 * solar["radius"] * spread))
        aim(sun, -xyz(solar["direction"]))

    if meta["interior"]:
        for opening in meta["openings"]:
            portal = light(scene, "Window portal", "AREA", opening["position"])
            portal.data.cycles.is_portal = True
            portal.data.shape = "RECTANGLE"
            portal.data.size = opening["width"]
            portal.data.size_y = opening["height"]
            aim(portal, xyz(opening["inward"]))

    for lamp in meta["lamps"]:
        spot = "target" in lamp
        obj = light(scene, "Practical", "SPOT" if spot else "POINT", lamp["position"])
        obj.data.color = lamp["color"]
        obj.data.energy = lamp["intensity"] * 4 * math.pi
        obj.data.shadow_soft_size = 0.075 if spot else 0.12
        if spot:
            obj.data.spot_size = lamp["angle"] * 2
            obj.data.spot_blend = lamp["penumbra"]
            aim(obj, xyz(lamp["target"]) - obj.location)


def connect(links, source, socket):
    if source.is_linked:
        links.new(source.links[0].from_socket, socket)
    else:
        socket.default_value = source.default_value


def thin_glass(nodes, links, surface, shader, window_exposure):
    # The app models windows as single faces. A thin, parallel pane sends the
    # transmitted ray straight through, while retaining dielectric Fresnel reflections.
    clear = nodes.new("ShaderNodeBsdfTransparent")
    tint = (0.975, 0.987, 0.98)
    clear.inputs["Color"].default_value = (*tint, 1)
    if window_exposure < 1:
        # Reproduce a bracketed interior photograph. A camera ray through the
        # glazing sees a shorter exterior exposure while daylight keeps its energy.
        ray = nodes.new("ShaderNodeLightPath")
        dual = nodes.new("ShaderNodeMixRGB")
        dual.inputs[1].default_value = (*tint, 1)
        dual.inputs[2].default_value = (*(c * window_exposure for c in tint), 1)
        links.new(ray.outputs["Is Camera Ray"], dual.inputs[0])
        links.new(dual.outputs[0], clear.inputs["Color"])
    glossy = nodes.new("ShaderNodeBsdfAnisotropic")
    connect(links, shader.inputs["Roughness"], glossy.inputs["Roughness"])
    facing = nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    edge = nodes.new("ShaderNodeMath")
    edge.operation = "POWER"
    edge.inputs[1].default_value = 5
    links.new(facing.outputs["Facing"], edge.inputs[0])
    # Schlick reflectance on either side of the pane, with both air/glass interfaces.
    fresnel = nodes.new("ShaderNodeMath")
    fresnel.operation = "MULTIPLY_ADD"
    fresnel.inputs[1].default_value = 0.92
    fresnel.inputs[2].default_value = 0.08
    links.new(edge.outputs[0], fresnel.inputs[0])
    mix = nodes.new("ShaderNodeMixShader")
    links.new(fresnel.outputs[0], mix.inputs[0])
    links.new(clear.outputs[0], mix.inputs[1])
    links.new(glossy.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], surface)


def sheer_fabric(nodes, links, surface, shader):
    diffuse_through = nodes.new("ShaderNodeBsdfTranslucent")
    clear = nodes.new("ShaderNodeBsdfTransparent")
    connect(links, shader.inputs["Base Color"], diffuse_through.inputs["Color"])
    fabric = nodes.new("ShaderNodeMixShader")
    fabric.inputs[0].default_value = 0.55
    shader.inputs["Transmission Weight"].default_value = 0
    links.new(shader.outputs[0], fabric.inputs[1])
    links.new(diffuse_through.outputs[0], fabric.inputs[2])
    weave = nodes.new("ShaderNodeMixShader")
    weave.inputs[0].default_value = 0.18
    links.new(fabric.outputs[0], weave.inputs[1])
    links.new(clear.outputs[0], weave.inputs[2])
    links.new(weave.outputs[0], surface)


def noise_detail(nodes, links, shader, scale, distance, strength):
    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 3
    links.new(coord.outputs["Object"], noise.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = distance
    bump.inputs["Strength"].default_value = strength
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    normal = shader.inputs["Normal"]
    if normal.is_linked:
        links.new(normal.links[0].from_socket, bump.inputs["Normal"])
    links.new(bump.outputs[0], normal)
    return noise



def camera_bevel(nodes, links, shader, radius):
    # Round edges in the photograph. Secondary rays keep the imported material
    # so diffuse bounces do not repeatedly trace the short bevel intersections.
    consumers = [link.to_socket for link in shader.outputs[0].links]
    rounded = nodes.new("ShaderNodeBsdfPrincipled")
    rounded.distribution = shader.distribution
    rounded.subsurface_method = shader.subsurface_method
    for source, destination in zip(shader.inputs, rounded.inputs, strict=True):
        connect(links, source, destination)
    normal = rounded.inputs["Normal"]
    bevel = nodes.new("ShaderNodeBevel")
    bevel.samples = 2
    bevel.inputs["Radius"].default_value = radius
    if normal.is_linked:
        links.new(normal.links[0].from_socket, bevel.inputs["Normal"])
    links.new(bevel.outputs[0], normal)
    ray = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(ray.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(shader.outputs[0], mix.inputs[1])
    links.new(rounded.outputs[0], mix.inputs[2])
    for socket in consumers:
        links.new(mix.outputs[0], socket)

def materials(bevel_scale, daylight_interior):
    for mat in bpy.data.materials:
        if mat.node_tree is None:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
        output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
        if shader is None or output is None:
            continue
        surface = output.inputs["Surface"]
        if mat.get("beautyThinGlass"):
            thin_glass(nodes, links, surface, shader, 0.5 if daylight_interior and mat.name == "glass" else 1)
        elif mat.get("beautySheer"):
            sheer_fabric(nodes, links, surface, shader)
        if mat.get("beautyCanyon"):
            noise = noise_detail(nodes, links, shader, 1.8, 0.11, 0.42)
            base = shader.inputs["Base Color"]
            multiply = nodes.new("ShaderNodeMixRGB")
            multiply.blend_type = "MULTIPLY"
            multiply.inputs[0].default_value = 0.37
            connect(links, base, multiply.inputs[1])
            links.new(noise.outputs["Fac"], multiply.inputs[2])
            links.new(multiply.outputs[0], base)
        if mat.get("beautyOcean"):
            noise_detail(nodes, links, shader, 0.7, 0.18, 0.4)
        # Scans supply the grain; low-amplitude variation breaks up an otherwise uniform gloss.
        name = mat.name.partition(".")[0]
        if name in {"floor", "ceilingWood", "cabinet", "counter", "zone:walls"}:
            plaster = name == "zone:walls"
            noise = noise_detail(nodes, links, shader, 85 if plaster else 28, 0.0015 if plaster else 0.0007, 0.16)
            gain = nodes.new("ShaderNodeMath")
            gain.operation = "MULTIPLY_ADD"
            gain.inputs[1].default_value = 0.17
            gain.inputs[2].default_value = 0.915
            links.new(noise.outputs["Fac"], gain.inputs[0])
            scale = nodes.new("ShaderNodeMath")
            scale.operation = "MULTIPLY"
            roughness = shader.inputs["Roughness"]
            connect(links, roughness, scale.inputs[0])
            links.new(gain.outputs[0], scale.inputs[1])
            links.new(scale.outputs[0], roughness)
        radius = mat.get("beautyBevel", 0) * bevel_scale
        if radius:
            camera_bevel(nodes, links, shader, radius)


def camera(scene, view, args):
    cam = bpy.data.cameras.new("Studio camera")
    obj = bpy.data.objects.new("Studio camera", cam)
    scene.collection.objects.link(obj)
    scene.camera = obj
    obj.location = xyz(view["position"])
    direction = xyz(view["target"]) - obj.location
    if args.pano:
        # Keep the horizon level and center the panorama on the still heading.
        direction.z = 0
        if direction.length < 1e-6:
            direction = Vector((0, 1, 0))
        cam.type = "PANO"
        cam.panorama_type = "EQUIRECTANGULAR"
    else:
        cam.sensor_fit = "VERTICAL"
        cam.lens = cam.sensor_height / (2 * math.tan(math.radians(view["fov"]) / 2))
        if args.focus:
            cam.dof.use_dof = True
            cam.dof.focus_distance = args.focus
            cam.dof.aperture_fstop = args.f_stop
            cam.dof.aperture_blades = 9
    forward = direction.normalized()
    up = Vector((0, 0, 1)) if args.pano else xyz(view["up"])
    right = forward.cross(up)
    if right.length < 1e-6:
        aim(obj, forward)
    else:
        right.normalize()
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Matrix((right, right.cross(forward), -forward)).transposed().to_quaternion()
    cam.clip_end = 60000



def aerial_perspective(scene):
    """Fade distant coastal terrain into daylight while keeping the HDRI horizon."""
    scene.view_layers[0].use_pass_z = True
    scene.render.compositor_device = "CPU"
    tree = bpy.data.node_groups.new("Aerial perspective", "CompositorNodeTree")
    scene.compositing_node_group = tree
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    nodes, links = tree.nodes, tree.links
    render = nodes.new("CompositorNodeRLayers")
    distance = render.outputs["Depth"]
    haze = nodes.new("ShaderNodeMapRange")
    haze.interpolation_type = "SMOOTHERSTEP"
    haze.clamp = True
    haze.inputs["From Min"].default_value = 32
    haze.inputs["From Max"].default_value = 205
    haze.inputs["To Max"].default_value = 0.67
    links.new(distance, haze.inputs["Value"])
    terrain = nodes.new("ShaderNodeMath")
    terrain.operation = "LESS_THAN"
    terrain.inputs[1].default_value = 60000
    links.new(distance, terrain.inputs[0])
    mask = nodes.new("ShaderNodeMath")
    mask.operation = "MULTIPLY"
    links.new(haze.outputs["Result"], mask.inputs[0])
    links.new(terrain.outputs[0], mask.inputs[1])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    factor, image, air = (socket for socket in mix.inputs if socket.enabled)
    air.default_value = (0.38, 0.51, 0.62, 1)
    links.new(mask.outputs[0], factor)
    links.new(render.outputs["Image"], image)
    output = nodes.new("NodeGroupOutput")
    links.new(next(socket for socket in mix.outputs if socket.enabled), output.inputs["Image"])

def dimensions(value):
    try:
        width, height = (int(n) for n in value.lower().split("x"))
        if min(width, height) < 4:
            raise ValueError
        return width, height
    except ValueError as error:
        raise argparse.ArgumentTypeError("size must be WIDTHxHEIGHT (each at least 4)") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prefix", type=Path, help="export prefix (.glb, .json, .sky.f32)")
    parser.add_argument("out", type=Path)
    parser.add_argument("--size", type=dimensions)
    parser.add_argument("--samples", type=int)
    parser.add_argument("--pano", action="store_true")
    parser.add_argument("--focus", type=float, help="focus distance in metres")
    parser.add_argument("--f-stop", type=float, default=5.6)
    parser.add_argument("--ev", type=float, default=0, help="additional exposure in stops")
    parser.add_argument("--white-balance", type=float, help="white balance in Kelvin")
    parser.add_argument("--bevel-scale", type=float, default=1)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    width, height = args.size or ((2560, 1280) if args.pano else (1600, 900))
    samples = args.samples if args.samples is not None else (6 if args.pano else 12)
    if args.pano and (width != height * 2 or args.focus):
        parser.error("panoramas require a 2:1 size and use fixed focus")
    positive = (samples, args.threads, args.f_stop)
    if args.white_balance is not None:
        positive += (args.white_balance,)
    if args.focus is not None:
        positive += (args.focus,)
    if any(not math.isfinite(n) or n <= 0 for n in positive):
        parser.error("samples, threads, focus, f-stop and white balance must be positive")
    if not math.isfinite(args.ev) or not math.isfinite(args.bevel_scale) or args.bevel_scale < 0:
        parser.error("exposure must be finite and bevel scale must be nonnegative")
    formats = {".webp": "WEBP", ".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG"}
    if args.out.suffix.lower() not in formats:
        parser.error("output must be .webp, .png or .jpg")

    start = monotonic()
    meta = json.loads(Path(f"{args.prefix}.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = args.threads
    cycles = scene.cycles
    cycles.device = "CPU"
    cycles.samples = samples
    cycles.use_adaptive_sampling = True
    cycles.adaptive_threshold = 0.10
    cycles.adaptive_min_samples = min(4, samples)
    cycles.use_denoising = True
    cycles.denoiser = "OPENIMAGEDENOISE"
    cycles.denoising_use_gpu = False
    cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    cycles.max_bounces = 8
    cycles.diffuse_bounces = 4
    cycles.glossy_bounces = 3
    cycles.transmission_bounces = 5
    cycles.transparent_max_bounces = 12
    cycles.caustics_reflective = False
    cycles.caustics_refractive = False
    cycles.sample_clamp_indirect = 9

    bpy.app.debug_value = 1  # Keep the glTF importer's warnings and silence its per-mesh messages.
    try:
        bpy.ops.import_scene.gltf(filepath=f"{args.prefix}.glb", import_scene_extras=False)
    finally:
        bpy.app.debug_value = 0
    daylight_interior = meta["interior"] and meta["preset"] in {"day", "golden"}
    materials(args.bevel_scale, daylight_interior)
    lighting(scene, args.prefix, meta)
    camera(scene, meta["camera"], args)
    if not meta["interior"] and meta["preset"] in {"day", "golden"}:
        aerial_perspective(scene)
    view = scene.view_settings
    view.view_transform = "AgX"
    view.look = "AgX - Medium Low Contrast" if meta["interior"] else "None"
    room_bias = {"golden": 2.6, "day": 3.0}.get(meta["preset"], 0) if meta["interior"] else 0
    view.exposure = math.log2(max(0.001, meta["exposure"])) + room_bias + args.ev
    view.use_white_balance = True
    view.white_balance_temperature = args.white_balance or (7100 if room_bias and meta["preset"] == "day" else 6500)
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = formats[args.out.suffix.lower()]
    scene.render.image_settings.quality = 93
    scene.render.image_settings.color_mode = "RGB"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    scene.render.use_file_extension = False
    loaded = monotonic()
    print(f"Cycles {width}×{height}, up to {samples} samples, {args.threads} CPU threads", flush=True)
    with TemporaryDirectory(prefix=".cycles-", dir=args.out.parent) as scratch:
        image = Path(scratch) / args.out.name
        scene.render.filepath = str(image.resolve())
        bpy.ops.render.render(write_still=True)
        image.replace(args.out)
    print(f"RENDERED {args.out} | setup {loaded - start:.1f}s | Cycles {monotonic() - loaded:.1f}s", flush=True)


if __name__ == "__main__":
    main()
