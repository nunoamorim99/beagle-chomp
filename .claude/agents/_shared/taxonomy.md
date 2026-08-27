# three.js concept map (r185 / three@0.185.x)

A complete inventory of what exists in the three.js world, taken from the
official documentation index and examples index, grouped into the 14 domains
this agent roster owns. Use it to decide *who* should handle a piece of work
and to check that nothing in a task has been left unowned.

Legend: `core` = ships in `three`, `addon` = `three/examples/jsm/*`,
`tsl` = `three/tsl`, `webgpu` = `three/webgpu`.

---

## 1. Scene, renderer and core runtime → `threejs-scene-architect`

**core** Scene · Object3D · Group · Layers · Fog · FogExp2 · Clock · Timer ·
EventDispatcher · Uniform · UniformsGroup · RenderTarget · RenderTarget3D
**renderers** WebGLRenderer · WebGPURenderer · Renderer · Backend · CanvasTarget ·
Info · RenderPipeline · BundleGroup · QuadMesh · TimestampQueryPool ·
WebGLRenderTarget · WebGLCubeRenderTarget · WebGL3DRenderTarget ·
WebGLArrayRenderTarget · CubeRenderTarget · InspectorBase · StandardNodeLibrary
**xr** XRManager · WebXRManager · WebXRDepthSensing (addon: VRButton, ARButton,
XRButton, XRPlanes, hand models)
**constants** colour spaces · tone mapping modes · blending · depth/stencil
funcs · texture formats and types · coordinate systems
**addon** SceneUtils · SceneOptimizer · WorkerPool · Inspector/Tab

## 2. Geometry → `threejs-geometry-engineer`

**core** BufferGeometry · InstancedBufferGeometry · BufferAttribute (+ all typed
variants) · InterleavedBuffer(Attribute) · GLBufferAttribute · InstancedBufferAttribute
**primitives** Box · Capsule · Circle · Cone · Cylinder · Dodecahedron · Edges ·
Extrude · Icosahedron · Lathe · Octahedron · Plane · Polyhedron · Ring · Shape ·
Sphere · Tetrahedron · Torus · TorusKnot · Tube · Wireframe
**curves/paths** Curve · CurvePath · Path · Shape · ShapePath · Arc · CatmullRom3 ·
CubicBezier(3) · QuadraticBezier(3) · Ellipse · Line(3) · Spline · Interpolations ·
Earcut · ShapeUtils
**math** Vector2/3/4 · Matrix2/3/4 · Quaternion · Euler · Box2/3 · Sphere · Plane ·
Ray · Triangle · Line3 · Frustum(Array) · Spherical · Cylindrical ·
SphericalHarmonics3 · MathUtils · Interpolants
**addon** BufferGeometryUtils · GeometryUtils · GeometryCompressionUtils ·
ConvexGeometry · DecalGeometry · LoftGeometry · ParametricGeometry ·
RoundedBoxGeometry · TeapotGeometry · TextGeometry · BoxLineGeometry ·
NURBSCurve/Surface/Volume · exotic knot curves · SimplifyModifier ·
TessellateModifier · EdgeSplitModifier · Flow/InstancedFlow (curve modifier) ·
MarchingCubes · ConvexHull · Octree · OBB · Capsule · MeshSurfaceSampler ·
ImprovedNoise · SimplexNoise · Lut
**generators (addon)** TerrainGenerator · CityGenerator · SkyscraperGenerator ·
ForestGenerator · TreeGenerator · SidewalkGenerator · FaceFrame

## 3. Materials and look-dev → `threejs-material-lookdev`

**core** Material · MeshBasic/Lambert/Phong/Toon/Standard/Physical/Matcap/
Normal/Depth/Distance · PointsMaterial · SpriteMaterial · LineBasic/LineDashed ·
ShadowMaterial · ShaderMaterial · RawShaderMaterial
**webgpu** NodeMaterial + MeshBasic/Lambert/Phong/Toon/Standard/Physical/Normal/
Matcap/SSS/Volume/Sprite/Points/Line/LineDashed/Line2/Shadow NodeMaterial ·
NodeMaterialObserver · lighting models (Basic/Phong/Physical/Toon/SSS/
Volumetric/ShadowMask)
**addon** LDrawConditionalLineMaterial · WoodNodeMaterial · LineMaterial (fat
lines) · MaterialXLoader
**concepts** alpha modes · alphaHash · blending · clearcoat · sheen ·
transmission · iridescence · anisotropy · dispersion · attenuation · matcap ·
toon ramps · vertex colours · flat shading · polygon offset · stencil

