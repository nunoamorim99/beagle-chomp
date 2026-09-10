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

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
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

// Generated from ObjectSculptSpec target: Ebi Nigiri Mascot
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createEbiNigiriMascotModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Ebi Nigiri Mascot";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["prawn"] = createSculptMaterial(
    "prawn",
    {"id": "prawn", "name": "Prawn flesh", "family": "satin-fish-flesh", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f0803c", "color": "#f0803c", "albedo": {"dominant": "#f0803c", "secondary": ["#ffe9d6", "#d95f22"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f0803c", "#ffe9d6", "#d95f22"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.38, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#f0803c", "emissiveStrength": 0.15, "opacity": 1.0, "description": "The cap, the arms and the feet. THIS IS bodyMat - it takes the team colour and the frightened blue. The topping is the dominant SATURATED mass, and putting the team colour there is what makes this skin recolour in the opposite place from the maki, which repaints its wrapper. The two never converge on the same picture.", "localOverrides": [{"id": "prawn-lobe-banding", "kind": "linework", "description": "Six pale bands between seven transverse lobes. Their own material, kept OUT of accentMats - IDEA-053 rule 2: if they followed the frightened recolour the prawn would go plain exactly when the player is chasing it.", "channel": "baseColor", "region": "cap surface", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The cap, the arms and the feet. THIS IS bodyMat - it takes the team colour and the frightened blue. The topping is the dominant SATURATED mass, and putting the team colour there is what makes this skin recolour in the opposite place from the maki, which repaints its wrapper. The two never converge on the same picture.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["prawnBand"] = createSculptMaterial(
    "prawnBand",
    {"id": "prawnBand", "name": "Prawn pale band", "family": "satin-fish-flesh", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ffe9d6", "color": "#ffe9d6", "albedo": {"dominant": "#ffe9d6", "secondary": ["#f7d9c2"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ffe9d6", "#f7d9c2"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The pale banding between lobes. Same hue, very high value, low saturation. Fixed.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The pale banding between lobes. Same hue, very high value, low saturation. Fixed.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["rice"] = createSculptMaterial(
    "rice",
    {"id": "rice", "name": "Rice block / grain", "family": "satin-starch", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f7f2e6", "color": "#f7f2e6", "albedo": {"dominant": "#f7f2e6", "secondary": ["#e6dfcd", "#fffdf7"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f7f2e6", "#e6dfcd", "#fffdf7"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.35, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The block and every grain of the skirt. NEVER team-coloured and NOT in accentMats. It is the neutral the four team colours are all read against, and it is the mass the saturated cap has to sit on to read as two masses at all.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The block and every grain of the skirt. NEVER team-coloured and NOT in accentMats. It is the neutral the four team colours are all read against, and it is the mass the saturated cap has to sit on to read as two masses at all.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["nori"] = createSculptMaterial(
    "nori",
    {"id": "nori", "name": "Nori belt", "family": "gloss-dielectric-sheet", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#242a30", "color": "#242a30", "albedo": {"dominant": "#242a30", "secondary": ["#39424b"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#242a30", "#39424b"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The belt. The strongest value contrast on the subject and the only dark thing on it. FIXED and out of accentMats: it is the line that separates the block's two halves, and the frightened state is exactly when it must still be there.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The belt. The strongest value contrast on the subject and the only dark thing on it. FIXED and out of accentMats: it is the line that separates the block's two halves, and the frightened state is exactly when it must still be there.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["blush"] = createSculptMaterial(
    "blush",
    {"id": "blush", "name": "Blush disc", "family": "matte-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f2938c", "color": "#f2938c", "albedo": {"dominant": "#f2938c", "secondary": [], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f2938c"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.85, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Warm desaturated pink, completely flat - the reference gives it no highlight at all. The one face feature the maki has no counterpart for.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Warm desaturated pink, completely flat - the reference gives it no highlight at all. The one face feature the maki has no counterpart for.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["eyeDark"] = createSculptMaterial(
    "eyeDark",
    {"id": "eyeDark", "name": "Eye mass", "family": "gloss-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#2b1d16", "color": "#2b1d16", "albedo": {"dominant": "#2b1d16", "secondary": ["#000000"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#2b1d16", "#000000"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.2, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The half-lidded eye. This is pupM: applyGhostState paints it white while frightened and restores pupBaseColor otherwise.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The half-lidded eye. This is pupM: applyGhostState paints it white while frightened and restores pupBaseColor otherwise.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["lid"] = createSculptMaterial(
    "lid",
    {"id": "lid", "name": "Upper lid line", "family": "satin-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#c98b3f", "color": "#c98b3f", "albedo": {"dominant": "#c98b3f", "secondary": [], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#c98b3f"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The warm gold line over each eye - what makes the eye read as half-LIDDED rather than small.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The warm gold line over each eye - what makes the eye read as half-LIDDED rather than small.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["glint"] = createSculptMaterial(
    "glint",
    {"id": "glint", "name": "Specular catchlight", "family": "unlit", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#ffffff", "secondary": ["#ffffff"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ffffff", "#ffffff"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.0, "variation": 0.1, "map": null, "note": "Fully emissive; it has no meaningful lighting response, which is the point of it."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "A fully emissive toon, the enemy cast's standing answer for a catchlight: GhostUserData.eyeMats is typed MeshToonMaterial, so a true MeshBasicMaterial cannot go in the list of materials kept solid through the eaten state.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "A fully emissive toon, the enemy cast's standing answer for a catchlight: GhostUserData.eyeMats is typed MeshToonMaterial, so a true MeshBasicMaterial cannot go in the list of materials kept solid through the eaten state.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["mouth"] = createSculptMaterial(
    "mouth",
    {"id": "mouth", "name": "Mouth curve", "family": "matte-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#8a4a33", "color": "#8a4a33", "albedo": {"dominant": "#8a4a33", "secondary": [], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#8a4a33"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "A closed curve, not an aperture. The maki's mouth is an open cavity; two sushi with the same mouth would be one character in two hats.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "A closed curve, not an aperture. The maki's mouth is an open cavity; two sushi with the same mouth would be one character in two hats.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Ebi nigiri mascot (root)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Ebi nigiri mascot (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The assembly root. syncToEntity owns its rotation.y/z and position; applyGhostState owns its rotation.x, so nothing may author rotation.x here.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 242, 230, 1.0)", "secondaryAlbedo": "rgba(230, 223, 205, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": null, "attachment": null, "dimensions": {"width": 0.69, "height": 0.86, "depth": 0.46, "units": "world", "confidence": 0.95}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "rice", "materialLayers": ["rice"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "two-mass-stack", "description": "A pale block carrying a saturated lobed cap. This is the nigiri read and it is what separates the skin from the maki at any distance: that one is a round, dark, single mass.", "identityRank": 1, "confidence": 0.95, "evidenceRefs": ["full-object"]}]};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
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
    materialMap["rice"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Ebi nigiri mascot (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Ebi nigiri mascot (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The assembly root. syncToEntity owns its rotation.y/z and position; applyGhostState owns its rotation.x, so nothing may author rotation.x here.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 242, 230, 1.0)", "secondaryAlbedo": "rgba(230, 223, 205, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": null, "attachment": null, "dimensions": {"width": 0.69, "height": 0.86, "depth": 0.46, "units": "world", "confidence": 0.95}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "rice", "materialLayers": ["rice"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "two-mass-stack", "description": "A pale block carrying a saturated lobed cap. This is the nigiri read and it is what separates the skin from the maki at any distance: that one is a round, dark, single mass.", "identityRank": 1, "confidence": 0.95, "evidenceRefs": ["full-object"]}]};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_riceBlock_1 = makeAttachmentEndpoint(null);
  const node_riceBlock_1 = new THREE.Group();
  node_riceBlock_1.name = "Rice block__pivot";
  node_riceBlock_1.scale.set(1, 1, 1);
  if (endpoint_riceBlock_1) {
    node_riceBlock_1.position.copy(endpoint_riceBlock_1.start);
    node_riceBlock_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_riceBlock_1.position.set(0.0, 0.29400000000000004, 0.0);
    node_riceBlock_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_riceBlock_1.userData.sculptComponent = {"id": "riceBlock", "name": "Rice block", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A squircle FOOTPRINT (X by Z) extruded along Y with a heavy bevel - a pillow, not a box. The footprint is extruded rather than the front face so the nori belt can be built from the same outline and can therefore never disagree with it.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 242, 230, 1.0)", "secondaryAlbedo": "rgba(230, 223, 205, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.56, "height": 0.45472000000000007, "depth": 0.4032, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.29400000000000004, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "rice", "materialLayers": ["rice"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pale-dominant-mass", "description": "The block is the largest mass and it stays off the recolour, so the subject reads pale at every team colour - the opposite of the maki.", "identityRank": 1, "confidence": 0.9, "evidenceRefs": ["full-object"]}, {"id": "smooth-face-panel", "description": "One rectangle of the block's front is left SMOOTH while the rest is covered in grains. Grains across the face would bury every feature on it; grains nowhere and the block is a bar of soap.", "identityRank": 4, "confidence": 0.85, "evidenceRefs": ["full-object"]}]};
  node_riceBlock_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_riceBlock_1);
  nodes["riceBlock"] = node_riceBlock_1;
  const mesh_riceBlock_1Geometry = endpoint_riceBlock_1
    ? new THREE.CylinderGeometry(endpoint_riceBlock_1.endRadius, endpoint_riceBlock_1.baseRadius, endpoint_riceBlock_1.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_riceBlock_1) {
    mesh_riceBlock_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_riceBlock_1 = new THREE.Mesh(
    mesh_riceBlock_1Geometry,
    materialMap["rice"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_riceBlock_1.name = "Rice block";
  if (endpoint_riceBlock_1) {
    mesh_riceBlock_1.position.copy(endpoint_riceBlock_1.midpoint);
    mesh_riceBlock_1.quaternion.copy(endpoint_riceBlock_1.quaternion);
  }
  mesh_riceBlock_1.castShadow = options.castShadow ?? true;
  mesh_riceBlock_1.receiveShadow = options.receiveShadow ?? true;
  mesh_riceBlock_1.userData.sculptComponent = {"id": "riceBlock", "name": "Rice block", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A squircle FOOTPRINT (X by Z) extruded along Y with a heavy bevel - a pillow, not a box. The footprint is extruded rather than the front face so the nori belt can be built from the same outline and can therefore never disagree with it.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 242, 230, 1.0)", "secondaryAlbedo": "rgba(230, 223, 205, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.56, "height": 0.45472000000000007, "depth": 0.4032, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.29400000000000004, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "rice", "materialLayers": ["rice"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pale-dominant-mass", "description": "The block is the largest mass and it stays off the recolour, so the subject reads pale at every team colour - the opposite of the maki.", "identityRank": 1, "confidence": 0.9, "evidenceRefs": ["full-object"]}, {"id": "smooth-face-panel", "description": "One rectangle of the block's front is left SMOOTH while the rest is covered in grains. Grains across the face would bury every feature on it; grains nowhere and the block is a bar of soap.", "identityRank": 4, "confidence": 0.85, "evidenceRefs": ["full-object"]}]};
  node_riceBlock_1.add(mesh_riceBlock_1);
  meshes["riceBlock"] = mesh_riceBlock_1;
  colliders["riceBlock"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_prawnCap_2 = makeAttachmentEndpoint(null);
  const node_prawnCap_2 = new THREE.Group();
  node_prawnCap_2.name = "Prawn cap__pivot";
  node_prawnCap_2.scale.set(1, 1, 1);
  if (endpoint_prawnCap_2) {
    node_prawnCap_2.position.copy(endpoint_prawnCap_2.start);
    node_prawnCap_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_prawnCap_2.position.set(0.0, 0.22736000000000003, 0.0);
    node_prawnCap_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_prawnCap_2.userData.sculptComponent = {"id": "prawnCap", "name": "Prawn cap", "level": "macro", "role": "shell", "importance": 0.95, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved profile swept along Z whose radius OSCILLATES seven times, so the lobes are in the silhouette and not only in the paint. Built as one surface with per-triangle material groups assigned by RING index - never by a triangle's own mean, which puts the two halves of every quad on opposite sides of a boundary and zigzags the band edge (IDEA-055 rule 3).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "overlap", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.07, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.60424, "height": 0.2604, "depth": 0.42336, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.22736000000000003, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn", "prawnBand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "prawn-not-salmon", "description": "Seven transverse lobes with pale bands between them. A salmon slice is one smooth mass with irregular marbling; getting this wrong makes a smooth orange pillow and loses the topping's whole identity.", "identityRank": 2, "confidence": 0.85, "evidenceRefs": ["full-object"]}, {"id": "cap-overhangs-block", "description": "The cap is 1.079 RW across against a 1.000 RW block, so it hangs past both flanks. It is draped over the block, not seated in it.", "identityRank": 3, "confidence": 0.85, "evidenceRefs": ["full-object"]}]};
  node_prawnCap_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["riceBlock"] ?? root).add(node_prawnCap_2);
  nodes["prawnCap"] = node_prawnCap_2;
  const mesh_prawnCap_2Geometry = endpoint_prawnCap_2
    ? new THREE.CylinderGeometry(endpoint_prawnCap_2.endRadius, endpoint_prawnCap_2.baseRadius, endpoint_prawnCap_2.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_prawnCap_2) {
    mesh_prawnCap_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_prawnCap_2 = new THREE.Mesh(
    mesh_prawnCap_2Geometry,
    materialMap["prawn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_prawnCap_2.name = "Prawn cap";
  if (endpoint_prawnCap_2) {
    mesh_prawnCap_2.position.copy(endpoint_prawnCap_2.midpoint);
    mesh_prawnCap_2.quaternion.copy(endpoint_prawnCap_2.quaternion);
  }
  mesh_prawnCap_2.castShadow = options.castShadow ?? true;
  mesh_prawnCap_2.receiveShadow = options.receiveShadow ?? true;
  mesh_prawnCap_2.userData.sculptComponent = {"id": "prawnCap", "name": "Prawn cap", "level": "macro", "role": "shell", "importance": 0.95, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved profile swept along Z whose radius OSCILLATES seven times, so the lobes are in the silhouette and not only in the paint. Built as one surface with per-triangle material groups assigned by RING index - never by a triangle's own mean, which puts the two halves of every quad on opposite sides of a boundary and zigzags the band edge (IDEA-055 rule 3).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "overlap", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.07, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.60424, "height": 0.2604, "depth": 0.42336, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.22736000000000003, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn", "prawnBand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "prawn-not-salmon", "description": "Seven transverse lobes with pale bands between them. A salmon slice is one smooth mass with irregular marbling; getting this wrong makes a smooth orange pillow and loses the topping's whole identity.", "identityRank": 2, "confidence": 0.85, "evidenceRefs": ["full-object"]}, {"id": "cap-overhangs-block", "description": "The cap is 1.079 RW across against a 1.000 RW block, so it hangs past both flanks. It is draped over the block, not seated in it.", "identityRank": 3, "confidence": 0.85, "evidenceRefs": ["full-object"]}]};
  node_prawnCap_2.add(mesh_prawnCap_2);
  meshes["prawnCap"] = mesh_prawnCap_2;
  colliders["prawnCap"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_noriBelt_3 = makeAttachmentEndpoint(null);
  const node_noriBelt_3 = new THREE.Group();
  node_noriBelt_3.name = "Nori belt__pivot";
  node_noriBelt_3.scale.set(1, 1, 1);
  if (endpoint_noriBelt_3) {
    node_noriBelt_3.position.copy(endpoint_noriBelt_3.start);
    node_noriBelt_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_noriBelt_3.position.set(0.0, 0.022281280000000004, 0.0);
    node_noriBelt_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_noriBelt_3.userData.sculptComponent = {"id": "noriBelt", "name": "Nori belt", "level": "meso", "role": "shell", "importance": 0.85, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A closed wall around the block: the block's own squircle footprint scaled out, with the unscaled footprint as a HOLE, extruded along Y. Sharing the outline is what stops the belt floating off a flank the way a scaled box would.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 42, 48, 1.0)", "secondaryAlbedo": "rgba(57, 66, 75, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "gloss toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "overlap", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.008, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.5768000000000001, "height": 0.12208000000000001, "depth": 0.415296, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.022281280000000004, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belt-is-the-only-dark", "description": "The strongest value contrast on the subject, and the line that separates the block's two halves. Out of accentMats, so the frightened state cannot erase it.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["full-object"]}]};
  node_noriBelt_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["riceBlock"] ?? root).add(node_noriBelt_3);
  nodes["noriBelt"] = node_noriBelt_3;
  const mesh_noriBelt_3Geometry = endpoint_noriBelt_3
    ? new THREE.CylinderGeometry(endpoint_noriBelt_3.endRadius, endpoint_noriBelt_3.baseRadius, endpoint_noriBelt_3.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_noriBelt_3) {
    mesh_noriBelt_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_noriBelt_3 = new THREE.Mesh(
    mesh_noriBelt_3Geometry,
    materialMap["nori"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_noriBelt_3.name = "Nori belt";
  if (endpoint_noriBelt_3) {
    mesh_noriBelt_3.position.copy(endpoint_noriBelt_3.midpoint);
    mesh_noriBelt_3.quaternion.copy(endpoint_noriBelt_3.quaternion);
  }
  mesh_noriBelt_3.castShadow = options.castShadow ?? true;
  mesh_noriBelt_3.receiveShadow = options.receiveShadow ?? true;
  mesh_noriBelt_3.userData.sculptComponent = {"id": "noriBelt", "name": "Nori belt", "level": "meso", "role": "shell", "importance": 0.85, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A closed wall around the block: the block's own squircle footprint scaled out, with the unscaled footprint as a HOLE, extruded along Y. Sharing the outline is what stops the belt floating off a flank the way a scaled box would.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 42, 48, 1.0)", "secondaryAlbedo": "rgba(57, 66, 75, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "gloss toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "overlap", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.008, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.5768000000000001, "height": 0.12208000000000001, "depth": 0.415296, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.022281280000000004, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belt-is-the-only-dark", "description": "The strongest value contrast on the subject, and the line that separates the block's two halves. Out of accentMats, so the frightened state cannot erase it.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["full-object"]}]};
  node_noriBelt_3.add(mesh_noriBelt_3);
  meshes["noriBelt"] = mesh_noriBelt_3;
  colliders["noriBelt"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_armL_4 = {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""};
  const endpoint_armL_4 = makeAttachmentEndpoint(attachment_armL_4);
  const node_armL_4 = new THREE.Group();
  node_armL_4.name = "Arm, left__pivot";
  node_armL_4.scale.set(1, 1, 1);
  if (endpoint_armL_4) {
    node_armL_4.position.copy(endpoint_armL_4.start);
    node_armL_4.rotation.set(0.0, 0.0, 18.0);
  } else {
    node_armL_4.position.set(0.26880000000000004, -0.013641600000000002, 0.02);
    node_armL_4.rotation.set(0.0, 0.0, 18.0);
  }
  node_armL_4.userData.sculptComponent = {"id": "armL", "name": "Arm, left", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A short tapered cone from the block's flank at the belt line, out and slightly down. Shares the cap's material, so it takes the team colour with it - which is what the reference shows and what keeps the recolour coherent.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.1736, "height": 0.0504, "depth": 0.0504, "units": "world", "confidence": 0.75}, "transform": {"position": [0.26880000000000004, -0.013641600000000002, 0.02], "rotation": [0.0, 0.0, 18.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armL_4.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["riceBlock"] ?? root).add(node_armL_4);
  nodes["armL"] = node_armL_4;
  const mesh_armL_4Geometry = endpoint_armL_4
    ? new THREE.CylinderGeometry(endpoint_armL_4.endRadius, endpoint_armL_4.baseRadius, endpoint_armL_4.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_armL_4) {
    mesh_armL_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armL_4 = new THREE.Mesh(
    mesh_armL_4Geometry,
    materialMap["prawn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armL_4.name = "Arm, left";
  if (endpoint_armL_4) {
    mesh_armL_4.position.copy(endpoint_armL_4.midpoint);
    mesh_armL_4.quaternion.copy(endpoint_armL_4.quaternion);
  }
  mesh_armL_4.castShadow = options.castShadow ?? true;
  mesh_armL_4.receiveShadow = options.receiveShadow ?? true;
  mesh_armL_4.userData.sculptComponent = {"id": "armL", "name": "Arm, left", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A short tapered cone from the block's flank at the belt line, out and slightly down. Shares the cap's material, so it takes the team colour with it - which is what the reference shows and what keeps the recolour coherent.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.1736, "height": 0.0504, "depth": 0.0504, "units": "world", "confidence": 0.75}, "transform": {"position": [0.26880000000000004, -0.013641600000000002, 0.02], "rotation": [0.0, 0.0, 18.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armL_4.add(mesh_armL_4);
  meshes["armL"] = mesh_armL_4;
  colliders["armL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_footL_5 = makeAttachmentEndpoint(null);
  const node_footL_5 = new THREE.Group();
  node_footL_5.name = "Foot, left__pivot";
  node_footL_5.scale.set(1, 1, 1);
  if (endpoint_footL_5) {
    node_footL_5.position.copy(endpoint_footL_5.start);
    node_footL_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_footL_5.position.set(0.084, 0.06664, 0.03);
    node_footL_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_footL_5.userData.sculptComponent = {"id": "footL", "name": "Foot, left", "level": "macro", "role": "limb", "importance": 0.55, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A short splayed foot under the block. Bare - no boot, unlike the maki.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.02, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.0728, "height": 0.06664, "depth": 0.09520000000000002, "units": "world", "confidence": 0.7}, "transform": {"position": [0.084, 0.06664, 0.03], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bare-feet", "description": "Short splayed feet in the prawn's own colour, with no boot. The maki wears oversized white boots; a shared foot would cost one of the seven measured separators between the two skins.", "identityRank": 8, "confidence": 0.7, "evidenceRefs": ["full-object"]}]};
  node_footL_5.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_footL_5);
  nodes["footL"] = node_footL_5;
  const mesh_footL_5Geometry = endpoint_footL_5
    ? new THREE.CylinderGeometry(endpoint_footL_5.endRadius, endpoint_footL_5.baseRadius, endpoint_footL_5.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_footL_5) {
    mesh_footL_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_footL_5 = new THREE.Mesh(
    mesh_footL_5Geometry,
    materialMap["prawn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_footL_5.name = "Foot, left";
  if (endpoint_footL_5) {
    mesh_footL_5.position.copy(endpoint_footL_5.midpoint);
    mesh_footL_5.quaternion.copy(endpoint_footL_5.quaternion);
  }
  mesh_footL_5.castShadow = options.castShadow ?? true;
  mesh_footL_5.receiveShadow = options.receiveShadow ?? true;
  mesh_footL_5.userData.sculptComponent = {"id": "footL", "name": "Foot, left", "level": "macro", "role": "limb", "importance": 0.55, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A short splayed foot under the block. Bare - no boot, unlike the maki.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.02, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.0728, "height": 0.06664, "depth": 0.09520000000000002, "units": "world", "confidence": 0.7}, "transform": {"position": [0.084, 0.06664, 0.03], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bare-feet", "description": "Short splayed feet in the prawn's own colour, with no boot. The maki wears oversized white boots; a shared foot would cost one of the seven measured separators between the two skins.", "identityRank": 8, "confidence": 0.7, "evidenceRefs": ["full-object"]}]};
  node_footL_5.add(mesh_footL_5);
  meshes["footL"] = mesh_footL_5;
  colliders["footL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_armR_6 = {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""};
  const endpoint_armR_6 = makeAttachmentEndpoint(attachment_armR_6);
  const node_armR_6 = new THREE.Group();
  node_armR_6.name = "Arm, right__pivot";
  node_armR_6.scale.set(1, 1, 1);
  if (endpoint_armR_6) {
    node_armR_6.position.copy(endpoint_armR_6.start);
    node_armR_6.rotation.set(0.0, 0.0, -18.0);
  } else {
    node_armR_6.position.set(-0.26880000000000004, -0.013641600000000002, 0.02);
    node_armR_6.rotation.set(0.0, 0.0, -18.0);
  }
  node_armR_6.userData.sculptComponent = {"id": "armR", "name": "Arm, right", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A short tapered cone from the block's flank at the belt line, out and slightly down. Shares the cap's material, so it takes the team colour with it - which is what the reference shows and what keeps the recolour coherent.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.1736, "height": 0.0504, "depth": 0.0504, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.26880000000000004, -0.013641600000000002, 0.02], "rotation": [0.0, 0.0, -18.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armR_6.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["riceBlock"] ?? root).add(node_armR_6);
  nodes["armR"] = node_armR_6;
  const mesh_armR_6Geometry = endpoint_armR_6
    ? new THREE.CylinderGeometry(endpoint_armR_6.endRadius, endpoint_armR_6.baseRadius, endpoint_armR_6.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_armR_6) {
    mesh_armR_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armR_6 = new THREE.Mesh(
    mesh_armR_6Geometry,
    materialMap["prawn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armR_6.name = "Arm, right";
  if (endpoint_armR_6) {
    mesh_armR_6.position.copy(endpoint_armR_6.midpoint);
    mesh_armR_6.quaternion.copy(endpoint_armR_6.quaternion);
  }
  mesh_armR_6.castShadow = options.castShadow ?? true;
  mesh_armR_6.receiveShadow = options.receiveShadow ?? true;
  mesh_armR_6.userData.sculptComponent = {"id": "armR", "name": "Arm, right", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.75, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A short tapered cone from the block's flank at the belt line, out and slightly down. Shares the cap's material, so it takes the team colour with it - which is what the reference shows and what keeps the recolour coherent.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "riceBlock", "attachment": {"parentSocket": "riceBlock-socket", "parentId": "riceBlock", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.1736, "height": 0.0504, "depth": 0.0504, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.26880000000000004, -0.013641600000000002, 0.02], "rotation": [0.0, 0.0, -18.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armR_6.add(mesh_armR_6);
  meshes["armR"] = mesh_armR_6;
  colliders["armR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_footR_7 = makeAttachmentEndpoint(null);
  const node_footR_7 = new THREE.Group();
  node_footR_7.name = "Foot, right__pivot";
  node_footR_7.scale.set(1, 1, 1);
  if (endpoint_footR_7) {
    node_footR_7.position.copy(endpoint_footR_7.start);
    node_footR_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_footR_7.position.set(-0.084, 0.06664, 0.03);
    node_footR_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_footR_7.userData.sculptComponent = {"id": "footR", "name": "Foot, right", "level": "macro", "role": "limb", "importance": 0.55, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A short splayed foot under the block. Bare - no boot, unlike the maki.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.02, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.0728, "height": 0.06664, "depth": 0.09520000000000002, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.084, 0.06664, 0.03], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bare-feet-r", "description": "Short splayed feet in the prawn's own colour, with no boot. The maki wears oversized white boots; a shared foot would cost one of the seven measured separators between the two skins.", "identityRank": 8, "confidence": 0.7, "evidenceRefs": ["full-object"]}]};
  node_footR_7.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_footR_7);
  nodes["footR"] = node_footR_7;
  const mesh_footR_7Geometry = endpoint_footR_7
    ? new THREE.CylinderGeometry(endpoint_footR_7.endRadius, endpoint_footR_7.baseRadius, endpoint_footR_7.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_footR_7) {
    mesh_footR_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_footR_7 = new THREE.Mesh(
    mesh_footR_7Geometry,
    materialMap["prawn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_footR_7.name = "Foot, right";
  if (endpoint_footR_7) {
    mesh_footR_7.position.copy(endpoint_footR_7.midpoint);
    mesh_footR_7.quaternion.copy(endpoint_footR_7.quaternion);
  }
  mesh_footR_7.castShadow = options.castShadow ?? true;
  mesh_footR_7.receiveShadow = options.receiveShadow ?? true;
  mesh_footR_7.userData.sculptComponent = {"id": "footR", "name": "Foot, right", "level": "macro", "role": "limb", "importance": 0.55, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A short splayed foot under the block. Bare - no boot, unlike the maki.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 128, 60, 1.0)", "secondaryAlbedo": "rgba(217, 95, 34, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.02, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.0728, "height": 0.06664, "depth": 0.09520000000000002, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.084, 0.06664, 0.03], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "prawn", "materialLayers": ["prawn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bare-feet-r", "description": "Short splayed feet in the prawn's own colour, with no boot. The maki wears oversized white boots; a shared foot would cost one of the seven measured separators between the two skins.", "identityRank": 8, "confidence": 0.7, "evidenceRefs": ["full-object"]}]};
  node_footR_7.add(mesh_footR_7);
  meshes["footR"] = mesh_footR_7;
  colliders["footR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  // PLAN_1.5 WS-C slice 1: bone hierarchy from spec.rig. Model-space joints are
  // converted to parent-local offsets here. Nothing is bound yet (rig.bound === false).
  const bones: Record<string, THREE.Bone> = {};
  const boneOrder: string[] = [];
  const bone_pelvis = new THREE.Bone();
  bone_pelvis.name = "pelvis";
  bone_pelvis.position.set(0.0, -0.182, 0.0);
  root.add(bone_pelvis);
  bones["pelvis"] = bone_pelvis;
  boneOrder.push("pelvis");
  const bone_abdomen = new THREE.Bone();
  bone_abdomen.name = "abdomen";
  bone_abdomen.position.set(0.0, 0.027999999999999997, 0.0);
  bone_pelvis.add(bone_abdomen);
  bones["abdomen"] = bone_abdomen;
  boneOrder.push("abdomen");
  const bone_chest = new THREE.Bone();
  bone_chest.name = "chest";
  bone_chest.position.set(0.0, 0.25872, 0.0028);
  bone_abdomen.add(bone_chest);
  bones["chest"] = bone_chest;
  boneOrder.push("chest");
  const bone_clavicle_l = new THREE.Bone();
  bone_clavicle_l.name = "clavicle-l";
  bone_clavicle_l.position.set(0.05152, 0.34048, 0.005599999999999999);
  bone_chest.add(bone_clavicle_l);
  bones["clavicle-l"] = bone_clavicle_l;
  boneOrder.push("clavicle-l");
  const bone_clavicle_r = new THREE.Bone();
  bone_clavicle_r.name = "clavicle-r";
  bone_clavicle_r.position.set(-0.05152, 0.34048, 0.005599999999999999);
  bone_chest.add(bone_clavicle_r);
  bones["clavicle-r"] = bone_clavicle_r;
  boneOrder.push("clavicle-r");
  const bone_thigh_l = new THREE.Bone();
  bone_thigh_l.name = "thigh-l";
  bone_thigh_l.position.set(0.1428, -0.12880000000000003, 0.0056);
  bone_pelvis.add(bone_thigh_l);
  bones["thigh-l"] = bone_thigh_l;
  boneOrder.push("thigh-l");
  const bone_shin_l = new THREE.Bone();
  bone_shin_l.name = "shin-l";
  bone_shin_l.position.set(0.0, -0.53424, 0.0);
  bone_thigh_l.add(bone_shin_l);
  bones["shin-l"] = bone_shin_l;
  boneOrder.push("shin-l");
  const bone_foot_l = new THREE.Bone();
  bone_foot_l.name = "foot-l";
  bone_foot_l.position.set(0.0, -0.48775999999999997, 0.0392);
  bone_shin_l.add(bone_foot_l);
  bones["foot-l"] = bone_foot_l;
  boneOrder.push("foot-l");
  const bone_thigh_r = new THREE.Bone();
  bone_thigh_r.name = "thigh-r";
  bone_thigh_r.position.set(-0.1428, -0.12880000000000003, 0.0056);
  bone_pelvis.add(bone_thigh_r);
  bones["thigh-r"] = bone_thigh_r;
  boneOrder.push("thigh-r");
  const bone_shin_r = new THREE.Bone();
  bone_shin_r.name = "shin-r";
  bone_shin_r.position.set(0.0, -0.53424, 0.0);
  bone_thigh_r.add(bone_shin_r);
  bones["shin-r"] = bone_shin_r;
  boneOrder.push("shin-r");
  const bone_foot_r = new THREE.Bone();
  bone_foot_r.name = "foot-r";
  bone_foot_r.position.set(0.0, -0.48775999999999997, 0.0392);
  bone_shin_r.add(bone_foot_r);
  bones["foot-r"] = bone_foot_r;
  boneOrder.push("foot-r");
  const bone_upper_arm_l = new THREE.Bone();
  bone_upper_arm_l.name = "upper-arm-l";
  bone_upper_arm_l.position.set(0.27048, -0.005599999999999994, 0.005600000000000001);
  bone_clavicle_l.add(bone_upper_arm_l);
  bones["upper-arm-l"] = bone_upper_arm_l;
  boneOrder.push("upper-arm-l");
  const bone_forearm_l = new THREE.Bone();
  bone_forearm_l.name = "forearm-l";
  bone_forearm_l.position.set(0.06394, -0.31544, 0.0);
  bone_upper_arm_l.add(bone_forearm_l);
  bones["forearm-l"] = bone_forearm_l;
  boneOrder.push("forearm-l");
  const bone_upper_arm_r = new THREE.Bone();
  bone_upper_arm_r.name = "upper-arm-r";
  bone_upper_arm_r.position.set(-0.27048, -0.005599999999999994, 0.005600000000000001);
  bone_clavicle_r.add(bone_upper_arm_r);
  bones["upper-arm-r"] = bone_upper_arm_r;
  boneOrder.push("upper-arm-r");
  const bone_forearm_r = new THREE.Bone();
  bone_forearm_r.name = "forearm-r";
  bone_forearm_r.position.set(-0.06394, -0.31544, 0.0);
  bone_upper_arm_r.add(bone_forearm_r);
  bones["forearm-r"] = bone_forearm_r;
  boneOrder.push("forearm-r");
  const bone_hand_l = new THREE.Bone();
  bone_hand_l.name = "hand-l";
  bone_hand_l.position.set(0.03688999999999998, -0.30593, 0.0);
  bone_forearm_l.add(bone_hand_l);
  bones["hand-l"] = bone_hand_l;
  boneOrder.push("hand-l");
  const bone_hand_r = new THREE.Bone();
  bone_hand_r.name = "hand-r";
  bone_hand_r.position.set(-0.03688999999999998, -0.30593, 0.0);
  bone_forearm_r.add(bone_hand_r);
  bones["hand-r"] = bone_hand_r;
  boneOrder.push("hand-r");
  const bone_neck = new THREE.Bone();
  bone_neck.name = "neck";
  bone_neck.position.set(0.0, 0.33488, 0.0028);
  bone_chest.add(bone_neck);
  bones["neck"] = bone_neck;
  boneOrder.push("neck");
  const bone_head = new THREE.Bone();
  bone_head.name = "head";
  bone_head.position.set(0.0, 0.238, 0.0);
  bone_neck.add(bone_head);
  bones["head"] = bone_head;
  boneOrder.push("head");
  const bone_index_l_1 = new THREE.Bone();
  bone_index_l_1.name = "index-l-1";
  bone_index_l_1.position.set(-0.020999999999999963, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_l.add(bone_index_l_1);
  bones["index-l-1"] = bone_index_l_1;
  boneOrder.push("index-l-1");
  const bone_index_l_2 = new THREE.Bone();
  bone_index_l_2.name = "index-l-2";
  bone_index_l_2.position.set(0.0035199999999999676, -0.029189999999999994, 0.0);
  bone_index_l_1.add(bone_index_l_2);
  bones["index-l-2"] = bone_index_l_2;
  boneOrder.push("index-l-2");
  const bone_index_l_3 = new THREE.Bone();
  bone_index_l_3.name = "index-l-3";
  bone_index_l_3.position.set(0.0024100000000000232, -0.02001, 0.0);
  bone_index_l_2.add(bone_index_l_3);
  bones["index-l-3"] = bone_index_l_3;
  boneOrder.push("index-l-3");
  const bone_index_r_1 = new THREE.Bone();
  bone_index_r_1.name = "index-r-1";
  bone_index_r_1.position.set(0.020999999999999963, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_r.add(bone_index_r_1);
  bones["index-r-1"] = bone_index_r_1;
  boneOrder.push("index-r-1");
  const bone_index_r_2 = new THREE.Bone();
  bone_index_r_2.name = "index-r-2";
  bone_index_r_2.position.set(-0.0035199999999999676, -0.029189999999999994, 0.0);
  bone_index_r_1.add(bone_index_r_2);
  bones["index-r-2"] = bone_index_r_2;
  boneOrder.push("index-r-2");
  const bone_index_r_3 = new THREE.Bone();
  bone_index_r_3.name = "index-r-3";
  bone_index_r_3.position.set(-0.0024100000000000232, -0.02001, 0.0);
  bone_index_r_2.add(bone_index_r_3);
  bones["index-r-3"] = bone_index_r_3;
  boneOrder.push("index-r-3");
  const bone_little_l_1 = new THREE.Bone();
  bone_little_l_1.name = "little-l-1";
  bone_little_l_1.position.set(0.019600000000000006, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_l.add(bone_little_l_1);
  bones["little-l-1"] = bone_little_l_1;
  boneOrder.push("little-l-1");
  const bone_little_l_2 = new THREE.Bone();
  bone_little_l_2.name = "little-l-2";
  bone_little_l_2.position.set(0.0026800000000000157, -0.022239999999999982, 0.0);
  bone_little_l_1.add(bone_little_l_2);
  bones["little-l-2"] = bone_little_l_2;
  boneOrder.push("little-l-2");
  const bone_little_l_3 = new THREE.Bone();
  bone_little_l_3.name = "little-l-3";
  bone_little_l_3.position.set(0.0019500000000000073, -0.016119999999999995, 0.0);
  bone_little_l_2.add(bone_little_l_3);
  bones["little-l-3"] = bone_little_l_3;
  boneOrder.push("little-l-3");
  const bone_little_r_1 = new THREE.Bone();
  bone_little_r_1.name = "little-r-1";
  bone_little_r_1.position.set(-0.019600000000000006, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_r.add(bone_little_r_1);
  bones["little-r-1"] = bone_little_r_1;
  boneOrder.push("little-r-1");
  const bone_little_r_2 = new THREE.Bone();
  bone_little_r_2.name = "little-r-2";
  bone_little_r_2.position.set(-0.0026800000000000157, -0.022239999999999982, 0.0);
  bone_little_r_1.add(bone_little_r_2);
  bones["little-r-2"] = bone_little_r_2;
  boneOrder.push("little-r-2");
  const bone_little_r_3 = new THREE.Bone();
  bone_little_r_3.name = "little-r-3";
  bone_little_r_3.position.set(-0.0019500000000000073, -0.016119999999999995, 0.0);
  bone_little_r_2.add(bone_little_r_3);
  bones["little-r-3"] = bone_little_r_3;
  boneOrder.push("little-r-3");
  const bone_middle_l_1 = new THREE.Bone();
  bone_middle_l_1.name = "middle-l-1";
  bone_middle_l_1.position.set(-0.007000000000000006, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_l.add(bone_middle_l_1);
  bones["middle-l-1"] = bone_middle_l_1;
  boneOrder.push("middle-l-1");
  const bone_middle_l_2 = new THREE.Bone();
  bone_middle_l_2.name = "middle-l-2";
  bone_middle_l_2.position.set(0.00386000000000003, -0.03196999999999997, 0.0);
  bone_middle_l_1.add(bone_middle_l_2);
  bones["middle-l-2"] = bone_middle_l_2;
  boneOrder.push("middle-l-2");
  const bone_middle_l_3 = new THREE.Bone();
  bone_middle_l_3.name = "middle-l-3";
  bone_middle_l_3.position.set(0.0026800000000000157, -0.022240000000000038, 0.0);
  bone_middle_l_2.add(bone_middle_l_3);
  bones["middle-l-3"] = bone_middle_l_3;
  boneOrder.push("middle-l-3");
  const bone_middle_r_1 = new THREE.Bone();
  bone_middle_r_1.name = "middle-r-1";
  bone_middle_r_1.position.set(0.007000000000000006, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_r.add(bone_middle_r_1);
  bones["middle-r-1"] = bone_middle_r_1;
  boneOrder.push("middle-r-1");
  const bone_middle_r_2 = new THREE.Bone();
  bone_middle_r_2.name = "middle-r-2";
  bone_middle_r_2.position.set(-0.00386000000000003, -0.03196999999999997, 0.0);
  bone_middle_r_1.add(bone_middle_r_2);
  bones["middle-r-2"] = bone_middle_r_2;
  boneOrder.push("middle-r-2");
  const bone_middle_r_3 = new THREE.Bone();
  bone_middle_r_3.name = "middle-r-3";
  bone_middle_r_3.position.set(-0.0026800000000000157, -0.022240000000000038, 0.0);
  bone_middle_r_2.add(bone_middle_r_3);
  bones["middle-r-3"] = bone_middle_r_3;
  boneOrder.push("middle-r-3");
  const bone_ring_l_1 = new THREE.Bone();
  bone_ring_l_1.name = "ring-l-1";
  bone_ring_l_1.position.set(0.007000000000000006, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_l.add(bone_ring_l_1);
  bones["ring-l-1"] = bone_ring_l_1;
  boneOrder.push("ring-l-1");
  const bone_ring_l_2 = new THREE.Bone();
  bone_ring_l_2.name = "ring-l-2";
  bone_ring_l_2.position.set(0.003520000000000023, -0.029189999999999994, 0.0);
  bone_ring_l_1.add(bone_ring_l_2);
  bones["ring-l-2"] = bone_ring_l_2;
  boneOrder.push("ring-l-2");
  const bone_ring_l_3 = new THREE.Bone();
  bone_ring_l_3.name = "ring-l-3";
  bone_ring_l_3.position.set(0.0024099999999999677, -0.02001, 0.0);
  bone_ring_l_2.add(bone_ring_l_3);
  bones["ring-l-3"] = bone_ring_l_3;
  boneOrder.push("ring-l-3");
  const bone_ring_r_1 = new THREE.Bone();
  bone_ring_r_1.name = "ring-r-1";
  bone_ring_r_1.position.set(-0.007000000000000006, -0.037630000000000025, 0.0027999999999999987);
  bone_hand_r.add(bone_ring_r_1);
  bones["ring-r-1"] = bone_ring_r_1;
  boneOrder.push("ring-r-1");
  const bone_ring_r_2 = new THREE.Bone();
  bone_ring_r_2.name = "ring-r-2";
  bone_ring_r_2.position.set(-0.003520000000000023, -0.029189999999999994, 0.0);
  bone_ring_r_1.add(bone_ring_r_2);
  bones["ring-r-2"] = bone_ring_r_2;
  boneOrder.push("ring-r-2");
  const bone_ring_r_3 = new THREE.Bone();
  bone_ring_r_3.name = "ring-r-3";
  bone_ring_r_3.position.set(-0.0024099999999999677, -0.02001, 0.0);
  bone_ring_r_2.add(bone_ring_r_3);
  bones["ring-r-3"] = bone_ring_r_3;
  boneOrder.push("ring-r-3");
  const bone_thumb_l_1 = new THREE.Bone();
  bone_thumb_l_1.name = "thumb-l-1";
  bone_thumb_l_1.position.set(-0.02799999999999997, -0.005370000000000014, 0.005599999999999999);
  bone_hand_l.add(bone_thumb_l_1);
  bones["thumb-l-1"] = bone_thumb_l_1;
  boneOrder.push("thumb-l-1");
  const bone_thumb_l_2 = new THREE.Bone();
  bone_thumb_l_2.name = "thumb-l-2";
  bone_thumb_l_2.position.set(-0.015120000000000022, -0.013020000000000004, 0.0063);
  bone_thumb_l_1.add(bone_thumb_l_2);
  bones["thumb-l-2"] = bone_thumb_l_2;
  boneOrder.push("thumb-l-2");
  const bone_thumb_l_3 = new THREE.Bone();
  bone_thumb_l_3.name = "thumb-l-3";
  bone_thumb_l_3.position.set(-0.011089999999999989, -0.009550000000000003, 0.004619999999999999);
  bone_thumb_l_2.add(bone_thumb_l_3);
  bones["thumb-l-3"] = bone_thumb_l_3;
  boneOrder.push("thumb-l-3");
  const bone_thumb_r_1 = new THREE.Bone();
  bone_thumb_r_1.name = "thumb-r-1";
  bone_thumb_r_1.position.set(0.02799999999999997, -0.005370000000000014, 0.005599999999999999);
  bone_hand_r.add(bone_thumb_r_1);
  bones["thumb-r-1"] = bone_thumb_r_1;
  boneOrder.push("thumb-r-1");
  const bone_thumb_r_2 = new THREE.Bone();
  bone_thumb_r_2.name = "thumb-r-2";
  bone_thumb_r_2.position.set(0.015120000000000022, -0.013020000000000004, 0.0063);
  bone_thumb_r_1.add(bone_thumb_r_2);
  bones["thumb-r-2"] = bone_thumb_r_2;
  boneOrder.push("thumb-r-2");
  const bone_thumb_r_3 = new THREE.Bone();
  bone_thumb_r_3.name = "thumb-r-3";
  bone_thumb_r_3.position.set(0.011089999999999989, -0.009550000000000003, 0.004619999999999999);
  bone_thumb_r_2.add(bone_thumb_r_3);
  bones["thumb-r-3"] = bone_thumb_r_3;
  boneOrder.push("thumb-r-3");
  // The bones are now in REST position. updateMatrixWorld() before constructing the
  // Skeleton is load-bearing: calculateInverses() reads each bone's CURRENT world matrix,
  // and those inverses are what cancel the rest pose during skinning. Constructed before
  // this call it captures identity matrices, the rest pose never cancels, and every
  // vertex is displaced by its bone's offset at rest. Measured, not assumed --
  // scratchpad/bind_experiment.mjs read (0, 3, 0) for a vertex authored at (0, 2, 0).
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneOrder.map((id) => bones[id]));
  const boneIndexOf = new Map<string, number>(boneOrder.map((id, i) => [id, i]));

  // ---- PLAN_1.5 §4 weight function: ONE function over the complete bone set. No
  // mesh-id or vertex-index branching -- only positions, segment endpoints and the
  // envelope radius derived per §4.3. Ported from forge/stage5_rig/emit_rig.py, which
  // measured max |sum(w) - 1| = 2.98e-8 on executed geometry.
  const BONE_JOINT: Record<string, number[]> = {"pelvis": [0.0, -0.182, 0.0], "abdomen": [0.0, -0.154, 0.0], "chest": [0.0, 0.10472, 0.0028], "clavicle-l": [0.05152, 0.4452, 0.0084], "clavicle-r": [-0.05152, 0.4452, 0.0084], "thigh-l": [0.1428, -0.3108, 0.0056], "shin-l": [0.1428, -0.84504, 0.0056], "foot-l": [0.1428, -1.3328, 0.0448], "thigh-r": [-0.1428, -0.3108, 0.0056], "shin-r": [-0.1428, -0.84504, 0.0056], "foot-r": [-0.1428, -1.3328, 0.0448], "upper-arm-l": [0.322, 0.4396, 0.014], "forearm-l": [0.38594, 0.12416, 0.014], "upper-arm-r": [-0.322, 0.4396, 0.014], "forearm-r": [-0.38594, 0.12416, 0.014], "hand-l": [0.42283, -0.18177, 0.014], "hand-r": [-0.42283, -0.18177, 0.014], "neck": [0.0, 0.4396, 0.0056], "head": [0.0, 0.6776, 0.0056], "index-l-1": [0.40183, -0.2194, 0.0168], "index-l-2": [0.40535, -0.24859, 0.0168], "index-l-3": [0.40776, -0.2686, 0.0168], "index-r-1": [-0.40183, -0.2194, 0.0168], "index-r-2": [-0.40535, -0.24859, 0.0168], "index-r-3": [-0.40776, -0.2686, 0.0168], "little-l-1": [0.44243, -0.2194, 0.0168], "little-l-2": [0.44511, -0.24164, 0.0168], "little-l-3": [0.44706, -0.25776, 0.0168], "little-r-1": [-0.44243, -0.2194, 0.0168], "little-r-2": [-0.44511, -0.24164, 0.0168], "little-r-3": [-0.44706, -0.25776, 0.0168], "middle-l-1": [0.41583, -0.2194, 0.0168], "middle-l-2": [0.41969, -0.25137, 0.0168], "middle-l-3": [0.42237, -0.27361, 0.0168], "middle-r-1": [-0.41583, -0.2194, 0.0168], "middle-r-2": [-0.41969, -0.25137, 0.0168], "middle-r-3": [-0.42237, -0.27361, 0.0168], "ring-l-1": [0.42983, -0.2194, 0.0168], "ring-l-2": [0.43335, -0.24859, 0.0168], "ring-l-3": [0.43576, -0.2686, 0.0168], "ring-r-1": [-0.42983, -0.2194, 0.0168], "ring-r-2": [-0.43335, -0.24859, 0.0168], "ring-r-3": [-0.43576, -0.2686, 0.0168], "thumb-l-1": [0.39483, -0.18714, 0.0196], "thumb-l-2": [0.37971, -0.20016, 0.0259], "thumb-l-3": [0.36862, -0.20971, 0.03052], "thumb-r-1": [-0.39483, -0.18714, 0.0196], "thumb-r-2": [-0.37971, -0.20016, 0.0259], "thumb-r-3": [-0.36862, -0.20971, 0.03052]};
  const BONE_TIP: Record<string, number[]> = {"pelvis": [0.0, -0.154, 0.0], "abdomen": [0.0, 0.10472, 0.0028], "chest": [0.0, 0.4396, 0.0056], "clavicle-l": [0.322, 0.4396, 0.014], "clavicle-r": [-0.322, 0.4396, 0.014], "thigh-l": [0.1428, -0.84504, 0.0056], "shin-l": [0.1428, -1.3328, 0.0448], "foot-l": [0.1428, -1.37746, 0.04839], "thigh-r": [-0.1428, -0.84504, 0.0056], "shin-r": [-0.1428, -1.3328, 0.0448], "foot-r": [-0.1428, -1.37746, 0.04839], "upper-arm-l": [0.38594, 0.12416, 0.014], "forearm-l": [0.42283, -0.18177, 0.014], "upper-arm-r": [-0.38594, 0.12416, 0.014], "forearm-r": [-0.42283, -0.18177, 0.014], "hand-l": [0.41583, -0.2194, 0.0168], "hand-r": [-0.41583, -0.2194, 0.0168], "neck": [0.0, 0.6776, 0.0056], "head": [0.0, 0.9912, 0.0056], "index-l-1": [0.40535, -0.24859, 0.0168], "index-l-2": [0.40776, -0.2686, 0.0168], "index-l-3": [0.40937, -0.28195, 0.0168], "index-r-1": [-0.40535, -0.24859, 0.0168], "index-r-2": [-0.40776, -0.2686, 0.0168], "index-r-3": [-0.40937, -0.28195, 0.0168], "little-l-1": [0.44511, -0.24164, 0.0168], "little-l-2": [0.44706, -0.25776, 0.0168], "little-l-3": [0.44833, -0.26833, 0.0168], "little-r-1": [-0.44511, -0.24164, 0.0168], "little-r-2": [-0.44706, -0.25776, 0.0168], "little-r-3": [-0.44833, -0.26833, 0.0168], "middle-l-1": [0.41969, -0.25137, 0.0168], "middle-l-2": [0.42237, -0.27361, 0.0168], "middle-l-3": [0.42404, -0.28751, 0.0168], "middle-r-1": [-0.41969, -0.25137, 0.0168], "middle-r-2": [-0.42237, -0.27361, 0.0168], "middle-r-3": [-0.42404, -0.28751, 0.0168], "ring-l-1": [0.43335, -0.24859, 0.0168], "ring-l-2": [0.43576, -0.2686, 0.0168], "ring-l-3": [0.43731, -0.28139, 0.0168], "ring-r-1": [-0.43335, -0.24859, 0.0168], "ring-r-2": [-0.43576, -0.2686, 0.0168], "ring-r-3": [-0.43731, -0.28139, 0.0168], "thumb-l-1": [0.37971, -0.20016, 0.0259], "thumb-l-2": [0.36862, -0.20971, 0.03052], "thumb-l-3": [0.36053, -0.21668, 0.03389], "thumb-r-1": [-0.37971, -0.20016, 0.0259], "thumb-r-2": [-0.36862, -0.20971, 0.03052], "thumb-r-3": [-0.36053, -0.21668, 0.03389]};
  const BONE_ENVELOPE: Record<string, number> = {"pelvis": 0.03, "abdomen": 0.03, "chest": 0.03, "clavicle-l": 0.03, "clavicle-r": 0.03, "thigh-l": 0.03, "shin-l": 0.03, "foot-l": 0.03, "thigh-r": 0.03, "shin-r": 0.03, "foot-r": 0.03, "upper-arm-l": 0.03, "forearm-l": 0.03, "upper-arm-r": 0.03, "forearm-r": 0.03, "hand-l": 0.03, "hand-r": 0.03, "neck": 0.03, "head": 0.03, "index-l-1": 0.03, "index-l-2": 0.03, "index-l-3": 0.03, "index-r-1": 0.03, "index-r-2": 0.03, "index-r-3": 0.03, "little-l-1": 0.03, "little-l-2": 0.03, "little-l-3": 0.03, "little-r-1": 0.03, "little-r-2": 0.03, "little-r-3": 0.03, "middle-l-1": 0.03, "middle-l-2": 0.03, "middle-l-3": 0.03, "middle-r-1": 0.03, "middle-r-2": 0.03, "middle-r-3": 0.03, "ring-l-1": 0.03, "ring-l-2": 0.03, "ring-l-3": 0.03, "ring-r-1": 0.03, "ring-r-2": 0.03, "ring-r-3": 0.03, "thumb-l-1": 0.03, "thumb-l-2": 0.03, "thumb-l-3": 0.03, "thumb-r-1": 0.03, "thumb-r-2": 0.03, "thumb-r-3": 0.03};
  const _closest = new THREE.Vector3();
  const distanceToSegment = (p: THREE.Vector3, s: number[], e: number[]): number => {
    const ab = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const ap = [p.x - s[0], p.y - s[1], p.z - s[2]];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = abLenSq > 1e-12
      ? THREE.MathUtils.clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq, 0, 1)
      : 0;
    _closest.set(s[0] + ab[0] * t, s[1] + ab[1] * t, s[2] + ab[2] * t);
    return p.distanceTo(_closest);
  };
  const computeVertexWeights = (p: THREE.Vector3) => {
    const scored = boneOrder.map((id) => {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      const u = d / BONE_ENVELOPE[id];
      const falloff = Math.max(0, 1 - u * u);
      return { id, d, w: falloff * falloff };
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, 4);
    const total = kept.reduce((sum, c) => sum + c.w, 0);
    const indices = [0, 0, 0, 0];
    const weights = [0, 0, 0, 0];
    if (total > 0) {
      for (let slot = 0; slot < kept.length; slot++) {
        indices[slot] = boneIndexOf.get(kept[slot].id) ?? 0;
        weights[slot] = kept[slot].w / total;
      }
      return { indices, weights, fallback: false };
    }
    // Mandatory zero-sum fallback (PLAN_1.5 §4 / ADR-8). Without it three.js's own
    // normalizeSkinWeights() rewrites an all-zero vertex to (1,0,0,0) against bone 0
    // regardless of distance, which spikes stray vertices toward the hips. Instead:
    // ignore the envelope and pin weight 1.0 to the absolutely nearest bone.
    let nearest = boneOrder[0];
    let nearestDistance = Infinity;
    for (const id of boneOrder) {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      if (d < nearestDistance) { nearestDistance = d; nearest = id; }
    }
    indices[0] = boneIndexOf.get(nearest) ?? 0;
    weights[0] = 1;
    return { indices, weights, fallback: true };
  };

  // ---- Bake to model space, weight, and bind.
  //
  // The arrangement below was chosen by measurement, not derivation, because the same
  // geometry can be skinned four plausible ways and three of them are wrong. With a
  // vertex authored at model-space (0, 2, 0) fully weighted to a bone at (0, 1, 0) and
  // that bone rotated +90 degrees about X (correct answer: (0, 1, 1)):
  //
  //   pivot transform kept, bind identity     -> rest pose already wrong, no deformation
  //   pivot transform kept, bind matrixWorld  -> (0, 1.5, 0.5): HALF the correct swing,
  //                                              because the pivot applies on top of skinning
  //   geometry baked, pivot bypassed          -> (0, 1, 1): correct
  //   no pivot at all                         -> (0, 1, 1): correct, and identical
  //
  // The last two agreeing is the finding: what matters is that the mesh's own world
  // transform is identity and its geometry lives in the skeleton's space. So each skinned
  // mesh gets its world matrix folded into its vertex data and is reparented to `root`
  // with an identity transform. Meshes are leaves -- components are added to their pivot
  // Group, never to another mesh -- so reparenting one moves nothing else.
  // No component carries an authored pose, so there is nothing to rest.
  root.updateMatrixWorld(true);
  const skinnedMeshNames: string[] = [];
  let boundCount = 0;
  for (const boneId of boneOrder) {
    const mesh = meshes[boneId];
    if (!mesh) continue;
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    root.add(mesh);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
    // Vertices are model-space now, which is the space the weight function measures in,
    // so no per-vertex matrix multiply is needed any more.
    const count = position.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const vertex = new THREE.Vector3();
    for (let v = 0; v < count; v++) {
      vertex.fromBufferAttribute(position, v);
      const { indices, weights } = computeVertexWeights(vertex);
      for (let slot = 0; slot < 4; slot++) {
        skinIndices[v * 4 + slot] = indices[slot];
        skinWeights[v * 4 + slot] = weights[slot];
      }
    }
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    skinnedMeshNames.push(boneId);
    const skinned = mesh as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) continue;
    // bindMode is left at its default (AttachedBindMode). The bones live under `root`
    // rather than under any one mesh because a single Skeleton is shared by every skinned
    // mesh and cannot be parented under all of them; with root and each mesh at identity
    // the bone world matrices are the same either way.
    skinned.bind(skeleton, new THREE.Matrix4());
    // A SkinnedMesh's boundingSphere is computed from its REST vertex data and is not
    // recomputed when bones move, so a posed limb that swings outside its rest bounds gets
    // culled and vanishes -- worse, it vanishes only from certain camera angles, which
    // reads as a geometry bug rather than a culling one. Disabling the test outright is
    // chosen over recomputing bounds every frame because these are small, always-onscreen
    // character parts where the test saves nothing. Recorded in userData.rig so a consumer
    // that DOES need culling knows it has to supply its own bounds.
    skinned.frustumCulled = false;
    boundCount += 1;
  }
  root.userData.rig = { bones, skeleton, boneOrder, boneIndexOf, skinAttributes: skinnedMeshNames, bound: skinnedMeshNames.length > 0 && boundCount === skinnedMeshNames.length, frustumCulled: false, cullingNote: 'skinned meshes set frustumCulled = false; bone motion does not update a SkinnedMesh boundingSphere, so a consumer that needs culling must recompute bounds per frame' };

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is a glossy 3D render, so the ramp REINTERPRETS it into the project's language rather than reproducing it.", "palette": ["#f7f2e6", "#f0803c", "#ffe9d6", "#242a30", "#f2938c", "#2b1d16", "#c98b3f"], "paletteNote": "Named tones, not sampled pixels. At runtime the prawn takes the TEAM COLOUR, so the shipped hue differs from the orange named here.", "responseTargets": ["the nori belt reads glossiest - it carries the strongest specular in the reference", "the blush reads completely flat, with no highlight at any angle", "the pale bands read lighter than the lobes at EVERY team colour, including the frightened blue", "rice reads softer and a step darker than the pale bands, so the two off-whites never merge"]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createEbiNigiriMascotLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Ebi Nigiri Mascot look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": [0.42, 0.78, 0.46], "color": "#fff4e2", "intensity": 2.1, "colorNote": "Warm, above and to the camera's left; matched to scene.ts's own key.", "intensityNote": "Dominant; the belt's specular sweep and the cap's per-lobe gradient agree on it.", "exposureNote": "NO tone mapping. THREE.NoToneMapping, exposure 1.0 - a filmic or ACES curve re-compresses the cel ramp's three bands into each other.", "shadowNote": "Casts the model's GROUND shadow; authored castShadow flags are snapshotted first.", "confidence": 0.8}, {"id": "fill", "type": "hemisphere", "sky": "#dfeaff", "ground": "#d8c6a8", "intensity": 1.15, "direction": [0.0, 1.0, 0.0], "colorNote": "Cool sky over a warm ground bounce, matching scene.ts.", "intensityNote": "Soft; the shadow sides never reach black, which the ramp's lowest band needs.", "exposureNote": "Same NoToneMapping / exposure 1.0 rule as the key.", "shadowNote": "No shadow, and no ambient-occlusion pass or AO map anywhere in this project - contact darkening comes from geometry.", "confidence": 0.7}, {"id": "rim-and-environment", "type": "none", "direction": [0.0, 0.0, -1.0], "colorNote": "Absent, deliberately.", "intensityNote": "No rim light and no IBL - no PMREMGenerator, no HDR, no environment map. Adding any is a scene change, so the model must read without them.", "exposureNote": "NoToneMapping; nothing here changes exposure.", "shadowNote": "Ground shadow is the only shadow: one directional light, PCFSoftShadowMap.", "confidence": 0.9}];
  lights.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is a glossy 3D render, so the ramp REINTERPRETS it into the project's language rather than reproducing it.", "palette": ["#f7f2e6", "#f0803c", "#ffe9d6", "#242a30", "#f2938c", "#2b1d16", "#c98b3f"], "paletteNote": "Named tones, not sampled pixels. At runtime the prawn takes the TEAM COLOUR, so the shipped hue differs from the orange named here.", "responseTargets": ["the nori belt reads glossiest - it carries the strongest specular in the reference", "the blush reads completely flat, with no highlight at any angle", "the pale bands read lighter than the lobes at EVERY team colour, including the frightened blue", "rice reads softer and a step darker than the pale bands, so the two off-whites never merge"]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createEbiNigiriMascotEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameEbiNigiriMascotCamera(
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
export function createEbiNigiriMascotPresentationComposer(
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

export function configureEbiNigiriMascotRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createEbiNigiriMascotInspectControls(
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
