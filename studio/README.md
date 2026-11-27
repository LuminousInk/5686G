# Cuby Studio

Cuby Studio is a static website and a browser-based 3D home configurator built with React, Vite and three.js. It includes five furnished plans on coastal hillside lots.

| Home | Plan ID |
| --- | --- |
| Cedar Ridge | `cedar-ridge` |
| Coastal Modern | `coastal-modern` |
| Woodland Modern | `woodland-modern` |
| Aspen Custom, with a lower walkout level | `aspen-custom` |
| Modern Farmhouse, single storey | `modern-farmhouse` |

## Explore

- **Website.** The landing page doubles as the studio loading screen. It shows progress while the 3D scene loads in the background and keeps the scene ready when you return to the site. Each `#home-<plan-id>` page has a floor plan, renders and finish options. The filterable `#gallery` opens renders in a deep-zoom lightbox with links to the matching 3D view. The `#compare` slider compares paired renders.
- **360° photo tour.** Open a tour from a home page or the gallery. The `#photo-<plan-id>` routes show Cycles panoramas with room captions, links through doorways between available stops and an **Explore in 3D** link to the same viewpoint. Cedar Ridge has two rendered stops and Coastal Modern has one. The other stops are listed in the tour manifest.
- **3D studio.** Open `#studio` to orbit the house, walk inside with touch or mouse and keyboard, lift the roof in dollhouse mode, or enter a room from the floor plan. Each home has a guided tour at `#tour-<plan-id>`. Tap a surface through Finish Hotspots to change its finish, or use the style panel to change finishes and time of day. A share link records the home, finishes and light, plus a named view or the current camera pose.
- **Stills.** The scene renders interactively while you move. Supported high-quality devices can progressively refine an orbit or walk view with path tracing while the camera rests. Photo mode requests a longer capture and displays the result in the app.
- **Home designer.** Open `#design` and choose a footprint template or duplicate a presentation home. Edit the footprint, levels, rooms, openings, stairs, roofs and finishes on the hillside lot. Preview the draft in 3D or walk through it. Drafts save in the current browser and can be shared by link or copied design code.

## Run locally

Run commands from `studio/`. Use Node 20.19.x or 22.12+ for Vite. The web-ready assets are tracked in the repository.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server. |
| `npm run build` | Type-checks and builds the static site in `dist/`. Use `npm run preview` to serve it locally. |
| `npm run build:public` | Builds `dist-public/` with procedural stand-ins for model assets, for Artifact public-sharing review. |
| `npm run test` | Runs the Vitest suite. |
| `npm run lint` | Runs oxlint on `src/` with warnings treated as errors. |
| `npm run smoke` | Drives the studio in desktop and emulated iPhone viewports and saves screenshots. It targets the dev server by default. Set `BASE` to use a preview. |
| `npm run share-audit -- dist-public` | Checks a build for file types and inline payloads that can trigger public-sharing review. |
| `node tools/bake.mjs --times golden --samples 128` | Bakes golden-hour interior lightmaps. Pass plan IDs to limit the run. |
| `node tools/gallery.mjs --engine cycles [image-id ...]` | Regenerates gallery stills and the catalog under `public/gallery/`. |
| `node tools/cycles/render.mjs cedar-great-room` | Renders a single still. Use `--pano` for a 360° panorama. |
| `node tools/cycles/panos.mjs [plan-id ...] --render` | Renders missing tour stops and updates `public/pano/manifest.json`. Omit `--render` to update the manifest from existing images. |
| `node tools/thumbs-from-gallery.mjs [plan-id ...]` | Crops plan-card thumbnails from the golden-hour gallery elevations. |

Smoke, bake and Cycles capture tools require a locally resolvable Playwright package and Chromium. If they are missing, install Playwright locally with `npm install --no-save --package-lock=false playwright`, then run `npx playwright install chromium`. Bake and Cycles rendering also require a running preview and a Python environment with Blender. See [Handoff](HANDOFF.md) for preview ports, bake order and publishing.

## Assets and licences

- **CC0 assets.** Poly Haven supplies HDRI skies, textures and models. ambientCG supplies finish maps. The shipped Khronos glTF Sample Assets model is Wayfair’s SheenChair. Artwork from the Art Institute of Chicago is CC0 1.0. See the [model credits](tools/model-credits.json) and [art manifest](public/assets/art/manifest.json).
- **CC BY 4.0 assets.** Adapted furniture and fixtures come from Sketchfab via Objaverse. Per-model titles, authors and source links are in the [Objaverse manifest](tools/objaverse.json) and the in-app credits.
- **MIT.** Takram three-geospatial and its atmosphere package, EZ-Tree, camera-controls, Photo Sphere Viewer, Motion, Konva and React Konva, three.js and three-gpu-pathtracer. Eric Bruneton’s atmospheric scattering implementation is BSD-3-Clause. See the [atmosphere notice](src/engine/env/atmosphere-lut/ATMOSPHERE-LICENSE.txt) and [EZ-Tree licence](src/vendor/ez-tree/LICENSE).
- **Other library licences.** OpenSeadragon is BSD-3-Clause, React Aria Components is Apache-2.0, n8ao is ISC and postprocessing is Zlib. Chakra Petch is served through Google Fonts under the SIL Open Font License. See the [package lock](package-lock.json) and [font declaration](index.html).

To refresh source assets, use `tools/fetch_assets.py`, `tools/fetch_objaverse.py` or `tools/fetch_art.py` for the relevant source, then run `node tools/build_assets.mjs` to produce the web assets.
