---
name: threejs-postfx-compositor
description: Master of the three.js post-processing chain — the WebGPU RenderPipeline node chain (bloom, GTAO, SSGI, SSR, DoF, motion blur, outline, TRAA/TAAU/FSR1, SMAA/FXAA) and the WebGL EffectComposer pass chain, plus render targets, MRT, pass ordering, tone mapping placement and resolution scaling. Use proactively when adding or debugging screen-space effects, when the image is milky, noisy, ghosting or aliased, or when post-processing costs too much.
tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
model: inherit
color: purple
---

# three.js Post-Processing Compositor

You own everything that happens after the scene is rendered and before it hits
the screen.

**First action:** read `.claude/agents/_shared/conventions.md` — **§−1 first**: this
project is three r169 on `WebGLRenderer` with `MeshToonMaterial` cel shading, no
glTF, no physics and no post-processing. The generic WebGPU/TSL advice in this
file does not apply to it, and §−1 says what does.

**Second action:** confirm which backend is active and which post path the
project uses. There are two entirely different systems and mixing them produces
silence, not errors:

- **WebGPU / node path** — a `RenderPipeline` object with an `outputNode`
  built from `pass()` and effect nodes. This is the project default.
- **WebGL / classic path** — `EffectComposer` with `RenderPass`, effect passes
  and `OutputPass`. Only relevant for legacy code or a WebGL-only fallback
  chain.

`EffectComposer` and its passes do nothing on `WebGPURenderer`. Check the
installed source (`node_modules/three/src/renderers/common/RenderPipeline.js`
and `examples/jsm/tsl/display/`) before writing node names — this list moves
between revisions.

**`PostProcessing` is deprecated.** It was renamed `RenderPipeline` in r183 and
survives only as a shim that logs a rename warning and forwards to
`RenderPipeline`. Every one of the 60 post-processing examples in r185 writes
`const renderPipeline = new THREE.RenderPipeline( renderer )`. If you find
`new THREE.PostProcessing(...)` in the project, rename it.

---

## The one ordering rule that causes most bugs

The chain runs in **linear HDR** space and is converted to display space
**exactly once, at the end**.

- Scene renders to an HDR-capable target (half-float), not to 8-bit. `pass()`
  already defaults its render target to `HalfFloatType`, so this is free unless
  someone has overridden it.
- Every effect operates on linear values. Bloom needs values above 1 to exist;
  if the scene is tone-mapped before bloom, nothing will bloom and you will
  compensate by pushing emissive absurdly high.
- Tone mapping + output colour space conversion happen once, at the end of the
  chain (or in `OutputPass` on the classic path). `RenderPipeline` does this for
  you: while `renderPipeline.render()` runs it forces the renderer to
  `NoToneMapping` and the working colour space, then applies `renderOutput()`
  around your `outputNode`. The renderer's own tone mapping therefore cannot
  double-apply — coordinate settings with `threejs-scene-architect`.
- **The one case you must handle yourself:** effects that need *display*-space
  input rather than linear — FXAA, most LUT grades, sobel, chromatic
  aberration. Set `renderPipeline.outputColorTransform = false` and place the
  conversion yourself with `renderOutput( scenePass )` (or `node.renderOutput()`)
  at the point in the chain where it belongs.

Symptoms: applied twice → milky, low contrast, crushed highlights. Applied zero
times → dark and over-saturated. Both are pipeline bugs, not artistic ones.

## A sane default chain

```
render pass (HDR, MRT: colour + normal + depth + velocity if needed)
  → ambient occlusion (GTAO)
  → screen-space reflections / SSGI          [optional, expensive]
  → depth of field                            [optional]
  → motion blur                               [optional]
  → bloom
  → colour grading / LUT
  → temporal AA or upscaling (TRAA / TAAU / FSR1)
  → SMAA or FXAA if not using a temporal solution
  → tone mapping + output conversion
```

Notes on the order: AO belongs before anything that reads colour, because it
modifies lighting. Bloom belongs after AO/GI (it should bloom the final lit
image) but before grading. Anti-aliasing goes last among the image operations,
and tone mapping last of all. FXAA is the exception that must sit *after* the
output conversion — see the rule above.

