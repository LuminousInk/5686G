# Handoff: Cuby Studio 3D (for a new Claude Code session)

## State
A real-time 3D home configurator (three.js r187, React 19, Vite 8) has replaced the picture-based studio. It has five plans:
Cedar Ridge (the user's hero photo, recreated), Coastal Modern, Woodland Modern, Aspen Custom (main level) and Modern
Farmhouse (single storey). Features: walk through with full look up/down on phones, dollhouse, floor plan, finishes,
time of day, share codes, a ray-traced photo mode and a plan editor (v1).

`npm run check` passes: oxlint, 25 vitest tests and tsc plus the vite build. `npm run smoke` drives every mode on a
1440 px desktop and on an emulated iPhone 13. Point it at the strict-CSP server: `node tools/csp-preview.mjs`, then
`BASE=http://localhost:4174/ npm run smoke`.

The app is published privately as a claude.ai Artifact: https://claude.ai/artifact/Dc4CWcffvib7rsGXcgsxVC.
Update it in place by passing that URL. The first 3D version failed on the user's Android phone ("Could not load
this home") because of the host's CSP (see Gotchas). It is fixed and was verified under `tools/csp-preview.mjs`.
After the fix the user still has to confirm it on the real phone.

Git: the user allowed commits. Work is committed on branch `claude/opencode-console-setup-wa7xho`, but pushing failed
with "Claude doesn't have GitHub access to LuminousInk/5686G". The user must connect GitHub at
https://claude.ai/connect-github and install the Claude GitHub App on the repository. Until then the zip sent to the
user is the only copy outside this container. Hermes (from the previous handoff) was not touched this session.

## What the user asked for
- Phone viewing where you can move and look up and down, working like an archviz walkthrough
  (Shapespark, house-configurator-01.netlify.app).
- Near-photoreal outdoor and indoor visuals at the level of their hero photo, and that exact house recreated.
- A UI that makes browsing several home plans obvious.
- Then turn it into an editor, building on open-source pieces where it helps: three-gpu-pathtracer is used, threepipe
  and r3f were considered.

## Constraints
No public file hosts. Ask before credentials, money, public URLs or email. Artifacts: publish privately only.
Git: the old "No commit/push" was lifted by the user ("commit all you want"). Commit to
`claude/opencode-console-setup-wa7xho` only, never `main`.

## Layout
- `src/engine/`: renderer and loop, skies, materials, the plan-to-3D house builder, site and lawn, furnished
  interiors, navigation and photo bake. See README "How it is built".
- `src/plans/`: the five plans as data, plus `validate.ts`, whose `planProblems()` checks plan data that the builder
  would otherwise silently skip.
- `src/ui/`: React UI, `Editor.tsx`, and `planEdits.ts` (pure, tested edit operations).
- `src/vendor/ez-tree/`: procedural trees (MIT).
- `tools/`: asset pipeline, screenshots, interaction tests, thumbnails, artifact packaging.
- `public/assets/` (about 35 MB of built web assets, CC0) is included. `.cache/raw` (about 125 MB of Poly Haven
  downloads) is not. To add or change assets, run `python3 tools/fetch_assets.py` and then `node tools/build_assets.mjs`.

## Publishing the Artifact
1. `npm run build && node tools/artifact.mjs` writes `dist/artifact.html` and `dist/artifact-files.json`. Test the
   build under `tools/csp-preview.mjs` first.
2. Publish `dist/artifact.html` with `root: dist` to the URL above. Send only new or changed files: the hashed
   bundles change, and `public/` files keep their names. Send `null` for old bundle names.
3. The host serves web file types only, so there are no `.hdr` or `.glb` files:
   - Skies are RGBE packed into lossless WebP (`tools/encode_hdri.py`).
   - Models are glTF JSON with one inline buffer, decoded in JS, plus separate `.webp` textures. There is no
     meshopt, because the host refuses WebAssembly.
   - Only a plain `#name` hash survives, so share codes look like `#c-<plan>-<time>-<option per zone>`.
   - Downloads are blocked, so photo mode shows the image to long-press or right-click.

## Gotchas
- The Artifact host has a strict CSP that `vite preview` lacks. The first 3D publish failed on the user's phone with
  "Could not load this home" because WebAssembly (the meshopt decoder) and `fetch()` of `data:` URLs (inline model
  buffers and textures) were refused. Models are now plain glTF JSON decoded in JS, with external textures.
  Always test with `node tools/csp-preview.mjs` and `BASE=http://localhost:4174/`.
- Opening cuts: `buildExteriorWalls` cuts an opening only when it fits one stretch of wall. One across a joint between
  volumes, or on a wall shared with a lower volume below its roof, is silently skipped (the floor plan would still
  draw it). Keep `src/plans/plans.test.ts` green when editing plans.
- three r187: `vColor` is a vec4 in shaders, PCFSoftShadowMap is gone, and env textures are half-float because iOS
  cannot filter float32. `scene.environmentRotation` turns the sky, and the sun light is derived from the HDRI.
- Browser tests and screenshots: run them against `vite preview` on a build. Dev-server HMR disturbs long runs.
  Headless Chromium renders with SwiftShader, which is slow and says nothing about phone GPU speed.
- Editor layout: avoid a `%` max-height on a grid item in an `auto` row. It resolves against the row, which is sized
  to the full content first, so the panel gets clipped and the rest of the row is left blank. Use `vh`.
  A `display: none` child leaves grid placement, so the phone 3D sheet, which hides the canvas, declares three rows.
  The editor's view box holds still during a drag and refits once an edit leaves it.
- Phones get the `low` tier: 512 px textures, `models-lo`, half-res AO and fewer grass blades. The dusk sky exists at 1k only.
- The path tracer is three-gpu-pathtracer 0.0.28, the WebGL version (deprecated upstream in favour of WebGPU). It loads
  lazily, and `photo/bake.ts` turns instanced and shader-driven pieces into plain meshes first.

## Open / next
- Two storeys (levels plus stairs): Aspen's walkout level and the farmhouse's upstairs.
- Aspen is a simplified massing of the user's drawing. Its bedroom wing backs onto the garage, so Bedroom 3 has no
  window, and a west window that opened into the garage was removed. Next: re-lay Aspen from the drawing, with the
  garage beside the office and gym and the bedrooms toward the ADU.
- Plan edits live in one browser (localStorage), and share codes carry plan, finishes and light only. A shared
  Artifact database would let edits travel.
- Per-room light probes or baked lightmaps for far rooms. Frame times on real phones are not measured yet.
- The UE5 pixel-streamed demo (Arcware) could not be viewed from the sandbox because WebRTC is blocked. Matching it
  more closely needs screenshots from the user.
- No gallery picture is set on the Artifact. A 1200x630 cover (`cover.jpg`) was sent to the user and can be set from
  the Share menu.
