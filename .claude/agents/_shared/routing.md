# Routing — who handles what

Use this when you are unsure which specialist owns a request. If a request
touches three or more rows, send it to `threejs-tech-lead` instead.

## By symptom

| The user says… | Start with |
|---|---|
| "nothing renders" / "black screen" | `threejs-scene-architect` |
| "the colours look wrong / washed out / too dark" | `threejs-scene-architect`, then `threejs-texture-pipeline` |
| "it looks flat / plastic / cheap" | `threejs-lighting-shadows` (environment first) |
| "the material doesn't look right" | `threejs-material-lookdev` |
| "the texture is blurry / shimmering / seamed" | `threejs-texture-pipeline` |
| "the shadows look bad / are missing" | `threejs-lighting-shadows` |
| "I want a custom effect on this surface" | `threejs-tsl-shader-engineer` |
| "the model imported wrong / huge / sideways" | `threejs-asset-pipeline` |
| "the mesh looks faceted / inside-out / has seams" | `threejs-geometry-engineer` |
| "the animation doesn't play / T-poses" | `threejs-animation-rigging` |
| "the feet slide" / "it snaps between animations" | `threejs-animation-rigging` |
| "movement feels floaty / stiff / unresponsive" | `threejs-character-controller` |
| "the camera clips through walls" | `threejs-character-controller` |
| "clicking selects the wrong thing" | `threejs-camera-interaction` |
| "I need labels / a HUD" | `threejs-camera-interaction` |
| "it falls through the floor / jitters / tunnels" | `threejs-physics-collision` |
| "I want bloom / AO / DoF / outlines" | `threejs-postfx-compositor` |
| "the image is milky / ghosting / noisy" | `threejs-postfx-compositor` |
| "I want particles / smoke / fire / water / sky" | `threejs-vfx-audio` |
| "there's no sound" / "sound has no space" | `threejs-vfx-audio` |
| "it's slow / stutters / overheats on mobile" | `threejs-performance-optimizer` |
| "memory keeps growing" | `threejs-performance-optimizer` |
| "I don't know why this doesn't look like my reference" | `threejs-tech-lead` |
| "this worked in a tutorial but not here" | check the rename table in `conventions.md` §0 |

## By three.js symbol

| If the request mentions… | Owner |
|---|---|
| `WebGPURenderer` `WebGLRenderer` `Scene` `Object3D` `Timer` `Layers` `Fog` | `threejs-scene-architect` |
| `BufferGeometry` `BufferAttribute` `*Geometry` `Curve` `Path` `Shape` `LOD` mesh | `threejs-geometry-engineer` |
| `Mesh*Material` `*NodeMaterial` `clearcoat` `sheen` `transmission` `alphaTest` | `threejs-material-lookdev` |
| `Texture` `KTX2Loader` `colorSpace` `anisotropy` `mipmap` `DataTexture` | `threejs-texture-pipeline` |
| `*Light` `*LightShadow` `PMREMGenerator` `LightProbe` `CSM` `RoomEnvironment` | `threejs-lighting-shadows` |
| TSL functions · `Fn` `uniform` `attribute` `storage` `compute` `ShaderMaterial` | `threejs-tsl-shader-engineer` |
| `AnimationMixer` `AnimationClip` `SkinnedMesh` `Skeleton` `morphTarget` `CCDIK` | `threejs-animation-rigging` |
| input · state machine · follow camera · jump · locomotion | `threejs-character-controller` |
| `GLTFLoader` `DRACOLoader` `LoadingManager` `*Exporter` `gltf-transform` | `threejs-asset-pipeline` |
| `RenderPipeline` `EffectComposer` `*Pass` `bloom` `mrt` `pass()` `TRAA` | `threejs-postfx-compositor` |
| `InstancedMesh` `BatchedMesh` `renderer.info` `compileAsync` render bundles | `threejs-performance-optimizer` |
| `PerspectiveCamera` `Raycaster` `*Controls` `CSS2DRenderer` `project/unproject` | `threejs-camera-interaction` |
| `RapierPhysics` `Octree` `Capsule` `OBB` collider · trigger · joint | `threejs-physics-collision` |
| `Points` `Sprite` `Water` `Sky` `Lensflare` `PositionalAudio` `AudioListener` | `threejs-vfx-audio` |

## Standard chains

| Job | Sequence |
|---|---|
| New look for a character | asset-pipeline → lighting-shadows → material-lookdev → texture-pipeline → tsl-shader-engineer → animation-rigging |
| New level environment | asset-pipeline → geometry-engineer → lighting-shadows → vfx-audio → postfx-compositor → performance-optimizer |
| New gameplay ability | character-controller → physics-collision → animation-rigging → vfx-audio |
| Frame rate rescue | performance-optimizer (measures, then delegates the fix) |
| Mobile port | performance-optimizer → texture-pipeline → postfx-compositor → scene-architect |
| Bring up a fresh scene | scene-architect → lighting-shadows → asset-pipeline → camera-interaction |

---

## Beagle Chomp's own agents come first on their turf

This project had six agents before the three.js pack landed. They own the
**game**; the `threejs-*` specialists own **three.js technique**. When both
could take a request, the project agent owns the file and pulls the specialist
in for the technique.

| Area | Owner | Pull in |
|---|---|---|
| `src/game/*`, `src/input/*` — movement, ghost AI, state machine, scoring | `gameplay-engineer` | `threejs-character-controller` only for *feel*, never for the tile model |
| `src/render/*` — scene, board, characters, effects, toon ramp | `render-artist` | `threejs-material-lookdev`, `-lighting-shadows`, `-geometry-engineer`, `-vfx-audio` |
| `src/game/mazes.json` and maze fairness | `level-designer` | — |
| Headless tests, regression sims, playtest checklists | `qa-test-engineer` | — |
| PWA, manifest, service worker, touch, responsive canvas | `pwa-mobile-engineer` | `threejs-performance-optimizer` for the mobile frame budget |
| Module boundaries, cross-layer changes, docs | `game-architect` | `threejs-tech-lead` for a multi-domain three.js diagnosis |

**Rows that do not apply to this project** (see `conventions.md` §−1): anything
routed on `RenderPipeline`, `EffectComposer`, TSL/`Fn`/`storage`/`compute`,
`GLTFLoader`/`DRACOLoader`/`KTX2Loader`, or a physics engine. The game has no
post-processing, no node materials, no loaded assets and no physics world.
Reaching for one of those is a proposal to change the stack — say so out loud
and let the user decide.
