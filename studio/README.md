# Cuby Studio 3D

A real-time 3D home configurator for Cuby. Browse five home plans, walk through them, change finishes and
light, edit the plan, and render a ray-traced photo. Everything runs in the browser (three.js), with no
cloud GPU streaming, so it works as a static site or a claude.ai Artifact.

Homes: **Cedar Ridge** (the hero photo, recreated), **Coastal Modern**, **Woodland Modern**, **Aspen Custom**
(main level), **Modern Farmhouse** (single storey).

## Run it

```bash
npm install
python3 tools/fetch_assets.py     # CC0 assets from Poly Haven into .cache/raw (about 125 MB)
node tools/build_assets.mjs       # web-ready textures, models and skies into public/assets (about 40 MB)
npm run dev                       # http://localhost:5173
npm run build                     # static site in dist/ (relative paths)
npm run check                     # oxlint, unit tests (plan data, share codes, editor, host-safe models), build
npm run smoke                     # drives every mode, desktop + phone (dev server running, or BASE=...)
```

`src/plans/validate.ts` (`planProblems`) flags plan data the 3D builder would silently skip, such as a window that
straddles a joint between volumes or opens into a neighbouring volume. The plan tests run it on every plan.

Test flags (query string): `quality=low|medium|high`, `plan=<id>`, `time=golden|day|dusk|night`,
`view=<view id>`, `frames=<n>` (accumulation frames), `tm=aces|agx|neutral`, `ui=0`, `sheet=none`.

Tools that need the dev server (or `BASE=http://localhost:4173/` with `npx vite preview`):

```bash
node tools/shot.mjs "?quality=medium&plan=cedar-ridge" shots/hero.png 1600 740   # one screenshot
node tools/interact.mjs [--mobile]     # drives every mode (walk, look up, tap-walk, dollhouse, plan, style, editor)
node tools/photo.mjs                   # path tracer smoke test
node tools/thumbs.mjs                  # plan card thumbnails into public/thumbs
node tools/artifact.mjs                # after `npm run build`: dist/artifact.html + dist/artifact-files.json
node tools/csp-preview.mjs             # serves dist/ under a strict CSP like the artifact host (port 4174)
```

## Controls

| Mode | Touch | Mouse / keyboard |
| --- | --- | --- |
| Outside | drag to circle and tilt, pinch to zoom, two fingers to slide | drag, scroll, right-drag or Shift-drag |
| Walk | drag to look (full up/down), tap the floor to walk there, stick or pinch to move | drag, click the floor, W A S D / arrows, Shift runs |
| Dollhouse | roof and ceilings lift off; tap a room to walk into it | same |
| Floor plan | tap a room to stand in it | click |

Holding still makes the picture converge: jittered frames accumulate (anti-aliasing, soft sun shadows from a
sun-disk sample, denoised AO), then rendering stops until something changes (battery friendly).

## How it is built

```
src/engine/
  Engine.ts            renderer, scene, render-on-demand loop, eye adaptation, interior light probe, rebuilds
  quality.ts           low / medium / high tiers (phones get smaller shadow maps, half-res AO, fewer blades)
  render/pipeline.ts   postprocessing: RenderPass -> N8AO -> accumulation (HDR) -> bloom, ACES, grade, vignette -> SMAA
  env/environment.ts   HDRI skies: finds the sun disk, removes it from the IBL, drives a shadow-casting sun light
  env/lights.ts        dusk / night lights (always present at 0 intensity, so no shader recompiles)
  materials/           texture bank (Poly Haven sets, metre-scaled UVs), finish catalog, material library
  house/               plan data model (types.ts) -> walls, cladding, openings, roofs, decks, porches, stairs
  interior/            furniture by room type (anchor wall finder, Poly Haven models + procedural kitchen/bed/bath)
  site/                terrain, camera-following lawn, feather grass, rock gardens, trees (ez-tree), furniture
  nav/navigator.ts     orbit / walk / dollhouse controls, collisions, tap-to-walk, tweens
  photo/bake.ts        turns instanced / shader-driven pieces into plain meshes for the path tracer
src/plans/             five plans as data (blocks, walls, openings, rooms, decks, landscape, views, finishes)
src/ui/                React UI: plan browser, style panel, floor plan, editor, photo mode, share link
src/vendor/ez-tree/    procedural trees (MIT), trimmed
tools/                 asset pipeline, screenshots, interaction tests, thumbnails, artifact packaging
```

### Plans are data

A plan is a set of rectangular **blocks** (massing volumes) with a roof (`shed`, `gable`, `flat`) and a cladding
per side; walls, cladding boards and seams, gutters, soffits, ceilings and floors are generated. Openings sit on
block sides (`at` = distance from the west or north corner) or on interior walls. Touching blocks are joined:
a taller block's wall continues above a lower roof, overhangs stop at taller neighbours. Rooms drive the
furniture, the floor plan labels and the light probe. See `src/plans/cedarRidge.ts`.

### Photorealism without cloud GPUs

- Real captured skies (Poly Haven HDRIs). The sun is cut out of the IBL and replaced by a directional light,
  so it casts real shadows; its colour and irradiance are measured from the HDRI.
- Physical materials with scanned textures at real-world scale; per-board colour variation on cladding and decks.
- Real geometry for details people look at: individual boards, standing seams, window frames set into the
  wall, gutters, downspouts, slat railings, solar cells.
- An interior light probe (captured after the sun lights the rooms) gives warm bounce light indoors.
- A path-traced photo mode (three-gpu-pathtracer) with the full HDRI for stills.

### Editor (v1)

Pencil button. Select a volume and drag its handles (touching volumes, rooms and wall ends move with it),
change roof type, heights, direction and cladding; move, add or delete windows and doors; draw, move or
delete interior walls; add a volume. Undo/redo, reset. Edits rebuild the 3D house in place (landscape kept) and
are saved in the browser (localStorage). "Copy plan data" copies the plan JSON.

### Runs on a locked-down host

The claude.ai artifact host enforces a strict Content-Security-Policy. A `vite preview` test does not, so always
re-test a build with `node tools/csp-preview.mjs` and `BASE=http://localhost:4174/ npm run smoke`. What the policy
rules out, and how the app avoids it:

- WebAssembly is refused, so models are not meshopt-compressed (its decoder is WebAssembly).
- `fetch()` of `data:` and `blob:` URLs is refused, so each model is a glTF JSON with one inline base64 buffer.
  `src/engine/models.ts` turns it into a GLB in memory instead of letting GLTFLoader fetch the URI, and the model
  textures are separate same-origin `.webp` files.
- A model that still fails is skipped (`skippedModels`) and the home loads without it. A failed home load shows
  the reason and a Try again button.

## Assets and licences

Skies, textures and models: Poly Haven, CC0. Trees: ez-tree (MIT, vendored). Font: Chakra Petch (OFL).
three.js, postprocessing, n8ao, three-mesh-bvh, three-gpu-pathtracer: MIT.

## Known limits / next

- One storey: Aspen's walkout level and the farmhouse's second floor are not modelled yet (needs levels + stairs).
- Share links carry plan, finishes and light; plan edits stay in the browser that made them.
- Interiors use one light probe per home; per-room probes or baked lightmaps would improve far rooms.
- The path tracer is the WebGL one (deprecated upstream in favour of WebGPU); swap when WebGPU is everywhere.
