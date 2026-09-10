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

// Generated from ObjectSculptSpec target: Cartoon Mosquito
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCartoonMosquitoModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Cartoon Mosquito";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "NOT solved, deliberately. Camera solving exists to align a render with the photo for pixel overlay and texture projection; projection is rejected (evidence/projection-route.md), and nothing here is overlaid pixel-on-pixel. The model is authored in its own canonical frame and reviewed from a fixed turntable."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["cuticle"] = createSculptMaterial(
    "cuticle",
    {"id": "cuticle", "name": "Cuticle (body)", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#634024", "color": "#634024", "albedo": {"dominant": "#634024", "secondary": ["#8E5F43"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#634024", "#8E5F43"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The main body brown - head, proboscis, abdomen. At runtime this is the TEAM COLOUR, not brown: every enemy skin is make<Name>(color). The reference hue names the tone; it does not ship.", "recolourPolicy": {"onTeamColour": "team", "inAccentMats": false, "rationale": "This is the body material; it takes the team colour directly (GhostUserData.bodyMat)."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["cuticleDark"] = createSculptMaterial(
    "cuticleDark",
    {"id": "cuticleDark", "name": "Cuticle crease", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#3F2411", "color": "#3F2411", "albedo": {"dominant": "#3F2411", "secondary": ["#2A1809"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#3F2411", "#2A1809"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [{"id": "abdomen-bands", "appliesTo": "abdomen", "selector": "lathe ring index -> t in [0,0.233],[0.396,0.462],[0.678,0.744],[0.903,1.0]", "evidenceRef": "evidence/bands.py"}], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The abdomen's two interior creases plus its dark base and tip. Assigned as per-triangle material GROUPS on the abdomen lathe, by ring index.", "recolourPolicy": {"onTeamColour": "accent-small-fixed", "inAccentMats": false, "rationale": "A SMALL fixed accent. It deliberately does NOT recolour. This is IDEA-053's rule 2, learned on the flea: banding that follows the body colour vanishes exactly when the player is chasing it."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["cuticleLight"] = createSculptMaterial(
    "cuticleLight",
    {"id": "cuticleLight", "name": "Cuticle highlight", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#8E5F43", "color": "#8E5F43", "albedo": {"dominant": "#8E5F43", "secondary": ["#634024"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#8E5F43", "#634024"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The lightest step of the reference's three-tone cuticle ladder. Used sparingly on the abdomen's upper segments; mostly the toon ramp itself produces this step.", "recolourPolicy": {"onTeamColour": "accent-large", "inAccentMats": true, "rationale": "A LARGE share of the silhouette, so it follows the frightened recolour - leaving it would weaken the 'this one is edible now' read."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["thoraxDark"] = createSculptMaterial(
    "thoraxDark",
    {"id": "thoraxDark", "name": "Thorax", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#2D2727", "color": "#2D2727", "albedo": {"dominant": "#2D2727", "secondary": ["#151313"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#2D2727", "#151313"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The near-black thorax. Distinctly darker than the cuticle in the reference - a real three-mass value read (brown head, black thorax, brown abdomen).", "recolourPolicy": {"onTeamColour": "accent-large", "inAccentMats": true, "rationale": "A LARGE share of the silhouette, so it follows the frightened recolour - leaving it would weaken the 'this one is edible now' read."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["thoraxGloss"] = createSculptMaterial(
    "thoraxGloss",
    {"id": "thoraxGloss", "name": "Thorax specular patch", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#595959", "color": "#595959", "albedo": {"dominant": "#595959", "secondary": ["#7A7A7A"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#595959", "#7A7A7A"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The lighter grey ellipse on the thorax's upper-front quadrant - the only discrete specular mark on the subject.", "recolourPolicy": {"onTeamColour": "accent-small-fixed", "inAccentMats": false, "rationale": "A SMALL fixed accent. It deliberately does NOT recolour. This is IDEA-053's rule 2, learned on the flea: banding that follows the body colour vanishes exactly when the player is chasing it."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["membrane"] = createSculptMaterial(
    "membrane",
    {"id": "membrane", "name": "Wing membrane", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#FAF8E1", "color": "#FAF8E1", "albedo": {"dominant": "#FAF8E1", "secondary": ["#FFFFFF"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#FAF8E1", "#FFFFFF"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The only non-opaque surface on the model. Semi-translucent, double-sided, depthWrite off.", "recolourPolicy": {"onTeamColour": "accent-large", "inAccentMats": true, "rationale": "A LARGE share of the silhouette, so it follows the frightened recolour - leaving it would weaken the 'this one is edible now' read."}, "transparency": {"transparent": true, "opacity": 0.55, "depthWrite": false, "side": "DoubleSide", "note": "Opacity matched to the shipped bee's wing, which is the tuned value this project already trusts at the game camera. Wings must also be excluded from shadow casting."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["vein"] = createSculptMaterial(
    "vein",
    {"id": "vein", "name": "Wing vein", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#E8E4C4", "color": "#E8E4C4", "albedo": {"dominant": "#E8E4C4", "secondary": ["#FAF8E1"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#E8E4C4", "#FAF8E1"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Lengthwise ribs fanning from the wing root.", "recolourPolicy": {"onTeamColour": "fixed", "inAccentMats": false, "rationale": "Its own colour in every state."}, "transparency": {"transparent": true, "opacity": 0.28, "depthWrite": false, "note": "Faint on purpose. Seen EDGE-ON at full opacity these punch through the head as bright whiskers - the defect the shipped bee records."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["limb"] = createSculptMaterial(
    "limb",
    {"id": "limb", "name": "Limb (legs, antennae, knuckles)", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#1A1A1A"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#000000", "#1A1A1A"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.5, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Legs and antennae. In the reference the legs are true black and the antennae dark brown; at game scale both are thin dark lines, so they share one material and recolour together.", "recolourPolicy": {"onTeamColour": "accent-large", "inAccentMats": true, "rationale": "A LARGE share of the silhouette, so it follows the frightened recolour - leaving it would weaken the 'this one is edible now' read."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["sclera"] = createSculptMaterial(
    "sclera",
    {"id": "sclera", "name": "Eye white", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#FFFFFF", "color": "#FFFFFF", "albedo": {"dominant": "#FFFFFF", "secondary": ["#E8E8E8"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#FFFFFF", "#E8E8E8"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.2, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The eyeball. Stays solid while eaten.", "recolourPolicy": {"onTeamColour": "eye", "inAccentMats": false, "rationale": "Left SOLID while eaten - the eyes are what a player tracks as an eaten enemy runs home (GhostUserData.eyeMats)."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["pupil"] = createSculptMaterial(
    "pupil",
    {"id": "pupil", "name": "Pupil", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#141414", "color": "#141414", "albedo": {"dominant": "#141414", "secondary": ["#000000"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#141414", "#000000"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.15, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The authored pupil colour, restored by applyGhostState when leaving frightened. Without GhostUserData.pupBaseColor the normal branch puts back a hardcoded ghost blue.", "recolourPolicy": {"onTeamColour": "eye", "inAccentMats": false, "rationale": "Left SOLID while eaten - the eyes are what a player tracks as an eaten enemy runs home (GhostUserData.eyeMats)."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["glint"] = createSculptMaterial(
    "glint",
    {"id": "glint", "name": "Catchlight", "type": "basic", "shaderModel": "MeshBasicMaterial (unlit) - the ONE deliberate exception to the project's cel-shading rule", "baseColor": "#FFFFFF", "color": "#FFFFFF", "albedo": {"dominant": "#FFFFFF", "secondary": ["#FFFFFF"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#FFFFFF", "#FFFFFF"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.1, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Unlit on purpose. A toon ramp quantises a highlight into the same band as everything else facing the light, and it stops reading as a catchlight."], "notes": "Unlit. The single MeshBasicMaterial in the model.", "recolourPolicy": {"onTeamColour": "fixed", "inAccentMats": false, "rationale": "Its own colour in every state."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["tooth"] = createSculptMaterial(
    "tooth",
    {"id": "tooth", "name": "Tooth", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#FFFFFF", "color": "#FFFFFF", "albedo": {"dominant": "#FFFFFF", "secondary": ["#EFEFEF"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#FFFFFF", "#EFEFEF"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.1, "map": null, "note": "Inferred property of the DEPICTED material (evidence/image-analysis.md Layer 5), recorded because that is what a look-dev spec describes. MeshToonMaterial has no roughness channel: the implementation expresses these relationships through the shared 3-step ramp, and for the thorax - the glossiest surface, and the only one the reference gives a discrete specular mark - through the flat lighter patch component 'thoraxGloss'. Do NOT emit a roughness value into the generated material."}, "metalness": {"base": 0.0, "variation": 0.0, "map": null, "note": "Every surface on the subject is a dielectric. MeshToonMaterial has no metalness channel."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "The two-tooth grin.", "recolourPolicy": {"onTeamColour": "eye", "inAccentMats": false, "rationale": "Left SOLID while eaten - the eyes are what a player tracks as an eaten enemy runs home (GhostUserData.eyeMats)."}, "qualityTier": "hero", "textureless": {"declared": true, "evidence": ["evidence/image-analysis.md#layer-5 - the reference is flat-fill vector art: no grain, no pores, no weave, no wear, no print anywhere on the subject.", "Measured palette scan: the entire opaque subject resolves to SEVEN modal tones (#FAF8E1 5.33%, #634024 1.96%, #3F2411 0.66%, #8E5F43 0.55%, #2D2727 0.49%, #595959 0.24%, #000000 0.28%). A textured surface cannot compress to seven values.", "Measured: every tone boundary in the source is a HARD EDGE between constant fills. There is no gradient anywhere to sample a height or roughness response from.", "evidence/projection-route.md - projection is rejected on four independent grounds; de-lighting a flat fill returns the input unchanged, so there is no albedo to recover and nothing to bake.", "Target-project constraint: an offline-capable PWA that generates its surfaces at runtime and ships NO texture assets. Every lit surface is a MeshToonMaterial on one shared 3-step ramp; there is no map slot for this model to fill."]}},
    options
  );
  materialMap["none"] = createSculptMaterial(
    "none",
    {"id": "none", "name": "No material (transform-only node)", "type": "toon", "shaderModel": "MeshToonMaterial (three r169) built through the project's shared toon() helper on the one 3-step gradient ramp", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000"], "samplingNotes": "Hand-authored NAMED tone. Read from the reference to name it, never sampled into a shipped map - projection is rejected (evidence/projection-route.md)."}, "colorVariation": {"palette": ["#000000", "#000000"], "pattern": "flat-toon-bands", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "metalness": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "ambientOcclusion": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "wear": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "dirt": {"value": null, "notApplicable": true, "reason": "MeshToonMaterial has no such channel. Specifying it would be inventing an API - the project's rule is to verify against the installed three r169 before using anything."}, "localOverrides": [], "shaderNotes": ["Build with toon({...}); never `new THREE.MeshStandardMaterial`.", "Renderer runs NoToneMapping - a filmic curve re-compresses the ramp's bands and undoes cel shading."], "notes": "Groups and pivots carry no geometry and no material.", "recolourPolicy": {"onTeamColour": "fixed", "inAccentMats": false, "rationale": "Its own colour in every state."}, "qualityTier": "utility"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_thorax_0 = makeAttachmentEndpoint(null);
  const node_thorax_0 = new THREE.Group();
  node_thorax_0.name = "Thorax__pivot";
  node_thorax_0.scale.set(1, 1, 1);
  if (endpoint_thorax_0) {
    node_thorax_0.position.copy(endpoint_thorax_0.start);
    node_thorax_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thorax_0.position.set(0.0, 0.4, 0.0);
    node_thorax_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_thorax_0.userData.sculptComponent = {"id": "thorax", "name": "Thorax", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous smoothly-varying mass with no panel break or flat face. Revolved profile, never a box or a bare sphere primitive: the reference silhouette is an egg slightly taller than wide (measured 100 x 110 px).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.1755, "height": 0.1917, "depth": 0.1836, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, 0.4, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "thoraxDark", "materialLayers": ["thoraxDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "thorax-gloss-anchor", "note": "Carries the specular patch decal; see component thoraxGloss."}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md", "evidence/anatomy.json#masses.thorax"], "details": [], "fidelityTier": "reference-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(45, 39, 39, 1.0)", "secondaryAlbedo": "rgba(21, 19, 19, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}, "pivotNote": "Rotated by the 'hover' entry in rig.pivots. The generator emits a pivot Group per component, so this spec carries no transform-only components of its own - they were emitted as real unit boxes that swallowed the model."};
  node_thorax_0.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_thorax_0);
  nodes["thorax"] = node_thorax_0;
  const mesh_thorax_0Geometry = endpoint_thorax_0
    ? new THREE.CylinderGeometry(endpoint_thorax_0.endRadius, endpoint_thorax_0.baseRadius, endpoint_thorax_0.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_thorax_0) {
    mesh_thorax_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_thorax_0 = new THREE.Mesh(
    mesh_thorax_0Geometry,
    materialMap["thoraxDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thorax_0.name = "Thorax";
  if (endpoint_thorax_0) {
    mesh_thorax_0.position.copy(endpoint_thorax_0.midpoint);
    mesh_thorax_0.quaternion.copy(endpoint_thorax_0.quaternion);
  }
  mesh_thorax_0.castShadow = options.castShadow ?? true;
  mesh_thorax_0.receiveShadow = options.receiveShadow ?? true;
  mesh_thorax_0.userData.sculptComponent = {"id": "thorax", "name": "Thorax", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous smoothly-varying mass with no panel break or flat face. Revolved profile, never a box or a bare sphere primitive: the reference silhouette is an egg slightly taller than wide (measured 100 x 110 px).", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.1755, "height": 0.1917, "depth": 0.1836, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, 0.4, 0.0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "thoraxDark", "materialLayers": ["thoraxDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "thorax-gloss-anchor", "note": "Carries the specular patch decal; see component thoraxGloss."}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md", "evidence/anatomy.json#masses.thorax"], "details": [], "fidelityTier": "reference-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(45, 39, 39, 1.0)", "secondaryAlbedo": "rgba(21, 19, 19, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}, "pivotNote": "Rotated by the 'hover' entry in rig.pivots. The generator emits a pivot Group per component, so this spec carries no transform-only components of its own - they were emitted as real unit boxes that swallowed the model."};
  node_thorax_0.add(mesh_thorax_0);
  meshes["thorax"] = mesh_thorax_0;
  colliders["thorax"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_head_1 = makeAttachmentEndpoint(null);
  const node_head_1 = new THREE.Group();
  node_head_1.name = "Head__pivot";
  node_head_1.scale.set(1, 1, 1);
  if (endpoint_head_1) {
    node_head_1.position.copy(endpoint_head_1.start);
    node_head_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_1.position.set(0.0, 0.4176, 0.1998);
    node_head_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_1.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A continuous organic blob, revolved. The eyes bulge PROUD of this surface rather than sitting in sockets - the reference's brown wraps behind each eye.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thorax", "attachment": null, "dimensions": {"width": 0.27, "height": 0.27, "depth": 0.27, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, 0.4176, 0.1998], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "head", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticle", "materialLayers": ["cuticle"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grin-anchor", "note": "Two-tooth grin on the lower front; see component grin."}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md", "evidence/anatomy.json#masses.head"], "details": [], "fidelityTier": "reference-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(99, 64, 36, 1.0)", "secondaryAlbedo": "rgba(142, 95, 67, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}, "pivotNote": "Rotated by the 'hover' entry in rig.pivots. The generator emits a pivot Group per component, so this spec carries no transform-only components of its own - they were emitted as real unit boxes that swallowed the model."};
  node_head_1.userData.actionProfile = {"animationRole": "head", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["thorax"] ?? root).add(node_head_1);
  nodes["head"] = node_head_1;
  const mesh_head_1Geometry = endpoint_head_1
    ? new THREE.CylinderGeometry(endpoint_head_1.endRadius, endpoint_head_1.baseRadius, endpoint_head_1.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_head_1) {
    mesh_head_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_head_1 = new THREE.Mesh(
    mesh_head_1Geometry,
    materialMap["cuticle"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_1.name = "Head";
  if (endpoint_head_1) {
    mesh_head_1.position.copy(endpoint_head_1.midpoint);
    mesh_head_1.quaternion.copy(endpoint_head_1.quaternion);
  }
  mesh_head_1.castShadow = options.castShadow ?? true;
  mesh_head_1.receiveShadow = options.receiveShadow ?? true;
  mesh_head_1.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 0.95, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A continuous organic blob, revolved. The eyes bulge PROUD of this surface rather than sitting in sockets - the reference's brown wraps behind each eye.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thorax", "attachment": null, "dimensions": {"width": 0.27, "height": 0.27, "depth": 0.27, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, 0.4176, 0.1998], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "head", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticle", "materialLayers": ["cuticle"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grin-anchor", "note": "Two-tooth grin on the lower front; see component grin."}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md", "evidence/anatomy.json#masses.head"], "details": [], "fidelityTier": "reference-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(99, 64, 36, 1.0)", "secondaryAlbedo": "rgba(142, 95, 67, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}, "pivotNote": "Rotated by the 'hover' entry in rig.pivots. The generator emits a pivot Group per component, so this spec carries no transform-only components of its own - they were emitted as real unit boxes that swallowed the model."};
  node_head_1.add(mesh_head_1);
  meshes["head"] = mesh_head_1;
  colliders["head"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_proboscis_2 = makeAttachmentEndpoint(null);
  const node_proboscis_2 = new THREE.Group();
  node_proboscis_2.name = "Proboscis__pivot";
  node_proboscis_2.scale.set(1, 1, 1);
  if (endpoint_proboscis_2) {
    node_proboscis_2.position.copy(endpoint_proboscis_2.start);
    node_proboscis_2.rotation.set(-0.48, 0.0, 0.0);
  } else {
    node_proboscis_2.position.set(0.0, -0.0567, 0.1161);
    node_proboscis_2.rotation.set(-0.48, 0.0, 0.0);
  }
  node_proboscis_2.userData.sculptComponent = {"id": "proboscis", "name": "Proboscis", "level": "meso", "role": "appendage", "importance": 1.0, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved profile: straight for most of its length, slightly swelled where it leaves the head, tapering to a TRUE POINT. Lathe rather than a cone primitive so the base swell the reference shows (the y=392 run is 39 px wide and drops fast) is representable. The local corpus independently recommends a tapered cone for 'pointed shape narrowing to a point' - a lathe of a near-straight profile produces exactly that.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "head-front-lower", "localStart": [0.0, -0.0567, 0.1161], "localEnd": [0.0, -0.1478, 0.2909], "contactType": "embed", "baseRadius": 0.0257, "endRadius": 0.0, "embedDepth": 0.027, "gapTolerance": 0.005, "evidenceRefs": ["evidence/image-analysis.md#layer-4"], "parentId": "head", "overlap": 0.027}, "dimensions": {"width": 0.0514, "height": 0.1971, "depth": 0.0514, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, -0.0567, 0.1161], "rotation": [-0.48, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticle", "materialLayers": ["cuticle"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "true-point-tip", "note": "The tip must converge to a point, not a flat cap or a hemisphere. It is identity rank 1."}, {"id": "proboscis-needle", "description": "A 0.73 HD needle tapering from diameter 0.19 HD to a true point, projecting forward-down at 27.5 deg below horizontal from the head's front-lower face.", "identityRank": 1, "confidence": 0.95, "evidenceRefs": ["brown runs y=392 (471-509) through y=440 (573); root (475,388) tip (575,440)"]}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md#layer-7", "detail-zones/zone-r2c2.png"], "details": ["proboscis-needle"], "fidelityTier": "identity-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(99, 64, 36, 1.0)", "secondaryAlbedo": "rgba(142, 95, 67, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}};
  node_proboscis_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_proboscis_2);
  nodes["proboscis"] = node_proboscis_2;
  const mesh_proboscis_2Geometry = endpoint_proboscis_2
    ? new THREE.CylinderGeometry(endpoint_proboscis_2.endRadius, endpoint_proboscis_2.baseRadius, endpoint_proboscis_2.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_proboscis_2) {
    mesh_proboscis_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_proboscis_2 = new THREE.Mesh(
    mesh_proboscis_2Geometry,
    materialMap["cuticle"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_proboscis_2.name = "Proboscis";
  if (endpoint_proboscis_2) {
    mesh_proboscis_2.position.copy(endpoint_proboscis_2.midpoint);
    mesh_proboscis_2.quaternion.copy(endpoint_proboscis_2.quaternion);
  }
  mesh_proboscis_2.castShadow = options.castShadow ?? true;
  mesh_proboscis_2.receiveShadow = options.receiveShadow ?? true;
  mesh_proboscis_2.userData.sculptComponent = {"id": "proboscis", "name": "Proboscis", "level": "meso", "role": "appendage", "importance": 1.0, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved profile: straight for most of its length, slightly swelled where it leaves the head, tapering to a TRUE POINT. Lathe rather than a cone primitive so the base swell the reference shows (the y=392 run is 39 px wide and drops fast) is representable. The local corpus independently recommends a tapered cone for 'pointed shape narrowing to a point' - a lathe of a near-straight profile produces exactly that.", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "head-front-lower", "localStart": [0.0, -0.0567, 0.1161], "localEnd": [0.0, -0.1478, 0.2909], "contactType": "embed", "baseRadius": 0.0257, "endRadius": 0.0, "embedDepth": 0.027, "gapTolerance": 0.005, "evidenceRefs": ["evidence/image-analysis.md#layer-4"], "parentId": "head", "overlap": 0.027}, "dimensions": {"width": 0.0514, "height": 0.1971, "depth": 0.0514, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, -0.0567, 0.1161], "rotation": [-0.48, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticle", "materialLayers": ["cuticle"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "true-point-tip", "note": "The tip must converge to a point, not a flat cap or a hemisphere. It is identity rank 1."}, {"id": "proboscis-needle", "description": "A 0.73 HD needle tapering from diameter 0.19 HD to a true point, projecting forward-down at 27.5 deg below horizontal from the head's front-lower face.", "identityRank": 1, "confidence": 0.95, "evidenceRefs": ["brown runs y=392 (471-509) through y=440 (573); root (475,388) tip (575,440)"]}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md#layer-7", "detail-zones/zone-r2c2.png"], "details": ["proboscis-needle"], "fidelityTier": "identity-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(99, 64, 36, 1.0)", "secondaryAlbedo": "rgba(142, 95, 67, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}};
  node_proboscis_2.add(mesh_proboscis_2);
  meshes["proboscis"] = mesh_proboscis_2;
  colliders["proboscis"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  const endpoint_abdomen_3 = makeAttachmentEndpoint(null);
  const node_abdomen_3 = new THREE.Group();
  node_abdomen_3.name = "Abdomen__pivot";
  node_abdomen_3.scale.set(1, 1, 1);
  if (endpoint_abdomen_3) {
    node_abdomen_3.position.copy(endpoint_abdomen_3.start);
    node_abdomen_3.rotation.set(-0.5934, 0.0, 0.0);
  } else {
    node_abdomen_3.position.set(0.0, -0.0144, -0.0845);
    node_abdomen_3.rotation.set(-0.5934, 0.0, 0.0);
  }
  node_abdomen_3.userData.sculptComponent = {"id": "abdomen", "name": "Abdomen", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A REVOLVED PROFILE reproducing the measured perpendicular half-width table, not a stretched capsule and not an ellipsoid: pinched to a 6.5:1 waist, swelling to its maximum just PAST mid-length (t = 0.475), then tapering to a rounded point. The local corpus's top hit recommends exactly this ('parts generated by revolving a 2D profile about an axis').", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thorax", "attachment": {"parentSocket": "thorax-socket", "localStart": [0, 0, 0], "localEnd": [0.0, -0.3268, -0.2204], "contactType": "socket-joint", "baseRadius": 0.0162, "endRadius": 0.1013, "embedDepth": 0.0216, "gapTolerance": 0.01, "evidenceRefs": ["evidence/image-analysis.md#layer-4"], "parentId": "thorax", "overlap": 0.0216}, "dimensions": {"width": 0.2026, "height": 0.3942, "depth": 0.2026, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, -0.0144, -0.0845], "rotation": [-0.5934, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "abdomen", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticle", "materialLayers": ["cuticle"], "deformations": [], "joints": [], "seams": [{"id": "waist-seam", "note": "Abdomen overlaps the thorax by embedDepth; never leave a visible gap."}], "localFeatures": [{"id": "revolved-profile-table", "profileHalfWidthNormalised": {"0.10": 0.522, "0.20": 0.53, "0.30": 0.547, "0.40": 0.821, "0.475": 1.0, "0.55": 0.94, "0.70": 0.889, "0.85": 0.667, "0.95": 0.427, "1.00": 0.231}, "note": "Fractions of the maximum half-width (58.5 px). Feed these straight into the lathe profile."}, {"id": "band-material-groups", "bands": [{"tone": "dark", "t": [0.0, 0.233]}, {"tone": "mid", "t": [0.238, 0.392]}, {"tone": "dark", "t": [0.396, 0.462]}, {"tone": "mid", "t": [0.467, 0.674]}, {"tone": "dark", "t": [0.678, 0.744]}, {"tone": "mid", "t": [0.749, 0.898]}, {"tone": "dark", "t": [0.903, 1.0]}], "note": "Bands are PER-TRIANGLE MATERIAL GROUPS on the lathe, assigned by ring index - the same technique splitCoatGroups uses for the beagle's tricolor coat. NOT separate meshes and NOT a texture. The lathe is generated ring by ring, so a band boundary lands exactly on the measured t."}, {"id": "abdomen-crease-bands", "description": "Two narrow interior dark creases at t=0.40-0.46 and t=0.68-0.74 along the abdomen axis, each ~0.07 of length, plus a dark base (t<0.23) and dark tip (t>0.90). Four mid-tone segments between them.", "identityRank": 4, "confidence": 0.95, "evidenceRefs": ["tone run-length along the abdomen axis, bands.py"]}, {"id": "waist-pinch", "description": "The abdomen leaves the thorax through a 6.5:1 pinch - measured half-width 9 px at t=0 against a 58.5 px maximum.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["perpendicular half-width profile, bands.py"]}, {"id": "abdomen-tip-taper", "description": "The abdomen tapers to a ROUNDED POINT (half-width 13.5 px at t=1.0), not a hemispherical cap.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["half-width profile tail 39.0 -> 25.0 -> 13.5"]}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md#layer-7", "evidence/anatomy.json#masses.abdomen", "evidence/bands.py"], "details": ["abdomen-crease-bands", "waist-pinch", "abdomen-tip-taper"], "fidelityTier": "identity-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(99, 64, 36, 1.0)", "secondaryAlbedo": "rgba(142, 95, 67, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}, "pivotNote": "Rotated by the 'waistPivot' entry in rig.pivots. The generator emits a pivot Group per component, so this spec carries no transform-only components of its own - they were emitted as real unit boxes that swallowed the model."};
  node_abdomen_3.userData.actionProfile = {"animationRole": "abdomen", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["thorax"] ?? root).add(node_abdomen_3);
  nodes["abdomen"] = node_abdomen_3;
  const mesh_abdomen_3Geometry = endpoint_abdomen_3
    ? new THREE.CylinderGeometry(endpoint_abdomen_3.endRadius, endpoint_abdomen_3.baseRadius, endpoint_abdomen_3.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_abdomen_3) {
    mesh_abdomen_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_abdomen_3 = new THREE.Mesh(
    mesh_abdomen_3Geometry,
    materialMap["cuticle"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_abdomen_3.name = "Abdomen";
  if (endpoint_abdomen_3) {
    mesh_abdomen_3.position.copy(endpoint_abdomen_3.midpoint);
    mesh_abdomen_3.quaternion.copy(endpoint_abdomen_3.quaternion);
  }
  mesh_abdomen_3.castShadow = options.castShadow ?? true;
  mesh_abdomen_3.receiveShadow = options.receiveShadow ?? true;
  mesh_abdomen_3.userData.sculptComponent = {"id": "abdomen", "name": "Abdomen", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A REVOLVED PROFILE reproducing the measured perpendicular half-width table, not a stretched capsule and not an ellipsoid: pinched to a 6.5:1 waist, swelling to its maximum just PAST mid-length (t = 0.475), then tapering to a rounded point. The local corpus's top hit recommends exactly this ('parts generated by revolving a 2D profile about an axis').", "geometryDescriptor": {"topologyIntent": "stylised cel-shaded character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thorax", "attachment": {"parentSocket": "thorax-socket", "localStart": [0, 0, 0], "localEnd": [0.0, -0.3268, -0.2204], "contactType": "socket-joint", "baseRadius": 0.0162, "endRadius": 0.1013, "embedDepth": 0.0216, "gapTolerance": 0.01, "evidenceRefs": ["evidence/image-analysis.md#layer-4"], "parentId": "thorax", "overlap": 0.0216}, "dimensions": {"width": 0.2026, "height": 0.3942, "depth": 0.2026, "units": "world", "confidence": 0.95}, "transform": {"position": [0.0, -0.0144, -0.0845], "rotation": [-0.5934, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "abdomen", "pivot": {"mode": "root", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticle", "materialLayers": ["cuticle"], "deformations": [], "joints": [], "seams": [{"id": "waist-seam", "note": "Abdomen overlaps the thorax by embedDepth; never leave a visible gap."}], "localFeatures": [{"id": "revolved-profile-table", "profileHalfWidthNormalised": {"0.10": 0.522, "0.20": 0.53, "0.30": 0.547, "0.40": 0.821, "0.475": 1.0, "0.55": 0.94, "0.70": 0.889, "0.85": 0.667, "0.95": 0.427, "1.00": 0.231}, "note": "Fractions of the maximum half-width (58.5 px). Feed these straight into the lathe profile."}, {"id": "band-material-groups", "bands": [{"tone": "dark", "t": [0.0, 0.233]}, {"tone": "mid", "t": [0.238, 0.392]}, {"tone": "dark", "t": [0.396, 0.462]}, {"tone": "mid", "t": [0.467, 0.674]}, {"tone": "dark", "t": [0.678, 0.744]}, {"tone": "mid", "t": [0.749, 0.898]}, {"tone": "dark", "t": [0.903, 1.0]}], "note": "Bands are PER-TRIANGLE MATERIAL GROUPS on the lathe, assigned by ring index - the same technique splitCoatGroups uses for the beagle's tricolor coat. NOT separate meshes and NOT a texture. The lathe is generated ring by ring, so a band boundary lands exactly on the measured t."}, {"id": "abdomen-crease-bands", "description": "Two narrow interior dark creases at t=0.40-0.46 and t=0.68-0.74 along the abdomen axis, each ~0.07 of length, plus a dark base (t<0.23) and dark tip (t>0.90). Four mid-tone segments between them.", "identityRank": 4, "confidence": 0.95, "evidenceRefs": ["tone run-length along the abdomen axis, bands.py"]}, {"id": "waist-pinch", "description": "The abdomen leaves the thorax through a 6.5:1 pinch - measured half-width 9 px at t=0 against a 58.5 px maximum.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["perpendicular half-width profile, bands.py"]}, {"id": "abdomen-tip-taper", "description": "The abdomen tapers to a ROUNDED POINT (half-width 13.5 px at t=1.0), not a hemispherical cap.", "identityRank": 3, "confidence": 0.9, "evidenceRefs": ["half-width profile tail 39.0 -> 25.0 -> 13.5"]}], "surfaceDetail": {"macro": "flat toon band", "meso": "none", "micro": "none", "note": "The reference is flat vector fill; there is no surface microstructure to reproduce."}, "evidenceRefs": ["evidence/image-analysis.md#layer-7", "evidence/anatomy.json#masses.abdomen", "evidence/bands.py"], "details": ["abdomen-crease-bands", "waist-pinch", "abdomen-tip-taper"], "fidelityTier": "identity-critical", "colorMaterialRecipe": {"dominantAlbedo": "rgba(99, 64, 36, 1.0)", "secondaryAlbedo": "rgba(142, 95, 67, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.9, "finish": "matte-to-satin flat toon band", "evidenceRefs": ["palette-scan"], "note": "Named tone, hand-authored. At runtime the body materials take the TEAM COLOUR - every enemy skin is make<Name>(color) - so this hue names the value relationship, not the shipped colour."}, "pivotNote": "Rotated by the 'waistPivot' entry in rig.pivots. The generator emits a pivot Group per component, so this spec carries no transform-only components of its own - they were emitted as real unit boxes that swallowed the model."};
  node_abdomen_3.add(mesh_abdomen_3);
  meshes["abdomen"] = mesh_abdomen_3;
  colliders["abdomen"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this project"};

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is ALREADY cel-shaded - hard-edged flat fills over a three-step value ladder - so the ramp reproduces it rather than approximating it.", "palette": ["#634024", "#3F2411", "#8E5F43", "#2D2727", "#595959", "#FAF8E1", "#000000"], "paletteNote": "Measured modal tones. These NAME the value relationships; at runtime the body takes the team colour, so the shipped hues differ.", "responseTargets": ["thorax reads glossier than cuticle", "membrane reads smoothest and translucent", "limbs read matte and darkest"]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createCartoonMosquitoLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Cartoon Mosquito look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "role": "key", "directionHint": "from the upper front-left of the subject, roughly 35 degrees above the horizon", "evidence": "Inferred from the reference's tone assignment, not from a measured highlight: the lighter cuticle step (#8E5F43) sits on the upper-left of the abdomen and the thorax's specular patch sits on its upper-front quadrant. Flat vector art has no real light, so this is a reading of where the illustrator placed the light, at low confidence.", "confidence": 0.55, "targetProject": "NOT authored into the model. Beagle Chomp's scene already carries its own key, fill and hemisphere lighting; this skin must read correctly under those. The lighting-pass acceptance is 'no new lights added'."}, {"id": "fill", "type": "hemisphere", "role": "fill", "directionHint": "ambient, from above", "evidence": "The reference's shadow step (#3F2411) is a hue-consistent darkening rather than a cool shadow, which reads as flat ambient fill with no coloured bounce.", "confidence": 0.6, "targetProject": "Supplied by the existing scene."}, {"id": "rim", "type": "none", "role": "rim", "directionHint": "absent", "evidence": "There is NO rim or backlight in the reference: no lighter edge anywhere along the silhouette. Recorded as an explicit absence so the build does not add one - a rim would also fight the project's cel-shading, where the ramp quantises an edge highlight into the band beside it.", "confidence": 0.8, "targetProject": "Not added."}, {"id": "contact-shadow", "type": "none", "role": "contact", "directionHint": "absent", "evidence": "The subject floats on an opaque white ground with no cast or contact shadow, consistent with the hovering pose.", "confidence": 0.9, "targetProject": "The game supplies its own shadows. Wings must be EXCLUDED from shadow casting: a translucent blade throws a hard black shadow - the rule the shipped bee records."}];
  lights.userData.lookDevTargets = {"shadingModel": "cel / toon", "shadingModelNote": "MeshToonMaterial on one shared 3-step gradient ramp, renderer at NoToneMapping. The reference is ALREADY cel-shaded - hard-edged flat fills over a three-step value ladder - so the ramp reproduces it rather than approximating it.", "palette": ["#634024", "#3F2411", "#8E5F43", "#2D2727", "#595959", "#FAF8E1", "#000000"], "paletteNote": "Measured modal tones. These NAME the value relationships; at runtime the body takes the team colour, so the shipped hues differ.", "responseTargets": ["thorax reads glossier than cuticle", "membrane reads smoothest and translucent", "limbs read matte and darkest"]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCartoonMosquitoEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameCartoonMosquitoCamera(
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
export function createCartoonMosquitoPresentationComposer(
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

export function configureCartoonMosquitoRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createCartoonMosquitoInspectControls(
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
