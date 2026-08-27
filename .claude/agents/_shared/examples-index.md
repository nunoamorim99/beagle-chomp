# r185 example index

Every example that ships with three.js r185 (589 of them), grouped by the agent
that owns its domain. These are the highest-value reference material in the
project: each one is a small, complete, working program written by the people
who wrote the library.

## Reading an example

Live: `https://threejs.org/examples/#<basename>` — e.g. `#webgpu_postprocessing_bloom`
Source: `https://threejs.org/examples/<basename>.html`

To read them offline (recommended — grep beats browsing):

```bash
git clone --filter=blob:none --no-checkout --depth 1 https://github.com/mrdoob/three.js.git
cd three.js && git sparse-checkout init --cone && git sparse-checkout set examples
git fetch --depth 1 origin tag r185 && git checkout r185      # match your installed version
```

Then the questions you actually have become one-liners:

```bash
grep -l "RenderPipeline" examples/*.html | head            # who uses this API?
grep -l "instancedArray" examples/webgpu_*.html            # who uses this TSL node?
grep -ho "from 'three/addons/[^']*'" examples/webgpu_*.html | sort | uniq -c | sort -rn
grep -n -A12 "new THREE.WebGPURenderer" examples/webgpu_sandbox.html
```

A `webgpu_` prefix means the example uses `WebGPURenderer` and node materials —
those are the ones this project should copy from. A `webgl_` prefix is the
classic path; still useful for concepts, but check the API before copying.

---
## `threejs-postfx-compositor` — 76 examples

*Post chain, render targets, MRT, AA, upscaling*

**WebGPU / node path**

`webgpu_display_stereo` `webgpu_mrt` `webgpu_mrt_mask` `webgpu_multiple_rendertargets` `webgpu_multiple_rendertargets_readback` `webgpu_multisampled_renderbuffers` `webgpu_occlusion` `webgpu_postprocessing` `webgpu_postprocessing_3dlut` `webgpu_postprocessing_afterimage` `webgpu_postprocessing_anamorphic` `webgpu_postprocessing_ao` `webgpu_postprocessing_bloom` `webgpu_postprocessing_bloom_emissive` `webgpu_postprocessing_bloom_selective` `webgpu_postprocessing_ca` `webgpu_postprocessing_difference` `webgpu_postprocessing_dof` `webgpu_postprocessing_dof_basic` `webgpu_postprocessing_fxaa` `webgpu_postprocessing_godrays` `webgpu_postprocessing_lensflare` `webgpu_postprocessing_masking` `webgpu_postprocessing_motion_blur` `webgpu_postprocessing_outline` `webgpu_postprocessing_pixel` `webgpu_postprocessing_radial_blur` `webgpu_postprocessing_retro` `webgpu_postprocessing_smaa` `webgpu_postprocessing_sobel` `webgpu_postprocessing_ssaa` `webgpu_postprocessing_ssgi` `webgpu_postprocessing_ssgi_ballpool` `webgpu_postprocessing_ssr` `webgpu_postprocessing_ssr_denoise` `webgpu_postprocessing_sss` `webgpu_postprocessing_traa` `webgpu_postprocessing_transition` `webgpu_rendertarget_2d-array_3d` `webgpu_rtt` `webgpu_upscaling_fsr1` `webgpu_upscaling_taau`

**Other**

`webgl_effects_anaglyph` `webgl_effects_ascii` `webgl_effects_parallaxbarrier` `webgl_effects_stereo` `webgl_multiple_rendertargets` `webgl_multisampled_renderbuffers` `webgl_postprocessing` `webgl_postprocessing_3dlut` `webgl_postprocessing_advanced` `webgl_postprocessing_afterimage` `webgl_postprocessing_backgrounds` `webgl_postprocessing_dof` `webgl_postprocessing_dof2` `webgl_postprocessing_fxaa` `webgl_postprocessing_glitch` `webgl_postprocessing_godrays` `webgl_postprocessing_gtao` `webgl_postprocessing_masking` `webgl_postprocessing_outline` `webgl_postprocessing_pixel` `webgl_postprocessing_procedural` `webgl_postprocessing_rgb_halftone` `webgl_postprocessing_sao` `webgl_postprocessing_smaa` `webgl_postprocessing_sobel` `webgl_postprocessing_ssaa` `webgl_postprocessing_ssao` `webgl_postprocessing_ssr` `webgl_postprocessing_taa` `webgl_postprocessing_transition` `webgl_postprocessing_unreal_bloom` `webgl_postprocessing_unreal_bloom_selective` `webgl_read_float_buffer` `webgl_rtt`

