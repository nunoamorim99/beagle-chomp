# Project conventions — read this before writing any three.js code

Every specialist agent in this project reads this file first. It is the single
source of truth for decisions that must stay consistent across agents.

---

## −1. This project is Beagle Chomp — read this before the generic advice below

This pack was written for a WebGPU/TSL third-person game. **Beagle Chomp is
not that game**, and where the two disagree, this section wins. Nothing below
is aspirational: it is what `src/` actually does today.

| | Beagle Chomp | What the generic sections assume |
|---|---|---|
| three.js | **r169**, pinned in `package.json` | r185 |
| Renderer | **`THREE.WebGLRenderer`** (`src/render/scene.ts`) | `WebGPURenderer` |
| Shading | **`MeshToonMaterial` via `toon()`** (`src/render/toon.ts`) | TSL node materials |
| Tone mapping | **`NoToneMapping`, deliberately** | AgX / ACES filmic |
| Lighting | a few explicit lights, **no `scene.environment`** | environment-first PBR |
| Assets | **none** — every mesh and texture is built in code | glTF + KTX2 pipeline |
| Physics | **none** — tile-stepping on a grid (`src/game/movement.ts`) | Rapier / Jolt |
| Post-processing | **none** | RenderPipeline node chain |
| Camera | fixed top-down rig | third-person follow camera |
| Units | **1 world unit = 1 tile** (`TILE = 1` in `src/game/grid.ts`) | 1 unit = 1 metre |

Three consequences worth stating outright:

- **`three/webgpu` and `three/tsl` are not used here.** At r169 they are the
  same bundle (`build/three.webgpu.js`) and node materials do not run on
  `WebGLRenderer`. Proposing TSL is proposing a renderer migration — say so
  explicitly and let the user decide; do not slip it into a fix.
- **The cel look is load-bearing, not a style preference.** `NoToneMapping`,
  the shared 3-step ramp and `MeshToonMaterial` are one system; changing any
  one of them silently breaks the other two. `roughness`/`metalness` do not
  exist on a toon material. The eye glint is the one deliberate
  `MeshBasicMaterial` exception. See the CLAUDE.md cel-shading rules.
- **Pure game logic must not import three.** `src/game/*` is unit-tested in
  Node. Only `src/render/*`, `src/editor/*` and `src/main.ts` may import it.
  After touching `src/game/{grid,movement,ghostAI}.ts` or the maze data, run
  `npm run test` and make it pass.

---

## 0. The verification rule (most important rule in this file)

**Three.js changes fast and your training data is behind it. The installed
package is the authority.** This project ships two offline indexes so that
"does this API actually exist?" costs two seconds instead of a guess.

### The symbol index — check any name in one grep

`.claude/agents/_shared/api-surface/` holds the complete export list of the
three.js installed in *this* project, generated from `node_modules`:

| File | Contents (counts are for the current r169 regeneration) |
|---|---|
| `three-core.txt` | every export of `three` — 421 symbols |
| `three-webgpu.txt` | every export of `three/webgpu` — 1100 |
| `three-tsl.txt` | at r169 this resolves to the **same bundle** as `three/webgpu`, so the two files are identical. Neither entry point is used by this project. |
| `addons.txt` | every `three/addons/**` module path and its exports — 306 modules |
| `VERSION.txt` | the version these were generated from — check it matches `package.json` |

Format is `kind<TAB>name` for the three entry points and
`import-path<TAB>exported names` for addons. So:

```bash
S=.claude/agents/_shared/api-surface
grep -P "\tbloom$"   $S/three-tsl.txt      # nothing → bloom is NOT in three/tsl
grep -w  bloom       $S/addons.txt         # → three/addons/tsl/display/BloomNode.js
grep -P "\tMeshPhysicalNodeMaterial$" $S/three-webgpu.txt
grep "^three/addons/loaders/KTX2Loader.js" $S/addons.txt
grep -iP "\t\w*shadow\w*$" $S/three-core.txt   # what shadow symbols exist at all?
```

**If a symbol is not in these files it does not exist in this revision.** Do not
write it. Say so, and offer the closest thing that does exist.

