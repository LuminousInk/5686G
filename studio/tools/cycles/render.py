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


EXTERIOR_SKY = {
    "golden": (0.58, 1.24, (1.07, 1.0, 0.94)),
    "day": (0.68, 1.28, (0.96, 1.0, 1.06)),
    "dusk": (0.56, 1.30, (1.28, 1.03, 0.89)),
}
DAYLIGHT = {"day", "golden"}
PRACTICAL_COLOR = (1.0, 0.67, 0.40)


def window_exposure(scene, openings, stops):
    """Apply one exposure per opening, including the gaps in open sliders."""
    if stops == 0 or not openings:
        return
    material = bpy.data.materials.new("Window exposure filter")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    ray = nodes.new("ShaderNodeLightPath")
    attenuation = nodes.new("ShaderNodeMath")
    attenuation.operation = "MULTIPLY_ADD"
    attenuation.inputs[1].default_value = 2 ** stops - 1
    attenuation.inputs[2].default_value = 1
    links.new(ray.outputs["Is Camera Ray"], attenuation.inputs[0])
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    links.new(attenuation.outputs[0], transparent.inputs["Color"])
    links.new(transparent.outputs[0], nodes["Material Output"].inputs["Surface"])
    up = Vector((0, 0, 1))
    for opening in openings:
        inward = xyz(opening["inward"])
        # Portal positions sit just inside the wall. Set the filter beyond the
        # glass and frames so their interior-facing reflections keep full exposure.
        center = xyz(opening["position"]) - inward * 0.20
        right = inward.cross(up) * (opening["width"] / 2 + 0.055)
        top = up * (opening["height"] / 2 + 0.055)
        mesh = bpy.data.meshes.new("Window exposure filter")
        mesh.from_pydata([center - right - top, center + right - top,
                          center + right + top, center - right + top], [], [(0, 1, 2, 3)])
        mesh.materials.append(material)
        scene.collection.objects.link(bpy.data.objects.new(mesh.name, mesh))


def golden_practicals(scene, fixtures):
    for fixture in fixtures:
        position = fixture["position"]
        if fixture["kind"] == "pendant":
            pendant = light(scene, "Pendant pool", "AREA", position)
            pendant.data.shape = "DISK"
            pendant.data.size = fixture["size"]
            pendant.data.energy = 2.7
            pendant.data.color = PRACTICAL_COLOR
            pendant.visible_glossy = False
            continue
        # Light emerges above and below an open shade, while its fabric glows.
        gain = min(1.0, fixture["size"] / 0.32)
        for y, power in ((position[1], 4.5), (fixture["top"], 3.2)):
            lamp = light(scene, "Shade spill", "POINT", (position[0], y, position[2]))
            lamp.data.energy = power * gain
            lamp.data.color = PRACTICAL_COLOR
            lamp.data.shadow_soft_size = fixture["size"] * 0.35
            lamp.visible_glossy = False


def dome_diffusers(scene):
    # The fitted bronze dome exports a metal shell. Recess a luminous disc
    # into its opening, where a bulb and reflector would be seen from below.
    domes = [obj for obj in scene.objects
             if obj.type == "MESH" and obj.name.startswith("lamp_body_ceiling_lamp_metal_")]
    if not domes:
        return
    material = bpy.data.materials.new("Pendant diffuser")
    nodes, links = material.node_tree.nodes, material.node_tree.links
    glow = nodes.new("ShaderNodeEmission")
    glow.inputs["Color"].default_value = (*PRACTICAL_COLOR, 1)
    glow.inputs["Strength"].default_value = 0.75
    links.new(glow.outputs[0], nodes["Material Output"].inputs["Surface"])
    for dome in domes:
        corners = [dome.matrix_world @ Vector(corner) for corner in dome.bound_box]
        low = Vector(tuple(min(corner[i] for corner in corners) for i in range(3)))
        high = Vector(tuple(max(corner[i] for corner in corners) for i in range(3)))
        x, y, _ = (low + high) / 2
        radius = 0.35 * min(high.x - low.x, high.y - low.y)
        vertices = [(x + radius * math.cos(a), y - radius * math.sin(a), low.z + 0.005)
                    for a in (math.tau * i / 32 for i in range(32))]
        mesh = bpy.data.meshes.new("Pendant diffuser")
        mesh.from_pydata(vertices, [], [tuple(range(len(vertices)))])
        mesh.materials.append(material)
        diffuser = bpy.data.objects.new(mesh.name, mesh)
        # The calibrated area light supplies the pool of light below the shade.
        diffuser.visible_diffuse = diffuser.visible_shadow = False
        scene.collection.objects.link(diffuser)