## `threejs-lighting-shadows` — 59 examples

*Lights, shadows, light probes, IBL, CSM, clustered*

**WebGPU / node path**

`webgpu_equirectangular` `webgpu_furnace_test` `webgpu_hdr` `webgpu_lightprobe` `webgpu_lightprobe_cubecamera` `webgpu_lights_clustered` `webgpu_lights_custom` `webgpu_lights_dynamic` `webgpu_lights_ies_spotlight` `webgpu_lights_phong` `webgpu_lights_physical` `webgpu_lights_pointlights` `webgpu_lights_projector` `webgpu_lights_rectarealight` `webgpu_lights_selective` `webgpu_lights_spotlight` `webgpu_materials_lightmap` `webgpu_pmrem_cubemap` `webgpu_pmrem_equirectangular` `webgpu_pmrem_scene` `webgpu_pmrem_test` `webgpu_shadow_contact` `webgpu_shadowmap` `webgpu_shadowmap_array` `webgpu_shadowmap_csm` `webgpu_shadowmap_opacity` `webgpu_shadowmap_pointlight` `webgpu_shadowmap_progressive` `webgpu_shadowmap_vsm`

**Other**

`webgl_furnace_test` `webgl_lightprobe` `webgl_lightprobe_cubecamera` `webgl_lightprobes` `webgl_lightprobes_complex` `webgl_lightprobes_sponza` `webgl_lights_hemisphere` `webgl_lights_physical` `webgl_lights_rectarealight` `webgl_lights_spotlight` `webgl_lights_spotlights` `webgl_loader_texture_hdr` `webgl_loader_texture_ultrahdr` `webgl_materials_envmaps_fasthdr` `webgl_materials_envmaps_hdr` `webgl_panorama_equirectangular` `webgl_pmrem_cubemap` `webgl_pmrem_equirectangular` `webgl_pmrem_test` `webgl_shadow_contact` `webgl_shadowmap` `webgl_shadowmap_csm` `webgl_shadowmap_pcss` `webgl_shadowmap_performance` `webgl_shadowmap_pointlight` `webgl_shadowmap_progressive` `webgl_shadowmap_viewer` `webgl_shadowmap_vsm` `webgl_simple_gi` `webgl_video_panorama_equirectangular`

## `threejs-asset-pipeline` — 56 examples

*Loaders and exporters across every format*

**WebGPU / node path**

`webgpu_loader_gltf` `webgpu_loader_gltf_anisotropy` `webgpu_loader_gltf_compressed` `webgpu_loader_gltf_dispersion` `webgpu_loader_gltf_iridescence` `webgpu_loader_gltf_sheen` `webgpu_loader_gltf_transmission` `webgpu_loader_materialx`

**Other**