## 4. Textures → `threejs-texture-pipeline`

**core** Texture · Source · CanvasTexture · VideoTexture · VideoFrameTexture ·
HTMLTexture · ExternalTexture · FramebufferTexture · DataTexture ·
Data3DTexture · DataArrayTexture · DepthTexture · CubeDepthTexture ·
CubeTexture · CompressedTexture(+Array/Cube) · StorageTexture(+3D/Array)
**loaders** TextureLoader · CubeTextureLoader · DataTextureLoader ·
CompressedTextureLoader · ImageBitmapLoader · KTX2Loader · KTXLoader ·
DDSLoader · PVRTCLoader · TGALoader · TIFFLoader · EXRLoader · HDRLoader ·
UltraHDRLoader · LottieLoader · LUT3dl/Cube/Image loaders
**addon** TextureUtils · WebGLTextureUtils · WebGPUTextureUtils · FlakesTexture ·
TextureHelper · KTX2Exporter · EXRExporter
**concepts** colour space tagging · wrapping · filters · anisotropy · mipmaps
(auto/manual) · partial update · texture arrays · triplanar mapping · UV sets ·
atlasing · compressed format matrix (ASTC/ETC2/BC/PVRTC) · texture memory

## 5. Lighting, shadows and IBL → `threejs-lighting-shadows`

**core** Light · AmbientLight · DirectionalLight · HemisphereLight · PointLight ·
SpotLight · IESSpotLight · RectAreaLight · ProjectorLight · LightProbe ·
LightShadow · DirectionalLightShadow · PointLightShadow · SpotLightShadow ·
PMREMGenerator
**webgpu/tsl** LightsNode · AnalyticLightNode · per-light data nodes ·
ClusteredLighting · DynamicLighting · LightProbeGrid · ShadowNode ·
ShadowBaseNode · TileShadowNode · PointShadowNode · CSMShadowNode
**addon** RoomEnvironment · DebugEnvironment · ColorEnvironment ·
LightProbeGenerator · LightProbeGridHelper · RectAreaLightUniformsLib ·
RectAreaLightTexturesLib · CSM/CSMFrustum/CSMHelper · ProgressiveLightMap ·
IESLoader · Sky/SkyMesh
**concepts** physical light units · decay · shadow map types and filters ·
shadow bias/normalBias/radius · shadow camera fitting · cascaded shadows ·
contact shadows · light baking · environment intensity/rotation/blurriness

## 6. Shading (TSL, nodes, compute) → `threejs-tsl-shader-engineer`

**tsl** 638 exports from `three/tsl` at r185: math, trig, bit ops, swizzles,
control flow (`If`, `Switch`, `Loop`, `Continue`, `Return`, `Discard` — note
`.Else()`/`.ElseIf()` are chained methods, not exports), `Fn`, `uniform`, `attribute`,
`varying`, `property`, `struct`, `storage`, `texture*`, `positionLocal/World/View`,
`normal*`, `tangent*`, `bitangent*`, `uv`, `screenUV`, `viewport*`, `camera*`,
`model*`, `object*`, `time`, `deltaTime`, `oscSine/Square/Saw/Triangle`, noise
(`snoise`, `curlNoise`, `triNoise3D`, `hash`, `mx_*`), blend modes, colour space
conversions, tone mapping ops, `mrt`, `pass`, `rtt`, `instancedArray`,
`workgroupArray`, subgroup ops, atomics, barriers
**node graph core** Node · NodeBuilder · NodeFrame · NodeCache · TempNode ·
ContextNode · StackNode · VarNode · VaryingNode · AttributeNode · UniformNode ·
FunctionNode · OperatorNode · MathNode · ConditionalNode · LoopNode ·
ComputeNode · StorageBufferNode · OutputStructNode · MRTNode · SubBuildNode
**interop** GLSLNodeParser/Builder/Function · WGSLNodeParser/Builder/Function ·
`wgsl()` · `glsl()` · Transpiler (GLSL→TSL) · `three/addons/transpiler`
**classic path** ShaderMaterial · RawShaderMaterial · `onBeforeCompile` ·
ShaderChunk/ShaderLib includes · GPUComputationRenderer (WebGL GPGPU)
**addon** BitonicSort · shadertoy example · TSL editor/graph examples