def lighting(scene, prefix, meta, window_ev):
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
    daylight = meta["preset"] in DAYLIGHT
    interior_daylight = meta["interior"] and daylight
    fill = (1.25 if interior_daylight else 1.12) if daylight else 1.0
    background = nodes["Background"]
    background.inputs["Strength"].default_value = fill
    strength = meta["backgroundScale"] * (0.48 if interior_daylight else 1.0)
    color = env.outputs["Color"]
    sky_grade = EXTERIOR_SKY.get(meta["preset"]) if not meta["interior"] else None
    if sky_grade:
        gain, saturation, channels = sky_grade
        strength *= gain
        sky_color = nodes.new("ShaderNodeHueSaturation")
        sky_color.inputs["Saturation"].default_value = saturation
        links.new(color, sky_color.inputs["Color"])
        tint = nodes.new("ShaderNodeMixRGB")
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1
        tint.inputs[2].default_value = (*channels, 1)
        links.new(sky_color.outputs[0], tint.inputs[1])
        visible = nodes.new("ShaderNodeMixRGB")
        rays = nodes.new("ShaderNodeLightPath")
        links.new(rays.outputs["Is Camera Ray"], visible.inputs[0])
        links.new(color, visible.inputs[1])
        links.new(tint.outputs[0], visible.inputs[2])
        color = visible.outputs[0]
    if strength != fill:
        rays = nodes.new("ShaderNodeLightPath")
        mix = nodes.new("ShaderNodeMixRGB")
        mix.inputs[1].default_value = (fill, fill, fill, 1)
        mix.inputs[2].default_value = (strength, strength, strength, 1)
        links.new(rays.outputs["Is Camera Ray"], mix.inputs[0])
        links.new(mix.outputs[0], background.inputs["Strength"])
    links.new(color, background.inputs["Color"])

    solar = meta["sun"]
    if solar["intensity"] > 0:
        sun = light(scene, "Sun", "SUN")
        sun.data.energy = solar["intensity"] * (0.82 if interior_daylight else 1.0)
        sun.data.color = tuple(0.85 * channel + 0.15 for channel in solar["color"]) if interior_daylight else solar["color"]
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
    if interior_daylight:
        window_exposure(scene, meta["openings"], window_ev)
    if meta["interior"] and meta["preset"] == "golden":
        golden_practicals(scene, meta.get("fixtures", []))
        dome_diffusers(scene)

    practical_gain = 1.13 if not meta["interior"] and meta["preset"] == "dusk" else 1
    for lamp in meta["lamps"]:
        spot = "target" in lamp
        obj = light(scene, "Practical", "SPOT" if spot else "POINT", lamp["position"])
        obj.data.color = lamp["color"]
        obj.data.energy = lamp["intensity"] * 4 * math.pi * practical_gain
        obj.data.shadow_soft_size = 0.075 if spot else 0.12
        if spot:
            obj.data.spot_size = lamp["angle"] * 2
            obj.data.spot_blend = lamp["penumbra"]
            aim(obj, xyz(lamp["target"]) - obj.location)
    return pixels


def connect(links, source, socket):
    if source.is_linked:
        links.new(source.links[0].from_socket, socket)
    else:
        socket.default_value = source.default_value


def thin_glass(nodes, links, surface, shader):
    # The app models windows as single faces. A thin, parallel pane sends the
    # transmitted ray straight through, while retaining dielectric Fresnel reflections.
    clear = nodes.new("ShaderNodeBsdfTransparent")
    clear.inputs["Color"].default_value = (0.975, 0.987, 0.98, 1)
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


