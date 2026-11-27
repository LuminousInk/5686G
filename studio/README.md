# Cuby Studio Variant A

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
node tools/bake.mjs                    # baked interior lightmaps (see below; needs the Blender venv)
```

Agents (optional): `tools/oc-agent.sh` runs a coding agent on an OpenCode Go model in its own git worktree;
`tools/gemini-agent.sh` does the same with the Gemini CLI (shell allowlist in `tools/gemini-policy.toml`), and
`tools/gemini-ask.mjs` makes one-shot Gemini calls (text + images) for batch jobs such as rating asset thumbnails,
which suits a free-tier key far better than an agent loop.

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
  interior/            furniture by room type: procedural modern kit + Poly Haven/Wayfair models, layouts per room
  bake/                lightmap UVs, runtime lightmap binding, export of the loaded home for the offline bake
  site/                terrain, camera-following lawn, feather grass, rock gardens, trees (ez-tree), furniture
  nav/navigator.ts     orbit / walk / dollhouse controls, collisions, tap-to-walk, tweens
  photo/bake.ts        turns instanced / shader-driven pieces into plain meshes for the path tracer
src/plans/             five plans as data (blocks, walls, openings, rooms, decks, landscape, views, finishes)
src/ui/                React UI: plan browser, style panel, floor plan, editor, photo mode, share link
src/vendor/ez-tree/    procedural trees (MIT), trimmed
tools/                 asset pipeline, screenshots, interaction tests, thumbnails, artifact packaging, lightmap bake
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
- Camera-style exposure indoors (`render/meter.ts`): the HDR frame is reduced to 32 x 32 log luminance, read back
  without stalling, and a trimmed, center-weighted average sets the exposure, with a guard against extreme
  blowouts. Readings are taken while the camera moves and once when it stops, with 10% hysteresis, so a still view
  converges and stops rendering. Outside, each time of day keeps its tuned exposure.
- Roof tops face the sun, so on their own they never reach the shadow map; an invisible shadow-only plane inside
  each roof slab (`SHADOW_ONLY` in `house/roofs.ts`) blocks the sun, which otherwise leaked in along wall/ceiling
  joints at a low sun.
- A path-traced photo mode (three-gpu-pathtracer) with the full HDRI for stills.

### Baked lighting

Interiors are lit by baked lightmaps (`src/engine/bake`, `tools/bake`):

- `lightmapUV.ts` gives every interior shell mesh deterministic lightmap UVs (attribute `uv1`): triangles are
  grouped into flat charts, each chart is projected at a fixed texel density (40 per metre) and all charts are
  shelf-packed into one 2048 atlas. The same plan always yields the same layout, and a geometry signature
  fingerprints the input.
- `exportBake.ts` (called as `window.__bakeExport()`, wired in `src/ui/App.tsx`) packs the loaded home for the
  bake: one GLB with the lightmap targets (`LM_*`, atlas UVs as their only UV set) and every other opaque mesh
  as an occluder (`OCC_*`), plus the world-space, sun-free sky and the sun, so Blender lights the scene exactly
  like the app.
- `tools/bake.mjs` drives export + bake per plan and time of day (default: golden and day for all five plans).
  Usage: `npm run build && npx vite preview`, then `node tools/bake.mjs [plan ...] --times golden,day
  --samples 64`. It calls `tools/bake/bake.py` (Blender as a Python module, venv at `/root/.venvs/bake`),
  where Cycles bakes the sky's light (direct through windows + every bounce) plus the sun's bounce; the direct
  sun stays real time, so sun patches stay sharp and move with the time of day. The result is denoised with
  Intel Open Image Denoise (RTLightmap filter, pip package `oidn`) after growing the charts into their gutters.
  It writes RGBE-in-WebP lightmaps to `public/assets/lightmaps/<plan>-<time>.webp` (2048), a `-1k` copy for
  phones and a `.json` sidecar (signature, scale). Blender's glTF import flips V, so `bake.py` flips the rows
  back before writing. A bake takes about 10 minutes per plan and time on 4 CPU cores.
- `lightmaps.ts` binds a lightmap only when its signature matches the built geometry; edited plans and stale
  bakes fall back to the live lighting. Lightmapped materials drop the IBL's diffuse term (the bake already
  contains it; reflections stay) and get no mipmaps, which would blend across charts. Per-room exposure:
  `Engine.insideExposure()` meters the baked floor light of the room the camera is in.

**Re-bake whenever house or furniture geometry changes.** The app refuses a lightmap whose signature no longer
matches the house shell; furniture is not part of the signature (it only casts the contact shadows baked into
floors), so after furniture changes nothing warns you: re-bake by hand.

### Interiors

- `src/engine/interior/modern.ts` is a procedural modern furniture kit: platform bed, nightstand, lamps, dining
  table and chairs, bar stool, sideboard, media console + TV, wardrobe, sofa, area rug. `FURNITURE_FOOTPRINTS`
  lists each piece's footprint for layout. Also used: Wayfair models (GlamVelvetSofa, SheenChair,
  SheenWoodLeatherSofa, CC BY 4.0) and Poly Haven models (modern_wooden_cabinet, wooden_display_shelves_01,
  desk_lamp_arm_01).
- `src/engine/interior/interior.ts` lays out rooms with door keep-out zones and walkways, a focal point (the
  sofa faces a media wall), tall pieces only on windowless walls, beds that slide along the wall to fit, and a
  view-facing seating group for glass-walled great rooms. Big pieces get colliders.
- Interior doors read as doors: palette wood leaf, lever handles and hinges, swinging into the larger room,
  with a collider.
- An "Interior walls" finish zone with seven options (warm white, greige, sage, clay, fog blue, charcoal,
  limewash); each home has its own default. Interior paint is evenly matte (no roughness noise: glossy patches
  mirrored the windows as blotches once lightmaps took over the diffuse light).
- Photoreal furniture and fixtures from Objaverse (Sketchfab uploads, CC BY 4.0; `tools/objaverse.json` lists
  authors, `tools/fetch_objaverse.py` downloads them, `build_assets.mjs` converts spec-gloss materials and drops
  shadow-catcher discs). They were picked from 1,722 CC0 / CC BY candidates rated by a Gemini swarm, then checked
  by hand from four-view renders. `MODEL_YAW` in `models.ts` turns the ones whose front is not +z, and `placeModel`
  sizes by footprint (`width`, `depth`, `height`, or width and depth together).
- Kitchens are built from `interior/kitchenParts.ts`: slab doors and drawer stacks with 3 mm reveals and pulls, toe
  kick, oven tower, induction hob, hood, floating shelves, island with a waterfall top.

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
GlamVelvetSofa, SheenChair, SheenWoodLeatherSofa: Wayfair LLC, via the Khronos glTF Sample Assets
(https://github.com/KhronosGroup/glTF-Sample-Assets), CC BY 4.0.
Furniture from Objaverse (https://huggingface.co/datasets/allenai/objaverse, Sketchfab uploads), CC BY 4.0:

- bar_stool_wood: "Barstool Round" by TabbieCat (https://sketchfab.com/3d-models/barstool-round-b221ad482e084c449408c229cab380d6)
- basin_mixer_dark: "RENDER PRO" by kreion (https://sketchfab.com/3d-models/render-pro-ef501e91ba6641a29e0515a10fdac631)
- bed_dark_headboard: "Bed" by dearsindy (https://sketchfab.com/3d-models/bed-8926f6be27704713980076253a78e057)
- bed_upholstered_white: "Bed For Vr" by olamii (https://sketchfab.com/3d-models/bed-for-vr-2bd3fcc82c9f43cfb0c8cf26c7d0107c)
- desk_lamp_black: "Luminaria" by williamozelimtorres (https://sketchfab.com/3d-models/luminaria-4b9a5c4d5e20434793388325ec18ba57)
- dining_chair_bentwood: "Chair" by zhousongjiang (https://sketchfab.com/3d-models/chair-d2785b57e7da45858f2fe8bf4dedd68d)
- dining_table_oak: "Kitchen Table" by CioJay (https://sketchfab.com/3d-models/kitchen-table-d7afff23c741411c82a5994ae9940669)
- dresser_tall: "Leaves 40x60デスクサイドドロワー BC" by classe-saga (https://sketchfab.com/3d-models/leaves-40x60-bc-abbc90bbd5474f73b16482ccd10e07ec)
- fridge_steel: "LG LFX25974ST B005VV62QY" by allenbranch (https://sketchfab.com/3d-models/lg-lfx25974st-b005vv62qy-53ad8efeb5e9427a901fc669b440e3cf)
- kitchen_faucet: "Grohe G-32467002" by trendforward (https://sketchfab.com/3d-models/grohe-g-32467002-8d28b4123c6641b19c6557cf8f2f80c6)
- mirror_wood: "Mirror in recycled wood." by grove4069 (https://sketchfab.com/3d-models/mirror-in-recycled-wood-d85091d6801a46d2ae1654c0ba8f8af3)
- sectional_grey: "Escuadra Victoria Izquierda II" by Pablo.Portela (https://sketchfab.com/3d-models/escuadra-victoria-izquierda-ii-0eb6c94aa40c41b480cf35de229e8e88)
- shower_black: "12 Le Vivi Milan Shower System" by 13213213213 (https://sketchfab.com/3d-models/12-le-vivi-milan-shower-system-776a3b4bb4f04594b8fae2f5af691cb1)
- sideboard_midcentury: "AD-012" by zhousongjiang (https://sketchfab.com/3d-models/ad-012-7d0e63fad86240a6a827fd4d9a9ba507)
- sofa_beige: "Feathers 5 Seat" by mohitoz (https://sketchfab.com/3d-models/feathers-5-seat-fbadc209177641978444636641a6d515)
- stool_aalto: "Aalto Stool" by mikkoh (https://sketchfab.com/3d-models/aalto-stool-36af1647d51e4a869af42b7127d64558)
- table_lamp_white: "Настольная лампа Favourite" by fedomo (https://sketchfab.com/3d-models/favourite-a9f27de045ff4869a48005dece8444a6)
- toilet_modern: "HD177A" by wadeedchishty (https://sketchfab.com/3d-models/hd177a-455028add66d48e7ae391beda0a6dae6)
- towel_bar: "MC-05-0085" by ubaid.kfat (https://sketchfab.com/3d-models/mc-05-0085-42afb2b0a7ea4ff086acd6da28787bb5)
- vanity_floating: "Aquaterm170 EL13 4 Zn Z 120 V1" by crosslag (https://sketchfab.com/3d-models/aquaterm170-el13-4-zn-z-120-v1-6441fe1ec6744bacaafd3b21c424fc91)

three.js, postprocessing, n8ao, three-mesh-bvh, three-gpu-pathtracer: MIT.

## Known limits / next

- One storey: Aspen's walkout level and the farmhouse's second floor are not modelled yet (needs levels + stairs).
- Share links carry plan, finishes and light; plan edits stay in the browser that made them.
- Only golden hour and day are baked; dusk and night interiors use the live lighting.
- An edited plan (or a stale bake) falls back to the live lighting, since a lightmap binds only on a signature
  match. Re-baking takes about 10 minutes per plan and time of day on CPU.
- The path tracer is the WebGL one (deprecated upstream in favour of WebGPU); swap when WebGPU is everywhere.