Regenerate after every three.js upgrade, from the project root:

```bash
node .claude/agents/_shared/tools/gen-api-surface.mjs
```

### The example corpus — copy from working code, not from memory

`_shared/examples-index.md` maps all 589 r185 examples to the agent that owns
them, with the one-time commands to check the corpus out locally. Once you have
it, "how is this actually done in this revision?" is also a grep:

```bash
grep -l "EffectComposer" examples/*.html          # who uses this API?
grep -n -A12 "new THREE.WebGLRenderer" examples/webgl_geometry_shapes.html
```

**Two caveats in this project.** `node_modules/three/examples/` ships only
`jsm/` and `fonts/` — there are no `*.html` files to grep until you check the
corpus out, and the index was built at **r185 while this project is on r169**,
so an example may exist upstream and not in your checkout. Prefer `webgl_*`
examples: `webgpu_*` is not the path this project is on (see §−1).

### Reading the source

```bash
node -p "require('./node_modules/three/package.json').version"
ls  node_modules/three/src/nodes/            # node classes
ls  node_modules/three/examples/jsm/tsl/     # TSL display/FX nodes
grep -rn "class RenderPipeline" node_modules/three/src/
```

### Renames and deprecations you will otherwise get wrong

Older tutorials, blog posts and model answers still use the left column. Every
one of these was confirmed against the r185 source.

> **This project is on r169, so the four rows marked ⚠ run BACKWARDS here.**
> `RenderPipeline`, `HDRLoader` and `THREE.Timer` do not exist at r169 — the
> grep against `api-surface/` returns nothing, which is the authority. Use
> `RGBELoader`, and `Timer` from `three/addons/misc/Timer.js`. Verify the row
> before you act on it; the table is a map of upstream history, not of this
> `node_modules`.

| Do not use | Use instead | Since |
|---|---|---|
| ⚠ `THREE.PostProcessing` | `THREE.RenderPipeline` | r183 — neither is used here |
| `renderer.renderAsync()` / `clearAsync()` | `await renderer.init()`, then the sync call | r181 |
| ⚠ `RGBELoader` | `HDRLoader` | r180 — **at r169 `RGBELoader` is still the correct one** |
| `effect.setResolution()` | `effect.setResolutionScale()` | r181 |
| ⚠ `THREE.Timer` (§3) | at r169 it is an addon: `three/addons/misc/Timer.js` | moved into core later |
| `BufferGeometryUtils.mergeBufferGeometries` | `mergeGeometries` | removed |
| `renderer.useLegacyLights` | nothing — lighting is always physical | removed r165 |
| `DRACOLoader.setDecoderConfig()` | `setDecoderPath(DRACO_GLTF_CONFIG)` | deprecated, removal r194 |
| `gtao(...)` | `ao(...)` from `three/addons/tsl/display/GTAONode.js` | naming |
| `renderer.capabilities.getMaxAnisotropy()` | `renderer.getMaxAnisotropy()` on `WebGPURenderer` | — |

Also note: **the post-processing effect nodes are not in `three/tsl`.** `bloom`,
`ao`, `ssr`, `dof`, `traa`, `taau`, `smaa`, `fxaa`, `fsr1`, `outline` and the
rest live in `three/addons/tsl/display/*Node.js`. `pass()` and `mrt()` *are* in
`three/tsl`. Getting this wrong is the most common import error on this path.

### Debugging a node graph: the Inspector

r185 ships an inspector used by 160 of the examples. On `WebGPURenderer`:

```js
import { Inspector } from 'three/addons/inspector/Inspector.js';
renderer.inspector = new Inspector();
// then expose any intermediate node in the panel:
const bloomPass = bloom( scenePassColor ).toInspector( 'Bloom' );
```

It is WebGPU-only — it warns and no-ops on the WebGL backend. Reach for it
before writing throwaway debug code.

**Never invent a property name, a constant, or an import path.** A confident
wrong API is the single most expensive thing you can produce here, because it
looks right and fails silently.

## 1. Target and stack

