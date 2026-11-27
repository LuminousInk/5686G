# Cuby Studio handoff

Start with the [README](README.md) for the product and local commands. Run the commands below from `studio/`.

## Architecture

| Area | Where to work |
| --- | --- |
| Entry and routes | `src/main.tsx` renders the landing page and lazily loads the studio and photo tour. `src/ui/routes.ts` resolves hashes and recognizes the query flags used by local capture tools. `src/ui/App.tsx` connects the React controls, engine and offline export hooks. |
| Plan data and house geometry | `src/plans/` defines the five homes, views and tours. `src/engine/house/` builds the shell, openings, roofs, stairs and level-aware dollhouse cutaway from `HomePlan`. Aspen includes a lower walkout level. |
| Interiors and finishes | `src/engine/interior/` lays out rooms, fixtures, art and furniture. `src/engine/materials/` owns finish zones, the material library and texture loading. `src/engine/models.ts` loads the model assets or their procedural stand-ins from `standins.ts`. |
| Lots and lighting | `src/engine/site/` builds the hillside lots, terrain, planting and ocean. `src/engine/env/` handles HDRI, sun, night lights, room probes and coastal atmosphere. `atmospherePrecompute.ts` builds the Bruneton lookup tables on the GPU at runtime where supported. |
| Rendering | `src/engine/Engine.ts` owns scene rebuilds, adaptive resolution, exposure and the render-on-demand loop. `src/engine/render/` owns raster postprocessing, motion and still accumulation, exposure metering, path-traced refinement (`refine.ts`) and still-only screen-space reflections (`refineSSR.ts`). `quality.ts` gates automatic refinement and SSR to the high tier. |
| Navigation and capture | `src/engine/nav/` handles damped orbit and dollhouse controls, walk collisions, tap-to-walk and camera poses. `src/engine/photo/` prepares scenes for the browser tracer and its BVH worker. `exportBeauty.ts` exports the offline Cycles scene. `src/engine/bake/` separately selects lightmap geometry, lays out charts, exports the bake and binds atlases. |
| Website and authoring | `src/ui/site/` contains gallery presentation, OpenSeadragon zoom, React Aria controls and Motion transitions. `src/ui/galleryShots.ts` defines the gallery compositions. `src/ui/phototour/` loads the generated panorama manifest and connects rendered stops to the studio. `src/ui/designer/` contains the Konva plan canvas, editing actions, geometry, validation guidance, and draft storage and share codes. `Editor.tsx` and `planEdits.ts` handle the studio’s in-place plan editor. |

Run `npm run test` and `npm run lint` after code changes. When changing plan geometry, use `planProblems()` in `src/plans/validate.ts` and the plan and house tests. An opening spanning a wall segment boundary can appear on the floor plan while the wall builder skips the cut. Catalog share codes use positional plan, time and finish-option indices. Preserve those positions when editing the catalog, and check existing named-view (`-v-`) and camera-pose (`-p-`) links. Designer drafts use their own `#d1-…` format.

## Artifact host and public build

- The host’s strict CSP blocks WebAssembly and `fetch()` of `data:` and `blob:` URLs. The sandbox blocks downloads, printing and popups. It passes through plain `#name` fragments, so routes and share codes use letters, digits and hyphens. Photo mode displays a saveable image in place. The panorama viewer’s direct-image adapter loads same-origin WebPs through image elements.
- The full build ships glTF JSON with inline base64 mesh buffers and separate WebP textures. `models.ts` assembles a GLB in memory for GLTFLoader, using a JavaScript path compatible with the CSP. Public-sharing review applies a separate file policy and rejects non-media binary payloads, including those buffers inside JSON.
- `npm run build:public` sets `PUBLIC_BUILD` and excludes both model directories when copying assets. The runtime uses procedural stand-ins and includes the gallery and panorama WebPs. A lightmap with a mismatched signature falls back to live lighting. Run `npm run share-audit -- dist-public` for a local heuristic check of file types, large JSON and inline payloads. Acceptance by the host is still open.
- Keep each published Artifact version within **511 files**. The host’s publish operation accepts at most **255 file entries** per call.

