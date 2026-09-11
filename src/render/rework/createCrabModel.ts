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

// Generated from ObjectSculptSpec target: Cartoon Crab
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCartoonCrabModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Cartoon Crab";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["cuticleShell"] = createSculptMaterial(
    "cuticleShell",
    {"id": "cuticleShell", "name": "carapace cuticle (bodyMat)", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#F0553F", "color": "#F0553F", "albedo": {"dominant": "#F0553F", "secondary": ["#D63E2C", "#FA5444"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#F0553F", "#D63E2C", "#FA5444"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.35, "variation": 0.05, "note": "Broad soft specular sweeps across the dome with no sharp terminator."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "dorsalRamp", "kind": "stain", "region": "carapace dorsal surface", "description": "Observed ordered ramp #F47B8A -> #FA5444 -> #FF9444 -> #FFC756 -> #F1A64B, crown to mouth.", "appliedAs": "NOT applied as a gradient - the toon ramp bands it anyway and the body colour is team-driven. Split into two surfaces (cuticleShell crown + cuticleFace face) so the author controls where the band falls. Recorded as observation.", "detailRef": "carapace-value-ramp"}, {"id": "tubercleField", "kind": "bevel", "region": "carapace dorsal surface", "description": "Fifteen raised hemispherical bosses, radius 0.0123, seeded scatter over the upper two-thirds, excluding the sagittal front-bottom where the face sits.", "appliedAs": "geometry - each boss is sunk half its radius so it shares the dome's tangent. A toon material cannot express a boss at all.", "detailRef": "carapace-tubercles"}], "evidenceRefs": ["full-object"], "consumerRole": "bodyMat", "followsFrightenedRecolour": true, "notes": "THE bodyMat. Carries the enemy's assigned team colour, so the hex here is the reference READ of the dorsal crown and not a shipped constant. applyGhostState repaints it for the frightened and eaten states.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["cuticleFace"] = createSculptMaterial(
    "cuticleFace",
    {"id": "cuticleFace", "name": "golden face cuticle", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#FFB347", "color": "#FFB347", "albedo": {"dominant": "#FFB347", "secondary": ["#FFC756", "#FF9444"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#FFB347", "#FFC756", "#FF9444"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.35, "variation": 0.05, "note": "Same cuticle as the crown."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [], "evidenceRefs": ["full-object"], "consumerRole": "accentMats", "followsFrightenedRecolour": true, "notes": "The measured red-crown to gold-face ramp, expressed as a second toon band. IN accentMats: the face is a large share of the silhouette, and the documented rule is that large accents follow the recolour so the 'edible now' read is not blunted. The cost is that the gradient flattens while frightened - acceptable for an identity-rank-4 feature.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["apronCream"] = createSculptMaterial(
    "apronCream",
    {"id": "apronCream", "name": "ventral apron", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#F7D9AC", "color": "#F7D9AC", "albedo": {"dominant": "#F7D9AC", "secondary": ["#FED3A6", "#EA8E4F"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#F7D9AC", "#FED3A6", "#EA8E4F"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.4, "variation": 0.05, "note": "The softest, most diffuse region; no specular sweep survives on it."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "ventralApron", "kind": "stain", "region": "ventral chin", "description": "Pale warm cream #F7D9AC darkening to #EA8E4F where it turns under. The only large light area in the subject.", "appliedAs": "flat albedo on its own surface, held OUT of accentMats so the face stays readable when the body turns frightened blue.", "detailRef": "chin-apron"}], "evidenceRefs": ["full-object"], "consumerRole": "spiritMats", "followsFrightenedRecolour": false, "notes": "NOT in accentMats, on purpose. It is the only large light area in the subject, and it is what keeps the face legible when the body turns frightened blue. A cream chin under a blue shell still reads as a face; an all-blue front does not.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["cuticleLimb"] = createSculptMaterial(
    "cuticleLimb",
    {"id": "cuticleLimb", "name": "limb cuticle", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#E8492E", "color": "#E8492E", "albedo": {"dominant": "#E8492E", "secondary": ["#FF6B48", "#FD7F4D"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#E8492E", "#FF6B48", "#FD7F4D"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.3, "variation": 0.05, "note": "Tighter highlights on the rounded limb plates."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "collarRing", "kind": "contour", "region": "eyeball rear and upper", "description": "Sheath ring, measured asymmetric: 24 px of sclera arc laterally against 10 px medially, so the ring is heavier outboard and reads as a hooded outer lid.", "appliedAs": "geometry - a partial torus conforming to the ball.", "detailRef": "eye-collar-ring"}], "evidenceRefs": ["full-object"], "consumerRole": "accentMats", "followsFrightenedRecolour": true, "notes": "Arms, eyestalks, collars and all eight legs. IN accentMats: ten limbs are a very large share of the silhouette.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["chelaHorn"] = createSculptMaterial(
    "chelaHorn",
    {"id": "chelaHorn", "name": "chela horn", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#F7BE55", "color": "#F7BE55", "albedo": {"dominant": "#F7BE55", "secondary": ["#FFC14D", "#FEEA89"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#F7BE55", "#FFC14D", "#FEEA89"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.28, "variation": 0.05, "note": "The tightest highlights in the subject - a harder, more polished horn."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "pincerGap", "kind": "contour", "region": "between the two fingers", "description": "The open notch. Measured 0.049 clear at the tips, subtending ~38 degrees.", "appliedAs": "geometry - two separate tapering solids meeting at a hinge. IDENTITY RANK 1; sized from readability at the game camera, not scaled from the reference proportion.", "detailRef": "pincer-gap"}, {"id": "fingerTaper", "kind": "bevel", "region": "both fingers", "description": "Both taper to a ROUNDED point. The fixed lower finger (pollex) is longer than the movable upper one (dactyl) - two equal fingers read as a clothes peg.", "appliedAs": "geometry - tapered capsules, 0.048 -> 0.016 and 0.042 -> 0.014.", "detailRef": "chela-finger-taper"}], "evidenceRefs": ["full-object"], "consumerRole": "accentMats", "followsFrightenedRecolour": true, "notes": "The claws. A full value step lighter than the red arm carrying it - the gold-against-red is identity rank 4. IN accentMats by the large-accent rule; the pincer GAP is a silhouette feature and survives the recolour regardless, which is what makes this safe.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["creaseDark"] = createSculptMaterial(
    "creaseDark",
    {"id": "creaseDark", "name": "crease and groove ink", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#7E2A14", "color": "#7E2A14", "albedo": {"dominant": "#7E2A14", "secondary": ["#812A16"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#7E2A14", "#812A16"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.4, "variation": 0.05, "note": "Cavity read; no independent specular evidence."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "creaseLine", "kind": "linework", "region": "inter-plate limb crevices", "description": "A dark contact crease in each crevice - a panel-line/AO read, not a cut groove. 3-5 per side per scan row. It is what keeps the leg fan legible once the relief itself is too shallow to shade at game size.", "appliedAs": "geometry - the crevice is a real step between overlapping plates, shaded by the ramp. The material is DELIBERATELY out of accentMats: on the flea, a crease colour that followed the frightened recolour erased the banding in the one state where the player is chasing it.", "detailRef": "limb-crease-line"}, {"id": "mouthGroove", "kind": "linework", "region": "face / apron boundary", "description": "Upturned arc, 0.212 chord with a 0.044 sagitta, warm dark brown #812A16 and never black.", "appliedAs": "geometry - a torus arc embedded 0.008 into the surface.", "detailRef": "mouth-groove"}], "evidenceRefs": ["full-object"], "consumerRole": "spiritMats", "followsFrightenedRecolour": false, "notes": "The mouth groove and every inter-plate limb crease. DELIBERATELY NOT IN accentMats. This is the flea's band-crease defect written down: a crease colour that follows the frightened recolour paints detail and body the same blue, and the feature it exists to draw vanishes in the one state where the player is chasing the enemy. It was invisible in normal colour - only a map-stripped clay render showed it.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["browDark"] = createSculptMaterial(
    "browDark",
    {"id": "browDark", "name": "brow", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#3A1410", "color": "#3A1410", "albedo": {"dominant": "#3A1410", "secondary": ["#400315", "#45000A"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#3A1410", "#400315", "#45000A"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.35, "variation": 0.05, "note": "Reads matte against the glossy eye - value contrast does the work."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "browLozenge", "kind": "contour", "region": "eyestalk crown", "description": "Flattened dark solid, 49x20 px (aspect 2.45), #400315 - near-black with a red-maroon cast, never a neutral black.", "appliedAs": "geometry, not a marking: it has its own silhouette against the sky above the eye.", "detailRef": "brow-lozenge"}], "evidenceRefs": ["full-object"], "consumerRole": "spiritMats", "followsFrightenedRecolour": false, "notes": "The two brow lozenges. NOT in accentMats: small fixed dark accents that carry the face read. Near-black with a red-maroon cast, never a neutral black.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["sclera"] = createSculptMaterial(
    "sclera",
    {"id": "sclera", "name": "sclera", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#F7F1EA", "color": "#F7F1EA", "albedo": {"dominant": "#F7F1EA", "secondary": ["#B6A2A1"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#F7F1EA", "#B6A2A1"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.2, "variation": 0.05, "note": "Glossy eye white."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [], "evidenceRefs": ["full-object"], "consumerRole": "eyeMats", "followsFrightenedRecolour": false, "notes": "Eye white. In eyeMats - stays SOLID through the eaten state, because the eyes are what the player tracks as an eaten enemy runs home.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["irisCyan"] = createSculptMaterial(
    "irisCyan",
    {"id": "irisCyan", "name": "iris ring", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#22C6EE", "color": "#22C6EE", "albedo": {"dominant": "#22C6EE", "secondary": ["#1EC4EC", "#1E97B6"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#22C6EE", "#1EC4EC", "#1E97B6"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.15, "variation": 0.05, "note": "Glossiest surface in the subject."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [{"id": "cyanRing", "kind": "decal", "region": "iris annulus", "description": "Vivid cyan #22C6EE ring inside the dark navy pupil core, read mainly as a lower crescent because the upper arc sits in the collar's shade.", "appliedAs": "geometry - a flush theta-limited cap ring on the eyeball, so it hugs the ball at any pupil rotation.", "detailRef": "iris-cyan-ring"}], "evidenceRefs": ["full-object"], "consumerRole": "eyeMats", "followsFrightenedRecolour": false, "notes": "The only cool hue in an entirely warm subject.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["pupilNavy"] = createSculptMaterial(
    "pupilNavy",
    {"id": "pupilNavy", "name": "pupil", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#1B2450", "color": "#1B2450", "albedo": {"dominant": "#1B2450", "secondary": ["#1B2653", "#1E0211"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#1B2450", "#1B2653", "#1E0211"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.15, "variation": 0.05, "note": "As the iris."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [], "evidenceRefs": ["full-object"], "consumerRole": "pupM", "followsFrightenedRecolour": false, "notes": "The pupM decal cap. Its authored colour is restored by applyGhostState when leaving the frightened look - without pupBaseColor the 'normal' branch would put back a hardcoded ghost blue.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );
  materialMap["glintWhite"] = createSculptMaterial(
    "glintWhite",
    {"id": "glintWhite", "name": "catchlight", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the shared 3-step ramp (src/render/toon.ts), NoToneMapping", "baseColor": "#FFFFFF", "color": "#FFFFFF", "albedo": {"dominant": "#FFFFFF", "secondary": ["#FFFFFF"], "samplingNotes": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}, "colorVariation": {"palette": ["#FFFFFF", "#FFFFFF"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "roughness": {"base": 0.0, "variation": 0.05, "note": "Unlit. Roughness is meaningless on MeshBasicMaterial."}, "roughnessNote": "MeshToonMaterial has no roughness or metalness channel. The observed satin-to-gloss read is carried by the shared ramp, not by a scalar.", "opacity": 1.0, "transmission": 0.0, "clearcoat": 0.0, "localOverrides": [], "evidenceRefs": ["full-object"], "consumerRole": "eyeMats", "followsFrightenedRecolour": false, "notes": "UNLIT - THREE.MeshBasicMaterial, never toon. A toon ramp quantises a highlight into the same band as everything else facing the light and it stops reading as a catchlight. This is the project's one documented exception to cel shading.", "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and any value recorded here is the OBSERVED finish, kept as evidence, not a channel to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "textureless": {"declared": true, "evidence": ["Reference view 'full-object' (.img2threejs/reference/crab/crab.png): the subject is a 3D cartoon render with no grain, no print, no pores and no weave anywhere on it. Every surface is a flat colour under a soft specular sweep; its identity is silhouette, proportion and the boundaries between flat colour regions.", "Measured: the sagittal colour column (x=277, y 168..376) walks smoothly through 25 sampled values with no high-frequency component at all - the variation is a lighting ramp, not surface detail.", "Measured: the bright-local-maximum scan over the shell (y 190..300) returned 30 maxima, of which only ~15 are raised GEOMETRY (tubercles). There is no residual texture signal once those are accounted for.", "Renderer constraint: the target is THREE.MeshToonMaterial on a shared 3-step ramp under NoToneMapping. It has no roughness, metalness, normal or AO channel, so there is nowhere for a map to go even if one existed.", "Project constraint: this stack ships NO character textures. The only textures in the build are the procedurally generated wall and floor surfaces (src/render/wallTexture.ts, floorTexture.ts).", "Acquisition constraint: the reference is a watermarked stock image, so no crop of it could be used as a map regardless. See .img2threejs/crab/evidence/projection-route.md."]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_carapace_0 = makeAttachmentEndpoint(null);
  const node_carapace_0 = new THREE.Group();
  node_carapace_0.name = "carapace (dorsal dome)__pivot";
  node_carapace_0.scale.set(1, 1, 1);
  if (endpoint_carapace_0) {
    node_carapace_0.position.copy(endpoint_carapace_0.start);
    node_carapace_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_carapace_0.position.set(0.0, 0.331, -0.01);
    node_carapace_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_carapace_0.userData.sculptComponent = {"id": "carapace", "name": "carapace (dorsal dome)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous, smoothly-varying volume with no internal seam or panel break. A crab shell is the textbook continuous-sculpt case and the decision tree lands on it at step 6. Built as a LATERALLY STRETCHED oblate ellipsoid: 0.560 wide against 0.320 tall and 0.404 deep. It is never a sphere - width:height = 1.00:0.57 measured, and identity rank 2 is that the animal is wider than it is deep.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.56, "height": 0.32, "depth": 0.404, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [0.0, 0.331, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.56, 0.32, 0.404]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleShell", "materialLayers": ["cuticleShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The bodyMat surface. Carries the team colour and the frightened recolour."}, "evidenceRefs": ["full-object", "zone-r1c1"], "details": ["carapace-value-ramp"], "fidelityTier": "blockout", "builtAs": "carapace", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 85, 63, 1.0)", "secondaryAlbedo": "rgba(214, 62, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "The team-coloured body surface. #F0553F is the reference READ of the dorsal crown; in the game this hex is replaced by the enemy's assigned colour.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_carapace_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_carapace_0);
  nodes["carapace"] = node_carapace_0;
  const mesh_carapace_0Geometry = endpoint_carapace_0
    ? new THREE.CylinderGeometry(endpoint_carapace_0.endRadius, endpoint_carapace_0.baseRadius, endpoint_carapace_0.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_carapace_0) {
    mesh_carapace_0Geometry.scale(0.56, 0.32, 0.404);
  }
  const mesh_carapace_0 = new THREE.Mesh(
    mesh_carapace_0Geometry,
    materialMap["cuticleShell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_carapace_0.name = "carapace (dorsal dome)";
  if (endpoint_carapace_0) {
    mesh_carapace_0.position.copy(endpoint_carapace_0.midpoint);
    mesh_carapace_0.quaternion.copy(endpoint_carapace_0.quaternion);
  }
  mesh_carapace_0.castShadow = options.castShadow ?? true;
  mesh_carapace_0.receiveShadow = options.receiveShadow ?? true;
  mesh_carapace_0.userData.sculptComponent = {"id": "carapace", "name": "carapace (dorsal dome)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous, smoothly-varying volume with no internal seam or panel break. A crab shell is the textbook continuous-sculpt case and the decision tree lands on it at step 6. Built as a LATERALLY STRETCHED oblate ellipsoid: 0.560 wide against 0.320 tall and 0.404 deep. It is never a sphere - width:height = 1.00:0.57 measured, and identity rank 2 is that the animal is wider than it is deep.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.56, "height": 0.32, "depth": 0.404, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [0.0, 0.331, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.56, 0.32, 0.404]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleShell", "materialLayers": ["cuticleShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The bodyMat surface. Carries the team colour and the frightened recolour."}, "evidenceRefs": ["full-object", "zone-r1c1"], "details": ["carapace-value-ramp"], "fidelityTier": "blockout", "builtAs": "carapace", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 85, 63, 1.0)", "secondaryAlbedo": "rgba(214, 62, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "The team-coloured body surface. #F0553F is the reference READ of the dorsal crown; in the game this hex is replaced by the enemy's assigned colour.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_carapace_0.add(mesh_carapace_0);
  meshes["carapace"] = mesh_carapace_0;
  colliders["carapace"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_carapace_lip_1 = makeAttachmentEndpoint(null);
  const node_carapace_lip_1 = new THREE.Group();
  node_carapace_lip_1.name = "rolled front lip__pivot";
  node_carapace_lip_1.scale.set(1, 1, 1);
  if (endpoint_carapace_lip_1) {
    node_carapace_lip_1.position.copy(endpoint_carapace_lip_1.start);
    node_carapace_lip_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_carapace_lip_1.position.set(0.0, 0.408, 0.112);
    node_carapace_lip_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_carapace_lip_1.userData.sculptComponent = {"id": "carapace-lip", "name": "rolled front lip", "level": "meso", "role": "body", "importance": 0.65, "confidence": 0.65, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "A swept band following the shell's front margin, tangent-continuous with the dome. It is the surface TURNING UNDER rather than a rim stuck on, so it is part of the same continuous sculpt and is built as a partial torus swept along the margin rather than a ring primitive dropped in place.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-front-margin", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.031], "contactType": "overlap", "embedDepth": 0.014, "gapTolerance": 0.002, "confidence": 0.65, "notes": "Shares the dome's tangent. A visible step here would read as a seam, not a lip."}, "dimensions": {"width": 0.548, "height": 0.176, "depth": 0.062, "units": "world (1 unit = 1 maze tile)", "confidence": 0.65}, "transform": {"position": [0.0, 0.408, 0.112], "rotation": [0.0, 0.0, 0.0], "scale": [0.548, 0.176, 0.062]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleFace", "materialLayers": ["cuticleFace"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rolledMargin", "kind": "bevel", "description": "The shell's front edge turns under rather than ending in a rim. Measured as a #F47B8A -> #FA5444 step over y 178..192. Reads as a thick shell, not a shrink-wrapped dome.", "detailRef": "carapace-front-lip"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Reads as a thick shell. Without it the dome is shrink-wrapped."}, "evidenceRefs": ["zone-r1c1"], "details": ["carapace-front-lip"], "fidelityTier": "blockout", "builtAs": "carapace-lip", "colorMaterialRecipe": {"dominantAlbedo": "rgba(250, 84, 68, 1.0)", "secondaryAlbedo": "rgba(244, 123, 138, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "The measured #F47B8A -> #FA5444 turn over y 178..192.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_carapace_lip_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_carapace_lip_1);
  nodes["carapace-lip"] = node_carapace_lip_1;
  const mesh_carapace_lip_1Geometry = endpoint_carapace_lip_1
    ? new THREE.CylinderGeometry(endpoint_carapace_lip_1.endRadius, endpoint_carapace_lip_1.baseRadius, endpoint_carapace_lip_1.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.08, 12, 48);
  if (!endpoint_carapace_lip_1) {
    mesh_carapace_lip_1Geometry.scale(0.548, 0.176, 0.062);
  }
  const mesh_carapace_lip_1 = new THREE.Mesh(
    mesh_carapace_lip_1Geometry,
    materialMap["cuticleFace"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_carapace_lip_1.name = "rolled front lip";
  if (endpoint_carapace_lip_1) {
    mesh_carapace_lip_1.position.copy(endpoint_carapace_lip_1.midpoint);
    mesh_carapace_lip_1.quaternion.copy(endpoint_carapace_lip_1.quaternion);
  }
  mesh_carapace_lip_1.castShadow = options.castShadow ?? true;
  mesh_carapace_lip_1.receiveShadow = options.receiveShadow ?? true;
  mesh_carapace_lip_1.userData.sculptComponent = {"id": "carapace-lip", "name": "rolled front lip", "level": "meso", "role": "body", "importance": 0.65, "confidence": 0.65, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "A swept band following the shell's front margin, tangent-continuous with the dome. It is the surface TURNING UNDER rather than a rim stuck on, so it is part of the same continuous sculpt and is built as a partial torus swept along the margin rather than a ring primitive dropped in place.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-front-margin", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.031], "contactType": "overlap", "embedDepth": 0.014, "gapTolerance": 0.002, "confidence": 0.65, "notes": "Shares the dome's tangent. A visible step here would read as a seam, not a lip."}, "dimensions": {"width": 0.548, "height": 0.176, "depth": 0.062, "units": "world (1 unit = 1 maze tile)", "confidence": 0.65}, "transform": {"position": [0.0, 0.408, 0.112], "rotation": [0.0, 0.0, 0.0], "scale": [0.548, 0.176, 0.062]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleFace", "materialLayers": ["cuticleFace"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rolledMargin", "kind": "bevel", "description": "The shell's front edge turns under rather than ending in a rim. Measured as a #F47B8A -> #FA5444 step over y 178..192. Reads as a thick shell, not a shrink-wrapped dome.", "detailRef": "carapace-front-lip"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Reads as a thick shell. Without it the dome is shrink-wrapped."}, "evidenceRefs": ["zone-r1c1"], "details": ["carapace-front-lip"], "fidelityTier": "blockout", "builtAs": "carapace-lip", "colorMaterialRecipe": {"dominantAlbedo": "rgba(250, 84, 68, 1.0)", "secondaryAlbedo": "rgba(244, 123, 138, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "The measured #F47B8A -> #FA5444 turn over y 178..192.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_carapace_lip_1.add(mesh_carapace_lip_1);
  meshes["carapace-lip"] = mesh_carapace_lip_1;
  colliders["carapace-lip"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_face_panel_2 = makeAttachmentEndpoint(null);
  const node_face_panel_2 = new THREE.Group();
  node_face_panel_2.name = "golden lower face__pivot";
  node_face_panel_2.scale.set(1, 1, 1);
  if (endpoint_face_panel_2) {
    node_face_panel_2.position.copy(endpoint_face_panel_2.start);
    node_face_panel_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_face_panel_2.position.set(0.0, 0.331, -0.01);
    node_face_panel_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_face_panel_2.userData.sculptComponent = {"id": "face-panel", "name": "golden lower face", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "A thin surface conforming to the dome beneath it with no independent volume - decision tree step 5. Built as a phi/theta-limited shell on the carapace's own centre and radii scaled by 1.006, so it lies exactly on the curve at any tilt instead of having to be fitted. Same construction the ladybug already uses for its shell decals.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-anterior-ventral", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.002], "contactType": "overlap", "embedDepth": 0.001, "gapTolerance": 0.001, "confidence": 0.7, "notes": "Surface-conformal shell, phi limited to the anterior 150 degrees and theta to the lower 60 percent, so the gold occupies the face and the red stays on the crown."}, "dimensions": {"width": 0.563, "height": 0.322, "depth": 0.406, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0.0, 0.331, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.563, 0.322, 0.406]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleFace", "materialLayers": ["cuticleFace"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The measured red-crown to gold-face ramp, expressed as two toon bands rather than a gradient - a MeshToonMaterial quantises a gradient into its own 3 steps anyway."}, "evidenceRefs": ["zone-r1c1"], "details": ["carapace-value-ramp"], "fidelityTier": "blockout", "builtAs": "face-panel", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 179, 71, 1.0)", "secondaryAlbedo": "rgba(255, 199, 86, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Golden yellow-orange. Measured lightest point #FFC756 at y~256.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_face_panel_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_face_panel_2);
  nodes["face-panel"] = node_face_panel_2;
  const mesh_face_panel_2Geometry = endpoint_face_panel_2
    ? new THREE.CylinderGeometry(endpoint_face_panel_2.endRadius, endpoint_face_panel_2.baseRadius, endpoint_face_panel_2.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_face_panel_2) {
    mesh_face_panel_2Geometry.scale(0.563, 0.322, 0.406);
  }
  const mesh_face_panel_2 = new THREE.Mesh(
    mesh_face_panel_2Geometry,
    materialMap["cuticleFace"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_face_panel_2.name = "golden lower face";
  if (endpoint_face_panel_2) {
    mesh_face_panel_2.position.copy(endpoint_face_panel_2.midpoint);
    mesh_face_panel_2.quaternion.copy(endpoint_face_panel_2.quaternion);
  }
  mesh_face_panel_2.castShadow = options.castShadow ?? true;
  mesh_face_panel_2.receiveShadow = options.receiveShadow ?? true;
  mesh_face_panel_2.userData.sculptComponent = {"id": "face-panel", "name": "golden lower face", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "A thin surface conforming to the dome beneath it with no independent volume - decision tree step 5. Built as a phi/theta-limited shell on the carapace's own centre and radii scaled by 1.006, so it lies exactly on the curve at any tilt instead of having to be fitted. Same construction the ladybug already uses for its shell decals.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-anterior-ventral", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.002], "contactType": "overlap", "embedDepth": 0.001, "gapTolerance": 0.001, "confidence": 0.7, "notes": "Surface-conformal shell, phi limited to the anterior 150 degrees and theta to the lower 60 percent, so the gold occupies the face and the red stays on the crown."}, "dimensions": {"width": 0.563, "height": 0.322, "depth": 0.406, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0.0, 0.331, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.563, 0.322, 0.406]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleFace", "materialLayers": ["cuticleFace"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The measured red-crown to gold-face ramp, expressed as two toon bands rather than a gradient - a MeshToonMaterial quantises a gradient into its own 3 steps anyway."}, "evidenceRefs": ["zone-r1c1"], "details": ["carapace-value-ramp"], "fidelityTier": "blockout", "builtAs": "face-panel", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 179, 71, 1.0)", "secondaryAlbedo": "rgba(255, 199, 86, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Golden yellow-orange. Measured lightest point #FFC756 at y~256.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_face_panel_2.add(mesh_face_panel_2);
  meshes["face-panel"] = mesh_face_panel_2;
  colliders["face-panel"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_chin_apron_3 = makeAttachmentEndpoint(null);
  const node_chin_apron_3 = new THREE.Group();
  node_chin_apron_3.name = "ventral apron (chin)__pivot";
  node_chin_apron_3.scale.set(1, 1, 1);
  if (endpoint_chin_apron_3) {
    node_chin_apron_3.position.copy(endpoint_chin_apron_3.start);
    node_chin_apron_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chin_apron_3.position.set(0.0, 0.226, 0.145);
    node_chin_apron_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_chin_apron_3.userData.sculptComponent = {"id": "chin-apron", "name": "ventral apron (chin)", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "The pale cream band below the mouth. A conforming shell on the dome's lower-front, not a separate volume.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-ventral-anterior", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.012, 0.01], "contactType": "overlap", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Sits proud of the face panel by one shell thickness so the mouth groove has two surfaces to separate."}, "dimensions": {"width": 0.3, "height": 0.115, "depth": 0.13, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.0, 0.226, 0.145], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.115, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "apronCream", "materialLayers": ["apronCream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The ONLY large light area in the subject. It is deliberately NOT in accentMats: it is what keeps the face readable when the body turns frightened blue."}, "evidenceRefs": ["zone-r1c1"], "details": ["chin-apron"], "fidelityTier": "blockout", "builtAs": "chin-apron", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 217, 172, 1.0)", "secondaryAlbedo": "rgba(234, 142, 79, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Pale warm cream darkening to tan where it turns under.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chin_apron_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_chin_apron_3);
  nodes["chin-apron"] = node_chin_apron_3;
  const mesh_chin_apron_3Geometry = endpoint_chin_apron_3
    ? new THREE.CylinderGeometry(endpoint_chin_apron_3.endRadius, endpoint_chin_apron_3.baseRadius, endpoint_chin_apron_3.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_chin_apron_3) {
    mesh_chin_apron_3Geometry.scale(0.3, 0.115, 0.13);
  }
  const mesh_chin_apron_3 = new THREE.Mesh(
    mesh_chin_apron_3Geometry,
    materialMap["apronCream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chin_apron_3.name = "ventral apron (chin)";
  if (endpoint_chin_apron_3) {
    mesh_chin_apron_3.position.copy(endpoint_chin_apron_3.midpoint);
    mesh_chin_apron_3.quaternion.copy(endpoint_chin_apron_3.quaternion);
  }
  mesh_chin_apron_3.castShadow = options.castShadow ?? true;
  mesh_chin_apron_3.receiveShadow = options.receiveShadow ?? true;
  mesh_chin_apron_3.userData.sculptComponent = {"id": "chin-apron", "name": "ventral apron (chin)", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "The pale cream band below the mouth. A conforming shell on the dome's lower-front, not a separate volume.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-ventral-anterior", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, -0.012, 0.01], "contactType": "overlap", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Sits proud of the face panel by one shell thickness so the mouth groove has two surfaces to separate."}, "dimensions": {"width": 0.3, "height": 0.115, "depth": 0.13, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.0, 0.226, 0.145], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.115, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "apronCream", "materialLayers": ["apronCream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The ONLY large light area in the subject. It is deliberately NOT in accentMats: it is what keeps the face readable when the body turns frightened blue."}, "evidenceRefs": ["zone-r1c1"], "details": ["chin-apron"], "fidelityTier": "blockout", "builtAs": "chin-apron", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 217, 172, 1.0)", "secondaryAlbedo": "rgba(234, 142, 79, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Pale warm cream darkening to tan where it turns under.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chin_apron_3.add(mesh_chin_apron_3);
  meshes["chin-apron"] = mesh_chin_apron_3;
  colliders["chin-apron"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_mouth_groove_4 = makeAttachmentEndpoint(null);
  const node_mouth_groove_4 = new THREE.Group();
  node_mouth_groove_4.name = "mouth groove__pivot";
  node_mouth_groove_4.scale.set(1, 1, 1);
  if (endpoint_mouth_groove_4) {
    node_mouth_groove_4.position.copy(endpoint_mouth_groove_4.start);
    node_mouth_groove_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_groove_4.position.set(0.0, 0.288, 0.19);
    node_mouth_groove_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_groove_4.userData.sculptComponent = {"id": "mouth-groove", "name": "mouth groove", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.7, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "An upturned arc cut into the face/apron boundary. Relief large enough to affect the read at the target size, so it is geometry rather than a material concern: a partial torus of radius 0.150 (solved from the measured 0.212 chord and 0.044 sagitta) sweeping 90 degrees, its centre of curvature ABOVE the mouth so the ends turn up.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "face-apron-boundary", "localStart": [-0.106, 0.044, 0.0], "localEnd": [0.106, 0.044, 0.0], "contactType": "embed", "embedDepth": 0.008, "gapTolerance": 0.001, "confidence": 0.7, "notes": "A GROOVE, never an aperture. The reference draws a smiling line; a real crab's maxillipeds are not depicted and are not invented."}, "dimensions": {"width": 0.212, "height": 0.05, "depth": 0.03, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0.0, 0.288, 0.19], "rotation": [0.0, 0.0, 0.0], "scale": [0.212, 0.05, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "creaseDark", "materialLayers": ["creaseDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Torus centre of curvature at y 0.394. Corner rise 0.0437."}, "evidenceRefs": ["zone-r1c1"], "details": ["mouth-groove"], "fidelityTier": "blockout", "builtAs": "mouth-groove", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 42, 20, 1.0)", "secondaryAlbedo": "rgba(129, 42, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Warm dark brown #812A16, never black.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_mouth_groove_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_mouth_groove_4);
  nodes["mouth-groove"] = node_mouth_groove_4;
  const mesh_mouth_groove_4Geometry = endpoint_mouth_groove_4
    ? new THREE.CylinderGeometry(endpoint_mouth_groove_4.endRadius, endpoint_mouth_groove_4.baseRadius, endpoint_mouth_groove_4.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.08, 12, 48);
  if (!endpoint_mouth_groove_4) {
    mesh_mouth_groove_4Geometry.scale(0.212, 0.05, 0.03);
  }
  const mesh_mouth_groove_4 = new THREE.Mesh(
    mesh_mouth_groove_4Geometry,
    materialMap["creaseDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_groove_4.name = "mouth groove";
  if (endpoint_mouth_groove_4) {
    mesh_mouth_groove_4.position.copy(endpoint_mouth_groove_4.midpoint);
    mesh_mouth_groove_4.quaternion.copy(endpoint_mouth_groove_4.quaternion);
  }
  mesh_mouth_groove_4.castShadow = options.castShadow ?? true;
  mesh_mouth_groove_4.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_groove_4.userData.sculptComponent = {"id": "mouth-groove", "name": "mouth groove", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.7, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "An upturned arc cut into the face/apron boundary. Relief large enough to affect the read at the target size, so it is geometry rather than a material concern: a partial torus of radius 0.150 (solved from the measured 0.212 chord and 0.044 sagitta) sweeping 90 degrees, its centre of curvature ABOVE the mouth so the ends turn up.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "face-apron-boundary", "localStart": [-0.106, 0.044, 0.0], "localEnd": [0.106, 0.044, 0.0], "contactType": "embed", "embedDepth": 0.008, "gapTolerance": 0.001, "confidence": 0.7, "notes": "A GROOVE, never an aperture. The reference draws a smiling line; a real crab's maxillipeds are not depicted and are not invented."}, "dimensions": {"width": 0.212, "height": 0.05, "depth": 0.03, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0.0, 0.288, 0.19], "rotation": [0.0, 0.0, 0.0], "scale": [0.212, 0.05, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "creaseDark", "materialLayers": ["creaseDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Torus centre of curvature at y 0.394. Corner rise 0.0437."}, "evidenceRefs": ["zone-r1c1"], "details": ["mouth-groove"], "fidelityTier": "blockout", "builtAs": "mouth-groove", "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 42, 20, 1.0)", "secondaryAlbedo": "rgba(129, 42, 22, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Warm dark brown #812A16, never black.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_mouth_groove_4.add(mesh_mouth_groove_4);
  meshes["mouth-groove"] = mesh_mouth_groove_4;
  colliders["mouth-groove"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tubercle_field_5 = makeAttachmentEndpoint(null);
  const node_tubercle_field_5 = new THREE.Group();
  node_tubercle_field_5.name = "carapace tubercles__pivot";
  node_tubercle_field_5.scale.set(1, 1, 1);
  if (endpoint_tubercle_field_5) {
    node_tubercle_field_5.position.copy(endpoint_tubercle_field_5.start);
    node_tubercle_field_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tubercle_field_5.position.set(0.0, 0.395, 0.03);
    node_tubercle_field_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_tubercle_field_5.userData.sculptComponent = {"id": "tubercle-field", "name": "carapace tubercles", "level": "micro", "role": "body", "importance": 0.35, "confidence": 0.6, "primitive": "sphere", "topologyClass": "surface-relief", "topologyRationale": "Fifteen hemispherical bosses raised OUT of the shell, each sharing the shell's tangent. Silhouette-affecting only on the rim, so at the target size this is close to the geometry/material boundary - it stays geometry because a toon material cannot express a boss at all.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-dorsal", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.006, 0.0], "contactType": "embed", "embedDepth": 0.006, "gapTolerance": 0.001, "confidence": 0.6, "notes": "Each boss is sunk half its radius so it shares the dome's tangent rather than resting on it as a bead."}, "dimensions": {"width": 0.42, "height": 0.14, "depth": 0.3, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0.0, 0.395, 0.03], "rotation": [0.0, 0.0, 0.0], "scale": [0.42, 0.14, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleShell", "materialLayers": ["cuticleShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Radius 0.0123. See repetitionSystems.carapace-tubercles for the distribution rule."}, "evidenceRefs": ["zone-r1c1"], "details": ["carapace-tubercles"], "fidelityTier": "blockout", "builtAs": "tubercle-field", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 85, 63, 1.0)", "secondaryAlbedo": "rgba(214, 62, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c1"], "notes": "Team-coloured body surface; the hex is the reference READ of the dorsal crown.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_tubercle_field_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_tubercle_field_5);
  nodes["tubercle-field"] = node_tubercle_field_5;
  const mesh_tubercle_field_5Geometry = endpoint_tubercle_field_5
    ? new THREE.CylinderGeometry(endpoint_tubercle_field_5.endRadius, endpoint_tubercle_field_5.baseRadius, endpoint_tubercle_field_5.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_tubercle_field_5) {
    mesh_tubercle_field_5Geometry.scale(0.42, 0.14, 0.3);
  }
  const mesh_tubercle_field_5 = new THREE.Mesh(
    mesh_tubercle_field_5Geometry,
    materialMap["cuticleShell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tubercle_field_5.name = "carapace tubercles";
  if (endpoint_tubercle_field_5) {
    mesh_tubercle_field_5.position.copy(endpoint_tubercle_field_5.midpoint);
    mesh_tubercle_field_5.quaternion.copy(endpoint_tubercle_field_5.quaternion);
  }
  mesh_tubercle_field_5.castShadow = options.castShadow ?? true;
  mesh_tubercle_field_5.receiveShadow = options.receiveShadow ?? true;
  mesh_tubercle_field_5.userData.sculptComponent = {"id": "tubercle-field", "name": "carapace tubercles", "level": "micro", "role": "body", "importance": 0.35, "confidence": 0.6, "primitive": "sphere", "topologyClass": "surface-relief", "topologyRationale": "Fifteen hemispherical bosses raised OUT of the shell, each sharing the shell's tangent. Silhouette-affecting only on the rim, so at the target size this is close to the geometry/material boundary - it stays geometry because a toon material cannot express a boss at all.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-dorsal", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.006, 0.0], "contactType": "embed", "embedDepth": 0.006, "gapTolerance": 0.001, "confidence": 0.6, "notes": "Each boss is sunk half its radius so it shares the dome's tangent rather than resting on it as a bead."}, "dimensions": {"width": 0.42, "height": 0.14, "depth": 0.3, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0.0, 0.395, 0.03], "rotation": [0.0, 0.0, 0.0], "scale": [0.42, 0.14, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleShell", "materialLayers": ["cuticleShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Radius 0.0123. See repetitionSystems.carapace-tubercles for the distribution rule."}, "evidenceRefs": ["zone-r1c1"], "details": ["carapace-tubercles"], "fidelityTier": "blockout", "builtAs": "tubercle-field", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 85, 63, 1.0)", "secondaryAlbedo": "rgba(214, 62, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c1"], "notes": "Team-coloured body surface; the hex is the reference READ of the dorsal crown.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_tubercle_field_5.add(mesh_tubercle_field_5);
  meshes["tubercle-field"] = mesh_tubercle_field_5;
  colliders["tubercle-field"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_eyestalk_l_6 = {"parentId": "carapace", "parentSocket": "carapace-dorsal-anterior-l", "localStart": [0.128, 0.474, 0.062], "localEnd": [0.128, 0.549, 0.072], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the shell so no gap opens at the join when the stalk tilts. The pivot is at the SOCKET, not the centre, or the stalk would swing through the shell."};
  const endpoint_eyestalk_l_6 = makeAttachmentEndpoint(attachment_eyestalk_l_6);
  const node_eyestalk_l_6 = new THREE.Group();
  node_eyestalk_l_6.name = "eyestalk (l)__pivot";
  node_eyestalk_l_6.scale.set(1, 1, 1);
  if (endpoint_eyestalk_l_6) {
    node_eyestalk_l_6.position.copy(endpoint_eyestalk_l_6.start);
    node_eyestalk_l_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eyestalk_l_6.position.set(0.128, 0.512, 0.068);
    node_eyestalk_l_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_eyestalk_l_6.userData.sculptComponent = {"id": "eyestalk-l", "name": "eyestalk (l)", "level": "macro", "role": "body", "importance": 0.5, "confidence": 0.3, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A short straight column with a simple circular section - genuinely a cylinder (decision tree step 4). Almost entirely hidden by the collar, which is why its length is derived from the eye-above-shell measurement rather than observed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-dorsal-anterior-l", "localStart": [0.128, 0.474, 0.062], "localEnd": [0.128, 0.549, 0.072], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the shell so no gap opens at the join when the stalk tilts. The pivot is at the SOCKET, not the centre, or the stalk would swing through the shell."}, "dimensions": {"width": 0.08, "height": 0.075, "depth": 0.08, "units": "world (1 unit = 1 maze tile)", "confidence": 0.3}, "transform": {"position": [0.128, 0.512, 0.068], "rotation": [0.0, 0.0, 0.0], "scale": [0.08, 0.075, 0.08]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0, -0.038, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'eyestalk-l/r' - driven by the behaviour for the idle waggle."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyestalk-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 107, 72, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid limb red, the same cuticle as the arms and legs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyestalk_l_6.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0, -0.038, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_eyestalk_l_6);
  nodes["eyestalk-l"] = node_eyestalk_l_6;
  const mesh_eyestalk_l_6Geometry = endpoint_eyestalk_l_6
    ? new THREE.CylinderGeometry(endpoint_eyestalk_l_6.endRadius, endpoint_eyestalk_l_6.baseRadius, endpoint_eyestalk_l_6.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_eyestalk_l_6) {
    mesh_eyestalk_l_6Geometry.scale(0.08, 0.075, 0.08);
  }
  const mesh_eyestalk_l_6 = new THREE.Mesh(
    mesh_eyestalk_l_6Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eyestalk_l_6.name = "eyestalk (l)";
  if (endpoint_eyestalk_l_6) {
    mesh_eyestalk_l_6.position.copy(endpoint_eyestalk_l_6.midpoint);
    mesh_eyestalk_l_6.quaternion.copy(endpoint_eyestalk_l_6.quaternion);
  }
  mesh_eyestalk_l_6.castShadow = options.castShadow ?? true;
  mesh_eyestalk_l_6.receiveShadow = options.receiveShadow ?? true;
  mesh_eyestalk_l_6.userData.sculptComponent = {"id": "eyestalk-l", "name": "eyestalk (l)", "level": "macro", "role": "body", "importance": 0.5, "confidence": 0.3, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A short straight column with a simple circular section - genuinely a cylinder (decision tree step 4). Almost entirely hidden by the collar, which is why its length is derived from the eye-above-shell measurement rather than observed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-dorsal-anterior-l", "localStart": [0.128, 0.474, 0.062], "localEnd": [0.128, 0.549, 0.072], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the shell so no gap opens at the join when the stalk tilts. The pivot is at the SOCKET, not the centre, or the stalk would swing through the shell."}, "dimensions": {"width": 0.08, "height": 0.075, "depth": 0.08, "units": "world (1 unit = 1 maze tile)", "confidence": 0.3}, "transform": {"position": [0.128, 0.512, 0.068], "rotation": [0.0, 0.0, 0.0], "scale": [0.08, 0.075, 0.08]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0, -0.038, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'eyestalk-l/r' - driven by the behaviour for the idle waggle."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyestalk-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 107, 72, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid limb red, the same cuticle as the arms and legs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyestalk_l_6.add(mesh_eyestalk_l_6);
  meshes["eyestalk-l"] = mesh_eyestalk_l_6;
  colliders["eyestalk-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_collar_l_7 = makeAttachmentEndpoint(null);
  const node_collar_l_7 = new THREE.Group();
  node_collar_l_7.name = "eye collar (l)__pivot";
  node_collar_l_7.scale.set(1, 1, 1);
  if (endpoint_collar_l_7) {
    node_collar_l_7.position.copy(endpoint_collar_l_7.start);
    node_collar_l_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_collar_l_7.position.set(0.132, 0.592, 0.055);
    node_collar_l_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_collar_l_7.userData.sculptComponent = {"id": "collar-l", "name": "eye collar (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "torus", "topologyClass": "conforming-shell", "topologyRationale": "A partial sheath ring hugging the eyeball's rear and upper - a thin shell following the ball beneath it, with no volume of its own. Measured ASYMMETRIC: at y=130 the sclera arc is 24 px laterally against 10 px medially, so the ring is thicker outboard and reads as a hooded outer lid. Building it symmetric loses that read.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-l", "attachment": {"parentId": "eyestalk-l", "parentSocket": "eyestalk-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "overlap", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Wraps the ball; covers the stalk/ball join, which is why the true stalk length is unobservable in the reference."}, "dimensions": {"width": 0.196, "height": 0.192, "depth": 0.15, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.132, 0.592, 0.055], "rotation": [0.0, 0.0, 0.0], "scale": [0.196, 0.192, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Thicker on the lateral side by a factor of 2.4."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-collar-ring"], "fidelityTier": "blockout", "builtAs": "collar-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(203, 58, 39, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Same cuticle as the stalk.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_collar_l_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyestalk-l"] ?? root).add(node_collar_l_7);
  nodes["collar-l"] = node_collar_l_7;
  const mesh_collar_l_7Geometry = endpoint_collar_l_7
    ? new THREE.CylinderGeometry(endpoint_collar_l_7.endRadius, endpoint_collar_l_7.baseRadius, endpoint_collar_l_7.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.08, 12, 48);
  if (!endpoint_collar_l_7) {
    mesh_collar_l_7Geometry.scale(0.196, 0.192, 0.15);
  }
  const mesh_collar_l_7 = new THREE.Mesh(
    mesh_collar_l_7Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_collar_l_7.name = "eye collar (l)";
  if (endpoint_collar_l_7) {
    mesh_collar_l_7.position.copy(endpoint_collar_l_7.midpoint);
    mesh_collar_l_7.quaternion.copy(endpoint_collar_l_7.quaternion);
  }
  mesh_collar_l_7.castShadow = options.castShadow ?? true;
  mesh_collar_l_7.receiveShadow = options.receiveShadow ?? true;
  mesh_collar_l_7.userData.sculptComponent = {"id": "collar-l", "name": "eye collar (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "torus", "topologyClass": "conforming-shell", "topologyRationale": "A partial sheath ring hugging the eyeball's rear and upper - a thin shell following the ball beneath it, with no volume of its own. Measured ASYMMETRIC: at y=130 the sclera arc is 24 px laterally against 10 px medially, so the ring is thicker outboard and reads as a hooded outer lid. Building it symmetric loses that read.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-l", "attachment": {"parentId": "eyestalk-l", "parentSocket": "eyestalk-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "overlap", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Wraps the ball; covers the stalk/ball join, which is why the true stalk length is unobservable in the reference."}, "dimensions": {"width": 0.196, "height": 0.192, "depth": 0.15, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.132, 0.592, 0.055], "rotation": [0.0, 0.0, 0.0], "scale": [0.196, 0.192, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Thicker on the lateral side by a factor of 2.4."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-collar-ring"], "fidelityTier": "blockout", "builtAs": "collar-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(203, 58, 39, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Same cuticle as the stalk.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_collar_l_7.add(mesh_collar_l_7);
  meshes["collar-l"] = mesh_collar_l_7;
  colliders["collar-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_eyeball_l_8 = makeAttachmentEndpoint(null);
  const node_eyeball_l_8 = new THREE.Group();
  node_eyeball_l_8.name = "eyeball (l)__pivot";
  node_eyeball_l_8.scale.set(1, 1, 1);
  if (endpoint_eyeball_l_8) {
    node_eyeball_l_8.position.copy(endpoint_eyeball_l_8.start);
    node_eyeball_l_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eyeball_l_8.position.set(0.128, 0.588, 0.075);
    node_eyeball_l_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_eyeball_l_8.userData.sculptComponent = {"id": "eyeball-l", "name": "eyeball (l)", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A smooth sphere - the one place in the subject where a primitive sphere is literally correct. Diameter 0.183 = 0.326 CW, nearly a third of the body width: the chibi read, measured not assumed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-l", "attachment": {"parentId": "eyestalk-l", "parentSocket": "eyestalk-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Sunk onto the stalk crown so the ball never floats off it."}, "dimensions": {"width": 0.183, "height": 0.183, "depth": 0.183, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.128, 0.588, 0.075], "rotation": [0.0, 0.0, 0.0], "scale": [0.183, 0.183, 0.183]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Kept SOLID in the eaten state - the eyes are what the player tracks as an eaten enemy runs home."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyeball-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 241, 234, 1.0)", "secondaryAlbedo": "rgba(182, 162, 161, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-white; the shaded lateral arc measures #B6A2A1.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyeball_l_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyestalk-l"] ?? root).add(node_eyeball_l_8);
  nodes["eyeball-l"] = node_eyeball_l_8;
  const mesh_eyeball_l_8Geometry = endpoint_eyeball_l_8
    ? new THREE.CylinderGeometry(endpoint_eyeball_l_8.endRadius, endpoint_eyeball_l_8.baseRadius, endpoint_eyeball_l_8.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eyeball_l_8) {
    mesh_eyeball_l_8Geometry.scale(0.183, 0.183, 0.183);
  }
  const mesh_eyeball_l_8 = new THREE.Mesh(
    mesh_eyeball_l_8Geometry,
    materialMap["sclera"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eyeball_l_8.name = "eyeball (l)";
  if (endpoint_eyeball_l_8) {
    mesh_eyeball_l_8.position.copy(endpoint_eyeball_l_8.midpoint);
    mesh_eyeball_l_8.quaternion.copy(endpoint_eyeball_l_8.quaternion);
  }
  mesh_eyeball_l_8.castShadow = options.castShadow ?? true;
  mesh_eyeball_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_eyeball_l_8.userData.sculptComponent = {"id": "eyeball-l", "name": "eyeball (l)", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A smooth sphere - the one place in the subject where a primitive sphere is literally correct. Diameter 0.183 = 0.326 CW, nearly a third of the body width: the chibi read, measured not assumed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-l", "attachment": {"parentId": "eyestalk-l", "parentSocket": "eyestalk-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Sunk onto the stalk crown so the ball never floats off it."}, "dimensions": {"width": 0.183, "height": 0.183, "depth": 0.183, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.128, 0.588, 0.075], "rotation": [0.0, 0.0, 0.0], "scale": [0.183, 0.183, 0.183]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Kept SOLID in the eaten state - the eyes are what the player tracks as an eaten enemy runs home."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyeball-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 241, 234, 1.0)", "secondaryAlbedo": "rgba(182, 162, 161, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-white; the shaded lateral arc measures #B6A2A1.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyeball_l_8.add(mesh_eyeball_l_8);
  meshes["eyeball-l"] = mesh_eyeball_l_8;
  colliders["eyeball-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_iris_ring_l_9 = makeAttachmentEndpoint(null);
  const node_iris_ring_l_9 = new THREE.Group();
  node_iris_ring_l_9.name = "iris cyan ring (l)__pivot";
  node_iris_ring_l_9.scale.set(1, 1, 1);
  if (endpoint_iris_ring_l_9) {
    node_iris_ring_l_9.position.copy(endpoint_iris_ring_l_9.start);
    node_iris_ring_l_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_iris_ring_l_9.position.set(0.1166, 0.582, 0.157);
    node_iris_ring_l_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_iris_ring_l_9.userData.sculptComponent = {"id": "iris-ring-l", "name": "iris cyan ring (l)", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "material-only", "topologyRationale": "An annulus riding on the eyeball's front surface. No independent footprint - decision tree step 1 - so any carrier primitive is acceptable; built as a flush theta-limited cap ring so it hugs the ball at any pupil rotation.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-l", "attachment": {"parentId": "eyeball-l", "parentSocket": "eyeball-anterior-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.006], "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.001, "confidence": 0.75, "notes": "Flush cap on the ball, never a floating disc."}, "dimensions": {"width": 0.0914, "height": 0.0914, "depth": 0.012, "units": "world (1 unit = 1 maze tile)", "confidence": 0.75}, "transform": {"position": [0.1166, 0.582, 0.157], "rotation": [0.0, 0.0, 0.0], "scale": [0.0914, 0.0914, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "irisCyan", "materialLayers": ["irisCyan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The only cool hue in an entirely warm subject."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-cyan-ring", "iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "iris-ring-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 198, 238, 1.0)", "secondaryAlbedo": "rgba(30, 196, 236, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid cyan, read mainly as a lower crescent because the upper arc sits in the collar's shade.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_iris_ring_l_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyeball-l"] ?? root).add(node_iris_ring_l_9);
  nodes["iris-ring-l"] = node_iris_ring_l_9;
  const mesh_iris_ring_l_9Geometry = endpoint_iris_ring_l_9
    ? new THREE.CylinderGeometry(endpoint_iris_ring_l_9.endRadius, endpoint_iris_ring_l_9.baseRadius, endpoint_iris_ring_l_9.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.08, 12, 48);
  if (!endpoint_iris_ring_l_9) {
    mesh_iris_ring_l_9Geometry.scale(0.0914, 0.0914, 0.012);
  }
  const mesh_iris_ring_l_9 = new THREE.Mesh(
    mesh_iris_ring_l_9Geometry,
    materialMap["irisCyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_iris_ring_l_9.name = "iris cyan ring (l)";
  if (endpoint_iris_ring_l_9) {
    mesh_iris_ring_l_9.position.copy(endpoint_iris_ring_l_9.midpoint);
    mesh_iris_ring_l_9.quaternion.copy(endpoint_iris_ring_l_9.quaternion);
  }
  mesh_iris_ring_l_9.castShadow = options.castShadow ?? true;
  mesh_iris_ring_l_9.receiveShadow = options.receiveShadow ?? true;
  mesh_iris_ring_l_9.userData.sculptComponent = {"id": "iris-ring-l", "name": "iris cyan ring (l)", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "material-only", "topologyRationale": "An annulus riding on the eyeball's front surface. No independent footprint - decision tree step 1 - so any carrier primitive is acceptable; built as a flush theta-limited cap ring so it hugs the ball at any pupil rotation.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-l", "attachment": {"parentId": "eyeball-l", "parentSocket": "eyeball-anterior-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.006], "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.001, "confidence": 0.75, "notes": "Flush cap on the ball, never a floating disc."}, "dimensions": {"width": 0.0914, "height": 0.0914, "depth": 0.012, "units": "world (1 unit = 1 maze tile)", "confidence": 0.75}, "transform": {"position": [0.1166, 0.582, 0.157], "rotation": [0.0, 0.0, 0.0], "scale": [0.0914, 0.0914, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "irisCyan", "materialLayers": ["irisCyan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The only cool hue in an entirely warm subject."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-cyan-ring", "iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "iris-ring-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 198, 238, 1.0)", "secondaryAlbedo": "rgba(30, 196, 236, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid cyan, read mainly as a lower crescent because the upper arc sits in the collar's shade.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_iris_ring_l_9.add(mesh_iris_ring_l_9);
  meshes["iris-ring-l"] = mesh_iris_ring_l_9;
  colliders["iris-ring-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_pupil_l_10 = makeAttachmentEndpoint(null);
  const node_pupil_l_10 = new THREE.Group();
  node_pupil_l_10.name = "pupil (l)__pivot";
  node_pupil_l_10.scale.set(1, 1, 1);
  if (endpoint_pupil_l_10) {
    node_pupil_l_10.position.copy(endpoint_pupil_l_10.start);
    node_pupil_l_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pupil_l_10.position.set(0.1166, 0.582, 0.16);
    node_pupil_l_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_pupil_l_10.userData.sculptComponent = {"id": "pupil-l", "name": "pupil (l)", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "A flush decal CAP on the eyeball, not a ball sunk into it. The consumer rotates its pivot to dart the eye; a cap cannot be translated without leaving the surface, which is why every enemy in this game shares the rotate-the-pivot convention.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-l", "attachment": {"parentId": "eyeball-l", "parentSocket": "eyeball-anterior-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.005], "contactType": "flush", "embedDepth": 0.003, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Pivot is at the BALL CENTRE so rotating it sweeps the cap across the surface while it stays perfectly flush."}, "dimensions": {"width": 0.064, "height": 0.064, "depth": 0.01, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.1166, 0.582, 0.16], "rotation": [0.0, 0.0, 0.0], "scale": [0.064, 0.064, 0.01]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.1166, -0.582, -0.157], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupilNavy", "materialLayers": ["pupilNavy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "medialOffset", "kind": "decal", "description": "Iris/pupil set 0.0114 medially off the ball centre so both eyes converge on the viewer. Measured: ball centre x 205, iris centre x 212 for the reference's left eye.", "detailRef": "iris-medial-offset"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'pupil-pivot-l/r' - required by the consumer's applyGhostState."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "pupil-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 36, 80, 1.0)", "secondaryAlbedo": "rgba(30, 2, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Dark navy pupil core, measured #1B2653 / #1E0211.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_pupil_l_10.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.1166, -0.582, -0.157], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyeball-l"] ?? root).add(node_pupil_l_10);
  nodes["pupil-l"] = node_pupil_l_10;
  const mesh_pupil_l_10Geometry = endpoint_pupil_l_10
    ? new THREE.CylinderGeometry(endpoint_pupil_l_10.endRadius, endpoint_pupil_l_10.baseRadius, endpoint_pupil_l_10.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_pupil_l_10) {
    mesh_pupil_l_10Geometry.scale(0.064, 0.064, 0.01);
  }
  const mesh_pupil_l_10 = new THREE.Mesh(
    mesh_pupil_l_10Geometry,
    materialMap["pupilNavy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pupil_l_10.name = "pupil (l)";
  if (endpoint_pupil_l_10) {
    mesh_pupil_l_10.position.copy(endpoint_pupil_l_10.midpoint);
    mesh_pupil_l_10.quaternion.copy(endpoint_pupil_l_10.quaternion);
  }
  mesh_pupil_l_10.castShadow = options.castShadow ?? true;
  mesh_pupil_l_10.receiveShadow = options.receiveShadow ?? true;
  mesh_pupil_l_10.userData.sculptComponent = {"id": "pupil-l", "name": "pupil (l)", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "A flush decal CAP on the eyeball, not a ball sunk into it. The consumer rotates its pivot to dart the eye; a cap cannot be translated without leaving the surface, which is why every enemy in this game shares the rotate-the-pivot convention.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-l", "attachment": {"parentId": "eyeball-l", "parentSocket": "eyeball-anterior-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.005], "contactType": "flush", "embedDepth": 0.003, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Pivot is at the BALL CENTRE so rotating it sweeps the cap across the surface while it stays perfectly flush."}, "dimensions": {"width": 0.064, "height": 0.064, "depth": 0.01, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.1166, 0.582, 0.16], "rotation": [0.0, 0.0, 0.0], "scale": [0.064, 0.064, 0.01]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.1166, -0.582, -0.157], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupilNavy", "materialLayers": ["pupilNavy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "medialOffset", "kind": "decal", "description": "Iris/pupil set 0.0114 medially off the ball centre so both eyes converge on the viewer. Measured: ball centre x 205, iris centre x 212 for the reference's left eye.", "detailRef": "iris-medial-offset"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'pupil-pivot-l/r' - required by the consumer's applyGhostState."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "pupil-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 36, 80, 1.0)", "secondaryAlbedo": "rgba(30, 2, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Dark navy pupil core, measured #1B2653 / #1E0211.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_pupil_l_10.add(mesh_pupil_l_10);
  meshes["pupil-l"] = mesh_pupil_l_10;
  colliders["pupil-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_glint_l_11 = makeAttachmentEndpoint(null);
  const node_glint_l_11 = new THREE.Group();
  node_glint_l_11.name = "catchlight (l)__pivot";
  node_glint_l_11.scale.set(1, 1, 1);
  if (endpoint_glint_l_11) {
    node_glint_l_11.position.copy(endpoint_glint_l_11.start);
    node_glint_l_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glint_l_11.position.set(0.1606, 0.6173, 0.151);
    node_glint_l_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_glint_l_11.userData.sculptComponent = {"id": "glint-l", "name": "catchlight (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "One small blown highlight per eye, upper-OUTER quadrant. It is a lighting artefact in the drawing, not albedo, and it is built as UNLIT geometry: a toon ramp quantises a real highlight into the same band as everything else facing the light, so a lit glint stops reading as a catchlight. This is the project's one deliberate exception to cel shading.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-l", "attachment": {"parentId": "eyeball-l", "parentSocket": "eyeball-anterior-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.003], "contactType": "flush", "embedDepth": 0.002, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Sits on the ball at radius 0.088 of 0.0915 so it never detaches."}, "dimensions": {"width": 0.022, "height": 0.022, "depth": 0.022, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.1606, 0.6173, 0.151], "rotation": [0.0, 0.0, 0.0], "scale": [0.022, 0.022, 0.022]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glintWhite", "materialLayers": ["glintWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "catchlight", "kind": "gloss", "description": "One blown highlight, upper-outer quadrant, sitting on the ball at radius 0.088 of 0.0915. Built UNLIT because a toon ramp quantises a real highlight into the same band as everything else facing the light.", "detailRef": "eye-glint"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Disproportionately important for looks-alive - the character contract says so and the project has already learned it."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-glint"], "fidelityTier": "blockout", "builtAs": "glint-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Unlit white. MeshBasicMaterial, never toon.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_glint_l_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyeball-l"] ?? root).add(node_glint_l_11);
  nodes["glint-l"] = node_glint_l_11;
  const mesh_glint_l_11Geometry = endpoint_glint_l_11
    ? new THREE.CylinderGeometry(endpoint_glint_l_11.endRadius, endpoint_glint_l_11.baseRadius, endpoint_glint_l_11.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_glint_l_11) {
    mesh_glint_l_11Geometry.scale(0.022, 0.022, 0.022);
  }
  const mesh_glint_l_11 = new THREE.Mesh(
    mesh_glint_l_11Geometry,
    materialMap["glintWhite"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glint_l_11.name = "catchlight (l)";
  if (endpoint_glint_l_11) {
    mesh_glint_l_11.position.copy(endpoint_glint_l_11.midpoint);
    mesh_glint_l_11.quaternion.copy(endpoint_glint_l_11.quaternion);
  }
  mesh_glint_l_11.castShadow = options.castShadow ?? true;
  mesh_glint_l_11.receiveShadow = options.receiveShadow ?? true;
  mesh_glint_l_11.userData.sculptComponent = {"id": "glint-l", "name": "catchlight (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "One small blown highlight per eye, upper-OUTER quadrant. It is a lighting artefact in the drawing, not albedo, and it is built as UNLIT geometry: a toon ramp quantises a real highlight into the same band as everything else facing the light, so a lit glint stops reading as a catchlight. This is the project's one deliberate exception to cel shading.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-l", "attachment": {"parentId": "eyeball-l", "parentSocket": "eyeball-anterior-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.003], "contactType": "flush", "embedDepth": 0.002, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Sits on the ball at radius 0.088 of 0.0915 so it never detaches."}, "dimensions": {"width": 0.022, "height": 0.022, "depth": 0.022, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.1606, 0.6173, 0.151], "rotation": [0.0, 0.0, 0.0], "scale": [0.022, 0.022, 0.022]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glintWhite", "materialLayers": ["glintWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "catchlight", "kind": "gloss", "description": "One blown highlight, upper-outer quadrant, sitting on the ball at radius 0.088 of 0.0915. Built UNLIT because a toon ramp quantises a real highlight into the same band as everything else facing the light.", "detailRef": "eye-glint"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Disproportionately important for looks-alive - the character contract says so and the project has already learned it."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-glint"], "fidelityTier": "blockout", "builtAs": "glint-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Unlit white. MeshBasicMaterial, never toon.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_glint_l_11.add(mesh_glint_l_11);
  meshes["glint-l"] = mesh_glint_l_11;
  colliders["glint-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_brow_l_12 = {"parentId": "eyestalk-l", "parentSocket": "collar-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.016, 0.0], "contactType": "butt", "embedDepth": 0.006, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Rests on the collar crown with a small embed so no daylight shows under it."};
  const endpoint_brow_l_12 = makeAttachmentEndpoint(attachment_brow_l_12);
  const node_brow_l_12 = new THREE.Group();
  node_brow_l_12.name = "brow lozenge (l)__pivot";
  node_brow_l_12.scale.set(1, 1, 1);
  if (endpoint_brow_l_12) {
    node_brow_l_12.position.copy(endpoint_brow_l_12.start);
    node_brow_l_12.rotation.set(-0.18, 0.0, 0.14);
  } else {
    node_brow_l_12.position.set(0.128, 0.6805, 0.058);
    node_brow_l_12.rotation.set(-0.18, 0.0, 0.14);
  }
  node_brow_l_12.userData.sculptComponent = {"id": "brow-l", "name": "brow lozenge (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A flattened solid resting on the eyestalk crown. GEOMETRY, not a marking: measured 49x20 px (aspect 2.45) with its own silhouette against the sky above the eye. Identity rank 3.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-l", "attachment": {"parentId": "eyestalk-l", "parentSocket": "collar-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.016, 0.0], "contactType": "butt", "embedDepth": 0.006, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Rests on the collar crown with a small embed so no daylight shows under it."}, "dimensions": {"width": 0.0795, "height": 0.0325, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.128, 0.6805, 0.058], "rotation": [-0.18, 0.0, 0.14], "scale": [0.0795, 0.0325, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "browDark", "materialLayers": ["browDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Deliberately NOT in accentMats - two small dark lozenges that carry the face read must not turn frightened-blue with the body."}, "evidenceRefs": ["zone-r0c1"], "details": ["brow-lozenge"], "fidelityTier": "blockout", "builtAs": "brow-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 20, 16, 1.0)", "secondaryAlbedo": "rgba(64, 3, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-black with a red-maroon cast. Measured #400315 / #45000A - never a neutral black.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_brow_l_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyestalk-l"] ?? root).add(node_brow_l_12);
  nodes["brow-l"] = node_brow_l_12;
  const mesh_brow_l_12Geometry = endpoint_brow_l_12
    ? new THREE.CylinderGeometry(endpoint_brow_l_12.endRadius, endpoint_brow_l_12.baseRadius, endpoint_brow_l_12.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_brow_l_12) {
    mesh_brow_l_12Geometry.scale(0.0795, 0.0325, 0.055);
  }
  const mesh_brow_l_12 = new THREE.Mesh(
    mesh_brow_l_12Geometry,
    materialMap["browDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_l_12.name = "brow lozenge (l)";
  if (endpoint_brow_l_12) {
    mesh_brow_l_12.position.copy(endpoint_brow_l_12.midpoint);
    mesh_brow_l_12.quaternion.copy(endpoint_brow_l_12.quaternion);
  }
  mesh_brow_l_12.castShadow = options.castShadow ?? true;
  mesh_brow_l_12.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_l_12.userData.sculptComponent = {"id": "brow-l", "name": "brow lozenge (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A flattened solid resting on the eyestalk crown. GEOMETRY, not a marking: measured 49x20 px (aspect 2.45) with its own silhouette against the sky above the eye. Identity rank 3.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-l", "attachment": {"parentId": "eyestalk-l", "parentSocket": "collar-crown-l", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.016, 0.0], "contactType": "butt", "embedDepth": 0.006, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Rests on the collar crown with a small embed so no daylight shows under it."}, "dimensions": {"width": 0.0795, "height": 0.0325, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.128, 0.6805, 0.058], "rotation": [-0.18, 0.0, 0.14], "scale": [0.0795, 0.0325, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "browDark", "materialLayers": ["browDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Deliberately NOT in accentMats - two small dark lozenges that carry the face read must not turn frightened-blue with the body."}, "evidenceRefs": ["zone-r0c1"], "details": ["brow-lozenge"], "fidelityTier": "blockout", "builtAs": "brow-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 20, 16, 1.0)", "secondaryAlbedo": "rgba(64, 3, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-black with a red-maroon cast. Measured #400315 / #45000A - never a neutral black.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_brow_l_12.add(mesh_brow_l_12);
  meshes["brow-l"] = mesh_brow_l_12;
  colliders["brow-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_eyestalk_r_13 = {"parentId": "carapace", "parentSocket": "carapace-dorsal-anterior-r", "localStart": [-0.128, 0.474, 0.062], "localEnd": [-0.128, 0.549, 0.072], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the shell so no gap opens at the join when the stalk tilts. The pivot is at the SOCKET, not the centre, or the stalk would swing through the shell."};
  const endpoint_eyestalk_r_13 = makeAttachmentEndpoint(attachment_eyestalk_r_13);
  const node_eyestalk_r_13 = new THREE.Group();
  node_eyestalk_r_13.name = "eyestalk (r)__pivot";
  node_eyestalk_r_13.scale.set(1, 1, 1);
  if (endpoint_eyestalk_r_13) {
    node_eyestalk_r_13.position.copy(endpoint_eyestalk_r_13.start);
    node_eyestalk_r_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eyestalk_r_13.position.set(-0.128, 0.512, 0.068);
    node_eyestalk_r_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_eyestalk_r_13.userData.sculptComponent = {"id": "eyestalk-r", "name": "eyestalk (r)", "level": "macro", "role": "body", "importance": 0.5, "confidence": 0.3, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A short straight column with a simple circular section - genuinely a cylinder (decision tree step 4). Almost entirely hidden by the collar, which is why its length is derived from the eye-above-shell measurement rather than observed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-dorsal-anterior-r", "localStart": [-0.128, 0.474, 0.062], "localEnd": [-0.128, 0.549, 0.072], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the shell so no gap opens at the join when the stalk tilts. The pivot is at the SOCKET, not the centre, or the stalk would swing through the shell."}, "dimensions": {"width": 0.08, "height": 0.075, "depth": 0.08, "units": "world (1 unit = 1 maze tile)", "confidence": 0.3}, "transform": {"position": [-0.128, 0.512, 0.068], "rotation": [0.0, 0.0, 0.0], "scale": [0.08, 0.075, 0.08]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0, -0.038, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'eyestalk-l/r' - driven by the behaviour for the idle waggle."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyestalk-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 107, 72, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid limb red, the same cuticle as the arms and legs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyestalk_r_13.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0, -0.038, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_eyestalk_r_13);
  nodes["eyestalk-r"] = node_eyestalk_r_13;
  const mesh_eyestalk_r_13Geometry = endpoint_eyestalk_r_13
    ? new THREE.CylinderGeometry(endpoint_eyestalk_r_13.endRadius, endpoint_eyestalk_r_13.baseRadius, endpoint_eyestalk_r_13.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_eyestalk_r_13) {
    mesh_eyestalk_r_13Geometry.scale(0.08, 0.075, 0.08);
  }
  const mesh_eyestalk_r_13 = new THREE.Mesh(
    mesh_eyestalk_r_13Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eyestalk_r_13.name = "eyestalk (r)";
  if (endpoint_eyestalk_r_13) {
    mesh_eyestalk_r_13.position.copy(endpoint_eyestalk_r_13.midpoint);
    mesh_eyestalk_r_13.quaternion.copy(endpoint_eyestalk_r_13.quaternion);
  }
  mesh_eyestalk_r_13.castShadow = options.castShadow ?? true;
  mesh_eyestalk_r_13.receiveShadow = options.receiveShadow ?? true;
  mesh_eyestalk_r_13.userData.sculptComponent = {"id": "eyestalk-r", "name": "eyestalk (r)", "level": "macro", "role": "body", "importance": 0.5, "confidence": 0.3, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A short straight column with a simple circular section - genuinely a cylinder (decision tree step 4). Almost entirely hidden by the collar, which is why its length is derived from the eye-above-shell measurement rather than observed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-dorsal-anterior-r", "localStart": [-0.128, 0.474, 0.062], "localEnd": [-0.128, 0.549, 0.072], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the shell so no gap opens at the join when the stalk tilts. The pivot is at the SOCKET, not the centre, or the stalk would swing through the shell."}, "dimensions": {"width": 0.08, "height": 0.075, "depth": 0.08, "units": "world (1 unit = 1 maze tile)", "confidence": 0.3}, "transform": {"position": [-0.128, 0.512, 0.068], "rotation": [0.0, 0.0, 0.0], "scale": [0.08, 0.075, 0.08]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0, -0.038, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'eyestalk-l/r' - driven by the behaviour for the idle waggle."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyestalk-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 107, 72, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid limb red, the same cuticle as the arms and legs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyestalk_r_13.add(mesh_eyestalk_r_13);
  meshes["eyestalk-r"] = mesh_eyestalk_r_13;
  colliders["eyestalk-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_collar_r_14 = makeAttachmentEndpoint(null);
  const node_collar_r_14 = new THREE.Group();
  node_collar_r_14.name = "eye collar (r)__pivot";
  node_collar_r_14.scale.set(1, 1, 1);
  if (endpoint_collar_r_14) {
    node_collar_r_14.position.copy(endpoint_collar_r_14.start);
    node_collar_r_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_collar_r_14.position.set(-0.132, 0.592, 0.055);
    node_collar_r_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_collar_r_14.userData.sculptComponent = {"id": "collar-r", "name": "eye collar (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "torus", "topologyClass": "conforming-shell", "topologyRationale": "A partial sheath ring hugging the eyeball's rear and upper - a thin shell following the ball beneath it, with no volume of its own. Measured ASYMMETRIC: at y=130 the sclera arc is 24 px laterally against 10 px medially, so the ring is thicker outboard and reads as a hooded outer lid. Building it symmetric loses that read.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-r", "attachment": {"parentId": "eyestalk-r", "parentSocket": "eyestalk-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "overlap", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Wraps the ball; covers the stalk/ball join, which is why the true stalk length is unobservable in the reference."}, "dimensions": {"width": 0.196, "height": 0.192, "depth": 0.15, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.132, 0.592, 0.055], "rotation": [0.0, 0.0, 0.0], "scale": [0.196, 0.192, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Thicker on the lateral side by a factor of 2.4."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-collar-ring"], "fidelityTier": "blockout", "builtAs": "collar-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(203, 58, 39, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Same cuticle as the stalk.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_collar_r_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyestalk-r"] ?? root).add(node_collar_r_14);
  nodes["collar-r"] = node_collar_r_14;
  const mesh_collar_r_14Geometry = endpoint_collar_r_14
    ? new THREE.CylinderGeometry(endpoint_collar_r_14.endRadius, endpoint_collar_r_14.baseRadius, endpoint_collar_r_14.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.08, 12, 48);
  if (!endpoint_collar_r_14) {
    mesh_collar_r_14Geometry.scale(0.196, 0.192, 0.15);
  }
  const mesh_collar_r_14 = new THREE.Mesh(
    mesh_collar_r_14Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_collar_r_14.name = "eye collar (r)";
  if (endpoint_collar_r_14) {
    mesh_collar_r_14.position.copy(endpoint_collar_r_14.midpoint);
    mesh_collar_r_14.quaternion.copy(endpoint_collar_r_14.quaternion);
  }
  mesh_collar_r_14.castShadow = options.castShadow ?? true;
  mesh_collar_r_14.receiveShadow = options.receiveShadow ?? true;
  mesh_collar_r_14.userData.sculptComponent = {"id": "collar-r", "name": "eye collar (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.8, "primitive": "torus", "topologyClass": "conforming-shell", "topologyRationale": "A partial sheath ring hugging the eyeball's rear and upper - a thin shell following the ball beneath it, with no volume of its own. Measured ASYMMETRIC: at y=130 the sclera arc is 24 px laterally against 10 px medially, so the ring is thicker outboard and reads as a hooded outer lid. Building it symmetric loses that read.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-r", "attachment": {"parentId": "eyestalk-r", "parentSocket": "eyestalk-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "overlap", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Wraps the ball; covers the stalk/ball join, which is why the true stalk length is unobservable in the reference."}, "dimensions": {"width": 0.196, "height": 0.192, "depth": 0.15, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.132, 0.592, 0.055], "rotation": [0.0, 0.0, 0.0], "scale": [0.196, 0.192, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Thicker on the lateral side by a factor of 2.4."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-collar-ring"], "fidelityTier": "blockout", "builtAs": "collar-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(203, 58, 39, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Same cuticle as the stalk.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_collar_r_14.add(mesh_collar_r_14);
  meshes["collar-r"] = mesh_collar_r_14;
  colliders["collar-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_eyeball_r_15 = makeAttachmentEndpoint(null);
  const node_eyeball_r_15 = new THREE.Group();
  node_eyeball_r_15.name = "eyeball (r)__pivot";
  node_eyeball_r_15.scale.set(1, 1, 1);
  if (endpoint_eyeball_r_15) {
    node_eyeball_r_15.position.copy(endpoint_eyeball_r_15.start);
    node_eyeball_r_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eyeball_r_15.position.set(-0.128, 0.588, 0.075);
    node_eyeball_r_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_eyeball_r_15.userData.sculptComponent = {"id": "eyeball-r", "name": "eyeball (r)", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A smooth sphere - the one place in the subject where a primitive sphere is literally correct. Diameter 0.183 = 0.326 CW, nearly a third of the body width: the chibi read, measured not assumed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-r", "attachment": {"parentId": "eyestalk-r", "parentSocket": "eyestalk-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Sunk onto the stalk crown so the ball never floats off it."}, "dimensions": {"width": 0.183, "height": 0.183, "depth": 0.183, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.128, 0.588, 0.075], "rotation": [0.0, 0.0, 0.0], "scale": [0.183, 0.183, 0.183]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Kept SOLID in the eaten state - the eyes are what the player tracks as an eaten enemy runs home."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyeball-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 241, 234, 1.0)", "secondaryAlbedo": "rgba(182, 162, 161, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-white; the shaded lateral arc measures #B6A2A1.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyeball_r_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyestalk-r"] ?? root).add(node_eyeball_r_15);
  nodes["eyeball-r"] = node_eyeball_r_15;
  const mesh_eyeball_r_15Geometry = endpoint_eyeball_r_15
    ? new THREE.CylinderGeometry(endpoint_eyeball_r_15.endRadius, endpoint_eyeball_r_15.baseRadius, endpoint_eyeball_r_15.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eyeball_r_15) {
    mesh_eyeball_r_15Geometry.scale(0.183, 0.183, 0.183);
  }
  const mesh_eyeball_r_15 = new THREE.Mesh(
    mesh_eyeball_r_15Geometry,
    materialMap["sclera"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eyeball_r_15.name = "eyeball (r)";
  if (endpoint_eyeball_r_15) {
    mesh_eyeball_r_15.position.copy(endpoint_eyeball_r_15.midpoint);
    mesh_eyeball_r_15.quaternion.copy(endpoint_eyeball_r_15.quaternion);
  }
  mesh_eyeball_r_15.castShadow = options.castShadow ?? true;
  mesh_eyeball_r_15.receiveShadow = options.receiveShadow ?? true;
  mesh_eyeball_r_15.userData.sculptComponent = {"id": "eyeball-r", "name": "eyeball (r)", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A smooth sphere - the one place in the subject where a primitive sphere is literally correct. Diameter 0.183 = 0.326 CW, nearly a third of the body width: the chibi read, measured not assumed.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-r", "attachment": {"parentId": "eyestalk-r", "parentSocket": "eyestalk-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.076, 0.007], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Sunk onto the stalk crown so the ball never floats off it."}, "dimensions": {"width": 0.183, "height": 0.183, "depth": 0.183, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.128, 0.588, 0.075], "rotation": [0.0, 0.0, 0.0], "scale": [0.183, 0.183, 0.183]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Kept SOLID in the eaten state - the eyes are what the player tracks as an eaten enemy runs home."}, "evidenceRefs": ["zone-r0c1"], "details": [], "fidelityTier": "blockout", "builtAs": "eyeball-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 241, 234, 1.0)", "secondaryAlbedo": "rgba(182, 162, 161, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-white; the shaded lateral arc measures #B6A2A1.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_eyeball_r_15.add(mesh_eyeball_r_15);
  meshes["eyeball-r"] = mesh_eyeball_r_15;
  colliders["eyeball-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_iris_ring_r_16 = makeAttachmentEndpoint(null);
  const node_iris_ring_r_16 = new THREE.Group();
  node_iris_ring_r_16.name = "iris cyan ring (r)__pivot";
  node_iris_ring_r_16.scale.set(1, 1, 1);
  if (endpoint_iris_ring_r_16) {
    node_iris_ring_r_16.position.copy(endpoint_iris_ring_r_16.start);
    node_iris_ring_r_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_iris_ring_r_16.position.set(-0.1166, 0.582, 0.157);
    node_iris_ring_r_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_iris_ring_r_16.userData.sculptComponent = {"id": "iris-ring-r", "name": "iris cyan ring (r)", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "material-only", "topologyRationale": "An annulus riding on the eyeball's front surface. No independent footprint - decision tree step 1 - so any carrier primitive is acceptable; built as a flush theta-limited cap ring so it hugs the ball at any pupil rotation.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-r", "attachment": {"parentId": "eyeball-r", "parentSocket": "eyeball-anterior-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.006], "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.001, "confidence": 0.75, "notes": "Flush cap on the ball, never a floating disc."}, "dimensions": {"width": 0.0914, "height": 0.0914, "depth": 0.012, "units": "world (1 unit = 1 maze tile)", "confidence": 0.75}, "transform": {"position": [-0.1166, 0.582, 0.157], "rotation": [0.0, 0.0, 0.0], "scale": [0.0914, 0.0914, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "irisCyan", "materialLayers": ["irisCyan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The only cool hue in an entirely warm subject."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-cyan-ring", "iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "iris-ring-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 198, 238, 1.0)", "secondaryAlbedo": "rgba(30, 196, 236, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid cyan, read mainly as a lower crescent because the upper arc sits in the collar's shade.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_iris_ring_r_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyeball-r"] ?? root).add(node_iris_ring_r_16);
  nodes["iris-ring-r"] = node_iris_ring_r_16;
  const mesh_iris_ring_r_16Geometry = endpoint_iris_ring_r_16
    ? new THREE.CylinderGeometry(endpoint_iris_ring_r_16.endRadius, endpoint_iris_ring_r_16.baseRadius, endpoint_iris_ring_r_16.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.08, 12, 48);
  if (!endpoint_iris_ring_r_16) {
    mesh_iris_ring_r_16Geometry.scale(0.0914, 0.0914, 0.012);
  }
  const mesh_iris_ring_r_16 = new THREE.Mesh(
    mesh_iris_ring_r_16Geometry,
    materialMap["irisCyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_iris_ring_r_16.name = "iris cyan ring (r)";
  if (endpoint_iris_ring_r_16) {
    mesh_iris_ring_r_16.position.copy(endpoint_iris_ring_r_16.midpoint);
    mesh_iris_ring_r_16.quaternion.copy(endpoint_iris_ring_r_16.quaternion);
  }
  mesh_iris_ring_r_16.castShadow = options.castShadow ?? true;
  mesh_iris_ring_r_16.receiveShadow = options.receiveShadow ?? true;
  mesh_iris_ring_r_16.userData.sculptComponent = {"id": "iris-ring-r", "name": "iris cyan ring (r)", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "material-only", "topologyRationale": "An annulus riding on the eyeball's front surface. No independent footprint - decision tree step 1 - so any carrier primitive is acceptable; built as a flush theta-limited cap ring so it hugs the ball at any pupil rotation.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-r", "attachment": {"parentId": "eyeball-r", "parentSocket": "eyeball-anterior-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.006], "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.001, "confidence": 0.75, "notes": "Flush cap on the ball, never a floating disc."}, "dimensions": {"width": 0.0914, "height": 0.0914, "depth": 0.012, "units": "world (1 unit = 1 maze tile)", "confidence": 0.75}, "transform": {"position": [-0.1166, 0.582, 0.157], "rotation": [0.0, 0.0, 0.0], "scale": [0.0914, 0.0914, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "irisCyan", "materialLayers": ["irisCyan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "The only cool hue in an entirely warm subject."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-cyan-ring", "iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "iris-ring-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 198, 238, 1.0)", "secondaryAlbedo": "rgba(30, 196, 236, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid cyan, read mainly as a lower crescent because the upper arc sits in the collar's shade.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_iris_ring_r_16.add(mesh_iris_ring_r_16);
  meshes["iris-ring-r"] = mesh_iris_ring_r_16;
  colliders["iris-ring-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_pupil_r_17 = makeAttachmentEndpoint(null);
  const node_pupil_r_17 = new THREE.Group();
  node_pupil_r_17.name = "pupil (r)__pivot";
  node_pupil_r_17.scale.set(1, 1, 1);
  if (endpoint_pupil_r_17) {
    node_pupil_r_17.position.copy(endpoint_pupil_r_17.start);
    node_pupil_r_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pupil_r_17.position.set(-0.1166, 0.582, 0.16);
    node_pupil_r_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_pupil_r_17.userData.sculptComponent = {"id": "pupil-r", "name": "pupil (r)", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "A flush decal CAP on the eyeball, not a ball sunk into it. The consumer rotates its pivot to dart the eye; a cap cannot be translated without leaving the surface, which is why every enemy in this game shares the rotate-the-pivot convention.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-r", "attachment": {"parentId": "eyeball-r", "parentSocket": "eyeball-anterior-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.005], "contactType": "flush", "embedDepth": 0.003, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Pivot is at the BALL CENTRE so rotating it sweeps the cap across the surface while it stays perfectly flush."}, "dimensions": {"width": 0.064, "height": 0.064, "depth": 0.01, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.1166, 0.582, 0.16], "rotation": [0.0, 0.0, 0.0], "scale": [0.064, 0.064, 0.01]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.1166, -0.582, -0.157], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupilNavy", "materialLayers": ["pupilNavy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "medialOffset", "kind": "decal", "description": "Iris/pupil set 0.0114 medially off the ball centre so both eyes converge on the viewer. Measured: ball centre x 205, iris centre x 212 for the reference's left eye.", "detailRef": "iris-medial-offset"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'pupil-pivot-l/r' - required by the consumer's applyGhostState."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "pupil-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 36, 80, 1.0)", "secondaryAlbedo": "rgba(30, 2, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Dark navy pupil core, measured #1B2653 / #1E0211.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_pupil_r_17.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.1166, -0.582, -0.157], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyeball-r"] ?? root).add(node_pupil_r_17);
  nodes["pupil-r"] = node_pupil_r_17;
  const mesh_pupil_r_17Geometry = endpoint_pupil_r_17
    ? new THREE.CylinderGeometry(endpoint_pupil_r_17.endRadius, endpoint_pupil_r_17.baseRadius, endpoint_pupil_r_17.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_pupil_r_17) {
    mesh_pupil_r_17Geometry.scale(0.064, 0.064, 0.01);
  }
  const mesh_pupil_r_17 = new THREE.Mesh(
    mesh_pupil_r_17Geometry,
    materialMap["pupilNavy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pupil_r_17.name = "pupil (r)";
  if (endpoint_pupil_r_17) {
    mesh_pupil_r_17.position.copy(endpoint_pupil_r_17.midpoint);
    mesh_pupil_r_17.quaternion.copy(endpoint_pupil_r_17.quaternion);
  }
  mesh_pupil_r_17.castShadow = options.castShadow ?? true;
  mesh_pupil_r_17.receiveShadow = options.receiveShadow ?? true;
  mesh_pupil_r_17.userData.sculptComponent = {"id": "pupil-r", "name": "pupil (r)", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "A flush decal CAP on the eyeball, not a ball sunk into it. The consumer rotates its pivot to dart the eye; a cap cannot be translated without leaving the surface, which is why every enemy in this game shares the rotate-the-pivot convention.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-r", "attachment": {"parentId": "eyeball-r", "parentSocket": "eyeball-anterior-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.005], "contactType": "flush", "embedDepth": 0.003, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Pivot is at the BALL CENTRE so rotating it sweeps the cap across the surface while it stays perfectly flush."}, "dimensions": {"width": 0.064, "height": 0.064, "depth": 0.01, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.1166, 0.582, 0.16], "rotation": [0.0, 0.0, 0.0], "scale": [0.064, 0.064, 0.01]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.1166, -0.582, -0.157], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupilNavy", "materialLayers": ["pupilNavy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "medialOffset", "kind": "decal", "description": "Iris/pupil set 0.0114 medially off the ball centre so both eyes converge on the viewer. Measured: ball centre x 205, iris centre x 212 for the reference's left eye.", "detailRef": "iris-medial-offset"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'pupil-pivot-l/r' - required by the consumer's applyGhostState."}, "evidenceRefs": ["zone-r0c1"], "details": ["iris-medial-offset"], "fidelityTier": "blockout", "builtAs": "pupil-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 36, 80, 1.0)", "secondaryAlbedo": "rgba(30, 2, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Dark navy pupil core, measured #1B2653 / #1E0211.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_pupil_r_17.add(mesh_pupil_r_17);
  meshes["pupil-r"] = mesh_pupil_r_17;
  colliders["pupil-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_glint_r_18 = makeAttachmentEndpoint(null);
  const node_glint_r_18 = new THREE.Group();
  node_glint_r_18.name = "catchlight (r)__pivot";
  node_glint_r_18.scale.set(1, 1, 1);
  if (endpoint_glint_r_18) {
    node_glint_r_18.position.copy(endpoint_glint_r_18.start);
    node_glint_r_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glint_r_18.position.set(-0.1606, 0.6173, 0.151);
    node_glint_r_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_glint_r_18.userData.sculptComponent = {"id": "glint-r", "name": "catchlight (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "One small blown highlight per eye, upper-OUTER quadrant. It is a lighting artefact in the drawing, not albedo, and it is built as UNLIT geometry: a toon ramp quantises a real highlight into the same band as everything else facing the light, so a lit glint stops reading as a catchlight. This is the project's one deliberate exception to cel shading.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-r", "attachment": {"parentId": "eyeball-r", "parentSocket": "eyeball-anterior-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.003], "contactType": "flush", "embedDepth": 0.002, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Sits on the ball at radius 0.088 of 0.0915 so it never detaches."}, "dimensions": {"width": 0.022, "height": 0.022, "depth": 0.022, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.1606, 0.6173, 0.151], "rotation": [0.0, 0.0, 0.0], "scale": [0.022, 0.022, 0.022]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glintWhite", "materialLayers": ["glintWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "catchlight", "kind": "gloss", "description": "One blown highlight, upper-outer quadrant, sitting on the ball at radius 0.088 of 0.0915. Built UNLIT because a toon ramp quantises a real highlight into the same band as everything else facing the light.", "detailRef": "eye-glint"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Disproportionately important for looks-alive - the character contract says so and the project has already learned it."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-glint"], "fidelityTier": "blockout", "builtAs": "glint-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Unlit white. MeshBasicMaterial, never toon.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_glint_r_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyeball-r"] ?? root).add(node_glint_r_18);
  nodes["glint-r"] = node_glint_r_18;
  const mesh_glint_r_18Geometry = endpoint_glint_r_18
    ? new THREE.CylinderGeometry(endpoint_glint_r_18.endRadius, endpoint_glint_r_18.baseRadius, endpoint_glint_r_18.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_glint_r_18) {
    mesh_glint_r_18Geometry.scale(0.022, 0.022, 0.022);
  }
  const mesh_glint_r_18 = new THREE.Mesh(
    mesh_glint_r_18Geometry,
    materialMap["glintWhite"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glint_r_18.name = "catchlight (r)";
  if (endpoint_glint_r_18) {
    mesh_glint_r_18.position.copy(endpoint_glint_r_18.midpoint);
    mesh_glint_r_18.quaternion.copy(endpoint_glint_r_18.quaternion);
  }
  mesh_glint_r_18.castShadow = options.castShadow ?? true;
  mesh_glint_r_18.receiveShadow = options.receiveShadow ?? true;
  mesh_glint_r_18.userData.sculptComponent = {"id": "glint-r", "name": "catchlight (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.85, "primitive": "sphere", "topologyClass": "material-only", "topologyRationale": "One small blown highlight per eye, upper-OUTER quadrant. It is a lighting artefact in the drawing, not albedo, and it is built as UNLIT geometry: a toon ramp quantises a real highlight into the same band as everything else facing the light, so a lit glint stops reading as a catchlight. This is the project's one deliberate exception to cel shading.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyeball-r", "attachment": {"parentId": "eyeball-r", "parentSocket": "eyeball-anterior-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.003], "contactType": "flush", "embedDepth": 0.002, "gapTolerance": 0.001, "confidence": 0.85, "notes": "Sits on the ball at radius 0.088 of 0.0915 so it never detaches."}, "dimensions": {"width": 0.022, "height": 0.022, "depth": 0.022, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.1606, 0.6173, 0.151], "rotation": [0.0, 0.0, 0.0], "scale": [0.022, 0.022, 0.022]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glintWhite", "materialLayers": ["glintWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "catchlight", "kind": "gloss", "description": "One blown highlight, upper-outer quadrant, sitting on the ball at radius 0.088 of 0.0915. Built UNLIT because a toon ramp quantises a real highlight into the same band as everything else facing the light.", "detailRef": "eye-glint"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Disproportionately important for looks-alive - the character contract says so and the project has already learned it."}, "evidenceRefs": ["zone-r0c1"], "details": ["eye-glint"], "fidelityTier": "blockout", "builtAs": "glint-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Unlit white. MeshBasicMaterial, never toon.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_glint_r_18.add(mesh_glint_r_18);
  meshes["glint-r"] = mesh_glint_r_18;
  colliders["glint-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_brow_r_19 = {"parentId": "eyestalk-r", "parentSocket": "collar-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.016, 0.0], "contactType": "butt", "embedDepth": 0.006, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Rests on the collar crown with a small embed so no daylight shows under it."};
  const endpoint_brow_r_19 = makeAttachmentEndpoint(attachment_brow_r_19);
  const node_brow_r_19 = new THREE.Group();
  node_brow_r_19.name = "brow lozenge (r)__pivot";
  node_brow_r_19.scale.set(1, 1, 1);
  if (endpoint_brow_r_19) {
    node_brow_r_19.position.copy(endpoint_brow_r_19.start);
    node_brow_r_19.rotation.set(-0.18, 0.0, -0.14);
  } else {
    node_brow_r_19.position.set(-0.128, 0.6805, 0.058);
    node_brow_r_19.rotation.set(-0.18, 0.0, -0.14);
  }
  node_brow_r_19.userData.sculptComponent = {"id": "brow-r", "name": "brow lozenge (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A flattened solid resting on the eyestalk crown. GEOMETRY, not a marking: measured 49x20 px (aspect 2.45) with its own silhouette against the sky above the eye. Identity rank 3.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-r", "attachment": {"parentId": "eyestalk-r", "parentSocket": "collar-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.016, 0.0], "contactType": "butt", "embedDepth": 0.006, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Rests on the collar crown with a small embed so no daylight shows under it."}, "dimensions": {"width": 0.0795, "height": 0.0325, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.128, 0.6805, 0.058], "rotation": [-0.18, 0.0, -0.14], "scale": [0.0795, 0.0325, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "browDark", "materialLayers": ["browDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Deliberately NOT in accentMats - two small dark lozenges that carry the face read must not turn frightened-blue with the body."}, "evidenceRefs": ["zone-r0c1"], "details": ["brow-lozenge"], "fidelityTier": "blockout", "builtAs": "brow-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 20, 16, 1.0)", "secondaryAlbedo": "rgba(64, 3, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-black with a red-maroon cast. Measured #400315 / #45000A - never a neutral black.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_brow_r_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["eyestalk-r"] ?? root).add(node_brow_r_19);
  nodes["brow-r"] = node_brow_r_19;
  const mesh_brow_r_19Geometry = endpoint_brow_r_19
    ? new THREE.CylinderGeometry(endpoint_brow_r_19.endRadius, endpoint_brow_r_19.baseRadius, endpoint_brow_r_19.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_brow_r_19) {
    mesh_brow_r_19Geometry.scale(0.0795, 0.0325, 0.055);
  }
  const mesh_brow_r_19 = new THREE.Mesh(
    mesh_brow_r_19Geometry,
    materialMap["browDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_r_19.name = "brow lozenge (r)";
  if (endpoint_brow_r_19) {
    mesh_brow_r_19.position.copy(endpoint_brow_r_19.midpoint);
    mesh_brow_r_19.quaternion.copy(endpoint_brow_r_19.quaternion);
  }
  mesh_brow_r_19.castShadow = options.castShadow ?? true;
  mesh_brow_r_19.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_r_19.userData.sculptComponent = {"id": "brow-r", "name": "brow lozenge (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A flattened solid resting on the eyestalk crown. GEOMETRY, not a marking: measured 49x20 px (aspect 2.45) with its own silhouette against the sky above the eye. Identity rank 3.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eyestalk-r", "attachment": {"parentId": "eyestalk-r", "parentSocket": "collar-crown-r", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.016, 0.0], "contactType": "butt", "embedDepth": 0.006, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Rests on the collar crown with a small embed so no daylight shows under it."}, "dimensions": {"width": 0.0795, "height": 0.0325, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.128, 0.6805, 0.058], "rotation": [-0.18, 0.0, -0.14], "scale": [0.0795, 0.0325, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "browDark", "materialLayers": ["browDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Deliberately NOT in accentMats - two small dark lozenges that carry the face read must not turn frightened-blue with the body."}, "evidenceRefs": ["zone-r0c1"], "details": ["brow-lozenge"], "fidelityTier": "blockout", "builtAs": "brow-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 20, 16, 1.0)", "secondaryAlbedo": "rgba(64, 3, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Near-black with a red-maroon cast. Measured #400315 / #45000A - never a neutral black.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_brow_r_19.add(mesh_brow_r_19);
  meshes["brow-r"] = mesh_brow_r_19;
  colliders["brow-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_cheliped_merus_l_20 = {"parentId": "carapace", "parentSocket": "carapace-lateral-corner-l", "localStart": [0.239, 0.343, 0.03], "localEnd": [0.315, 0.3, 0.13], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Span 0.1328; capsule cylinder length 0.1328 with r=0.058 caps adding on top, so the segment reaches both joints."};
  const endpoint_cheliped_merus_l_20 = makeAttachmentEndpoint(attachment_cheliped_merus_l_20);
  const node_cheliped_merus_l_20 = new THREE.Group();
  node_cheliped_merus_l_20.name = "cheliped merus (l)__pivot";
  node_cheliped_merus_l_20.scale.set(1, 1, 1);
  if (endpoint_cheliped_merus_l_20) {
    node_cheliped_merus_l_20.position.copy(endpoint_cheliped_merus_l_20.start);
    node_cheliped_merus_l_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheliped_merus_l_20.position.set(0.277, 0.3215, 0.08);
    node_cheliped_merus_l_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheliped_merus_l_20.userData.sculptComponent = {"id": "cheliped-merus-l", "name": "cheliped merus (l)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.7, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered swept solid from the shell's lateral corner out and forward. Built as a tapered sweep whose capsule SPANS its full joint distance with half a radius of overlap at each end - never a fraction of the span with the round caps left to cover the rest. That shortcut shipped once on the flea's hind leg and rendered the limb in three separated pieces: CapsuleGeometry's length argument is the CYLINDER only.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-lateral-corner-l", "localStart": [0.239, 0.343, 0.03], "localEnd": [0.315, 0.3, 0.13], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Span 0.1328; capsule cylinder length 0.1328 with r=0.058 caps adding on top, so the segment reaches both joints."}, "dimensions": {"width": 0.116, "height": 0.1908, "depth": 0.116, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0.277, 0.3215, 0.08], "rotation": [0.0, 0.0, 0.0], "scale": [0.116, 0.1908, 0.116]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.038, 0.0215, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tuberclesDropped", "kind": "ridge", "description": "The one or two small bosses observed on the arm's outer face are DELIBERATELY NOT BUILT: at the game camera the arm is a handful of pixels, which puts them under the project's own 'nothing smaller than a couple of pixels' cartoon rule.", "detailRef": "arm-tubercle-pair"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'cheliped-l/r' - the whole arm swings from here."}, "evidenceRefs": ["zone-r1c0", "zone-r1c2"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid red, consistently more saturated and redder than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_merus_l_20.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.038, 0.0215, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_cheliped_merus_l_20);
  nodes["cheliped-merus-l"] = node_cheliped_merus_l_20;
  const mesh_cheliped_merus_l_20Geometry = endpoint_cheliped_merus_l_20
    ? new THREE.CylinderGeometry(endpoint_cheliped_merus_l_20.endRadius, endpoint_cheliped_merus_l_20.baseRadius, endpoint_cheliped_merus_l_20.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_cheliped_merus_l_20) {
    mesh_cheliped_merus_l_20Geometry.scale(0.116, 0.1908, 0.116);
  }
  const mesh_cheliped_merus_l_20 = new THREE.Mesh(
    mesh_cheliped_merus_l_20Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheliped_merus_l_20.name = "cheliped merus (l)";
  if (endpoint_cheliped_merus_l_20) {
    mesh_cheliped_merus_l_20.position.copy(endpoint_cheliped_merus_l_20.midpoint);
    mesh_cheliped_merus_l_20.quaternion.copy(endpoint_cheliped_merus_l_20.quaternion);
  }
  mesh_cheliped_merus_l_20.castShadow = options.castShadow ?? true;
  mesh_cheliped_merus_l_20.receiveShadow = options.receiveShadow ?? true;
  mesh_cheliped_merus_l_20.userData.sculptComponent = {"id": "cheliped-merus-l", "name": "cheliped merus (l)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.7, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered swept solid from the shell's lateral corner out and forward. Built as a tapered sweep whose capsule SPANS its full joint distance with half a radius of overlap at each end - never a fraction of the span with the round caps left to cover the rest. That shortcut shipped once on the flea's hind leg and rendered the limb in three separated pieces: CapsuleGeometry's length argument is the CYLINDER only.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-lateral-corner-l", "localStart": [0.239, 0.343, 0.03], "localEnd": [0.315, 0.3, 0.13], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Span 0.1328; capsule cylinder length 0.1328 with r=0.058 caps adding on top, so the segment reaches both joints."}, "dimensions": {"width": 0.116, "height": 0.1908, "depth": 0.116, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0.277, 0.3215, 0.08], "rotation": [0.0, 0.0, 0.0], "scale": [0.116, 0.1908, 0.116]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.038, 0.0215, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tuberclesDropped", "kind": "ridge", "description": "The one or two small bosses observed on the arm's outer face are DELIBERATELY NOT BUILT: at the game camera the arm is a handful of pixels, which puts them under the project's own 'nothing smaller than a couple of pixels' cartoon rule.", "detailRef": "arm-tubercle-pair"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'cheliped-l/r' - the whole arm swings from here."}, "evidenceRefs": ["zone-r1c0", "zone-r1c2"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid red, consistently more saturated and redder than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_merus_l_20.add(mesh_cheliped_merus_l_20);
  meshes["cheliped-merus-l"] = mesh_cheliped_merus_l_20;
  colliders["cheliped-merus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_cheliped_carpus_l_21 = {"parentId": "cheliped-merus-l", "parentSocket": "cheliped-elbow-l", "localStart": [0.315, 0.3, 0.13], "localEnd": [0.265, 0.2, 0.235], "contactType": "socket", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Span 0.1534. A knuckle ball sits at the elbow - overlap closes a gap ALONG the limb axis but not ACROSS a fold, where two tangent capsules leave an open wedge."};
  const endpoint_cheliped_carpus_l_21 = makeAttachmentEndpoint(attachment_cheliped_carpus_l_21);
  const node_cheliped_carpus_l_21 = new THREE.Group();
  node_cheliped_carpus_l_21.name = "cheliped carpus / wrist (l)__pivot";
  node_cheliped_carpus_l_21.scale.set(1, 1, 1);
  if (endpoint_cheliped_carpus_l_21) {
    node_cheliped_carpus_l_21.position.copy(endpoint_cheliped_carpus_l_21.start);
    node_cheliped_carpus_l_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheliped_carpus_l_21.position.set(0.29, 0.25, 0.1825);
    node_cheliped_carpus_l_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheliped_carpus_l_21.userData.sculptComponent = {"id": "cheliped-carpus-l", "name": "cheliped carpus / wrist (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.6, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The forearm, folding forward and down so the chela hangs low and inboard. Occluded behind the claw mass in the reference, hence confidence 0.6.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-merus-l", "attachment": {"parentId": "cheliped-merus-l", "parentSocket": "cheliped-elbow-l", "localStart": [0.315, 0.3, 0.13], "localEnd": [0.265, 0.2, 0.235], "contactType": "socket", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Span 0.1534. A knuckle ball sits at the elbow - overlap closes a gap ALONG the limb axis but not ACROSS a fold, where two tangent capsules leave an open wedge."}, "dimensions": {"width": 0.104, "height": 0.2054, "depth": 0.104, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0.29, 0.25, 0.1825], "rotation": [0.0, 0.0, 0.0], "scale": [0.104, 0.2054, 0.104]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.025, 0.05, -0.0525], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-carpus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_carpus_l_21.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.025, 0.05, -0.0525], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["cheliped-merus-l"] ?? root).add(node_cheliped_carpus_l_21);
  nodes["cheliped-carpus-l"] = node_cheliped_carpus_l_21;
  const mesh_cheliped_carpus_l_21Geometry = endpoint_cheliped_carpus_l_21
    ? new THREE.CylinderGeometry(endpoint_cheliped_carpus_l_21.endRadius, endpoint_cheliped_carpus_l_21.baseRadius, endpoint_cheliped_carpus_l_21.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_cheliped_carpus_l_21) {
    mesh_cheliped_carpus_l_21Geometry.scale(0.104, 0.2054, 0.104);
  }
  const mesh_cheliped_carpus_l_21 = new THREE.Mesh(
    mesh_cheliped_carpus_l_21Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheliped_carpus_l_21.name = "cheliped carpus / wrist (l)";
  if (endpoint_cheliped_carpus_l_21) {
    mesh_cheliped_carpus_l_21.position.copy(endpoint_cheliped_carpus_l_21.midpoint);
    mesh_cheliped_carpus_l_21.quaternion.copy(endpoint_cheliped_carpus_l_21.quaternion);
  }
  mesh_cheliped_carpus_l_21.castShadow = options.castShadow ?? true;
  mesh_cheliped_carpus_l_21.receiveShadow = options.receiveShadow ?? true;
  mesh_cheliped_carpus_l_21.userData.sculptComponent = {"id": "cheliped-carpus-l", "name": "cheliped carpus / wrist (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.6, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The forearm, folding forward and down so the chela hangs low and inboard. Occluded behind the claw mass in the reference, hence confidence 0.6.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-merus-l", "attachment": {"parentId": "cheliped-merus-l", "parentSocket": "cheliped-elbow-l", "localStart": [0.315, 0.3, 0.13], "localEnd": [0.265, 0.2, 0.235], "contactType": "socket", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Span 0.1534. A knuckle ball sits at the elbow - overlap closes a gap ALONG the limb axis but not ACROSS a fold, where two tangent capsules leave an open wedge."}, "dimensions": {"width": 0.104, "height": 0.2054, "depth": 0.104, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0.29, 0.25, 0.1825], "rotation": [0.0, 0.0, 0.0], "scale": [0.104, 0.2054, 0.104]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.025, 0.05, -0.0525], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-carpus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_carpus_l_21.add(mesh_cheliped_carpus_l_21);
  meshes["cheliped-carpus-l"] = mesh_cheliped_carpus_l_21;
  colliders["cheliped-carpus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_chela_palm_l_22 = makeAttachmentEndpoint(null);
  const node_chela_palm_l_22 = new THREE.Group();
  node_chela_palm_l_22.name = "chela palm (l)__pivot";
  node_chela_palm_l_22.scale.set(1, 1, 1);
  if (endpoint_chela_palm_l_22) {
    node_chela_palm_l_22.position.copy(endpoint_chela_palm_l_22.start);
    node_chela_palm_l_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chela_palm_l_22.position.set(0.225, 0.163, 0.315);
    node_chela_palm_l_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_chela_palm_l_22.userData.sculptComponent = {"id": "chela-palm-l", "name": "chela palm (l)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "The claw's body: one smooth swelling mass, wider than the arm carrying it. A full value step lighter than that arm - the gold-against-red is what makes the claw read as a different substance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-carpus-l", "attachment": {"parentId": "cheliped-carpus-l", "parentSocket": "cheliped-wrist-l", "localStart": [0.265, 0.2, 0.235], "localEnd": [0.225, 0.163, 0.315], "contactType": "socket", "embedDepth": 0.026, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Embedded into the wrist so the join is a swelling, not a butt seam."}, "dimensions": {"width": 0.15, "height": 0.17, "depth": 0.205, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.225, 0.163, 0.315], "rotation": [0.0, 0.0, 0.0], "scale": [0.15, 0.17, 0.205]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.04, 0.037, -0.08], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": [], "fidelityTier": "blockout", "builtAs": "chela-palm-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Warm gold. Measured #F5B55B -> #FFC14D -> #FCD065 -> #FEEA89 on the lit finger backs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_palm_l_22.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.04, 0.037, -0.08], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["cheliped-carpus-l"] ?? root).add(node_chela_palm_l_22);
  nodes["chela-palm-l"] = node_chela_palm_l_22;
  const mesh_chela_palm_l_22Geometry = endpoint_chela_palm_l_22
    ? new THREE.CylinderGeometry(endpoint_chela_palm_l_22.endRadius, endpoint_chela_palm_l_22.baseRadius, endpoint_chela_palm_l_22.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_chela_palm_l_22) {
    mesh_chela_palm_l_22Geometry.scale(0.15, 0.17, 0.205);
  }
  const mesh_chela_palm_l_22 = new THREE.Mesh(
    mesh_chela_palm_l_22Geometry,
    materialMap["chelaHorn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chela_palm_l_22.name = "chela palm (l)";
  if (endpoint_chela_palm_l_22) {
    mesh_chela_palm_l_22.position.copy(endpoint_chela_palm_l_22.midpoint);
    mesh_chela_palm_l_22.quaternion.copy(endpoint_chela_palm_l_22.quaternion);
  }
  mesh_chela_palm_l_22.castShadow = options.castShadow ?? true;
  mesh_chela_palm_l_22.receiveShadow = options.receiveShadow ?? true;
  mesh_chela_palm_l_22.userData.sculptComponent = {"id": "chela-palm-l", "name": "chela palm (l)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "The claw's body: one smooth swelling mass, wider than the arm carrying it. A full value step lighter than that arm - the gold-against-red is what makes the claw read as a different substance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-carpus-l", "attachment": {"parentId": "cheliped-carpus-l", "parentSocket": "cheliped-wrist-l", "localStart": [0.265, 0.2, 0.235], "localEnd": [0.225, 0.163, 0.315], "contactType": "socket", "embedDepth": 0.026, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Embedded into the wrist so the join is a swelling, not a butt seam."}, "dimensions": {"width": 0.15, "height": 0.17, "depth": 0.205, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.225, 0.163, 0.315], "rotation": [0.0, 0.0, 0.0], "scale": [0.15, 0.17, 0.205]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.04, 0.037, -0.08], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": [], "fidelityTier": "blockout", "builtAs": "chela-palm-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Warm gold. Measured #F5B55B -> #FFC14D -> #FCD065 -> #FEEA89 on the lit finger backs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_palm_l_22.add(mesh_chela_palm_l_22);
  meshes["chela-palm-l"] = mesh_chela_palm_l_22;
  colliders["chela-palm-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_chela_pollex_l_23 = {"parentId": "chela-palm-l", "parentSocket": "chela-palm-anterior-l", "localStart": [0.222, 0.135, 0.385], "localEnd": [0.203, 0.108, 0.505], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Span 0.1245, taper 0.048 -> 0.016."};
  const endpoint_chela_pollex_l_23 = makeAttachmentEndpoint(attachment_chela_pollex_l_23);
  const node_chela_pollex_l_23 = new THREE.Group();
  node_chela_pollex_l_23.name = "chela fixed finger / pollex (l)__pivot";
  node_chela_pollex_l_23.scale.set(1, 1, 1);
  if (endpoint_chela_pollex_l_23) {
    node_chela_pollex_l_23.position.copy(endpoint_chela_pollex_l_23.start);
    node_chela_pollex_l_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chela_pollex_l_23.position.set(0.2125, 0.1215, 0.445);
    node_chela_pollex_l_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_chela_pollex_l_23.userData.sculptComponent = {"id": "chela-pollex-l", "name": "chela fixed finger / pollex (l)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The LOWER, LONGER finger - it runs to y=479 in the reference where the movable finger stops by y=444. Tapers to a ROUNDED point, never a sharp one: a sharp finger reads as a mandible. Two equal fingers read as a clothes peg, which is why the asymmetry is spec'd rather than left to chance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-l", "attachment": {"parentId": "chela-palm-l", "parentSocket": "chela-palm-anterior-l", "localStart": [0.222, 0.135, 0.385], "localEnd": [0.203, 0.108, 0.505], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Span 0.1245, taper 0.048 -> 0.016."}, "dimensions": {"width": 0.096, "height": 0.1725, "depth": 0.096, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.2125, 0.1215, 0.445], "rotation": [0.0, 0.0, 0.0], "scale": [0.096, 0.1725, 0.096]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["rounded terminal point, radius 0.016"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-pollex-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_pollex_l_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["chela-palm-l"] ?? root).add(node_chela_pollex_l_23);
  nodes["chela-pollex-l"] = node_chela_pollex_l_23;
  const mesh_chela_pollex_l_23Geometry = endpoint_chela_pollex_l_23
    ? new THREE.CylinderGeometry(endpoint_chela_pollex_l_23.endRadius, endpoint_chela_pollex_l_23.baseRadius, endpoint_chela_pollex_l_23.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_chela_pollex_l_23) {
    mesh_chela_pollex_l_23Geometry.scale(0.096, 0.1725, 0.096);
  }
  const mesh_chela_pollex_l_23 = new THREE.Mesh(
    mesh_chela_pollex_l_23Geometry,
    materialMap["chelaHorn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chela_pollex_l_23.name = "chela fixed finger / pollex (l)";
  if (endpoint_chela_pollex_l_23) {
    mesh_chela_pollex_l_23.position.copy(endpoint_chela_pollex_l_23.midpoint);
    mesh_chela_pollex_l_23.quaternion.copy(endpoint_chela_pollex_l_23.quaternion);
  }
  mesh_chela_pollex_l_23.castShadow = options.castShadow ?? true;
  mesh_chela_pollex_l_23.receiveShadow = options.receiveShadow ?? true;
  mesh_chela_pollex_l_23.userData.sculptComponent = {"id": "chela-pollex-l", "name": "chela fixed finger / pollex (l)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The LOWER, LONGER finger - it runs to y=479 in the reference where the movable finger stops by y=444. Tapers to a ROUNDED point, never a sharp one: a sharp finger reads as a mandible. Two equal fingers read as a clothes peg, which is why the asymmetry is spec'd rather than left to chance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-l", "attachment": {"parentId": "chela-palm-l", "parentSocket": "chela-palm-anterior-l", "localStart": [0.222, 0.135, 0.385], "localEnd": [0.203, 0.108, 0.505], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Span 0.1245, taper 0.048 -> 0.016."}, "dimensions": {"width": 0.096, "height": 0.1725, "depth": 0.096, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.2125, 0.1215, 0.445], "rotation": [0.0, 0.0, 0.0], "scale": [0.096, 0.1725, 0.096]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["rounded terminal point, radius 0.016"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-pollex-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_pollex_l_23.add(mesh_chela_pollex_l_23);
  meshes["chela-pollex-l"] = mesh_chela_pollex_l_23;
  colliders["chela-pollex-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_chela_dactyl_l_24 = {"parentId": "chela-palm-l", "parentSocket": "chela-hinge-l", "localStart": [0.222, 0.195, 0.378], "localEnd": [0.208, 0.182, 0.478], "contactType": "hinge", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Span 0.1018. Hinge pivot at the palm end so the claw opens and closes about a real joint."};
  const endpoint_chela_dactyl_l_24 = makeAttachmentEndpoint(attachment_chela_dactyl_l_24);
  const node_chela_dactyl_l_24 = new THREE.Group();
  node_chela_dactyl_l_24.name = "chela movable finger / dactyl (l)__pivot";
  node_chela_dactyl_l_24.scale.set(1, 1, 1);
  if (endpoint_chela_dactyl_l_24) {
    node_chela_dactyl_l_24.position.copy(endpoint_chela_dactyl_l_24.start);
    node_chela_dactyl_l_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chela_dactyl_l_24.position.set(0.215, 0.1885, 0.428);
    node_chela_dactyl_l_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_chela_dactyl_l_24.userData.sculptComponent = {"id": "chela-dactyl-l", "name": "chela movable finger / dactyl (l)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The UPPER, SHORTER finger, and the ONE joint in the subject that visibly articulates. It carries the pincer gap: measured tip separation 0.0789 world against finger radii summing 0.030, so 0.049 of daylight subtending ~38 degrees. IDENTITY RANK 1 - the gap is sized from readability at the game camera, not scaled from the reference proportion.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-l", "attachment": {"parentId": "chela-palm-l", "parentSocket": "chela-hinge-l", "localStart": [0.222, 0.195, 0.378], "localEnd": [0.208, 0.182, 0.478], "contactType": "hinge", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Span 0.1018. Hinge pivot at the palm end so the claw opens and closes about a real joint."}, "dimensions": {"width": 0.084, "height": 0.1438, "depth": 0.084, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.215, 0.1885, 0.428], "rotation": [0.0, 0.0, 0.0], "scale": [0.084, 0.1438, 0.084]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.007, 0.0065, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["pincer gap, 0.049 clear at the tips"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'dactyl-l/r'. If this gap ever closes at game size the model has failed its rank-1 feature and reads as a generic red arthropod."}, "evidenceRefs": ["zone-r2c1"], "details": ["pincer-gap", "chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_dactyl_l_24.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.007, 0.0065, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["chela-palm-l"] ?? root).add(node_chela_dactyl_l_24);
  nodes["chela-dactyl-l"] = node_chela_dactyl_l_24;
  const mesh_chela_dactyl_l_24Geometry = endpoint_chela_dactyl_l_24
    ? new THREE.CylinderGeometry(endpoint_chela_dactyl_l_24.endRadius, endpoint_chela_dactyl_l_24.baseRadius, endpoint_chela_dactyl_l_24.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_chela_dactyl_l_24) {
    mesh_chela_dactyl_l_24Geometry.scale(0.084, 0.1438, 0.084);
  }
  const mesh_chela_dactyl_l_24 = new THREE.Mesh(
    mesh_chela_dactyl_l_24Geometry,
    materialMap["chelaHorn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chela_dactyl_l_24.name = "chela movable finger / dactyl (l)";
  if (endpoint_chela_dactyl_l_24) {
    mesh_chela_dactyl_l_24.position.copy(endpoint_chela_dactyl_l_24.midpoint);
    mesh_chela_dactyl_l_24.quaternion.copy(endpoint_chela_dactyl_l_24.quaternion);
  }
  mesh_chela_dactyl_l_24.castShadow = options.castShadow ?? true;
  mesh_chela_dactyl_l_24.receiveShadow = options.receiveShadow ?? true;
  mesh_chela_dactyl_l_24.userData.sculptComponent = {"id": "chela-dactyl-l", "name": "chela movable finger / dactyl (l)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The UPPER, SHORTER finger, and the ONE joint in the subject that visibly articulates. It carries the pincer gap: measured tip separation 0.0789 world against finger radii summing 0.030, so 0.049 of daylight subtending ~38 degrees. IDENTITY RANK 1 - the gap is sized from readability at the game camera, not scaled from the reference proportion.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-l", "attachment": {"parentId": "chela-palm-l", "parentSocket": "chela-hinge-l", "localStart": [0.222, 0.195, 0.378], "localEnd": [0.208, 0.182, 0.478], "contactType": "hinge", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Span 0.1018. Hinge pivot at the palm end so the claw opens and closes about a real joint."}, "dimensions": {"width": 0.084, "height": 0.1438, "depth": 0.084, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.215, 0.1885, 0.428], "rotation": [0.0, 0.0, 0.0], "scale": [0.084, 0.1438, 0.084]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.007, 0.0065, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["pincer gap, 0.049 clear at the tips"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'dactyl-l/r'. If this gap ever closes at game size the model has failed its rank-1 feature and reads as a generic red arthropod."}, "evidenceRefs": ["zone-r2c1"], "details": ["pincer-gap", "chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_dactyl_l_24.add(mesh_chela_dactyl_l_24);
  meshes["chela-dactyl-l"] = mesh_chela_dactyl_l_24;
  colliders["chela-dactyl-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_cheliped_merus_r_25 = {"parentId": "carapace", "parentSocket": "carapace-lateral-corner-r", "localStart": [-0.239, 0.343, 0.03], "localEnd": [-0.315, 0.3, 0.13], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Span 0.1328; capsule cylinder length 0.1328 with r=0.058 caps adding on top, so the segment reaches both joints."};
  const endpoint_cheliped_merus_r_25 = makeAttachmentEndpoint(attachment_cheliped_merus_r_25);
  const node_cheliped_merus_r_25 = new THREE.Group();
  node_cheliped_merus_r_25.name = "cheliped merus (r)__pivot";
  node_cheliped_merus_r_25.scale.set(1, 1, 1);
  if (endpoint_cheliped_merus_r_25) {
    node_cheliped_merus_r_25.position.copy(endpoint_cheliped_merus_r_25.start);
    node_cheliped_merus_r_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheliped_merus_r_25.position.set(-0.277, 0.3215, 0.08);
    node_cheliped_merus_r_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheliped_merus_r_25.userData.sculptComponent = {"id": "cheliped-merus-r", "name": "cheliped merus (r)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.7, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered swept solid from the shell's lateral corner out and forward. Built as a tapered sweep whose capsule SPANS its full joint distance with half a radius of overlap at each end - never a fraction of the span with the round caps left to cover the rest. That shortcut shipped once on the flea's hind leg and rendered the limb in three separated pieces: CapsuleGeometry's length argument is the CYLINDER only.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-lateral-corner-r", "localStart": [-0.239, 0.343, 0.03], "localEnd": [-0.315, 0.3, 0.13], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Span 0.1328; capsule cylinder length 0.1328 with r=0.058 caps adding on top, so the segment reaches both joints."}, "dimensions": {"width": 0.116, "height": 0.1908, "depth": 0.116, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [-0.277, 0.3215, 0.08], "rotation": [0.0, 0.0, 0.0], "scale": [0.116, 0.1908, 0.116]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.038, 0.0215, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tuberclesDropped", "kind": "ridge", "description": "The one or two small bosses observed on the arm's outer face are DELIBERATELY NOT BUILT: at the game camera the arm is a handful of pixels, which puts them under the project's own 'nothing smaller than a couple of pixels' cartoon rule.", "detailRef": "arm-tubercle-pair"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'cheliped-l/r' - the whole arm swings from here."}, "evidenceRefs": ["zone-r1c0", "zone-r1c2"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid red, consistently more saturated and redder than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_merus_r_25.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.038, 0.0215, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_cheliped_merus_r_25);
  nodes["cheliped-merus-r"] = node_cheliped_merus_r_25;
  const mesh_cheliped_merus_r_25Geometry = endpoint_cheliped_merus_r_25
    ? new THREE.CylinderGeometry(endpoint_cheliped_merus_r_25.endRadius, endpoint_cheliped_merus_r_25.baseRadius, endpoint_cheliped_merus_r_25.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_cheliped_merus_r_25) {
    mesh_cheliped_merus_r_25Geometry.scale(0.116, 0.1908, 0.116);
  }
  const mesh_cheliped_merus_r_25 = new THREE.Mesh(
    mesh_cheliped_merus_r_25Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheliped_merus_r_25.name = "cheliped merus (r)";
  if (endpoint_cheliped_merus_r_25) {
    mesh_cheliped_merus_r_25.position.copy(endpoint_cheliped_merus_r_25.midpoint);
    mesh_cheliped_merus_r_25.quaternion.copy(endpoint_cheliped_merus_r_25.quaternion);
  }
  mesh_cheliped_merus_r_25.castShadow = options.castShadow ?? true;
  mesh_cheliped_merus_r_25.receiveShadow = options.receiveShadow ?? true;
  mesh_cheliped_merus_r_25.userData.sculptComponent = {"id": "cheliped-merus-r", "name": "cheliped merus (r)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.7, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered swept solid from the shell's lateral corner out and forward. Built as a tapered sweep whose capsule SPANS its full joint distance with half a radius of overlap at each end - never a fraction of the span with the round caps left to cover the rest. That shortcut shipped once on the flea's hind leg and rendered the limb in three separated pieces: CapsuleGeometry's length argument is the CYLINDER only.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "carapace-lateral-corner-r", "localStart": [-0.239, 0.343, 0.03], "localEnd": [-0.315, 0.3, 0.13], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Span 0.1328; capsule cylinder length 0.1328 with r=0.058 caps adding on top, so the segment reaches both joints."}, "dimensions": {"width": 0.116, "height": 0.1908, "depth": 0.116, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [-0.277, 0.3215, 0.08], "rotation": [0.0, 0.0, 0.0], "scale": [0.116, 0.1908, 0.116]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.038, 0.0215, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tuberclesDropped", "kind": "ridge", "description": "The one or two small bosses observed on the arm's outer face are DELIBERATELY NOT BUILT: at the game camera the arm is a handful of pixels, which puts them under the project's own 'nothing smaller than a couple of pixels' cartoon rule.", "detailRef": "arm-tubercle-pair"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'cheliped-l/r' - the whole arm swings from here."}, "evidenceRefs": ["zone-r1c0", "zone-r1c2"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Vivid red, consistently more saturated and redder than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_merus_r_25.add(mesh_cheliped_merus_r_25);
  meshes["cheliped-merus-r"] = mesh_cheliped_merus_r_25;
  colliders["cheliped-merus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_cheliped_carpus_r_26 = {"parentId": "cheliped-merus-r", "parentSocket": "cheliped-elbow-r", "localStart": [-0.315, 0.3, 0.13], "localEnd": [-0.265, 0.2, 0.235], "contactType": "socket", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Span 0.1534. A knuckle ball sits at the elbow - overlap closes a gap ALONG the limb axis but not ACROSS a fold, where two tangent capsules leave an open wedge."};
  const endpoint_cheliped_carpus_r_26 = makeAttachmentEndpoint(attachment_cheliped_carpus_r_26);
  const node_cheliped_carpus_r_26 = new THREE.Group();
  node_cheliped_carpus_r_26.name = "cheliped carpus / wrist (r)__pivot";
  node_cheliped_carpus_r_26.scale.set(1, 1, 1);
  if (endpoint_cheliped_carpus_r_26) {
    node_cheliped_carpus_r_26.position.copy(endpoint_cheliped_carpus_r_26.start);
    node_cheliped_carpus_r_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheliped_carpus_r_26.position.set(-0.29, 0.25, 0.1825);
    node_cheliped_carpus_r_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheliped_carpus_r_26.userData.sculptComponent = {"id": "cheliped-carpus-r", "name": "cheliped carpus / wrist (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.6, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The forearm, folding forward and down so the chela hangs low and inboard. Occluded behind the claw mass in the reference, hence confidence 0.6.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-merus-r", "attachment": {"parentId": "cheliped-merus-r", "parentSocket": "cheliped-elbow-r", "localStart": [-0.315, 0.3, 0.13], "localEnd": [-0.265, 0.2, 0.235], "contactType": "socket", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Span 0.1534. A knuckle ball sits at the elbow - overlap closes a gap ALONG the limb axis but not ACROSS a fold, where two tangent capsules leave an open wedge."}, "dimensions": {"width": 0.104, "height": 0.2054, "depth": 0.104, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [-0.29, 0.25, 0.1825], "rotation": [0.0, 0.0, 0.0], "scale": [0.104, 0.2054, 0.104]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.025, 0.05, -0.0525], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-carpus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_carpus_r_26.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.025, 0.05, -0.0525], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["cheliped-merus-r"] ?? root).add(node_cheliped_carpus_r_26);
  nodes["cheliped-carpus-r"] = node_cheliped_carpus_r_26;
  const mesh_cheliped_carpus_r_26Geometry = endpoint_cheliped_carpus_r_26
    ? new THREE.CylinderGeometry(endpoint_cheliped_carpus_r_26.endRadius, endpoint_cheliped_carpus_r_26.baseRadius, endpoint_cheliped_carpus_r_26.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_cheliped_carpus_r_26) {
    mesh_cheliped_carpus_r_26Geometry.scale(0.104, 0.2054, 0.104);
  }
  const mesh_cheliped_carpus_r_26 = new THREE.Mesh(
    mesh_cheliped_carpus_r_26Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheliped_carpus_r_26.name = "cheliped carpus / wrist (r)";
  if (endpoint_cheliped_carpus_r_26) {
    mesh_cheliped_carpus_r_26.position.copy(endpoint_cheliped_carpus_r_26.midpoint);
    mesh_cheliped_carpus_r_26.quaternion.copy(endpoint_cheliped_carpus_r_26.quaternion);
  }
  mesh_cheliped_carpus_r_26.castShadow = options.castShadow ?? true;
  mesh_cheliped_carpus_r_26.receiveShadow = options.receiveShadow ?? true;
  mesh_cheliped_carpus_r_26.userData.sculptComponent = {"id": "cheliped-carpus-r", "name": "cheliped carpus / wrist (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.6, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The forearm, folding forward and down so the chela hangs low and inboard. Occluded behind the claw mass in the reference, hence confidence 0.6.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-merus-r", "attachment": {"parentId": "cheliped-merus-r", "parentSocket": "cheliped-elbow-r", "localStart": [-0.315, 0.3, 0.13], "localEnd": [-0.265, 0.2, 0.235], "contactType": "socket", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Span 0.1534. A knuckle ball sits at the elbow - overlap closes a gap ALONG the limb axis but not ACROSS a fold, where two tangent capsules leave an open wedge."}, "dimensions": {"width": 0.104, "height": 0.2054, "depth": 0.104, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [-0.29, 0.25, 0.1825], "rotation": [0.0, 0.0, 0.0], "scale": [0.104, 0.2054, 0.104]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.025, 0.05, -0.0525], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": [], "fidelityTier": "blockout", "builtAs": "cheliped-carpus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_cheliped_carpus_r_26.add(mesh_cheliped_carpus_r_26);
  meshes["cheliped-carpus-r"] = mesh_cheliped_carpus_r_26;
  colliders["cheliped-carpus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_chela_palm_r_27 = makeAttachmentEndpoint(null);
  const node_chela_palm_r_27 = new THREE.Group();
  node_chela_palm_r_27.name = "chela palm (r)__pivot";
  node_chela_palm_r_27.scale.set(1, 1, 1);
  if (endpoint_chela_palm_r_27) {
    node_chela_palm_r_27.position.copy(endpoint_chela_palm_r_27.start);
    node_chela_palm_r_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chela_palm_r_27.position.set(-0.225, 0.163, 0.315);
    node_chela_palm_r_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_chela_palm_r_27.userData.sculptComponent = {"id": "chela-palm-r", "name": "chela palm (r)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "The claw's body: one smooth swelling mass, wider than the arm carrying it. A full value step lighter than that arm - the gold-against-red is what makes the claw read as a different substance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-carpus-r", "attachment": {"parentId": "cheliped-carpus-r", "parentSocket": "cheliped-wrist-r", "localStart": [-0.265, 0.2, 0.235], "localEnd": [-0.225, 0.163, 0.315], "contactType": "socket", "embedDepth": 0.026, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Embedded into the wrist so the join is a swelling, not a butt seam."}, "dimensions": {"width": 0.15, "height": 0.17, "depth": 0.205, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.225, 0.163, 0.315], "rotation": [0.0, 0.0, 0.0], "scale": [0.15, 0.17, 0.205]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.04, 0.037, -0.08], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": [], "fidelityTier": "blockout", "builtAs": "chela-palm-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Warm gold. Measured #F5B55B -> #FFC14D -> #FCD065 -> #FEEA89 on the lit finger backs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_palm_r_27.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.04, 0.037, -0.08], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["cheliped-carpus-r"] ?? root).add(node_chela_palm_r_27);
  nodes["chela-palm-r"] = node_chela_palm_r_27;
  const mesh_chela_palm_r_27Geometry = endpoint_chela_palm_r_27
    ? new THREE.CylinderGeometry(endpoint_chela_palm_r_27.endRadius, endpoint_chela_palm_r_27.baseRadius, endpoint_chela_palm_r_27.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_chela_palm_r_27) {
    mesh_chela_palm_r_27Geometry.scale(0.15, 0.17, 0.205);
  }
  const mesh_chela_palm_r_27 = new THREE.Mesh(
    mesh_chela_palm_r_27Geometry,
    materialMap["chelaHorn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chela_palm_r_27.name = "chela palm (r)";
  if (endpoint_chela_palm_r_27) {
    mesh_chela_palm_r_27.position.copy(endpoint_chela_palm_r_27.midpoint);
    mesh_chela_palm_r_27.quaternion.copy(endpoint_chela_palm_r_27.quaternion);
  }
  mesh_chela_palm_r_27.castShadow = options.castShadow ?? true;
  mesh_chela_palm_r_27.receiveShadow = options.receiveShadow ?? true;
  mesh_chela_palm_r_27.userData.sculptComponent = {"id": "chela-palm-r", "name": "chela palm (r)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "The claw's body: one smooth swelling mass, wider than the arm carrying it. A full value step lighter than that arm - the gold-against-red is what makes the claw read as a different substance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "cheliped-carpus-r", "attachment": {"parentId": "cheliped-carpus-r", "parentSocket": "cheliped-wrist-r", "localStart": [-0.265, 0.2, 0.235], "localEnd": [-0.225, 0.163, 0.315], "contactType": "socket", "embedDepth": 0.026, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Embedded into the wrist so the join is a swelling, not a butt seam."}, "dimensions": {"width": 0.15, "height": 0.17, "depth": 0.205, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.225, 0.163, 0.315], "rotation": [0.0, 0.0, 0.0], "scale": [0.15, 0.17, 0.205]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.04, 0.037, -0.08], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": [], "fidelityTier": "blockout", "builtAs": "chela-palm-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Warm gold. Measured #F5B55B -> #FFC14D -> #FCD065 -> #FEEA89 on the lit finger backs.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_palm_r_27.add(mesh_chela_palm_r_27);
  meshes["chela-palm-r"] = mesh_chela_palm_r_27;
  colliders["chela-palm-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_chela_pollex_r_28 = {"parentId": "chela-palm-r", "parentSocket": "chela-palm-anterior-r", "localStart": [-0.222, 0.135, 0.385], "localEnd": [-0.203, 0.108, 0.505], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Span 0.1245, taper 0.048 -> 0.016."};
  const endpoint_chela_pollex_r_28 = makeAttachmentEndpoint(attachment_chela_pollex_r_28);
  const node_chela_pollex_r_28 = new THREE.Group();
  node_chela_pollex_r_28.name = "chela fixed finger / pollex (r)__pivot";
  node_chela_pollex_r_28.scale.set(1, 1, 1);
  if (endpoint_chela_pollex_r_28) {
    node_chela_pollex_r_28.position.copy(endpoint_chela_pollex_r_28.start);
    node_chela_pollex_r_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chela_pollex_r_28.position.set(-0.2125, 0.1215, 0.445);
    node_chela_pollex_r_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_chela_pollex_r_28.userData.sculptComponent = {"id": "chela-pollex-r", "name": "chela fixed finger / pollex (r)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The LOWER, LONGER finger - it runs to y=479 in the reference where the movable finger stops by y=444. Tapers to a ROUNDED point, never a sharp one: a sharp finger reads as a mandible. Two equal fingers read as a clothes peg, which is why the asymmetry is spec'd rather than left to chance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-r", "attachment": {"parentId": "chela-palm-r", "parentSocket": "chela-palm-anterior-r", "localStart": [-0.222, 0.135, 0.385], "localEnd": [-0.203, 0.108, 0.505], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Span 0.1245, taper 0.048 -> 0.016."}, "dimensions": {"width": 0.096, "height": 0.1725, "depth": 0.096, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.2125, 0.1215, 0.445], "rotation": [0.0, 0.0, 0.0], "scale": [0.096, 0.1725, 0.096]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["rounded terminal point, radius 0.016"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-pollex-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_pollex_r_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["chela-palm-r"] ?? root).add(node_chela_pollex_r_28);
  nodes["chela-pollex-r"] = node_chela_pollex_r_28;
  const mesh_chela_pollex_r_28Geometry = endpoint_chela_pollex_r_28
    ? new THREE.CylinderGeometry(endpoint_chela_pollex_r_28.endRadius, endpoint_chela_pollex_r_28.baseRadius, endpoint_chela_pollex_r_28.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_chela_pollex_r_28) {
    mesh_chela_pollex_r_28Geometry.scale(0.096, 0.1725, 0.096);
  }
  const mesh_chela_pollex_r_28 = new THREE.Mesh(
    mesh_chela_pollex_r_28Geometry,
    materialMap["chelaHorn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chela_pollex_r_28.name = "chela fixed finger / pollex (r)";
  if (endpoint_chela_pollex_r_28) {
    mesh_chela_pollex_r_28.position.copy(endpoint_chela_pollex_r_28.midpoint);
    mesh_chela_pollex_r_28.quaternion.copy(endpoint_chela_pollex_r_28.quaternion);
  }
  mesh_chela_pollex_r_28.castShadow = options.castShadow ?? true;
  mesh_chela_pollex_r_28.receiveShadow = options.receiveShadow ?? true;
  mesh_chela_pollex_r_28.userData.sculptComponent = {"id": "chela-pollex-r", "name": "chela fixed finger / pollex (r)", "level": "meso", "role": "body", "importance": 0.95, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The LOWER, LONGER finger - it runs to y=479 in the reference where the movable finger stops by y=444. Tapers to a ROUNDED point, never a sharp one: a sharp finger reads as a mandible. Two equal fingers read as a clothes peg, which is why the asymmetry is spec'd rather than left to chance.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-r", "attachment": {"parentId": "chela-palm-r", "parentSocket": "chela-palm-anterior-r", "localStart": [-0.222, 0.135, 0.385], "localEnd": [-0.203, 0.108, 0.505], "contactType": "socket", "embedDepth": 0.024, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Span 0.1245, taper 0.048 -> 0.016."}, "dimensions": {"width": 0.096, "height": 0.1725, "depth": 0.096, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.2125, 0.1215, 0.445], "rotation": [0.0, 0.0, 0.0], "scale": [0.096, 0.1725, 0.096]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["rounded terminal point, radius 0.016"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-pollex-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_pollex_r_28.add(mesh_chela_pollex_r_28);
  meshes["chela-pollex-r"] = mesh_chela_pollex_r_28;
  colliders["chela-pollex-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_chela_dactyl_r_29 = {"parentId": "chela-palm-r", "parentSocket": "chela-hinge-r", "localStart": [-0.222, 0.195, 0.378], "localEnd": [-0.208, 0.182, 0.478], "contactType": "hinge", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Span 0.1018. Hinge pivot at the palm end so the claw opens and closes about a real joint."};
  const endpoint_chela_dactyl_r_29 = makeAttachmentEndpoint(attachment_chela_dactyl_r_29);
  const node_chela_dactyl_r_29 = new THREE.Group();
  node_chela_dactyl_r_29.name = "chela movable finger / dactyl (r)__pivot";
  node_chela_dactyl_r_29.scale.set(1, 1, 1);
  if (endpoint_chela_dactyl_r_29) {
    node_chela_dactyl_r_29.position.copy(endpoint_chela_dactyl_r_29.start);
    node_chela_dactyl_r_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chela_dactyl_r_29.position.set(-0.215, 0.1885, 0.428);
    node_chela_dactyl_r_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_chela_dactyl_r_29.userData.sculptComponent = {"id": "chela-dactyl-r", "name": "chela movable finger / dactyl (r)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The UPPER, SHORTER finger, and the ONE joint in the subject that visibly articulates. It carries the pincer gap: measured tip separation 0.0789 world against finger radii summing 0.030, so 0.049 of daylight subtending ~38 degrees. IDENTITY RANK 1 - the gap is sized from readability at the game camera, not scaled from the reference proportion.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-r", "attachment": {"parentId": "chela-palm-r", "parentSocket": "chela-hinge-r", "localStart": [-0.222, 0.195, 0.378], "localEnd": [-0.208, 0.182, 0.478], "contactType": "hinge", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Span 0.1018. Hinge pivot at the palm end so the claw opens and closes about a real joint."}, "dimensions": {"width": 0.084, "height": 0.1438, "depth": 0.084, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.215, 0.1885, 0.428], "rotation": [0.0, 0.0, 0.0], "scale": [0.084, 0.1438, 0.084]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.007, 0.0065, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["pincer gap, 0.049 clear at the tips"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'dactyl-l/r'. If this gap ever closes at game size the model has failed its rank-1 feature and reads as a generic red arthropod."}, "evidenceRefs": ["zone-r2c1"], "details": ["pincer-gap", "chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_dactyl_r_29.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.007, 0.0065, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["chela-palm-r"] ?? root).add(node_chela_dactyl_r_29);
  nodes["chela-dactyl-r"] = node_chela_dactyl_r_29;
  const mesh_chela_dactyl_r_29Geometry = endpoint_chela_dactyl_r_29
    ? new THREE.CylinderGeometry(endpoint_chela_dactyl_r_29.endRadius, endpoint_chela_dactyl_r_29.baseRadius, endpoint_chela_dactyl_r_29.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_chela_dactyl_r_29) {
    mesh_chela_dactyl_r_29Geometry.scale(0.084, 0.1438, 0.084);
  }
  const mesh_chela_dactyl_r_29 = new THREE.Mesh(
    mesh_chela_dactyl_r_29Geometry,
    materialMap["chelaHorn"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chela_dactyl_r_29.name = "chela movable finger / dactyl (r)";
  if (endpoint_chela_dactyl_r_29) {
    mesh_chela_dactyl_r_29.position.copy(endpoint_chela_dactyl_r_29.midpoint);
    mesh_chela_dactyl_r_29.quaternion.copy(endpoint_chela_dactyl_r_29.quaternion);
  }
  mesh_chela_dactyl_r_29.castShadow = options.castShadow ?? true;
  mesh_chela_dactyl_r_29.receiveShadow = options.receiveShadow ?? true;
  mesh_chela_dactyl_r_29.userData.sculptComponent = {"id": "chela-dactyl-r", "name": "chela movable finger / dactyl (r)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The UPPER, SHORTER finger, and the ONE joint in the subject that visibly articulates. It carries the pincer gap: measured tip separation 0.0789 world against finger radii summing 0.030, so 0.049 of daylight subtending ~38 degrees. IDENTITY RANK 1 - the gap is sized from readability at the game camera, not scaled from the reference proportion.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chela-palm-r", "attachment": {"parentId": "chela-palm-r", "parentSocket": "chela-hinge-r", "localStart": [-0.222, 0.195, 0.378], "localEnd": [-0.208, 0.182, 0.478], "contactType": "hinge", "embedDepth": 0.022, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Span 0.1018. Hinge pivot at the palm end so the claw opens and closes about a real joint."}, "dimensions": {"width": 0.084, "height": 0.1438, "depth": 0.084, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.215, 0.1885, 0.428], "rotation": [0.0, 0.0, 0.0], "scale": [0.084, 0.1438, 0.084]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.007, 0.0065, -0.05], "axis": [1.0, 0.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "chelaHorn", "materialLayers": ["chelaHorn"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["pincer gap, 0.049 clear at the tips"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'dactyl-l/r'. If this gap ever closes at game size the model has failed its rank-1 feature and reads as a generic red arthropod."}, "evidenceRefs": ["zone-r2c1"], "details": ["pincer-gap", "chela-finger-taper"], "fidelityTier": "blockout", "builtAs": "chela-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 190, 85, 1.0)", "secondaryAlbedo": "rgba(254, 234, 137, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Warm gold horn, a full value step lighter than the arm carrying it.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_chela_dactyl_r_29.add(mesh_chela_dactyl_r_29);
  meshes["chela-dactyl-r"] = mesh_chela_dactyl_r_29;
  colliders["chela-dactyl-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg1_merus_l_30 = {"parentId": "carapace", "parentSocket": "leg1-merus-socket-l", "localStart": [0.25, 0.272, 0.02], "localEnd": [0.362, 0.158, 0.023], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1598. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg1_merus_l_30 = makeAttachmentEndpoint(attachment_leg1_merus_l_30);
  const node_leg1_merus_l_30 = new THREE.Group();
  node_leg1_merus_l_30.name = "leg 1 merus (l)__pivot";
  node_leg1_merus_l_30.scale.set(1, 1, 1);
  if (endpoint_leg1_merus_l_30) {
    node_leg1_merus_l_30.position.copy(endpoint_leg1_merus_l_30.start);
    node_leg1_merus_l_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg1_merus_l_30.position.set(0.306, 0.215, 0.0215);
    node_leg1_merus_l_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg1_merus_l_30.userData.sculptComponent = {"id": "leg1-merus-l", "name": "leg 1 merus (l)", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt. Marked MACRO as the lead element of the walking-leg fan: the fan is one of the subject's four macro assemblies, and with no container nodes in this tree its lead plate carries that level.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg1-merus-socket-l", "localStart": [0.25, 0.272, 0.02], "localEnd": [0.362, 0.158, 0.023], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1598. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.2058, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.306, 0.215, 0.0215], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.2058, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.056, 0.057, -0.0015], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fanPlate", "kind": "ridge", "description": "The first of four overlapping merus plates. Each successive plate sits behind and below the one in front; the lateral reach falls 1.00 / 0.96 / 0.87 / 0.75 front to back.", "detailRef": "leg-plate-fan"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg1L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg1-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_merus_l_30.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.056, 0.057, -0.0015], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg1_merus_l_30);
  nodes["leg1-merus-l"] = node_leg1_merus_l_30;
  const mesh_leg1_merus_l_30Geometry = endpoint_leg1_merus_l_30
    ? new THREE.CylinderGeometry(endpoint_leg1_merus_l_30.endRadius, endpoint_leg1_merus_l_30.baseRadius, endpoint_leg1_merus_l_30.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg1_merus_l_30) {
    mesh_leg1_merus_l_30Geometry.scale(0.092, 0.2058, 0.092);
  }
  const mesh_leg1_merus_l_30 = new THREE.Mesh(
    mesh_leg1_merus_l_30Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg1_merus_l_30.name = "leg 1 merus (l)";
  if (endpoint_leg1_merus_l_30) {
    mesh_leg1_merus_l_30.position.copy(endpoint_leg1_merus_l_30.midpoint);
    mesh_leg1_merus_l_30.quaternion.copy(endpoint_leg1_merus_l_30.quaternion);
  }
  mesh_leg1_merus_l_30.castShadow = options.castShadow ?? true;
  mesh_leg1_merus_l_30.receiveShadow = options.receiveShadow ?? true;
  mesh_leg1_merus_l_30.userData.sculptComponent = {"id": "leg1-merus-l", "name": "leg 1 merus (l)", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt. Marked MACRO as the lead element of the walking-leg fan: the fan is one of the subject's four macro assemblies, and with no container nodes in this tree its lead plate carries that level.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg1-merus-socket-l", "localStart": [0.25, 0.272, 0.02], "localEnd": [0.362, 0.158, 0.023], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1598. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.2058, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.306, 0.215, 0.0215], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.2058, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.056, 0.057, -0.0015], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fanPlate", "kind": "ridge", "description": "The first of four overlapping merus plates. Each successive plate sits behind and below the one in front; the lateral reach falls 1.00 / 0.96 / 0.87 / 0.75 front to back.", "detailRef": "leg-plate-fan"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg1L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg1-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_merus_l_30.add(mesh_leg1_merus_l_30);
  meshes["leg1-merus-l"] = mesh_leg1_merus_l_30;
  colliders["leg1-merus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg1_propodus_l_31 = {"parentId": "leg1-merus-l", "parentSocket": "leg1-propodus-socket-l", "localStart": [0.362, 0.158, 0.023], "localEnd": [0.405, 0.058, 0.025], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1089. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg1_propodus_l_31 = makeAttachmentEndpoint(attachment_leg1_propodus_l_31);
  const node_leg1_propodus_l_31 = new THREE.Group();
  node_leg1_propodus_l_31.name = "leg 1 propodus (l)__pivot";
  node_leg1_propodus_l_31.scale.set(1, 1, 1);
  if (endpoint_leg1_propodus_l_31) {
    node_leg1_propodus_l_31.position.copy(endpoint_leg1_propodus_l_31.start);
    node_leg1_propodus_l_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg1_propodus_l_31.position.set(0.3835, 0.108, 0.024);
    node_leg1_propodus_l_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg1_propodus_l_31.userData.sculptComponent = {"id": "leg1-propodus-l", "name": "leg 1 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-merus-l", "attachment": {"parentId": "leg1-merus-l", "parentSocket": "leg1-propodus-socket-l", "localStart": [0.362, 0.158, 0.023], "localEnd": [0.405, 0.058, 0.025], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1089. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1449, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3835, 0.108, 0.024], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1449, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0215, 0.05, -0.001], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg1-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_propodus_l_31.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0215, 0.05, -0.001], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg1-merus-l"] ?? root).add(node_leg1_propodus_l_31);
  nodes["leg1-propodus-l"] = node_leg1_propodus_l_31;
  const mesh_leg1_propodus_l_31Geometry = endpoint_leg1_propodus_l_31
    ? new THREE.CylinderGeometry(endpoint_leg1_propodus_l_31.endRadius, endpoint_leg1_propodus_l_31.baseRadius, endpoint_leg1_propodus_l_31.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg1_propodus_l_31) {
    mesh_leg1_propodus_l_31Geometry.scale(0.072, 0.1449, 0.072);
  }
  const mesh_leg1_propodus_l_31 = new THREE.Mesh(
    mesh_leg1_propodus_l_31Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg1_propodus_l_31.name = "leg 1 propodus (l)";
  if (endpoint_leg1_propodus_l_31) {
    mesh_leg1_propodus_l_31.position.copy(endpoint_leg1_propodus_l_31.midpoint);
    mesh_leg1_propodus_l_31.quaternion.copy(endpoint_leg1_propodus_l_31.quaternion);
  }
  mesh_leg1_propodus_l_31.castShadow = options.castShadow ?? true;
  mesh_leg1_propodus_l_31.receiveShadow = options.receiveShadow ?? true;
  mesh_leg1_propodus_l_31.userData.sculptComponent = {"id": "leg1-propodus-l", "name": "leg 1 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-merus-l", "attachment": {"parentId": "leg1-merus-l", "parentSocket": "leg1-propodus-socket-l", "localStart": [0.362, 0.158, 0.023], "localEnd": [0.405, 0.058, 0.025], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1089. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1449, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3835, 0.108, 0.024], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1449, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0215, 0.05, -0.001], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg1-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_propodus_l_31.add(mesh_leg1_propodus_l_31);
  meshes["leg1-propodus-l"] = mesh_leg1_propodus_l_31;
  colliders["leg1-propodus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg1_dactyl_l_32 = {"parentId": "leg1-propodus-l", "parentSocket": "leg1-dactyl-socket-l", "localStart": [0.405, 0.058, 0.025], "localEnd": [0.412, 0.01, 0.0264], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg1_dactyl_l_32 = makeAttachmentEndpoint(attachment_leg1_dactyl_l_32);
  const node_leg1_dactyl_l_32 = new THREE.Group();
  node_leg1_dactyl_l_32.name = "leg 1 dactyl (l)__pivot";
  node_leg1_dactyl_l_32.scale.set(1, 1, 1);
  if (endpoint_leg1_dactyl_l_32) {
    node_leg1_dactyl_l_32.position.copy(endpoint_leg1_dactyl_l_32.start);
    node_leg1_dactyl_l_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg1_dactyl_l_32.position.set(0.4085, 0.034, 0.0257);
    node_leg1_dactyl_l_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg1_dactyl_l_32.userData.sculptComponent = {"id": "leg1-dactyl-l", "name": "leg 1 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-propodus-l", "attachment": {"parentId": "leg1-propodus-l", "parentSocket": "leg1-dactyl-socket-l", "localStart": [0.405, 0.058, 0.025], "localEnd": [0.412, 0.01, 0.0264], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.4085, 0.034, 0.0257], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0035, 0.024, -0.0007], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hookedTip", "kind": "bevel", "description": "Pointed, slightly hooked terminal tip curving down and inward - deliberately in contrast to the blunt rounded pincer fingers.", "detailRef": "leg-dactyl-point"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg1-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_dactyl_l_32.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0035, 0.024, -0.0007], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg1-propodus-l"] ?? root).add(node_leg1_dactyl_l_32);
  nodes["leg1-dactyl-l"] = node_leg1_dactyl_l_32;
  const mesh_leg1_dactyl_l_32Geometry = endpoint_leg1_dactyl_l_32
    ? new THREE.CylinderGeometry(endpoint_leg1_dactyl_l_32.endRadius, endpoint_leg1_dactyl_l_32.baseRadius, endpoint_leg1_dactyl_l_32.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg1_dactyl_l_32) {
    mesh_leg1_dactyl_l_32Geometry.scale(0.048, 0.0725, 0.048);
  }
  const mesh_leg1_dactyl_l_32 = new THREE.Mesh(
    mesh_leg1_dactyl_l_32Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg1_dactyl_l_32.name = "leg 1 dactyl (l)";
  if (endpoint_leg1_dactyl_l_32) {
    mesh_leg1_dactyl_l_32.position.copy(endpoint_leg1_dactyl_l_32.midpoint);
    mesh_leg1_dactyl_l_32.quaternion.copy(endpoint_leg1_dactyl_l_32.quaternion);
  }
  mesh_leg1_dactyl_l_32.castShadow = options.castShadow ?? true;
  mesh_leg1_dactyl_l_32.receiveShadow = options.receiveShadow ?? true;
  mesh_leg1_dactyl_l_32.userData.sculptComponent = {"id": "leg1-dactyl-l", "name": "leg 1 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-propodus-l", "attachment": {"parentId": "leg1-propodus-l", "parentSocket": "leg1-dactyl-socket-l", "localStart": [0.405, 0.058, 0.025], "localEnd": [0.412, 0.01, 0.0264], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.4085, 0.034, 0.0257], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0035, 0.024, -0.0007], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hookedTip", "kind": "bevel", "description": "Pointed, slightly hooked terminal tip curving down and inward - deliberately in contrast to the blunt rounded pincer fingers.", "detailRef": "leg-dactyl-point"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg1-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_dactyl_l_32.add(mesh_leg1_dactyl_l_32);
  meshes["leg1-dactyl-l"] = mesh_leg1_dactyl_l_32;
  colliders["leg1-dactyl-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg1_merus_r_33 = {"parentId": "carapace", "parentSocket": "leg1-merus-socket-r", "localStart": [-0.25, 0.272, 0.02], "localEnd": [-0.362, 0.158, 0.023], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1598. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg1_merus_r_33 = makeAttachmentEndpoint(attachment_leg1_merus_r_33);
  const node_leg1_merus_r_33 = new THREE.Group();
  node_leg1_merus_r_33.name = "leg 1 merus (r)__pivot";
  node_leg1_merus_r_33.scale.set(1, 1, 1);
  if (endpoint_leg1_merus_r_33) {
    node_leg1_merus_r_33.position.copy(endpoint_leg1_merus_r_33.start);
    node_leg1_merus_r_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg1_merus_r_33.position.set(-0.306, 0.215, 0.0215);
    node_leg1_merus_r_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg1_merus_r_33.userData.sculptComponent = {"id": "leg1-merus-r", "name": "leg 1 merus (r)", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt. Marked MACRO as the lead element of the walking-leg fan: the fan is one of the subject's four macro assemblies, and with no container nodes in this tree its lead plate carries that level.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg1-merus-socket-r", "localStart": [-0.25, 0.272, 0.02], "localEnd": [-0.362, 0.158, 0.023], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1598. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.2058, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.306, 0.215, 0.0215], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.2058, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.056, 0.057, -0.0015], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fanPlate", "kind": "ridge", "description": "The first of four overlapping merus plates. Each successive plate sits behind and below the one in front; the lateral reach falls 1.00 / 0.96 / 0.87 / 0.75 front to back.", "detailRef": "leg-plate-fan"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg1R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg1-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_merus_r_33.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.056, 0.057, -0.0015], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg1_merus_r_33);
  nodes["leg1-merus-r"] = node_leg1_merus_r_33;
  const mesh_leg1_merus_r_33Geometry = endpoint_leg1_merus_r_33
    ? new THREE.CylinderGeometry(endpoint_leg1_merus_r_33.endRadius, endpoint_leg1_merus_r_33.baseRadius, endpoint_leg1_merus_r_33.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg1_merus_r_33) {
    mesh_leg1_merus_r_33Geometry.scale(0.092, 0.2058, 0.092);
  }
  const mesh_leg1_merus_r_33 = new THREE.Mesh(
    mesh_leg1_merus_r_33Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg1_merus_r_33.name = "leg 1 merus (r)";
  if (endpoint_leg1_merus_r_33) {
    mesh_leg1_merus_r_33.position.copy(endpoint_leg1_merus_r_33.midpoint);
    mesh_leg1_merus_r_33.quaternion.copy(endpoint_leg1_merus_r_33.quaternion);
  }
  mesh_leg1_merus_r_33.castShadow = options.castShadow ?? true;
  mesh_leg1_merus_r_33.receiveShadow = options.receiveShadow ?? true;
  mesh_leg1_merus_r_33.userData.sculptComponent = {"id": "leg1-merus-r", "name": "leg 1 merus (r)", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt. Marked MACRO as the lead element of the walking-leg fan: the fan is one of the subject's four macro assemblies, and with no container nodes in this tree its lead plate carries that level.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg1-merus-socket-r", "localStart": [-0.25, 0.272, 0.02], "localEnd": [-0.362, 0.158, 0.023], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1598. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.2058, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.306, 0.215, 0.0215], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.2058, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.056, 0.057, -0.0015], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fanPlate", "kind": "ridge", "description": "The first of four overlapping merus plates. Each successive plate sits behind and below the one in front; the lateral reach falls 1.00 / 0.96 / 0.87 / 0.75 front to back.", "detailRef": "leg-plate-fan"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg1R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg1-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_merus_r_33.add(mesh_leg1_merus_r_33);
  meshes["leg1-merus-r"] = mesh_leg1_merus_r_33;
  colliders["leg1-merus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg1_propodus_r_34 = {"parentId": "leg1-merus-r", "parentSocket": "leg1-propodus-socket-r", "localStart": [-0.362, 0.158, 0.023], "localEnd": [-0.405, 0.058, 0.025], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1089. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg1_propodus_r_34 = makeAttachmentEndpoint(attachment_leg1_propodus_r_34);
  const node_leg1_propodus_r_34 = new THREE.Group();
  node_leg1_propodus_r_34.name = "leg 1 propodus (r)__pivot";
  node_leg1_propodus_r_34.scale.set(1, 1, 1);
  if (endpoint_leg1_propodus_r_34) {
    node_leg1_propodus_r_34.position.copy(endpoint_leg1_propodus_r_34.start);
    node_leg1_propodus_r_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg1_propodus_r_34.position.set(-0.3835, 0.108, 0.024);
    node_leg1_propodus_r_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg1_propodus_r_34.userData.sculptComponent = {"id": "leg1-propodus-r", "name": "leg 1 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-merus-r", "attachment": {"parentId": "leg1-merus-r", "parentSocket": "leg1-propodus-socket-r", "localStart": [-0.362, 0.158, 0.023], "localEnd": [-0.405, 0.058, 0.025], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1089. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1449, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3835, 0.108, 0.024], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1449, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0215, 0.05, -0.001], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg1-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_propodus_r_34.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0215, 0.05, -0.001], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg1-merus-r"] ?? root).add(node_leg1_propodus_r_34);
  nodes["leg1-propodus-r"] = node_leg1_propodus_r_34;
  const mesh_leg1_propodus_r_34Geometry = endpoint_leg1_propodus_r_34
    ? new THREE.CylinderGeometry(endpoint_leg1_propodus_r_34.endRadius, endpoint_leg1_propodus_r_34.baseRadius, endpoint_leg1_propodus_r_34.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg1_propodus_r_34) {
    mesh_leg1_propodus_r_34Geometry.scale(0.072, 0.1449, 0.072);
  }
  const mesh_leg1_propodus_r_34 = new THREE.Mesh(
    mesh_leg1_propodus_r_34Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg1_propodus_r_34.name = "leg 1 propodus (r)";
  if (endpoint_leg1_propodus_r_34) {
    mesh_leg1_propodus_r_34.position.copy(endpoint_leg1_propodus_r_34.midpoint);
    mesh_leg1_propodus_r_34.quaternion.copy(endpoint_leg1_propodus_r_34.quaternion);
  }
  mesh_leg1_propodus_r_34.castShadow = options.castShadow ?? true;
  mesh_leg1_propodus_r_34.receiveShadow = options.receiveShadow ?? true;
  mesh_leg1_propodus_r_34.userData.sculptComponent = {"id": "leg1-propodus-r", "name": "leg 1 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-merus-r", "attachment": {"parentId": "leg1-merus-r", "parentSocket": "leg1-propodus-socket-r", "localStart": [-0.362, 0.158, 0.023], "localEnd": [-0.405, 0.058, 0.025], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1089. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1449, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3835, 0.108, 0.024], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1449, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0215, 0.05, -0.001], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg1-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_propodus_r_34.add(mesh_leg1_propodus_r_34);
  meshes["leg1-propodus-r"] = mesh_leg1_propodus_r_34;
  colliders["leg1-propodus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg1_dactyl_r_35 = {"parentId": "leg1-propodus-r", "parentSocket": "leg1-dactyl-socket-r", "localStart": [-0.405, 0.058, 0.025], "localEnd": [-0.412, 0.01, 0.0264], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg1_dactyl_r_35 = makeAttachmentEndpoint(attachment_leg1_dactyl_r_35);
  const node_leg1_dactyl_r_35 = new THREE.Group();
  node_leg1_dactyl_r_35.name = "leg 1 dactyl (r)__pivot";
  node_leg1_dactyl_r_35.scale.set(1, 1, 1);
  if (endpoint_leg1_dactyl_r_35) {
    node_leg1_dactyl_r_35.position.copy(endpoint_leg1_dactyl_r_35.start);
    node_leg1_dactyl_r_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg1_dactyl_r_35.position.set(-0.4085, 0.034, 0.0257);
    node_leg1_dactyl_r_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg1_dactyl_r_35.userData.sculptComponent = {"id": "leg1-dactyl-r", "name": "leg 1 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-propodus-r", "attachment": {"parentId": "leg1-propodus-r", "parentSocket": "leg1-dactyl-socket-r", "localStart": [-0.405, 0.058, 0.025], "localEnd": [-0.412, 0.01, 0.0264], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.4085, 0.034, 0.0257], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0035, 0.024, -0.0007], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hookedTip", "kind": "bevel", "description": "Pointed, slightly hooked terminal tip curving down and inward - deliberately in contrast to the blunt rounded pincer fingers.", "detailRef": "leg-dactyl-point"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg1-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_dactyl_r_35.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0035, 0.024, -0.0007], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg1-propodus-r"] ?? root).add(node_leg1_dactyl_r_35);
  nodes["leg1-dactyl-r"] = node_leg1_dactyl_r_35;
  const mesh_leg1_dactyl_r_35Geometry = endpoint_leg1_dactyl_r_35
    ? new THREE.CylinderGeometry(endpoint_leg1_dactyl_r_35.endRadius, endpoint_leg1_dactyl_r_35.baseRadius, endpoint_leg1_dactyl_r_35.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg1_dactyl_r_35) {
    mesh_leg1_dactyl_r_35Geometry.scale(0.048, 0.0725, 0.048);
  }
  const mesh_leg1_dactyl_r_35 = new THREE.Mesh(
    mesh_leg1_dactyl_r_35Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg1_dactyl_r_35.name = "leg 1 dactyl (r)";
  if (endpoint_leg1_dactyl_r_35) {
    mesh_leg1_dactyl_r_35.position.copy(endpoint_leg1_dactyl_r_35.midpoint);
    mesh_leg1_dactyl_r_35.quaternion.copy(endpoint_leg1_dactyl_r_35.quaternion);
  }
  mesh_leg1_dactyl_r_35.castShadow = options.castShadow ?? true;
  mesh_leg1_dactyl_r_35.receiveShadow = options.receiveShadow ?? true;
  mesh_leg1_dactyl_r_35.userData.sculptComponent = {"id": "leg1-dactyl-r", "name": "leg 1 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg1-propodus-r", "attachment": {"parentId": "leg1-propodus-r", "parentSocket": "leg1-dactyl-socket-r", "localStart": [-0.405, 0.058, 0.025], "localEnd": [-0.412, 0.01, 0.0264], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.4085, 0.034, 0.0257], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0035, 0.024, -0.0007], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hookedTip", "kind": "bevel", "description": "Pointed, slightly hooked terminal tip curving down and inward - deliberately in contrast to the blunt rounded pincer fingers.", "detailRef": "leg-dactyl-point"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg1-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg1_dactyl_r_35.add(mesh_leg1_dactyl_r_35);
  meshes["leg1-dactyl-r"] = mesh_leg1_dactyl_r_35;
  colliders["leg1-dactyl-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg2_merus_l_36 = {"parentId": "carapace", "parentSocket": "leg2-merus-socket-l", "localStart": [0.25, 0.272, -0.04], "localEnd": [0.3475, 0.158, -0.046], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1501. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg2_merus_l_36 = makeAttachmentEndpoint(attachment_leg2_merus_l_36);
  const node_leg2_merus_l_36 = new THREE.Group();
  node_leg2_merus_l_36.name = "leg 2 merus (l)__pivot";
  node_leg2_merus_l_36.scale.set(1, 1, 1);
  if (endpoint_leg2_merus_l_36) {
    node_leg2_merus_l_36.position.copy(endpoint_leg2_merus_l_36.start);
    node_leg2_merus_l_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg2_merus_l_36.position.set(0.2988, 0.215, -0.043);
    node_leg2_merus_l_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg2_merus_l_36.userData.sculptComponent = {"id": "leg2-merus-l", "name": "leg 2 merus (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg2-merus-socket-l", "localStart": [0.25, 0.272, -0.04], "localEnd": [0.3475, 0.158, -0.046], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1501. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1961, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.2988, 0.215, -0.043], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1961, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0488, 0.057, 0.003], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg2L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg2-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_merus_l_36.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0488, 0.057, 0.003], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg2_merus_l_36);
  nodes["leg2-merus-l"] = node_leg2_merus_l_36;
  const mesh_leg2_merus_l_36Geometry = endpoint_leg2_merus_l_36
    ? new THREE.CylinderGeometry(endpoint_leg2_merus_l_36.endRadius, endpoint_leg2_merus_l_36.baseRadius, endpoint_leg2_merus_l_36.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg2_merus_l_36) {
    mesh_leg2_merus_l_36Geometry.scale(0.092, 0.1961, 0.092);
  }
  const mesh_leg2_merus_l_36 = new THREE.Mesh(
    mesh_leg2_merus_l_36Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg2_merus_l_36.name = "leg 2 merus (l)";
  if (endpoint_leg2_merus_l_36) {
    mesh_leg2_merus_l_36.position.copy(endpoint_leg2_merus_l_36.midpoint);
    mesh_leg2_merus_l_36.quaternion.copy(endpoint_leg2_merus_l_36.quaternion);
  }
  mesh_leg2_merus_l_36.castShadow = options.castShadow ?? true;
  mesh_leg2_merus_l_36.receiveShadow = options.receiveShadow ?? true;
  mesh_leg2_merus_l_36.userData.sculptComponent = {"id": "leg2-merus-l", "name": "leg 2 merus (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg2-merus-socket-l", "localStart": [0.25, 0.272, -0.04], "localEnd": [0.3475, 0.158, -0.046], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1501. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1961, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.2988, 0.215, -0.043], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1961, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0488, 0.057, 0.003], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg2L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg2-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_merus_l_36.add(mesh_leg2_merus_l_36);
  meshes["leg2-merus-l"] = mesh_leg2_merus_l_36;
  colliders["leg2-merus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg2_propodus_l_37 = {"parentId": "leg2-merus-l", "parentSocket": "leg2-propodus-socket-l", "localStart": [0.3475, 0.158, -0.046], "localEnd": [0.3888, 0.058, -0.05], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1083. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg2_propodus_l_37 = makeAttachmentEndpoint(attachment_leg2_propodus_l_37);
  const node_leg2_propodus_l_37 = new THREE.Group();
  node_leg2_propodus_l_37.name = "leg 2 propodus (l)__pivot";
  node_leg2_propodus_l_37.scale.set(1, 1, 1);
  if (endpoint_leg2_propodus_l_37) {
    node_leg2_propodus_l_37.position.copy(endpoint_leg2_propodus_l_37.start);
    node_leg2_propodus_l_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg2_propodus_l_37.position.set(0.3682, 0.108, -0.048);
    node_leg2_propodus_l_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg2_propodus_l_37.userData.sculptComponent = {"id": "leg2-propodus-l", "name": "leg 2 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-merus-l", "attachment": {"parentId": "leg2-merus-l", "parentSocket": "leg2-propodus-socket-l", "localStart": [0.3475, 0.158, -0.046], "localEnd": [0.3888, 0.058, -0.05], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1083. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1443, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3682, 0.108, -0.048], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1443, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0206, 0.05, 0.002], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg2-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_propodus_l_37.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0206, 0.05, 0.002], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg2-merus-l"] ?? root).add(node_leg2_propodus_l_37);
  nodes["leg2-propodus-l"] = node_leg2_propodus_l_37;
  const mesh_leg2_propodus_l_37Geometry = endpoint_leg2_propodus_l_37
    ? new THREE.CylinderGeometry(endpoint_leg2_propodus_l_37.endRadius, endpoint_leg2_propodus_l_37.baseRadius, endpoint_leg2_propodus_l_37.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg2_propodus_l_37) {
    mesh_leg2_propodus_l_37Geometry.scale(0.072, 0.1443, 0.072);
  }
  const mesh_leg2_propodus_l_37 = new THREE.Mesh(
    mesh_leg2_propodus_l_37Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg2_propodus_l_37.name = "leg 2 propodus (l)";
  if (endpoint_leg2_propodus_l_37) {
    mesh_leg2_propodus_l_37.position.copy(endpoint_leg2_propodus_l_37.midpoint);
    mesh_leg2_propodus_l_37.quaternion.copy(endpoint_leg2_propodus_l_37.quaternion);
  }
  mesh_leg2_propodus_l_37.castShadow = options.castShadow ?? true;
  mesh_leg2_propodus_l_37.receiveShadow = options.receiveShadow ?? true;
  mesh_leg2_propodus_l_37.userData.sculptComponent = {"id": "leg2-propodus-l", "name": "leg 2 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-merus-l", "attachment": {"parentId": "leg2-merus-l", "parentSocket": "leg2-propodus-socket-l", "localStart": [0.3475, 0.158, -0.046], "localEnd": [0.3888, 0.058, -0.05], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1083. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1443, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3682, 0.108, -0.048], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1443, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0206, 0.05, 0.002], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg2-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_propodus_l_37.add(mesh_leg2_propodus_l_37);
  meshes["leg2-propodus-l"] = mesh_leg2_propodus_l_37;
  colliders["leg2-propodus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg2_dactyl_l_38 = {"parentId": "leg2-propodus-l", "parentSocket": "leg2-dactyl-socket-l", "localStart": [0.3888, 0.058, -0.05], "localEnd": [0.3955, 0.01, -0.0528], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg2_dactyl_l_38 = makeAttachmentEndpoint(attachment_leg2_dactyl_l_38);
  const node_leg2_dactyl_l_38 = new THREE.Group();
  node_leg2_dactyl_l_38.name = "leg 2 dactyl (l)__pivot";
  node_leg2_dactyl_l_38.scale.set(1, 1, 1);
  if (endpoint_leg2_dactyl_l_38) {
    node_leg2_dactyl_l_38.position.copy(endpoint_leg2_dactyl_l_38.start);
    node_leg2_dactyl_l_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg2_dactyl_l_38.position.set(0.3922, 0.034, -0.0514);
    node_leg2_dactyl_l_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg2_dactyl_l_38.userData.sculptComponent = {"id": "leg2-dactyl-l", "name": "leg 2 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-propodus-l", "attachment": {"parentId": "leg2-propodus-l", "parentSocket": "leg2-dactyl-socket-l", "localStart": [0.3888, 0.058, -0.05], "localEnd": [0.3955, 0.01, -0.0528], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3922, 0.034, -0.0514], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0034, 0.024, 0.0014], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg2-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_dactyl_l_38.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0034, 0.024, 0.0014], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg2-propodus-l"] ?? root).add(node_leg2_dactyl_l_38);
  nodes["leg2-dactyl-l"] = node_leg2_dactyl_l_38;
  const mesh_leg2_dactyl_l_38Geometry = endpoint_leg2_dactyl_l_38
    ? new THREE.CylinderGeometry(endpoint_leg2_dactyl_l_38.endRadius, endpoint_leg2_dactyl_l_38.baseRadius, endpoint_leg2_dactyl_l_38.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg2_dactyl_l_38) {
    mesh_leg2_dactyl_l_38Geometry.scale(0.048, 0.0725, 0.048);
  }
  const mesh_leg2_dactyl_l_38 = new THREE.Mesh(
    mesh_leg2_dactyl_l_38Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg2_dactyl_l_38.name = "leg 2 dactyl (l)";
  if (endpoint_leg2_dactyl_l_38) {
    mesh_leg2_dactyl_l_38.position.copy(endpoint_leg2_dactyl_l_38.midpoint);
    mesh_leg2_dactyl_l_38.quaternion.copy(endpoint_leg2_dactyl_l_38.quaternion);
  }
  mesh_leg2_dactyl_l_38.castShadow = options.castShadow ?? true;
  mesh_leg2_dactyl_l_38.receiveShadow = options.receiveShadow ?? true;
  mesh_leg2_dactyl_l_38.userData.sculptComponent = {"id": "leg2-dactyl-l", "name": "leg 2 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-propodus-l", "attachment": {"parentId": "leg2-propodus-l", "parentSocket": "leg2-dactyl-socket-l", "localStart": [0.3888, 0.058, -0.05], "localEnd": [0.3955, 0.01, -0.0528], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3922, 0.034, -0.0514], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0034, 0.024, 0.0014], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg2-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_dactyl_l_38.add(mesh_leg2_dactyl_l_38);
  meshes["leg2-dactyl-l"] = mesh_leg2_dactyl_l_38;
  colliders["leg2-dactyl-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg2_merus_r_39 = {"parentId": "carapace", "parentSocket": "leg2-merus-socket-r", "localStart": [-0.25, 0.272, -0.04], "localEnd": [-0.3475, 0.158, -0.046], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1501. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg2_merus_r_39 = makeAttachmentEndpoint(attachment_leg2_merus_r_39);
  const node_leg2_merus_r_39 = new THREE.Group();
  node_leg2_merus_r_39.name = "leg 2 merus (r)__pivot";
  node_leg2_merus_r_39.scale.set(1, 1, 1);
  if (endpoint_leg2_merus_r_39) {
    node_leg2_merus_r_39.position.copy(endpoint_leg2_merus_r_39.start);
    node_leg2_merus_r_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg2_merus_r_39.position.set(-0.2988, 0.215, -0.043);
    node_leg2_merus_r_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg2_merus_r_39.userData.sculptComponent = {"id": "leg2-merus-r", "name": "leg 2 merus (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg2-merus-socket-r", "localStart": [-0.25, 0.272, -0.04], "localEnd": [-0.3475, 0.158, -0.046], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1501. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1961, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.2988, 0.215, -0.043], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1961, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0488, 0.057, 0.003], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg2R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg2-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_merus_r_39.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0488, 0.057, 0.003], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg2_merus_r_39);
  nodes["leg2-merus-r"] = node_leg2_merus_r_39;
  const mesh_leg2_merus_r_39Geometry = endpoint_leg2_merus_r_39
    ? new THREE.CylinderGeometry(endpoint_leg2_merus_r_39.endRadius, endpoint_leg2_merus_r_39.baseRadius, endpoint_leg2_merus_r_39.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg2_merus_r_39) {
    mesh_leg2_merus_r_39Geometry.scale(0.092, 0.1961, 0.092);
  }
  const mesh_leg2_merus_r_39 = new THREE.Mesh(
    mesh_leg2_merus_r_39Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg2_merus_r_39.name = "leg 2 merus (r)";
  if (endpoint_leg2_merus_r_39) {
    mesh_leg2_merus_r_39.position.copy(endpoint_leg2_merus_r_39.midpoint);
    mesh_leg2_merus_r_39.quaternion.copy(endpoint_leg2_merus_r_39.quaternion);
  }
  mesh_leg2_merus_r_39.castShadow = options.castShadow ?? true;
  mesh_leg2_merus_r_39.receiveShadow = options.receiveShadow ?? true;
  mesh_leg2_merus_r_39.userData.sculptComponent = {"id": "leg2-merus-r", "name": "leg 2 merus (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg2-merus-socket-r", "localStart": [-0.25, 0.272, -0.04], "localEnd": [-0.3475, 0.158, -0.046], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1501. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1961, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.2988, 0.215, -0.043], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1961, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0488, 0.057, 0.003], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg2R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg2-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_merus_r_39.add(mesh_leg2_merus_r_39);
  meshes["leg2-merus-r"] = mesh_leg2_merus_r_39;
  colliders["leg2-merus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg2_propodus_r_40 = {"parentId": "leg2-merus-r", "parentSocket": "leg2-propodus-socket-r", "localStart": [-0.3475, 0.158, -0.046], "localEnd": [-0.3888, 0.058, -0.05], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1083. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg2_propodus_r_40 = makeAttachmentEndpoint(attachment_leg2_propodus_r_40);
  const node_leg2_propodus_r_40 = new THREE.Group();
  node_leg2_propodus_r_40.name = "leg 2 propodus (r)__pivot";
  node_leg2_propodus_r_40.scale.set(1, 1, 1);
  if (endpoint_leg2_propodus_r_40) {
    node_leg2_propodus_r_40.position.copy(endpoint_leg2_propodus_r_40.start);
    node_leg2_propodus_r_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg2_propodus_r_40.position.set(-0.3682, 0.108, -0.048);
    node_leg2_propodus_r_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg2_propodus_r_40.userData.sculptComponent = {"id": "leg2-propodus-r", "name": "leg 2 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-merus-r", "attachment": {"parentId": "leg2-merus-r", "parentSocket": "leg2-propodus-socket-r", "localStart": [-0.3475, 0.158, -0.046], "localEnd": [-0.3888, 0.058, -0.05], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1083. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1443, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3682, 0.108, -0.048], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1443, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0206, 0.05, 0.002], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg2-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_propodus_r_40.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0206, 0.05, 0.002], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg2-merus-r"] ?? root).add(node_leg2_propodus_r_40);
  nodes["leg2-propodus-r"] = node_leg2_propodus_r_40;
  const mesh_leg2_propodus_r_40Geometry = endpoint_leg2_propodus_r_40
    ? new THREE.CylinderGeometry(endpoint_leg2_propodus_r_40.endRadius, endpoint_leg2_propodus_r_40.baseRadius, endpoint_leg2_propodus_r_40.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg2_propodus_r_40) {
    mesh_leg2_propodus_r_40Geometry.scale(0.072, 0.1443, 0.072);
  }
  const mesh_leg2_propodus_r_40 = new THREE.Mesh(
    mesh_leg2_propodus_r_40Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg2_propodus_r_40.name = "leg 2 propodus (r)";
  if (endpoint_leg2_propodus_r_40) {
    mesh_leg2_propodus_r_40.position.copy(endpoint_leg2_propodus_r_40.midpoint);
    mesh_leg2_propodus_r_40.quaternion.copy(endpoint_leg2_propodus_r_40.quaternion);
  }
  mesh_leg2_propodus_r_40.castShadow = options.castShadow ?? true;
  mesh_leg2_propodus_r_40.receiveShadow = options.receiveShadow ?? true;
  mesh_leg2_propodus_r_40.userData.sculptComponent = {"id": "leg2-propodus-r", "name": "leg 2 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-merus-r", "attachment": {"parentId": "leg2-merus-r", "parentSocket": "leg2-propodus-socket-r", "localStart": [-0.3475, 0.158, -0.046], "localEnd": [-0.3888, 0.058, -0.05], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1083. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1443, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3682, 0.108, -0.048], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1443, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0206, 0.05, 0.002], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg2-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_propodus_r_40.add(mesh_leg2_propodus_r_40);
  meshes["leg2-propodus-r"] = mesh_leg2_propodus_r_40;
  colliders["leg2-propodus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg2_dactyl_r_41 = {"parentId": "leg2-propodus-r", "parentSocket": "leg2-dactyl-socket-r", "localStart": [-0.3888, 0.058, -0.05], "localEnd": [-0.3955, 0.01, -0.0528], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg2_dactyl_r_41 = makeAttachmentEndpoint(attachment_leg2_dactyl_r_41);
  const node_leg2_dactyl_r_41 = new THREE.Group();
  node_leg2_dactyl_r_41.name = "leg 2 dactyl (r)__pivot";
  node_leg2_dactyl_r_41.scale.set(1, 1, 1);
  if (endpoint_leg2_dactyl_r_41) {
    node_leg2_dactyl_r_41.position.copy(endpoint_leg2_dactyl_r_41.start);
    node_leg2_dactyl_r_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg2_dactyl_r_41.position.set(-0.3922, 0.034, -0.0514);
    node_leg2_dactyl_r_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg2_dactyl_r_41.userData.sculptComponent = {"id": "leg2-dactyl-r", "name": "leg 2 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-propodus-r", "attachment": {"parentId": "leg2-propodus-r", "parentSocket": "leg2-dactyl-socket-r", "localStart": [-0.3888, 0.058, -0.05], "localEnd": [-0.3955, 0.01, -0.0528], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3922, 0.034, -0.0514], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0034, 0.024, 0.0014], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg2-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_dactyl_r_41.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0034, 0.024, 0.0014], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg2-propodus-r"] ?? root).add(node_leg2_dactyl_r_41);
  nodes["leg2-dactyl-r"] = node_leg2_dactyl_r_41;
  const mesh_leg2_dactyl_r_41Geometry = endpoint_leg2_dactyl_r_41
    ? new THREE.CylinderGeometry(endpoint_leg2_dactyl_r_41.endRadius, endpoint_leg2_dactyl_r_41.baseRadius, endpoint_leg2_dactyl_r_41.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg2_dactyl_r_41) {
    mesh_leg2_dactyl_r_41Geometry.scale(0.048, 0.0725, 0.048);
  }
  const mesh_leg2_dactyl_r_41 = new THREE.Mesh(
    mesh_leg2_dactyl_r_41Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg2_dactyl_r_41.name = "leg 2 dactyl (r)";
  if (endpoint_leg2_dactyl_r_41) {
    mesh_leg2_dactyl_r_41.position.copy(endpoint_leg2_dactyl_r_41.midpoint);
    mesh_leg2_dactyl_r_41.quaternion.copy(endpoint_leg2_dactyl_r_41.quaternion);
  }
  mesh_leg2_dactyl_r_41.castShadow = options.castShadow ?? true;
  mesh_leg2_dactyl_r_41.receiveShadow = options.receiveShadow ?? true;
  mesh_leg2_dactyl_r_41.userData.sculptComponent = {"id": "leg2-dactyl-r", "name": "leg 2 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg2-propodus-r", "attachment": {"parentId": "leg2-propodus-r", "parentSocket": "leg2-dactyl-socket-r", "localStart": [-0.3888, 0.058, -0.05], "localEnd": [-0.3955, 0.01, -0.0528], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0485. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0725, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3922, 0.034, -0.0514], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0725, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0034, 0.024, 0.0014], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg2-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg2_dactyl_r_41.add(mesh_leg2_dactyl_r_41);
  meshes["leg2-dactyl-r"] = mesh_leg2_dactyl_r_41;
  colliders["leg2-dactyl-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg3_merus_l_42 = {"parentId": "carapace", "parentSocket": "leg3-merus-socket-l", "localStart": [0.25, 0.272, -0.1], "localEnd": [0.3149, 0.158, -0.115], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1321. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg3_merus_l_42 = makeAttachmentEndpoint(attachment_leg3_merus_l_42);
  const node_leg3_merus_l_42 = new THREE.Group();
  node_leg3_merus_l_42.name = "leg 3 merus (l)__pivot";
  node_leg3_merus_l_42.scale.set(1, 1, 1);
  if (endpoint_leg3_merus_l_42) {
    node_leg3_merus_l_42.position.copy(endpoint_leg3_merus_l_42.start);
    node_leg3_merus_l_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg3_merus_l_42.position.set(0.2825, 0.215, -0.1075);
    node_leg3_merus_l_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg3_merus_l_42.userData.sculptComponent = {"id": "leg3-merus-l", "name": "leg 3 merus (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg3-merus-socket-l", "localStart": [0.25, 0.272, -0.1], "localEnd": [0.3149, 0.158, -0.115], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1321. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1781, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.2825, 0.215, -0.1075], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1781, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0325, 0.057, 0.0075], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg3L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg3-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_merus_l_42.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0325, 0.057, 0.0075], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg3_merus_l_42);
  nodes["leg3-merus-l"] = node_leg3_merus_l_42;
  const mesh_leg3_merus_l_42Geometry = endpoint_leg3_merus_l_42
    ? new THREE.CylinderGeometry(endpoint_leg3_merus_l_42.endRadius, endpoint_leg3_merus_l_42.baseRadius, endpoint_leg3_merus_l_42.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg3_merus_l_42) {
    mesh_leg3_merus_l_42Geometry.scale(0.092, 0.1781, 0.092);
  }
  const mesh_leg3_merus_l_42 = new THREE.Mesh(
    mesh_leg3_merus_l_42Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg3_merus_l_42.name = "leg 3 merus (l)";
  if (endpoint_leg3_merus_l_42) {
    mesh_leg3_merus_l_42.position.copy(endpoint_leg3_merus_l_42.midpoint);
    mesh_leg3_merus_l_42.quaternion.copy(endpoint_leg3_merus_l_42.quaternion);
  }
  mesh_leg3_merus_l_42.castShadow = options.castShadow ?? true;
  mesh_leg3_merus_l_42.receiveShadow = options.receiveShadow ?? true;
  mesh_leg3_merus_l_42.userData.sculptComponent = {"id": "leg3-merus-l", "name": "leg 3 merus (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg3-merus-socket-l", "localStart": [0.25, 0.272, -0.1], "localEnd": [0.3149, 0.158, -0.115], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1321. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1781, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.2825, 0.215, -0.1075], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1781, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0325, 0.057, 0.0075], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg3L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg3-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_merus_l_42.add(mesh_leg3_merus_l_42);
  meshes["leg3-merus-l"] = mesh_leg3_merus_l_42;
  colliders["leg3-merus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg3_propodus_l_43 = {"parentId": "leg3-merus-l", "parentSocket": "leg3-propodus-socket-l", "localStart": [0.3149, 0.158, -0.115], "localEnd": [0.3523, 0.058, -0.125], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1072. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg3_propodus_l_43 = makeAttachmentEndpoint(attachment_leg3_propodus_l_43);
  const node_leg3_propodus_l_43 = new THREE.Group();
  node_leg3_propodus_l_43.name = "leg 3 propodus (l)__pivot";
  node_leg3_propodus_l_43.scale.set(1, 1, 1);
  if (endpoint_leg3_propodus_l_43) {
    node_leg3_propodus_l_43.position.copy(endpoint_leg3_propodus_l_43.start);
    node_leg3_propodus_l_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg3_propodus_l_43.position.set(0.3336, 0.108, -0.12);
    node_leg3_propodus_l_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg3_propodus_l_43.userData.sculptComponent = {"id": "leg3-propodus-l", "name": "leg 3 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-merus-l", "attachment": {"parentId": "leg3-merus-l", "parentSocket": "leg3-propodus-socket-l", "localStart": [0.3149, 0.158, -0.115], "localEnd": [0.3523, 0.058, -0.125], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1072. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1432, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3336, 0.108, -0.12], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1432, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0187, 0.05, 0.005], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg3-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_propodus_l_43.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0187, 0.05, 0.005], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg3-merus-l"] ?? root).add(node_leg3_propodus_l_43);
  nodes["leg3-propodus-l"] = node_leg3_propodus_l_43;
  const mesh_leg3_propodus_l_43Geometry = endpoint_leg3_propodus_l_43
    ? new THREE.CylinderGeometry(endpoint_leg3_propodus_l_43.endRadius, endpoint_leg3_propodus_l_43.baseRadius, endpoint_leg3_propodus_l_43.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg3_propodus_l_43) {
    mesh_leg3_propodus_l_43Geometry.scale(0.072, 0.1432, 0.072);
  }
  const mesh_leg3_propodus_l_43 = new THREE.Mesh(
    mesh_leg3_propodus_l_43Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg3_propodus_l_43.name = "leg 3 propodus (l)";
  if (endpoint_leg3_propodus_l_43) {
    mesh_leg3_propodus_l_43.position.copy(endpoint_leg3_propodus_l_43.midpoint);
    mesh_leg3_propodus_l_43.quaternion.copy(endpoint_leg3_propodus_l_43.quaternion);
  }
  mesh_leg3_propodus_l_43.castShadow = options.castShadow ?? true;
  mesh_leg3_propodus_l_43.receiveShadow = options.receiveShadow ?? true;
  mesh_leg3_propodus_l_43.userData.sculptComponent = {"id": "leg3-propodus-l", "name": "leg 3 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-merus-l", "attachment": {"parentId": "leg3-merus-l", "parentSocket": "leg3-propodus-socket-l", "localStart": [0.3149, 0.158, -0.115], "localEnd": [0.3523, 0.058, -0.125], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1072. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1432, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3336, 0.108, -0.12], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1432, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0187, 0.05, 0.005], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg3-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_propodus_l_43.add(mesh_leg3_propodus_l_43);
  meshes["leg3-propodus-l"] = mesh_leg3_propodus_l_43;
  colliders["leg3-propodus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg3_dactyl_l_44 = {"parentId": "leg3-propodus-l", "parentSocket": "leg3-dactyl-socket-l", "localStart": [0.3523, 0.058, -0.125], "localEnd": [0.3584, 0.01, -0.132], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0489. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg3_dactyl_l_44 = makeAttachmentEndpoint(attachment_leg3_dactyl_l_44);
  const node_leg3_dactyl_l_44 = new THREE.Group();
  node_leg3_dactyl_l_44.name = "leg 3 dactyl (l)__pivot";
  node_leg3_dactyl_l_44.scale.set(1, 1, 1);
  if (endpoint_leg3_dactyl_l_44) {
    node_leg3_dactyl_l_44.position.copy(endpoint_leg3_dactyl_l_44.start);
    node_leg3_dactyl_l_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg3_dactyl_l_44.position.set(0.3554, 0.034, -0.1285);
    node_leg3_dactyl_l_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg3_dactyl_l_44.userData.sculptComponent = {"id": "leg3-dactyl-l", "name": "leg 3 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-propodus-l", "attachment": {"parentId": "leg3-propodus-l", "parentSocket": "leg3-dactyl-socket-l", "localStart": [0.3523, 0.058, -0.125], "localEnd": [0.3584, 0.01, -0.132], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0489. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0729, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3554, 0.034, -0.1285], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0729, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.003, 0.024, 0.0035], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg3-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_dactyl_l_44.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.003, 0.024, 0.0035], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg3-propodus-l"] ?? root).add(node_leg3_dactyl_l_44);
  nodes["leg3-dactyl-l"] = node_leg3_dactyl_l_44;
  const mesh_leg3_dactyl_l_44Geometry = endpoint_leg3_dactyl_l_44
    ? new THREE.CylinderGeometry(endpoint_leg3_dactyl_l_44.endRadius, endpoint_leg3_dactyl_l_44.baseRadius, endpoint_leg3_dactyl_l_44.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg3_dactyl_l_44) {
    mesh_leg3_dactyl_l_44Geometry.scale(0.048, 0.0729, 0.048);
  }
  const mesh_leg3_dactyl_l_44 = new THREE.Mesh(
    mesh_leg3_dactyl_l_44Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg3_dactyl_l_44.name = "leg 3 dactyl (l)";
  if (endpoint_leg3_dactyl_l_44) {
    mesh_leg3_dactyl_l_44.position.copy(endpoint_leg3_dactyl_l_44.midpoint);
    mesh_leg3_dactyl_l_44.quaternion.copy(endpoint_leg3_dactyl_l_44.quaternion);
  }
  mesh_leg3_dactyl_l_44.castShadow = options.castShadow ?? true;
  mesh_leg3_dactyl_l_44.receiveShadow = options.receiveShadow ?? true;
  mesh_leg3_dactyl_l_44.userData.sculptComponent = {"id": "leg3-dactyl-l", "name": "leg 3 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-propodus-l", "attachment": {"parentId": "leg3-propodus-l", "parentSocket": "leg3-dactyl-socket-l", "localStart": [0.3523, 0.058, -0.125], "localEnd": [0.3584, 0.01, -0.132], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0489. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0729, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3554, 0.034, -0.1285], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0729, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.003, 0.024, 0.0035], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg3-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_dactyl_l_44.add(mesh_leg3_dactyl_l_44);
  meshes["leg3-dactyl-l"] = mesh_leg3_dactyl_l_44;
  colliders["leg3-dactyl-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg3_merus_r_45 = {"parentId": "carapace", "parentSocket": "leg3-merus-socket-r", "localStart": [-0.25, 0.272, -0.1], "localEnd": [-0.3149, 0.158, -0.115], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1321. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg3_merus_r_45 = makeAttachmentEndpoint(attachment_leg3_merus_r_45);
  const node_leg3_merus_r_45 = new THREE.Group();
  node_leg3_merus_r_45.name = "leg 3 merus (r)__pivot";
  node_leg3_merus_r_45.scale.set(1, 1, 1);
  if (endpoint_leg3_merus_r_45) {
    node_leg3_merus_r_45.position.copy(endpoint_leg3_merus_r_45.start);
    node_leg3_merus_r_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg3_merus_r_45.position.set(-0.2825, 0.215, -0.1075);
    node_leg3_merus_r_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg3_merus_r_45.userData.sculptComponent = {"id": "leg3-merus-r", "name": "leg 3 merus (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg3-merus-socket-r", "localStart": [-0.25, 0.272, -0.1], "localEnd": [-0.3149, 0.158, -0.115], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1321. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1781, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.2825, 0.215, -0.1075], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1781, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0325, 0.057, 0.0075], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg3R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg3-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_merus_r_45.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0325, 0.057, 0.0075], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg3_merus_r_45);
  nodes["leg3-merus-r"] = node_leg3_merus_r_45;
  const mesh_leg3_merus_r_45Geometry = endpoint_leg3_merus_r_45
    ? new THREE.CylinderGeometry(endpoint_leg3_merus_r_45.endRadius, endpoint_leg3_merus_r_45.baseRadius, endpoint_leg3_merus_r_45.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg3_merus_r_45) {
    mesh_leg3_merus_r_45Geometry.scale(0.092, 0.1781, 0.092);
  }
  const mesh_leg3_merus_r_45 = new THREE.Mesh(
    mesh_leg3_merus_r_45Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg3_merus_r_45.name = "leg 3 merus (r)";
  if (endpoint_leg3_merus_r_45) {
    mesh_leg3_merus_r_45.position.copy(endpoint_leg3_merus_r_45.midpoint);
    mesh_leg3_merus_r_45.quaternion.copy(endpoint_leg3_merus_r_45.quaternion);
  }
  mesh_leg3_merus_r_45.castShadow = options.castShadow ?? true;
  mesh_leg3_merus_r_45.receiveShadow = options.receiveShadow ?? true;
  mesh_leg3_merus_r_45.userData.sculptComponent = {"id": "leg3-merus-r", "name": "leg 3 merus (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg3-merus-socket-r", "localStart": [-0.25, 0.272, -0.1], "localEnd": [-0.3149, 0.158, -0.115], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1321. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1781, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.2825, 0.215, -0.1075], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1781, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0325, 0.057, 0.0075], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg3R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg3-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_merus_r_45.add(mesh_leg3_merus_r_45);
  meshes["leg3-merus-r"] = mesh_leg3_merus_r_45;
  colliders["leg3-merus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg3_propodus_r_46 = {"parentId": "leg3-merus-r", "parentSocket": "leg3-propodus-socket-r", "localStart": [-0.3149, 0.158, -0.115], "localEnd": [-0.3523, 0.058, -0.125], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1072. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg3_propodus_r_46 = makeAttachmentEndpoint(attachment_leg3_propodus_r_46);
  const node_leg3_propodus_r_46 = new THREE.Group();
  node_leg3_propodus_r_46.name = "leg 3 propodus (r)__pivot";
  node_leg3_propodus_r_46.scale.set(1, 1, 1);
  if (endpoint_leg3_propodus_r_46) {
    node_leg3_propodus_r_46.position.copy(endpoint_leg3_propodus_r_46.start);
    node_leg3_propodus_r_46.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg3_propodus_r_46.position.set(-0.3336, 0.108, -0.12);
    node_leg3_propodus_r_46.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg3_propodus_r_46.userData.sculptComponent = {"id": "leg3-propodus-r", "name": "leg 3 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-merus-r", "attachment": {"parentId": "leg3-merus-r", "parentSocket": "leg3-propodus-socket-r", "localStart": [-0.3149, 0.158, -0.115], "localEnd": [-0.3523, 0.058, -0.125], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1072. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1432, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3336, 0.108, -0.12], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1432, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0187, 0.05, 0.005], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg3-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_propodus_r_46.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0187, 0.05, 0.005], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg3-merus-r"] ?? root).add(node_leg3_propodus_r_46);
  nodes["leg3-propodus-r"] = node_leg3_propodus_r_46;
  const mesh_leg3_propodus_r_46Geometry = endpoint_leg3_propodus_r_46
    ? new THREE.CylinderGeometry(endpoint_leg3_propodus_r_46.endRadius, endpoint_leg3_propodus_r_46.baseRadius, endpoint_leg3_propodus_r_46.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg3_propodus_r_46) {
    mesh_leg3_propodus_r_46Geometry.scale(0.072, 0.1432, 0.072);
  }
  const mesh_leg3_propodus_r_46 = new THREE.Mesh(
    mesh_leg3_propodus_r_46Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg3_propodus_r_46.name = "leg 3 propodus (r)";
  if (endpoint_leg3_propodus_r_46) {
    mesh_leg3_propodus_r_46.position.copy(endpoint_leg3_propodus_r_46.midpoint);
    mesh_leg3_propodus_r_46.quaternion.copy(endpoint_leg3_propodus_r_46.quaternion);
  }
  mesh_leg3_propodus_r_46.castShadow = options.castShadow ?? true;
  mesh_leg3_propodus_r_46.receiveShadow = options.receiveShadow ?? true;
  mesh_leg3_propodus_r_46.userData.sculptComponent = {"id": "leg3-propodus-r", "name": "leg 3 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-merus-r", "attachment": {"parentId": "leg3-merus-r", "parentSocket": "leg3-propodus-socket-r", "localStart": [-0.3149, 0.158, -0.115], "localEnd": [-0.3523, 0.058, -0.125], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1072. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1432, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3336, 0.108, -0.12], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1432, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0187, 0.05, 0.005], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg3-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_propodus_r_46.add(mesh_leg3_propodus_r_46);
  meshes["leg3-propodus-r"] = mesh_leg3_propodus_r_46;
  colliders["leg3-propodus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg3_dactyl_r_47 = {"parentId": "leg3-propodus-r", "parentSocket": "leg3-dactyl-socket-r", "localStart": [-0.3523, 0.058, -0.125], "localEnd": [-0.3584, 0.01, -0.132], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0489. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg3_dactyl_r_47 = makeAttachmentEndpoint(attachment_leg3_dactyl_r_47);
  const node_leg3_dactyl_r_47 = new THREE.Group();
  node_leg3_dactyl_r_47.name = "leg 3 dactyl (r)__pivot";
  node_leg3_dactyl_r_47.scale.set(1, 1, 1);
  if (endpoint_leg3_dactyl_r_47) {
    node_leg3_dactyl_r_47.position.copy(endpoint_leg3_dactyl_r_47.start);
    node_leg3_dactyl_r_47.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg3_dactyl_r_47.position.set(-0.3554, 0.034, -0.1285);
    node_leg3_dactyl_r_47.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg3_dactyl_r_47.userData.sculptComponent = {"id": "leg3-dactyl-r", "name": "leg 3 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-propodus-r", "attachment": {"parentId": "leg3-propodus-r", "parentSocket": "leg3-dactyl-socket-r", "localStart": [-0.3523, 0.058, -0.125], "localEnd": [-0.3584, 0.01, -0.132], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0489. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0729, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3554, 0.034, -0.1285], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0729, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.003, 0.024, 0.0035], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg3-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_dactyl_r_47.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.003, 0.024, 0.0035], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg3-propodus-r"] ?? root).add(node_leg3_dactyl_r_47);
  nodes["leg3-dactyl-r"] = node_leg3_dactyl_r_47;
  const mesh_leg3_dactyl_r_47Geometry = endpoint_leg3_dactyl_r_47
    ? new THREE.CylinderGeometry(endpoint_leg3_dactyl_r_47.endRadius, endpoint_leg3_dactyl_r_47.baseRadius, endpoint_leg3_dactyl_r_47.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg3_dactyl_r_47) {
    mesh_leg3_dactyl_r_47Geometry.scale(0.048, 0.0729, 0.048);
  }
  const mesh_leg3_dactyl_r_47 = new THREE.Mesh(
    mesh_leg3_dactyl_r_47Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg3_dactyl_r_47.name = "leg 3 dactyl (r)";
  if (endpoint_leg3_dactyl_r_47) {
    mesh_leg3_dactyl_r_47.position.copy(endpoint_leg3_dactyl_r_47.midpoint);
    mesh_leg3_dactyl_r_47.quaternion.copy(endpoint_leg3_dactyl_r_47.quaternion);
  }
  mesh_leg3_dactyl_r_47.castShadow = options.castShadow ?? true;
  mesh_leg3_dactyl_r_47.receiveShadow = options.receiveShadow ?? true;
  mesh_leg3_dactyl_r_47.userData.sculptComponent = {"id": "leg3-dactyl-r", "name": "leg 3 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg3-propodus-r", "attachment": {"parentId": "leg3-propodus-r", "parentSocket": "leg3-dactyl-socket-r", "localStart": [-0.3523, 0.058, -0.125], "localEnd": [-0.3584, 0.01, -0.132], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0489. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0729, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3554, 0.034, -0.1285], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0729, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.003, 0.024, 0.0035], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg3-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg3_dactyl_r_47.add(mesh_leg3_dactyl_r_47);
  meshes["leg3-dactyl-r"] = mesh_leg3_dactyl_r_47;
  colliders["leg3-dactyl-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg4_merus_l_48 = {"parentId": "carapace", "parentSocket": "leg4-merus-socket-l", "localStart": [0.25, 0.272, -0.16], "localEnd": [0.2715, 0.158, -0.184], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1185. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg4_merus_l_48 = makeAttachmentEndpoint(attachment_leg4_merus_l_48);
  const node_leg4_merus_l_48 = new THREE.Group();
  node_leg4_merus_l_48.name = "leg 4 merus (l)__pivot";
  node_leg4_merus_l_48.scale.set(1, 1, 1);
  if (endpoint_leg4_merus_l_48) {
    node_leg4_merus_l_48.position.copy(endpoint_leg4_merus_l_48.start);
    node_leg4_merus_l_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg4_merus_l_48.position.set(0.2607, 0.215, -0.172);
    node_leg4_merus_l_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg4_merus_l_48.userData.sculptComponent = {"id": "leg4-merus-l", "name": "leg 4 merus (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg4-merus-socket-l", "localStart": [0.25, 0.272, -0.16], "localEnd": [0.2715, 0.158, -0.184], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1185. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1645, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.2607, 0.215, -0.172], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1645, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0107, 0.057, 0.012], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg4L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg4-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_merus_l_48.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0107, 0.057, 0.012], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg4_merus_l_48);
  nodes["leg4-merus-l"] = node_leg4_merus_l_48;
  const mesh_leg4_merus_l_48Geometry = endpoint_leg4_merus_l_48
    ? new THREE.CylinderGeometry(endpoint_leg4_merus_l_48.endRadius, endpoint_leg4_merus_l_48.baseRadius, endpoint_leg4_merus_l_48.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg4_merus_l_48) {
    mesh_leg4_merus_l_48Geometry.scale(0.092, 0.1645, 0.092);
  }
  const mesh_leg4_merus_l_48 = new THREE.Mesh(
    mesh_leg4_merus_l_48Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg4_merus_l_48.name = "leg 4 merus (l)";
  if (endpoint_leg4_merus_l_48) {
    mesh_leg4_merus_l_48.position.copy(endpoint_leg4_merus_l_48.midpoint);
    mesh_leg4_merus_l_48.quaternion.copy(endpoint_leg4_merus_l_48.quaternion);
  }
  mesh_leg4_merus_l_48.castShadow = options.castShadow ?? true;
  mesh_leg4_merus_l_48.receiveShadow = options.receiveShadow ?? true;
  mesh_leg4_merus_l_48.userData.sculptComponent = {"id": "leg4-merus-l", "name": "leg 4 merus (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg4-merus-socket-l", "localStart": [0.25, 0.272, -0.16], "localEnd": [0.2715, 0.158, -0.184], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1185. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1645, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [0.2607, 0.215, -0.172], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1645, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [-0.0107, 0.057, 0.012], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg4L' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg4-merus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_merus_l_48.add(mesh_leg4_merus_l_48);
  meshes["leg4-merus-l"] = mesh_leg4_merus_l_48;
  colliders["leg4-merus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg4_propodus_l_49 = {"parentId": "leg4-merus-l", "parentSocket": "leg4-propodus-socket-l", "localStart": [0.2715, 0.158, -0.184], "localEnd": [0.3038, 0.058, -0.2], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1063. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg4_propodus_l_49 = makeAttachmentEndpoint(attachment_leg4_propodus_l_49);
  const node_leg4_propodus_l_49 = new THREE.Group();
  node_leg4_propodus_l_49.name = "leg 4 propodus (l)__pivot";
  node_leg4_propodus_l_49.scale.set(1, 1, 1);
  if (endpoint_leg4_propodus_l_49) {
    node_leg4_propodus_l_49.position.copy(endpoint_leg4_propodus_l_49.start);
    node_leg4_propodus_l_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg4_propodus_l_49.position.set(0.2876, 0.108, -0.192);
    node_leg4_propodus_l_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg4_propodus_l_49.userData.sculptComponent = {"id": "leg4-propodus-l", "name": "leg 4 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-merus-l", "attachment": {"parentId": "leg4-merus-l", "parentSocket": "leg4-propodus-socket-l", "localStart": [0.2715, 0.158, -0.184], "localEnd": [0.3038, 0.058, -0.2], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1063. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1423, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.2876, 0.108, -0.192], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1423, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0161, 0.05, 0.008], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg4-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_propodus_l_49.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0161, 0.05, 0.008], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg4-merus-l"] ?? root).add(node_leg4_propodus_l_49);
  nodes["leg4-propodus-l"] = node_leg4_propodus_l_49;
  const mesh_leg4_propodus_l_49Geometry = endpoint_leg4_propodus_l_49
    ? new THREE.CylinderGeometry(endpoint_leg4_propodus_l_49.endRadius, endpoint_leg4_propodus_l_49.baseRadius, endpoint_leg4_propodus_l_49.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg4_propodus_l_49) {
    mesh_leg4_propodus_l_49Geometry.scale(0.072, 0.1423, 0.072);
  }
  const mesh_leg4_propodus_l_49 = new THREE.Mesh(
    mesh_leg4_propodus_l_49Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg4_propodus_l_49.name = "leg 4 propodus (l)";
  if (endpoint_leg4_propodus_l_49) {
    mesh_leg4_propodus_l_49.position.copy(endpoint_leg4_propodus_l_49.midpoint);
    mesh_leg4_propodus_l_49.quaternion.copy(endpoint_leg4_propodus_l_49.quaternion);
  }
  mesh_leg4_propodus_l_49.castShadow = options.castShadow ?? true;
  mesh_leg4_propodus_l_49.receiveShadow = options.receiveShadow ?? true;
  mesh_leg4_propodus_l_49.userData.sculptComponent = {"id": "leg4-propodus-l", "name": "leg 4 propodus (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-merus-l", "attachment": {"parentId": "leg4-merus-l", "parentSocket": "leg4-propodus-socket-l", "localStart": [0.2715, 0.158, -0.184], "localEnd": [0.3038, 0.058, -0.2], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1063. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1423, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.2876, 0.108, -0.192], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1423, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0161, 0.05, 0.008], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg4-propodus-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_propodus_l_49.add(mesh_leg4_propodus_l_49);
  meshes["leg4-propodus-l"] = mesh_leg4_propodus_l_49;
  colliders["leg4-propodus-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg4_dactyl_l_50 = {"parentId": "leg4-propodus-l", "parentSocket": "leg4-dactyl-socket-l", "localStart": [0.3038, 0.058, -0.2], "localEnd": [0.309, 0.01, -0.2112], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0496. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg4_dactyl_l_50 = makeAttachmentEndpoint(attachment_leg4_dactyl_l_50);
  const node_leg4_dactyl_l_50 = new THREE.Group();
  node_leg4_dactyl_l_50.name = "leg 4 dactyl (l)__pivot";
  node_leg4_dactyl_l_50.scale.set(1, 1, 1);
  if (endpoint_leg4_dactyl_l_50) {
    node_leg4_dactyl_l_50.position.copy(endpoint_leg4_dactyl_l_50.start);
    node_leg4_dactyl_l_50.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg4_dactyl_l_50.position.set(0.3064, 0.034, -0.2056);
    node_leg4_dactyl_l_50.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg4_dactyl_l_50.userData.sculptComponent = {"id": "leg4-dactyl-l", "name": "leg 4 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-propodus-l", "attachment": {"parentId": "leg4-propodus-l", "parentSocket": "leg4-dactyl-socket-l", "localStart": [0.3038, 0.058, -0.2], "localEnd": [0.309, 0.01, -0.2112], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0496. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0736, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3064, 0.034, -0.2056], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0736, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0026, 0.024, 0.0056], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg4-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_dactyl_l_50.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0026, 0.024, 0.0056], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg4-propodus-l"] ?? root).add(node_leg4_dactyl_l_50);
  nodes["leg4-dactyl-l"] = node_leg4_dactyl_l_50;
  const mesh_leg4_dactyl_l_50Geometry = endpoint_leg4_dactyl_l_50
    ? new THREE.CylinderGeometry(endpoint_leg4_dactyl_l_50.endRadius, endpoint_leg4_dactyl_l_50.baseRadius, endpoint_leg4_dactyl_l_50.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg4_dactyl_l_50) {
    mesh_leg4_dactyl_l_50Geometry.scale(0.048, 0.0736, 0.048);
  }
  const mesh_leg4_dactyl_l_50 = new THREE.Mesh(
    mesh_leg4_dactyl_l_50Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg4_dactyl_l_50.name = "leg 4 dactyl (l)";
  if (endpoint_leg4_dactyl_l_50) {
    mesh_leg4_dactyl_l_50.position.copy(endpoint_leg4_dactyl_l_50.midpoint);
    mesh_leg4_dactyl_l_50.quaternion.copy(endpoint_leg4_dactyl_l_50.quaternion);
  }
  mesh_leg4_dactyl_l_50.castShadow = options.castShadow ?? true;
  mesh_leg4_dactyl_l_50.receiveShadow = options.receiveShadow ?? true;
  mesh_leg4_dactyl_l_50.userData.sculptComponent = {"id": "leg4-dactyl-l", "name": "leg 4 dactyl (l)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-propodus-l", "attachment": {"parentId": "leg4-propodus-l", "parentSocket": "leg4-dactyl-socket-l", "localStart": [0.3038, 0.058, -0.2], "localEnd": [0.309, 0.01, -0.2112], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0496. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0736, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [0.3064, 0.034, -0.2056], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0736, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [-0.0026, 0.024, 0.0056], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg4-dactyl-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_dactyl_l_50.add(mesh_leg4_dactyl_l_50);
  meshes["leg4-dactyl-l"] = mesh_leg4_dactyl_l_50;
  colliders["leg4-dactyl-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg4_merus_r_51 = {"parentId": "carapace", "parentSocket": "leg4-merus-socket-r", "localStart": [-0.25, 0.272, -0.16], "localEnd": [-0.2715, 0.158, -0.184], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1185. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg4_merus_r_51 = makeAttachmentEndpoint(attachment_leg4_merus_r_51);
  const node_leg4_merus_r_51 = new THREE.Group();
  node_leg4_merus_r_51.name = "leg 4 merus (r)__pivot";
  node_leg4_merus_r_51.scale.set(1, 1, 1);
  if (endpoint_leg4_merus_r_51) {
    node_leg4_merus_r_51.position.copy(endpoint_leg4_merus_r_51.start);
    node_leg4_merus_r_51.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg4_merus_r_51.position.set(-0.2607, 0.215, -0.172);
    node_leg4_merus_r_51.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg4_merus_r_51.userData.sculptComponent = {"id": "leg4-merus-r", "name": "leg 4 merus (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg4-merus-socket-r", "localStart": [-0.25, 0.272, -0.16], "localEnd": [-0.2715, 0.158, -0.184], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1185. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1645, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.2607, 0.215, -0.172], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1645, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0107, 0.057, 0.012], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg4R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg4-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_merus_r_51.userData.actionProfile = {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0107, 0.057, 0.012], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["carapace"] ?? root).add(node_leg4_merus_r_51);
  nodes["leg4-merus-r"] = node_leg4_merus_r_51;
  const mesh_leg4_merus_r_51Geometry = endpoint_leg4_merus_r_51
    ? new THREE.CylinderGeometry(endpoint_leg4_merus_r_51.endRadius, endpoint_leg4_merus_r_51.baseRadius, endpoint_leg4_merus_r_51.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg4_merus_r_51) {
    mesh_leg4_merus_r_51Geometry.scale(0.092, 0.1645, 0.092);
  }
  const mesh_leg4_merus_r_51 = new THREE.Mesh(
    mesh_leg4_merus_r_51Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg4_merus_r_51.name = "leg 4 merus (r)";
  if (endpoint_leg4_merus_r_51) {
    mesh_leg4_merus_r_51.position.copy(endpoint_leg4_merus_r_51.midpoint);
    mesh_leg4_merus_r_51.quaternion.copy(endpoint_leg4_merus_r_51.quaternion);
  }
  mesh_leg4_merus_r_51.castShadow = options.castShadow ?? true;
  mesh_leg4_merus_r_51.receiveShadow = options.receiveShadow ?? true;
  mesh_leg4_merus_r_51.userData.sculptComponent = {"id": "leg4-merus-r", "name": "leg 4 merus (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.55, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A broad rounded plate fanning off the shell's lateral-ventral margin. The four plates per side OVERLAP like tiles, each behind and below the one in front - that overlap is what the crease scan measured (3-5 boundaries per side per row) and it is why a leg fan reads as a count rather than a skirt.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "carapace", "attachment": {"parentId": "carapace", "parentSocket": "leg4-merus-socket-r", "localStart": [-0.25, 0.272, -0.16], "localEnd": [-0.2715, 0.158, -0.184], "contactType": "socket", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1185. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.092, "height": 0.1645, "depth": 0.092, "units": "world (1 unit = 1 maze tile)", "confidence": 0.55}, "transform": {"position": [-0.2607, 0.215, -0.172], "rotation": [0.0, 0.0, 0.0], "scale": [0.092, 0.1645, 0.092]}, "actionProfile": {"animationRole": "primary", "pivot": {"mode": "socket", "localPosition": [0.0107, 0.057, 0.012], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Pivot 'leg4R' - alternating scuttle gait."}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-plate-fan"], "fidelityTier": "blockout", "builtAs": "leg4-merus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(253, 127, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Limb cuticle.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_merus_r_51.add(mesh_leg4_merus_r_51);
  meshes["leg4-merus-r"] = mesh_leg4_merus_r_51;
  colliders["leg4-merus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg4_propodus_r_52 = {"parentId": "leg4-merus-r", "parentSocket": "leg4-propodus-socket-r", "localStart": [-0.2715, 0.158, -0.184], "localEnd": [-0.3038, 0.058, -0.2], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1063. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg4_propodus_r_52 = makeAttachmentEndpoint(attachment_leg4_propodus_r_52);
  const node_leg4_propodus_r_52 = new THREE.Group();
  node_leg4_propodus_r_52.name = "leg 4 propodus (r)__pivot";
  node_leg4_propodus_r_52.scale.set(1, 1, 1);
  if (endpoint_leg4_propodus_r_52) {
    node_leg4_propodus_r_52.position.copy(endpoint_leg4_propodus_r_52.start);
    node_leg4_propodus_r_52.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg4_propodus_r_52.position.set(-0.2876, 0.108, -0.192);
    node_leg4_propodus_r_52.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg4_propodus_r_52.userData.sculptComponent = {"id": "leg4-propodus-r", "name": "leg 4 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-merus-r", "attachment": {"parentId": "leg4-merus-r", "parentSocket": "leg4-propodus-socket-r", "localStart": [-0.2715, 0.158, -0.184], "localEnd": [-0.3038, 0.058, -0.2], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1063. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1423, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.2876, 0.108, -0.192], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1423, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0161, 0.05, 0.008], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg4-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_propodus_r_52.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0161, 0.05, 0.008], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg4-merus-r"] ?? root).add(node_leg4_propodus_r_52);
  nodes["leg4-propodus-r"] = node_leg4_propodus_r_52;
  const mesh_leg4_propodus_r_52Geometry = endpoint_leg4_propodus_r_52
    ? new THREE.CylinderGeometry(endpoint_leg4_propodus_r_52.endRadius, endpoint_leg4_propodus_r_52.baseRadius, endpoint_leg4_propodus_r_52.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg4_propodus_r_52) {
    mesh_leg4_propodus_r_52Geometry.scale(0.072, 0.1423, 0.072);
  }
  const mesh_leg4_propodus_r_52 = new THREE.Mesh(
    mesh_leg4_propodus_r_52Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg4_propodus_r_52.name = "leg 4 propodus (r)";
  if (endpoint_leg4_propodus_r_52) {
    mesh_leg4_propodus_r_52.position.copy(endpoint_leg4_propodus_r_52.midpoint);
    mesh_leg4_propodus_r_52.quaternion.copy(endpoint_leg4_propodus_r_52.quaternion);
  }
  mesh_leg4_propodus_r_52.castShadow = options.castShadow ?? true;
  mesh_leg4_propodus_r_52.receiveShadow = options.receiveShadow ?? true;
  mesh_leg4_propodus_r_52.userData.sculptComponent = {"id": "leg4-propodus-r", "name": "leg 4 propodus (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "The tapering mid segment. OCCLUDED where it meets the body in the reference, so its angle is a neutral rest angle per the character contract, not an invented one.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-merus-r", "attachment": {"parentId": "leg4-merus-r", "parentSocket": "leg4-propodus-socket-r", "localStart": [-0.2715, 0.158, -0.184], "localEnd": [-0.3038, 0.058, -0.2], "contactType": "socket", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.1063. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.072, "height": 0.1423, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.2876, 0.108, -0.192], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.1423, 0.072]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0161, 0.05, 0.008], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["limb-crease-line"], "fidelityTier": "blockout", "builtAs": "leg4-propodus-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_propodus_r_52.add(mesh_leg4_propodus_r_52);
  meshes["leg4-propodus-r"] = mesh_leg4_propodus_r_52;
  colliders["leg4-propodus-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_leg4_dactyl_r_53 = {"parentId": "leg4-propodus-r", "parentSocket": "leg4-dactyl-socket-r", "localStart": [-0.3038, 0.058, -0.2], "localEnd": [-0.309, 0.01, -0.2112], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0496. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."};
  const endpoint_leg4_dactyl_r_53 = makeAttachmentEndpoint(attachment_leg4_dactyl_r_53);
  const node_leg4_dactyl_r_53 = new THREE.Group();
  node_leg4_dactyl_r_53.name = "leg 4 dactyl (r)__pivot";
  node_leg4_dactyl_r_53.scale.set(1, 1, 1);
  if (endpoint_leg4_dactyl_r_53) {
    node_leg4_dactyl_r_53.position.copy(endpoint_leg4_dactyl_r_53.start);
    node_leg4_dactyl_r_53.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg4_dactyl_r_53.position.set(-0.3064, 0.034, -0.2056);
    node_leg4_dactyl_r_53.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg4_dactyl_r_53.userData.sculptComponent = {"id": "leg4-dactyl-r", "name": "leg 4 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-propodus-r", "attachment": {"parentId": "leg4-propodus-r", "parentSocket": "leg4-dactyl-socket-r", "localStart": [-0.3038, 0.058, -0.2], "localEnd": [-0.309, 0.01, -0.2112], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0496. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0736, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3064, 0.034, -0.2056], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0736, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0026, 0.024, 0.0056], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg4-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_dactyl_r_53.userData.actionProfile = {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0026, 0.024, 0.0056], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["leg4-propodus-r"] ?? root).add(node_leg4_dactyl_r_53);
  nodes["leg4-dactyl-r"] = node_leg4_dactyl_r_53;
  const mesh_leg4_dactyl_r_53Geometry = endpoint_leg4_dactyl_r_53
    ? new THREE.CylinderGeometry(endpoint_leg4_dactyl_r_53.endRadius, endpoint_leg4_dactyl_r_53.baseRadius, endpoint_leg4_dactyl_r_53.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_leg4_dactyl_r_53) {
    mesh_leg4_dactyl_r_53Geometry.scale(0.048, 0.0736, 0.048);
  }
  const mesh_leg4_dactyl_r_53 = new THREE.Mesh(
    mesh_leg4_dactyl_r_53Geometry,
    materialMap["cuticleLimb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg4_dactyl_r_53.name = "leg 4 dactyl (r)";
  if (endpoint_leg4_dactyl_r_53) {
    mesh_leg4_dactyl_r_53.position.copy(endpoint_leg4_dactyl_r_53.midpoint);
    mesh_leg4_dactyl_r_53.quaternion.copy(endpoint_leg4_dactyl_r_53.quaternion);
  }
  mesh_leg4_dactyl_r_53.castShadow = options.castShadow ?? true;
  mesh_leg4_dactyl_r_53.receiveShadow = options.receiveShadow ?? true;
  mesh_leg4_dactyl_r_53.userData.sculptComponent = {"id": "leg4-dactyl-r", "name": "leg 4 dactyl (r)", "level": "micro", "role": "body", "importance": 0.55, "confidence": 0.35, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A pointed, slightly hooked terminal tip curving down and inward. Deliberately POINTED, in contrast to the blunt rounded pincer fingers - the contrast is part of reading the claw as a claw.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg4-propodus-r", "attachment": {"parentId": "leg4-propodus-r", "parentSocket": "leg4-dactyl-socket-r", "localStart": [-0.3038, 0.058, -0.2], "localEnd": [-0.309, 0.01, -0.2112], "contactType": "socket", "embedDepth": 0.003, "gapTolerance": 0.002, "confidence": 0.5, "notes": "Span 0.0496. The capsule cylinder is sized from this span with half a radius of overlap; a knuckle ball sits at the joint."}, "dimensions": {"width": 0.048, "height": 0.0736, "depth": 0.048, "units": "world (1 unit = 1 maze tile)", "confidence": 0.35}, "transform": {"position": [-0.3064, 0.034, -0.2056], "rotation": [0.0, 0.0, 0.0], "scale": [0.048, 0.0736, 0.048]}, "actionProfile": {"animationRole": "secondary", "pivot": {"mode": "socket", "localPosition": [0.0026, 0.024, 0.0056], "axis": [0.0, 0.0, 1.0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleLimb", "materialLayers": ["cuticleLimb"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "details": ["leg-dactyl-point"], "fidelityTier": "blockout", "builtAs": "leg4-dactyl-r", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 73, 46, 1.0)", "secondaryAlbedo": "rgba(255, 143, 92, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c0", "zone-r2c2"], "notes": "Vivid limb red, more saturated than the shell face.", "samplingNote": "Authored from the hue/value/saturation read in evidence/image-analysis.md Layer 6. NOT sampled from pixels: crab.png carries a stock watermark over the subject."}};
  node_leg4_dactyl_r_53.add(mesh_leg4_dactyl_r_53);
  meshes["leg4-dactyl-r"] = mesh_leg4_dactyl_r_53;
  colliders["leg4-dactyl-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "silhouette-and-region-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": false, "normalOrBumpRequired": false, "localOverridesRequired": true, "minimumTextureResolution": 0, "preferredTextureResolution": 0, "independentMapChannels": [], "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "documentedLimitation": "NOT RUN - the documented-limitation branch the anti-shallow rule allows, not a silent skip. Three independent reasons: (1) MeshToonMaterial has no roughness, metalness, normal or AO channel, so there is nowhere for an extracted map to go; (2) this stack ships no character textures at all; (3) the reference is a watermarked stock image, so every crop over the subject can contain watermark pixels. See evidence/projection-route.md."}, "rationale": "Rewritten from the photographic default. Every material declares textureless WITH evidence, so map-channel targets would describe nothing. What replaces them: a flat palette whose region BOUNDARIES are geometry (the pincer gap, the mouth groove, the brow lozenges, the plate creases), plus the team-colour contract."}, "lightingPass": {"matchReferenceKeyDirection": false, "rationale": "The consumer owns its own lighting rig (src/render/scene.ts) and every enemy skin shares it. This model must read under THAT rig, not under the reference drawing's convention - it is a shop skin dropped into a running game, not a hero render."}, "rendererContract": {"renderer": "THREE.WebGLRenderer, three r169", "toneMapping": "NoToneMapping - a filmic curve re-compresses the toon ramp's bands and undoes the point of cel shading", "material": "MeshToonMaterial built through toon(), on one shared 3-step gradient ramp", "exception": "The eye catchlight is MeshBasicMaterial (unlit). It is the project's one documented exception and it is deliberate.", "forbidden": ["three/webgpu", "three/tsl", "MeshStandardMaterial", "post-processing", "glTF assets", "any physics engine"]}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createCartoonCrabLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Cartoon Crab look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": [-0.4, 1.0, 0.6], "intensity": 1.0, "color": "#FFF6E6", "notes": "The consumer's existing scene key (src/render/scene.ts). NOT solved from the reference: the reference's lighting is a drawing convention, and this model has to sit in the same rig as the other five enemy skins."}, {"id": "fill", "type": "hemisphere", "direction": [0.0, 1.0, 0.0], "intensity": 0.45, "color": "#BFD8FF", "notes": "Sky/ground hemisphere fill. It is what keeps the dark brow lozenges and the crease ink from crushing to black in shadow, where they would stop reading as separate shapes."}, {"id": "rim", "type": "directional", "direction": [0.5, 0.4, -0.9], "intensity": 0.35, "color": "#FFFFFF", "notes": "Back rim separating the enemy from the maze floor. With a toon ramp this is what carries the read of the carapace's transverse arc, since there is no specular falloff to do it."}, {"id": "exposure-and-tone", "type": "policy", "notes": "Tone mapping is NoToneMapping and exposure is left at 1.0. This is not a default - a filmic or ACES curve re-compresses the toon ramp's three bands into each other and undoes cel shading outright. Any exposure change would have the same effect."}, {"id": "contact-shadow", "type": "policy", "notes": "Ground shadow comes from the renderer's shadow map with castShadow on every body mesh; the eaten state stashes and restores that flag per mesh (shadowBase). There is NO ambient occlusion pass and no AO map - a toon ramp quantises AO into the same bands as everything else, so the contact read is carried by the ground shadow and by the geometry of the crevices themselves."}, {"id": "reference-lighting-observed", "type": "observation", "notes": "Observed in the reference for the record: soft key from upper-front-left, strong ambient fill, soft contact occlusion in every crevice, not one sharp shadow edge. Recorded as evidence; deliberately NOT transferred."}];
  lights.userData.lookDevTargets = {"qualityPriority": "silhouette-and-region-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": false, "normalOrBumpRequired": false, "localOverridesRequired": true, "minimumTextureResolution": 0, "preferredTextureResolution": 0, "independentMapChannels": [], "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "documentedLimitation": "NOT RUN - the documented-limitation branch the anti-shallow rule allows, not a silent skip. Three independent reasons: (1) MeshToonMaterial has no roughness, metalness, normal or AO channel, so there is nowhere for an extracted map to go; (2) this stack ships no character textures at all; (3) the reference is a watermarked stock image, so every crop over the subject can contain watermark pixels. See evidence/projection-route.md."}, "rationale": "Rewritten from the photographic default. Every material declares textureless WITH evidence, so map-channel targets would describe nothing. What replaces them: a flat palette whose region BOUNDARIES are geometry (the pincer gap, the mouth groove, the brow lozenges, the plate creases), plus the team-colour contract."}, "lightingPass": {"matchReferenceKeyDirection": false, "rationale": "The consumer owns its own lighting rig (src/render/scene.ts) and every enemy skin shares it. This model must read under THAT rig, not under the reference drawing's convention - it is a shop skin dropped into a running game, not a hero render."}, "rendererContract": {"renderer": "THREE.WebGLRenderer, three r169", "toneMapping": "NoToneMapping - a filmic curve re-compresses the toon ramp's bands and undoes the point of cel shading", "material": "MeshToonMaterial built through toon(), on one shared 3-step gradient ramp", "exception": "The eye catchlight is MeshBasicMaterial (unlit). It is the project's one documented exception and it is deliberate.", "forbidden": ["three/webgpu", "three/tsl", "MeshStandardMaterial", "post-processing", "glTF assets", "any physics engine"]}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCartoonCrabEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameCartoonCrabCamera(
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
export function createCartoonCrabPresentationComposer(
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

export function configureCartoonCrabRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createCartoonCrabInspectControls(
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