| Decision | Value |
|---|---|
| three.js revision | **r169**, pinned in `package.json` — read it, do not assume |
| Renderer | **`THREE.WebGLRenderer`**, everything imported from `three` |
| Shading | **`MeshToonMaterial`** on one shared 3-step ramp (`src/render/toon.ts`) |
| Language | TypeScript, **strict**. No `any` without a written reason |
| Web build | vanilla three.js + Vite, own render loop and scene graph |
| Project type | real-time browser game, fixed top-down maze chase, installable PWA |
| Deployment | Cloudflare Pages frontend + a Hono/Postgres API (`server/`) |

### What the WebGL + cel-shading path means in practice

- Import everything from `three`. **Do not** import from `three/webgpu` or
  `three/tsl` — at r169 they are one browser-only bundle, and node materials do
  not render on `WebGLRenderer`.
- Build materials with `toon({...})` from `src/render/toon.ts`, never
  `new THREE.MeshStandardMaterial`. `roughness` and `metalness` do not exist on
  a toon material; a converted call site drops them rather than passing them
  through (TypeScript catches this, which is the point of the helper).
- Every lit surface shares the **one** gradient texture instance — three.js
  keys shader programs partly on the gradient map, so sharing keeps the scene
  on one program variant. Do not build a second ramp.
- The frame loop is hand-written `requestAnimationFrame` + `renderer.render()`,
  driven by `src/game/game.ts`. Renderers read `entityWorld(e)` and never
  mutate logic.
- Raw GLSL `ShaderMaterial` / `onBeforeCompile` **does** work on this path (the
  backdrop dome already uses a shader), but prefer the toon helper for anything
  lit — a bespoke shader is a new program variant and a new thing to retune.
- Swapping a material's `map` between `null` and a texture changes the shader
  program: set `material.needsUpdate = true`.

### Framework-free systems

Write simulation and rendering logic as framework-free modules that take
explicit inputs and own no DOM: systems as plain classes/functions
(`update(dt)`, `dispose()`), no module-level singletons, no assumption that the
canvas or camera is a global. This is also what keeps `src/game/*` testable in
Node without three.

---

## 2. Colour management, units and tone mapping

These are non-negotiable and are the most common source of "it looks wrong but
I do not know why".

- `THREE.ColorManagement.enabled` stays `true` (the default). Never disable it.
- `renderer.outputColorSpace = THREE.SRGBColorSpace`.
- **Colour textures** (basemap/albedo, emissive) → `texture.colorSpace = THREE.SRGBColorSpace`.
- **Data textures** (normal, roughness, metalness, AO, displacement, masks) →
  leave as `THREE.NoColorSpace` / linear. Tagging a normal map as sRGB is a
  classic and very visible bug.
- Loader defaults differ per loader — verify, do not assume. `GLTFLoader` sets
  colour spaces correctly from the glTF spec; `TextureLoader` does not.
- Tone mapping is picked once for the project and lives in the renderer setup.
  **In Beagle Chomp that choice is `NoToneMapping`, and it is not up for grabs**
  (`src/render/scene.ts` carries the reasoning): a filmic shoulder re-compresses
  the toon ramp's top two bands into a gradient, which is exactly what the
  3-step ramp exists to avoid. The palette was retuned against linear output, so
  reinstating a curve means revisiting every colour. Never change it
  per-material.
- The generic PBR advice below does **not** apply to the game scene: there is no
  `scene.environment`, and "flat" is the intended look. `MeshToonMaterial`
  quantises whatever light it gets into three bands, so an env map mostly
  raises the floor of the darkest band and washes the ramp out. Light the scene
  with a small number of explicit lights and judge it against a render.
- Where PBR *does* still apply — the `/editor/` workbench can produce standard
  materials — lighting is physical: point and spot lights use candela with
  `decay = 2`, so `intensity: 500` is expected, not a bug.

---

## 3. Code conventions

- **Units**: 1 world unit = **1 maze tile** (`TILE = 1` in `src/game/grid.ts`),
  not 1 metre. Grid tile `(tx,ty)` maps to world
  `((tx-OX)*TILE, y, (ty-OZ)*TILE)`. Sizes are chosen to read at the game's
  fixed top-down framing, not to a physical scale. Keep the camera near/far
  plane tight — a far plane of `100000` destroys depth precision and z-fights.
