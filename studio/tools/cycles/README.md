# Cycles catalog renders

Build the studio and run a Vite preview. The driver opens that build in headless Chromium, exports the
loaded scene, and hands it to Blender Cycles on the CPU. Use the same Blender 5.3 Python environment as the
lightmap bake. The driver expects Playwright with Chromium installed.

```sh
npx vite build --outDir dist-cx
npx vite preview --outDir dist-cx --port 4201 --strictPort
```

Run the driver in a second terminal. If the checkout's dependencies are mounted read-only, Vite
supports `--configLoader runner` for both commands.

```sh
node tools/cycles/render.mjs cedar-great-room --out shots/cycles/cedar-great-room.webp
node tools/cycles/render.mjs coastal-kitchen --pano --out shots/cycles/coastal-kitchen-pano.webp
node tools/cycles/render.mjs --plan woodland-modern --view primary --time dusk --finish walls=limewash
node tools/cycles/render.mjs --plan cedar-ridge --time golden \
  --pose '1.2,2.25,-5;1.9,2.15,-0.5;49;walk' --focus 4.5 --f-stop 5.6
```

Positions and targets use the plan's metre coordinates with Y up. Use `--pose='…'` when the first coordinate is negative. The pose uses vertical field of view
in degrees, followed by an optional `walk` or `orbit`. Gallery IDs inherit the gallery's authored view,
preset and finishes. Repeat `--finish ZONE=OPTION` for overrides. `BASE` changes the preview URL and
`CYCLES_PYTHON` overrides `/root/.venvs/bake/bin/python`.

| Setting | Default |
| --- | --- |
| Still size / sample cap | 1600×900 / 12 samples |
| Panorama size / sample cap | 2560×1280 / 6 samples |
| Output | WebP at quality 93. A `.png` or `.jpg` path also works. |
| Camera | Level 360° equirectangular view with `--pano`. Interior gallery stills use eye-level cameras and 24–28 mm full-frame-equivalent lenses at 16:9. |
| CPU | 4 threads. Set `--threads` to share the machine with a bake. |

Use `--size 800x450 --samples 8 --threads 2` for short lighting tests on a shared machine. Panoramas require a 2:1 aspect ratio. Use `--size 4096x2048` for a 4K panorama.
`--ev` sets an offset in stops from the calibrated exposure. `--window-ev` sets a separate camera exposure
through daylight interior openings (default −1.65 stops, 0 disables the opening filter).
`--white-balance` takes Kelvin. For stills, `--focus` takes metres and `--f-stop` controls the aperture.
`--shift-y` moves the still frame by a fraction of its height. By default, a level interior still shifts down
by 5.5% to hold more of the furniture and floor in frame. The studio share view uses the same eye height,
heading and lens at 16:9 with a centered viewport.
`--bevel-scale` multiplies the 4 mm edge radius. `--haze` scales exterior aerial perspective (default 1, 0 turns it off).
Script output includes export time, Blender scene
setup time, and Cycles time, including denoising and image encoding.

Keep one export and reuse it when tuning lighting or changing resolution:

```sh
BASE=http://localhost:4209/ node tools/cycles/render.mjs woodland-primary --export-only shots/look/woodland
node tools/cycles/render.mjs --from shots/look/woodland --size 800x450 --samples 8 --threads 2 \
  --window-ev=-1.25 --out shots/look/woodland-test.webp
node tools/cycles/render.mjs --from shots/look/woodland --threads 2 --out shots/look/woodland-primary.webp
```

`--save-export PREFIX` saves the same three intermediates during a render. Keep the GLB, sky floats and
metadata beside each other outside `public/`.

## Regenerate the gallery after merging

```sh
BASE=http://localhost:4201/ node tools/gallery.mjs --engine cycles
BASE=http://localhost:4201/ node tools/gallery.mjs --engine cycles --samples 48 cedar-great-room
```

The gallery command replaces the selected images in `public/gallery/` and regenerates its manifest.
The standalone driver writes under `shots/cycles/` by default. Build again to include new gallery images in the site.

## Sample panoramas

The published stops keep their registered heights and headings. These commands reproduce two of the views
for review under `shots/look/`.

```sh
node tools/cycles/render.mjs cedar-great-room --pose='-1.4,2.25,-5.35;1.95,2.25,-0.5;63;walk' \
  --pano --samples 4 --out shots/look/cedar-great-room-pano.webp
node tools/cycles/render.mjs coastal-kitchen --pose='1.55,1.93,-6.85;-0.3,1.93,-9.45;62;walk' \
  --pano --samples 6 --out shots/look/coastal-kitchen-pano.webp
```

## Lighting and material translation

The offline capture waits for the app's assets and uses its exposure anchors without warming the
WebGL pipeline. The live hook can also capture an already rendered view, including its metered exposure.
Cycles lights the exported geometry with the app's oriented sun-free HDRI, a separate sun and portals
inside eligible exterior openings. On golden-hour interiors, the export locates pendants and shades for
warm pools of light and Cycles brightens their diffusers. The wider sun angle softens the key and six
diffuse bounces carry sky fill into shadow. Short-range occlusion grounds furniture and cabinets at the
floor. Open Image Denoise and the AgX highlight roll-off retain detail on sunlit surfaces. Golden hour
uses AgX Medium High Contrast, and day uses Medium Low Contrast.

In Cycles, fitted bronze domes use a recessed luminous disc to show the warm fixture opening.

The daylight interior world uses separate strengths for visible sky and lighting. A camera-only exposure
filter spans each eligible exterior opening, so open and glazed sections of a slider share the same
exposure. Glass keeps its dielectric reflections and passes daylight independently of the filter.
The ocean adds a blue scattering component in the photographed view to retain color at the shallow
angles where it reflects the bright horizon.
Interior plaster and timber have shallow normal detail and roughness variation over their
existing scans. Upholstery and linen retain their imported sheen or get a soft sheen when the source has none.
Exterior skies keep the oriented HDRI, with camera-only exposure and color calibration per preset.
Day, golden and dusk renders use depth-based aerial perspective with the coastal shader's distance
falloff and a tint sampled from the HDRI horizon.

The GLB carries color and art maps, normals, roughness and metalness, AO, emissive materials, and
transmission. Cycles computes occlusion from the geometry. The importer adds a small normal bevel to
hard surfaces seen by the camera, models single-sided glazing as thin dielectric reflection and straight-through
transmission, and gives the sheer weave diffuse transmission. Foliage retains its opacity masks and
passes diffuse light through the leaves. The export bakes the canyon shader's six scanned ground blends
into color and normal atlases up to 4096 px, with most texels reserved for terrain around the camera.
The atlases use the terrain's existing slope, cover, curvature, drainage and turf masks. Within 100 m
of the camera, planted trees and reconstructed forest trees use their shared EZ-Tree meshes and leaf
and bark maps. Farther forest cards retain the app's tints and rounded canopy normals for Cycles lighting.
Exterior soil and gravel paths get additional shallow surface relief, with short-range contact shading
where the soil meets plants and hardscape.
Models, layout and available finish choices come from the loaded app. The atlases and forest meshes are generated
during capture and live only in the exported GLB.
