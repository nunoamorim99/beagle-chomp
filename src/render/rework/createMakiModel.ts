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

// Generated from ObjectSculptSpec target: Maki Roll Mascot
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMakiRollMascotModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Maki Roll Mascot";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["nori"] = createSculptMaterial(
    "nori",
    {"id": "nori", "name": "Nori sleeve", "family": "satin-dielectric-sheet", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#1c2019", "color": "#1c2019", "albedo": {"dominant": "#1c2019", "secondary": ["#0d100c", "#39402f"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#1c2019", "#0d100c", "#39402f"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#1c2019", "emissiveStrength": 0.15, "opacity": 1.0, "description": "The seaweed wrapper: the barrel and both end rims. THIS IS bodyMat - it takes the team colour and the frightened blue. The species survives the repaint because the drum SHAPE and the three-zone face carry it, exactly as the beetle and ladybug survive theirs.", "localOverrides": [{"id": "nori-seam-hairlines", "kind": "linework", "description": "Four circumferential hairlines around the barrel where the sheet laps. Their own material, kept OUT of accentMats: hairlines are not a large accent, and if they followed the frightened recolour the nori read would vanish exactly while the player is chasing it (IDEA-053 rule 2).", "channel": "baseColor", "region": "barrel circumference", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The seaweed wrapper: the barrel and both end rims. THIS IS bodyMat - it takes the team colour and the frightened blue. The species survives the repaint because the drum SHAPE and the three-zone face carry it, exactly as the beetle and ladybug survive theirs.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["noriSeam"] = createSculptMaterial(
    "noriSeam",
    {"id": "noriSeam", "name": "Nori lap hairline", "family": "matte-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#0d100c", "color": "#0d100c", "albedo": {"dominant": "#0d100c", "secondary": ["#1c2019"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#0d100c", "#1c2019"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Fixed near-black. Never team-coloured, never in accentMats.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Fixed near-black. Never team-coloured, never in accentMats.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["rice"] = createSculptMaterial(
    "rice",
    {"id": "rice", "name": "Rice grain / bed", "family": "satin-starch", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f6f1e4", "color": "#f6f1e4", "albedo": {"dominant": "#f6f1e4", "secondary": ["#e2dbca", "#fffdf6"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f6f1e4", "#e2dbca", "#fffdf6"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.38, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Off-white cooked rice. NEVER team-coloured, on either sushi. Rice is the one constant that says 'sushi' at every hue - the maki repaints its WRAPPER, the nigiri repaints its TOPPING, and the rice is what they share.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Off-white cooked rice. NEVER team-coloured, on either sushi. Rice is the one constant that says 'sushi' at every hue - the maki repaints its WRAPPER, the nigiri repaints its TOPPING, and the rice is what they share.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["salmon"] = createSculptMaterial(
    "salmon",
    {"id": "salmon", "name": "Salmon core", "family": "satin-fish-flesh", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f26a26", "color": "#f26a26", "albedo": {"dominant": "#f26a26", "secondary": ["#ffd9bd", "#c9481a"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f26a26", "#ffd9bd", "#c9481a"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The face plate. Fixed orange at every team colour: it is the ground the eyes and mouth are read against, and a plate that changed hue would change the face's contrast four ways.", "localOverrides": [{"id": "salmon-fat-striations", "kind": "surface-marking", "description": "Five pale bands running diagonally across the plate, reaching its boundary on both sides.", "channel": "baseColor", "region": "plate face", "confidence": 0.8, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The face plate. Fixed orange at every team colour: it is the ground the eyes and mouth are read against, and a plate that changed hue would change the face's contrast four ways.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["fat"] = createSculptMaterial(
    "fat",
    {"id": "fat", "name": "Fat striation", "family": "satin-fish-fat", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ffd9bd", "color": "#ffd9bd", "albedo": {"dominant": "#ffd9bd", "secondary": ["#f7c6a4"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ffd9bd", "#f7c6a4"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.42, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The pale marbling in the salmon. Same hue, high value, low saturation.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The pale marbling in the salmon. Same hue, high value, low saturation.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["glove"] = createSculptMaterial(
    "glove",
    {"id": "glove", "name": "Mitten / boot", "family": "matte-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#f4f4f2", "color": "#f4f4f2", "albedo": {"dominant": "#f4f4f2", "secondary": ["#dcdcd8"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#f4f4f2", "#dcdcd8"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Cartoon glove and boot. Near-white, fixed - with the rice it is what keeps the frightened silhouette from collapsing into one blue mass.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Cartoon glove and boot. Near-white, fixed - with the rice it is what keeps the frightened silhouette from collapsing into one blue mass.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["limb"] = createSculptMaterial(
    "limb",
    {"id": "limb", "name": "Limb tube", "family": "matte-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#211d1a", "color": "#211d1a", "albedo": {"dominant": "#211d1a", "secondary": ["#3a3330"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#211d1a", "#3a3330"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.5, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The four thin tubes. IN accentMats: four limbs are a real share of the silhouette, so they follow the frightened recolour (the beetle's rule).", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The four thin tubes. IN accentMats: four limbs are a real share of the silhouette, so they follow the frightened recolour (the beetle's rule).", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["eyeWhite"] = createSculptMaterial(
    "eyeWhite",
    {"id": "eyeWhite", "name": "Eye white", "family": "gloss-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#ffffff", "secondary": ["#e6ecf2"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ffffff", "#e6ecf2"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.2, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The sclera dome. Left solid while eaten, with the pupil, so an eaten enemy is still trackable across the maze.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The sclera dome. Left solid while eaten, with the pupil, so an eaten enemy is still trackable across the maze.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["pupil"] = createSculptMaterial(
    "pupil",
    {"id": "pupil", "name": "Pupil mass", "family": "gloss-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#12161c", "color": "#12161c", "albedo": {"dominant": "#12161c", "secondary": ["#000000"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#12161c", "#000000"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.2, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Near-black. This is pupM: applyGhostState paints it white while frightened and restores pupBaseColor otherwise.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Near-black. This is pupM: applyGhostState paints it white while frightened and restores pupBaseColor otherwise.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["iris"] = createSculptMaterial(
    "iris",
    {"id": "iris", "name": "Iris annulus", "family": "gloss-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#3fc4de", "color": "#3fc4de", "albedo": {"dominant": "#3fc4de", "secondary": ["#7fe0f2"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#3fc4de", "#7fe0f2"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "A thin cyan ring inside the LOWER half of the pupil mass - an annulus, not a disc behind a pupil. At 0.0124 world units it is a shape claim, below the size any colour gate can read.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "A thin cyan ring inside the LOWER half of the pupil mass - an annulus, not a disc behind a pupil. At 0.0124 world units it is a shape claim, below the size any colour gate can read.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["glint"] = createSculptMaterial(
    "glint",
    {"id": "glint", "name": "Specular catchlight", "family": "unlit", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#ffffff", "secondary": ["#ffffff"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ffffff", "#ffffff"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.0, "variation": 0.1, "map": null, "note": "Unlit MeshBasicMaterial: it has no roughness channel and no lighting response at all. That is the point of it."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "MeshBasicMaterial, deliberately UNLIT - the project's one documented exception to the toon ramp. A toon ramp quantises a highlight into the same band as everything else facing the light and it stops reading as a catchlight.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "MeshBasicMaterial, deliberately UNLIT - the project's one documented exception to the toon ramp. A toon ramp quantises a highlight into the same band as everything else facing the light and it stops reading as a catchlight.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["mouth"] = createSculptMaterial(
    "mouth",
    {"id": "mouth", "name": "Mouth cavity", "family": "matte-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#2b0f12", "color": "#2b0f12", "albedo": {"dominant": "#2b0f12", "secondary": ["#4a1c20"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#2b0f12", "#4a1c20"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.7, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "The open mouth's interior. A CAVITY: the surface is inset behind the plate, never a dark patch painted on it.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The open mouth's interior. A CAVITY: the surface is inset behind the plate, never a dark patch painted on it.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );
  materialMap["tongue"] = createSculptMaterial(
    "tongue",
    {"id": "tongue", "name": "Tongue", "family": "satin-dielectric", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#ef7d86", "color": "#ef7d86", "albedo": {"dominant": "#ef7d86", "secondary": ["#f9a2a8"], "samplingNotes": "Hand-authored NAMED tone. The reference is a watermarked stock image, so it is read to NAME the tone and never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#ef7d86", "#f9a2a8"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "transmission": 0.0, "ior": 1.45, "clearcoat": 0.0, "sheen": 0.0, "emissive": "#000000", "emissiveStrength": 0.0, "opacity": 1.0, "description": "Small rounded pink mass on the mouth's lower lip.", "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Small rounded pink mass on the mouth's lower lip.", "evidenceRefs": ["full-object"], "confidence": 0.8},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Maki roll mascot (root)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Maki roll mascot (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The assembly root. Carries nothing itself; syncToEntity owns its rotation.y/z and position, and applyGhostState owns its rotation.x - which is why nothing may author rotation.x here.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(28, 32, 25, 1.0)", "secondaryAlbedo": "rgba(13, 16, 12, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": null, "attachment": null, "dimensions": {"width": 0.78, "height": 0.84, "depth": 0.66, "units": "world", "confidence": 0.95}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upright-stance", "description": "Two thin tubular legs carrying a drum. No other enemy in the shipped cast stands upright; every one of the other seven is a squat ground volume with a crown between 0.600 and 0.780.", "identityRank": 3, "confidence": 0.95, "evidenceRefs": ["full-object"]}]};
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
    materialMap["nori"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Maki roll mascot (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Maki roll mascot (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The assembly root. Carries nothing itself; syncToEntity owns its rotation.y/z and position, and applyGhostState owns its rotation.x - which is why nothing may author rotation.x here.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(28, 32, 25, 1.0)", "secondaryAlbedo": "rgba(13, 16, 12, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": null, "attachment": null, "dimensions": {"width": 0.78, "height": 0.84, "depth": 0.66, "units": "world", "confidence": 0.95}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upright-stance", "description": "Two thin tubular legs carrying a drum. No other enemy in the shipped cast stands upright; every one of the other seven is a squat ground volume with a crown between 0.600 and 0.780.", "identityRank": 3, "confidence": 0.95, "evidenceRefs": ["full-object"]}]};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_body_1 = makeAttachmentEndpoint(null);
  const node_body_1 = new THREE.Group();
  node_body_1.name = "Pitched body group__pivot";
  node_body_1.scale.set(1, 1, 1);
  if (endpoint_body_1) {
    node_body_1.position.copy(endpoint_body_1.start);
    node_body_1.rotation.set(-18.0, 0.0, 0.0);
  } else {
    node_body_1.position.set(0.0, 0.4658, 0.0);
    node_body_1.rotation.set(-18.0, 0.0, 0.0);
  }
  node_body_1.userData.sculptComponent = {"id": "body", "name": "Pitched body group", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A pure transform node holding the whole roll at its play-camera pitch. It exists because the pitch cannot live on the root.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(28, 32, 25, 1.0)", "secondaryAlbedo": "rgba(13, 16, 12, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "rigid-parent", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Fixed -18 deg pitch about X. See assumptions: a play-camera decision, and it must not be on the root."}, "dimensions": {"width": 0.62, "height": 0.62, "depth": 0.5, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, 0.4658, 0.0], "rotation": [-18.0, 0.0, 0.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "back-lean", "description": "The drum leans back 18 deg so the cut face aims up-and-forward toward a camera at 59 deg elevation. Without it the bullseye projects at half area at the only framing that matters.", "identityRank": 2, "confidence": 0.9, "evidenceRefs": ["full-object"]}]};
  node_body_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_body_1);
  nodes["body"] = node_body_1;
  const mesh_body_1Geometry = endpoint_body_1
    ? new THREE.CylinderGeometry(endpoint_body_1.endRadius, endpoint_body_1.baseRadius, endpoint_body_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_body_1) {
    mesh_body_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_body_1 = new THREE.Mesh(
    mesh_body_1Geometry,
    materialMap["nori"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_1.name = "Pitched body group";
  if (endpoint_body_1) {
    mesh_body_1.position.copy(endpoint_body_1.midpoint);
    mesh_body_1.quaternion.copy(endpoint_body_1.quaternion);
  }
  mesh_body_1.castShadow = options.castShadow ?? true;
  mesh_body_1.receiveShadow = options.receiveShadow ?? true;
  mesh_body_1.userData.sculptComponent = {"id": "body", "name": "Pitched body group", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A pure transform node holding the whole roll at its play-camera pitch. It exists because the pitch cannot live on the root.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(28, 32, 25, 1.0)", "secondaryAlbedo": "rgba(13, 16, 12, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "rigid-parent", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Fixed -18 deg pitch about X. See assumptions: a play-camera decision, and it must not be on the root."}, "dimensions": {"width": 0.62, "height": 0.62, "depth": 0.5, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, 0.4658, 0.0], "rotation": [-18.0, 0.0, 0.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "back-lean", "description": "The drum leans back 18 deg so the cut face aims up-and-forward toward a camera at 59 deg elevation. Without it the bullseye projects at half area at the only framing that matters.", "identityRank": 2, "confidence": 0.9, "evidenceRefs": ["full-object"]}]};
  node_body_1.add(mesh_body_1);
  meshes["body"] = mesh_body_1;
  colliders["body"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_noriSleeve_2 = makeAttachmentEndpoint(null);
  const node_noriSleeve_2 = new THREE.Group();
  node_noriSleeve_2.name = "Nori sleeve__pivot";
  node_noriSleeve_2.scale.set(1, 1, 1);
  if (endpoint_noriSleeve_2) {
    node_noriSleeve_2.position.copy(endpoint_noriSleeve_2.start);
    node_noriSleeve_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_noriSleeve_2.position.set(0.0, 0.0, 0.0);
    node_noriSleeve_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_noriSleeve_2.userData.sculptComponent = {"id": "noriSleeve", "name": "Nori sleeve", "level": "meso", "role": "shell", "importance": 0.95, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved profile, not a box: an open tube of radius R whose profile turns inward at each end to RR, so the two flat annular RIMS are part of the same surface as the barrel. Building rim and barrel as separate primitives would put a shading seam exactly on the silhouette that identifies the subject.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(28, 32, 25, 1.0)", "secondaryAlbedo": "rgba(13, 16, 12, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "body", "attachment": {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "The sleeve IS the body volume; it sits at the pitched group's origin with no offset."}, "dimensions": {"width": 0.62, "height": 0.62, "depth": 0.496, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori", "noriSeam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "three-zone-bullseye-rim", "description": "The outermost of the cut face's three concentric zones: a dark annulus 0.0465 wide on the radius, standing proud of the rice bed by half a grain diameter.", "identityRank": 1, "confidence": 0.95, "evidenceRefs": ["full-object"]}, {"id": "hard-cylinder", "description": "Flat circular ends and a straight barrel. Every other enemy in the cast is a soft bug volume; a maki that loses its flat cut faces joins them.", "identityRank": 2, "confidence": 0.95, "evidenceRefs": ["full-object"]}, {"id": "nori-lap-hairlines", "description": "Four circumferential hairlines around the barrel, in their own fixed near-black, out of accentMats.", "identityRank": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}]};
  node_noriSleeve_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["body"] ?? root).add(node_noriSleeve_2);
  nodes["noriSleeve"] = node_noriSleeve_2;
  const mesh_noriSleeve_2Geometry = endpoint_noriSleeve_2
    ? new THREE.CylinderGeometry(endpoint_noriSleeve_2.endRadius, endpoint_noriSleeve_2.baseRadius, endpoint_noriSleeve_2.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_noriSleeve_2) {
    mesh_noriSleeve_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_noriSleeve_2 = new THREE.Mesh(
    mesh_noriSleeve_2Geometry,
    materialMap["nori"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_noriSleeve_2.name = "Nori sleeve";
  if (endpoint_noriSleeve_2) {
    mesh_noriSleeve_2.position.copy(endpoint_noriSleeve_2.midpoint);
    mesh_noriSleeve_2.quaternion.copy(endpoint_noriSleeve_2.quaternion);
  }
  mesh_noriSleeve_2.castShadow = options.castShadow ?? true;
  mesh_noriSleeve_2.receiveShadow = options.receiveShadow ?? true;
  mesh_noriSleeve_2.userData.sculptComponent = {"id": "noriSleeve", "name": "Nori sleeve", "level": "meso", "role": "shell", "importance": 0.95, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved profile, not a box: an open tube of radius R whose profile turns inward at each end to RR, so the two flat annular RIMS are part of the same surface as the barrel. Building rim and barrel as separate primitives would put a shading seam exactly on the silhouette that identifies the subject.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(28, 32, 25, 1.0)", "secondaryAlbedo": "rgba(13, 16, 12, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "finish": "satin toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "body", "attachment": {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.0, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "The sleeve IS the body volume; it sits at the pitched group's origin with no offset."}, "dimensions": {"width": 0.62, "height": 0.62, "depth": 0.496, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "nori", "materialLayers": ["nori", "noriSeam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "three-zone-bullseye-rim", "description": "The outermost of the cut face's three concentric zones: a dark annulus 0.0465 wide on the radius, standing proud of the rice bed by half a grain diameter.", "identityRank": 1, "confidence": 0.95, "evidenceRefs": ["full-object"]}, {"id": "hard-cylinder", "description": "Flat circular ends and a straight barrel. Every other enemy in the cast is a soft bug volume; a maki that loses its flat cut faces joins them.", "identityRank": 2, "confidence": 0.95, "evidenceRefs": ["full-object"]}, {"id": "nori-lap-hairlines", "description": "Four circumferential hairlines around the barrel, in their own fixed near-black, out of accentMats.", "identityRank": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}]};
  node_noriSleeve_2.add(mesh_noriSleeve_2);
  meshes["noriSleeve"] = mesh_noriSleeve_2;
  colliders["noriSleeve"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_armL_3 = {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""};
  const endpoint_armL_3 = makeAttachmentEndpoint(attachment_armL_3);
  const node_armL_3 = new THREE.Group();
  node_armL_3.name = "Arm, left__pivot";
  node_armL_3.scale.set(1, 1, 1);
  if (endpoint_armL_3) {
    node_armL_3.position.copy(endpoint_armL_3.start);
    node_armL_3.rotation.set(0.0, 0.0, 12.0);
  } else {
    node_armL_3.position.set(0.29, -0.02, 0.02);
    node_armL_3.rotation.set(0.0, 0.0, 12.0);
  }
  node_armL_3.userData.sculptComponent = {"id": "armL", "name": "Arm, left", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swung from a shoulder pivot on the barrel's flank. L1: it bends along its length.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "body", "attachment": {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.052, "height": 0.13, "depth": 0.052, "units": "world", "confidence": 0.8}, "transform": {"position": [0.29, -0.02, 0.02], "rotation": [0.0, 0.0, 12.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armL_3.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["body"] ?? root).add(node_armL_3);
  nodes["armL"] = node_armL_3;
  const mesh_armL_3Geometry = endpoint_armL_3
    ? new THREE.CylinderGeometry(endpoint_armL_3.endRadius, endpoint_armL_3.baseRadius, endpoint_armL_3.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_armL_3) {
    mesh_armL_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armL_3 = new THREE.Mesh(
    mesh_armL_3Geometry,
    materialMap["limb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armL_3.name = "Arm, left";
  if (endpoint_armL_3) {
    mesh_armL_3.position.copy(endpoint_armL_3.midpoint);
    mesh_armL_3.quaternion.copy(endpoint_armL_3.quaternion);
  }
  mesh_armL_3.castShadow = options.castShadow ?? true;
  mesh_armL_3.receiveShadow = options.receiveShadow ?? true;
  mesh_armL_3.userData.sculptComponent = {"id": "armL", "name": "Arm, left", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swung from a shoulder pivot on the barrel's flank. L1: it bends along its length.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "body", "attachment": {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.052, "height": 0.13, "depth": 0.052, "units": "world", "confidence": 0.8}, "transform": {"position": [0.29, -0.02, 0.02], "rotation": [0.0, 0.0, 12.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armL_3.add(mesh_armL_3);
  meshes["armL"] = mesh_armL_3;
  colliders["armL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_legL_4 = {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.035, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Hip position is the body-local (+/-0.1178, -0.2868, 0) attachment carried through the -18 deg pitch."};
  const endpoint_legL_4 = makeAttachmentEndpoint(attachment_legL_4);
  const node_legL_4 = new THREE.Group();
  node_legL_4.name = "Leg, left__pivot";
  node_legL_4.scale.set(1, 1, 1);
  if (endpoint_legL_4) {
    node_legL_4.position.copy(endpoint_legL_4.start);
    node_legL_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_legL_4.position.set(0.1178, 0.193, 0.0886);
    node_legL_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_legL_4.userData.sculptComponent = {"id": "legL", "name": "Leg, left", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A vertical tube from a hip pivot on the barrel's underside. The hip is placed at the PITCHED underside position and the leg hangs vertically, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.035, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Hip position is the body-local (+/-0.1178, -0.2868, 0) attachment carried through the -18 deg pitch."}, "dimensions": {"width": 0.06, "height": 0.115, "depth": 0.06, "units": "world", "confidence": 0.8}, "transform": {"position": [0.1178, 0.193, 0.0886], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_legL_4.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_legL_4);
  nodes["legL"] = node_legL_4;
  const mesh_legL_4Geometry = endpoint_legL_4
    ? new THREE.CylinderGeometry(endpoint_legL_4.endRadius, endpoint_legL_4.baseRadius, endpoint_legL_4.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_legL_4) {
    mesh_legL_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_legL_4 = new THREE.Mesh(
    mesh_legL_4Geometry,
    materialMap["limb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_legL_4.name = "Leg, left";
  if (endpoint_legL_4) {
    mesh_legL_4.position.copy(endpoint_legL_4.midpoint);
    mesh_legL_4.quaternion.copy(endpoint_legL_4.quaternion);
  }
  mesh_legL_4.castShadow = options.castShadow ?? true;
  mesh_legL_4.receiveShadow = options.receiveShadow ?? true;
  mesh_legL_4.userData.sculptComponent = {"id": "legL", "name": "Leg, left", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A vertical tube from a hip pivot on the barrel's underside. The hip is placed at the PITCHED underside position and the leg hangs vertically, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.035, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Hip position is the body-local (+/-0.1178, -0.2868, 0) attachment carried through the -18 deg pitch."}, "dimensions": {"width": 0.06, "height": 0.115, "depth": 0.06, "units": "world", "confidence": 0.8}, "transform": {"position": [0.1178, 0.193, 0.0886], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_legL_4.add(mesh_legL_4);
  meshes["legL"] = mesh_legL_4;
  colliders["legL"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_armR_5 = {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""};
  const endpoint_armR_5 = makeAttachmentEndpoint(attachment_armR_5);
  const node_armR_5 = new THREE.Group();
  node_armR_5.name = "Arm, right__pivot";
  node_armR_5.scale.set(1, 1, 1);
  if (endpoint_armR_5) {
    node_armR_5.position.copy(endpoint_armR_5.start);
    node_armR_5.rotation.set(0.0, 0.0, -12.0);
  } else {
    node_armR_5.position.set(-0.29, -0.02, 0.02);
    node_armR_5.rotation.set(0.0, 0.0, -12.0);
  }
  node_armR_5.userData.sculptComponent = {"id": "armR", "name": "Arm, right", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swung from a shoulder pivot on the barrel's flank. L1: it bends along its length.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "body", "attachment": {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.052, "height": 0.13, "depth": 0.052, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.29, -0.02, 0.02], "rotation": [0.0, 0.0, -12.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armR_5.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["body"] ?? root).add(node_armR_5);
  nodes["armR"] = node_armR_5;
  const mesh_armR_5Geometry = endpoint_armR_5
    ? new THREE.CylinderGeometry(endpoint_armR_5.endRadius, endpoint_armR_5.baseRadius, endpoint_armR_5.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_armR_5) {
    mesh_armR_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_armR_5 = new THREE.Mesh(
    mesh_armR_5Geometry,
    materialMap["limb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_armR_5.name = "Arm, right";
  if (endpoint_armR_5) {
    mesh_armR_5.position.copy(endpoint_armR_5.midpoint);
    mesh_armR_5.quaternion.copy(endpoint_armR_5.quaternion);
  }
  mesh_armR_5.castShadow = options.castShadow ?? true;
  mesh_armR_5.receiveShadow = options.receiveShadow ?? true;
  mesh_armR_5.userData.sculptComponent = {"id": "armR", "name": "Arm, right", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swung from a shoulder pivot on the barrel's flank. L1: it bends along its length.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "body", "attachment": {"parentSocket": "body-socket", "parentId": "body", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.03, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": ""}, "dimensions": {"width": 0.052, "height": 0.13, "depth": 0.052, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.29, -0.02, 0.02], "rotation": [0.0, 0.0, -12.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_armR_5.add(mesh_armR_5);
  meshes["armR"] = mesh_armR_5;
  colliders["armR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const attachment_legR_6 = {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.035, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Hip position is the body-local (+/-0.1178, -0.2868, 0) attachment carried through the -18 deg pitch."};
  const endpoint_legR_6 = makeAttachmentEndpoint(attachment_legR_6);
  const node_legR_6 = new THREE.Group();
  node_legR_6.name = "Leg, right__pivot";
  node_legR_6.scale.set(1, 1, 1);
  if (endpoint_legR_6) {
    node_legR_6.position.copy(endpoint_legR_6.start);
    node_legR_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_legR_6.position.set(-0.1178, 0.193, 0.0886);
    node_legR_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_legR_6.userData.sculptComponent = {"id": "legR", "name": "Leg, right", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A vertical tube from a hip pivot on the barrel's underside. The hip is placed at the PITCHED underside position and the leg hangs vertically, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.035, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Hip position is the body-local (+/-0.1178, -0.2868, 0) attachment carried through the -18 deg pitch."}, "dimensions": {"width": 0.06, "height": 0.115, "depth": 0.06, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.1178, 0.193, 0.0886], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_legR_6.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_legR_6);
  nodes["legR"] = node_legR_6;
  const mesh_legR_6Geometry = endpoint_legR_6
    ? new THREE.CylinderGeometry(endpoint_legR_6.endRadius, endpoint_legR_6.baseRadius, endpoint_legR_6.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_legR_6) {
    mesh_legR_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_legR_6 = new THREE.Mesh(
    mesh_legR_6Geometry,
    materialMap["limb"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_legR_6.name = "Leg, right";
  if (endpoint_legR_6) {
    mesh_legR_6.position.copy(endpoint_legR_6.midpoint);
    mesh_legR_6.quaternion.copy(endpoint_legR_6.quaternion);
  }
  mesh_legR_6.castShadow = options.castShadow ?? true;
  mesh_legR_6.receiveShadow = options.receiveShadow ?? true;
  mesh_legR_6.userData.sculptComponent = {"id": "legR", "name": "Leg, right", "level": "macro", "role": "limb", "importance": 0.6, "confidence": 0.8, "primitive": "capsule", "topologyClass": "continuous-sculpt", "topologyRationale": "A vertical tube from a hip pivot on the barrel's underside. The hip is placed at the PITCHED underside position and the leg hangs vertically, so the lean never tips the stance.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded game character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(33, 29, 26, 1.0)", "secondaryAlbedo": "rgba(33, 29, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "finish": "matte toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored to the project's toon ramp. The reference is a watermarked stock image and no pixel of it is used as colour evidence."}, "parent": "root", "attachment": {"parentSocket": "root-socket", "parentId": "root", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "socket", "baseRadius": 0.0, "endRadius": 0.0, "embedDepth": 0.035, "overlap": 0.0, "gapTolerance": 0.002, "evidenceRefs": ["full-object"], "note": "Hip position is the body-local (+/-0.1178, -0.2868, 0) attachment carried through the -18 deg pitch."}, "dimensions": {"width": 0.06, "height": 0.115, "depth": 0.06, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.1178, 0.193, 0.0886], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "limb", "materialLayers": ["limb"], "deformations": [], "joints": [], "seams": [], "localFeatures": []};
  node_legR_6.add(mesh_legR_6);
  meshes["legR"] = mesh_legR_6;
  colliders["legR"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  // PLAN_1.5 WS-C slice 1: bone hierarchy from spec.rig. Model-space joints are
  // converted to parent-local offsets here. Nothing is bound yet (rig.bound === false).
  const bones: Record<string, THREE.Bone> = {};
  const boneOrder: string[] = [];
  const bone_pelvis = new THREE.Bone();
  bone_pelvis.name = "pelvis";
  bone_pelvis.position.set(0.0, -0.014, 0.0);
  root.add(bone_pelvis);
  bones["pelvis"] = bone_pelvis;
  boneOrder.push("pelvis");
  const bone_abdomen = new THREE.Bone();
  bone_abdomen.name = "abdomen";
  bone_abdomen.position.set(0.0, 0.028, 0.0);
  bone_pelvis.add(bone_abdomen);
  bones["abdomen"] = bone_abdomen;
  boneOrder.push("abdomen");
  const bone_chest = new THREE.Bone();
  bone_chest.name = "chest";
  bone_chest.position.set(0.0, 0.1176, 0.0028);
  bone_abdomen.add(bone_chest);
  bones["chest"] = bone_chest;
  boneOrder.push("chest");
  const bone_clavicle_l = new THREE.Bone();
  bone_clavicle_l.name = "clavicle-l";
  bone_clavicle_l.position.set(0.02397, 0.1456, 0.005599999999999999);
  bone_chest.add(bone_clavicle_l);
  bones["clavicle-l"] = bone_clavicle_l;
  boneOrder.push("clavicle-l");
  const bone_clavicle_r = new THREE.Bone();
  bone_clavicle_r.name = "clavicle-r";
  bone_clavicle_r.position.set(-0.02397, 0.1456, 0.005599999999999999);
  bone_chest.add(bone_clavicle_r);
  bones["clavicle-r"] = bone_clavicle_r;
  boneOrder.push("clavicle-r");
  const bone_thigh_l = new THREE.Bone();
  bone_thigh_l.name = "thigh-l";
  bone_thigh_l.position.set(0.03192, -0.0476, 0.0056);
  bone_pelvis.add(bone_thigh_l);
  bones["thigh-l"] = bone_thigh_l;
  boneOrder.push("thigh-l");
  const bone_shin_l = new THREE.Bone();
  bone_shin_l.name = "shin-l";
  bone_shin_l.position.set(0.0, -0.04081, 0.0);
  bone_thigh_l.add(bone_shin_l);
  bones["shin-l"] = bone_shin_l;
  boneOrder.push("shin-l");
  const bone_foot_l = new THREE.Bone();
  bone_foot_l.name = "foot-l";
  bone_foot_l.position.set(0.0, -0.05019000000000001, 0.0392);
  bone_shin_l.add(bone_foot_l);
  bones["foot-l"] = bone_foot_l;
  boneOrder.push("foot-l");
  const bone_thigh_r = new THREE.Bone();
  bone_thigh_r.name = "thigh-r";
  bone_thigh_r.position.set(-0.03192, -0.0476, 0.0056);
  bone_pelvis.add(bone_thigh_r);
  bones["thigh-r"] = bone_thigh_r;
  boneOrder.push("thigh-r");
  const bone_shin_r = new THREE.Bone();
  bone_shin_r.name = "shin-r";
  bone_shin_r.position.set(0.0, -0.04081, 0.0);
  bone_thigh_r.add(bone_shin_r);
  bones["shin-r"] = bone_shin_r;
  boneOrder.push("shin-r");
  const bone_foot_r = new THREE.Bone();
  bone_foot_r.name = "foot-r";
  bone_foot_r.position.set(0.0, -0.05019000000000001, 0.0392);
  bone_shin_r.add(bone_foot_r);
  bones["foot-r"] = bone_foot_r;
  boneOrder.push("foot-r");
  const bone_upper_arm_l = new THREE.Bone();
  bone_upper_arm_l.name = "upper-arm-l";
  bone_upper_arm_l.position.set(0.12583, -0.005599999999999994, 0.005600000000000001);
  bone_clavicle_l.add(bone_upper_arm_l);
  bones["upper-arm-l"] = bone_upper_arm_l;
  boneOrder.push("upper-arm-l");
  const bone_forearm_l = new THREE.Bone();
  bone_forearm_l.name = "forearm-l";
  bone_forearm_l.position.set(0.029070000000000012, -0.14338, 0.0);
  bone_upper_arm_l.add(bone_forearm_l);
  bones["forearm-l"] = bone_forearm_l;
  boneOrder.push("forearm-l");
  const bone_upper_arm_r = new THREE.Bone();
  bone_upper_arm_r.name = "upper-arm-r";
  bone_upper_arm_r.position.set(-0.12583, -0.005599999999999994, 0.005600000000000001);
  bone_clavicle_r.add(bone_upper_arm_r);
  bones["upper-arm-r"] = bone_upper_arm_r;
  boneOrder.push("upper-arm-r");
  const bone_forearm_r = new THREE.Bone();
  bone_forearm_r.name = "forearm-r";
  bone_forearm_r.position.set(-0.029070000000000012, -0.14338, 0.0);
  bone_upper_arm_r.add(bone_forearm_r);
  bones["forearm-r"] = bone_forearm_r;
  boneOrder.push("forearm-r");
  const bone_hand_l = new THREE.Bone();
  bone_hand_l.name = "hand-l";
  bone_hand_l.position.set(0.019689999999999985, -0.16332, 0.0);
  bone_forearm_l.add(bone_hand_l);
  bones["hand-l"] = bone_hand_l;
  boneOrder.push("hand-l");
  const bone_hand_r = new THREE.Bone();
  bone_hand_r.name = "hand-r";
  bone_hand_r.position.set(-0.019689999999999985, -0.16332, 0.0);
  bone_forearm_r.add(bone_hand_r);
  bones["hand-r"] = bone_hand_r;
  boneOrder.push("hand-r");
  const bone_neck = new THREE.Bone();
  bone_neck.name = "neck";
  bone_neck.position.set(0.0, 0.14, 0.0028);
  bone_chest.add(bone_neck);
  bones["neck"] = bone_neck;
  boneOrder.push("neck");
  const bone_head = new THREE.Bone();
  bone_head.name = "head";
  bone_head.position.set(0.0, 0.23800000000000004, 0.0);
  bone_neck.add(bone_head);
  bones["head"] = bone_head;
  boneOrder.push("head");
  const bone_index_l_1 = new THREE.Bone();
  bone_index_l_1.name = "index-l-1";
  bone_index_l_1.position.set(-0.02099999999999999, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_l.add(bone_index_l_1);
  bones["index-l-1"] = bone_index_l_1;
  boneOrder.push("index-l-1");
  const bone_index_l_2 = new THREE.Bone();
  bone_index_l_2.name = "index-l-2";
  bone_index_l_2.position.set(0.0035199999999999954, -0.029189999999999994, 0.0);
  bone_index_l_1.add(bone_index_l_2);
  bones["index-l-2"] = bone_index_l_2;
  boneOrder.push("index-l-2");
  const bone_index_l_3 = new THREE.Bone();
  bone_index_l_3.name = "index-l-3";
  bone_index_l_3.position.set(0.0024099999999999955, -0.02002000000000001, 0.0);
  bone_index_l_2.add(bone_index_l_3);
  bones["index-l-3"] = bone_index_l_3;
  boneOrder.push("index-l-3");
  const bone_index_r_1 = new THREE.Bone();
  bone_index_r_1.name = "index-r-1";
  bone_index_r_1.position.set(0.02099999999999999, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_r.add(bone_index_r_1);
  bones["index-r-1"] = bone_index_r_1;
  boneOrder.push("index-r-1");
  const bone_index_r_2 = new THREE.Bone();
  bone_index_r_2.name = "index-r-2";
  bone_index_r_2.position.set(-0.0035199999999999954, -0.029189999999999994, 0.0);
  bone_index_r_1.add(bone_index_r_2);
  bones["index-r-2"] = bone_index_r_2;
  boneOrder.push("index-r-2");
  const bone_index_r_3 = new THREE.Bone();
  bone_index_r_3.name = "index-r-3";
  bone_index_r_3.position.set(-0.0024099999999999955, -0.02002000000000001, 0.0);
  bone_index_r_2.add(bone_index_r_3);
  bones["index-r-3"] = bone_index_r_3;
  boneOrder.push("index-r-3");
  const bone_little_l_1 = new THREE.Bone();
  bone_little_l_1.name = "little-l-1";
  bone_little_l_1.position.set(0.019600000000000006, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_l.add(bone_little_l_1);
  bones["little-l-1"] = bone_little_l_1;
  boneOrder.push("little-l-1");
  const bone_little_l_2 = new THREE.Bone();
  bone_little_l_2.name = "little-l-2";
  bone_little_l_2.position.set(0.0026800000000000157, -0.022239999999999996, 0.0);
  bone_little_l_1.add(bone_little_l_2);
  bones["little-l-2"] = bone_little_l_2;
  boneOrder.push("little-l-2");
  const bone_little_l_3 = new THREE.Bone();
  bone_little_l_3.name = "little-l-3";
  bone_little_l_3.position.set(0.0019399999999999973, -0.016119999999999995, 0.0);
  bone_little_l_2.add(bone_little_l_3);
  bones["little-l-3"] = bone_little_l_3;
  boneOrder.push("little-l-3");
  const bone_little_r_1 = new THREE.Bone();
  bone_little_r_1.name = "little-r-1";
  bone_little_r_1.position.set(-0.019600000000000006, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_r.add(bone_little_r_1);
  bones["little-r-1"] = bone_little_r_1;
  boneOrder.push("little-r-1");
  const bone_little_r_2 = new THREE.Bone();
  bone_little_r_2.name = "little-r-2";
  bone_little_r_2.position.set(-0.0026800000000000157, -0.022239999999999996, 0.0);
  bone_little_r_1.add(bone_little_r_2);
  bones["little-r-2"] = bone_little_r_2;
  boneOrder.push("little-r-2");
  const bone_little_r_3 = new THREE.Bone();
  bone_little_r_3.name = "little-r-3";
  bone_little_r_3.position.set(-0.0019399999999999973, -0.016119999999999995, 0.0);
  bone_little_r_2.add(bone_little_r_3);
  bones["little-r-3"] = bone_little_r_3;
  boneOrder.push("little-r-3");
  const bone_middle_l_1 = new THREE.Bone();
  bone_middle_l_1.name = "middle-l-1";
  bone_middle_l_1.position.set(-0.0069999999999999785, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_l.add(bone_middle_l_1);
  bones["middle-l-1"] = bone_middle_l_1;
  boneOrder.push("middle-l-1");
  const bone_middle_l_2 = new THREE.Bone();
  bone_middle_l_2.name = "middle-l-2";
  bone_middle_l_2.position.set(0.0038499999999999923, -0.03197, 0.0);
  bone_middle_l_1.add(bone_middle_l_2);
  bones["middle-l-2"] = bone_middle_l_2;
  boneOrder.push("middle-l-2");
  const bone_middle_l_3 = new THREE.Bone();
  bone_middle_l_3.name = "middle-l-3";
  bone_middle_l_3.position.set(0.002679999999999988, -0.022239999999999996, 0.0);
  bone_middle_l_2.add(bone_middle_l_3);
  bones["middle-l-3"] = bone_middle_l_3;
  boneOrder.push("middle-l-3");
  const bone_middle_r_1 = new THREE.Bone();
  bone_middle_r_1.name = "middle-r-1";
  bone_middle_r_1.position.set(0.0069999999999999785, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_r.add(bone_middle_r_1);
  bones["middle-r-1"] = bone_middle_r_1;
  boneOrder.push("middle-r-1");
  const bone_middle_r_2 = new THREE.Bone();
  bone_middle_r_2.name = "middle-r-2";
  bone_middle_r_2.position.set(-0.0038499999999999923, -0.03197, 0.0);
  bone_middle_r_1.add(bone_middle_r_2);
  bones["middle-r-2"] = bone_middle_r_2;
  boneOrder.push("middle-r-2");
  const bone_middle_r_3 = new THREE.Bone();
  bone_middle_r_3.name = "middle-r-3";
  bone_middle_r_3.position.set(-0.002679999999999988, -0.022239999999999996, 0.0);
  bone_middle_r_2.add(bone_middle_r_3);
  bones["middle-r-3"] = bone_middle_r_3;
  boneOrder.push("middle-r-3");
  const bone_ring_l_1 = new THREE.Bone();
  bone_ring_l_1.name = "ring-l-1";
  bone_ring_l_1.position.set(0.007000000000000006, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_l.add(bone_ring_l_1);
  bones["ring-l-1"] = bone_ring_l_1;
  boneOrder.push("ring-l-1");
  const bone_ring_l_2 = new THREE.Bone();
  bone_ring_l_2.name = "ring-l-2";
  bone_ring_l_2.position.set(0.0035199999999999954, -0.029189999999999994, 0.0);
  bone_ring_l_1.add(bone_ring_l_2);
  bones["ring-l-2"] = bone_ring_l_2;
  boneOrder.push("ring-l-2");
  const bone_ring_l_3 = new THREE.Bone();
  bone_ring_l_3.name = "ring-l-3";
  bone_ring_l_3.position.set(0.0024100000000000232, -0.02002000000000001, 0.0);
  bone_ring_l_2.add(bone_ring_l_3);
  bones["ring-l-3"] = bone_ring_l_3;
  boneOrder.push("ring-l-3");
  const bone_ring_r_1 = new THREE.Bone();
  bone_ring_r_1.name = "ring-r-1";
  bone_ring_r_1.position.set(-0.007000000000000006, -0.037630000000000004, 0.0027999999999999987);
  bone_hand_r.add(bone_ring_r_1);
  bones["ring-r-1"] = bone_ring_r_1;
  boneOrder.push("ring-r-1");
  const bone_ring_r_2 = new THREE.Bone();
  bone_ring_r_2.name = "ring-r-2";
  bone_ring_r_2.position.set(-0.0035199999999999954, -0.029189999999999994, 0.0);
  bone_ring_r_1.add(bone_ring_r_2);
  bones["ring-r-2"] = bone_ring_r_2;
  boneOrder.push("ring-r-2");
  const bone_ring_r_3 = new THREE.Bone();
  bone_ring_r_3.name = "ring-r-3";
  bone_ring_r_3.position.set(-0.0024100000000000232, -0.02002000000000001, 0.0);
  bone_ring_r_2.add(bone_ring_r_3);
  bones["ring-r-3"] = bone_ring_r_3;
  boneOrder.push("ring-r-3");
  const bone_thumb_l_1 = new THREE.Bone();
  bone_thumb_l_1.name = "thumb-l-1";
  bone_thumb_l_1.position.set(-0.027999999999999997, -0.005380000000000003, 0.005599999999999999);
  bone_hand_l.add(bone_thumb_l_1);
  bones["thumb-l-1"] = bone_thumb_l_1;
  boneOrder.push("thumb-l-1");
  const bone_thumb_l_2 = new THREE.Bone();
  bone_thumb_l_2.name = "thumb-l-2";
  bone_thumb_l_2.position.set(-0.015119999999999995, -0.013019999999999997, 0.0063);
  bone_thumb_l_1.add(bone_thumb_l_2);
  bones["thumb-l-2"] = bone_thumb_l_2;
  boneOrder.push("thumb-l-2");
  const bone_thumb_l_3 = new THREE.Bone();
  bone_thumb_l_3.name = "thumb-l-3";
  bone_thumb_l_3.position.set(-0.011089999999999989, -0.00954, 0.004619999999999999);
  bone_thumb_l_2.add(bone_thumb_l_3);
  bones["thumb-l-3"] = bone_thumb_l_3;
  boneOrder.push("thumb-l-3");
  const bone_thumb_r_1 = new THREE.Bone();
  bone_thumb_r_1.name = "thumb-r-1";
  bone_thumb_r_1.position.set(0.027999999999999997, -0.005380000000000003, 0.005599999999999999);
  bone_hand_r.add(bone_thumb_r_1);
  bones["thumb-r-1"] = bone_thumb_r_1;
  boneOrder.push("thumb-r-1");
  const bone_thumb_r_2 = new THREE.Bone();
  bone_thumb_r_2.name = "thumb-r-2";
  bone_thumb_r_2.position.set(0.015119999999999995, -0.013019999999999997, 0.0063);
  bone_thumb_r_1.add(bone_thumb_r_2);
  bones["thumb-r-2"] = bone_thumb_r_2;
  boneOrder.push("thumb-r-2");
  const bone_thumb_r_3 = new THREE.Bone();
  bone_thumb_r_3.name = "thumb-r-3";
  bone_thumb_r_3.position.set(0.011089999999999989, -0.00954, 0.004619999999999999);
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
  const BONE_JOINT: Record<string, number[]> = {"pelvis": [0.0, -0.014, 0.0], "abdomen": [0.0, 0.014, 0.0], "chest": [0.0, 0.1316, 0.0028], "clavicle-l": [0.02397, 0.2772, 0.0084], "clavicle-r": [-0.02397, 0.2772, 0.0084], "thigh-l": [0.03192, -0.0616, 0.0056], "shin-l": [0.03192, -0.10241, 0.0056], "foot-l": [0.03192, -0.1526, 0.0448], "thigh-r": [-0.03192, -0.0616, 0.0056], "shin-r": [-0.03192, -0.10241, 0.0056], "foot-r": [-0.03192, -0.1526, 0.0448], "upper-arm-l": [0.1498, 0.2716, 0.014], "forearm-l": [0.17887, 0.12822, 0.014], "upper-arm-r": [-0.1498, 0.2716, 0.014], "forearm-r": [-0.17887, 0.12822, 0.014], "hand-l": [0.19856, -0.0351, 0.014], "hand-r": [-0.19856, -0.0351, 0.014], "neck": [0.0, 0.2716, 0.0056], "head": [0.0, 0.5096, 0.0056], "index-l-1": [0.17756, -0.07273, 0.0168], "index-l-2": [0.18108, -0.10192, 0.0168], "index-l-3": [0.18349, -0.12194, 0.0168], "index-r-1": [-0.17756, -0.07273, 0.0168], "index-r-2": [-0.18108, -0.10192, 0.0168], "index-r-3": [-0.18349, -0.12194, 0.0168], "little-l-1": [0.21816, -0.07273, 0.0168], "little-l-2": [0.22084, -0.09497, 0.0168], "little-l-3": [0.22278, -0.11109, 0.0168], "little-r-1": [-0.21816, -0.07273, 0.0168], "little-r-2": [-0.22084, -0.09497, 0.0168], "little-r-3": [-0.22278, -0.11109, 0.0168], "middle-l-1": [0.19156, -0.07273, 0.0168], "middle-l-2": [0.19541, -0.1047, 0.0168], "middle-l-3": [0.19809, -0.12694, 0.0168], "middle-r-1": [-0.19156, -0.07273, 0.0168], "middle-r-2": [-0.19541, -0.1047, 0.0168], "middle-r-3": [-0.19809, -0.12694, 0.0168], "ring-l-1": [0.20556, -0.07273, 0.0168], "ring-l-2": [0.20908, -0.10192, 0.0168], "ring-l-3": [0.21149, -0.12194, 0.0168], "ring-r-1": [-0.20556, -0.07273, 0.0168], "ring-r-2": [-0.20908, -0.10192, 0.0168], "ring-r-3": [-0.21149, -0.12194, 0.0168], "thumb-l-1": [0.17056, -0.04048, 0.0196], "thumb-l-2": [0.15544, -0.0535, 0.0259], "thumb-l-3": [0.14435, -0.06304, 0.03052], "thumb-r-1": [-0.17056, -0.04048, 0.0196], "thumb-r-2": [-0.15544, -0.0535, 0.0259], "thumb-r-3": [-0.14435, -0.06304, 0.03052]};
  const BONE_TIP: Record<string, number[]> = {"pelvis": [0.0, 0.014, 0.0], "abdomen": [0.0, 0.1316, 0.0028], "chest": [0.0, 0.2716, 0.0056], "clavicle-l": [0.1498, 0.2716, 0.014], "clavicle-r": [-0.1498, 0.2716, 0.014], "thigh-l": [0.03192, -0.10241, 0.0056], "shin-l": [0.03192, -0.1526, 0.0448], "foot-l": [0.03192, -0.18791, 0.07238], "thigh-r": [-0.03192, -0.10241, 0.0056], "shin-r": [-0.03192, -0.1526, 0.0448], "foot-r": [-0.03192, -0.18791, 0.07238], "upper-arm-l": [0.17887, 0.12822, 0.014], "forearm-l": [0.19856, -0.0351, 0.014], "upper-arm-r": [-0.17887, 0.12822, 0.014], "forearm-r": [-0.19856, -0.0351, 0.014], "hand-l": [0.19156, -0.07273, 0.0168], "hand-r": [-0.19156, -0.07273, 0.0168], "neck": [0.0, 0.5096, 0.0056], "head": [0.0, 0.8232, 0.0056], "index-l-1": [0.18108, -0.10192, 0.0168], "index-l-2": [0.18349, -0.12194, 0.0168], "index-l-3": [0.1851, -0.13528, 0.0168], "index-r-1": [-0.18108, -0.10192, 0.0168], "index-r-2": [-0.18349, -0.12194, 0.0168], "index-r-3": [-0.1851, -0.13528, 0.0168], "little-l-1": [0.22084, -0.09497, 0.0168], "little-l-2": [0.22278, -0.11109, 0.0168], "little-l-3": [0.22406, -0.12166, 0.0168], "little-r-1": [-0.22084, -0.09497, 0.0168], "little-r-2": [-0.22278, -0.11109, 0.0168], "little-r-3": [-0.22406, -0.12166, 0.0168], "middle-l-1": [0.19541, -0.1047, 0.0168], "middle-l-2": [0.19809, -0.12694, 0.0168], "middle-l-3": [0.19977, -0.14084, 0.0168], "middle-r-1": [-0.19541, -0.1047, 0.0168], "middle-r-2": [-0.19809, -0.12694, 0.0168], "middle-r-3": [-0.19977, -0.14084, 0.0168], "ring-l-1": [0.20908, -0.10192, 0.0168], "ring-l-2": [0.21149, -0.12194, 0.0168], "ring-l-3": [0.21303, -0.13472, 0.0168], "ring-r-1": [-0.20908, -0.10192, 0.0168], "ring-r-2": [-0.21149, -0.12194, 0.0168], "ring-r-3": [-0.21303, -0.13472, 0.0168], "thumb-l-1": [0.15544, -0.0535, 0.0259], "thumb-l-2": [0.14435, -0.06304, 0.03052], "thumb-l-3": [0.13626, -0.07001, 0.03389], "thumb-r-1": [-0.15544, -0.0535, 0.0259], "thumb-r-2": [-0.14435, -0.06304, 0.03052], "thumb-r-3": [-0.13626, -0.07001, 0.03389]};
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
  root.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is a glossy 3D render rather than cel art, so the ramp REINTERPRETS it into the project's language instead of reproducing it.", "palette": ["#1c2019", "#0d100c", "#f6f1e4", "#f26a26", "#ffd9bd", "#f4f4f2", "#211d1a", "#12161c", "#3fc4de"], "paletteNote": "Named tones, not sampled pixels - the reference carries a watermark lattice over every surface. At runtime the sleeve takes the TEAM COLOUR, so the shipped hue differs from the nori tone named here.", "responseTargets": ["the eye dome reads glossiest; the glint is unlit and brighter than any lit band can be", "rice reads a step lighter and softer than the glove, so the two whites never merge", "the nori hairlines read darker than the sleeve at EVERY team colour, including the frightened blue", "the mouth interior reads darkest on the model - it is a hole, not a dark surface"]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMakiRollMascotLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Maki Roll Mascot look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": [0.5, 0.72, 0.48], "color": "#fff4e2", "intensity": 2.1, "colorNote": "Warm, above and to the camera's left in the reference; matched to scene.ts's own key.", "intensityNote": "Dominant: every specular sweep on the barrel and both eye domes agree on it.", "exposureNote": "NO tone mapping. The renderer runs THREE.NoToneMapping and the exposure is left at 1.0 - a filmic or ACES curve re-compresses the cel ramp's three bands into each other and undoes the whole point of the shading model.", "shadowNote": "Casts the model's GROUND shadow. Every mesh sets castShadow at build time and the spirit pass switches it off wholesale, so the authored value is snapshotted first.", "confidence": 0.8}, {"id": "fill", "type": "hemisphere", "sky": "#dfeaff", "ground": "#d8c6a8", "intensity": 1.15, "direction": [0.0, 1.0, 0.0], "colorNote": "Cool sky over a warm ground bounce, matched to scene.ts.", "intensityNote": "Soft; the shadow sides never reach black, which the toon ramp's lowest band needs.", "exposureNote": "Same NoToneMapping / exposure 1.0 rule as the key.", "shadowNote": "Contributes no shadow. There is no ambient-occlusion pass and no AO map anywhere in this project - contact darkening comes from geometry, i.e. parts embedded far enough into each other that the ramp's own bands do the work.", "confidence": 0.7}, {"id": "rim-and-environment", "type": "none", "direction": [0.0, 0.0, -1.0], "colorNote": "Absent, deliberately.", "intensityNote": "The shipped scene has no rim light and no IBL - no PMREMGenerator, no HDR, no environment map. Adding any of them is a scene change, not a model decision, so the model must read without them.", "exposureNote": "NoToneMapping; nothing here changes exposure.", "shadowNote": "Ground shadow is the ONLY shadow in this project: one directional light, PCFSoftShadowMap, no contact-shadow pass and no screen-space AO.", "confidence": 0.9}];
  lights.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is a glossy 3D render rather than cel art, so the ramp REINTERPRETS it into the project's language instead of reproducing it.", "palette": ["#1c2019", "#0d100c", "#f6f1e4", "#f26a26", "#ffd9bd", "#f4f4f2", "#211d1a", "#12161c", "#3fc4de"], "paletteNote": "Named tones, not sampled pixels - the reference carries a watermark lattice over every surface. At runtime the sleeve takes the TEAM COLOUR, so the shipped hue differs from the nori tone named here.", "responseTargets": ["the eye dome reads glossiest; the glint is unlit and brighter than any lit band can be", "rice reads a step lighter and softer than the glove, so the two whites never merge", "the nori hairlines read darker than the sleeve at EVERY team colour, including the frightened blue", "the mouth interior reads darkest on the model - it is a hole, not a dark surface"]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMakiRollMascotEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameMakiRollMascotCamera(
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
export function createMakiRollMascotPresentationComposer(
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

export function configureMakiRollMascotRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMakiRollMascotInspectControls(
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