- **Y-up**, right-handed. In grid terms `up = -Z`, `down = +Z`, `left = -X`,
  `right = +X`.
- **Naming**: `PascalCase` classes, `camelCase` instances, `SCREAMING_SNAKE`
  constants. Prefix scene-graph object names for lookups (`chr_beagle_root`,
  `env_terrain`, `fx_dust`).
- **Every allocation has an owner.** Any class that creates geometries,
  materials, textures, render targets or event listeners exposes `dispose()`
  and releases them. Leaked GPU memory is invisible until it is fatal.
- **No allocation in the render loop.** Reuse scratch `Vector3`/`Quaternion`/
  `Matrix4` instances declared at module scope. `new THREE.Vector3()` inside
  `update()` is a bug.
- **Delta time, not frame count.** Clamp the delta (e.g. `Math.min(dt, 1/30)`)
  so a tab-switch does not teleport an entity through a wall. `THREE.Timer` is
  **not in core at r169** — use `THREE.Clock`, or the addon at
  `three/addons/misc/Timer.js`.
- **There is no physics engine here.** Movement is tile-stepping on the grid
  (`src/game/movement.ts`) and collision is a walkability lookup. If a task
  seems to need a physics world, that is a design change — raise it, do not add
  a dependency.
- **TypeScript**: no `any` for three.js objects. If a type is missing, write
  the narrow interface you need rather than casting.

---

## 4. Output contract — what every agent must return

When you finish a task you return, in this order:

1. **What you changed** — file paths and a one-line reason each.
2. **How to see it** — the exact command to run and what the user should
   observe on screen. If it cannot be observed, say so.
3. **What you verified** — which APIs you checked against the installed
   package or an official example, and how.
4. **What you assumed** — every guess you made because information was
   missing. Be specific; this is where problems hide.
5. **Cost** — the render-budget impact of your change: draw calls added,
   texture memory added, extra render targets, extra passes. Estimate if you
   cannot measure.
6. **Handoffs** — sibling agents that should pick up the parts you did not own.

If a request is under-specified in a way that changes the result (art
direction, performance budget, target device, whether it must work on the WebGL
fallback), **ask one sharp question before writing code** rather than guessing
and producing something that has to be thrown away.

---

## 5. Ownership boundaries

You own your domain. When work crosses into another domain, do the minimum
needed to unblock yourself, then name the sibling agent that should own the
rest. Do not silently rewrite another agent's area.

| Domain | Owner |
|---|---|
| App bootstrap, renderer, loop, colour pipeline, scene graph, disposal | `threejs-scene-architect` |
| Meshes, buffers, curves, procedural geometry, LOD meshes | `threejs-geometry-engineer` |
| Materials, PBR look-dev, stylised/toon shading | `threejs-material-lookdev` |
| Textures, colour space, compression, atlases, UVs | `threejs-texture-pipeline` |
| Lights, shadows, environment/IBL, baking | `threejs-lighting-shadows` |
| TSL, node graphs, compute shaders, GLSL porting | `threejs-tsl-shader-engineer` |
| Clips, mixer, skinning, morphs, IK, retargeting | `threejs-animation-rigging` |
| Input, locomotion state machine, follow camera, gameplay feel | `threejs-character-controller` |
| glTF/GLB pipeline, loaders, Draco/KTX2/meshopt, exporters | `threejs-asset-pipeline` |
| Post-processing chain, render targets, AA, upscaling | `threejs-postfx-compositor` |
| Frame budget, instancing/batching, culling, memory, mobile | `threejs-performance-optimizer` |
| Cameras, controls, raycasting/picking, CSS2D/3D HUD | `threejs-camera-interaction` |
| Physics engines, colliders, character physics, spatial queries | `threejs-physics-collision` |
| Particles, VFX, water/sky/volumetrics, positional audio | `threejs-vfx-audio` |
| Decomposition, sequencing, cross-domain diagnosis | `threejs-tech-lead` |
