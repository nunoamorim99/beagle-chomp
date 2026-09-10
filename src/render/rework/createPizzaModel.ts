import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// THREE.CapsuleGeometry duplicates every UV-seam vertex (measured: 194 boundary
// edges on the default radius/segments below) -- same benign pattern as box/
// cylinder/sphere/torus, all of which weld cleanly to 0 given a CORRECT weld.
// (A naive vertex-only mergeVertices() reports 64 'non-manifold' edges here, but
// that is a counting artifact, not a real defect: it double-counts a handful of
// near-pole triangles that become degenerate once two of their three corners
// coincide -- confirmed by replicating subdivideCatmullClark's own degenerate-
// triangle-aware vertex identity, which finds a perfectly ordinary 2-manifold.)
// A capsule is the primary shape for skinned limbs/torso (PLAN_1.5), and skinning
// weight computation is O(vertices x bones), so fewer, guaranteed-simple vertices
// is worth having regardless -- authored as a deterministic, closed-by-
// construction mesh instead: shared pole vertices, and
// the radial index taken `% radialSegments` so the seam is never a duplicate
// vertex in the first place, rather than something to weld away afterward.
// Adapted from forge/stage5_rig/emit_rig.py's buildWatertightCapsule (verified
// there: 0 boundary edges, 0 non-manifold edges, deterministic across repeated
// runs) -- ported here rather than imported because this factory and the rig
// emitter are separate generated-output surfaces with no shared runtime module;
// see forge/tests/test_primitive_watertightness.py for the measured proof, and
// coordinate with the rig owner before changing either copy independently.
function buildWatertightCapsule(
  radius: number,
  cylLength: number,
  capSegments: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const halfCyl = cylLength / 2;
  const totalSpan = 2 * (Math.PI / 2 * radius) + Math.max(0, cylLength);
  const vOf = (fromBottom: number) => (totalSpan > 0 ? fromBottom / totalSpan : 0);

  const bottomPoleIndex = positions.length / 3;
  positions.push(0, -halfCyl - radius, 0);
  uvs.push(0.5, vOf(0));

  const ringStarts: number[] = [];
  const ringV: number[] = [];
  for (let ring = 1; ring <= capSegments; ring += 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = -halfCyl - radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    ringStarts.push(start);
    ringV.push(vOf(radius * phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, vOf(radius * phi));
    }
  }

  const cylinderRingStarts: number[] = [];
  if (cylLength > 0) {
    for (let step = 1; step <= heightSegments; step += 1) {
      const y = -halfCyl + (cylLength * step) / heightSegments;
      const start = positions.length / 3;
      cylinderRingStarts.push(start);
      const v = vOf(radius * (Math.PI / 2) + halfCyl + y);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const theta = (radial / radialSegments) * Math.PI * 2;
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta));
        uvs.push(radial / radialSegments, v);
      }
    }
  }

  const topRingStarts: number[] = [];
  for (let ring = capSegments - 1; ring >= 1; ring -= 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = halfCyl + radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    topRingStarts.push(start);
    const v = vOf(radius * (Math.PI / 2) + Math.max(0, cylLength) + radius * (Math.PI / 2 - phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, v);
    }
  }

  const topPoleIndex = positions.length / 3;
  positions.push(0, halfCyl + radius, 0);
  uvs.push(0.5, vOf(totalSpan));

  const firstBottomRing = ringStarts[0];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottomPoleIndex, firstBottomRing + radial, firstBottomRing + next);
  }

  const allRings = [...ringStarts, ...cylinderRingStarts, ...topRingStarts];
  for (let i = 0; i < allRings.length - 1; i += 1) {
    const a = allRings[i];
    const b = allRings[i + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(a + radial, a + next, b + next);
      indices.push(a + radial, b + next, b + radial);
    }
  }

  const lastRing = allRings[allRings.length - 1];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topPoleIndex, lastRing + next, lastRing + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