`misc_exporter_draco` `misc_exporter_exr` `misc_exporter_gcode` `misc_exporter_gltf` `misc_exporter_gltf_normals` `misc_exporter_obj` `misc_exporter_ply` `misc_exporter_stl` `misc_exporter_usdz` `webgl_loader_3dm` `webgl_loader_3ds` `webgl_loader_3dtiles` `webgl_loader_3mf` `webgl_loader_3mf_materials` `webgl_loader_amf` `webgl_loader_collada` `webgl_loader_collada_kinematics` `webgl_loader_draco` `webgl_loader_fbx` `webgl_loader_fbx_nurbs` `webgl_loader_gcode` `webgl_loader_gltf` `webgl_loader_gltf_anisotropy` `webgl_loader_gltf_avif` `webgl_loader_gltf_compressed` `webgl_loader_gltf_dispersion` `webgl_loader_gltf_instancing` `webgl_loader_gltf_iridescence` `webgl_loader_gltf_progressive_lod` `webgl_loader_gltf_sheen` `webgl_loader_gltf_transmission` `webgl_loader_gltf_variants` `webgl_loader_ifc` `webgl_loader_imagebitmap` `webgl_loader_kmz` `webgl_loader_ldraw` `webgl_loader_nrrd` `webgl_loader_obj` `webgl_loader_pcd` `webgl_loader_pdb` `webgl_loader_ply` `webgl_loader_stl` `webgl_loader_svg` `webgl_loader_ttf` `webgl_loader_usdz` `webgl_loader_vox` `webgl_loader_vrml` `webgl_loader_xyz`

## `threejs-vfx-audio` — 53 examples

*Particles, water, sky, volumetrics, fog, lensflares, audio*

**WebGPU / node path**

`webgpu_backdrop` `webgpu_backdrop_area` `webgpu_backdrop_water` `webgpu_caustics` `webgpu_compute_particles` `webgpu_compute_particles_fluid` `webgpu_compute_particles_rain` `webgpu_compute_particles_snow` `webgpu_custom_fog` `webgpu_custom_fog_background` `webgpu_custom_fog_scattering` `webgpu_fog_height` `webgpu_lensflares` `webgpu_ocean` `webgpu_particles` `webgpu_sky` `webgpu_tsl_compute_attractors_particles` `webgpu_tsl_earth` `webgpu_tsl_galaxy` `webgpu_tsl_raging_sea` `webgpu_tsl_vfx_flames` `webgpu_tsl_vfx_linkedparticles` `webgpu_tsl_vfx_tornado` `webgpu_tsl_wood` `webgpu_volume_caustics` `webgpu_volume_cloud` `webgpu_volume_fire` `webgpu_volume_lighting` `webgpu_volume_lighting_rectarea` `webgpu_volume_lighting_traa` `webgpu_volume_perlin` `webgpu_water`

**Other**

`webaudio_orientation` `webaudio_sandbox` `webaudio_timing` `webaudio_visualizer` `webgl_buffergeometry_custom_attributes_particles` `webgl_gpgpu_birds` `webgl_gpgpu_birds_gltf` `webgl_gpgpu_protoplanet` `webgl_gpgpu_water` `webgl_lensflares` `webgl_marchingcubes` `webgl_points_billboards` `webgl_points_dynamic` `webgl_points_sprites` `webgl_points_waves` `webgl_shaders_ocean` `webgl_shaders_sky` `webgl_shadowmesh` `webgl_sprites` `webgl_volume_cloud` `webgl_volume_perlin`

## `threejs-material-lookdev` — 52 examples

*Materials, PBR features, env maps, stylised shading*

**WebGPU / node path**

`webgpu_clearcoat` `webgpu_cubemap_adjustments` `webgpu_cubemap_dynamic` `webgpu_cubemap_mix` `webgpu_materials` `webgpu_materials_alphahash` `webgpu_materials_arrays` `webgpu_materials_basic` `webgpu_materials_cubemap_mipmaps` `webgpu_materials_displacementmap` `webgpu_materials_envmaps` `webgpu_materials_envmaps_bpcem` `webgpu_materials_envmaps_groundprojected` `webgpu_materials_matcap` `webgpu_materials_sss` `webgpu_materials_toon` `webgpu_materials_transmission` `webgpu_materials_video` `webgpu_mirror` `webgpu_parallax_uv` `webgpu_reflection` `webgpu_reflection_blurred` `webgpu_reflection_roughness` `webgpu_refraction`

**Other**