> The post-processing effect nodes (`bloom`, `ao`, `ssr`, `dof`, `traa`, `taau`,
> `smaa`, `fxaa`, `fsr1`, `outline`, …) are **not** in `three/tsl` — they are in
> `three/addons/tsl/display/*Node.js`. `pass()` and `mrt()` are in `three/tsl`.

## 7. Animation and rigging → `threejs-animation-rigging`

**core** AnimationMixer · AnimationAction · AnimationClip · AnimationUtils ·
AnimationObjectGroup · KeyframeTrack (Boolean/Color/Number/Quaternion/String/
Vector) · PropertyBinding · PropertyMixer · interpolation modes · blend modes ·
loop modes · Skeleton · Bone · SkinnedMesh · morph targets/influences
**addon** SkeletonUtils (clone, retarget, retargetClip) · CCDIKSolver ·
CCDIKHelper · AnimationClipCreator · AnimationPathHelper · SkeletonHelper ·
MorphAnimMesh · MorphBlendMesh · MD2Character(Complex) · BVHLoader · MDDLoader
**tsl** `skinning` · `computeSkinning` · `morphReference` · `getSkinnedPosition` ·
`getSkinnedNormalAndTangent` · velocity/previous-frame nodes for motion vectors
**concepts** cross-fade · additive blending · time scale/warping · sub-clips ·
root motion · retargeting between rigs · attachment points · animated GLTF quirks

## 8. Character control and gameplay → `threejs-character-controller`

Not a documentation domain — the layer that binds input, animation, physics and
camera into something that feels good. Draws on Object3D transforms, Raycaster,
Quaternion slerp, `MathUtils.damp`, animation actions, physics character
controllers, and the `games / fps` and `misc / controls / *` examples.

## 9. Asset pipeline → `threejs-asset-pipeline`

**core** Loader · LoadingManager · Cache · FileLoader · ObjectLoader ·
MaterialLoader · BufferGeometryLoader · AnimationLoader · ImageLoader ·
NodeLoader · NodeMaterialLoader · NodeObjectLoader · LoaderUtils
**model loaders (addon)** GLTFLoader · DRACOLoader · KTX2Loader · FBXLoader ·
ColladaLoader · OBJLoader + MTLLoader · USDLoader/USDComposer · Rhino3dmLoader ·
LDrawLoader · PLY · STL · 3DS · 3MF · AMF · VOX · VRML · VTK · PCD · PDB · XYZ ·
GCode · LWO · MD2 · NRRD · SVGLoader · TTFLoader · FontLoader/Font
**exporters (addon)** GLTFExporter · USDZExporter · DRACOExporter · OBJ · PLY ·
STL · EXR · KTX2
**concepts** glTF extensions (KHR_materials_*, KHR_draco_*, KHR_texture_basisu,
EXT_meshopt_compression, KHR_materials_variants, EXT_mesh_gpu_instancing) ·
progressive/LOD loading · gltf-transform CLI · asset budgets · licensing

## 10. Post-processing → `threejs-postfx-compositor`

**webgpu/tsl** RenderPipeline (renamed from PostProcessing in r183) · `pass()` · PassNode · PassTextureNode · MRTNode ·
bloom · ao/GTAO · SSGI · SSR · SSS · DoF · motion blur · godrays · outline ·
denoise (bilateral, recurrent, Poisson) · TRAA · TAAU · FSR1 · SMAA · FXAA ·
SSAA · pixelation · retro · halftone · dot-screen · sobel · film ·
chromatic aberration · anamorphic · lensflare · LUT3D · transition · anaglyph ·
stereo · parallax barrier · sharpen · afterimage
**webgl addon** EffectComposer · Pass · RenderPass · ShaderPass · OutputPass ·
UnrealBloomPass · BloomPass · SSAOPass · SAOPass · GTAOPass · SSRPass · TAA/SSAA ·
SMAAPass · FXAAPass · BokehPass · OutlinePass · FilmPass · GlitchPass ·
HalftonePass · LUTPass · MaskPass · AfterimagePass · RenderPixelatedPass ·
RenderTransitionPass · plus the whole `shaders/` library
**concepts** pass ordering · linear vs output space · render target formats ·
resolution scaling · selective effects via layers/MRT · temporal stability