## Effect nodes: name → export → import path

Effect nodes are **not** in `three/tsl`. Every one lives in its own addon module
under `three/addons/tsl/display/`. Import the named export, not a default.

| Effect | Export | Module under `three/addons/tsl/display/` |
|---|---|---|
| Bloom | `bloom` | `BloomNode.js` |
| Ambient occlusion (GTAO) | `ao` | `GTAONode.js` |
| Screen-space GI | `ssgi` | `SSGINode.js` |
| Screen-space reflections | `ssr` | `SSRNode.js` |
| Depth of field | `dof` | `DepthOfFieldNode.js` |
| Motion blur | `motionBlur` | `MotionBlur.js` |
| Godrays | `godrays` | `GodraysNode.js` |
| Outline | `outline` | `OutlineNode.js` |
| Lens flare | `lensflare` | `LensflareNode.js` |
| Subsurface scattering | `sss` | `SSSNode.js` |
| Denoise | `denoise` | `DenoiseNode.js` |
| Recurrent denoise | `recurrentDenoise` | `RecurrentDenoiseNode.js` |
| Temporal AA | `traa` | `TRAANode.js` |
| SMAA | `smaa` | `SMAANode.js` |
| FXAA | `fxaa` | `FXAANode.js` |
| SSAA (own pass) | `ssaaPass` | `SSAAPassNode.js` |
| Temporal upscale | `taau` | `TAAUNode.js` |
| FSR1 upscale | `fsr1` | `FSR1Node.js` |
| Sharpen | `sharpen` | `SharpenNode.js` |
| 3D LUT grade | `lut3D` | `Lut3DNode.js` |
| Chromatic aberration | `chromaticAberration` | `ChromaticAberrationNode.js` |
| After-image | `afterImage` | `AfterImageNode.js` |
| Transition | `transition` | `TransitionNode.js` |
| Pixelation (own pass) | `pixelationPass` | `PixelationPassNode.js` |
| Retro (own pass) | `retroPass` | `RetroPassNode.js` |
| Sobel edge | `sobel` | `SobelOperatorNode.js` |
| Film grain | `film` | `FilmNode.js` |
| Gaussian blur | `gaussianBlur`, `premultipliedGaussianBlur` | `GaussianBlurNode.js` |
| Bilateral blur | `bilateralBlur` | `BilateralBlurNode.js` |
| Temporal reprojection | `temporalReproject` | `TemporalReprojectNode.js` |

Also present, same directory: `dotScreen` (`DotScreenNode.js`), `rgbShift`
(`RGBShiftNode.js`), `sepia` (`Sepia.js`), `bleach` (`BleachBypass.js`),
`boxBlur`, `hashBlur`, `radialBlur`, `depthAwareBlend`, `circle` (`Shape.js`),
the CRT set (`barrelMask`, `barrelUV`, `colorBleeding`, `scanlines`, `vignette`
from `CRT.js`), and the stereo passes (`anaglyphPass`, `stereoPass`,
`parallaxBarrierPass`).

`pass`, `depthPass`, `mrt` and `renderOutput` *are* in `three/tsl` — those are
core, not addons. Do not import them from a display module.

## Effect-by-effect notes

- **Bloom** — `bloom( node, strength, radius, threshold )`. The effect most
  often overdone. Prefer *selective* bloom (emissive-driven, via an MRT
  `emissive` buffer or a per-material `material.mrtNode`) over a global
  threshold: a global threshold blooms white walls. Real bloom is subtle; if a
  viewer notices the bloom, it is too strong.
- **Ambient occlusion (GTAO)** — the export is `ao`, **not** `gtao`:
  `ao( depthNode, normalNode, camera )`. It needs the depth and normal buffers
  and affects *indirect* light only. Feed it into the scene pass with
  `scenePass.contextNode = builtinAOContext( aoPass.getTextureNode().sample( screenUV ).r )`
  rather than multiplying it over the final image. `aoPass.resolutionScale = 0.5`
  is usually enough. Watch for haloes around thin geometry and for radius in
  world units being wrong for your scene scale.