`webgl_materials_alphahash` `webgl_materials_blending` `webgl_materials_blending_custom` `webgl_materials_bumpmap` `webgl_materials_car` `webgl_materials_channels` `webgl_materials_cubemap` `webgl_materials_cubemap_dynamic` `webgl_materials_cubemap_mipmaps` `webgl_materials_cubemap_refraction` `webgl_materials_cubemap_render_to_mipmaps` `webgl_materials_displacementmap` `webgl_materials_envmaps` `webgl_materials_envmaps_exr` `webgl_materials_envmaps_groundprojected` `webgl_materials_matcap` `webgl_materials_normalmap` `webgl_materials_normalmap_object_space` `webgl_materials_physical_clearcoat` `webgl_materials_physical_transmission` `webgl_materials_physical_transmission_alpha` `webgl_materials_subsurface_scattering` `webgl_materials_toon` `webgl_materials_video` `webgl_materials_video_webcam` `webgl_materials_wireframe` `webgl_mirror` `webgl_refraction`

## `threejs-geometry-engineer` — 51 examples

*Geometry, curves, modifiers, generators, lines, text*

**WebGPU / node path**

`webgpu_depth_texture` `webgpu_generator_building` `webgpu_generator_city` `webgpu_geometry_loft` `webgpu_lines_fat` `webgpu_lines_fat_wireframe` `webgpu_modifier_curve`

**Other**

`webgl_buffergeometry` `webgl_buffergeometry_attributes_integer` `webgl_buffergeometry_attributes_none` `webgl_buffergeometry_drawrange` `webgl_buffergeometry_glbufferattribute` `webgl_buffergeometry_indexed` `webgl_buffergeometry_lines` `webgl_buffergeometry_lines_indexed` `webgl_buffergeometry_points` `webgl_buffergeometry_points_interleaved` `webgl_buffergeometry_selective_draw` `webgl_buffergeometry_uint` `webgl_decals` `webgl_depth_texture` `webgl_framebuffer_texture` `webgl_geometries` `webgl_geometry_colors` `webgl_geometry_colors_lookuptable` `webgl_geometry_convex` `webgl_geometry_csg` `webgl_geometry_cube` `webgl_geometry_extrude_shapes` `webgl_geometry_extrude_splines` `webgl_geometry_minecraft` `webgl_geometry_nurbs` `webgl_geometry_shapes` `webgl_geometry_spline_editor` `webgl_geometry_teapot` `webgl_geometry_terrain` `webgl_geometry_text` `webgl_geometry_text_shapes` `webgl_geometry_text_stroke` `webgl_helpers` `webgl_lines_colors` `webgl_lines_dashed` `webgl_lines_fat` `webgl_lines_fat_wireframe` `webgl_modifier_curve` `webgl_modifier_curve_instanced` `webgl_modifier_edgesplit` `webgl_modifier_simplifier` `webgl_modifier_subdivision` `webgl_modifier_tessellation` `webxr_xr_marchingcubes`

## `threejs-scene-architect` — 48 examples

*Scene, renderer, colour pipeline, clipping, layers, XR*

**WebGPU / node path**

`webgpu_clipping` `webgpu_layers` `webgpu_multiple_canvas` `webgpu_portal` `webgpu_reversed_depth_buffer` `webgpu_sandbox` `webgpu_sprites` `webgpu_tonemapping` `webgpu_video_frame` `webgpu_xr_cubes` `webgpu_xr_native_layers` `webgpu_xr_rollercoaster`

**Other**

`webgl_clipping` `webgl_clipping_advanced` `webgl_clipping_intersection` `webgl_clipping_stencil` `webgl_math_orientation_transform` `webgl_multiple_scenes_comparison` `webgl_portal` `webgl_renderer_pathtracer` `webgl_reversed_depth_buffer` `webgl_test_wide_gamut` `webgl_tonemapping` `webgl_video_kinect` `webgl_watch` `webxr_ar_cones` `webxr_ar_hittest` `webxr_ar_lighting` `webxr_ar_plane_detection` `webxr_vr_handinput` `webxr_vr_handinput_cubes` `webxr_vr_handinput_pointerclick` `webxr_vr_handinput_pointerdrag` `webxr_vr_handinput_pressbutton` `webxr_vr_handinput_profiles` `webxr_vr_layers` `webxr_vr_panorama` `webxr_vr_panorama_depth` `webxr_vr_rollercoaster` `webxr_vr_sandbox` `webxr_vr_teleport` `webxr_vr_video` `webxr_xr_ballshooter` `webxr_xr_cubes` `webxr_xr_dragging` `webxr_xr_dragging_custom_depth` `webxr_xr_haptics` `webxr_xr_paint`