## Interior lightmaps

`src/engine/bake/bakeScene.ts` fingerprints eligible opaque bake geometry, including furniture, its transforms, and relevant plan and lighting inputs. Objects tagged `bakeIgnore` and their descendants are excluded, including small decor explicitly tagged in the furniture code. House surfaces and selected built-ins receive the bake through deterministic `uv1` charts. Other eligible meshes contribute occlusion. Re-bake affected plan and preset pairs after changing the house, furniture or other baked geometry, or changing lighting or chart generation. Bump the signature version if the bake recipe or layout policy changes without otherwise changing the signature.

`tools/bake.mjs` exports a GLB, sun-free sky and metadata through `window.__bakeExport()` into `.cache/bake/`. `tools/bake/bake.py` bakes the direct and indirect sky plus sun bounce in Cycles. The app renders direct sun live. The script denoises with OIDN when available, flips the atlas rows back to the app’s UV orientation, and writes 2048² and 1024² RGBE WebP atlases and a signature sidecar under `public/assets/lightmaps/`. At runtime a matching bake replaces diffuse environment lighting and preserves reflections. Dusk, night, missing or stale bakes, and designer drafts use live lighting. Check `window.__engine.lightmapStatus` for the binding result and reason.

Use a stable preview of the full build and a Blender 5.3 Python environment with `bpy`, NumPy, OpenCV and Pillow. Set `BAKE_PYTHON` if it lives outside the default `/root/.venvs/bake/bin/python`. **Never rebuild `dist/` during a bake.** Keep the served build directory fixed throughout the run because the browser loads hashed chunks from it. With the preview already running, finish golden hour at 128 samples per pixel before running day at 64.

```sh
BASE=http://localhost:4173/ node tools/bake.mjs --times golden --samples 128
BASE=http://localhost:4173/ node tools/bake.mjs --times day --samples 64
```

Pass plan IDs to retry a subset. The checkout contains golden-hour files for every plan and day files for Cedar Ridge and Coastal Modern. Check signatures against the current furnished scene before treating those files as usable.

## Cycles stills and panoramas

`tools/cycles/render.mjs` loads a built scene in headless Chromium. `window.__beautyExport()` calls `src/engine/photo/exportBeauty.ts` to export the camera and full material scene as GLB, plus the oriented sun-free HDRI, sun, practical lights and portal metadata. `tools/cycles/render.py` computes its own lighting from those inputs. For offline exports the app uses exposure anchors and skips WebGL warm-up.

The Cycles look uses AgX, adaptive sampling and OIDN. The interior daylight calibration adds fill and a preset exposure offset, softens sun shadows and exposes the view through the glass separately. Cycles also translates thin glazing and sheers, adds camera-visible bevels and adds depth haze to daytime exteriors. For look changes, save an export with `--export-only PREFIX` and reuse it with `--from PREFIX`. Tune with `--ev`, `--white-balance` and `--bevel-scale`, using a smaller `--size` for iterations. Keep the GLB, sky floats and metadata together outside `public/`.

Default ceilings are 12 samples at 1600×900 for stills and 6 samples at 2560×1280 for panoramas, with four CPU threads. The first Cycles pass recorded roughly 2.5–5 minutes per still and 3–6 minutes per panorama on four cores. The driver reports export, Blender setup and render times separately. Use `--threads` to limit CPU use. The Python path resolves through `CYCLES_PYTHON`, then `BAKE_PYTHON`, then the default bake environment.

Build a fresh full snapshot and serve it separately from any running bake.

```sh
npx vite build --configLoader runner --outDir dist-cx
npx vite preview --configLoader runner --outDir dist-cx --port 4201 --strictPort
```

Run capture commands in a second terminal.

```sh
BASE=http://localhost:4201/ node tools/gallery.mjs --engine cycles
BASE=http://localhost:4201/ node tools/cycles/panos.mjs --render
node tools/thumbs-from-gallery.mjs
```