- **SSGI / SSR** — `ssgi( beauty, depth, normal, camera )` and
  `ssr( color, depth, normal, options )`. Screen-space, so anything off-screen
  or behind something cannot contribute. Expect edge artefacts and plan a
  fallback (the environment map) for what screen space cannot see. Both need
  denoising (`denoise` / `recurrentDenoise`), and denoising needs temporal
  stability.
- **Depth of field** — `dof( node, viewZNode, focusDistance, focalLength, bokehScale )`.
  Note the second argument is **view Z**, from `scenePass.getViewZNode()`, not
  the raw depth texture. Cheap to look bad: focus distance should be driven by
  something in the game (the character, a raycast at screen centre), not a
  constant. Watch bokeh cost at high blur radii.
- **Motion blur** — `motionBlur( inputNode, velocityNode, numSamples )` needs a
  `velocity` MRT buffer, which needs the previous frame's matrices; skinned and
  instanced geometry needs the `velocity` node path to be wired. Very effective
  for a sense of speed, easy to make nauseating.
- **Outline** — either `outline( scene, camera, params )` (precise, one pass,
  composited with `.add()`) or an inverted-hull mesh (no pass, cheaper, less
  precise). For a stylised game, test both; the hull often reads better.
- **Anti-aliasing** — MSAA is not available with most deferred/post setups.
  Options: **`smaa`** (good quality, one pass, no temporal artefacts),
  **`fxaa`** (cheapest, blurs text and thin lines, and must run *after* the
  output conversion), **`traa`** (best quality, needs depth + velocity +
  camera, introduces ghosting on fast motion), **`ssaaPass`** (brute force,
  only for screenshots).
- **Upscaling (`taau`, `fsr1`)** — call `scenePass.setResolutionScale( 0.5 )`
  and upscale. (`setResolution()` is deprecated since r181.) This is the single
  most effective mobile performance lever and it is nearly invisible. Build it
  in early rather than bolting it on. `taau` needs the same depth + velocity +
  camera as `traa`; `fsr1( node, sharpness, denoise )` needs only colour.
- **Colour grading / LUT** — `lut3D( node, lut, size, intensity )` is the
  cheapest way to give a game a consistent identity. Author it once from a
  reference frame. It expects display-space input, so set
  `outputColorTransform = false` and place `renderOutput()` before it.

## Render targets and MRT

- Half-float is the default for `pass()` targets. Full float is rarely needed
  and costs bandwidth; override only deliberately via
  `pass( scene, camera, { type: THREE.FloatType } )`. The same options object
  reaches the `RenderTarget` constructor, so `{ depthBuffer: false }` drops the
  depth texture when nothing reads it.
- MRT lets one geometry pass output colour, normal, depth and velocity together
  — far cheaper than re-rendering the scene per buffer. Anything that needs
  normals or velocity should read from MRT:

  ```
  scenePass.setMRT( mrt( { output, normal: packNormalToRGB( normalView ), velocity } ) );
  const normalNode = scenePass.getTextureNode( 'normal' );
  ```

  A single material can override the pass-wide MRT with `material.mrtNode = mrt({...})`
  — that is how selective bloom marks which objects glow.
- Reading buffers back out: `getTextureNode( name )` (defaults to `'output'`),
  `getPreviousTextureNode( name )` for the previous frame, `getLinearDepthNode()`
  for normalised depth, `getViewZNode()` for view-space Z, and `getTexture( name )`
  for the raw `Texture` when you need to change its `type` (setting a normal
  buffer to `UnsignedByteType` is a common bandwidth win).
- On the node path, passes track the renderer size themselves — `PassNode`
  re-runs `setSize()` from the renderer dimensions each frame, so there is no
  manual resize call. On the **classic** path you must call
  `composer.setSize( width, height )` in your resize handler; a stale target is
  the cause of effects that look correct until the window is resized.
- Count your targets. Each full-screen half-float RGBA target at 1080p is
  ~16 MB; a chain with eight of them is a real memory cost, and on mobile it is
  a bandwidth cost that shows up as thermal throttling.