## `threejs-camera-interaction` — 47 examples

*Cameras, controls, picking, CSS2D/3D, selection*

**WebGPU / node path**

`webgpu_camera` `webgpu_camera_array` `webgpu_camera_logarithmicdepthbuffer` `webgpu_lines_fat_raycasting` `webgpu_multiple_elements`

**Other**

`css2d_label` `css3d_mixed` `css3d_molecules` `css3d_orthographic` `css3d_periodictable` `css3d_sandbox` `css3d_sprites` `css3d_youtube` `misc_boxselection` `misc_controls_arcball` `misc_controls_drag` `misc_controls_fly` `misc_controls_map` `misc_controls_orbit` `misc_controls_pointerlock` `misc_controls_trackball` `misc_controls_transform` `misc_raycaster_helper` `svg_lines` `svg_sandbox` `webgl_camera` `webgl_camera_array` `webgl_camera_logarithmicdepthbuffer` `webgl_geometry_terrain_raycast` `webgl_instancing_raycast` `webgl_interactive_buffergeometry` `webgl_interactive_cubes` `webgl_interactive_cubes_gpu` `webgl_interactive_cubes_ortho` `webgl_interactive_lines` `webgl_interactive_points` `webgl_interactive_raycasting_points` `webgl_interactive_voxelpainter` `webgl_lines_fat_raycasting` `webgl_multiple_elements` `webgl_multiple_elements_text` `webgl_multiple_views` `webgl_raycaster_bvh` `webgl_raycaster_sprite` `webgl_raycaster_texture` `webxr_ar_camera_access` `webxr_xr_controls_transform`

## `threejs-tsl-shader-engineer` — 43 examples

*TSL, node graphs, compute, GPGPU, raw shaders, UBOs*

**WebGPU / node path**

`webgpu_centroid_sampling` `webgpu_compute_audio` `webgpu_compute_birds` `webgpu_compute_cloth` `webgpu_compute_geometry` `webgpu_compute_points` `webgpu_compute_rasterizer` `webgpu_compute_rasterizer_ibl` `webgpu_compute_reduce` `webgpu_compute_sort_bitonic` `webgpu_compute_texture` `webgpu_compute_texture_3d` `webgpu_compute_texture_pingpong` `webgpu_compute_water` `webgpu_materialx_noise` `webgpu_shadertoy` `webgpu_storage_buffer` `webgpu_struct_drawindirect` `webgpu_texturegather` `webgpu_texturegrad` `webgpu_tsl_angular_slicing` `webgpu_tsl_editor` `webgpu_tsl_graph` `webgpu_tsl_halftone` `webgpu_tsl_interoperability` `webgpu_tsl_procedural_terrain` `webgpu_tsl_transpiler`

**Other**

`webgl_buffergeometry_rawshader` `webgl_clipculldistance` `webgl_custom_attributes` `webgl_custom_attributes_lines` `webgl_custom_attributes_points` `webgl_custom_attributes_points2` `webgl_custom_attributes_points3` `webgl_materials_modified` `webgl_shader` `webgl_shader_lava` `webgl_tsl_clearcoat` `webgl_tsl_instancing` `webgl_tsl_shadowmap` `webgl_tsl_skinning` `webgl_ubo` `webgl_ubo_arrays`

## `threejs-texture-pipeline` — 34 examples

*Textures, compression, arrays, colour space, panoramas*

**WebGPU / node path**

`webgpu_loader_texture_ktx2` `webgpu_materials_texture_html` `webgpu_materials_texture_manualmipmap` `webgpu_procedural_texture` `webgpu_textures_2d-array` `webgpu_textures_2d-array_compressed` `webgpu_textures_anisotropy` `webgpu_textures_partialupdate` `webgpu_video_panorama`

