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
| Camera | Level 360° equirectangular view with `--pano`. A still can set `--focus` in metres and `--f-stop`. |
| CPU | 4 threads. Set `--threads` to share the machine with a bake. |

Use `--size 800x450 --samples 8 --threads 2` for short lighting tests on a shared machine. Panoramas require a 2:1 aspect ratio. Use `--size 4096x2048` for a 4K panorama.
`--ev` sets an offset in stops from the calibrated exposure. `--white-balance` takes Kelvin.
`--bevel-scale` multiplies the 4 mm edge radius. `--haze` scales exterior aerial perspective (default 1, 0 turns it off).
Script output includes export time, Blender scene
setup time, and Cycles time, including denoising and image encoding.

Keep one export and reuse it when tuning lighting or changing resolution:

```sh
node tools/cycles/render.mjs woodland-primary --export-only shots/cycles/woodland
node tools/cycles/render.mjs --from shots/cycles/woodland --size 800x450 --samples 12 --ev 0.25
node tools/cycles/render.mjs --from shots/cycles/woodland --out shots/cycles/woodland-primary.webp
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

The two 2560×1280 WebPs under `public/pano/` use eye-height positions within the rooms.

```sh
node tools/cycles/render.mjs cedar-great-room --pose='-1.4,2.25,-5.35;1.95,2.25,-0.5;63;walk' \
  --pano --samples 4 --out public/pano/cedar-great-room.webp
node tools/cycles/render.mjs coastal-kitchen --pose='1.55,1.93,-6.85;-0.3,1.93,-9.45;62;walk' \
  --pano --samples 6 --out public/pano/coastal-kitchen.webp
```

## Lighting and material translation

The offline capture waits for the app's assets and uses its exposure anchors without warming the
WebGL pipeline. The live hook can also capture an already rendered view, including its metered exposure.
Cycles lights the exported geometry with the app's oriented sun-free HDRI, a separate sun, dusk and night
practicals, and portals inside eligible exterior openings. It calculates bounce light with adaptive
sampling and Open Image Denoise, then applies AgX. The daylight interior grade adds sky fill, a softer
contrast curve, and a preset-specific offset from the app's exposure to keep recesses readable.
Daylight windows use a shorter photographic exposure for camera rays through the glass. A wider
sun angle softens indoor shadows, and short-range occlusion grounds cabinets and furniture at the floor.
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