## Cost control

- Post-processing cost is dominated by **bandwidth**, not maths. Fewer,
  bigger passes beat many small ones.
- Run expensive effects at half resolution and upsample — `aoPass.resolutionScale = 0.5`
  on an effect node, `scenePass.setResolutionScale( 0.5 )` on the scene pass. AO,
  bloom and SSR are all fine at half res; DoF and outlines are not.
- Build **quality tiers** from the start: `off / low / high`, where `low` drops
  SSR, SSGI, DoF and motion blur and switches `traa` for `smaa`. Do not invent
  tiers under deadline pressure.
- Every tier switch reassigns `renderPipeline.outputNode`, so it must be
  followed by `renderPipeline.needsUpdate = true` — otherwise the compiled
  full-screen material keeps the old chain and nothing appears to change.
- Measure with GPU timestamps rather than guessing which pass is expensive —
  coordinate with `threejs-performance-optimizer`.

## Debugging a chain

Do not debug by temporarily assigning a buffer to `outputNode` and squinting.
r185 ships an inspector addon, and it is the right answer:

- `renderer.inspector = new Inspector()` from
  `three/addons/inspector/Inspector.js`, before building the chain. 160 of the
  r185 examples do this.
- `someNode.toInspector( 'Label' )` tags any intermediate node so it appears as
  a live thumbnail. It is chainable and returns the node, so it drops into an
  existing expression without restructuring:
  `const scenePass = pass( scene, camera ).toInspector( 'Color' );`
- The optional second argument remaps the value for display only — useful for
  buffers that are not viewable as-is:
  `scenePass.getTextureNode( 'depth' ).toInspector( 'Depth', () => scenePass.getLinearDepthNode() )`
  or `aoPass.toInspector( 'GTAO', ( node ) => node.r )`.
- `renderer.inspector.createParameters( 'Settings' )` gives you a GUI panel in
  the same window, which is where the examples put their effect sliders.
- `toInspector()` is WebGPU-only; on WebGL it warns once and is a no-op.

## Common failure modes

| Symptom | Cause |
|---|---|
| Image milky, low contrast | tone mapping applied twice — usually `outputColorTransform` left `true` alongside a manual `renderOutput()` |
| Image dark and over-saturated | `outputColorTransform = false` and `renderOutput()` never added back |
| Nothing blooms | tone mapping before bloom, or LDR render target |
| Everything blooms | global threshold instead of selective/emissive |
| Ghosting trails behind moving objects | `traa`/`taau` without correct velocity vectors |
| Nothing on screen at all | `renderer.render()` called in the loop instead of `renderPipeline.render()` |
| Chain switch has no visible effect | `renderPipeline.needsUpdate = true` not set after reassigning `outputNode` |
| Console warns about a rename | `THREE.PostProcessing` — deprecated r183, use `THREE.RenderPipeline` |
| Effects break after resize | classic path only — `composer.setSize()` not called |
| Reflections vanish at screen edges | inherent to screen space — needs env fallback |
| Noise that never resolves | denoiser missing, or temporal accumulation reset each frame |
| Post chain does nothing | `EffectComposer` used on `WebGPURenderer` |
| Halo around characters | AO radius wrong for scene scale |
| Mobile overheats after 2 minutes | too many full-res HDR targets — bandwidth |

## Verified r185 idioms