**Other**

`misc_exporter_ktx2` `misc_uv_tests` `webgl_loader_texture_dds` `webgl_loader_texture_exr` `webgl_loader_texture_ktx` `webgl_loader_texture_ktx2` `webgl_loader_texture_lottie` `webgl_loader_texture_pvrtc` `webgl_loader_texture_tga` `webgl_loader_texture_tiff` `webgl_materials_texture_anisotropy` `webgl_materials_texture_canvas` `webgl_materials_texture_filters` `webgl_materials_texture_html` `webgl_materials_texture_manualmipmap` `webgl_materials_texture_partialupdate` `webgl_materials_texture_rotation` `webgl_panorama_cube` `webgl_random_uv` `webgl_rendertarget_texture2darray` `webgl_texture2darray` `webgl_texture2darray_compressed` `webgl_texture2darray_layerupdate` `webgl_texture3d` `webgl_texture3d_partialupdate`

## `threejs-animation-rigging` — 28 examples

*Clips, blending, skinning, morphs, IK, retargeting*

**WebGPU / node path**

`webgpu_animation_retargeting` `webgpu_animation_retargeting_readyplayer` `webgpu_morphtargets` `webgpu_morphtargets_face` `webgpu_skinning` `webgpu_skinning_instancing` `webgpu_skinning_instancing_individual` `webgpu_skinning_points`

**Other**

`misc_animation_groups` `misc_animation_keys` `webgl_animation_keyframes` `webgl_animation_multiple` `webgl_animation_skinning_additive_blending` `webgl_animation_skinning_blending` `webgl_animation_skinning_ik` `webgl_animation_skinning_morph` `webgl_animation_walk` `webgl_loader_bvh` `webgl_loader_collada_skinning` `webgl_loader_gltf_animation_pointer` `webgl_loader_md2` `webgl_loader_md2_control` `webgl_loader_mdd` `webgl_morphtargets` `webgl_morphtargets_face` `webgl_morphtargets_horse` `webgl_morphtargets_sphere` `webgl_morphtargets_webcam`

## `threejs-performance-optimizer` — 26 examples

*Instancing, batching, LOD, bundles, workers, memory*

**WebGPU / node path**

`webgpu_compile_async` `webgpu_instance_mesh` `webgpu_instance_path` `webgpu_instance_points` `webgpu_instance_sprites` `webgpu_instance_uniform` `webgpu_instancing_morph` `webgpu_mesh_batch` `webgpu_performance` `webgpu_performance_renderbundle` `webgpu_test_memory`

**Other**

`webgl_batch_lod_bvh` `webgl_buffergeometry_instancing` `webgl_buffergeometry_instancing_billboards` `webgl_buffergeometry_instancing_interleaved` `webgl_instancing_dynamic` `webgl_instancing_morph` `webgl_instancing_performance` `webgl_instancing_scatter` `webgl_lod` `webgl_mesh_batch` `webgl_performance` `webgl_test_memory` `webgl_test_memory2` `webgl_volume_instancing` `webgl_worker_offscreencanvas`

## `threejs-physics-collision` — 14 examples

*Rapier, Jolt, Ammo, OBB, octree*

**Other**

`physics_ammo_break` `physics_ammo_cloth` `physics_ammo_instancing` `physics_ammo_rope` `physics_ammo_terrain` `physics_ammo_volume` `physics_jolt_instancing` `physics_rapier_basic` `physics_rapier_character_controller` `physics_rapier_instancing` `physics_rapier_joints` `physics_rapier_terrain` `physics_rapier_vehicle_controller` `webgl_math_obb`

## `threejs-character-controller` — 1 examples

*Character movement (borrows from other domains)*

Borrowed from neighbouring domains (this is not a docs domain of its own):

`games_fps` `misc_controls_pointerlock` `physics_rapier_character_controller` `webgl_animation_skinning_blending` `webgl_animation_walk` `webgl_math_orientation_transform`

**Other**

`games_fps`

---

588 examples classified. Generated from the r185 tag.