Pass gallery image IDs for targeted replacements. For panoramas, pass plan IDs and repeat `--stop STOP-ID` to narrow the run. Add `--force` to replace existing stops. The panorama tool requires 2560×1280 WebPs for the tour, caps it at 15 images and marks stops rendered as files appear. Its default preview port is 4206, so set `BASE` when sharing the Cycles preview. Rebuild the release snapshot after updating images and manifests. See the [Cycles controls and examples](tools/cycles/README.md).

## Publish an Artifact update

1. Build into a separate output directory, for example `npm run build -- --outDir dist-release` or `npm run build:public -- --outDir dist-release-public`. Audit the public candidate with `npm run share-audit -- dist-release-public`.
2. Serve the candidate with `node tools/csp-preview.mjs 4174 dist-release`, substituting the chosen output directory. Run `BASE=http://localhost:4174/ npm run smoke` and inspect its errors and screenshots. Open the bare root separately. Check that landing progress reaches readiness, the studio opens, and returning keeps the loaded scene. Exercise gallery zoom, a working photo tour and a designer draft when changing those paths. The smoke script enters the studio directly via query flags.
3. Generate the Artifact HTML and supporting-file manifest with `tools/artifact.mjs`. The script reads `dist/` relative to the working directory. To package a separate output, invoke the script by absolute path from a temporary directory whose `dist` symlink points to the release build. Use the generated `artifact.html` as the page and resolve supporting paths against the release output root when submitting files.
4. Diff relative paths and contents against the **previously published** file set for the target Artifact. Send new and changed files, including new hashed chunks, and send `null` for removed paths. Split a delta above 255 entries into multiple calls, counting deletions, and keep every resulting version within 511 files. Coordinate the entry HTML and chunk changes so the live page can resolve its assets. Verify the published version and retain its file set for the next delta.

## Parallel work

1. Give each worker a written brief with the goal, owned paths, shared interfaces, validation and CPU constraints. From `studio/`, run `tools/codex-agent.sh <name> <brief.md> [image ...]`. It starts from the current HEAD for a new name, uses `cx/<name>` under `../oc-work/wt/` by default, and writes a per-worker log under `../oc-work/logs/`.
2. Check the branch and HEAD before reusing a name. An existing worktree on the matching branch is reused with its existing edits and base. Use a fresh name when starting from a new baseline. The lead installs dependencies first because workers cannot run `npm install` against the shared dependency directory. The runner links `node_modules` and the asset cache if available. Use Vite’s `--configLoader runner` when the shared dependencies are read-only.
3. The lead reviews the worker’s diff, checks scope and integration points, and runs the relevant checks before committing in the worker tree and merging. Review the combined build for conflicting assumptions, route or share compatibility, accidental asset churn, and changes that invalidate bakes or gallery output. Run a CSP preview smoke and landing check before shipping.
4. Use `node tools/gemini-ask.mjs --prompt brief.txt --image shot.webp --out critique.txt` for one-shot visual critiques. Review the result against the code and the image. Smoke, bake, gallery, room-shot and Cycles tools answer Google Fonts requests with an empty local stylesheet to avoid network stalls. Headless Chromium uses software rendering in these tools, so collect performance numbers on a real phone.

## Open work

- Measure cold load, frame times during a walk and still-view behavior on real phones. Check lightmap binding on device.
- Confirm public-sharing acceptance with the host after auditing the public build.
- Continue the exterior Cycles fidelity pass. Compare exported terrain, planting and light against the live scene before replacing more gallery images.
- Render the 12 remaining panorama stops. The manifest currently marks two Cedar Ridge stops and the Coastal Modern kitchen as rendered.
- Finish the day bake at 64 samples per pixel and verify its signatures on the current scene. Verify golden-hour binding after the furniture changes as well.
- Update the designer chooser’s wordmark reference in `src/ui/designer/Designer.tsx` to the shipped PNG. It still points to the removed `cuby.svg`.