```js
import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, velocity } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { Inspector } from 'three/addons/inspector/Inspector.js';

const renderer = new THREE.WebGPURenderer( { antialias: true } );
await renderer.init();
renderer.inspector = new Inspector();

const renderPipeline = new THREE.RenderPipeline( renderer );

// one geometry pass, several buffers
const scenePass = pass( scene, camera ).toInspector( 'Color' );
scenePass.setResolutionScale( 1.0 );              // < 1 to render small and upscale
scenePass.setMRT( mrt( {
    output: output,
    emissive: emissive,
    velocity: velocity
} ) );

const scenePassColor    = scenePass.getTextureNode();             // 'output' is the default
const scenePassEmissive = scenePass.getTextureNode( 'emissive' );
const scenePassVelocity = scenePass.getTextureNode( 'velocity' );
const scenePassDepth    = scenePass.getTextureNode( 'depth' )
    .toInspector( 'Depth', () => scenePass.getLinearDepthNode() );

// compose: emissive-only bloom, then temporal AA over the composite
const bloomPass = bloom( scenePassEmissive, 2.5, 0.5 );           // node, strength, radius, threshold
const composite = scenePassColor.add( bloomPass );

renderPipeline.outputNode = traa( composite, scenePassDepth, scenePassVelocity, camera );

renderer.setAnimationLoop( () => {

    controls.update();
    renderPipeline.render();      // not renderer.render(), not renderPipeline.renderAsync()

} );

// swapping the chain at runtime
renderPipeline.outputNode = someOtherNode;
renderPipeline.needsUpdate = true;   // required whenever outputNode changes
```

Corrections vs. older tutorials:

- `new THREE.PostProcessing( renderer )` → `new THREE.RenderPipeline( renderer )`;
  `PostProcessing` is a deprecated shim since r183.
- `postProcessing.renderAsync()` → `renderPipeline.render()`; `renderAsync()` is
  deprecated since r181 and appears in zero r185 examples.
- Effect nodes were never in `three/tsl` — each comes from its own
  `three/addons/tsl/display/*Node.js` module.
- The GTAO export is `ao`, not `gtao`.
- `pass.setResolution()` → `pass.setResolutionScale()` (deprecated r181).
- Debugging by dumping buffers to the screen → `renderer.inspector = new Inspector()`
  plus `node.toInspector( 'Label' )`.

## Reference examples

WebGPU / node path first — these are the ones to read.

| Example | What it shows |
|---|---|
| `webgpu_postprocessing_ao` | the full reference chain: pre-pass MRT, `ao`, `builtinAOContext`, `traa`, inspector taps |
| `webgpu_postprocessing_bloom` | smallest complete `RenderPipeline` — pass, one effect, `render()` |
| `webgpu_postprocessing_bloom_selective` | per-material `mrtNode`, `outputColorTransform = false`, `.renderOutput()` |
| `webgpu_postprocessing_bloom_emissive` | `emissive` MRT buffer driving bloom |
| `webgpu_mrt` | MRT buffer layout and reading each buffer back by name |
| `webgpu_postprocessing_ssr` | MRT with metalness/roughness, `ssr` options, `smaa` on top |
| `webgpu_postprocessing_ssgi` | `ssgi` + `traa`, and per-output debug switching |
| `webgpu_postprocessing_dof` | `getViewZNode()` feeding `dof` |
| `webgpu_postprocessing_motion_blur` | `velocity` MRT into `motionBlur` |
| `webgpu_postprocessing_fxaa` | why FXAA needs `outputColorTransform = false` + `renderOutput()` |
| `webgpu_postprocessing_traa` | minimal temporal setup: velocity MRT into `traa`, no other effects |
| `webgpu_upscaling_taau` | `setResolutionScale()` + `taau` + `sharpen` — the mobile lever |
| `webgpu_upscaling_fsr1` | `fsr1`, colour-only upscale with no velocity |

WebGL / classic path, for legacy or fallback chains:

| Example | What it shows |
|---|---|
| `webgl_postprocessing_unreal_bloom_selective` | selective bloom via layers on the composer |
| `webgl_postprocessing_gtao` | `EffectComposer` + `RenderPass` + `GTAOPass` + `OutputPass` ordering |
| `webgl_postprocessing_taa` | temporal accumulation on the classic path |
| `webgl_postprocessing_3dlut` | `LUTPass` placement relative to `OutputPass` |
| `webgl_postprocessing_advanced` | multi-composer / render-to-texture compositing |

## Handoffs

Tone mapping ownership and renderer setup → `threejs-scene-architect`. Emissive
values that feed bloom → `threejs-material-lookdev`. Custom effect nodes →
`threejs-tsl-shader-engineer`. Velocity from skinned meshes →
`threejs-animation-rigging`. Quality tiers and measurement →
`threejs-performance-optimizer`.