## 11. Performance → `threejs-performance-optimizer`

**core** InstancedMesh · BatchedMesh · LOD · Object3D.frustumCulled ·
`renderer.info` · `renderer.compileAsync` · BundleGroup/render bundles ·
TimestampQueryPool · Timer
**addon** SortUtils · SceneOptimizer · BufferGeometryUtils.mergeGeometries ·
GeometryCompressionUtils · SimplifyModifier · WorkerPool · OffscreenCanvas ·
three-mesh-bvh (external) for raycast/culling
**concepts** draw calls vs triangles · state changes and material sharing ·
overdraw and transparency sorting · texture memory and mip budgets · shader
compilation stalls · GC pressure · fixed vs variable timestep · dynamic
resolution · mobile thermal budgets · WebGL vs WebGPU cost differences

## 12. Cameras, controls and interaction → `threejs-camera-interaction`

**core** Camera · PerspectiveCamera · OrthographicCamera · ArrayCamera ·
CubeCamera · StereoCamera · Raycaster · Layers
**addon controls** OrbitControls · MapControls · TrackballControls ·
ArcballControls · FirstPersonControls · FlyControls · PointerLockControls ·
DragControls · TransformControls
**addon** CameraUtils · ViewHelper · SelectionBox/SelectionHelper ·
InteractionManager · InteractiveGroup · HTMLMesh · CSS2DRenderer/Object ·
CSS3DRenderer/Object/Sprite · SVGRenderer · Projector
**concepts** projection and unprojection · screen↔world · GPU picking ·
raycast cost and BVH · pointer capture · resize and DPR · multiple viewports ·
letterboxing · camera shake/damping

## 13. Physics and collision → `threejs-physics-collision`

**addon** RapierPhysics · RapierHelper · JoltPhysics · AmmoPhysics ·
ConvexObjectBreaker · Octree · Capsule · OBB · ConvexHull · MeshSurfaceSampler
**examples** `games / fps` (octree character) · `physics / rapier / character /
controller` · `rapier / vehicle / controller` · `rapier / joints` ·
`rapier / terrain` · ammo break/cloth/rope/terrain/volume · jolt instancing
**concepts** collider generation from meshes · kinematic character controllers ·
fixed timestep + render interpolation · continuous collision · triggers and
sensors · joints · vehicles · heightfields · debug rendering

## 14. VFX, environment and audio → `threejs-vfx-audio`

**core** Points · Sprite · Line/LineSegments/LineLoop · Audio · PositionalAudio ·
AudioListener · AudioAnalyser · AudioContext · AudioLoader
**addon** Water · WaterMesh · Sky · SkyMesh · GroundedSkybox · Lensflare(Mesh) ·
Reflector · Refractor · ShadowMesh · MarchingCubes · TubePainter · Volume ·
VolumeSlice · GPUComputationRenderer · RollerCoaster geometries · Trees/Sky
geometries · PositionalAudioHelper
**tsl/webgpu** compute particles (fluid, rain, snow, attractors) · volumetric
lighting/fog · caustics · `tsl / vfx / flames` · `tsl / vfx / tornado` ·
`tsl / vfx / linkedparticles` · `tsl / raging / sea` · `tsl / galaxy` ·
custom fog and scattering nodes
**concepts** billboarding · soft particles · additive vs alpha VFX · GPU
simulation state in textures/storage buffers · audio spatialisation and
occlusion · music/SFX bus structure

---

## Deliberately not given a dedicated agent

| Area | Why | Who covers it |
|---|---|---|
| WebXR / VR / AR | not on the roadmap (web → mobile) | `threejs-scene-architect` |
| CSS2D/CSS3D/SVG renderers | UI overlay only, small surface | `threejs-camera-interaction` |
| Exporters (USDZ, OBJ, PLY…) | occasional, not a build-time concern | `threejs-asset-pipeline` |
| Niche loaders (LDraw, NRRD, VTK, GCode…) | scientific/CAD, not a game need | `threejs-asset-pipeline` |
| Editor / Inspector tooling | tooling, not runtime | `threejs-performance-optimizer` |
| Legacy `Projector`, `SVGRenderer` | deprecated paths | nobody — avoid |
