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

// Paint declared colour regions into the vertex-colour attribute.
//
// WHY VERTEX COLOUR AND NOT A TEXTURE. A subject whose identity is a set of flat colour regions
// with hard boundaries -- a blaze, a bib, a sock, a livery stripe -- needs those boundaries placed
// to a measured position. This pipeline emits code and no image assets, so a texture is not
// available to place them with; a single root-to-tip ramp cannot express a shaped region. Per-
// vertex colour driven by a declared shape is the remaining honest representation, and it is the
// one the boundary gate can measure BEFORE a browser is involved.
//
// The maths here is a transcription of forge/_shared/vertex_paint.py, and
// forge/tests/test_vertex_paint.py holds the two to the same numbers on a fixture. Editing one
// side without the other turns a gated boundary into an ungated one, which is exactly the failure
// the shared implementation exists to prevent.
//
// Regions are evaluated in the component's own local space AFTER its real dimensions have been
// applied to the vertex data, so every coordinate below is in the same units as the component's
// measured dimensions rather than in a unit cube.
type VertexPaintRegion = {
  id: string;
  kind: 'axis-band' | 'ellipsoid' | 'tapered-capsule';
  color: string;
  softness: number;
  axis?: 'x' | 'y' | 'z';
  min?: number;
  max?: number;
  center?: [number, number, number];
  radii?: [number, number, number];
  start?: [number, number, number];
  end?: [number, number, number];
  startRadius?: number;
  endRadius?: number;
};

function vertexPaintSmoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge1 ? 0 : 1;
  let t = (value - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function vertexPaintSignedDistance(
  region: VertexPaintRegion,
  x: number,
  y: number,
  z: number,
): number {
  if (region.kind === 'axis-band') {
    const value = region.axis === 'x' ? x : region.axis === 'z' ? z : y;
    const low = region.min as number;
    const high = region.max as number;
    if (value < low) return low - value;
    if (value > high) return value - high;
    return -Math.min(value - low, high - value);
  }
  if (region.kind === 'ellipsoid') {
    const [cx, cy, cz] = region.center as [number, number, number];
    const [rx, ry, rz] = region.radii as [number, number, number];
    const q = Math.sqrt(
      ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2,
    );
    return (q - 1) * Math.min(rx, ry, rz);
  }
  const [ax, ay, az] = region.start as [number, number, number];
  const [bx, by, bz] = region.end as [number, number, number];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const denominator = abx * abx + aby * aby + abz * abz;
  let t = denominator > 0
    ? ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / denominator
    : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const distance = Math.sqrt(
    (x - (ax + abx * t)) ** 2 + (y - (ay + aby * t)) ** 2 + (z - (az + abz * t)) ** 2,
  );
  const startRadius = region.startRadius as number;
  const endRadius = region.endRadius as number;
  return distance - (startRadius + (endRadius - startRadius) * t);
}

function vertexPaintWeight(region: VertexPaintRegion, x: number, y: number, z: number): number {
  const distance = vertexPaintSignedDistance(region, x, y, z);
  if (region.softness <= 0) return distance <= 0 ? 1 : 0;
  return 1 - vertexPaintSmoothstep(-region.softness * 0.5, region.softness * 0.5, distance);
}

function applyVertexPaint(
  geometry: THREE.BufferGeometry,
  baseColor: string,
  regions: VertexPaintRegion[],
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const values = new Float32Array(position.count * 3);
  const base = new THREE.Color(baseColor);
  const target = new THREE.Color();
  const mixed = new THREE.Color();
  const regionColors = regions.map((region) => new THREE.Color(region.color));

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    mixed.copy(base);
    for (let r = 0; r < regions.length; r += 1) {
      const weight = vertexPaintWeight(regions[r], x, y, z);
      if (weight <= 0) continue;
      target.copy(regionColors[r]);
      mixed.lerp(target, weight);
    }
    values[i * 3] = mixed.r;
    values[i * 3 + 1] = mixed.g;
    values[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean },
): THREE.BufferGeometry {
  const stations = sweep.stations;
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
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

// Generated from ObjectSculptSpec target: Beagle Puppy Toon Character
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createBeaglePuppyToonCharacterModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Beagle Puppy Toon Character";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "Projection route declined (see evidence/projection-route.md): stylized vertex-region build, no texture projection. Reference framing ~35mm-equivalent 3/4 view used for comparison sheets only."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["coat"] = createSculptMaterial(
    "coat",
    {"id": "coat", "name": "Tricolor coat (vertex regions)", "type": "toon", "shaderModel": "MeshToonMaterial via project toon() factory — shared 3-step ramp, NoToneMapping; PBR channels below describe the reference's response, quantized by the ramp at runtime", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#f2e9d8", "secondary": ["#c1702f", "#362426", "#965031"]}, "colorVariation": {"palette": ["#f2e9d8", "#c1702f", "#362426", "#965031"], "pattern": "flat-zones-with-jagged-boundaries", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.9, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "toon ramp carries shading; no baked AO"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "coat-blaze", "description": "white blaze up the face center: 0.18 HH wide at brow, widening into the full white muzzle; jagged edges; orange fields both sides", "region": "head front centerline", "channelDeltas": {"albedo": "#f2e9d8"}, "evidenceRef": "see detailInventory:coat-blaze"}, {"id": "coat-saddle", "description": "dark saddle from behind the shoulders to above the tail root, dipping down the flanks; jagged lower boundary against orange", "region": "torso back + upper flanks", "channelDeltas": {"albedo": "#362426"}, "evidenceRef": "see detailInventory:coat-saddle"}, {"id": "coat-socks", "description": "white socks on all four lower legs, jagged tops; front legs white higher than hinds", "region": "legs below mid-height", "channelDeltas": {"albedo": "#f2e9d8"}, "evidenceRef": "see detailInventory:coat-socks"}, {"id": "coat-tail-tip", "description": "white tail tip, upper ~1/3 of the tail; shaft dark; jagged boundary", "region": "tail upper third", "channelDeltas": {"albedo": "#f2e9d8"}, "evidenceRef": "see detailInventory:coat-tail-tip"}, {"id": "coat-bib", "description": "white chest/bib and belly; jagged boundary against orange shoulder and dark flank", "region": "chest front + underside", "channelDeltas": {"albedo": "#f2e9d8"}, "evidenceRef": "see detailInventory:coat-bib"}, {"id": "ear-inner", "description": "inner/front face of each ear warmer deeper orange than outer face", "region": "ear inner faces", "channelDeltas": {"albedo": "#965031"}, "evidenceRef": "see detailInventory:ear-inner"}, {"id": "fur-striation-note", "description": "reference shows directional fur striations on all coat surfaces; DELIBERATELY not reproduced (aliases to noise at the ~40px game camera); accepted stylization delta", "region": "all coat surfaces", "channelDeltas": {}, "evidenceRef": "see detailInventory:fur-striation-note"}], "shaderNotes": ["Build with toon({...}) from src/render/toon.ts; roughness/metalness do not exist on MeshToonMaterial — recorded here as reference intent only.", "Coat zone colors are painted per-vertex; material color stays WHITE so vertex colors carry the albedo (multiplicative rule).", "Material color WHITE: vertex-region paint carries the albedo (multiplicative rule; same discipline as the wall/floor textures)."], "textureless": {"declared": true, "evidence": ["derived/crop-fur-saddle.png, crop-fur-orange-haunch.png, crop-fur-white-chest.png: flat colour fields with toon shading bands; no grain/print/pores — identity is silhouette + the jagged boundaries between the three coat zones", "game renders characters with MeshToonMaterial on a 3-step ramp at ~40px; fur striations in the reference alias to noise at that size (accepted stylization delta, see detailInventory fur-striations)"]}, "evidenceNote": "palette from analyze_texture on crop-fur-saddle/-orange-haunch/-white-chest/-ear-near/-tail (material-evidence/*.json); albedo read from mid-lit bands per de-light discipline"},
    options
  );
  materialMap["nose-mat"] = createSculptMaterial(
    "nose-mat",
    {"id": "nose-mat", "name": "Nose leather", "type": "toon", "shaderModel": "MeshToonMaterial via project toon() factory — shared 3-step ramp, NoToneMapping; PBR channels below describe the reference's response, quantized by the ramp at runtime", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#4a3028", "secondary": ["#6b5140"]}, "colorVariation": {"palette": ["#4a3028", "#6b5140"], "pattern": "flat-zones-with-jagged-boundaries", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.35, "variation": 0.15}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "toon ramp carries shading; no baked AO"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "nose-gloss", "description": "satin-gloss highlight band across the top of the bulb — lower roughness than fur; on toon this is a lighter albedo band or small gloss mesh, not a PBR roughness map", "region": "nose top", "channelDeltas": {"albedo": "#6b5140"}, "evidenceRef": "see detailInventory:nose-gloss"}], "shaderNotes": ["Build with toon({...}) from src/render/toon.ts; roughness/metalness do not exist on MeshToonMaterial — recorded here as reference intent only.", "Coat zone colors are painted per-vertex; material color stays WHITE so vertex colors carry the albedo (multiplicative rule).", "Material color WHITE: vertex-region paint carries the albedo (multiplicative rule; same discipline as the wall/floor textures)."], "textureless": {"declared": true, "evidence": ["derived/crop-nose.png: smooth flat-shaded bulb; only feature is a broad gloss band, represented as a lighter albedo band / gloss mesh, not a map"]}, "evidenceNote": "crop-nose palette #5B342C..#2C1D22"},
    options
  );
  materialMap["eye-mat"] = createSculptMaterial(
    "eye-mat",
    {"id": "eye-mat", "name": "Eye (iris+pupil)", "type": "toon", "shaderModel": "MeshToonMaterial via project toon() factory — shared 3-step ramp, NoToneMapping; PBR channels below describe the reference's response, quantized by the ramp at runtime", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#1d120c", "secondary": ["#552a19"]}, "colorVariation": {"palette": ["#1d120c", "#552a19"], "pattern": "flat-zones-with-jagged-boundaries", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.15, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "toon ramp carries shading; no baked AO"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "iris-ring", "description": "amber-brown iris ring around the merged dark pupil", "region": "eye front", "channelDeltas": {"albedo": "#5a3a22"}, "evidenceRef": "see detailInventory:iris-ring"}], "shaderNotes": ["Gloss sphere; iris ring painted per-vertex or as a shallow front disc; dark rim keyline at the perimeter.", "Material color WHITE: vertex-region paint carries the albedo (multiplicative rule; same discipline as the wall/floor textures)."], "textureless": {"declared": true, "evidence": ["derived/crop-eye-near.png: flat iris ring + pupil + keyline rim; no texture detail"]}, "evidenceNote": "crop-eye-near palette; iris #552A19 ring"},
    options
  );
  materialMap["catchlight-mat"] = createSculptMaterial(
    "catchlight-mat",
    {"id": "catchlight-mat", "name": "Eye catchlight (unlit)", "type": "basic", "shaderModel": "MeshBasicMaterial — the project's one deliberate unlit exception; a toon ramp quantizes a highlight into the same band as the surroundings and it stops reading as a catchlight", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#ffffff", "secondary": []}, "colorVariation": {"palette": ["#ffffff"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.0, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "toon ramp carries all shading; no baked AO by design"}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Small white disc/sphere slightly proud of the cornea, upper-outer quadrant + micro secondary glint."], "textureless": {"declared": true, "evidence": ["derived/crop-eye-near.png: single flat white dot, unlit by design"]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 1.0, "confidence": 1.0, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Pivot-only node; whole-character transform (game moves/turns the beagle by this).", "geometryDescriptor": {"topologyIntent": "stylized toon character part — no geometry of its own", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.005, "height": 0.005, "depth": 0.005, "units": "world (1 unit = 1 maze tile)", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.005, 0.005, 0.005]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "pivot only; recipe mirrors coat — flat toon zones, jagged boundaries; evidence: derived crops"}};
  node_root_0.userData.actionProfile = {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.005, 0.005, 0.005);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 1.0, "confidence": 1.0, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Pivot-only node; whole-character transform (game moves/turns the beagle by this).", "geometryDescriptor": {"topologyIntent": "stylized toon character part — no geometry of its own", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.005, "height": 0.005, "depth": 0.005, "units": "world (1 unit = 1 maze tile)", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.005, 0.005, 0.005]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "pivot only; recipe mirrors coat — flat toon zones, jagged boundaries; evidence: derived crops"}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_torso_1 = makeAttachmentEndpoint(null);
  const node_torso_1 = new THREE.Group();
  node_torso_1.name = "Torso__pivot";
  node_torso_1.scale.set(1, 1, 1);
  if (endpoint_torso_1) {
    node_torso_1.position.copy(endpoint_torso_1.start);
    node_torso_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_torso_1.position.set(0.0, 0.37, -0.22);
    node_torso_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_torso_1.userData.sculptComponent = {"id": "torso", "name": "Torso", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Barrel torso swept rump->chest with per-station elliptical sections: chest deeper than rump (tuck-up), rounded caps; one continuous organic mass.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, 0.0], "rx": 0.03, "rz": 0.035, "twist": 0.0}, {"position": [0, 0.022, 0.018], "rx": 0.062, "rz": 0.07, "twist": 0.0}, {"position": [0, 0.025, 0.045], "rx": 0.088, "rz": 0.098, "twist": 0.0}, {"position": [0, 0.028, 0.15], "rx": 0.105, "rz": 0.118, "twist": 0.0}, {"position": [0, 0.03, 0.3], "rx": 0.112, "rz": 0.135, "twist": 0.0}, {"position": [0, 0.03, 0.395], "rx": 0.106, "rz": 0.128, "twist": 0.0}, {"position": [0, 0.029, 0.425], "rx": 0.088, "rz": 0.105, "twist": 0.0}, {"position": [0, 0.028, 0.44], "rx": 0.045, "rz": 0.055, "twist": 0.0}], "radialSegments": 16, "capEnds": true}}, "parent": "root", "attachment": {"parentSocket": "root.origin", "localStart": [0, 0.37, -0.22], "localEnd": [0, 0.39, 0.22], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.11, "endRadius": 0.135, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.225, "height": 0.255, "depth": 0.435, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.37, -0.22], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "breathe-scale", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "torso.chestDepth", "kind": "form", "description": "chest section 15% deeper than rump section; belly line rises toward the rear (tuck-up)", "region": "lower torso profile", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right", "anatomy-measurements"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(54, 36, 38, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange flanks/shoulders/haunches, dark saddle over back, white bib+belly — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "saddle", "kind": "tapered-capsule", "color": "#362426", "start": [0, 0.125, 0.02], "end": [0, 0.12, 0.29], "startRadius": 0.105, "endRadius": 0.092, "softness": 0.018}, {"id": "bib", "kind": "tapered-capsule", "color": "#f2e9d8", "start": [0, -0.01, 0.36], "end": [0, -0.09, 0.49], "startRadius": 0.09, "endRadius": 0.11, "softness": 0.02}, {"id": "belly", "kind": "ellipsoid", "color": "#f2e9d8", "center": [0, -0.12, 0.2], "radii": [0.09, 0.08, 0.19], "softness": 0.025}]}};
  node_torso_1.userData.actionProfile = {"animationRole": "breathe-scale", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["root"] ?? root).add(node_torso_1);
  nodes["torso"] = node_torso_1;
  const mesh_torso_1Geometry = endpoint_torso_1
    ? new THREE.CylinderGeometry(endpoint_torso_1.endRadius, endpoint_torso_1.baseRadius, endpoint_torso_1.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.02, 0.0], "rx": 0.03, "rz": 0.035, "twist": 0.0}, {"position": [0, 0.022, 0.018], "rx": 0.062, "rz": 0.07, "twist": 0.0}, {"position": [0, 0.025, 0.045], "rx": 0.088, "rz": 0.098, "twist": 0.0}, {"position": [0, 0.028, 0.15], "rx": 0.105, "rz": 0.118, "twist": 0.0}, {"position": [0, 0.03, 0.3], "rx": 0.112, "rz": 0.135, "twist": 0.0}, {"position": [0, 0.03, 0.395], "rx": 0.106, "rz": 0.128, "twist": 0.0}, {"position": [0, 0.029, 0.425], "rx": 0.088, "rz": 0.105, "twist": 0.0}, {"position": [0, 0.028, 0.44], "rx": 0.045, "rz": 0.055, "twist": 0.0}], "radialSegments": 16, "capEnds": true});
  if (!endpoint_torso_1) {
    mesh_torso_1Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_torso_1Geometry, "#c1702f", [{"id": "saddle", "kind": "tapered-capsule", "color": "#362426", "softness": 0.018, "start": [0.0, 0.125, 0.02], "end": [0.0, 0.12, 0.29], "startRadius": 0.105, "endRadius": 0.092}, {"id": "bib", "kind": "tapered-capsule", "color": "#f2e9d8", "softness": 0.02, "start": [0.0, -0.01, 0.36], "end": [0.0, -0.09, 0.49], "startRadius": 0.09, "endRadius": 0.11}, {"id": "belly", "kind": "ellipsoid", "color": "#f2e9d8", "softness": 0.025, "center": [0.0, -0.12, 0.2], "radii": [0.09, 0.08, 0.19]}]);
  const mesh_torso_1 = new THREE.Mesh(
    mesh_torso_1Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_torso_1.name = "Torso";
  mesh_torso_1.material = mesh_torso_1.material.clone();
  mesh_torso_1.material.vertexColors = true;
  (mesh_torso_1.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_torso_1) {
    mesh_torso_1.position.copy(endpoint_torso_1.midpoint);
    mesh_torso_1.quaternion.copy(endpoint_torso_1.quaternion);
  }
  mesh_torso_1.castShadow = options.castShadow ?? true;
  mesh_torso_1.receiveShadow = options.receiveShadow ?? true;
  mesh_torso_1.userData.sculptComponent = {"id": "torso", "name": "Torso", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Barrel torso swept rump->chest with per-station elliptical sections: chest deeper than rump (tuck-up), rounded caps; one continuous organic mass.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, 0.0], "rx": 0.03, "rz": 0.035, "twist": 0.0}, {"position": [0, 0.022, 0.018], "rx": 0.062, "rz": 0.07, "twist": 0.0}, {"position": [0, 0.025, 0.045], "rx": 0.088, "rz": 0.098, "twist": 0.0}, {"position": [0, 0.028, 0.15], "rx": 0.105, "rz": 0.118, "twist": 0.0}, {"position": [0, 0.03, 0.3], "rx": 0.112, "rz": 0.135, "twist": 0.0}, {"position": [0, 0.03, 0.395], "rx": 0.106, "rz": 0.128, "twist": 0.0}, {"position": [0, 0.029, 0.425], "rx": 0.088, "rz": 0.105, "twist": 0.0}, {"position": [0, 0.028, 0.44], "rx": 0.045, "rz": 0.055, "twist": 0.0}], "radialSegments": 16, "capEnds": true}}, "parent": "root", "attachment": {"parentSocket": "root.origin", "localStart": [0, 0.37, -0.22], "localEnd": [0, 0.39, 0.22], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.11, "endRadius": 0.135, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.225, "height": 0.255, "depth": 0.435, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.37, -0.22], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "breathe-scale", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "torso.chestDepth", "kind": "form", "description": "chest section 15% deeper than rump section; belly line rises toward the rear (tuck-up)", "region": "lower torso profile", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right", "anatomy-measurements"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(54, 36, 38, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange flanks/shoulders/haunches, dark saddle over back, white bib+belly — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "saddle", "kind": "tapered-capsule", "color": "#362426", "start": [0, 0.125, 0.02], "end": [0, 0.12, 0.29], "startRadius": 0.105, "endRadius": 0.092, "softness": 0.018}, {"id": "bib", "kind": "tapered-capsule", "color": "#f2e9d8", "start": [0, -0.01, 0.36], "end": [0, -0.09, 0.49], "startRadius": 0.09, "endRadius": 0.11, "softness": 0.02}, {"id": "belly", "kind": "ellipsoid", "color": "#f2e9d8", "center": [0, -0.12, 0.2], "radii": [0.09, 0.08, 0.19], "softness": 0.025}]}};
  node_torso_1.add(mesh_torso_1);
  meshes["torso"] = mesh_torso_1;
  colliders["torso"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["torso"] ??= [];
  destructionGroups["torso"].push(node_torso_1);

  const endpoint_neck_2 = makeAttachmentEndpoint(null);
  const node_neck_2 = new THREE.Group();
  node_neck_2.name = "Neck__pivot";
  node_neck_2.scale.set(1, 1, 1);
  if (endpoint_neck_2) {
    node_neck_2.position.copy(endpoint_neck_2.start);
    node_neck_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_2.position.set(0.0, 0.16, 0.365);
    node_neck_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_2.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Short truncated-cone blend between chest top and skull; 0.15 HH long — chin sits nearly on the chest.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.44, -0.1], [0.42, 0.2], [0.46, 0.5]], "segments": 16}}, "parent": "torso", "attachment": {"parentSocket": "torso.front-top", "localStart": [0, 0.16, 0.365], "localEnd": [0, 0.22, 0.375], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.075, "endRadius": 0.07, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.14, "height": 0.12, "depth": 0.14, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.16, 0.365], "rotation": [0, 0, 0], "scale": [0.14, 0.12, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white throat into orange nape — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "nape-orange", "kind": "axis-band", "color": "#c1702f", "axis": "z", "min": -0.09, "max": -0.022, "softness": 0.02}]}};
  node_neck_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["torso"] ?? root).add(node_neck_2);
  nodes["neck"] = node_neck_2;
  const mesh_neck_2Geometry = endpoint_neck_2
    ? new THREE.CylinderGeometry(endpoint_neck_2.endRadius, endpoint_neck_2.baseRadius, endpoint_neck_2.length, 16, 6)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.44, -0.1], [0.42, 0.2], [0.46, 0.5]], "segments": 16});
  if (!endpoint_neck_2) {
    mesh_neck_2Geometry.scale(0.14, 0.12, 0.14);
  }
  applyVertexPaint(mesh_neck_2Geometry, "#f2e9d8", [{"id": "nape-orange", "kind": "axis-band", "color": "#c1702f", "softness": 0.02, "axis": "z", "min": -0.09, "max": -0.022}]);
  const mesh_neck_2 = new THREE.Mesh(
    mesh_neck_2Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_2.name = "Neck";
  mesh_neck_2.material = mesh_neck_2.material.clone();
  mesh_neck_2.material.vertexColors = true;
  (mesh_neck_2.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_neck_2) {
    mesh_neck_2.position.copy(endpoint_neck_2.midpoint);
    mesh_neck_2.quaternion.copy(endpoint_neck_2.quaternion);
  }
  mesh_neck_2.castShadow = options.castShadow ?? true;
  mesh_neck_2.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_2.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "macro", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Short truncated-cone blend between chest top and skull; 0.15 HH long — chin sits nearly on the chest.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.44, -0.1], [0.42, 0.2], [0.46, 0.5]], "segments": 16}}, "parent": "torso", "attachment": {"parentSocket": "torso.front-top", "localStart": [0, 0.16, 0.365], "localEnd": [0, 0.22, 0.375], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.075, "endRadius": 0.07, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.14, "height": 0.12, "depth": 0.14, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.16, 0.365], "rotation": [0, 0, 0], "scale": [0.14, 0.12, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white throat into orange nape — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "nape-orange", "kind": "axis-band", "color": "#c1702f", "axis": "z", "min": -0.09, "max": -0.022, "softness": 0.02}]}};
  node_neck_2.add(mesh_neck_2);
  meshes["neck"] = mesh_neck_2;
  colliders["neck"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_2);

  const endpoint_head_3 = makeAttachmentEndpoint(null);
  const node_head_3 = new THREE.Group();
  node_head_3.name = "Head (skull)__pivot";
  node_head_3.scale.set(1, 1, 1);
  if (endpoint_head_3) {
    node_head_3.position.copy(endpoint_head_3.start);
    node_head_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_3.position.set(0.0, 0.17, 0.015);
    node_head_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_3.userData.sculptComponent = {"id": "head", "name": "Head (skull)", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Large near-spherical skull dome (puppy stylization, head ~1/3 of standing height); slightly wider than deep; brow swells over the eye sockets.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 24}}, "parent": "neck", "attachment": {"parentSocket": "neck.top", "localStart": [0, 0.17, 0.015], "localEnd": [0, 0.3, 0.015], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.12, "endRadius": 0.1, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.285, "height": 0.27, "depth": 0.27, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.17, 0.015], "rotation": [0, 0, 0], "scale": [0.285, 0.27, 0.27]}, "actionProfile": {"animationRole": "look-pivot", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "head.browRidges", "kind": "form", "description": "soft brow swells above each eye socket, faint furrow grooves; with the heavy upper lid gives the worried-puppy expression", "region": "above eye sockets", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-head", "anatomy-measurements"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange crown/cheeks/eye fields, white blaze up center — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "blaze", "kind": "tapered-capsule", "color": "#f2e9d8", "start": [0, -0.06, 0.15], "end": [0, 0.14, 0.055], "startRadius": 0.048, "endRadius": 0.028, "softness": 0.01}, {"id": "jaw-white", "kind": "ellipsoid", "color": "#f2e9d8", "center": [0, -0.125, 0.05], "radii": [0.085, 0.05, 0.1], "softness": 0.02}]}};
  node_head_3.userData.actionProfile = {"animationRole": "look-pivot", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["neck"] ?? root).add(node_head_3);
  nodes["head"] = node_head_3;
  const mesh_head_3Geometry = endpoint_head_3
    ? new THREE.CylinderGeometry(endpoint_head_3.endRadius, endpoint_head_3.baseRadius, endpoint_head_3.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 24});
  if (!endpoint_head_3) {
    mesh_head_3Geometry.scale(0.285, 0.27, 0.27);
  }
  applyVertexPaint(mesh_head_3Geometry, "#c1702f", [{"id": "blaze", "kind": "tapered-capsule", "color": "#f2e9d8", "softness": 0.01, "start": [0.0, -0.06, 0.15], "end": [0.0, 0.14, 0.055], "startRadius": 0.048, "endRadius": 0.028}, {"id": "jaw-white", "kind": "ellipsoid", "color": "#f2e9d8", "softness": 0.02, "center": [0.0, -0.125, 0.05], "radii": [0.085, 0.05, 0.1]}]);
  const mesh_head_3 = new THREE.Mesh(
    mesh_head_3Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_3.name = "Head (skull)";
  mesh_head_3.material = mesh_head_3.material.clone();
  mesh_head_3.material.vertexColors = true;
  (mesh_head_3.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_head_3) {
    mesh_head_3.position.copy(endpoint_head_3.midpoint);
    mesh_head_3.quaternion.copy(endpoint_head_3.quaternion);
  }
  mesh_head_3.castShadow = options.castShadow ?? true;
  mesh_head_3.receiveShadow = options.receiveShadow ?? true;
  mesh_head_3.userData.sculptComponent = {"id": "head", "name": "Head (skull)", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Large near-spherical skull dome (puppy stylization, head ~1/3 of standing height); slightly wider than deep; brow swells over the eye sockets.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 24}}, "parent": "neck", "attachment": {"parentSocket": "neck.top", "localStart": [0, 0.17, 0.015], "localEnd": [0, 0.3, 0.015], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.12, "endRadius": 0.1, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.285, "height": 0.27, "depth": 0.27, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.17, 0.015], "rotation": [0, 0, 0], "scale": [0.285, 0.27, 0.27]}, "actionProfile": {"animationRole": "look-pivot", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "head.browRidges", "kind": "form", "description": "soft brow swells above each eye socket, faint furrow grooves; with the heavy upper lid gives the worried-puppy expression", "region": "above eye sockets", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-head", "anatomy-measurements"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange crown/cheeks/eye fields, white blaze up center — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "blaze", "kind": "tapered-capsule", "color": "#f2e9d8", "start": [0, -0.06, 0.15], "end": [0, 0.14, 0.055], "startRadius": 0.048, "endRadius": 0.028, "softness": 0.01}, {"id": "jaw-white", "kind": "ellipsoid", "color": "#f2e9d8", "center": [0, -0.125, 0.05], "radii": [0.085, 0.05, 0.1], "softness": 0.02}]}};
  node_head_3.add(mesh_head_3);
  meshes["head"] = mesh_head_3;
  colliders["head"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_3);

  const endpoint_muzzle_4 = makeAttachmentEndpoint(null);
  const node_muzzle_4 = new THREE.Group();
  node_muzzle_4.name = "Muzzle__pivot";
  node_muzzle_4.scale.set(1, 1, 1);
  if (endpoint_muzzle_4) {
    node_muzzle_4.position.copy(endpoint_muzzle_4.start);
    node_muzzle_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_muzzle_4.position.set(0.0, -0.08, 0.14);
    node_muzzle_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_muzzle_4.userData.sculptComponent = {"id": "muzzle", "name": "Muzzle", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Stubby rounded snout mass blended into the lower front of the skull; lathe bulb scaled anisotropically (wider than tall), protrusion 0.40 HH. Flews/chin detail arrives in feature-placement.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.46], [0.44, -0.34], [0.5, -0.12], [0.5, 0.1], [0.44, 0.28], [0.3, 0.42], [0.001, 0.5]], "segments": 20}}, "parent": "head", "attachment": {"parentSocket": "head.front-lower", "localStart": [0, -0.08, 0.14], "localEnd": [0, -0.09, 0.24], "contactType": "overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.0, "baseRadius": 0.085, "endRadius": 0.07, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.175, "height": 0.135, "depth": 0.175, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.08, 0.14], "rotation": [0, 0, 0], "scale": [0.175, 0.135, 0.175]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "muzzle.flews", "kind": "form", "description": "inverted-Y flews seam under the nose: philtrum splits into two lip curves; small rounded chin pad below; underside recedes to the chin", "region": "muzzle underside", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-blaze-muzzle"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white muzzle joining the blaze — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "bridge-blend", "kind": "ellipsoid", "color": "#f2e9d8", "center": [0, 0.05, -0.02], "radii": [0.09, 0.05, 0.07], "softness": 0.02}]}};
  node_muzzle_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["head"] ?? root).add(node_muzzle_4);
  nodes["muzzle"] = node_muzzle_4;
  const mesh_muzzle_4Geometry = endpoint_muzzle_4
    ? new THREE.CylinderGeometry(endpoint_muzzle_4.endRadius, endpoint_muzzle_4.baseRadius, endpoint_muzzle_4.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.3, -0.46], [0.44, -0.34], [0.5, -0.12], [0.5, 0.1], [0.44, 0.28], [0.3, 0.42], [0.001, 0.5]], "segments": 20});
  if (!endpoint_muzzle_4) {
    mesh_muzzle_4Geometry.scale(0.175, 0.135, 0.175);
  }
  applyVertexPaint(mesh_muzzle_4Geometry, "#f2e9d8", [{"id": "bridge-blend", "kind": "ellipsoid", "color": "#f2e9d8", "softness": 0.02, "center": [0.0, 0.05, -0.02], "radii": [0.09, 0.05, 0.07]}]);
  const mesh_muzzle_4 = new THREE.Mesh(
    mesh_muzzle_4Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_muzzle_4.name = "Muzzle";
  mesh_muzzle_4.material = mesh_muzzle_4.material.clone();
  mesh_muzzle_4.material.vertexColors = true;
  (mesh_muzzle_4.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_muzzle_4) {
    mesh_muzzle_4.position.copy(endpoint_muzzle_4.midpoint);
    mesh_muzzle_4.quaternion.copy(endpoint_muzzle_4.quaternion);
  }
  mesh_muzzle_4.castShadow = options.castShadow ?? true;
  mesh_muzzle_4.receiveShadow = options.receiveShadow ?? true;
  mesh_muzzle_4.userData.sculptComponent = {"id": "muzzle", "name": "Muzzle", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Stubby rounded snout mass blended into the lower front of the skull; lathe bulb scaled anisotropically (wider than tall), protrusion 0.40 HH. Flews/chin detail arrives in feature-placement.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.46], [0.44, -0.34], [0.5, -0.12], [0.5, 0.1], [0.44, 0.28], [0.3, 0.42], [0.001, 0.5]], "segments": 20}}, "parent": "head", "attachment": {"parentSocket": "head.front-lower", "localStart": [0, -0.08, 0.14], "localEnd": [0, -0.09, 0.24], "contactType": "overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.0, "baseRadius": 0.085, "endRadius": 0.07, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.175, "height": 0.135, "depth": 0.175, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.08, 0.14], "rotation": [0, 0, 0], "scale": [0.175, 0.135, 0.175]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "muzzle.flews", "kind": "form", "description": "inverted-Y flews seam under the nose: philtrum splits into two lip curves; small rounded chin pad below; underside recedes to the chin", "region": "muzzle underside", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-blaze-muzzle"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white muzzle joining the blaze — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "bridge-blend", "kind": "ellipsoid", "color": "#f2e9d8", "center": [0, 0.05, -0.02], "radii": [0.09, 0.05, 0.07], "softness": 0.02}]}};
  node_muzzle_4.add(mesh_muzzle_4);
  meshes["muzzle"] = mesh_muzzle_4;
  colliders["muzzle"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["muzzle"] ??= [];
  destructionGroups["muzzle"].push(node_muzzle_4);

  const endpoint_nose_5 = makeAttachmentEndpoint(null);
  const node_nose_5 = new THREE.Group();
  node_nose_5.name = "Nose__pivot";
  node_nose_5.scale.set(1, 1, 1);
  if (endpoint_nose_5) {
    node_nose_5.position.copy(endpoint_nose_5.start);
    node_nose_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_nose_5.position.set(0.0, 0.025, 0.085);
    node_nose_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_nose_5.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "meso", "role": "head", "importance": 0.95, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded-triangle dark bulb sitting on the muzzle front-top, 0.24 HH wide — oversized (toon).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.36, -0.42], [0.5, -0.15], [0.46, 0.12], [0.32, 0.34], [0.001, 0.5]], "segments": 16}}, "parent": "muzzle", "attachment": {"parentSocket": "muzzle.front-top", "localStart": [0, 0.025, 0.085], "localEnd": [0, 0.025, 0.12], "contactType": "butt", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.036, "endRadius": 0.03, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.075, "height": 0.062, "depth": 0.052, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.025, 0.085], "rotation": [0, 0, 0], "scale": [0.075, 0.062, 0.052]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "nose-mat"}}, "material": "nose-mat", "materialLayers": ["nose-mat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nose.nostrils", "kind": "relief", "description": "two comma-shaped nostril recesses + center philtrum groove running down to the lip", "region": "nose bulb front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-nose"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 48, 40, 1.0)", "secondaryAlbedo": "rgba(107, 81, 64, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.9, "note": "dark chocolate leather, satin gloss band on top — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#4a3028", "regions": [{"id": "gloss-band", "kind": "ellipsoid", "color": "#6b5140", "center": [0, 0.018, 0.008], "radii": [0.03, 0.012, 0.022], "softness": 0.008}]}};
  node_nose_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "nose-mat"}};
  (nodes["muzzle"] ?? root).add(node_nose_5);
  nodes["nose"] = node_nose_5;
  const mesh_nose_5Geometry = endpoint_nose_5
    ? new THREE.CylinderGeometry(endpoint_nose_5.endRadius, endpoint_nose_5.baseRadius, endpoint_nose_5.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.36, -0.42], [0.5, -0.15], [0.46, 0.12], [0.32, 0.34], [0.001, 0.5]], "segments": 16});
  if (!endpoint_nose_5) {
    mesh_nose_5Geometry.scale(0.075, 0.062, 0.052);
  }
  applyVertexPaint(mesh_nose_5Geometry, "#4a3028", [{"id": "gloss-band", "kind": "ellipsoid", "color": "#6b5140", "softness": 0.008, "center": [0.0, 0.018, 0.008], "radii": [0.03, 0.012, 0.022]}]);
  const mesh_nose_5 = new THREE.Mesh(
    mesh_nose_5Geometry,
    materialMap["nose-mat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nose_5.name = "Nose";
  mesh_nose_5.material = mesh_nose_5.material.clone();
  mesh_nose_5.material.vertexColors = true;
  (mesh_nose_5.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_nose_5) {
    mesh_nose_5.position.copy(endpoint_nose_5.midpoint);
    mesh_nose_5.quaternion.copy(endpoint_nose_5.quaternion);
  }
  mesh_nose_5.castShadow = options.castShadow ?? true;
  mesh_nose_5.receiveShadow = options.receiveShadow ?? true;
  mesh_nose_5.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "meso", "role": "head", "importance": 0.95, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded-triangle dark bulb sitting on the muzzle front-top, 0.24 HH wide — oversized (toon).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.36, -0.42], [0.5, -0.15], [0.46, 0.12], [0.32, 0.34], [0.001, 0.5]], "segments": 16}}, "parent": "muzzle", "attachment": {"parentSocket": "muzzle.front-top", "localStart": [0, 0.025, 0.085], "localEnd": [0, 0.025, 0.12], "contactType": "butt", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.036, "endRadius": 0.03, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.075, "height": 0.062, "depth": 0.052, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.025, 0.085], "rotation": [0, 0, 0], "scale": [0.075, 0.062, 0.052]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "nose-mat"}}, "material": "nose-mat", "materialLayers": ["nose-mat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nose.nostrils", "kind": "relief", "description": "two comma-shaped nostril recesses + center philtrum groove running down to the lip", "region": "nose bulb front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-nose"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 48, 40, 1.0)", "secondaryAlbedo": "rgba(107, 81, 64, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.9, "note": "dark chocolate leather, satin gloss band on top — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#4a3028", "regions": [{"id": "gloss-band", "kind": "ellipsoid", "color": "#6b5140", "center": [0, 0.018, 0.008], "radii": [0.03, 0.012, 0.022], "softness": 0.008}]}};
  node_nose_5.add(mesh_nose_5);
  meshes["nose"] = mesh_nose_5;
  colliders["nose"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["nose"] ??= [];
  destructionGroups["nose"].push(node_nose_5);

  const endpoint_eye_l_6 = makeAttachmentEndpoint(null);
  const node_eye_l_6 = new THREE.Group();
  node_eye_l_6.name = "Eye L__pivot";
  node_eye_l_6.scale.set(1, 1, 1);
  if (endpoint_eye_l_6) {
    node_eye_l_6.position.copy(endpoint_eye_l_6.start);
    node_eye_l_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_l_6.position.set(0.078, -0.005, 0.112);
    node_eye_l_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_l_6.userData.sculptComponent = {"id": "eye-l", "name": "Eye L", "level": "meso", "role": "head", "importance": 0.95, "confidence": 0.9, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Glossy sphere set into the skull front; a discrete primitive by nature.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "head.eye-socket-l", "localStart": [0.078, -0.005, 0.112], "localEnd": [0.078, -0.005, 0.15], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.028, "endRadius": 0.026, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.066, "height": 0.066, "depth": 0.066, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.078, -0.005, 0.112], "rotation": [0, 0, 0], "scale": [0.066, 0.066, 0.066]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "eye-mat", "materialLayers": ["eye-mat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye.catchlight", "kind": "specular", "description": "one large round unlit-white catchlight dot in the upper-outer pupil quadrant + faint secondary micro-glint lower-inner; MeshBasicMaterial per project rule", "region": "pupil upper-outer", "evidenceRef": "see detailInventory entry mapping to this ref"}, {"id": "eye.rim", "kind": "keyline", "description": "thin dark eyelid outline rim around the amber-brown iris, upper lid heavier; iris darkens into the merged pupil center", "region": "eye perimeter", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-eye-near"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(29, 18, 12, 1.0)", "secondaryAlbedo": "rgba(85, 42, 25, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "note": "amber iris ring, merged dark pupil, dark rim — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#17100b", "regions": [{"id": "iris", "kind": "ellipsoid", "color": "#552a19", "center": [0, 0, 0.03], "radii": [0.021, 0.021, 0.012], "softness": 0.002}, {"id": "pupil", "kind": "ellipsoid", "color": "#100a06", "center": [0, 0, 0.033], "radii": [0.0115, 0.0115, 0.007], "softness": 0.001}, {"id": "catchlight", "kind": "ellipsoid", "color": "#ffffff", "center": [0.008, 0.008, 0.0315], "radii": [0.0055, 0.0055, 0.004], "softness": 0.0}]}};
  node_eye_l_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}};
  (nodes["head"] ?? root).add(node_eye_l_6);
  nodes["eye-l"] = node_eye_l_6;
  const mesh_eye_l_6Geometry = endpoint_eye_l_6
    ? new THREE.CylinderGeometry(endpoint_eye_l_6.endRadius, endpoint_eye_l_6.baseRadius, endpoint_eye_l_6.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye_l_6) {
    mesh_eye_l_6Geometry.scale(0.066, 0.066, 0.066);
  }
  applyVertexPaint(mesh_eye_l_6Geometry, "#17100b", [{"id": "iris", "kind": "ellipsoid", "color": "#552a19", "softness": 0.002, "center": [0.0, 0.0, 0.03], "radii": [0.021, 0.021, 0.012]}, {"id": "pupil", "kind": "ellipsoid", "color": "#100a06", "softness": 0.001, "center": [0.0, 0.0, 0.033], "radii": [0.0115, 0.0115, 0.007]}, {"id": "catchlight", "kind": "ellipsoid", "color": "#ffffff", "softness": 0.0, "center": [0.008, 0.008, 0.0315], "radii": [0.0055, 0.0055, 0.004]}]);
  const mesh_eye_l_6 = new THREE.Mesh(
    mesh_eye_l_6Geometry,
    materialMap["eye-mat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_l_6.name = "Eye L";
  mesh_eye_l_6.material = mesh_eye_l_6.material.clone();
  mesh_eye_l_6.material.vertexColors = true;
  (mesh_eye_l_6.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_eye_l_6) {
    mesh_eye_l_6.position.copy(endpoint_eye_l_6.midpoint);
    mesh_eye_l_6.quaternion.copy(endpoint_eye_l_6.quaternion);
  }
  mesh_eye_l_6.castShadow = options.castShadow ?? true;
  mesh_eye_l_6.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_l_6.userData.sculptComponent = {"id": "eye-l", "name": "Eye L", "level": "meso", "role": "head", "importance": 0.95, "confidence": 0.9, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Glossy sphere set into the skull front; a discrete primitive by nature.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "head.eye-socket-l", "localStart": [0.078, -0.005, 0.112], "localEnd": [0.078, -0.005, 0.15], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.028, "endRadius": 0.026, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.066, "height": 0.066, "depth": 0.066, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.078, -0.005, 0.112], "rotation": [0, 0, 0], "scale": [0.066, 0.066, 0.066]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "eye-mat", "materialLayers": ["eye-mat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye.catchlight", "kind": "specular", "description": "one large round unlit-white catchlight dot in the upper-outer pupil quadrant + faint secondary micro-glint lower-inner; MeshBasicMaterial per project rule", "region": "pupil upper-outer", "evidenceRef": "see detailInventory entry mapping to this ref"}, {"id": "eye.rim", "kind": "keyline", "description": "thin dark eyelid outline rim around the amber-brown iris, upper lid heavier; iris darkens into the merged pupil center", "region": "eye perimeter", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-eye-near"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(29, 18, 12, 1.0)", "secondaryAlbedo": "rgba(85, 42, 25, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "note": "amber iris ring, merged dark pupil, dark rim — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#17100b", "regions": [{"id": "iris", "kind": "ellipsoid", "color": "#552a19", "center": [0, 0, 0.03], "radii": [0.021, 0.021, 0.012], "softness": 0.002}, {"id": "pupil", "kind": "ellipsoid", "color": "#100a06", "center": [0, 0, 0.033], "radii": [0.0115, 0.0115, 0.007], "softness": 0.001}, {"id": "catchlight", "kind": "ellipsoid", "color": "#ffffff", "center": [0.008, 0.008, 0.0315], "radii": [0.0055, 0.0055, 0.004], "softness": 0.0}]}};
  node_eye_l_6.add(mesh_eye_l_6);
  meshes["eye-l"] = mesh_eye_l_6;
  colliders["eye-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["eye-l"] ??= [];
  destructionGroups["eye-l"].push(node_eye_l_6);

  const endpoint_eye_r_7 = makeAttachmentEndpoint(null);
  const node_eye_r_7 = new THREE.Group();
  node_eye_r_7.name = "Eye R__pivot";
  node_eye_r_7.scale.set(1, 1, 1);
  if (endpoint_eye_r_7) {
    node_eye_r_7.position.copy(endpoint_eye_r_7.start);
    node_eye_r_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_r_7.position.set(-0.078, -0.005, 0.112);
    node_eye_r_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_r_7.userData.sculptComponent = {"id": "eye-r", "name": "Eye R", "level": "meso", "role": "head", "importance": 0.95, "confidence": 0.9, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Glossy sphere set into the skull front; a discrete primitive by nature.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "head.eye-socket-r", "localStart": [-0.078, -0.005, 0.112], "localEnd": [-0.078, -0.005, 0.15], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.028, "endRadius": 0.026, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.066, "height": 0.066, "depth": 0.066, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.078, -0.005, 0.112], "rotation": [0, 0, 0], "scale": [0.066, 0.066, 0.066]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "eye-mat", "materialLayers": ["eye-mat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye.catchlight", "kind": "specular", "description": "one large round unlit-white catchlight dot in the upper-outer pupil quadrant + faint secondary micro-glint lower-inner; MeshBasicMaterial per project rule", "region": "pupil upper-outer", "evidenceRef": "see detailInventory entry mapping to this ref"}, {"id": "eye.rim", "kind": "keyline", "description": "thin dark eyelid outline rim around the amber-brown iris, upper lid heavier; iris darkens into the merged pupil center", "region": "eye perimeter", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-eye-near"], "details": [], "fidelityTier": "blockout", "mirrorOf": "eye-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of eye-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(29, 18, 12, 1.0)", "secondaryAlbedo": "rgba(85, 42, 25, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "note": "amber iris ring, merged dark pupil, dark rim — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#17100b", "regions": [{"id": "iris", "kind": "ellipsoid", "color": "#552a19", "center": [0, 0, 0.03], "radii": [0.021, 0.021, 0.012], "softness": 0.002}, {"id": "pupil", "kind": "ellipsoid", "color": "#100a06", "center": [0, 0, 0.033], "radii": [0.0115, 0.0115, 0.007], "softness": 0.001}, {"id": "catchlight", "kind": "ellipsoid", "color": "#ffffff", "center": [-0.008, 0.008, 0.0315], "radii": [0.0055, 0.0055, 0.004], "softness": 0.0}]}};
  node_eye_r_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}};
  (nodes["head"] ?? root).add(node_eye_r_7);
  nodes["eye-r"] = node_eye_r_7;
  const mesh_eye_r_7Geometry = endpoint_eye_r_7
    ? new THREE.CylinderGeometry(endpoint_eye_r_7.endRadius, endpoint_eye_r_7.baseRadius, endpoint_eye_r_7.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye_r_7) {
    mesh_eye_r_7Geometry.scale(0.066, 0.066, 0.066);
  }
  applyVertexPaint(mesh_eye_r_7Geometry, "#17100b", [{"id": "iris", "kind": "ellipsoid", "color": "#552a19", "softness": 0.002, "center": [0.0, 0.0, 0.03], "radii": [0.021, 0.021, 0.012]}, {"id": "pupil", "kind": "ellipsoid", "color": "#100a06", "softness": 0.001, "center": [0.0, 0.0, 0.033], "radii": [0.0115, 0.0115, 0.007]}, {"id": "catchlight", "kind": "ellipsoid", "color": "#ffffff", "softness": 0.0, "center": [-0.008, 0.008, 0.0315], "radii": [0.0055, 0.0055, 0.004]}]);
  const mesh_eye_r_7 = new THREE.Mesh(
    mesh_eye_r_7Geometry,
    materialMap["eye-mat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_r_7.name = "Eye R";
  mesh_eye_r_7.material = mesh_eye_r_7.material.clone();
  mesh_eye_r_7.material.vertexColors = true;
  (mesh_eye_r_7.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_eye_r_7) {
    mesh_eye_r_7.position.copy(endpoint_eye_r_7.midpoint);
    mesh_eye_r_7.quaternion.copy(endpoint_eye_r_7.quaternion);
  }
  mesh_eye_r_7.castShadow = options.castShadow ?? true;
  mesh_eye_r_7.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_r_7.userData.sculptComponent = {"id": "eye-r", "name": "Eye R", "level": "meso", "role": "head", "importance": 0.95, "confidence": 0.9, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Glossy sphere set into the skull front; a discrete primitive by nature.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "head.eye-socket-r", "localStart": [-0.078, -0.005, 0.112], "localEnd": [-0.078, -0.005, 0.15], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.028, "endRadius": 0.026, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.066, "height": 0.066, "depth": 0.066, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.078, -0.005, 0.112], "rotation": [0, 0, 0], "scale": [0.066, 0.066, 0.066]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "eye-mat", "materialLayers": ["eye-mat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye.catchlight", "kind": "specular", "description": "one large round unlit-white catchlight dot in the upper-outer pupil quadrant + faint secondary micro-glint lower-inner; MeshBasicMaterial per project rule", "region": "pupil upper-outer", "evidenceRef": "see detailInventory entry mapping to this ref"}, {"id": "eye.rim", "kind": "keyline", "description": "thin dark eyelid outline rim around the amber-brown iris, upper lid heavier; iris darkens into the merged pupil center", "region": "eye perimeter", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-eye-near"], "details": [], "fidelityTier": "blockout", "mirrorOf": "eye-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of eye-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(29, 18, 12, 1.0)", "secondaryAlbedo": "rgba(85, 42, 25, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "note": "amber iris ring, merged dark pupil, dark rim — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#17100b", "regions": [{"id": "iris", "kind": "ellipsoid", "color": "#552a19", "center": [0, 0, 0.03], "radii": [0.021, 0.021, 0.012], "softness": 0.002}, {"id": "pupil", "kind": "ellipsoid", "color": "#100a06", "center": [0, 0, 0.033], "radii": [0.0115, 0.0115, 0.007], "softness": 0.001}, {"id": "catchlight", "kind": "ellipsoid", "color": "#ffffff", "center": [-0.008, 0.008, 0.0315], "radii": [0.0055, 0.0055, 0.004], "softness": 0.0}]}};
  node_eye_r_7.add(mesh_eye_r_7);
  meshes["eye-r"] = mesh_eye_r_7;
  colliders["eye-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["eye-r"] ??= [];
  destructionGroups["eye-r"].push(node_eye_r_7);

  const endpoint_ear_l_8 = makeAttachmentEndpoint(null);
  const node_ear_l_8 = new THREE.Group();
  node_ear_l_8.name = "Ear L__pivot";
  node_ear_l_8.scale.set(1, 1, 1);
  if (endpoint_ear_l_8) {
    node_ear_l_8.position.copy(endpoint_ear_l_8.start);
    node_ear_l_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_l_8.position.set(0.132, 0.05, 0.045);
    node_ear_l_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_l_8.userData.sculptComponent = {"id": "ear-l", "name": "Ear L", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.9, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Pendant ear: flattened teardrop swept down-out-forward; widest mid-hang, rounded-to-point tip curling toward the cheek. Mirrored L/R (x negated).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.012, 0.0], "rx": 0.016, "rz": 0.03, "twist": 0.0}, {"position": [0.014, -0.065, 0.01], "rx": 0.02, "rz": 0.05, "twist": 0.0}, {"position": [0.022, -0.15, 0.024], "rx": 0.018, "rz": 0.058, "twist": 0.0}, {"position": [0.028, -0.225, 0.052], "rx": 0.013, "rz": 0.04, "twist": 0.0}, {"position": [0.028, -0.255, 0.082], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "head.temporal-l", "localStart": [0.132, 0.05, 0.045], "localEnd": [0.175, -0.2, 0.1], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.05, "endRadius": 0.042, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.105, "height": 0.264, "depth": 0.036, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.132, 0.05, 0.045], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-sway", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ear.tipCurl", "kind": "form", "description": "bottom tip curls forward/inward toward the cheek; ear is a curved shell, not a flat paddle", "region": "ear bottom third", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-ear-near"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange outer face, warmer deeper inner face — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "inner-face", "kind": "axis-band", "color": "#965031", "axis": "x", "min": -0.06, "max": -0.004, "softness": 0.006}]}};
  node_ear_l_8.userData.actionProfile = {"animationRole": "secondary-sway", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["head"] ?? root).add(node_ear_l_8);
  nodes["ear-l"] = node_ear_l_8;
  const mesh_ear_l_8Geometry = endpoint_ear_l_8
    ? new THREE.CylinderGeometry(endpoint_ear_l_8.endRadius, endpoint_ear_l_8.baseRadius, endpoint_ear_l_8.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.012, 0.0], "rx": 0.016, "rz": 0.03, "twist": 0.0}, {"position": [0.014, -0.065, 0.01], "rx": 0.02, "rz": 0.05, "twist": 0.0}, {"position": [0.022, -0.15, 0.024], "rx": 0.018, "rz": 0.058, "twist": 0.0}, {"position": [0.028, -0.225, 0.052], "rx": 0.013, "rz": 0.04, "twist": 0.0}, {"position": [0.028, -0.255, 0.082], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_ear_l_8) {
    mesh_ear_l_8Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_ear_l_8Geometry, "#c1702f", [{"id": "inner-face", "kind": "axis-band", "color": "#965031", "softness": 0.006, "axis": "x", "min": -0.06, "max": -0.004}]);
  const mesh_ear_l_8 = new THREE.Mesh(
    mesh_ear_l_8Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_l_8.name = "Ear L";
  mesh_ear_l_8.material = mesh_ear_l_8.material.clone();
  mesh_ear_l_8.material.vertexColors = true;
  (mesh_ear_l_8.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_ear_l_8) {
    mesh_ear_l_8.position.copy(endpoint_ear_l_8.midpoint);
    mesh_ear_l_8.quaternion.copy(endpoint_ear_l_8.quaternion);
  }
  mesh_ear_l_8.castShadow = options.castShadow ?? true;
  mesh_ear_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_l_8.userData.sculptComponent = {"id": "ear-l", "name": "Ear L", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.9, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Pendant ear: flattened teardrop swept down-out-forward; widest mid-hang, rounded-to-point tip curling toward the cheek. Mirrored L/R (x negated).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.012, 0.0], "rx": 0.016, "rz": 0.03, "twist": 0.0}, {"position": [0.014, -0.065, 0.01], "rx": 0.02, "rz": 0.05, "twist": 0.0}, {"position": [0.022, -0.15, 0.024], "rx": 0.018, "rz": 0.058, "twist": 0.0}, {"position": [0.028, -0.225, 0.052], "rx": 0.013, "rz": 0.04, "twist": 0.0}, {"position": [0.028, -0.255, 0.082], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "head.temporal-l", "localStart": [0.132, 0.05, 0.045], "localEnd": [0.175, -0.2, 0.1], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.05, "endRadius": 0.042, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.105, "height": 0.264, "depth": 0.036, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.132, 0.05, 0.045], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-sway", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ear.tipCurl", "kind": "form", "description": "bottom tip curls forward/inward toward the cheek; ear is a curved shell, not a flat paddle", "region": "ear bottom third", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-ear-near"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange outer face, warmer deeper inner face — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "inner-face", "kind": "axis-band", "color": "#965031", "axis": "x", "min": -0.06, "max": -0.004, "softness": 0.006}]}};
  node_ear_l_8.add(mesh_ear_l_8);
  meshes["ear-l"] = mesh_ear_l_8;
  colliders["ear-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["ear-l"] ??= [];
  destructionGroups["ear-l"].push(node_ear_l_8);

  const endpoint_ear_r_9 = makeAttachmentEndpoint(null);
  const node_ear_r_9 = new THREE.Group();
  node_ear_r_9.name = "Ear R__pivot";
  node_ear_r_9.scale.set(1, 1, 1);
  if (endpoint_ear_r_9) {
    node_ear_r_9.position.copy(endpoint_ear_r_9.start);
    node_ear_r_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_r_9.position.set(-0.132, 0.05, 0.045);
    node_ear_r_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_r_9.userData.sculptComponent = {"id": "ear-r", "name": "Ear R", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.9, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Pendant ear: flattened teardrop swept down-out-forward; widest mid-hang, rounded-to-point tip curling toward the cheek. Mirrored L/R (x negated).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.012, 0.0], "rx": 0.016, "rz": 0.03, "twist": 0.0}, {"position": [-0.014, -0.065, 0.01], "rx": 0.02, "rz": 0.05, "twist": 0.0}, {"position": [-0.022, -0.15, 0.024], "rx": 0.018, "rz": 0.058, "twist": 0.0}, {"position": [-0.028, -0.225, 0.052], "rx": 0.013, "rz": 0.04, "twist": 0.0}, {"position": [-0.028, -0.255, 0.082], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "head.temporal-r", "localStart": [-0.132, 0.05, 0.045], "localEnd": [-0.175, -0.2, 0.1], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.05, "endRadius": 0.042, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.105, "height": 0.264, "depth": 0.036, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.132, 0.05, 0.045], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-sway", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ear.tipCurl", "kind": "form", "description": "bottom tip curls forward/inward toward the cheek; ear is a curved shell, not a flat paddle", "region": "ear bottom third", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-ear-near"], "details": [], "fidelityTier": "blockout", "mirrorOf": "ear-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of ear-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange outer face, warmer deeper inner face — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "inner-face", "kind": "axis-band", "color": "#965031", "axis": "x", "min": 0.004, "max": 0.06, "softness": 0.006}]}};
  node_ear_r_9.userData.actionProfile = {"animationRole": "secondary-sway", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["head"] ?? root).add(node_ear_r_9);
  nodes["ear-r"] = node_ear_r_9;
  const mesh_ear_r_9Geometry = endpoint_ear_r_9
    ? new THREE.CylinderGeometry(endpoint_ear_r_9.endRadius, endpoint_ear_r_9.baseRadius, endpoint_ear_r_9.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.012, 0.0], "rx": 0.016, "rz": 0.03, "twist": 0.0}, {"position": [-0.014, -0.065, 0.01], "rx": 0.02, "rz": 0.05, "twist": 0.0}, {"position": [-0.022, -0.15, 0.024], "rx": 0.018, "rz": 0.058, "twist": 0.0}, {"position": [-0.028, -0.225, 0.052], "rx": 0.013, "rz": 0.04, "twist": 0.0}, {"position": [-0.028, -0.255, 0.082], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_ear_r_9) {
    mesh_ear_r_9Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_ear_r_9Geometry, "#c1702f", [{"id": "inner-face", "kind": "axis-band", "color": "#965031", "softness": 0.006, "axis": "x", "min": 0.004, "max": 0.06}]);
  const mesh_ear_r_9 = new THREE.Mesh(
    mesh_ear_r_9Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_r_9.name = "Ear R";
  mesh_ear_r_9.material = mesh_ear_r_9.material.clone();
  mesh_ear_r_9.material.vertexColors = true;
  (mesh_ear_r_9.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_ear_r_9) {
    mesh_ear_r_9.position.copy(endpoint_ear_r_9.midpoint);
    mesh_ear_r_9.quaternion.copy(endpoint_ear_r_9.quaternion);
  }
  mesh_ear_r_9.castShadow = options.castShadow ?? true;
  mesh_ear_r_9.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_r_9.userData.sculptComponent = {"id": "ear-r", "name": "Ear R", "level": "macro", "role": "head", "importance": 1.0, "confidence": 0.9, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Pendant ear: flattened teardrop swept down-out-forward; widest mid-hang, rounded-to-point tip curling toward the cheek. Mirrored L/R (x negated).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.012, 0.0], "rx": 0.016, "rz": 0.03, "twist": 0.0}, {"position": [-0.014, -0.065, 0.01], "rx": 0.02, "rz": 0.05, "twist": 0.0}, {"position": [-0.022, -0.15, 0.024], "rx": 0.018, "rz": 0.058, "twist": 0.0}, {"position": [-0.028, -0.225, 0.052], "rx": 0.013, "rz": 0.04, "twist": 0.0}, {"position": [-0.028, -0.255, 0.082], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "head.temporal-r", "localStart": [-0.132, 0.05, 0.045], "localEnd": [-0.175, -0.2, 0.1], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.05, "endRadius": 0.042, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.105, "height": 0.264, "depth": 0.036, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.132, 0.05, 0.045], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "secondary-sway", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ear.tipCurl", "kind": "form", "description": "bottom tip curls forward/inward toward the cheek; ear is a curved shell, not a flat paddle", "region": "ear bottom third", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-ear-near"], "details": [], "fidelityTier": "blockout", "mirrorOf": "ear-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of ear-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange outer face, warmer deeper inner face — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "inner-face", "kind": "axis-band", "color": "#965031", "axis": "x", "min": 0.004, "max": 0.06, "softness": 0.006}]}};
  node_ear_r_9.add(mesh_ear_r_9);
  meshes["ear-r"] = mesh_ear_r_9;
  colliders["ear-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["ear-r"] ??= [];
  destructionGroups["ear-r"].push(node_ear_r_9);

  const endpoint_leg_front_l_10 = makeAttachmentEndpoint(null);
  const node_leg_front_l_10 = new THREE.Group();
  node_leg_front_l_10.name = "Leg Front L__pivot";
  node_leg_front_l_10.scale.set(1, 1, 1);
  if (endpoint_leg_front_l_10) {
    node_leg_front_l_10.position.copy(endpoint_leg_front_l_10.start);
    node_leg_front_l_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg_front_l_10.position.set(0.075, 0.03, 0.346);
    node_leg_front_l_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg_front_l_10.userData.sculptComponent = {"id": "leg-front-l", "name": "Leg Front L", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Front leg: near-columnar taper shoulder->pastern, embedded into the chest underside.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, 0], "rx": 0.066, "rz": 0.07, "twist": 0.0}, {"position": [0, -0.1, 0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.037, "rz": 0.038, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "chest.shoulder-l", "localStart": [0.075, 0.03, 0.346], "localEnd": [0.075, -0.32, 0.346], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.042, "endRadius": 0.035, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.072, "height": 0.234, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.075, 0.03, 0.346], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white sock, orange upper — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "shoulder-orange", "kind": "axis-band", "color": "#c1702f", "axis": "y", "min": 0.005, "max": 0.06, "softness": 0.015}]}};
  node_leg_front_l_10.userData.actionProfile = {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["torso"] ?? root).add(node_leg_front_l_10);
  nodes["leg-front-l"] = node_leg_front_l_10;
  const mesh_leg_front_l_10Geometry = endpoint_leg_front_l_10
    ? new THREE.CylinderGeometry(endpoint_leg_front_l_10.endRadius, endpoint_leg_front_l_10.baseRadius, endpoint_leg_front_l_10.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.02, 0], "rx": 0.066, "rz": 0.07, "twist": 0.0}, {"position": [0, -0.1, 0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.037, "rz": 0.038, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_leg_front_l_10) {
    mesh_leg_front_l_10Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_leg_front_l_10Geometry, "#f2e9d8", [{"id": "shoulder-orange", "kind": "axis-band", "color": "#c1702f", "softness": 0.015, "axis": "y", "min": 0.005, "max": 0.06}]);
  const mesh_leg_front_l_10 = new THREE.Mesh(
    mesh_leg_front_l_10Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_front_l_10.name = "Leg Front L";
  mesh_leg_front_l_10.material = mesh_leg_front_l_10.material.clone();
  mesh_leg_front_l_10.material.vertexColors = true;
  (mesh_leg_front_l_10.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_leg_front_l_10) {
    mesh_leg_front_l_10.position.copy(endpoint_leg_front_l_10.midpoint);
    mesh_leg_front_l_10.quaternion.copy(endpoint_leg_front_l_10.quaternion);
  }
  mesh_leg_front_l_10.castShadow = options.castShadow ?? true;
  mesh_leg_front_l_10.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_front_l_10.userData.sculptComponent = {"id": "leg-front-l", "name": "Leg Front L", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Front leg: near-columnar taper shoulder->pastern, embedded into the chest underside.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, 0], "rx": 0.066, "rz": 0.07, "twist": 0.0}, {"position": [0, -0.1, 0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.037, "rz": 0.038, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "chest.shoulder-l", "localStart": [0.075, 0.03, 0.346], "localEnd": [0.075, -0.32, 0.346], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.042, "endRadius": 0.035, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.072, "height": 0.234, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.075, 0.03, 0.346], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white sock, orange upper — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "shoulder-orange", "kind": "axis-band", "color": "#c1702f", "axis": "y", "min": 0.005, "max": 0.06, "softness": 0.015}]}};
  node_leg_front_l_10.add(mesh_leg_front_l_10);
  meshes["leg-front-l"] = mesh_leg_front_l_10;
  colliders["leg-front-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["leg-front-l"] ??= [];
  destructionGroups["leg-front-l"].push(node_leg_front_l_10);

  const endpoint_paw_front_l_11 = makeAttachmentEndpoint(null);
  const node_paw_front_l_11 = new THREE.Group();
  node_paw_front_l_11.name = "Paw Front L__pivot";
  node_paw_front_l_11.scale.set(1, 1, 1);
  if (endpoint_paw_front_l_11) {
    node_paw_front_l_11.position.copy(endpoint_paw_front_l_11.start);
    node_paw_front_l_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_paw_front_l_11.position.set(0.0, -0.32, 0.012);
    node_paw_front_l_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_paw_front_l_11.userData.sculptComponent = {"id": "paw-front-l", "name": "Paw Front L", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-front-l", "attachment": {"parentSocket": "leg-front-l.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_front_l_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["leg-front-l"] ?? root).add(node_paw_front_l_11);
  nodes["paw-front-l"] = node_paw_front_l_11;
  const mesh_paw_front_l_11Geometry = endpoint_paw_front_l_11
    ? new THREE.CylinderGeometry(endpoint_paw_front_l_11.endRadius, endpoint_paw_front_l_11.baseRadius, endpoint_paw_front_l_11.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16});
  if (!endpoint_paw_front_l_11) {
    mesh_paw_front_l_11Geometry.scale(0.1, 0.075, 0.115);
  }
  applyVertexPaint(mesh_paw_front_l_11Geometry, "#f2e9d8", [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "softness": 0.01, "center": [0.0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03]}]);
  const mesh_paw_front_l_11 = new THREE.Mesh(
    mesh_paw_front_l_11Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_paw_front_l_11.name = "Paw Front L";
  mesh_paw_front_l_11.material = mesh_paw_front_l_11.material.clone();
  mesh_paw_front_l_11.material.vertexColors = true;
  (mesh_paw_front_l_11.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_paw_front_l_11) {
    mesh_paw_front_l_11.position.copy(endpoint_paw_front_l_11.midpoint);
    mesh_paw_front_l_11.quaternion.copy(endpoint_paw_front_l_11.quaternion);
  }
  mesh_paw_front_l_11.castShadow = options.castShadow ?? true;
  mesh_paw_front_l_11.receiveShadow = options.receiveShadow ?? true;
  mesh_paw_front_l_11.userData.sculptComponent = {"id": "paw-front-l", "name": "Paw Front L", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-front-l", "attachment": {"parentSocket": "leg-front-l.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_front_l_11.add(mesh_paw_front_l_11);
  meshes["paw-front-l"] = mesh_paw_front_l_11;
  colliders["paw-front-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["paw-front-l"] ??= [];
  destructionGroups["paw-front-l"].push(node_paw_front_l_11);

  const endpoint_leg_front_r_12 = makeAttachmentEndpoint(null);
  const node_leg_front_r_12 = new THREE.Group();
  node_leg_front_r_12.name = "Leg Front R__pivot";
  node_leg_front_r_12.scale.set(1, 1, 1);
  if (endpoint_leg_front_r_12) {
    node_leg_front_r_12.position.copy(endpoint_leg_front_r_12.start);
    node_leg_front_r_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg_front_r_12.position.set(-0.075, 0.03, 0.346);
    node_leg_front_r_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg_front_r_12.userData.sculptComponent = {"id": "leg-front-r", "name": "Leg Front R", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Front leg: near-columnar taper shoulder->pastern, embedded into the chest underside.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, 0], "rx": 0.066, "rz": 0.07, "twist": 0.0}, {"position": [0, -0.1, 0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.037, "rz": 0.038, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "chest.shoulder-r", "localStart": [-0.075, 0.03, 0.346], "localEnd": [-0.075, -0.32, 0.346], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.042, "endRadius": 0.035, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.072, "height": 0.234, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.075, 0.03, 0.346], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "mirrorOf": "leg-front-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of leg-front-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white sock, orange upper — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "shoulder-orange", "kind": "axis-band", "color": "#c1702f", "axis": "y", "min": 0.005, "max": 0.06, "softness": 0.015}]}};
  node_leg_front_r_12.userData.actionProfile = {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["torso"] ?? root).add(node_leg_front_r_12);
  nodes["leg-front-r"] = node_leg_front_r_12;
  const mesh_leg_front_r_12Geometry = endpoint_leg_front_r_12
    ? new THREE.CylinderGeometry(endpoint_leg_front_r_12.endRadius, endpoint_leg_front_r_12.baseRadius, endpoint_leg_front_r_12.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.02, 0], "rx": 0.066, "rz": 0.07, "twist": 0.0}, {"position": [0, -0.1, 0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.037, "rz": 0.038, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_leg_front_r_12) {
    mesh_leg_front_r_12Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_leg_front_r_12Geometry, "#f2e9d8", [{"id": "shoulder-orange", "kind": "axis-band", "color": "#c1702f", "softness": 0.015, "axis": "y", "min": 0.005, "max": 0.06}]);
  const mesh_leg_front_r_12 = new THREE.Mesh(
    mesh_leg_front_r_12Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_front_r_12.name = "Leg Front R";
  mesh_leg_front_r_12.material = mesh_leg_front_r_12.material.clone();
  mesh_leg_front_r_12.material.vertexColors = true;
  (mesh_leg_front_r_12.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_leg_front_r_12) {
    mesh_leg_front_r_12.position.copy(endpoint_leg_front_r_12.midpoint);
    mesh_leg_front_r_12.quaternion.copy(endpoint_leg_front_r_12.quaternion);
  }
  mesh_leg_front_r_12.castShadow = options.castShadow ?? true;
  mesh_leg_front_r_12.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_front_r_12.userData.sculptComponent = {"id": "leg-front-r", "name": "Leg Front R", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Front leg: near-columnar taper shoulder->pastern, embedded into the chest underside.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, 0], "rx": 0.066, "rz": 0.07, "twist": 0.0}, {"position": [0, -0.1, 0], "rx": 0.05, "rz": 0.052, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.037, "rz": 0.038, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "chest.shoulder-r", "localStart": [-0.075, 0.03, 0.346], "localEnd": [-0.075, -0.32, 0.346], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.042, "endRadius": 0.035, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.072, "height": 0.234, "depth": 0.072, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.075, 0.03, 0.346], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "mirrorOf": "leg-front-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of leg-front-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(193, 112, 47, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white sock, orange upper — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "shoulder-orange", "kind": "axis-band", "color": "#c1702f", "axis": "y", "min": 0.005, "max": 0.06, "softness": 0.015}]}};
  node_leg_front_r_12.add(mesh_leg_front_r_12);
  meshes["leg-front-r"] = mesh_leg_front_r_12;
  colliders["leg-front-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["leg-front-r"] ??= [];
  destructionGroups["leg-front-r"].push(node_leg_front_r_12);

  const endpoint_paw_front_r_13 = makeAttachmentEndpoint(null);
  const node_paw_front_r_13 = new THREE.Group();
  node_paw_front_r_13.name = "Paw Front R__pivot";
  node_paw_front_r_13.scale.set(1, 1, 1);
  if (endpoint_paw_front_r_13) {
    node_paw_front_r_13.position.copy(endpoint_paw_front_r_13.start);
    node_paw_front_r_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_paw_front_r_13.position.set(0.0, -0.32, 0.012);
    node_paw_front_r_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_paw_front_r_13.userData.sculptComponent = {"id": "paw-front-r", "name": "Paw Front R", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-front-r", "attachment": {"parentSocket": "leg-front-r.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "mirrorOf": "paw-front-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of paw-front-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_front_r_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["leg-front-r"] ?? root).add(node_paw_front_r_13);
  nodes["paw-front-r"] = node_paw_front_r_13;
  const mesh_paw_front_r_13Geometry = endpoint_paw_front_r_13
    ? new THREE.CylinderGeometry(endpoint_paw_front_r_13.endRadius, endpoint_paw_front_r_13.baseRadius, endpoint_paw_front_r_13.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16});
  if (!endpoint_paw_front_r_13) {
    mesh_paw_front_r_13Geometry.scale(0.1, 0.075, 0.115);
  }
  applyVertexPaint(mesh_paw_front_r_13Geometry, "#f2e9d8", [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "softness": 0.01, "center": [0.0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03]}]);
  const mesh_paw_front_r_13 = new THREE.Mesh(
    mesh_paw_front_r_13Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_paw_front_r_13.name = "Paw Front R";
  mesh_paw_front_r_13.material = mesh_paw_front_r_13.material.clone();
  mesh_paw_front_r_13.material.vertexColors = true;
  (mesh_paw_front_r_13.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_paw_front_r_13) {
    mesh_paw_front_r_13.position.copy(endpoint_paw_front_r_13.midpoint);
    mesh_paw_front_r_13.quaternion.copy(endpoint_paw_front_r_13.quaternion);
  }
  mesh_paw_front_r_13.castShadow = options.castShadow ?? true;
  mesh_paw_front_r_13.receiveShadow = options.receiveShadow ?? true;
  mesh_paw_front_r_13.userData.sculptComponent = {"id": "paw-front-r", "name": "Paw Front R", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-front-r", "attachment": {"parentSocket": "leg-front-r.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "mirrorOf": "paw-front-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of paw-front-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_front_r_13.add(mesh_paw_front_r_13);
  meshes["paw-front-r"] = mesh_paw_front_r_13;
  colliders["paw-front-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["paw-front-r"] ??= [];
  destructionGroups["paw-front-r"].push(node_paw_front_r_13);

  const endpoint_leg_hind_l_14 = makeAttachmentEndpoint(null);
  const node_leg_hind_l_14 = new THREE.Group();
  node_leg_hind_l_14.name = "Leg Hind L__pivot";
  node_leg_hind_l_14.scale.set(1, 1, 1);
  if (endpoint_leg_hind_l_14) {
    node_leg_hind_l_14.position.copy(endpoint_leg_hind_l_14.start);
    node_leg_hind_l_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg_hind_l_14.position.set(0.078, 0.05, 0.082);
    node_leg_hind_l_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg_hind_l_14.userData.sculptComponent = {"id": "leg-hind-l", "name": "Leg Hind L", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Hind leg: haunch mass (deep angled thigh) tapering into a short columnar lower leg.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, -0.01], "rx": 0.064, "rz": 0.085, "twist": 0.0}, {"position": [0, -0.11, 0.008], "rx": 0.05, "rz": 0.058, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.038, "rz": 0.04, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "pelvis.hip-l", "localStart": [0.078, 0.05, 0.082], "localEnd": [0.078, -0.32, 0.082], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.055, "endRadius": 0.038, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.09, "height": 0.234, "depth": 0.114, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.078, 0.05, 0.082], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-hind-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange haunch, white below hock — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "sock", "kind": "axis-band", "color": "#f2e9d8", "axis": "y", "min": -0.36, "max": -0.21, "softness": 0.022}]}};
  node_leg_hind_l_14.userData.actionProfile = {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-hind-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["torso"] ?? root).add(node_leg_hind_l_14);
  nodes["leg-hind-l"] = node_leg_hind_l_14;
  const mesh_leg_hind_l_14Geometry = endpoint_leg_hind_l_14
    ? new THREE.CylinderGeometry(endpoint_leg_hind_l_14.endRadius, endpoint_leg_hind_l_14.baseRadius, endpoint_leg_hind_l_14.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.02, -0.01], "rx": 0.064, "rz": 0.085, "twist": 0.0}, {"position": [0, -0.11, 0.008], "rx": 0.05, "rz": 0.058, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.038, "rz": 0.04, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_leg_hind_l_14) {
    mesh_leg_hind_l_14Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_leg_hind_l_14Geometry, "#c1702f", [{"id": "sock", "kind": "axis-band", "color": "#f2e9d8", "softness": 0.022, "axis": "y", "min": -0.36, "max": -0.21}]);
  const mesh_leg_hind_l_14 = new THREE.Mesh(
    mesh_leg_hind_l_14Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_hind_l_14.name = "Leg Hind L";
  mesh_leg_hind_l_14.material = mesh_leg_hind_l_14.material.clone();
  mesh_leg_hind_l_14.material.vertexColors = true;
  (mesh_leg_hind_l_14.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_leg_hind_l_14) {
    mesh_leg_hind_l_14.position.copy(endpoint_leg_hind_l_14.midpoint);
    mesh_leg_hind_l_14.quaternion.copy(endpoint_leg_hind_l_14.quaternion);
  }
  mesh_leg_hind_l_14.castShadow = options.castShadow ?? true;
  mesh_leg_hind_l_14.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_hind_l_14.userData.sculptComponent = {"id": "leg-hind-l", "name": "Leg Hind L", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Hind leg: haunch mass (deep angled thigh) tapering into a short columnar lower leg.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, -0.01], "rx": 0.064, "rz": 0.085, "twist": 0.0}, {"position": [0, -0.11, 0.008], "rx": 0.05, "rz": 0.058, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.038, "rz": 0.04, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "pelvis.hip-l", "localStart": [0.078, 0.05, 0.082], "localEnd": [0.078, -0.32, 0.082], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.055, "endRadius": 0.038, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.09, "height": 0.234, "depth": 0.114, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.078, 0.05, 0.082], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-hind-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange haunch, white below hock — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "sock", "kind": "axis-band", "color": "#f2e9d8", "axis": "y", "min": -0.36, "max": -0.21, "softness": 0.022}]}};
  node_leg_hind_l_14.add(mesh_leg_hind_l_14);
  meshes["leg-hind-l"] = mesh_leg_hind_l_14;
  colliders["leg-hind-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["leg-hind-l"] ??= [];
  destructionGroups["leg-hind-l"].push(node_leg_hind_l_14);

  const endpoint_paw_hind_l_15 = makeAttachmentEndpoint(null);
  const node_paw_hind_l_15 = new THREE.Group();
  node_paw_hind_l_15.name = "Paw Hind L__pivot";
  node_paw_hind_l_15.scale.set(1, 1, 1);
  if (endpoint_paw_hind_l_15) {
    node_paw_hind_l_15.position.copy(endpoint_paw_hind_l_15.start);
    node_paw_hind_l_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_paw_hind_l_15.position.set(0.0, -0.32, 0.012);
    node_paw_hind_l_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_paw_hind_l_15.userData.sculptComponent = {"id": "paw-hind-l", "name": "Paw Hind L", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-hind-l", "attachment": {"parentSocket": "leg-hind-l.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-hind-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_hind_l_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-hind-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["leg-hind-l"] ?? root).add(node_paw_hind_l_15);
  nodes["paw-hind-l"] = node_paw_hind_l_15;
  const mesh_paw_hind_l_15Geometry = endpoint_paw_hind_l_15
    ? new THREE.CylinderGeometry(endpoint_paw_hind_l_15.endRadius, endpoint_paw_hind_l_15.baseRadius, endpoint_paw_hind_l_15.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16});
  if (!endpoint_paw_hind_l_15) {
    mesh_paw_hind_l_15Geometry.scale(0.1, 0.075, 0.115);
  }
  applyVertexPaint(mesh_paw_hind_l_15Geometry, "#f2e9d8", [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "softness": 0.01, "center": [0.0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03]}]);
  const mesh_paw_hind_l_15 = new THREE.Mesh(
    mesh_paw_hind_l_15Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_paw_hind_l_15.name = "Paw Hind L";
  mesh_paw_hind_l_15.material = mesh_paw_hind_l_15.material.clone();
  mesh_paw_hind_l_15.material.vertexColors = true;
  (mesh_paw_hind_l_15.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_paw_hind_l_15) {
    mesh_paw_hind_l_15.position.copy(endpoint_paw_hind_l_15.midpoint);
    mesh_paw_hind_l_15.quaternion.copy(endpoint_paw_hind_l_15.quaternion);
  }
  mesh_paw_hind_l_15.castShadow = options.castShadow ?? true;
  mesh_paw_hind_l_15.receiveShadow = options.receiveShadow ?? true;
  mesh_paw_hind_l_15.userData.sculptComponent = {"id": "paw-hind-l", "name": "Paw Hind L", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-hind-l", "attachment": {"parentSocket": "leg-hind-l.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-hind-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_hind_l_15.add(mesh_paw_hind_l_15);
  meshes["paw-hind-l"] = mesh_paw_hind_l_15;
  colliders["paw-hind-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["paw-hind-l"] ??= [];
  destructionGroups["paw-hind-l"].push(node_paw_hind_l_15);

  const endpoint_leg_hind_r_16 = makeAttachmentEndpoint(null);
  const node_leg_hind_r_16 = new THREE.Group();
  node_leg_hind_r_16.name = "Leg Hind R__pivot";
  node_leg_hind_r_16.scale.set(1, 1, 1);
  if (endpoint_leg_hind_r_16) {
    node_leg_hind_r_16.position.copy(endpoint_leg_hind_r_16.start);
    node_leg_hind_r_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leg_hind_r_16.position.set(-0.078, 0.05, 0.082);
    node_leg_hind_r_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_leg_hind_r_16.userData.sculptComponent = {"id": "leg-hind-r", "name": "Leg Hind R", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Hind leg: haunch mass (deep angled thigh) tapering into a short columnar lower leg.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, -0.01], "rx": 0.064, "rz": 0.085, "twist": 0.0}, {"position": [0, -0.11, 0.008], "rx": 0.05, "rz": 0.058, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.038, "rz": 0.04, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "pelvis.hip-r", "localStart": [-0.078, 0.05, 0.082], "localEnd": [-0.078, -0.32, 0.082], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.055, "endRadius": 0.038, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.09, "height": 0.234, "depth": 0.114, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.078, 0.05, 0.082], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-hind-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "mirrorOf": "leg-hind-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of leg-hind-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange haunch, white below hock — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "sock", "kind": "axis-band", "color": "#f2e9d8", "axis": "y", "min": -0.36, "max": -0.21, "softness": 0.022}]}};
  node_leg_hind_r_16.userData.actionProfile = {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-hind-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["torso"] ?? root).add(node_leg_hind_r_16);
  nodes["leg-hind-r"] = node_leg_hind_r_16;
  const mesh_leg_hind_r_16Geometry = endpoint_leg_hind_r_16
    ? new THREE.CylinderGeometry(endpoint_leg_hind_r_16.endRadius, endpoint_leg_hind_r_16.baseRadius, endpoint_leg_hind_r_16.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.02, -0.01], "rx": 0.064, "rz": 0.085, "twist": 0.0}, {"position": [0, -0.11, 0.008], "rx": 0.05, "rz": 0.058, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.038, "rz": 0.04, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_leg_hind_r_16) {
    mesh_leg_hind_r_16Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_leg_hind_r_16Geometry, "#c1702f", [{"id": "sock", "kind": "axis-band", "color": "#f2e9d8", "softness": 0.022, "axis": "y", "min": -0.36, "max": -0.21}]);
  const mesh_leg_hind_r_16 = new THREE.Mesh(
    mesh_leg_hind_r_16Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_hind_r_16.name = "Leg Hind R";
  mesh_leg_hind_r_16.material = mesh_leg_hind_r_16.material.clone();
  mesh_leg_hind_r_16.material.vertexColors = true;
  (mesh_leg_hind_r_16.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_leg_hind_r_16) {
    mesh_leg_hind_r_16.position.copy(endpoint_leg_hind_r_16.midpoint);
    mesh_leg_hind_r_16.quaternion.copy(endpoint_leg_hind_r_16.quaternion);
  }
  mesh_leg_hind_r_16.castShadow = options.castShadow ?? true;
  mesh_leg_hind_r_16.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_hind_r_16.userData.sculptComponent = {"id": "leg-hind-r", "name": "Leg Hind R", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Hind leg: haunch mass (deep angled thigh) tapering into a short columnar lower leg.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.02, -0.01], "rx": 0.064, "rz": 0.085, "twist": 0.0}, {"position": [0, -0.11, 0.008], "rx": 0.05, "rz": 0.058, "twist": 0.0}, {"position": [0, -0.25, 0], "rx": 0.038, "rz": 0.04, "twist": 0.0}, {"position": [0, -0.33, 0], "rx": 0.035, "rz": 0.037, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "pelvis.hip-r", "localStart": [-0.078, 0.05, 0.082], "localEnd": [-0.078, -0.32, 0.082], "contactType": "embed", "embedDepth": 0.06, "overlap": 0.06, "gapTolerance": 0.0, "baseRadius": 0.055, "endRadius": 0.038, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.09, "height": 0.234, "depth": 0.114, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.078, 0.05, 0.082], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "limb-swing", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-hind-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["view-3q-front-right"], "details": [], "fidelityTier": "blockout", "mirrorOf": "leg-hind-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of leg-hind-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange haunch, white below hock — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "sock", "kind": "axis-band", "color": "#f2e9d8", "axis": "y", "min": -0.36, "max": -0.21, "softness": 0.022}]}};
  node_leg_hind_r_16.add(mesh_leg_hind_r_16);
  meshes["leg-hind-r"] = mesh_leg_hind_r_16;
  colliders["leg-hind-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["leg-hind-r"] ??= [];
  destructionGroups["leg-hind-r"].push(node_leg_hind_r_16);

  const endpoint_paw_hind_r_17 = makeAttachmentEndpoint(null);
  const node_paw_hind_r_17 = new THREE.Group();
  node_paw_hind_r_17.name = "Paw Hind R__pivot";
  node_paw_hind_r_17.scale.set(1, 1, 1);
  if (endpoint_paw_hind_r_17) {
    node_paw_hind_r_17.position.copy(endpoint_paw_hind_r_17.start);
    node_paw_hind_r_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_paw_hind_r_17.position.set(0.0, -0.32, 0.012);
    node_paw_hind_r_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_paw_hind_r_17.userData.sculptComponent = {"id": "paw-hind-r", "name": "Paw Hind R", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-hind-r", "attachment": {"parentSocket": "leg-hind-r.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-hind-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "mirrorOf": "paw-hind-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of paw-hind-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_hind_r_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-hind-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["leg-hind-r"] ?? root).add(node_paw_hind_r_17);
  nodes["paw-hind-r"] = node_paw_hind_r_17;
  const mesh_paw_hind_r_17Geometry = endpoint_paw_hind_r_17
    ? new THREE.CylinderGeometry(endpoint_paw_hind_r_17.endRadius, endpoint_paw_hind_r_17.baseRadius, endpoint_paw_hind_r_17.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16});
  if (!endpoint_paw_hind_r_17) {
    mesh_paw_hind_r_17Geometry.scale(0.1, 0.075, 0.115);
  }
  applyVertexPaint(mesh_paw_hind_r_17Geometry, "#f2e9d8", [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "softness": 0.01, "center": [0.0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03]}]);
  const mesh_paw_hind_r_17 = new THREE.Mesh(
    mesh_paw_hind_r_17Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_paw_hind_r_17.name = "Paw Hind R";
  mesh_paw_hind_r_17.material = mesh_paw_hind_r_17.material.clone();
  mesh_paw_hind_r_17.material.vertexColors = true;
  (mesh_paw_hind_r_17.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_paw_hind_r_17) {
    mesh_paw_hind_r_17.position.copy(endpoint_paw_hind_r_17.midpoint);
    mesh_paw_hind_r_17.quaternion.copy(endpoint_paw_hind_r_17.quaternion);
  }
  mesh_paw_hind_r_17.castShadow = options.castShadow ?? true;
  mesh_paw_hind_r_17.receiveShadow = options.receiveShadow ?? true;
  mesh_paw_hind_r_17.userData.sculptComponent = {"id": "paw-hind-r", "name": "Paw Hind R", "level": "meso", "role": "limb", "importance": 0.8, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rounded paw bulb, wider than the leg shaft, with 2 short grooves splitting 3 visible toes at the front.", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5]], "segments": 16}}, "parent": "leg-hind-r", "attachment": {"parentSocket": "leg-hind-r.distal", "localStart": [0, -0.32, 0.012], "localEnd": [0, -0.36, 0.03], "contactType": "embed", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.04, "endRadius": 0.05, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.1, "height": 0.075, "depth": 0.115, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, -0.32, 0.012], "rotation": [0, 0, 0], "scale": [0.1, 0.075, 0.115]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paw-hind-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paw.toes", "kind": "relief", "description": "3 toe bumps split by 2 grooves at the paw front; repeated identically on all four paws", "region": "paw front", "evidenceRef": "see detailInventory entry mapping to this ref"}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-paw-front"], "details": [], "fidelityTier": "blockout", "mirrorOf": "paw-hind-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of paw-hind-l", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 233, 216, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "white paw, shaded toe grooves — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#f2e9d8", "regions": [{"id": "toe-shade", "kind": "ellipsoid", "color": "#d9cfbd", "center": [0, -0.028, 0.045], "radii": [0.035, 0.02, 0.03], "softness": 0.01}]}};
  node_paw_hind_r_17.add(mesh_paw_hind_r_17);
  meshes["paw-hind-r"] = mesh_paw_hind_r_17;
  colliders["paw-hind-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["paw-hind-r"] ??= [];
  destructionGroups["paw-hind-r"].push(node_paw_hind_r_17);

  const endpoint_tail_18 = makeAttachmentEndpoint(null);
  const node_tail_18 = new THREE.Group();
  node_tail_18.name = "Tail__pivot";
  node_tail_18.scale.set(1, 1, 1);
  if (endpoint_tail_18) {
    node_tail_18.position.copy(endpoint_tail_18.start);
    node_tail_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tail_18.position.set(0.0, 0.085, 0.005);
    node_tail_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_tail_18.userData.sculptComponent = {"id": "tail", "name": "Tail", "level": "macro", "role": "appendage", "importance": 0.95, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Flag tail: swept up at ~78 deg, thick root tapering to a point, tip curving gently forward (sabre).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.0, 0.0], "rx": 0.033, "rz": 0.035, "twist": 0.0}, {"position": [0, 0.1, -0.008], "rx": 0.028, "rz": 0.03, "twist": 0.0}, {"position": [0, 0.2, -0.01], "rx": 0.02, "rz": 0.022, "twist": 0.0}, {"position": [0, 0.27, 0.0], "rx": 0.012, "rz": 0.013, "twist": 0.0}, {"position": [0, 0.3, 0.014], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "torso.rump-top", "localStart": [0, 0.085, 0.005], "localEnd": [0, 0.368, -0.005], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.034, "endRadius": 0.013, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.042, "height": 0.27, "depth": 0.09, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.085, 0.005], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wag", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-tail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 36, 38, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "dark shaft, white tip upper third — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#362426", "regions": [{"id": "white-tip", "kind": "axis-band", "color": "#f2e9d8", "axis": "y", "min": 0.195, "max": 0.34, "softness": 0.015}]}};
  node_tail_18.userData.actionProfile = {"animationRole": "wag", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}};
  (nodes["torso"] ?? root).add(node_tail_18);
  nodes["tail"] = node_tail_18;
  const mesh_tail_18Geometry = endpoint_tail_18
    ? new THREE.CylinderGeometry(endpoint_tail_18.endRadius, endpoint_tail_18.baseRadius, endpoint_tail_18.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0.0, 0.0], "rx": 0.033, "rz": 0.035, "twist": 0.0}, {"position": [0, 0.1, -0.008], "rx": 0.028, "rz": 0.03, "twist": 0.0}, {"position": [0, 0.2, -0.01], "rx": 0.02, "rz": 0.022, "twist": 0.0}, {"position": [0, 0.27, 0.0], "rx": 0.012, "rz": 0.013, "twist": 0.0}, {"position": [0, 0.3, 0.014], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tail_18) {
    mesh_tail_18Geometry.scale(1.0, 1.0, 1.0);
  }
  applyVertexPaint(mesh_tail_18Geometry, "#362426", [{"id": "white-tip", "kind": "axis-band", "color": "#f2e9d8", "softness": 0.015, "axis": "y", "min": 0.195, "max": 0.34}]);
  const mesh_tail_18 = new THREE.Mesh(
    mesh_tail_18Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_18.name = "Tail";
  mesh_tail_18.material = mesh_tail_18.material.clone();
  mesh_tail_18.material.vertexColors = true;
  (mesh_tail_18.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_tail_18) {
    mesh_tail_18.position.copy(endpoint_tail_18.midpoint);
    mesh_tail_18.quaternion.copy(endpoint_tail_18.quaternion);
  }
  mesh_tail_18.castShadow = options.castShadow ?? true;
  mesh_tail_18.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_18.userData.sculptComponent = {"id": "tail", "name": "Tail", "level": "macro", "role": "appendage", "importance": 0.95, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Flag tail: swept up at ~78 deg, thick root tapering to a point, tip curving gently forward (sabre).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0, 0.0, 0.0], "rx": 0.033, "rz": 0.035, "twist": 0.0}, {"position": [0, 0.1, -0.008], "rx": 0.028, "rz": 0.03, "twist": 0.0}, {"position": [0, 0.2, -0.01], "rx": 0.02, "rz": 0.022, "twist": 0.0}, {"position": [0, 0.27, 0.0], "rx": 0.012, "rz": 0.013, "twist": 0.0}, {"position": [0, 0.3, 0.014], "rx": 0.004, "rz": 0.004, "twist": 0.0}], "radialSegments": 10, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "torso.rump-top", "localStart": [0, 0.085, 0.005], "localEnd": [0, 0.368, -0.005], "contactType": "embed", "embedDepth": 0.05, "overlap": 0.05, "gapTolerance": 0.0, "baseRadius": 0.034, "endRadius": 0.013, "note": "PARENT-LOCAL frame; pivot Group sits at localStart; blockout mass spans localStart->localEnd"}, "dimensions": {"width": 0.042, "height": 0.27, "depth": 0.09, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.085, 0.005], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wag", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "coat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-tail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 36, 38, 1.0)", "secondaryAlbedo": "rgba(242, 233, 216, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "dark shaft, white tip upper third — flat toon zones, jagged boundaries; evidence: derived crops"}, "vertexPaint": {"baseColor": "#362426", "regions": [{"id": "white-tip", "kind": "axis-band", "color": "#f2e9d8", "axis": "y", "min": 0.195, "max": 0.34, "softness": 0.015}]}};
  node_tail_18.add(mesh_tail_18);
  meshes["tail"] = mesh_tail_18;
  colliders["tail"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["tail"] ??= [];
  destructionGroups["tail"].push(node_tail_18);

  const endpoint_brow_l_19 = makeAttachmentEndpoint(null);
  const node_brow_l_19 = new THREE.Group();
  node_brow_l_19.name = "Brow L__pivot";
  node_brow_l_19.scale.set(1, 1, 1);
  if (endpoint_brow_l_19) {
    node_brow_l_19.position.copy(endpoint_brow_l_19.start);
    node_brow_l_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_brow_l_19.position.set(0.078, 0.062, 0.082);
    node_brow_l_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_brow_l_19.userData.sculptComponent = {"id": "brow-l", "name": "Brow L", "level": "meso", "role": "head", "importance": 0.6, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Soft brow swell over the eye socket, blended flush into the skull dome; carries the worried-puppy expression (detailInventory brow-ridges).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 12}}, "parent": "head", "attachment": {"parentSocket": "head.brow-l", "localStart": [0.078, 0.062, 0.082], "localEnd": [0.078, 0.075, 0.09], "contactType": "embed", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "note": "embedded swell; lathe route ignores endpoint, node at localStart"}, "dimensions": {"width": 0.075, "height": 0.032, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.078, 0.062, 0.082], "rotation": [0, 0, 0], "scale": [0.075, 0.032, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange brow field with faint furrow shading - flat toon zones"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "furrow", "kind": "ellipsoid", "color": "#a85f28", "center": [0, 0.012, 0.0], "radii": [0.03, 0.008, 0.022], "softness": 0.006}]}};
  node_brow_l_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}};
  (nodes["head"] ?? root).add(node_brow_l_19);
  nodes["brow-l"] = node_brow_l_19;
  const mesh_brow_l_19Geometry = endpoint_brow_l_19
    ? new THREE.CylinderGeometry(endpoint_brow_l_19.endRadius, endpoint_brow_l_19.baseRadius, endpoint_brow_l_19.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 12});
  if (!endpoint_brow_l_19) {
    mesh_brow_l_19Geometry.scale(0.075, 0.032, 0.055);
  }
  applyVertexPaint(mesh_brow_l_19Geometry, "#c1702f", [{"id": "furrow", "kind": "ellipsoid", "color": "#a85f28", "softness": 0.006, "center": [0.0, 0.012, 0.0], "radii": [0.03, 0.008, 0.022]}]);
  const mesh_brow_l_19 = new THREE.Mesh(
    mesh_brow_l_19Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_l_19.name = "Brow L";
  mesh_brow_l_19.material = mesh_brow_l_19.material.clone();
  mesh_brow_l_19.material.vertexColors = true;
  (mesh_brow_l_19.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_brow_l_19) {
    mesh_brow_l_19.position.copy(endpoint_brow_l_19.midpoint);
    mesh_brow_l_19.quaternion.copy(endpoint_brow_l_19.quaternion);
  }
  mesh_brow_l_19.castShadow = options.castShadow ?? true;
  mesh_brow_l_19.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_l_19.userData.sculptComponent = {"id": "brow-l", "name": "Brow L", "level": "meso", "role": "head", "importance": 0.6, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Soft brow swell over the eye socket, blended flush into the skull dome; carries the worried-puppy expression (detailInventory brow-ridges).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 12}}, "parent": "head", "attachment": {"parentSocket": "head.brow-l", "localStart": [0.078, 0.062, 0.082], "localEnd": [0.078, 0.075, 0.09], "contactType": "embed", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "note": "embedded swell; lathe route ignores endpoint, node at localStart"}, "dimensions": {"width": 0.075, "height": 0.032, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.078, 0.062, 0.082], "rotation": [0, 0, 0], "scale": [0.075, 0.032, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange brow field with faint furrow shading - flat toon zones"}, "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "furrow", "kind": "ellipsoid", "color": "#a85f28", "center": [0, 0.012, 0.0], "radii": [0.03, 0.008, 0.022], "softness": 0.006}]}};
  node_brow_l_19.add(mesh_brow_l_19);
  meshes["brow-l"] = mesh_brow_l_19;
  colliders["brow-l"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["eye-l"] ??= [];
  destructionGroups["eye-l"].push(node_brow_l_19);

  const endpoint_brow_r_20 = makeAttachmentEndpoint(null);
  const node_brow_r_20 = new THREE.Group();
  node_brow_r_20.name = "Brow R__pivot";
  node_brow_r_20.scale.set(1, 1, 1);
  if (endpoint_brow_r_20) {
    node_brow_r_20.position.copy(endpoint_brow_r_20.start);
    node_brow_r_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_brow_r_20.position.set(-0.078, 0.062, 0.082);
    node_brow_r_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_brow_r_20.userData.sculptComponent = {"id": "brow-r", "name": "Brow R", "level": "meso", "role": "head", "importance": 0.6, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Soft brow swell over the eye socket, blended flush into the skull dome; carries the worried-puppy expression (detailInventory brow-ridges).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 12}}, "parent": "head", "attachment": {"parentSocket": "head.brow-r", "localStart": [-0.078, 0.062, 0.082], "localEnd": [-0.078, 0.075, 0.09], "contactType": "embed", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "note": "embedded swell; lathe route ignores endpoint, node at localStart"}, "dimensions": {"width": 0.075, "height": 0.032, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.078, 0.062, 0.082], "rotation": [0, 0, 0], "scale": [0.075, 0.032, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange brow field with faint furrow shading - flat toon zones"}, "mirrorOf": "brow-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of brow-l", "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "furrow", "kind": "ellipsoid", "color": "#a85f28", "center": [0, 0.012, 0.0], "radii": [0.03, 0.008, 0.022], "softness": 0.006}]}};
  node_brow_r_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}};
  (nodes["head"] ?? root).add(node_brow_r_20);
  nodes["brow-r"] = node_brow_r_20;
  const mesh_brow_r_20Geometry = endpoint_brow_r_20
    ? new THREE.CylinderGeometry(endpoint_brow_r_20.endRadius, endpoint_brow_r_20.baseRadius, endpoint_brow_r_20.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 12});
  if (!endpoint_brow_r_20) {
    mesh_brow_r_20Geometry.scale(0.075, 0.032, 0.055);
  }
  applyVertexPaint(mesh_brow_r_20Geometry, "#c1702f", [{"id": "furrow", "kind": "ellipsoid", "color": "#a85f28", "softness": 0.006, "center": [0.0, 0.012, 0.0], "radii": [0.03, 0.008, 0.022]}]);
  const mesh_brow_r_20 = new THREE.Mesh(
    mesh_brow_r_20Geometry,
    materialMap["coat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_r_20.name = "Brow R";
  mesh_brow_r_20.material = mesh_brow_r_20.material.clone();
  mesh_brow_r_20.material.vertexColors = true;
  (mesh_brow_r_20.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_brow_r_20) {
    mesh_brow_r_20.position.copy(endpoint_brow_r_20.midpoint);
    mesh_brow_r_20.quaternion.copy(endpoint_brow_r_20.quaternion);
  }
  mesh_brow_r_20.castShadow = options.castShadow ?? true;
  mesh_brow_r_20.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_r_20.userData.sculptComponent = {"id": "brow-r", "name": "Brow R", "level": "meso", "role": "head", "importance": 0.6, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Soft brow swell over the eye socket, blended flush into the skull dome; carries the worried-puppy expression (detailInventory brow-ridges).", "geometryDescriptor": {"topologyIntent": "stylized toon character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, -0.0], [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5]], "segments": 12}}, "parent": "head", "attachment": {"parentSocket": "head.brow-r", "localStart": [-0.078, 0.062, 0.082], "localEnd": [-0.078, 0.075, 0.09], "contactType": "embed", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "note": "embedded swell; lathe route ignores endpoint, node at localStart"}, "dimensions": {"width": 0.075, "height": 0.032, "depth": 0.055, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.078, 0.062, 0.082], "rotation": [0, 0, 0], "scale": [0.075, 0.032, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-mat"}}, "material": "coat", "materialLayers": ["coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.9, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "matte toon fur; relief carried by silhouette + coat boundaries, not maps"}, "evidenceRefs": ["crop-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 112, 47, 1.0)", "secondaryAlbedo": "rgba(150, 80, 49, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "note": "orange brow field with faint furrow shading - flat toon zones"}, "mirrorOf": "brow-l", "chirality": "reflection: (x,y,z) -> (-x,y,z) of brow-l", "vertexPaint": {"baseColor": "#c1702f", "regions": [{"id": "furrow", "kind": "ellipsoid", "color": "#a85f28", "center": [0, 0.012, 0.0], "radii": [0.03, 0.008, 0.022], "softness": 0.006}]}};
  node_brow_r_20.add(mesh_brow_r_20);
  meshes["brow-r"] = mesh_brow_r_20;
  colliders["brow-r"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "game does its own tile collision; proxy only"};
  destructionGroups["eye-l"] ??= [];
  destructionGroups["eye-l"].push(node_brow_r_20);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "stylized-toon-game", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "note": "Deliberate: the deliverable is a cel-shaded game character (MeshToonMaterial on a shared 3-step ramp, NoToneMapping, no texture assets). Every material carries a validated textureless declaration with evidence; the quality-first PBR channel bar (independent roughness/height/normal maps, referencePbr) describes photographic subjects and does not apply. The strict-quality validator honors the textureless declarations; this field keeps the pass-gate on the same footing."};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createBeaglePuppyToonCharacterLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Beagle Puppy Toon Character look-dev lights";
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
  lights.userData.lightingFromPhoto = ["warm key from upper camera-left (soft toon banding on skull and back)", "pale warm ambient fill (cream background bounce)", "exposure 1.0, NoToneMapping — deliberate: a filmic tone curve would re-compress the 3-step toon ramp bands", "contact shadow under paws; no rim light"];
  lights.userData.lookDevTargets = {"qualityPriority": "stylized-toon-game", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "note": "Deliberate: the deliverable is a cel-shaded game character (MeshToonMaterial on a shared 3-step ramp, NoToneMapping, no texture assets). Every material carries a validated textureless declaration with evidence; the quality-first PBR channel bar (independent roughness/height/normal maps, referencePbr) describes photographic subjects and does not apply. The strict-quality validator honors the textureless declarations; this field keeps the pass-gate on the same footing."};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createBeaglePuppyToonCharacterEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameBeaglePuppyToonCharacterCamera(
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
export function createBeaglePuppyToonCharacterPresentationComposer(
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

export function configureBeaglePuppyToonCharacterRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createBeaglePuppyToonCharacterInspectControls(
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