// Plan 1.3 F.6 — sweep a thin 2D cross-section along a 3D spine so a curved
// form (hooked blade, handle) reads correctly from EVERY camera angle, not just
// the reference angle a flat extrude happens to match. Uses ExtrudeGeometry's
// native extrudePath; bevelEnabled: false keeps sharp tips (same rule as F.5).
function buildCurveSweepGeometry(
  sweep: { spine: [number, number, number][]; crossSection: { points: [number, number][] }; closed?: boolean },
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const cs = sweep.crossSection.points;
  if (cs.length > 0) {
    shape.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);
    shape.closePath();
  }
  const spine = sweep.spine.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const path = new THREE.CatmullRomCurve3(spine, sweep.closed ?? false);
  return new THREE.ExtrudeGeometry(shape, {
    extrudePath: path,
    steps: Math.max(24, spine.length * 8),
    bevelEnabled: false,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Pizza Slice Mascot
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPizzaSliceMascotModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Pizza Slice Mascot";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["cheese"] = createSculptMaterial(
    "cheese",
    {"id": "cheese", "name": "Cheese plate", "family": "matte-melt", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f2d35a", "color": "#f2d35a", "albedo": {"dominant": "#f2d35a", "secondary": ["#f4e28a", "#e0bc42"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f2d35a", "#f4e28a", "#e0bc42"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.18, "map": null, "note": "Melted cheese is the glossiest thing on the subject and it is UNEVEN - wet in the pooled centre, dry and skinned at the drip lobes. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#f2d35a", "emissiveStrength": 0.15, "opacity": 1.0, "description": "THE FACE PLATE. This is bodyMat: it takes the team colour and the frightened blue. Chosen because it is the largest reliably-visible surface at the play camera, and because putting the colour on the FACE is what makes both 'which team' and 'edible now' read at 25 px. The hex here is the reference's cheese and is what the material is AUTHORED at; at runtime the constructor overwrites it with the team colour.", "notes": "THE FACE PLATE. This is bodyMat: it takes the team colour and the frightened blue. Chosen because it is the largest reliably-visible surface at the play camera, and because putting the colour on the FACE is what makes both 'which team' and 'edible now' read at 25 px. The hex here is the reference's cheese and is what the material is AUTHORED at; at runtime the constructor overwrites it with the team colour.", "localOverrides": [{"id": "freckle-scatter", "kind": "scatter", "description": "About 10 ochre dots, their own fixed material, out of accentMats - IDEA-053 rule 2.", "channel": "baseColor", "region": "plate front", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["crust"] = createSculptMaterial(
    "crust",
    {"id": "crust", "name": "Crust and boots", "family": "baked-dough", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#c2761f", "color": "#c2761f", "albedo": {"dominant": "#c2761f", "secondary": ["#e39a3a", "#a05c14"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#c2761f", "#e39a3a", "#a05c14"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.92, "variation": 0.1, "map": null, "note": "Baked crumb: the most porous surface here. Varies at the blisters, which are scorched and a shade smoother than the crumb around them. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The roll, both spiral caps and both boots share one material, exactly as the reference shares one orange across them. IT IS IN accentMats: it is a large share of the silhouette at the TOP and the BOTTOM of the figure, so following the frightened recolour is what stops a third of the enemy staying warm while the player is chasing it. In the NORMAL state it keeps this baked brown-orange - deliberately not any of the five team hues (rose, teal, amber, violet, leaf), so it never converges with the plate.", "notes": "The roll, both spiral caps and both boots share one material, exactly as the reference shares one orange across them. IT IS IN accentMats: it is a large share of the silhouette at the TOP and the BOTTOM of the figure, so following the frightened recolour is what stops a third of the enemy staying warm while the player is chasing it. In the NORMAL state it keeps this baked brown-orange - deliberately not any of the five team hues (rose, teal, amber, violet, leaf), so it never converges with the plate.", "localOverrides": [{"id": "parting-groove", "kind": "linework", "description": "One ink split along the roll. Its own fixed near-black material, OUT of accentMats - the roll goes blue while frightened but six hairlines do not register, and if they followed they would vanish into the roll.", "channel": "baseColor", "region": "roll length", "confidence": 0.8, "evidenceRefs": ["full-object"]}, {"id": "blister-scatter", "kind": "scatter", "description": "About 12 deeper-orange oven blisters, counted per unit of arc.", "channel": "baseColor", "region": "roll surface", "confidence": 0.8, "evidenceRefs": ["full-object"]}, {"id": "boot-sole-and-collar", "kind": "value-band", "description": "A pale sole and a raised collar, both fixed. Two bands are what separate a boot from a blob.", "channel": "baseColor", "region": "boot", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["dough"] = createSculptMaterial(
    "dough",
    {"id": "dough", "name": "Dough (sides, back, cut faces)", "family": "baked-dough", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#e3a154", "color": "#e3a154", "albedo": {"dominant": "#e3a154", "secondary": ["#f0bd7c", "#c07f33"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#e3a154", "#f0bd7c", "#c07f33"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.9, "variation": 0.08, "map": null, "note": "Same crumb, cut open. The cut face is slightly smoother than the outer crust because it was never in contact with the oven. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The wedge's own solid: both cut faces, the underside and the whole back. A step LIGHTER than the crust so the roll still reads as a separate mass where they meet. Fixed, and out of accentMats: it is near edge-on from the play camera, so recolouring it would buy nothing and would cost the warm rim that keeps the plate's team colour from bleeding into the background.", "notes": "The wedge's own solid: both cut faces, the underside and the whole back. A step LIGHTER than the crust so the roll still reads as a separate mass where they meet. Fixed, and out of accentMats: it is near edge-on from the play camera, so recolouring it would buy nothing and would cost the warm rim that keeps the plate's team colour from bleeding into the background.", "localOverrides": [{"id": "pull-strands", "kind": "linework", "description": "Three tapered grooves per cut face running from the crust toward the tip - the melted-cheese pull. Ink material, fixed.", "channel": "baseColor", "region": "cut face", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["ink"] = createSculptMaterial(
    "ink",
    {"id": "ink", "name": "Ink (limbs and linework)", "family": "matte-ink", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#5c2a22", "color": "#5c2a22", "albedo": {"dominant": "#5c2a22", "secondary": ["#3f1c17"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#5c2a22", "#3f1c17"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.95, "variation": 0.02, "map": null, "note": "Flat drawn ink. No highlight at any angle in the reference - the one material whose variation is genuinely near zero. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Both arm hoses, both leg hoses, the brows, the cheek creases, the crust parting and the cheese-pull strands. One material for all of it, because in the reference they are all the same drawn ink. Fixed, out of accentMats.", "notes": "Both arm hoses, both leg hoses, the brows, the cheek creases, the crust parting and the cheese-pull strands. One material for all of it, because in the reference they are all the same drawn ink. Fixed, out of accentMats.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.85},
    options
  );
  materialMap["glove"] = createSculptMaterial(
    "glove",
    {"id": "glove", "name": "Glove and teeth", "family": "matte-cotton", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#fdfbf4", "color": "#fdfbf4", "albedo": {"dominant": "#fdfbf4", "secondary": ["#e8e2d4"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#fdfbf4", "#e8e2d4"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.88, "variation": 0.06, "map": null, "note": "Matte cotton, slightly smoother at the stretched knuckles. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Both mitts and the tooth band. FIXED AND OUT OF accentMats on purpose: white at both hands and in the mouth is what stops the frightened silhouette collapsing into one blue mass - the job the sushi pair's rice does for them.", "notes": "Both mitts and the tooth band. FIXED AND OUT OF accentMats on purpose: white at both hands and in the mouth is what stops the frightened silhouette collapsing into one blue mass - the job the sushi pair's rice does for them.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.85},
    options
  );
  materialMap["sclera"] = createSculptMaterial(
    "sclera",
    {"id": "sclera", "name": "Eye white", "family": "matte-cotton", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#fdfbf4", "color": "#fdfbf4", "albedo": {"dominant": "#fdfbf4", "secondary": ["#e6e0d2"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#fdfbf4", "#e6e0d2"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.1, "map": null, "note": "The wettest surface on the model after the tongue. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Its own material rather than a share of the glove, because it belongs to eyeMats - the list kept SOLID while the enemy is eaten. Sharing would make the gloves stay solid too and the spirit would come home wearing them.", "notes": "Its own material rather than a share of the glove, because it belongs to eyeMats - the list kept SOLID while the enemy is eaten. Sharing would make the gloves stay solid too and the spirit would come home wearing them.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.85},
    options
  );
  materialMap["pupil"] = createSculptMaterial(
    "pupil",
    {"id": "pupil", "name": "Pupil", "family": "matte-ink", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#3a1f18", "color": "#3a1f18", "albedo": {"dominant": "#3a1f18", "secondary": ["#241009"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#3a1f18", "#241009"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.35, "variation": 0.08, "map": null, "note": "Wet, and it carries the catchlight. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The decal cap. pupBaseColor is read off this so applyGhostState can restore it - without it the normal branch puts back a hardcoded ghost blue.", "notes": "The decal cap. pupBaseColor is read off this so applyGhostState can restore it - without it the normal branch puts back a hardcoded ghost blue.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.85},
    options
  );
  materialMap["glint"] = createSculptMaterial(
    "glint",
    {"id": "glint", "name": "Catchlight", "family": "emissive-toon", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#ffffff", "secondary": ["#ffffff"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ffffff", "#ffffff"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.05, "variation": 0.0, "map": null, "note": "The catchlight itself. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#ffffff", "emissiveStrength": 0.5, "opacity": 1.0, "description": "Fully emissive toon. Not MeshBasicMaterial: eyeMats is typed MeshToonMaterial.", "notes": "Fully emissive toon. Not MeshBasicMaterial: eyeMats is typed MeshToonMaterial.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.85},
    options
  );
  materialMap["mouth"] = createSculptMaterial(
    "mouth",
    {"id": "mouth", "name": "Mouth cavity", "family": "matte-ink", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#6b2b26", "color": "#6b2b26", "albedo": {"dominant": "#6b2b26", "secondary": ["#4a1a17"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#6b2b26", "#4a1a17"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.15, "map": null, "note": "A wet cavity; roughness drops toward the tongue. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The cavity's dark interior. Deeper than the ink so the aperture still reads as depth rather than as another drawn line.", "notes": "The cavity's dark interior. Deeper than the ink so the aperture still reads as depth rather than as another drawn line.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["tongue"] = createSculptMaterial(
    "tongue",
    {"id": "tongue", "name": "Tongue", "family": "matte-flesh", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ef6d6a", "color": "#ef6d6a", "albedo": {"dominant": "#ef6d6a", "secondary": ["#d84f4c"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ef6d6a", "#d84f4c"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.32, "variation": 0.14, "map": null, "note": "Wettest surface on the model. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Fills the cavity's lower half. Fixed.", "notes": "Fills the cavity's lower half. Fixed.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["pepperoni"] = createSculptMaterial(
    "pepperoni",
    {"id": "pepperoni", "name": "Pepperoni", "family": "matte-cured", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#d9553f", "color": "#d9553f", "albedo": {"dominant": "#d9553f", "secondary": ["#f08a72", "#b03c2c"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#d9553f", "#f08a72", "#b03c2c"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.62, "variation": 0.16, "map": null, "note": "Cured meat under melted fat - glossy where the fat pooled, matte at the dry rim. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Four raised discs. Deliberately DEEPER than the reference's #f27666: on a rose team plate (#e0577a) the reference salmon is invisible, and this one is not. Fixed.", "notes": "Four raised discs. Deliberately DEEPER than the reference's #f27666: on a rose team plate (#e0577a) the reference salmon is invisible, and this one is not. Fixed.", "localOverrides": [{"id": "speckle", "kind": "scatter", "description": "A paler speckle inside each disc.", "channel": "baseColor", "region": "disc face", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.75},
    options
  );
  materialMap["topping"] = createSculptMaterial(
    "topping",
    {"id": "topping", "name": "Mushroom and olive", "family": "matte-vegetable", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#eee3c0", "color": "#eee3c0", "albedo": {"dominant": "#eee3c0", "secondary": ["#5e8c2e", "#d8cba4"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#eee3c0", "#5e8c2e", "#d8cba4"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.7, "variation": 0.14, "map": null, "note": "Mushroom is dry and porous; olive is oiled and glossier. One material, two groups, and the variation is that gap. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Two cream mushroom slices and two green olive crescents on one material with a second group for the green. The olives are the ONLY cool hue on the whole body, which is why they are worth their triangles at this size.", "notes": "Two cream mushroom slices and two green olive crescents on one material with a second group for the green. The olives are the ONLY cool hue on the whole body, which is why they are worth their triangles at this size.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.75},
    options
  );
  materialMap["freckle"] = createSculptMaterial(
    "freckle",
    {"id": "freckle", "name": "Cheese freckle", "family": "matte-melt", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#d9a63a", "color": "#d9a63a", "albedo": {"dominant": "#d9a63a", "secondary": ["#c08f28"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#d9a63a", "#c08f28"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.72, "variation": 0.08, "map": null, "note": "Ochre browning on the cheese skin. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Ochre dots on the plate. Fixed, out of accentMats.", "notes": "Ochre dots on the plate. Fixed, out of accentMats.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.7},
    options
  );
  materialMap["crustSpot"] = createSculptMaterial(
    "crustSpot",
    {"id": "crustSpot", "name": "Crust blister", "family": "baked-dough", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#a35c15", "color": "#a35c15", "albedo": {"dominant": "#a35c15", "secondary": ["#8c4d10"], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#a35c15", "#8c4d10"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.8, "variation": 0.12, "map": null, "note": "Scorched blister - smoother than the crumb it sits in. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Oven blisters on the roll. Fixed, out of accentMats - IDEA-053 rule 2 applied up front.", "notes": "Oven blisters on the roll. Fixed, out of accentMats - IDEA-053 rule 2 applied up front.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.7},
    options
  );
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Pivot (no geometry)", "family": "none", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": [], "samplingNotes": "Hand-authored NAMED tone, read off the reference's flat fills to name it and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#000000"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.0, "variation": 0.0, "map": null, "note": "No geometry. MeshToonMaterial has no roughness channel and none is emitted. This is a LOOK-DEV description of the DEPICTED material, which is what a look-dev spec is for, and the relationships it records are expressed in the implementation through the shared 3-step ramp and through which surfaces are given emissive lift."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface is a dielectric. No such channel on a toon material."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel."}, "textureless": {"declared": true, "evidence": ["reference view 'full-object' (.img2threejs/reference/pizza/pizza.png): flat vector art. Measured tone census over the figure, quantised to /16, returns FOUR tones covering 78% of it (ink 31.6%, cheese-yellow 19.8%, crust-orange 18.4%, deep crust-orange 8.0%) - a photographic or textured surface does not concentrate like that.", "No specular lobe, no gradient and no shadow anywhere in the reference, so there is no lighting to invert and no texture to recover: extracting 'PBR evidence' would be measuring the illustrator's fill colours and calling them roughness. Recorded in evidence/image-analysis.md section 4 as materialEvidence NOT APPLICABLE.", "Destination constraint: MeshToonMaterial on a shared 3-step ramp in an offline PWA that ships no bitmaps and generates its wall and floor surfaces at runtime. Every reference mark is built as geometry instead - the mapping table is in evidence/projection-route.md."]}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Marks a component that is a Group, not a mesh. The generator has no `group` primitive, so a pivot node has to be declared something - and it dutifully builds a BOX for it (the flea's first blockout was swallowed by them). Every node on this material is a pivot and must emit no geometry.", "notes": "Marks a component that is a Group, not a mesh. The generator has no `group` primitive, so a pivot node has to be declared something - and it dutifully builds a BOX for it (the flea's first blockout was swallowed by them). Every node on this material is a pivot and must emit no geometry.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's three bands and undoes cel shading."], "evidenceRefs": ["full-object"], "confidence": 0.9},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Pizza mascot (root)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Pizza mascot (root)", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A pivot Group, not geometry. The generator emits its own root Group; nothing is built here.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.58, "height": 0.86, "depth": 0.42, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cast-envelope", "description": "Target 0.58 wide x 0.86 tall x 0.42 deep. The TALLEST enemy in the cast (past maki 0.837) and the first with width/height below 0.70. Being vertical IS the identity - every other enemy is roughly as wide as it is tall.", "identityRank": 1, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "finish": "no geometry - a pivot Group", "evidenceRefs": ["full-object", "palette-scan"], "note": "No geometry - a pivot Group. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Pizza mascot (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Pizza mascot (root)", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A pivot Group, not geometry. The generator emits its own root Group; nothing is built here.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.58, "height": 0.86, "depth": 0.42, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cast-envelope", "description": "Target 0.58 wide x 0.86 tall x 0.42 deep. The TALLEST enemy in the cast (past maki 0.837) and the first with width/height below 0.70. Being vertical IS the identity - every other enemy is roughly as wide as it is tall.", "identityRank": 1, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "finish": "no geometry - a pivot Group", "evidenceRefs": ["full-object", "palette-scan"], "note": "No geometry - a pivot Group. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_bodyPivot_1 = makeAttachmentEndpoint(null);
  const node_bodyPivot_1 = new THREE.Group();
  node_bodyPivot_1.name = "Body (pitched group)__pivot";
  node_bodyPivot_1.scale.set(1, 1, 1);
  if (endpoint_bodyPivot_1) {
    node_bodyPivot_1.position.copy(endpoint_bodyPivot_1.start);
    node_bodyPivot_1.rotation.set(-0.38397, 0.0, 0.0);
  } else {
    node_bodyPivot_1.position.set(0.0, 0.19, 0.02);
    node_bodyPivot_1.rotation.set(-0.38397, 0.0, 0.0);
  }
  node_bodyPivot_1.userData.sculptComponent = {"id": "bodyPivot", "name": "Body (pitched group)", "level": "macro", "role": "torso-pivot", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A pivot Group carrying the -22 degree lean. No geometry.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.19, 0.02], "contactType": "socket", "baseRadius": 0.29, "endRadius": 0.29, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.58, "height": 0.72, "depth": 0.12, "units": "world", "confidence": 0.9}, "transform": {"position": [0.0, 0.19, 0.02], "rotation": [-0.38397, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "lean", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pitch-is-a-camera-decision", "description": "-22 deg is NOT measured. The game camera sits at 59 deg elevation; a vertical cheese plate projects at cos(59)=0.515. Leaning back 22 deg puts the plate normal 37 deg off the view direction (cos 0.80) - a 55% larger projected face - for 0.005 of crown height. It MUST live on an inner group: applyGhostState writes rotation.x on the ROOT every state change (IDEA-056 rule 3).", "identityRank": 1, "confidence": 1.0, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "finish": "no geometry - a pivot Group", "evidenceRefs": ["full-object", "palette-scan"], "note": "No geometry - a pivot Group. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_bodyPivot_1.userData.actionProfile = {"animationRole": "lean", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_bodyPivot_1);
  nodes["bodyPivot"] = node_bodyPivot_1;
  const mesh_bodyPivot_1Geometry = endpoint_bodyPivot_1
    ? new THREE.CylinderGeometry(endpoint_bodyPivot_1.endRadius, endpoint_bodyPivot_1.baseRadius, endpoint_bodyPivot_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bodyPivot_1) {
    mesh_bodyPivot_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bodyPivot_1 = new THREE.Mesh(
    mesh_bodyPivot_1Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bodyPivot_1.name = "Body (pitched group)";
  if (endpoint_bodyPivot_1) {
    mesh_bodyPivot_1.position.copy(endpoint_bodyPivot_1.midpoint);
    mesh_bodyPivot_1.quaternion.copy(endpoint_bodyPivot_1.quaternion);
  }
  mesh_bodyPivot_1.castShadow = options.castShadow ?? true;
  mesh_bodyPivot_1.receiveShadow = options.receiveShadow ?? true;
  mesh_bodyPivot_1.userData.sculptComponent = {"id": "bodyPivot", "name": "Body (pitched group)", "level": "macro", "role": "torso-pivot", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A pivot Group carrying the -22 degree lean. No geometry.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.19, 0.02], "contactType": "socket", "baseRadius": 0.29, "endRadius": 0.29, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.58, "height": 0.72, "depth": 0.12, "units": "world", "confidence": 0.9}, "transform": {"position": [0.0, 0.19, 0.02], "rotation": [-0.38397, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "lean", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pitch-is-a-camera-decision", "description": "-22 deg is NOT measured. The game camera sits at 59 deg elevation; a vertical cheese plate projects at cos(59)=0.515. Leaning back 22 deg puts the plate normal 37 deg off the view direction (cos 0.80) - a 55% larger projected face - for 0.005 of crown height. It MUST live on an inner group: applyGhostState writes rotation.x on the ROOT every state change (IDEA-056 rule 3).", "identityRank": 1, "confidence": 1.0, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "finish": "no geometry - a pivot Group", "evidenceRefs": ["full-object", "palette-scan"], "note": "No geometry - a pivot Group. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_bodyPivot_1.add(mesh_bodyPivot_1);
  meshes["bodyPivot"] = mesh_bodyPivot_1;
  colliders["bodyPivot"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_sliceWedge_2 = makeAttachmentEndpoint(null);
  const node_sliceWedge_2 = new THREE.Group();
  node_sliceWedge_2.name = "Slice wedge (dough)__pivot";
  node_sliceWedge_2.scale.set(1, 1, 1);
  if (endpoint_sliceWedge_2) {
    node_sliceWedge_2.position.copy(endpoint_sliceWedge_2.start);
    node_sliceWedge_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sliceWedge_2.position.set(0.0, 0.0, 0.0);
    node_sliceWedge_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_sliceWedge_2.userData.sculptComponent = {"id": "sliceWedge", "name": "Slice wedge (dough)", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A circular SECTOR footprint extruded along Z. The subject is literally a sector solid, so this is the primitive the object already is - not an approximation of it. Extruding the footprint (rather than revolving or box-stacking) is what lets the cheese plate, the crust sweep and the cut faces all derive from ONE outline and therefore never disagree with it. topologyClass continuous-sculpt because the wedge is one uninterrupted surface from tip to arc; box/cylinder/cone are forbidden for that class and would all be wrong here anyway.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.22556, "endRadius": 0.22556, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.45112, "height": 0.6595, "depth": 0.095, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "dough", "materialLayers": ["dough"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "the-triangle", "description": "Identity rank 1. A 40 degree sector standing on its apex: widest at the top, converging to a rounded tip. No other enemy in the cast is a triangle - the other nine are round drums, ovals, blocks and bugs.", "identityRank": 1, "confidence": 0.9, "evidenceRefs": ["full-object"]}, {"id": "bowed-cut-edges", "description": "The two straight edges bow outward by 0.020 at mid-height. A real slice's cuts are straight; the reference bows them, and a razor-straight edge reads as CAD. Kept small on purpose - a heavy bow costs the triangle.", "identityRank": 4, "confidence": 0.7, "evidenceRefs": ["full-object"]}, {"id": "rounded-tip", "description": "The apex is filleted, not pointed. A sharp point reads as a shard and, at 25 px, aliases into nothing.", "identityRank": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 161, 84, 1.0)", "secondaryAlbedo": "rgba(240, 189, 124, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "finish": "matte baked crumb, one step lighter", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_sliceWedge_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["bodyPivot"] ?? root).add(node_sliceWedge_2);
  nodes["sliceWedge"] = node_sliceWedge_2;
  const mesh_sliceWedge_2Geometry = endpoint_sliceWedge_2
    ? new THREE.CylinderGeometry(endpoint_sliceWedge_2.endRadius, endpoint_sliceWedge_2.baseRadius, endpoint_sliceWedge_2.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_sliceWedge_2) {
    mesh_sliceWedge_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sliceWedge_2 = new THREE.Mesh(
    mesh_sliceWedge_2Geometry,
    materialMap["dough"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sliceWedge_2.name = "Slice wedge (dough)";
  if (endpoint_sliceWedge_2) {
    mesh_sliceWedge_2.position.copy(endpoint_sliceWedge_2.midpoint);
    mesh_sliceWedge_2.quaternion.copy(endpoint_sliceWedge_2.quaternion);
  }
  mesh_sliceWedge_2.castShadow = options.castShadow ?? true;
  mesh_sliceWedge_2.receiveShadow = options.receiveShadow ?? true;
  mesh_sliceWedge_2.userData.sculptComponent = {"id": "sliceWedge", "name": "Slice wedge (dough)", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A circular SECTOR footprint extruded along Z. The subject is literally a sector solid, so this is the primitive the object already is - not an approximation of it. Extruding the footprint (rather than revolving or box-stacking) is what lets the cheese plate, the crust sweep and the cut faces all derive from ONE outline and therefore never disagree with it. topologyClass continuous-sculpt because the wedge is one uninterrupted surface from tip to arc; box/cylinder/cone are forbidden for that class and would all be wrong here anyway.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.22556, "endRadius": 0.22556, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.45112, "height": 0.6595, "depth": 0.095, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "dough", "materialLayers": ["dough"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "the-triangle", "description": "Identity rank 1. A 40 degree sector standing on its apex: widest at the top, converging to a rounded tip. No other enemy in the cast is a triangle - the other nine are round drums, ovals, blocks and bugs.", "identityRank": 1, "confidence": 0.9, "evidenceRefs": ["full-object"]}, {"id": "bowed-cut-edges", "description": "The two straight edges bow outward by 0.020 at mid-height. A real slice's cuts are straight; the reference bows them, and a razor-straight edge reads as CAD. Kept small on purpose - a heavy bow costs the triangle.", "identityRank": 4, "confidence": 0.7, "evidenceRefs": ["full-object"]}, {"id": "rounded-tip", "description": "The apex is filleted, not pointed. A sharp point reads as a shard and, at 25 px, aliases into nothing.", "identityRank": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 161, 84, 1.0)", "secondaryAlbedo": "rgba(240, 189, 124, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.8, "finish": "matte baked crumb, one step lighter", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_sliceWedge_2.add(mesh_sliceWedge_2);
  meshes["sliceWedge"] = mesh_sliceWedge_2;
  colliders["sliceWedge"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_crustRoll_3 = {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.27056, "endRadius": 0.27056, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_crustRoll_3 = makeAttachmentEndpoint(attachment_crustRoll_3);
  const node_crustRoll_3 = new THREE.Group();
  node_crustRoll_3.name = "Crust roll (the quiff)__pivot";
  node_crustRoll_3.scale.set(1, 1, 1);
  if (endpoint_crustRoll_3) {
    node_crustRoll_3.position.copy(endpoint_crustRoll_3.start);
    node_crustRoll_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_crustRoll_3.position.set(0.0, 0.0, 0.0);
    node_crustRoll_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_crustRoll_3.userData.sculptComponent = {"id": "crustRoll", "name": "Crust roll (the quiff)", "level": "macro", "role": "hair-analogue", "importance": 0.9, "confidence": 0.8, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A tube of radius 0.0605 swept along the sector's own arc, with the last quarter of each end curled FORWARD (+Z). curve-sweep rather than torus because the path is not a circle: it leaves the arc's plane at both ends. The forward curl exists so the spiral terminus faces the camera instead of the maze wall.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.27056, "endRadius": 0.27056, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.54112, "height": 0.121, "depth": 0.211, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "follow-through", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "crust", "materialLayers": ["crust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "reads-as-hair", "description": "Identity rank 2, and the whole humanization gag: a fat rolled tube swept across the top of the wedge, overhanging the plate on BOTH sides, reads as a pompadour. It is why the wedge reads as a head rather than as food on a stick.", "identityRank": 2, "confidence": 0.85, "evidenceRefs": ["full-object"]}, {"id": "fatter-than-the-body", "description": "Roll diameter 0.121 against a 0.095 dough thickness - MEASURED at 0.168 SH in the reference. If the roll is not clearly the fattest mass it stops being the second mass and becomes a rim.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["full-object"]}, {"id": "parting-groove", "description": "One ink split-line along the roll's length. Without it the roll is a sausage; with it, it is a hair parting.", "identityRank": 6, "confidence": 0.75, "evidenceRefs": ["full-object"]}, {"id": "blister-scatter", "description": "About 12 oven blisters, counted PER UNIT OF ARC so the roll's own length sets the count and a change of radius cannot leave a bald patch.", "identityRank": 7, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(194, 118, 31, 1.0)", "secondaryAlbedo": "rgba(227, 154, 58, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.85, "finish": "matte baked crumb", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_crustRoll_3.userData.actionProfile = {"animationRole": "follow-through", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["bodyPivot"] ?? root).add(node_crustRoll_3);
  nodes["crustRoll"] = node_crustRoll_3;
  const mesh_crustRoll_3Geometry = endpoint_crustRoll_3
    ? new THREE.CylinderGeometry(endpoint_crustRoll_3.endRadius, endpoint_crustRoll_3.baseRadius, endpoint_crustRoll_3.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_crustRoll_3) {
    mesh_crustRoll_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_crustRoll_3 = new THREE.Mesh(
    mesh_crustRoll_3Geometry,
    materialMap["crust"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crustRoll_3.name = "Crust roll (the quiff)";
  if (endpoint_crustRoll_3) {
    mesh_crustRoll_3.position.copy(endpoint_crustRoll_3.midpoint);
    mesh_crustRoll_3.quaternion.copy(endpoint_crustRoll_3.quaternion);
  }
  mesh_crustRoll_3.castShadow = options.castShadow ?? true;
  mesh_crustRoll_3.receiveShadow = options.receiveShadow ?? true;
  mesh_crustRoll_3.userData.sculptComponent = {"id": "crustRoll", "name": "Crust roll (the quiff)", "level": "macro", "role": "hair-analogue", "importance": 0.9, "confidence": 0.8, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A tube of radius 0.0605 swept along the sector's own arc, with the last quarter of each end curled FORWARD (+Z). curve-sweep rather than torus because the path is not a circle: it leaves the arc's plane at both ends. The forward curl exists so the spiral terminus faces the camera instead of the maze wall.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.27056, "endRadius": 0.27056, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.54112, "height": 0.121, "depth": 0.211, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "follow-through", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "crust", "materialLayers": ["crust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "reads-as-hair", "description": "Identity rank 2, and the whole humanization gag: a fat rolled tube swept across the top of the wedge, overhanging the plate on BOTH sides, reads as a pompadour. It is why the wedge reads as a head rather than as food on a stick.", "identityRank": 2, "confidence": 0.85, "evidenceRefs": ["full-object"]}, {"id": "fatter-than-the-body", "description": "Roll diameter 0.121 against a 0.095 dough thickness - MEASURED at 0.168 SH in the reference. If the roll is not clearly the fattest mass it stops being the second mass and becomes a rim.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["full-object"]}, {"id": "parting-groove", "description": "One ink split-line along the roll's length. Without it the roll is a sausage; with it, it is a hair parting.", "identityRank": 6, "confidence": 0.75, "evidenceRefs": ["full-object"]}, {"id": "blister-scatter", "description": "About 12 oven blisters, counted PER UNIT OF ARC so the roll's own length sets the count and a change of radius cannot leave a bald patch.", "identityRank": 7, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(194, 118, 31, 1.0)", "secondaryAlbedo": "rgba(227, 154, 58, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.85, "finish": "matte baked crumb", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_crustRoll_3.add(mesh_crustRoll_3);
  meshes["crustRoll"] = mesh_crustRoll_3;
  colliders["crustRoll"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_armL_4 = {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.16314, 0.396, 0.02], "contactType": "socket", "baseRadius": 0.019, "endRadius": 0.019, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_armL_4 = makeAttachmentEndpoint(attachment_armL_4);
  const node_armL_4 = new THREE.Group();
  node_armL_4.name = "Arm (left)__pivot";
  node_armL_4.scale.set(1, 1, 1);
  if (endpoint_armL_4) {
    node_armL_4.position.copy(endpoint_armL_4.start);
    node_armL_4.rotation.set(0.38397, 0.0, 0.26);
  } else {
    node_armL_4.position.set(0.16314, 0.396, 0.02);
    node_armL_4.rotation.set(0.38397, 0.0, 0.26);
  }
  node_armL_4.userData.sculptComponent = {"id": "armL", "name": "Arm (left)", "level": "macro", "role": "arm", "importance": 0.75, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "A constant-diameter tube swept along a shallow curve. NO elbow: the reference is drawn in the rubber-hose idiom, where a limb is one continuous hose and the bend lives in the curve, not in a joint. Measured: the arm's ink run is the same width at y=900 and y=1000 across a large change of direction, with no taper and no joint bulge. A capsule chain would be the wrong idiom, not a cheaper version of the right one.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.16314, 0.396, 0.02], "contactType": "socket", "baseRadius": 0.019, "endRadius": 0.019, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.038, "height": 0.26, "depth": 0.038, "units": "world", "confidence": 0.7}, "transform": {"position": [0.16314, 0.396, 0.02], "rotation": [0.38397, 0, 0.26], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rest-pose-counter-pitch", "description": "The shoulder pivot carries +22 deg to cancel the body's lean, so the hose hangs vertically in WORLD space. Authored on the pivot rather than by re-parenting to the root, so the idle body-lean still carries the arms.", "identityRank": 8, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_armL_4.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["bodyPivot"] ?? root).add(node_armL_4);
  nodes["armL"] = node_armL_4;
  const mesh_armL_4Geometry = endpoint_armL_4
    ? new THREE.CylinderGeometry(endpoint_armL_4.endRadius, endpoint_armL_4.baseRadius, endpoint_armL_4.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_armL_4) {
    mesh_armL_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armL_4 = new THREE.Mesh(
    mesh_armL_4Geometry,
    materialMap["ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armL_4.name = "Arm (left)";
  if (endpoint_armL_4) {
    mesh_armL_4.position.copy(endpoint_armL_4.midpoint);
    mesh_armL_4.quaternion.copy(endpoint_armL_4.quaternion);
  }
  mesh_armL_4.castShadow = options.castShadow ?? true;
  mesh_armL_4.receiveShadow = options.receiveShadow ?? true;
  mesh_armL_4.userData.sculptComponent = {"id": "armL", "name": "Arm (left)", "level": "macro", "role": "arm", "importance": 0.75, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "A constant-diameter tube swept along a shallow curve. NO elbow: the reference is drawn in the rubber-hose idiom, where a limb is one continuous hose and the bend lives in the curve, not in a joint. Measured: the arm's ink run is the same width at y=900 and y=1000 across a large change of direction, with no taper and no joint bulge. A capsule chain would be the wrong idiom, not a cheaper version of the right one.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.16314, 0.396, 0.02], "contactType": "socket", "baseRadius": 0.019, "endRadius": 0.019, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.038, "height": 0.26, "depth": 0.038, "units": "world", "confidence": 0.7}, "transform": {"position": [0.16314, 0.396, 0.02], "rotation": [0.38397, 0, 0.26], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rest-pose-counter-pitch", "description": "The shoulder pivot carries +22 deg to cancel the body's lean, so the hose hangs vertically in WORLD space. Authored on the pivot rather than by re-parenting to the root, so the idle body-lean still carries the arms.", "identityRank": 8, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_armL_4.add(mesh_armL_4);
  meshes["armL"] = mesh_armL_4;
  colliders["armL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_gloveL_5 = makeAttachmentEndpoint(null);
  const node_gloveL_5 = new THREE.Group();
  node_gloveL_5.name = "Glove (left)__pivot";
  node_gloveL_5.scale.set(1, 1, 1);
  if (endpoint_gloveL_5) {
    node_gloveL_5.position.copy(endpoint_gloveL_5.start);
    node_gloveL_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gloveL_5.position.set(0.0, -0.26, 0.0);
    node_gloveL_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_gloveL_5.userData.sculptComponent = {"id": "gloveL", "name": "Glove (left)", "level": "meso", "role": "hand", "importance": 0.65, "confidence": 0.75, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "A flattened ellipsoid mitt with one thumb lobe. Four-fingered cartoon gloves are drawn as a blob with separations, not as fingers; at 25 px a modelled hand is a smear.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "armL", "attachment": {"parentSocket": "armL-socket", "parentId": "armL", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.26, 0.0], "contactType": "socket", "baseRadius": 0.0485, "endRadius": 0.0485, "embedDepth": 0.01056, "overlap": 0.01056, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.097, "height": 0.088, "depth": 0.072, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, -0.26, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glove", "materialLayers": ["glove"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gloves-stay-white", "description": "Out of accentMats and out of bodyMat. White mitts at both hands are what stops the frightened silhouette collapsing into one blue mass - the same job the sushi pair's rice does.", "identityRank": 5, "confidence": 0.85, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 251, 244, 1.0)", "secondaryAlbedo": "rgba(232, 226, 212, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "matte cotton, the brightest value on the model", "evidenceRefs": ["full-object", "palette-scan"], "note": "Matte cotton glove. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_gloveL_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["armL"] ?? root).add(node_gloveL_5);
  nodes["gloveL"] = node_gloveL_5;
  const mesh_gloveL_5Geometry = endpoint_gloveL_5
    ? new THREE.CylinderGeometry(endpoint_gloveL_5.endRadius, endpoint_gloveL_5.baseRadius, endpoint_gloveL_5.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_gloveL_5) {
    mesh_gloveL_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gloveL_5 = new THREE.Mesh(
    mesh_gloveL_5Geometry,
    materialMap["glove"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gloveL_5.name = "Glove (left)";
  if (endpoint_gloveL_5) {
    mesh_gloveL_5.position.copy(endpoint_gloveL_5.midpoint);
    mesh_gloveL_5.quaternion.copy(endpoint_gloveL_5.quaternion);
  }
  mesh_gloveL_5.castShadow = options.castShadow ?? true;
  mesh_gloveL_5.receiveShadow = options.receiveShadow ?? true;
  mesh_gloveL_5.userData.sculptComponent = {"id": "gloveL", "name": "Glove (left)", "level": "meso", "role": "hand", "importance": 0.65, "confidence": 0.75, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "A flattened ellipsoid mitt with one thumb lobe. Four-fingered cartoon gloves are drawn as a blob with separations, not as fingers; at 25 px a modelled hand is a smear.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "armL", "attachment": {"parentSocket": "armL-socket", "parentId": "armL", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.26, 0.0], "contactType": "socket", "baseRadius": 0.0485, "endRadius": 0.0485, "embedDepth": 0.01056, "overlap": 0.01056, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.097, "height": 0.088, "depth": 0.072, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, -0.26, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glove", "materialLayers": ["glove"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gloves-stay-white", "description": "Out of accentMats and out of bodyMat. White mitts at both hands are what stops the frightened silhouette collapsing into one blue mass - the same job the sushi pair's rice does.", "identityRank": 5, "confidence": 0.85, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 251, 244, 1.0)", "secondaryAlbedo": "rgba(232, 226, 212, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "matte cotton, the brightest value on the model", "evidenceRefs": ["full-object", "palette-scan"], "note": "Matte cotton glove. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_gloveL_5.add(mesh_gloveL_5);
  meshes["gloveL"] = mesh_gloveL_5;
  colliders["gloveL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_armR_6 = {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.16314, 0.396, 0.02], "contactType": "socket", "baseRadius": 0.019, "endRadius": 0.019, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_armR_6 = makeAttachmentEndpoint(attachment_armR_6);
  const node_armR_6 = new THREE.Group();
  node_armR_6.name = "Arm (right)__pivot";
  node_armR_6.scale.set(1, 1, 1);
  if (endpoint_armR_6) {
    node_armR_6.position.copy(endpoint_armR_6.start);
    node_armR_6.rotation.set(0.38397, 0.0, -0.26);
  } else {
    node_armR_6.position.set(-0.16314, 0.396, 0.02);
    node_armR_6.rotation.set(0.38397, 0.0, -0.26);
  }
  node_armR_6.userData.sculptComponent = {"id": "armR", "name": "Arm (right)", "level": "macro", "role": "arm", "importance": 0.75, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "A constant-diameter tube swept along a shallow curve. NO elbow: the reference is drawn in the rubber-hose idiom, where a limb is one continuous hose and the bend lives in the curve, not in a joint. Measured: the arm's ink run is the same width at y=900 and y=1000 across a large change of direction, with no taper and no joint bulge. A capsule chain would be the wrong idiom, not a cheaper version of the right one.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.16314, 0.396, 0.02], "contactType": "socket", "baseRadius": 0.019, "endRadius": 0.019, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.038, "height": 0.26, "depth": 0.038, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.16314, 0.396, 0.02], "rotation": [0.38397, 0, -0.26], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_armR_6.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["bodyPivot"] ?? root).add(node_armR_6);
  nodes["armR"] = node_armR_6;
  const mesh_armR_6Geometry = endpoint_armR_6
    ? new THREE.CylinderGeometry(endpoint_armR_6.endRadius, endpoint_armR_6.baseRadius, endpoint_armR_6.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_armR_6) {
    mesh_armR_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armR_6 = new THREE.Mesh(
    mesh_armR_6Geometry,
    materialMap["ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armR_6.name = "Arm (right)";
  if (endpoint_armR_6) {
    mesh_armR_6.position.copy(endpoint_armR_6.midpoint);
    mesh_armR_6.quaternion.copy(endpoint_armR_6.quaternion);
  }
  mesh_armR_6.castShadow = options.castShadow ?? true;
  mesh_armR_6.receiveShadow = options.receiveShadow ?? true;
  mesh_armR_6.userData.sculptComponent = {"id": "armR", "name": "Arm (right)", "level": "macro", "role": "arm", "importance": 0.75, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "A constant-diameter tube swept along a shallow curve. NO elbow: the reference is drawn in the rubber-hose idiom, where a limb is one continuous hose and the bend lives in the curve, not in a joint. Measured: the arm's ink run is the same width at y=900 and y=1000 across a large change of direction, with no taper and no joint bulge. A capsule chain would be the wrong idiom, not a cheaper version of the right one.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "bodyPivot", "attachment": {"parentSocket": "bodyPivot-socket", "parentId": "bodyPivot", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.16314, 0.396, 0.02], "contactType": "socket", "baseRadius": 0.019, "endRadius": 0.019, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.038, "height": 0.26, "depth": 0.038, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.16314, 0.396, 0.02], "rotation": [0.38397, 0, -0.26], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_armR_6.add(mesh_armR_6);
  meshes["armR"] = mesh_armR_6;
  colliders["armR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_gloveR_7 = makeAttachmentEndpoint(null);
  const node_gloveR_7 = new THREE.Group();
  node_gloveR_7.name = "Glove (right)__pivot";
  node_gloveR_7.scale.set(1, 1, 1);
  if (endpoint_gloveR_7) {
    node_gloveR_7.position.copy(endpoint_gloveR_7.start);
    node_gloveR_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gloveR_7.position.set(0.0, -0.26, 0.0);
    node_gloveR_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_gloveR_7.userData.sculptComponent = {"id": "gloveR", "name": "Glove (right)", "level": "meso", "role": "hand", "importance": 0.65, "confidence": 0.75, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "A flattened ellipsoid mitt with one thumb lobe. Four-fingered cartoon gloves are drawn as a blob with separations, not as fingers; at 25 px a modelled hand is a smear.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "armR", "attachment": {"parentSocket": "armR-socket", "parentId": "armR", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.26, 0.0], "contactType": "socket", "baseRadius": 0.0485, "endRadius": 0.0485, "embedDepth": 0.01056, "overlap": 0.01056, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.097, "height": 0.088, "depth": 0.072, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, -0.26, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glove", "materialLayers": ["glove"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 251, 244, 1.0)", "secondaryAlbedo": "rgba(232, 226, 212, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "matte cotton, the brightest value on the model", "evidenceRefs": ["full-object", "palette-scan"], "note": "Matte cotton glove. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_gloveR_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["armR"] ?? root).add(node_gloveR_7);
  nodes["gloveR"] = node_gloveR_7;
  const mesh_gloveR_7Geometry = endpoint_gloveR_7
    ? new THREE.CylinderGeometry(endpoint_gloveR_7.endRadius, endpoint_gloveR_7.baseRadius, endpoint_gloveR_7.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_gloveR_7) {
    mesh_gloveR_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gloveR_7 = new THREE.Mesh(
    mesh_gloveR_7Geometry,
    materialMap["glove"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gloveR_7.name = "Glove (right)";
  if (endpoint_gloveR_7) {
    mesh_gloveR_7.position.copy(endpoint_gloveR_7.midpoint);
    mesh_gloveR_7.quaternion.copy(endpoint_gloveR_7.quaternion);
  }
  mesh_gloveR_7.castShadow = options.castShadow ?? true;
  mesh_gloveR_7.receiveShadow = options.receiveShadow ?? true;
  mesh_gloveR_7.userData.sculptComponent = {"id": "gloveR", "name": "Glove (right)", "level": "meso", "role": "hand", "importance": 0.65, "confidence": 0.75, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "A flattened ellipsoid mitt with one thumb lobe. Four-fingered cartoon gloves are drawn as a blob with separations, not as fingers; at 25 px a modelled hand is a smear.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "armR", "attachment": {"parentSocket": "armR-socket", "parentId": "armR", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.26, 0.0], "contactType": "socket", "baseRadius": 0.0485, "endRadius": 0.0485, "embedDepth": 0.01056, "overlap": 0.01056, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.097, "height": 0.088, "depth": 0.072, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, -0.26, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glove", "materialLayers": ["glove"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 251, 244, 1.0)", "secondaryAlbedo": "rgba(232, 226, 212, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "matte cotton, the brightest value on the model", "evidenceRefs": ["full-object", "palette-scan"], "note": "Matte cotton glove. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_gloveR_7.add(mesh_gloveR_7);
  meshes["gloveR"] = mesh_gloveR_7;
  colliders["gloveR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_legL_8 = {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.072, 0.285, -0.055], "contactType": "socket", "baseRadius": 0.02, "endRadius": 0.02, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_legL_8 = makeAttachmentEndpoint(attachment_legL_8);
  const node_legL_8 = new THREE.Group();
  node_legL_8.name = "Leg (left)__pivot";
  node_legL_8.scale.set(1, 1, 1);
  if (endpoint_legL_8) {
    node_legL_8.position.copy(endpoint_legL_8.start);
    node_legL_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_legL_8.position.set(0.072, 0.285, -0.055);
    node_legL_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_legL_8.userData.sculptComponent = {"id": "legL", "name": "Leg (left)", "level": "macro", "role": "leg", "importance": 0.75, "confidence": 0.75, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "Same rubber-hose tube as the arms, a shade fatter (0.040 against 0.038 - MEASURED at 0.058-0.064 SH for the legs against an inferred 0.052 SH for the arms). Child of the ROOT, not of the pitched body, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.072, 0.285, -0.055], "contactType": "socket", "baseRadius": 0.02, "endRadius": 0.02, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.04, "height": 0.2, "depth": 0.04, "units": "world", "confidence": 0.75}, "transform": {"position": [0.072, 0.285, -0.055], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "stride", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "legs-emerge-from-behind-the-tip", "description": "The hips sit BEHIND the slice at z=-0.055 and the tip hangs down to y=0.19 between them. That is what makes the legs read as coming out from behind the body rather than out of its point - a detail the reference is explicit about and the thing that makes the pose legible as standing.", "identityRank": 4, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_legL_8.userData.actionProfile = {"animationRole": "stride", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_legL_8);
  nodes["legL"] = node_legL_8;
  const mesh_legL_8Geometry = endpoint_legL_8
    ? new THREE.CylinderGeometry(endpoint_legL_8.endRadius, endpoint_legL_8.baseRadius, endpoint_legL_8.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_legL_8) {
    mesh_legL_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_legL_8 = new THREE.Mesh(
    mesh_legL_8Geometry,
    materialMap["ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_legL_8.name = "Leg (left)";
  if (endpoint_legL_8) {
    mesh_legL_8.position.copy(endpoint_legL_8.midpoint);
    mesh_legL_8.quaternion.copy(endpoint_legL_8.quaternion);
  }
  mesh_legL_8.castShadow = options.castShadow ?? true;
  mesh_legL_8.receiveShadow = options.receiveShadow ?? true;
  mesh_legL_8.userData.sculptComponent = {"id": "legL", "name": "Leg (left)", "level": "macro", "role": "leg", "importance": 0.75, "confidence": 0.75, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "Same rubber-hose tube as the arms, a shade fatter (0.040 against 0.038 - MEASURED at 0.058-0.064 SH for the legs against an inferred 0.052 SH for the arms). Child of the ROOT, not of the pitched body, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.072, 0.285, -0.055], "contactType": "socket", "baseRadius": 0.02, "endRadius": 0.02, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.04, "height": 0.2, "depth": 0.04, "units": "world", "confidence": 0.75}, "transform": {"position": [0.072, 0.285, -0.055], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "stride", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "legs-emerge-from-behind-the-tip", "description": "The hips sit BEHIND the slice at z=-0.055 and the tip hangs down to y=0.19 between them. That is what makes the legs read as coming out from behind the body rather than out of its point - a detail the reference is explicit about and the thing that makes the pose legible as standing.", "identityRank": 4, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_legL_8.add(mesh_legL_8);
  meshes["legL"] = mesh_legL_8;
  colliders["legL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_bootL_9 = {"parentSocket": "legL-socket", "parentId": "legL", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.185, 0.02], "contactType": "socket", "baseRadius": 0.0675, "endRadius": 0.0675, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_bootL_9 = makeAttachmentEndpoint(attachment_bootL_9);
  const node_bootL_9 = new THREE.Group();
  node_bootL_9.name = "Boot (left)__pivot";
  node_bootL_9.scale.set(1, 1, 1);
  if (endpoint_bootL_9) {
    node_bootL_9.position.copy(endpoint_bootL_9.start);
    node_bootL_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bootL_9.position.set(0.0, -0.185, 0.02);
    node_bootL_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_bootL_9.userData.sculptComponent = {"id": "bootL", "name": "Boot (left)", "level": "meso", "role": "foot", "importance": 0.7, "confidence": 0.7, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "A rounded-toe boot pointing +Z with a raised ankle collar. Built as a capsule body plus a toe cap rather than an extrusion: an extruded footprint is non-indexed, so its bevel steps cannot be smoothed and the toon ramp quantises them into rectangular patches (IDEA-057's measured trap).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legL", "attachment": {"parentSocket": "legL-socket", "parentId": "legL", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.185, 0.02], "contactType": "socket", "baseRadius": 0.0675, "endRadius": 0.0675, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.088, "height": 0.115, "depth": 0.135, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, -0.185, 0.02], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "crust", "materialLayers": ["crust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "boots-are-worn-items", "description": "With the gloves, the only clothing in the cast. Nine enemies wear nothing; this one is dressed, and that is half of what makes it read as a person rather than as an animate object.", "identityRank": 3, "confidence": 0.85, "evidenceRefs": ["full-object"]}, {"id": "collar-and-sole", "description": "A raised collar band at the top and a pale sole sliver at the bottom - MEASURED 0.116 x 0.057 SH. Two bands are what separate a boot from a blob.", "identityRank": 7, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(194, 118, 31, 1.0)", "secondaryAlbedo": "rgba(227, 154, 58, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.85, "finish": "matte baked crumb", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_bootL_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["legL"] ?? root).add(node_bootL_9);
  nodes["bootL"] = node_bootL_9;
  const mesh_bootL_9Geometry = endpoint_bootL_9
    ? new THREE.CylinderGeometry(endpoint_bootL_9.endRadius, endpoint_bootL_9.baseRadius, endpoint_bootL_9.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_bootL_9) {
    mesh_bootL_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bootL_9 = new THREE.Mesh(
    mesh_bootL_9Geometry,
    materialMap["crust"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bootL_9.name = "Boot (left)";
  if (endpoint_bootL_9) {
    mesh_bootL_9.position.copy(endpoint_bootL_9.midpoint);
    mesh_bootL_9.quaternion.copy(endpoint_bootL_9.quaternion);
  }
  mesh_bootL_9.castShadow = options.castShadow ?? true;
  mesh_bootL_9.receiveShadow = options.receiveShadow ?? true;
  mesh_bootL_9.userData.sculptComponent = {"id": "bootL", "name": "Boot (left)", "level": "meso", "role": "foot", "importance": 0.7, "confidence": 0.7, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "A rounded-toe boot pointing +Z with a raised ankle collar. Built as a capsule body plus a toe cap rather than an extrusion: an extruded footprint is non-indexed, so its bevel steps cannot be smoothed and the toon ramp quantises them into rectangular patches (IDEA-057's measured trap).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legL", "attachment": {"parentSocket": "legL-socket", "parentId": "legL", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.185, 0.02], "contactType": "socket", "baseRadius": 0.0675, "endRadius": 0.0675, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.088, "height": 0.115, "depth": 0.135, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, -0.185, 0.02], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "crust", "materialLayers": ["crust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "boots-are-worn-items", "description": "With the gloves, the only clothing in the cast. Nine enemies wear nothing; this one is dressed, and that is half of what makes it read as a person rather than as an animate object.", "identityRank": 3, "confidence": 0.85, "evidenceRefs": ["full-object"]}, {"id": "collar-and-sole", "description": "A raised collar band at the top and a pale sole sliver at the bottom - MEASURED 0.116 x 0.057 SH. Two bands are what separate a boot from a blob.", "identityRank": 7, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(194, 118, 31, 1.0)", "secondaryAlbedo": "rgba(227, 154, 58, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.85, "finish": "matte baked crumb", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_bootL_9.add(mesh_bootL_9);
  meshes["bootL"] = mesh_bootL_9;
  colliders["bootL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_legR_10 = {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.072, 0.285, -0.055], "contactType": "socket", "baseRadius": 0.02, "endRadius": 0.02, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_legR_10 = makeAttachmentEndpoint(attachment_legR_10);
  const node_legR_10 = new THREE.Group();
  node_legR_10.name = "Leg (right)__pivot";
  node_legR_10.scale.set(1, 1, 1);
  if (endpoint_legR_10) {
    node_legR_10.position.copy(endpoint_legR_10.start);
    node_legR_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_legR_10.position.set(-0.072, 0.285, -0.055);
    node_legR_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_legR_10.userData.sculptComponent = {"id": "legR", "name": "Leg (right)", "level": "macro", "role": "leg", "importance": 0.75, "confidence": 0.75, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "Same rubber-hose tube as the arms, a shade fatter (0.040 against 0.038 - MEASURED at 0.058-0.064 SH for the legs against an inferred 0.052 SH for the arms). Child of the ROOT, not of the pitched body, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.072, 0.285, -0.055], "contactType": "socket", "baseRadius": 0.02, "endRadius": 0.02, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.04, "height": 0.2, "depth": 0.04, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.072, 0.285, -0.055], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "stride", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_legR_10.userData.actionProfile = {"animationRole": "stride", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_legR_10);
  nodes["legR"] = node_legR_10;
  const mesh_legR_10Geometry = endpoint_legR_10
    ? new THREE.CylinderGeometry(endpoint_legR_10.endRadius, endpoint_legR_10.baseRadius, endpoint_legR_10.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_legR_10) {
    mesh_legR_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_legR_10 = new THREE.Mesh(
    mesh_legR_10Geometry,
    materialMap["ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_legR_10.name = "Leg (right)";
  if (endpoint_legR_10) {
    mesh_legR_10.position.copy(endpoint_legR_10.midpoint);
    mesh_legR_10.quaternion.copy(endpoint_legR_10.quaternion);
  }
  mesh_legR_10.castShadow = options.castShadow ?? true;
  mesh_legR_10.receiveShadow = options.receiveShadow ?? true;
  mesh_legR_10.userData.sculptComponent = {"id": "legR", "name": "Leg (right)", "level": "macro", "role": "leg", "importance": 0.75, "confidence": 0.75, "primitive": "curve-sweep", "topologyClass": "fiber-strand", "topologyRationale": "Same rubber-hose tube as the arms, a shade fatter (0.040 against 0.038 - MEASURED at 0.058-0.064 SH for the legs against an inferred 0.052 SH for the arms). Child of the ROOT, not of the pitched body, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.072, 0.285, -0.055], "contactType": "socket", "baseRadius": 0.02, "endRadius": 0.02, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.04, "height": 0.2, "depth": 0.04, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.072, 0.285, -0.055], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "stride", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "ink", "materialLayers": ["ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 42, 34, 1.0)", "secondaryAlbedo": "rgba(63, 28, 23, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "finish": "flat ink, no highlight at any angle", "evidenceRefs": ["full-object", "palette-scan"], "note": "Flat matte paint with no highlight at any angle. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_legR_10.add(mesh_legR_10);
  meshes["legR"] = mesh_legR_10;
  colliders["legR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_bootR_11 = {"parentSocket": "legR-socket", "parentId": "legR", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.185, 0.02], "contactType": "socket", "baseRadius": 0.0675, "endRadius": 0.0675, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."};
  const endpoint_bootR_11 = makeAttachmentEndpoint(attachment_bootR_11);
  const node_bootR_11 = new THREE.Group();
  node_bootR_11.name = "Boot (right)__pivot";
  node_bootR_11.scale.set(1, 1, 1);
  if (endpoint_bootR_11) {
    node_bootR_11.position.copy(endpoint_bootR_11.start);
    node_bootR_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bootR_11.position.set(0.0, -0.185, 0.02);
    node_bootR_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_bootR_11.userData.sculptComponent = {"id": "bootR", "name": "Boot (right)", "level": "meso", "role": "foot", "importance": 0.7, "confidence": 0.7, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "A rounded-toe boot pointing +Z with a raised ankle collar. Built as a capsule body plus a toe cap rather than an extrusion: an extruded footprint is non-indexed, so its bevel steps cannot be smoothed and the toon ramp quantises them into rectangular patches (IDEA-057's measured trap).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legR", "attachment": {"parentSocket": "legR-socket", "parentId": "legR", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.185, 0.02], "contactType": "socket", "baseRadius": 0.0675, "endRadius": 0.0675, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.088, "height": 0.115, "depth": 0.135, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, -0.185, 0.02], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "crust", "materialLayers": ["crust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(194, 118, 31, 1.0)", "secondaryAlbedo": "rgba(227, 154, 58, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.85, "finish": "matte baked crumb", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_bootR_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["legR"] ?? root).add(node_bootR_11);
  nodes["bootR"] = node_bootR_11;
  const mesh_bootR_11Geometry = endpoint_bootR_11
    ? new THREE.CylinderGeometry(endpoint_bootR_11.endRadius, endpoint_bootR_11.baseRadius, endpoint_bootR_11.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_bootR_11) {
    mesh_bootR_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bootR_11 = new THREE.Mesh(
    mesh_bootR_11Geometry,
    materialMap["crust"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bootR_11.name = "Boot (right)";
  if (endpoint_bootR_11) {
    mesh_bootR_11.position.copy(endpoint_bootR_11.midpoint);
    mesh_bootR_11.quaternion.copy(endpoint_bootR_11.quaternion);
  }
  mesh_bootR_11.castShadow = options.castShadow ?? true;
  mesh_bootR_11.receiveShadow = options.receiveShadow ?? true;
  mesh_bootR_11.userData.sculptComponent = {"id": "bootR", "name": "Boot (right)", "level": "meso", "role": "foot", "importance": 0.7, "confidence": 0.7, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "A rounded-toe boot pointing +Z with a raised ankle collar. Built as a capsule body plus a toe cap rather than an extrusion: an extruded footprint is non-indexed, so its bevel steps cannot be smoothed and the toon ramp quantises them into rectangular patches (IDEA-057's measured trap).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legR", "attachment": {"parentSocket": "legR-socket", "parentId": "legR", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.185, 0.02], "contactType": "socket", "baseRadius": 0.0675, "endRadius": 0.0675, "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Parented to a named pivot Group. This project has no SkinnedMesh: a part whose whole extent lies under one pivot IS the (1,0,0,0) weight override, structurally rather than numerically."}, "dimensions": {"width": 0.088, "height": 0.115, "depth": 0.135, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, -0.185, 0.02], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "crust", "materialLayers": ["crust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(194, 118, 31, 1.0)", "secondaryAlbedo": "rgba(227, 154, 58, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.85, "finish": "matte baked crumb", "evidenceRefs": ["full-object", "palette-scan"], "note": "Mapped to the closest member of the fixed class list. The real class is baked crumb - porous, matte, non-metallic. 'stone' is the nearest; recorded, not hidden. Named tone, hand-authored to the project's shared 3-step toon ramp. The reference is flat vector art, so it is read to NAME the tone and never sampled into a shipped map."}};
  node_bootR_11.add(mesh_bootR_11);
  meshes["bootR"] = mesh_bootR_11;
  colliders["bootR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is ALREADY flat cel art, so unusually this ramp is not reinterpreting the reference - it is the same language, and the drawn tints map onto the ramp's own bands.", "palette": ["#f2d35a", "#c2761f", "#e3a154", "#5c2a22", "#fdfbf4", "#d9553f", "#5e8c2e", "#eee3c0", "#ef6d6a"], "paletteNote": "Named tones, not sampled pixels. At runtime the cheese plate takes the TEAM COLOUR, so the shipped hue differs from the yellow named here.", "responseTargets": ["the crust roll reads a clear step DARKER than the dough it sits on, at every team colour", "the plate reads flat - the reference gives it no highlight, only drawn tints", "the toppings read as raised even when their hue is close to the plate's team colour", "the white mitts stay the brightest thing on the model in every state including frightened"]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createPizzaSliceMascotLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Pizza Slice Mascot look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": [0.2592, 0.8639, 0.4319], "color": "#fff4e0", "intensity": 1.1, "colorNote": "NOT solved from the reference - nothing can be. The reference is flat vector art with no specular lobe, no gradient and no shadow, so there is no light to recover (evidence/image-analysis.md section 4). These are the DESTINATION rig's real lights, read out of src/render/scene.ts and src/game/themes.ts (garden palette), because that is the rig the model is reviewed and shipped under. Recording the destination rig is honest; recording a solve would not be.", "intensityNote": "Dominant. Above and to the camera's right; the only shadow caster (2048 map, bias -0.0005).", "exposureNote": "THREE.NoToneMapping, exposure 1.0. A filmic or ACES curve re-compresses the cel ramp's three bands into each other and undoes cel shading.", "shadowNote": "Casts the model's ground shadow. Authored castShadow flags are snapshotted by collectSpiritMats before the eaten state switches them off wholesale.", "confidence": 1.0}, {"id": "fill", "type": "hemisphere", "direction": [0.0, 1.0, 0.0], "sky": "#d8f0ff", "ground": "#4a3a20", "color": "#d8f0ff", "intensity": 0.65, "colorNote": "Cool sky over a warm soil bounce - the garden theme's own values.", "intensityNote": "Soft; the shadow sides never reach black, which the ramp's lowest band needs or the crust and the ink collapse into one silhouette.", "exposureNote": "Same NoToneMapping / exposure 1.0.", "shadowNote": "Hemisphere lights cast none.", "confidence": 1.0}, {"id": "rim", "type": "directional", "direction": [-0.4558, 0.5698, -0.6838], "color": "#aed4f0", "intensity": 0.35, "colorNote": "Soft sky-blue from the opposite side and a lower angle - daylight bounce, not a night rim.", "intensityNote": "Just enough to lift far faces off black. Matters more for this subject than for most: a triangle seen from behind is a thin edge, and the rim is what keeps the crust roll separable from the dough there.", "exposureNote": "Same NoToneMapping / exposure 1.0.", "shadowNote": "Deliberately casts none - a second shadow-casting light doubles the shadow-map cost for a subtle effect.", "confidence": 1.0}];
  lights.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is ALREADY flat cel art, so unusually this ramp is not reinterpreting the reference - it is the same language, and the drawn tints map onto the ramp's own bands.", "palette": ["#f2d35a", "#c2761f", "#e3a154", "#5c2a22", "#fdfbf4", "#d9553f", "#5e8c2e", "#eee3c0", "#ef6d6a"], "paletteNote": "Named tones, not sampled pixels. At runtime the cheese plate takes the TEAM COLOUR, so the shipped hue differs from the yellow named here.", "responseTargets": ["the crust roll reads a clear step DARKER than the dough it sits on, at every team colour", "the plate reads flat - the reference gives it no highlight, only drawn tints", "the toppings read as raised even when their hue is close to the plate's team colour", "the white mitts stay the brightest thing on the model in every state including frightened"]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createPizzaSliceMascotEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function framePizzaSliceMascotCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createPizzaSliceMascotPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configurePizzaSliceMascotRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createPizzaSliceMascotInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