def foliage(nodes, links, surface, shader, distant=False):
    translucent = nodes.new("ShaderNodeBsdfTranslucent")
    base = shader.inputs["Base Color"]
    connect(links, base, translucent.inputs["Color"])
    connect(links, shader.inputs["Normal"], translucent.inputs["Normal"])
    shader.inputs["Specular IOR Level"].default_value = 0.27
    if distant:
        # The card already carries the tree bake's soft fill. Relight the crown while retaining a little of that fill.
        connect(links, base, shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 0.10
    weight = nodes.new("ShaderNodeMath")
    weight.operation = "MULTIPLY"
    weight.inputs[1].default_value = 0.20 if distant else 0.33
    connect(links, shader.inputs["Alpha"], weight.inputs[0])
    leaf = nodes.new("ShaderNodeMixShader")
    links.new(weight.outputs[0], leaf.inputs[0])
    links.new(shader.outputs[0], leaf.inputs[1])
    links.new(translucent.outputs[0], leaf.inputs[2])
    links.new(leaf.outputs[0], surface)


def contact_shadows(nodes, links, shader, distance, strength=0.22):
    contact = nodes.new("ShaderNodeAmbientOcclusion")
    contact.samples = 4
    contact.inputs["Distance"].default_value = distance
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = strength
    base = shader.inputs["Base Color"]
    connect(links, base, multiply.inputs[1])
    links.new(contact.outputs["AO"], multiply.inputs[2])
    links.new(multiply.outputs[0], base)


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


def surface_relief(nodes, links, shader, scale, distance, strength, variation):
    noise = noise_detail(nodes, links, shader, scale, distance, strength)
    gain = nodes.new("ShaderNodeMath")
    gain.operation = "MULTIPLY_ADD"
    gain.inputs[1].default_value = variation
    gain.inputs[2].default_value = 1 - variation / 2
    links.new(noise.outputs["Fac"], gain.inputs[0])
    base = shader.inputs["Base Color"]
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    connect(links, base, multiply.inputs[1])
    links.new(gain.outputs[0], multiply.inputs[2])
    links.new(multiply.outputs[0], base)


def finish_detail(nodes, links, shader, name, interior):
    plaster = name in {"zone:walls", "ceiling"}
    if interior:
        noise_detail(nodes, links, shader, 125 if plaster else 68, 0.0016 if plaster else 0.001,
                     0.24 if plaster else 0.19)
        # Vary roughness over a larger area than the pores. Keep the imported maps.
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 7 if plaster else 12
        links.new(nodes.new("ShaderNodeTexCoord").outputs["Object"], noise.inputs["Vector"])
        variation = 0.28 if plaster else 0.38
    else:
        noise = noise_detail(nodes, links, shader, 85 if plaster else 28, 0.0015 if plaster else 0.0007, 0.16)
        variation = 0.17
    gain = nodes.new("ShaderNodeMath")
    gain.operation = "MULTIPLY_ADD"
    gain.inputs[1].default_value = variation
    gain.inputs[2].default_value = 1 - variation / 2
    links.new(noise.outputs["Fac"], gain.inputs[0])
    scale = nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.use_clamp = interior
    roughness = shader.inputs["Roughness"]
    connect(links, roughness, scale.inputs[0])
    links.new(gain.outputs[0], scale.inputs[1])
    links.new(scale.outputs[0], roughness)


def cloth_sheen(nodes, links, shader):
    weight = shader.inputs["Sheen Weight"]
    if weight.is_linked or weight.default_value > 0:
        return
    weight.default_value = 0.25
    shader.inputs["Sheen Roughness"].default_value = 0.78
    connect(links, shader.inputs["Base Color"], shader.inputs["Sheen Tint"])


def ocean_through_window(nodes, links, surface, shader):
    # At these low viewing angles the physical surface is almost entirely a
    # reflection of the bright HDRI horizon. Keep some blue water scatter in
    # the photographed view. The scene still uses the physical ocean for GI.
    water = nodes.new("ShaderNodeBsdfDiffuse")
    connect(links, shader.inputs["Base Color"], water.inputs["Color"])
    connect(links, shader.inputs["Normal"], water.inputs["Normal"])
    reflection = nodes.new("ShaderNodeBsdfAnisotropic")
    reflection.inputs["Color"].default_value = (0.13, 0.25, 0.34, 1)
    connect(links, shader.inputs["Roughness"], reflection.inputs["Roughness"])
    connect(links, shader.inputs["Normal"], reflection.inputs["Normal"])
    visible = nodes.new("ShaderNodeMixShader")
    visible.inputs[0].default_value = 0.55
    links.new(water.outputs[0], visible.inputs[1])
    links.new(reflection.outputs[0], visible.inputs[2])
    ray = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(ray.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(shader.outputs[0], mix.inputs[1])
    links.new(visible.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], surface)


PRACTICAL_EMISSION = {
    "interior:diffuser": 1.60,
    "modern_ceiling_globe": 1.35,
    "Plastico": 1.35,  # Linear dining pendant diffuser.
    "interior:linen-shade": 0.25,
    "Lamp_Shade_Outside": 0.25,
    "ceramic shade": 0.28,
}


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

def materials(bevel_scale, meta):
    daylight_interior = meta["interior"] and meta["preset"] in DAYLIGHT
    golden = meta["interior"] and meta["preset"] == "golden"
    gravel = {mat for obj in bpy.data.objects if obj.type == "MESH" and obj.name.partition(".")[0] == "Decomposed granite paths"
              for mat in obj.data.materials}
    ceramic_shades = {
        mat for obj in bpy.data.objects if obj.type == "MESH" and obj.name.startswith("Cylinder003_fabric002_")
        for mat in obj.data.materials
    } if golden else set()
    for mat in bpy.data.materials:
        if mat.node_tree is None:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
        output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
        if shader is None or output is None:
            continue
        surface = output.inputs["Surface"]
        name = mat.name.partition(".")[0]
        if mat.get("beautyThinGlass"):
            thin_glass(nodes, links, surface, shader)
        elif mat.get("beautySheer"):
            sheer_fabric(nodes, links, surface, shader)
        elif mat.get("beautyFoliage") or mat.get("beautyForestCard"):
            foliage(nodes, links, surface, shader, bool(mat.get("beautyForestCard")))
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
            if daylight_interior:
                ocean_through_window(nodes, links, surface, shader)
        if not meta["interior"] and name == "Canyon terrain splat":
            surface_relief(nodes, links, shader, 5.2, 0.032, 0.35, 0.23)
            contact_shadows(nodes, links, shader, 0.32, 0.28)
        if not meta["interior"] and mat in gravel:
            surface_relief(nodes, links, shader, 18, 0.013, 0.48, 0.38)
        if daylight_interior and name in {"floor", "cabinet"}:
            contact_shadows(nodes, links, shader, 0.18 if name == "floor" else 0.085, 0.25)
        if name in {"floor", "ceilingWood", "cabinet", "counter", "zone:walls"} or meta["interior"] and name == "ceiling":
            finish_detail(nodes, links, shader, name, meta["interior"])
        if meta["interior"] and any(word in name.lower() for word in (
            "fabric", "linen", "bedding", "duvet", "upholstery", "velvet", "rug", "cushion", "tela_",
        )):
            cloth_sheen(nodes, links, shader)
        emission = PRACTICAL_EMISSION.get("ceramic shade" if mat in ceramic_shades else name)
        if golden and emission:
            shader.inputs["Emission Color"].default_value = (*PRACTICAL_COLOR, 1)
            shader.inputs["Emission Strength"].default_value = emission
        radius = mat.get("beautyBevel", 0) * bevel_scale
        if radius:
            camera_bevel(nodes, links, shader, radius)


def camera(scene, view, args, interior, width, height):
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
        if interior:
            cam.sensor_height = 36 * height / width
        cam.lens = cam.sensor_height / (2 * math.tan(math.radians(view["fov"]) / 2))
        # Shift the frame down to favor furniture and floor while keeping the
        # perspective center level. Custom pitched cameras keep their framing.
        if args.shift_y is not None:
            cam.shift_y = args.shift_y
        elif interior and abs(direction.z) < 1e-5:
            cam.shift_y = -0.055
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



def aerial_perspective(scene, meta, sky, strength, pano):
    """Use the coastal shader's exponential distance falloff and horizon tint."""
    scene.view_layers[0].use_pass_z = True
    scene.render.compositor_device = "CPU"
    tree = bpy.data.node_groups.new("Aerial perspective", "CompositorNodeTree")
    scene.compositing_node_group = tree
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    nodes, links = tree.nodes, tree.links
    render = nodes.new("CompositorNodeRLayers")
    distance = render.outputs["Depth"]
    density = 0.0016
    optical_depth = nodes.new("ShaderNodeMath")
    optical_depth.operation = "MULTIPLY_ADD"
    optical_depth.inputs[1].default_value = -density
    optical_depth.inputs[2].default_value = 31 * density
    links.new(distance, optical_depth.inputs[0])
    beyond_foreground = nodes.new("ShaderNodeMath")
    beyond_foreground.operation = "MINIMUM"
    beyond_foreground.inputs[1].default_value = 0
    links.new(optical_depth.outputs[0], beyond_foreground.inputs[0])
    transmission = nodes.new("ShaderNodeMath")
    transmission.operation = "EXPONENT"
    links.new(beyond_foreground.outputs[0], transmission.inputs[0])
    maximum = min(1, strength * (0.44 if meta["preset"] == "dusk" else 0.70))
    haze = nodes.new("ShaderNodeMath")
    haze.operation = "MULTIPLY_ADD"
    haze.inputs[1].default_value = -maximum
    haze.inputs[2].default_value = maximum
    links.new(transmission.outputs[0], haze.inputs[0])
    terrain = nodes.new("ShaderNodeMath")
    terrain.operation = "LESS_THAN"
    terrain.inputs[1].default_value = 60000
    links.new(distance, terrain.inputs[0])
    mask = nodes.new("ShaderNodeMath")
    mask.operation = "MULTIPLY"
    links.new(haze.outputs[0], mask.inputs[0])
    links.new(terrain.outputs[0], mask.inputs[1])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    factor, image, air = (socket for socket in mix.inputs if socket.enabled)
    height, width, _ = sky.shape
    row = round((0.5 - math.asin(0.018) / math.pi) * height - 0.5)
    x, _, z = meta["camera"]["position"]
    tx, _, tz = meta["camera"]["target"]
    center = int((math.atan2(tz - z, tx - x) / math.tau + 0.5) * width)
    columns = np.arange(width) if pano else np.arange(center - width // 14, center + width // 14) % width
    horizon = np.median(sky[row, columns], axis=0) * meta["backgroundScale"]
    horizon = np.minimum(horizon, 4)
    tint = horizon / (1 + max(horizon)) * (0.30, 0.43, 0.62)
    air.default_value = (*tint, 1)
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
    parser.add_argument("--window-ev", type=float, default=-1.65, help="daylight interior window exposure in stops")
    parser.add_argument("--shift-y", type=float, help="still camera shift, as a fraction of frame height")
    parser.add_argument("--white-balance", type=float, help="white balance in Kelvin")
    parser.add_argument("--bevel-scale", type=float, default=1)
    parser.add_argument("--haze", type=float, default=1, help="exterior aerial perspective multiplier")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    width, height = args.size or ((2560, 1280) if args.pano else (1600, 900))
    samples = args.samples if args.samples is not None else (6 if args.pano else 12)
    if args.pano and (width != height * 2 or args.focus or args.shift_y is not None):
        parser.error("panoramas require a 2:1 size, fixed focus and no lens shift")
    positive = (samples, args.threads, args.f_stop)
    if args.white_balance is not None:
        positive += (args.white_balance,)
    if args.focus is not None:
        positive += (args.focus,)
    if any(not math.isfinite(n) or n <= 0 for n in positive):
        parser.error("samples, threads, focus, f-stop and white balance must be positive")
    if not math.isfinite(args.ev) or any(not math.isfinite(n) or n < 0 for n in (args.bevel_scale, args.haze)):
        parser.error("exposure must be finite, and bevel scale and haze must be finite and nonnegative")
    if not math.isfinite(args.window_ev) or args.window_ev > 0:
        parser.error("window exposure must be finite and at most zero")
    if args.shift_y is not None and (not math.isfinite(args.shift_y) or abs(args.shift_y) > 1):
        parser.error("lens shift must be between -1 and 1")
    formats = {".webp": "WEBP", ".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG"}
    if args.out.suffix.lower() not in formats:
        parser.error("output must be .webp, .png or .jpg")

    start = monotonic()
    meta = json.loads(Path(f"{args.prefix}.json").read_text())
    interior_daylight = meta["interior"] and meta["preset"] in DAYLIGHT
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
    cycles.max_bounces = 9 if interior_daylight else 8
    cycles.diffuse_bounces = 6 if interior_daylight else 4
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
    materials(args.bevel_scale, meta)
    sky = lighting(scene, args.prefix, meta, args.window_ev)
    camera(scene, meta["camera"], args, meta["interior"], width, height)
    if args.haze and not meta["interior"] and meta["preset"] in EXTERIOR_SKY:
        aerial_perspective(scene, meta, sky, args.haze, args.pano)
    view = scene.view_settings
    view.view_transform = "AgX"
    view.look = ("AgX - Medium High Contrast" if meta["preset"] == "golden" else
                 "AgX - Medium Low Contrast") if meta["interior"] else "None"
    room_bias = {"golden": 2.6, "day": 3.0}.get(meta["preset"], 0) if interior_daylight else 0
    exterior_bias = 0.38 if not meta["interior"] and meta["preset"] == "day" else 0
    view.exposure = math.log2(max(0.001, meta["exposure"])) + room_bias + exterior_bias + args.ev
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
