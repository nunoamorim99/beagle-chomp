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

// Generated from ObjectSculptSpec target: Cartoon Flea
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCartoonFleaModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Cartoon Flea";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["cuticleBody"] = createSculptMaterial(
    "cuticleBody",
    {"id": "cuticleBody", "name": "Body cuticle (TEAM COLOUR)", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the project's shared 3-step gradient ramp (src/render/toon.ts)", "baseColor": "#B85C22", "color": "#B85C22", "albedo": {"dominant": "#B85C22", "secondary": []}, "colorVariation": {"palette": ["#B85C22"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.06, "note": "Observed satin sweep across the dorsal cuticle varies slightly with curvature. Recorded as observation - MeshToonMaterial has no roughness channel to set."}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "localOverrides": [{"id": "dorsalRamp", "kind": "stain", "region": "abdomen dorsal surface", "description": "Observed ordered ramp #D98A45 -> #C06A2C -> #B85C22, antero-ventral to postero-dorsal.", "appliedAs": "NOT applied as a gradient - the toon ramp would band it anyway, and the body colour is team-driven. Recorded as observation only.", "detailRef": "band-value-ramp"}, {"id": "bandCrevice", "kind": "linework", "region": "inter-band crevices", "description": "Dark line in each crevice; what keeps the bands legible once the relief is too shallow to shade at gameplay size.", "appliedAs": "geometry - the crevice is a real step between band tiles, shaded by the ramp.", "detailRef": "band-separator-line"}], "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and the values above are the OBSERVED finish, recorded for evidence, not channels to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "notes": "THE TEAM-COLOUR MATERIAL. Becomes GhostUserData.bodyMat. The hex here is the reference's observed dorsal hue and is only a placeholder for review renders - at runtime the consumer passes one of three team colours (COLORS.ghost*) and applyGhostState recolours it again for the frightened and eaten states. Never hardcode the brown.", "textureless": {"declared": true, "evidence": ["image-analysis.md Layer 5: the reference is a flat cel-shaded cartoon - one satin cuticle tone per region, no grain, no pores, no print, no weave. Its identity is silhouette, proportion and the boundaries between flat colour regions.", "projection-route.md: the consumer is cel-shaded (MeshToonMaterial on a shared 3-step ramp under NoToneMapping). A texture entering that ramp is quantised into the same 3 bands as a flat colour, so no texture channel can survive to the screen.", "CLAUDE.md (consumer): meshes and textures are built in code; the only textures in the product are procedurally generated wall/floor surfaces. A baked character map would be the project's first, and this is an offline-capable PWA that deliberately fetches no texture assets.", "detail-inventory.json evidenceIntegrityWarning: flea1.png carries a stock watermark across the body, so no source pixel is usable as PBR evidence in the first place - referencePbr is not merely unavailable, it would be contaminated."], "notes": "Declared per validate_textureless: the subject genuinely carries no texture detail. Every texture-authoring field is removed rather than filled with numbers the renderer will never read."}},
    options
  );
  materialMap["cuticleDark"] = createSculptMaterial(
    "cuticleDark",
    {"id": "cuticleDark", "name": "Dark cuticle (accent)", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the project's shared 3-step gradient ramp (src/render/toon.ts)", "baseColor": "#6B2F12", "color": "#6B2F12", "albedo": {"dominant": "#6B2F12", "secondary": []}, "colorVariation": {"palette": ["#6B2F12"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.5, "variation": 0.06, "note": "Observed satin sweep across the dorsal cuticle varies slightly with curvature. Recorded as observation - MeshToonMaterial has no roughness channel to set."}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and the values above are the OBSERVED finish, recorded for evidence, not channels to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "notes": "Limbs, antennae, belly, rostrum and mouth line. Goes into GhostUserData.accentMats so it follows the frightened recolour - otherwise a frightened flea would keep dark limbs and blunt the 'edible now' read, which is exactly the defect the ladybug's notes record.", "textureless": {"declared": true, "evidence": ["image-analysis.md Layer 5: the reference is a flat cel-shaded cartoon - one satin cuticle tone per region, no grain, no pores, no print, no weave. Its identity is silhouette, proportion and the boundaries between flat colour regions.", "projection-route.md: the consumer is cel-shaded (MeshToonMaterial on a shared 3-step ramp under NoToneMapping). A texture entering that ramp is quantised into the same 3 bands as a flat colour, so no texture channel can survive to the screen.", "CLAUDE.md (consumer): meshes and textures are built in code; the only textures in the product are procedurally generated wall/floor surfaces. A baked character map would be the project's first, and this is an offline-capable PWA that deliberately fetches no texture assets.", "detail-inventory.json evidenceIntegrityWarning: flea1.png carries a stock watermark across the body, so no source pixel is usable as PBR evidence in the first place - referencePbr is not merely unavailable, it would be contaminated."], "notes": "Declared per validate_textureless: the subject genuinely carries no texture detail. Every texture-authoring field is removed rather than filled with numbers the renderer will never read."}},
    options
  );
  materialMap["sclera"] = createSculptMaterial(
    "sclera",
    {"id": "sclera", "name": "Sclera", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the project's shared 3-step gradient ramp (src/render/toon.ts)", "baseColor": "#FDF9F2", "color": "#FDF9F2", "albedo": {"dominant": "#FDF9F2", "secondary": []}, "colorVariation": {"palette": ["#FDF9F2"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and the values above are the OBSERVED finish, recorded for evidence, not channels to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "notes": "Eye white. Listed in GhostUserData.eyes so it survives the eaten state, where the body is hidden.", "textureless": {"declared": true, "evidence": ["image-analysis.md Layer 5: the reference is a flat cel-shaded cartoon - one satin cuticle tone per region, no grain, no pores, no print, no weave. Its identity is silhouette, proportion and the boundaries between flat colour regions.", "projection-route.md: the consumer is cel-shaded (MeshToonMaterial on a shared 3-step ramp under NoToneMapping). A texture entering that ramp is quantised into the same 3 bands as a flat colour, so no texture channel can survive to the screen.", "CLAUDE.md (consumer): meshes and textures are built in code; the only textures in the product are procedurally generated wall/floor surfaces. A baked character map would be the project's first, and this is an offline-capable PWA that deliberately fetches no texture assets.", "detail-inventory.json evidenceIntegrityWarning: flea1.png carries a stock watermark across the body, so no source pixel is usable as PBR evidence in the first place - referencePbr is not merely unavailable, it would be contaminated."], "notes": "Declared per validate_textureless: the subject genuinely carries no texture detail. Every texture-authoring field is removed rather than filled with numbers the renderer will never read."}},
    options
  );
  materialMap["iris"] = createSculptMaterial(
    "iris",
    {"id": "iris", "name": "Iris", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the project's shared 3-step gradient ramp (src/render/toon.ts)", "baseColor": "#E8A317", "color": "#E8A317", "albedo": {"dominant": "#E8A317", "secondary": []}, "colorVariation": {"palette": ["#E8A317"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.35, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and the values above are the OBSERVED finish, recorded for evidence, not channels to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "notes": "Amber, per the reference. NOTE: the existing enemy skins all use a blue iris (#2F7FD4). Amber is what flea1 shows and it separates this skin from the others - flagged for the review as a deliberate divergence from the house eye, not an oversight.", "textureless": {"declared": true, "evidence": ["image-analysis.md Layer 5: the reference is a flat cel-shaded cartoon - one satin cuticle tone per region, no grain, no pores, no print, no weave. Its identity is silhouette, proportion and the boundaries between flat colour regions.", "projection-route.md: the consumer is cel-shaded (MeshToonMaterial on a shared 3-step ramp under NoToneMapping). A texture entering that ramp is quantised into the same 3 bands as a flat colour, so no texture channel can survive to the screen.", "CLAUDE.md (consumer): meshes and textures are built in code; the only textures in the product are procedurally generated wall/floor surfaces. A baked character map would be the project's first, and this is an offline-capable PWA that deliberately fetches no texture assets.", "detail-inventory.json evidenceIntegrityWarning: flea1.png carries a stock watermark across the body, so no source pixel is usable as PBR evidence in the first place - referencePbr is not merely unavailable, it would be contaminated."], "notes": "Declared per validate_textureless: the subject genuinely carries no texture detail. Every texture-authoring field is removed rather than filled with numbers the renderer will never read."}},
    options
  );
  materialMap["pupil"] = createSculptMaterial(
    "pupil",
    {"id": "pupil", "name": "Pupil", "type": "toon", "shaderModel": "THREE.MeshToonMaterial on the project's shared 3-step gradient ramp (src/render/toon.ts)", "baseColor": "#0A0C12", "color": "#0A0C12", "albedo": {"dominant": "#0A0C12", "secondary": []}, "colorVariation": {"palette": ["#0A0C12"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.35, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and the values above are the OBSERVED finish, recorded for evidence, not channels to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "notes": "Near-black. Becomes GhostUserData.pupM; pupBaseColor is read from it.", "textureless": {"declared": true, "evidence": ["image-analysis.md Layer 5: the reference is a flat cel-shaded cartoon - one satin cuticle tone per region, no grain, no pores, no print, no weave. Its identity is silhouette, proportion and the boundaries between flat colour regions.", "projection-route.md: the consumer is cel-shaded (MeshToonMaterial on a shared 3-step ramp under NoToneMapping). A texture entering that ramp is quantised into the same 3 bands as a flat colour, so no texture channel can survive to the screen.", "CLAUDE.md (consumer): meshes and textures are built in code; the only textures in the product are procedurally generated wall/floor surfaces. A baked character map would be the project's first, and this is an offline-capable PWA that deliberately fetches no texture assets.", "detail-inventory.json evidenceIntegrityWarning: flea1.png carries a stock watermark across the body, so no source pixel is usable as PBR evidence in the first place - referencePbr is not merely unavailable, it would be contaminated."], "notes": "Declared per validate_textureless: the subject genuinely carries no texture detail. Every texture-authoring field is removed rather than filled with numbers the renderer will never read."}},
    options
  );
  materialMap["glint"] = createSculptMaterial(
    "glint",
    {"id": "glint", "name": "Catchlight", "type": "basic", "shaderModel": "THREE.MeshBasicMaterial (UNLIT)", "baseColor": "#FFFFFF", "color": "#FFFFFF", "albedo": {"dominant": "#FFFFFF", "secondary": []}, "colorVariation": {"palette": ["#FFFFFF"], "pattern": "flat", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.0, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.0, "contactShadowBias": 0.0, "notes": "No AO map. A toon ramp quantises AO into the same bands as everything else."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "emissive": {"color": "#FFFFFF", "intensity": 0.5}, "localOverrides": [], "shaderNotes": ["MeshToonMaterial ONLY, built through toon({...}) - roughness/metalness do not exist on a toon material and the values above are the OBSERVED finish, recorded for evidence, not channels to set.", "Renderer runs NoToneMapping; a filmic curve re-compresses the ramp's bands and undoes cel shading.", "Never new THREE.MeshStandardMaterial in this project."], "notes": "UNLIT, and deliberately so. This is the project's one documented exception to cel shading: a toon ramp quantises a highlight into the same band as everything else facing the light, so it stops reading as a catchlight. MeshBasicMaterial.", "textureless": {"declared": true, "evidence": ["image-analysis.md Layer 5: the reference is a flat cel-shaded cartoon - one satin cuticle tone per region, no grain, no pores, no print, no weave. Its identity is silhouette, proportion and the boundaries between flat colour regions.", "projection-route.md: the consumer is cel-shaded (MeshToonMaterial on a shared 3-step ramp under NoToneMapping). A texture entering that ramp is quantised into the same 3 bands as a flat colour, so no texture channel can survive to the screen.", "CLAUDE.md (consumer): meshes and textures are built in code; the only textures in the product are procedurally generated wall/floor surfaces. A baked character map would be the project's first, and this is an offline-capable PWA that deliberately fetches no texture assets.", "detail-inventory.json evidenceIntegrityWarning: flea1.png carries a stock watermark across the body, so no source pixel is usable as PBR evidence in the first place - referencePbr is not merely unavailable, it would be contaminated."], "notes": "Declared per validate_textureless: the subject genuinely carries no texture detail. Every texture-authoring field is removed rather than filled with numbers the renderer will never read."}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_abdomen_0 = makeAttachmentEndpoint(null);
  const node_abdomen_0 = new THREE.Group();
  node_abdomen_0.name = "Abdomen (fused thorax)__pivot";
  node_abdomen_0.scale.set(1, 1, 1);
  if (endpoint_abdomen_0) {
    node_abdomen_0.position.copy(endpoint_abdomen_0.start);
    node_abdomen_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_abdomen_0.position.set(0.0, 0.315, -0.11);
    node_abdomen_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_abdomen_0.userData.sculptComponent = {"id": "abdomen", "name": "Abdomen (fused thorax)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "A single continuous convex mass with no hard edges - the reference shows one tangent-continuous ovoid. Picking a box or a capsule here would lose the dorsal arch, which is identity rank 5. Thorax is FUSED into it: no separate thoracic mass is resolvable in either reference. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "root-body-mount", "localStart": [0, 0, 0.24], "localEnd": [0, 0, -0.24], "contactType": "embed", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Mounted on the container root; the origin is the body centre. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.28800000000000003, "height": 0.304, "depth": 0.48, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0, 0.315, -0.11], "rotation": [0.0, 0.0, 0.0], "scale": [0.28800000000000003, 0.304, 0.48]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleBody", "materialLayers": ["cuticleBody"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "profileArch", "kind": "ridge", "description": "Dorsal crown is lifted so it sits ABOVE the head crown (0.467 vs 0.460 world units). A level back reads as a beetle.", "detailRef": "dorsal-hump"}, {"id": "ventralFlatten", "kind": "bevel", "description": "Underside flattened toward the belly plane so the limb sockets sit on a surface rather than on a curve.", "detailRef": null}, {"id": "segmentBands", "kind": "ridge", "description": "Six transverse bands wrapping dorso-ventrally, each posterior edge stepping proud of the one behind it. Built as surface-conformal tiles sharing the abdomen's own transform. IDENTITY RANK 1."}, {"id": "setaeDropped", "kind": "linework", "description": "Setae rows observed along every band edge are DELIBERATELY NOT BUILT: sub-pixel at target size, and per-hair geometry would alias into speckle. The band step and crevice line carry the same read."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Carries the team colour. This is the largest coloured area on the model."}, "evidenceRefs": ["full-object", "zone-r1c1", "zone-r1c2"], "details": ["segment-band-ridge", "band-separator-line", "band-value-ramp", "dorsal-hump"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 92, 34, 1.0)", "secondaryAlbedo": "rgba(217, 138, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object", "zone-r1c1", "zone-r1c2"], "notes": "Chitinous cuticle. Satin dielectric, roughness ~0.45, no subsurface. PLACEHOLDER HUE: overridden by the consumer's team colour at build time.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_abdomen_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_abdomen_0);
  nodes["abdomen"] = node_abdomen_0;
  const mesh_abdomen_0Geometry = endpoint_abdomen_0
    ? new THREE.CylinderGeometry(endpoint_abdomen_0.endRadius, endpoint_abdomen_0.baseRadius, endpoint_abdomen_0.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_abdomen_0) {
    mesh_abdomen_0Geometry.scale(0.28800000000000003, 0.304, 0.48);
  }
  const mesh_abdomen_0 = new THREE.Mesh(
    mesh_abdomen_0Geometry,
    materialMap["cuticleBody"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_abdomen_0.name = "Abdomen (fused thorax)";
  if (endpoint_abdomen_0) {
    mesh_abdomen_0.position.copy(endpoint_abdomen_0.midpoint);
    mesh_abdomen_0.quaternion.copy(endpoint_abdomen_0.quaternion);
  }
  mesh_abdomen_0.castShadow = options.castShadow ?? true;
  mesh_abdomen_0.receiveShadow = options.receiveShadow ?? true;
  mesh_abdomen_0.userData.sculptComponent = {"id": "abdomen", "name": "Abdomen (fused thorax)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "A single continuous convex mass with no hard edges - the reference shows one tangent-continuous ovoid. Picking a box or a capsule here would lose the dorsal arch, which is identity rank 5. Thorax is FUSED into it: no separate thoracic mass is resolvable in either reference. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "root-body-mount", "localStart": [0, 0, 0.24], "localEnd": [0, 0, -0.24], "contactType": "embed", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Mounted on the container root; the origin is the body centre. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.28800000000000003, "height": 0.304, "depth": 0.48, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0, 0.315, -0.11], "rotation": [0.0, 0.0, 0.0], "scale": [0.28800000000000003, 0.304, 0.48]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleBody", "materialLayers": ["cuticleBody"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "profileArch", "kind": "ridge", "description": "Dorsal crown is lifted so it sits ABOVE the head crown (0.467 vs 0.460 world units). A level back reads as a beetle.", "detailRef": "dorsal-hump"}, {"id": "ventralFlatten", "kind": "bevel", "description": "Underside flattened toward the belly plane so the limb sockets sit on a surface rather than on a curve.", "detailRef": null}, {"id": "segmentBands", "kind": "ridge", "description": "Six transverse bands wrapping dorso-ventrally, each posterior edge stepping proud of the one behind it. Built as surface-conformal tiles sharing the abdomen's own transform. IDENTITY RANK 1."}, {"id": "setaeDropped", "kind": "linework", "description": "Setae rows observed along every band edge are DELIBERATELY NOT BUILT: sub-pixel at target size, and per-hair geometry would alias into speckle. The band step and crevice line carry the same read."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Carries the team colour. This is the largest coloured area on the model."}, "evidenceRefs": ["full-object", "zone-r1c1", "zone-r1c2"], "details": ["segment-band-ridge", "band-separator-line", "band-value-ramp", "dorsal-hump"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 92, 34, 1.0)", "secondaryAlbedo": "rgba(217, 138, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object", "zone-r1c1", "zone-r1c2"], "notes": "Chitinous cuticle. Satin dielectric, roughness ~0.45, no subsurface. PLACEHOLDER HUE: overridden by the consumer's team colour at build time.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_abdomen_0.add(mesh_abdomen_0);
  meshes["abdomen"] = mesh_abdomen_0;
  colliders["abdomen"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_head_1 = makeAttachmentEndpoint(null);
  const node_head_1 = new THREE.Group();
  node_head_1.name = "Head capsule__pivot";
  node_head_1.scale.set(1, 1, 1);
  if (endpoint_head_1) {
    node_head_1.position.copy(endpoint_head_1.start);
    node_head_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_1.position.set(0.0, 0.3, 0.22);
    node_head_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_1.userData.sculptComponent = {"id": "head", "name": "Head capsule", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Near-spherical continuous mass, slightly flattened front-to-back. No neck: it embeds directly into the abdomen (0.25 HD of overlap). Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "abdomen-anterior", "localStart": [0, 0, -0.16], "localEnd": [0, 0, 0.16], "contactType": "embed", "embedDepth": 0.08, "gapTolerance": 0.002, "confidence": 0.95, "notes": "0.25 HD (0.08 world units) of overlap into the abdomen. THERE IS NO NECK - both references show the head capsule intersecting the body mass directly, so a neck component would be invention. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.32, "height": 0.32, "depth": 0.2944, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [0.0, 0.3, 0.22], "rotation": [0.0, 0.0, 0.0], "scale": [0.32, 0.32, 0.2944]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleBody", "materialLayers": ["cuticleBody"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "abdomenEmbed", "kind": "seam", "description": "Head intersects the abdomen directly, ~0.25 HD of overlap. There is NO neck component - adding one would be invention.", "detailRef": null}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Also carries the team colour, which is what gives this skin a large enough coloured area to read at gameplay size."}, "evidenceRefs": ["full-object", "zone-r0c0"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 92, 34, 1.0)", "secondaryAlbedo": "rgba(217, 138, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object", "zone-r0c0"], "notes": "Chitinous cuticle. Satin dielectric, roughness ~0.45, no subsurface. PLACEHOLDER HUE: overridden by the consumer's team colour at build time.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_head_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_head_1);
  nodes["head"] = node_head_1;
  const mesh_head_1Geometry = endpoint_head_1
    ? new THREE.CylinderGeometry(endpoint_head_1.endRadius, endpoint_head_1.baseRadius, endpoint_head_1.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_head_1) {
    mesh_head_1Geometry.scale(0.32, 0.32, 0.2944);
  }
  const mesh_head_1 = new THREE.Mesh(
    mesh_head_1Geometry,
    materialMap["cuticleBody"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_1.name = "Head capsule";
  if (endpoint_head_1) {
    mesh_head_1.position.copy(endpoint_head_1.midpoint);
    mesh_head_1.quaternion.copy(endpoint_head_1.quaternion);
  }
  mesh_head_1.castShadow = options.castShadow ?? true;
  mesh_head_1.receiveShadow = options.receiveShadow ?? true;
  mesh_head_1.userData.sculptComponent = {"id": "head", "name": "Head capsule", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Near-spherical continuous mass, slightly flattened front-to-back. No neck: it embeds directly into the abdomen (0.25 HD of overlap). Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "abdomen-anterior", "localStart": [0, 0, -0.16], "localEnd": [0, 0, 0.16], "contactType": "embed", "embedDepth": 0.08, "gapTolerance": 0.002, "confidence": 0.95, "notes": "0.25 HD (0.08 world units) of overlap into the abdomen. THERE IS NO NECK - both references show the head capsule intersecting the body mass directly, so a neck component would be invention. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.32, "height": 0.32, "depth": 0.2944, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [0.0, 0.3, 0.22], "rotation": [0.0, 0.0, 0.0], "scale": [0.32, 0.32, 0.2944]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleBody", "materialLayers": ["cuticleBody"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "abdomenEmbed", "kind": "seam", "description": "Head intersects the abdomen directly, ~0.25 HD of overlap. There is NO neck component - adding one would be invention.", "detailRef": null}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Also carries the team colour, which is what gives this skin a large enough coloured area to read at gameplay size."}, "evidenceRefs": ["full-object", "zone-r0c0"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 92, 34, 1.0)", "secondaryAlbedo": "rgba(217, 138, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75, "evidenceRefs": ["full-object", "zone-r0c0"], "notes": "Chitinous cuticle. Satin dielectric, roughness ~0.45, no subsurface. PLACEHOLDER HUE: overridden by the consumer's team colour at build time.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_head_1.add(mesh_head_1);
  meshes["head"] = mesh_head_1;
  colliders["head"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_belly_2 = makeAttachmentEndpoint(null);
  const node_belly_2 = new THREE.Group();
  node_belly_2.name = "Ventral plug__pivot";
  node_belly_2.scale.set(1, 1, 1);
  if (endpoint_belly_2) {
    node_belly_2.position.copy(endpoint_belly_2.start);
    node_belly_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_belly_2.position.set(0.0, 0.183, -0.11);
    node_belly_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_belly_2.userData.sculptComponent = {"id": "belly", "name": "Ventral plug", "level": "meso", "role": "body", "importance": 0.5, "confidence": 0.6, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Darker underside mass the limbs grow from; also hides the segment-band tiles where they wrap under.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "abdomen", "attachment": {"parentId": "abdomen", "parentSocket": "abdomen-ventral", "localStart": [0, 0, 0.21], "localEnd": [0, 0, -0.21], "contactType": "embed", "embedDepth": 0.03, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the abdomen so no seam shows at the waterline."}, "dimensions": {"width": 0.27072, "height": 0.1216, "depth": 0.432, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.183, -0.11], "rotation": [0, 0, 0], "scale": [0.27072, 0.1216, 0.432]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Same role the ladybug's belly plays - it is what the limb sockets attach to."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_belly_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["abdomen"] ?? root).add(node_belly_2);
  nodes["belly"] = node_belly_2;
  const mesh_belly_2Geometry = endpoint_belly_2
    ? new THREE.CylinderGeometry(endpoint_belly_2.endRadius, endpoint_belly_2.baseRadius, endpoint_belly_2.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_belly_2) {
    mesh_belly_2Geometry.scale(0.27072, 0.1216, 0.432);
  }
  const mesh_belly_2 = new THREE.Mesh(
    mesh_belly_2Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_belly_2.name = "Ventral plug";
  if (endpoint_belly_2) {
    mesh_belly_2.position.copy(endpoint_belly_2.midpoint);
    mesh_belly_2.quaternion.copy(endpoint_belly_2.quaternion);
  }
  mesh_belly_2.castShadow = options.castShadow ?? true;
  mesh_belly_2.receiveShadow = options.receiveShadow ?? true;
  mesh_belly_2.userData.sculptComponent = {"id": "belly", "name": "Ventral plug", "level": "meso", "role": "body", "importance": 0.5, "confidence": 0.6, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Darker underside mass the limbs grow from; also hides the segment-band tiles where they wrap under.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "abdomen", "attachment": {"parentId": "abdomen", "parentSocket": "abdomen-ventral", "localStart": [0, 0, 0.21], "localEnd": [0, 0, -0.21], "contactType": "embed", "embedDepth": 0.03, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Sunk into the abdomen so no seam shows at the waterline."}, "dimensions": {"width": 0.27072, "height": 0.1216, "depth": 0.432, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.183, -0.11], "rotation": [0, 0, 0], "scale": [0.27072, 0.1216, 0.432]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Same role the ladybug's belly plays - it is what the limb sockets attach to."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["full-object"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_belly_2.add(mesh_belly_2);
  meshes["belly"] = mesh_belly_2;
  colliders["belly"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_rostrum_boss_3 = makeAttachmentEndpoint(null);
  const node_rostrum_boss_3 = new THREE.Group();
  node_rostrum_boss_3.name = "Rostrum boss__pivot";
  node_rostrum_boss_3.scale.set(1, 1, 1);
  if (endpoint_rostrum_boss_3) {
    node_rostrum_boss_3.position.copy(endpoint_rostrum_boss_3.start);
    node_rostrum_boss_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rostrum_boss_3.position.set(0.0, 0.2616, 0.35760000000000003);
    node_rostrum_boss_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_rostrum_boss_3.userData.sculptComponent = {"id": "rostrum-boss", "name": "Rostrum boss", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Small rounded boss with real relief, darker than the head. Reads as a nose in the cartoon treatment; anatomically stands in for the rostrum.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-anterior", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0256], "contactType": "embed", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.85, "notes": "A real boss with its own relief, sunk into the head so it reads as part of the capsule rather than a stuck-on bead."}, "dimensions": {"width": 0.064, "height": 0.0576, "depth": 0.0512, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.2616, 0.35760000000000003], "rotation": [0, 0, 0], "scale": [0.064, 0.0576, 0.0512]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["rostrum-bump"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_rostrum_boss_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_rostrum_boss_3);
  nodes["rostrum-boss"] = node_rostrum_boss_3;
  const mesh_rostrum_boss_3Geometry = endpoint_rostrum_boss_3
    ? new THREE.CylinderGeometry(endpoint_rostrum_boss_3.endRadius, endpoint_rostrum_boss_3.baseRadius, endpoint_rostrum_boss_3.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_rostrum_boss_3) {
    mesh_rostrum_boss_3Geometry.scale(0.064, 0.0576, 0.0512);
  }
  const mesh_rostrum_boss_3 = new THREE.Mesh(
    mesh_rostrum_boss_3Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rostrum_boss_3.name = "Rostrum boss";
  if (endpoint_rostrum_boss_3) {
    mesh_rostrum_boss_3.position.copy(endpoint_rostrum_boss_3.midpoint);
    mesh_rostrum_boss_3.quaternion.copy(endpoint_rostrum_boss_3.quaternion);
  }
  mesh_rostrum_boss_3.castShadow = options.castShadow ?? true;
  mesh_rostrum_boss_3.receiveShadow = options.receiveShadow ?? true;
  mesh_rostrum_boss_3.userData.sculptComponent = {"id": "rostrum-boss", "name": "Rostrum boss", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Small rounded boss with real relief, darker than the head. Reads as a nose in the cartoon treatment; anatomically stands in for the rostrum.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-anterior", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0256], "contactType": "embed", "embedDepth": 0.012, "gapTolerance": 0.002, "confidence": 0.85, "notes": "A real boss with its own relief, sunk into the head so it reads as part of the capsule rather than a stuck-on bead."}, "dimensions": {"width": 0.064, "height": 0.0576, "depth": 0.0512, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0, 0.2616, 0.35760000000000003], "rotation": [0, 0, 0], "scale": [0.064, 0.0576, 0.0512]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["rostrum-bump"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_rostrum_boss_3.add(mesh_rostrum_boss_3);
  meshes["rostrum-boss"] = mesh_rostrum_boss_3;
  colliders["rostrum-boss"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_mouth_line_4 = makeAttachmentEndpoint(null);
  const node_mouth_line_4 = new THREE.Group();
  node_mouth_line_4.name = "Mouth curve__pivot";
  node_mouth_line_4.scale.set(1, 1, 1);
  if (endpoint_mouth_line_4) {
    node_mouth_line_4.position.copy(endpoint_mouth_line_4.start);
    node_mouth_line_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_line_4.position.set(0.0, 0.2168, 0.348);
    node_mouth_line_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_line_4.userData.sculptComponent = {"id": "mouth-line", "name": "Mouth curve", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "A shallow surface-conformal curve, NOT an aperture. Neither reference depicts a mouth opening or mouthparts, so no hole is cut. A torus arc lying on the head surface.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as torus-arc)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-anterior-lower", "localStart": [-0.048, 0, 0], "localEnd": [0.048, 0, 0], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Surface relief lying ON the head curve. Not an aperture - no hole is cut."}, "dimensions": {"width": 0.096, "height": 0.032, "depth": 0.0128, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0, 0.2168, 0.348], "rotation": [0, 0, 0], "scale": [0.096, 0.032, 0.0128]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["mouth-curve"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_mouth_line_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_mouth_line_4);
  nodes["mouth-line"] = node_mouth_line_4;
  const mesh_mouth_line_4Geometry = endpoint_mouth_line_4
    ? new THREE.CylinderGeometry(endpoint_mouth_line_4.endRadius, endpoint_mouth_line_4.baseRadius, endpoint_mouth_line_4.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.08, 8, 16);
  if (!endpoint_mouth_line_4) {
    mesh_mouth_line_4Geometry.scale(0.096, 0.032, 0.0128);
  }
  const mesh_mouth_line_4 = new THREE.Mesh(
    mesh_mouth_line_4Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_line_4.name = "Mouth curve";
  if (endpoint_mouth_line_4) {
    mesh_mouth_line_4.position.copy(endpoint_mouth_line_4.midpoint);
    mesh_mouth_line_4.quaternion.copy(endpoint_mouth_line_4.quaternion);
  }
  mesh_mouth_line_4.castShadow = options.castShadow ?? true;
  mesh_mouth_line_4.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_line_4.userData.sculptComponent = {"id": "mouth-line", "name": "Mouth curve", "level": "meso", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "A shallow surface-conformal curve, NOT an aperture. Neither reference depicts a mouth opening or mouthparts, so no hole is cut. A torus arc lying on the head surface.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as torus-arc)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-anterior-lower", "localStart": [-0.048, 0, 0], "localEnd": [0.048, 0, 0], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Surface relief lying ON the head curve. Not an aperture - no hole is cut."}, "dimensions": {"width": 0.096, "height": 0.032, "depth": 0.0128, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0, 0.2168, 0.348], "rotation": [0, 0, 0], "scale": [0.096, 0.032, 0.0128]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["mouth-curve"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_mouth_line_4.add(mesh_mouth_line_4);
  meshes["mouth-line"] = mesh_mouth_line_4;
  colliders["mouth-line"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_eye_l_5 = makeAttachmentEndpoint(null);
  const node_eye_l_5 = new THREE.Group();
  node_eye_l_5.name = "Eye (left)__pivot";
  node_eye_l_5.scale.set(1, 1, 1);
  if (endpoint_eye_l_5) {
    node_eye_l_5.position.copy(endpoint_eye_l_5.start);
    node_eye_l_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_l_5.position.set(0.0811, 0.316, 0.3352);
    node_eye_l_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_l_5.userData.sculptComponent = {"id": "eye-l", "name": "Eye (left)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Sclera ball protruding from the head, per the character-track eye recipe. Must stay solid in the consumer's 'eaten' state, where the body is hidden and only the eyes remain.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-eye-socket-l", "localStart": [0, 0, -0.054400000000000004], "localEnd": [0, 0, 0.054400000000000004], "contactType": "embed", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.95, "notes": "Sclera ball protruding from the head capsule as a convex boss, per the reference."}, "dimensions": {"width": 0.10880000000000001, "height": 0.10880000000000001, "depth": 0.10880000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [0.0811, 0.316, 0.3352], "rotation": [0, 0, 0], "scale": [0.10880000000000001, 0.10880000000000001, 0.10880000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rimContour", "kind": "contour", "description": "Dark rim separating the near-white sclera from the warm head cuticle; without it they bleed together at gameplay size.", "detailRef": "eye-dark-rim"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-dark-rim"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 249, 242, 1.0)", "secondaryAlbedo": "rgba(226, 219, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Warm off-white eye white, opaque.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_eye_l_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_eye_l_5);
  nodes["eye-l"] = node_eye_l_5;
  const mesh_eye_l_5Geometry = endpoint_eye_l_5
    ? new THREE.CylinderGeometry(endpoint_eye_l_5.endRadius, endpoint_eye_l_5.baseRadius, endpoint_eye_l_5.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_eye_l_5) {
    mesh_eye_l_5Geometry.scale(0.10880000000000001, 0.10880000000000001, 0.10880000000000001);
  }
  const mesh_eye_l_5 = new THREE.Mesh(
    mesh_eye_l_5Geometry,
    materialMap["sclera"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_l_5.name = "Eye (left)";
  if (endpoint_eye_l_5) {
    mesh_eye_l_5.position.copy(endpoint_eye_l_5.midpoint);
    mesh_eye_l_5.quaternion.copy(endpoint_eye_l_5.quaternion);
  }
  mesh_eye_l_5.castShadow = options.castShadow ?? true;
  mesh_eye_l_5.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_l_5.userData.sculptComponent = {"id": "eye-l", "name": "Eye (left)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Sclera ball protruding from the head, per the character-track eye recipe. Must stay solid in the consumer's 'eaten' state, where the body is hidden and only the eyes remain.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-eye-socket-l", "localStart": [0, 0, -0.054400000000000004], "localEnd": [0, 0, 0.054400000000000004], "contactType": "embed", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.95, "notes": "Sclera ball protruding from the head capsule as a convex boss, per the reference."}, "dimensions": {"width": 0.10880000000000001, "height": 0.10880000000000001, "depth": 0.10880000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [0.0811, 0.316, 0.3352], "rotation": [0, 0, 0], "scale": [0.10880000000000001, 0.10880000000000001, 0.10880000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rimContour", "kind": "contour", "description": "Dark rim separating the near-white sclera from the warm head cuticle; without it they bleed together at gameplay size.", "detailRef": "eye-dark-rim"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-dark-rim"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 249, 242, 1.0)", "secondaryAlbedo": "rgba(226, 219, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Warm off-white eye white, opaque.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_eye_l_5.add(mesh_eye_l_5);
  meshes["eye-l"] = mesh_eye_l_5;
  colliders["eye-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_iris_l_6 = makeAttachmentEndpoint(null);
  const node_iris_l_6 = new THREE.Group();
  node_iris_l_6.name = "Iris L__pivot";
  node_iris_l_6.scale.set(1, 1, 1);
  if (endpoint_iris_l_6) {
    node_iris_l_6.position.copy(endpoint_iris_l_6.start);
    node_iris_l_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_iris_l_6.position.set(0.0811, 0.616, 0.5552);
    node_iris_l_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_iris_l_6.userData.sculptComponent = {"id": "iris-l", "name": "Iris L", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-l", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11010560000000001, "height": 0.11010560000000001, "depth": 0.11010560000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11010560000000001, 0.11010560000000001, 0.11010560000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "iris", "materialLayers": ["iris"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 163, 23, 1.0)", "secondaryAlbedo": "rgba(198, 133, 15, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Amber iris, per the reference. Diverges from the blue used by every other enemy skin - deliberate.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_iris_l_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_iris_l_6);
  nodes["iris-l"] = node_iris_l_6;
  const mesh_iris_l_6Geometry = endpoint_iris_l_6
    ? new THREE.CylinderGeometry(endpoint_iris_l_6.endRadius, endpoint_iris_l_6.baseRadius, endpoint_iris_l_6.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_iris_l_6) {
    mesh_iris_l_6Geometry.scale(0.11010560000000001, 0.11010560000000001, 0.11010560000000001);
  }
  const mesh_iris_l_6 = new THREE.Mesh(
    mesh_iris_l_6Geometry,
    materialMap["iris"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_iris_l_6.name = "Iris L";
  if (endpoint_iris_l_6) {
    mesh_iris_l_6.position.copy(endpoint_iris_l_6.midpoint);
    mesh_iris_l_6.quaternion.copy(endpoint_iris_l_6.quaternion);
  }
  mesh_iris_l_6.castShadow = options.castShadow ?? true;
  mesh_iris_l_6.receiveShadow = options.receiveShadow ?? true;
  mesh_iris_l_6.userData.sculptComponent = {"id": "iris-l", "name": "Iris L", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-l", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11010560000000001, "height": 0.11010560000000001, "depth": 0.11010560000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11010560000000001, 0.11010560000000001, 0.11010560000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "iris", "materialLayers": ["iris"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 163, 23, 1.0)", "secondaryAlbedo": "rgba(198, 133, 15, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Amber iris, per the reference. Diverges from the blue used by every other enemy skin - deliberate.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_iris_l_6.add(mesh_iris_l_6);
  meshes["iris-l"] = mesh_iris_l_6;
  colliders["iris-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_pupil_l_7 = makeAttachmentEndpoint(null);
  const node_pupil_l_7 = new THREE.Group();
  node_pupil_l_7.name = "Pupil L__pivot";
  node_pupil_l_7.scale.set(1, 1, 1);
  if (endpoint_pupil_l_7) {
    node_pupil_l_7.position.copy(endpoint_pupil_l_7.start);
    node_pupil_l_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pupil_l_7.position.set(0.0811, 0.616, 0.5552);
    node_pupil_l_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_pupil_l_7.userData.sculptComponent = {"id": "pupil-l", "name": "Pupil L", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-l", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11206400000000001, "height": 0.11206400000000001, "depth": 0.11206400000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11206400000000001, 0.11206400000000001, 0.11206400000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupil", "materialLayers": ["pupil"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 12, 18, 1.0)", "secondaryAlbedo": "rgba(4, 5, 8, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["zone-r0c0"], "notes": "Near-black pupil.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_pupil_l_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_pupil_l_7);
  nodes["pupil-l"] = node_pupil_l_7;
  const mesh_pupil_l_7Geometry = endpoint_pupil_l_7
    ? new THREE.CylinderGeometry(endpoint_pupil_l_7.endRadius, endpoint_pupil_l_7.baseRadius, endpoint_pupil_l_7.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_pupil_l_7) {
    mesh_pupil_l_7Geometry.scale(0.11206400000000001, 0.11206400000000001, 0.11206400000000001);
  }
  const mesh_pupil_l_7 = new THREE.Mesh(
    mesh_pupil_l_7Geometry,
    materialMap["pupil"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pupil_l_7.name = "Pupil L";
  if (endpoint_pupil_l_7) {
    mesh_pupil_l_7.position.copy(endpoint_pupil_l_7.midpoint);
    mesh_pupil_l_7.quaternion.copy(endpoint_pupil_l_7.quaternion);
  }
  mesh_pupil_l_7.castShadow = options.castShadow ?? true;
  mesh_pupil_l_7.receiveShadow = options.receiveShadow ?? true;
  mesh_pupil_l_7.userData.sculptComponent = {"id": "pupil-l", "name": "Pupil L", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-l", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11206400000000001, "height": 0.11206400000000001, "depth": 0.11206400000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11206400000000001, 0.11206400000000001, 0.11206400000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupil", "materialLayers": ["pupil"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 12, 18, 1.0)", "secondaryAlbedo": "rgba(4, 5, 8, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["zone-r0c0"], "notes": "Near-black pupil.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_pupil_l_7.add(mesh_pupil_l_7);
  meshes["pupil-l"] = mesh_pupil_l_7;
  colliders["pupil-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_glint_l_8 = makeAttachmentEndpoint(null);
  const node_glint_l_8 = new THREE.Group();
  node_glint_l_8.name = "Glint L__pivot";
  node_glint_l_8.scale.set(1, 1, 1);
  if (endpoint_glint_l_8) {
    node_glint_l_8.position.copy(endpoint_glint_l_8.start);
    node_glint_l_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glint_l_8.position.set(0.0811, 0.616, 0.5552);
    node_glint_l_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_glint_l_8.userData.sculptComponent = {"id": "glint-l", "name": "Glint L", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-l", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11424000000000001, "height": 0.11424000000000001, "depth": 0.11424000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11424000000000001, 0.11424000000000001, 0.11424000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glint", "materialLayers": ["glint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-catchlight"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "evidenceRefs": ["zone-r0c0"], "notes": "Unlit catchlight (MeshBasicMaterial). The observed highlight is a lighting artefact, not albedo.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_glint_l_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_glint_l_8);
  nodes["glint-l"] = node_glint_l_8;
  const mesh_glint_l_8Geometry = endpoint_glint_l_8
    ? new THREE.CylinderGeometry(endpoint_glint_l_8.endRadius, endpoint_glint_l_8.baseRadius, endpoint_glint_l_8.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_glint_l_8) {
    mesh_glint_l_8Geometry.scale(0.11424000000000001, 0.11424000000000001, 0.11424000000000001);
  }
  const mesh_glint_l_8 = new THREE.Mesh(
    mesh_glint_l_8Geometry,
    materialMap["glint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glint_l_8.name = "Glint L";
  if (endpoint_glint_l_8) {
    mesh_glint_l_8.position.copy(endpoint_glint_l_8.midpoint);
    mesh_glint_l_8.quaternion.copy(endpoint_glint_l_8.quaternion);
  }
  mesh_glint_l_8.castShadow = options.castShadow ?? true;
  mesh_glint_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_glint_l_8.userData.sculptComponent = {"id": "glint-l", "name": "Glint L", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-l", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11424000000000001, "height": 0.11424000000000001, "depth": 0.11424000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11424000000000001, 0.11424000000000001, 0.11424000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glint", "materialLayers": ["glint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-catchlight"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "evidenceRefs": ["zone-r0c0"], "notes": "Unlit catchlight (MeshBasicMaterial). The observed highlight is a lighting artefact, not albedo.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_glint_l_8.add(mesh_glint_l_8);
  meshes["glint-l"] = mesh_glint_l_8;
  colliders["glint-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_eye_r_9 = makeAttachmentEndpoint(null);
  const node_eye_r_9 = new THREE.Group();
  node_eye_r_9.name = "Eye (right)__pivot";
  node_eye_r_9.scale.set(1, 1, 1);
  if (endpoint_eye_r_9) {
    node_eye_r_9.position.copy(endpoint_eye_r_9.start);
    node_eye_r_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_r_9.position.set(-0.0811, 0.316, 0.3352);
    node_eye_r_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_r_9.userData.sculptComponent = {"id": "eye-r", "name": "Eye (right)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Sclera ball protruding from the head, per the character-track eye recipe. Must stay solid in the consumer's 'eaten' state, where the body is hidden and only the eyes remain.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-eye-socket-r", "localStart": [0, 0, -0.054400000000000004], "localEnd": [0, 0, 0.054400000000000004], "contactType": "embed", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.95, "notes": "Sclera ball protruding from the head capsule as a convex boss, per the reference."}, "dimensions": {"width": 0.10880000000000001, "height": 0.10880000000000001, "depth": 0.10880000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [-0.0811, 0.316, 0.3352], "rotation": [0, 0, 0], "scale": [0.10880000000000001, 0.10880000000000001, 0.10880000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rimContour", "kind": "contour", "description": "Dark rim separating the near-white sclera from the warm head cuticle; without it they bleed together at gameplay size.", "detailRef": "eye-dark-rim"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-dark-rim"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 249, 242, 1.0)", "secondaryAlbedo": "rgba(226, 219, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Warm off-white eye white, opaque.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_eye_r_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_eye_r_9);
  nodes["eye-r"] = node_eye_r_9;
  const mesh_eye_r_9Geometry = endpoint_eye_r_9
    ? new THREE.CylinderGeometry(endpoint_eye_r_9.endRadius, endpoint_eye_r_9.baseRadius, endpoint_eye_r_9.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_eye_r_9) {
    mesh_eye_r_9Geometry.scale(0.10880000000000001, 0.10880000000000001, 0.10880000000000001);
  }
  const mesh_eye_r_9 = new THREE.Mesh(
    mesh_eye_r_9Geometry,
    materialMap["sclera"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_r_9.name = "Eye (right)";
  if (endpoint_eye_r_9) {
    mesh_eye_r_9.position.copy(endpoint_eye_r_9.midpoint);
    mesh_eye_r_9.quaternion.copy(endpoint_eye_r_9.quaternion);
  }
  mesh_eye_r_9.castShadow = options.castShadow ?? true;
  mesh_eye_r_9.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_r_9.userData.sculptComponent = {"id": "eye-r", "name": "Eye (right)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Sclera ball protruding from the head, per the character-track eye recipe. Must stay solid in the consumer's 'eaten' state, where the body is hidden and only the eyes remain.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "head-eye-socket-r", "localStart": [0, 0, -0.054400000000000004], "localEnd": [0, 0, 0.054400000000000004], "contactType": "embed", "embedDepth": 0.018, "gapTolerance": 0.002, "confidence": 0.95, "notes": "Sclera ball protruding from the head capsule as a convex boss, per the reference."}, "dimensions": {"width": 0.10880000000000001, "height": 0.10880000000000001, "depth": 0.10880000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.95}, "transform": {"position": [-0.0811, 0.316, 0.3352], "rotation": [0, 0, 0], "scale": [0.10880000000000001, 0.10880000000000001, 0.10880000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "sclera", "materialLayers": ["sclera"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rimContour", "kind": "contour", "description": "Dark rim separating the near-white sclera from the warm head cuticle; without it they bleed together at gameplay size.", "detailRef": "eye-dark-rim"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-dark-rim"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 249, 242, 1.0)", "secondaryAlbedo": "rgba(226, 219, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Warm off-white eye white, opaque.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_eye_r_9.add(mesh_eye_r_9);
  meshes["eye-r"] = mesh_eye_r_9;
  colliders["eye-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_iris_r_10 = makeAttachmentEndpoint(null);
  const node_iris_r_10 = new THREE.Group();
  node_iris_r_10.name = "Iris R__pivot";
  node_iris_r_10.scale.set(1, 1, 1);
  if (endpoint_iris_r_10) {
    node_iris_r_10.position.copy(endpoint_iris_r_10.start);
    node_iris_r_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_iris_r_10.position.set(-0.0811, 0.616, 0.5552);
    node_iris_r_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_iris_r_10.userData.sculptComponent = {"id": "iris-r", "name": "Iris R", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-r", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11010560000000001, "height": 0.11010560000000001, "depth": 0.11010560000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11010560000000001, 0.11010560000000001, 0.11010560000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "iris", "materialLayers": ["iris"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 163, 23, 1.0)", "secondaryAlbedo": "rgba(198, 133, 15, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Amber iris, per the reference. Diverges from the blue used by every other enemy skin - deliberate.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_iris_r_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_iris_r_10);
  nodes["iris-r"] = node_iris_r_10;
  const mesh_iris_r_10Geometry = endpoint_iris_r_10
    ? new THREE.CylinderGeometry(endpoint_iris_r_10.endRadius, endpoint_iris_r_10.baseRadius, endpoint_iris_r_10.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_iris_r_10) {
    mesh_iris_r_10Geometry.scale(0.11010560000000001, 0.11010560000000001, 0.11010560000000001);
  }
  const mesh_iris_r_10 = new THREE.Mesh(
    mesh_iris_r_10Geometry,
    materialMap["iris"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_iris_r_10.name = "Iris R";
  if (endpoint_iris_r_10) {
    mesh_iris_r_10.position.copy(endpoint_iris_r_10.midpoint);
    mesh_iris_r_10.quaternion.copy(endpoint_iris_r_10.quaternion);
  }
  mesh_iris_r_10.castShadow = options.castShadow ?? true;
  mesh_iris_r_10.receiveShadow = options.receiveShadow ?? true;
  mesh_iris_r_10.userData.sculptComponent = {"id": "iris-r", "name": "Iris R", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-r", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11010560000000001, "height": 0.11010560000000001, "depth": 0.11010560000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11010560000000001, 0.11010560000000001, 0.11010560000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "iris", "materialLayers": ["iris"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 163, 23, 1.0)", "secondaryAlbedo": "rgba(198, 133, 15, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["zone-r0c0"], "notes": "Amber iris, per the reference. Diverges from the blue used by every other enemy skin - deliberate.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_iris_r_10.add(mesh_iris_r_10);
  meshes["iris-r"] = mesh_iris_r_10;
  colliders["iris-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_pupil_r_11 = makeAttachmentEndpoint(null);
  const node_pupil_r_11 = new THREE.Group();
  node_pupil_r_11.name = "Pupil R__pivot";
  node_pupil_r_11.scale.set(1, 1, 1);
  if (endpoint_pupil_r_11) {
    node_pupil_r_11.position.copy(endpoint_pupil_r_11.start);
    node_pupil_r_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pupil_r_11.position.set(-0.0811, 0.616, 0.5552);
    node_pupil_r_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_pupil_r_11.userData.sculptComponent = {"id": "pupil-r", "name": "Pupil R", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-r", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11206400000000001, "height": 0.11206400000000001, "depth": 0.11206400000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11206400000000001, 0.11206400000000001, 0.11206400000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupil", "materialLayers": ["pupil"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 12, 18, 1.0)", "secondaryAlbedo": "rgba(4, 5, 8, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["zone-r0c0"], "notes": "Near-black pupil.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_pupil_r_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_pupil_r_11);
  nodes["pupil-r"] = node_pupil_r_11;
  const mesh_pupil_r_11Geometry = endpoint_pupil_r_11
    ? new THREE.CylinderGeometry(endpoint_pupil_r_11.endRadius, endpoint_pupil_r_11.baseRadius, endpoint_pupil_r_11.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_pupil_r_11) {
    mesh_pupil_r_11Geometry.scale(0.11206400000000001, 0.11206400000000001, 0.11206400000000001);
  }
  const mesh_pupil_r_11 = new THREE.Mesh(
    mesh_pupil_r_11Geometry,
    materialMap["pupil"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pupil_r_11.name = "Pupil R";
  if (endpoint_pupil_r_11) {
    mesh_pupil_r_11.position.copy(endpoint_pupil_r_11.midpoint);
    mesh_pupil_r_11.quaternion.copy(endpoint_pupil_r_11.quaternion);
  }
  mesh_pupil_r_11.castShadow = options.castShadow ?? true;
  mesh_pupil_r_11.receiveShadow = options.receiveShadow ?? true;
  mesh_pupil_r_11.userData.sculptComponent = {"id": "pupil-r", "name": "Pupil R", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-r", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11206400000000001, "height": 0.11206400000000001, "depth": 0.11206400000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11206400000000001, 0.11206400000000001, 0.11206400000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "pupil", "materialLayers": ["pupil"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-amber-iris"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 12, 18, 1.0)", "secondaryAlbedo": "rgba(4, 5, 8, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["zone-r0c0"], "notes": "Near-black pupil.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_pupil_r_11.add(mesh_pupil_r_11);
  meshes["pupil-r"] = mesh_pupil_r_11;
  colliders["pupil-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_glint_r_12 = makeAttachmentEndpoint(null);
  const node_glint_r_12 = new THREE.Group();
  node_glint_r_12.name = "Glint R__pivot";
  node_glint_r_12.scale.set(1, 1, 1);
  if (endpoint_glint_r_12) {
    node_glint_r_12.position.copy(endpoint_glint_r_12.start);
    node_glint_r_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glint_r_12.position.set(-0.0811, 0.616, 0.5552);
    node_glint_r_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_glint_r_12.userData.sculptComponent = {"id": "glint-r", "name": "Glint R", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-r", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11424000000000001, "height": 0.11424000000000001, "depth": 0.11424000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11424000000000001, 0.11424000000000001, 0.11424000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glint", "materialLayers": ["glint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-catchlight"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "evidenceRefs": ["zone-r0c0"], "notes": "Unlit catchlight (MeshBasicMaterial). The observed highlight is a lighting artefact, not albedo.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_glint_r_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["head"] ?? root).add(node_glint_r_12);
  nodes["glint-r"] = node_glint_r_12;
  const mesh_glint_r_12Geometry = endpoint_glint_r_12
    ? new THREE.CylinderGeometry(endpoint_glint_r_12.endRadius, endpoint_glint_r_12.baseRadius, endpoint_glint_r_12.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_glint_r_12) {
    mesh_glint_r_12Geometry.scale(0.11424000000000001, 0.11424000000000001, 0.11424000000000001);
  }
  const mesh_glint_r_12 = new THREE.Mesh(
    mesh_glint_r_12Geometry,
    materialMap["glint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glint_r_12.name = "Glint R";
  if (endpoint_glint_r_12) {
    mesh_glint_r_12.position.copy(endpoint_glint_r_12.midpoint);
    mesh_glint_r_12.quaternion.copy(endpoint_glint_r_12.quaternion);
  }
  mesh_glint_r_12.castShadow = options.castShadow ?? true;
  mesh_glint_r_12.receiveShadow = options.receiveShadow ?? true;
  mesh_glint_r_12.userData.sculptComponent = {"id": "glint-r", "name": "Glint R", "level": "micro", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "sphere", "topologyClass": "conforming-shell", "topologyRationale": "A flush cap of a very slightly larger sphere sharing the eye's centre - lies exactly on the eyeball curve at any pupil rotation instead of having to be fitted. Built as a partial sphere (theta-limited cap) sharing the parent's centre, so it lies flush on the curve. Classified conforming-shell: a thin cap that conforms to the parent surface rather than a solid of its own.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as spherical-cap)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentId": "head", "parentSocket": "pupil-pivot-r", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.0576], "contactType": "flush", "embedDepth": 0.001, "gapTolerance": 0.002, "confidence": 0.9, "notes": "Flush cap sharing the eyeball centre; conforms to the curve rather than being fitted to it. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.11424000000000001, "height": 0.11424000000000001, "depth": 0.11424000000000001, "units": "world (1 unit = 1 maze tile)", "confidence": 0.9}, "transform": {"position": [-0.0811, 0.616, 0.5552], "rotation": [0.0, 0.0, 0.0], "scale": [0.11424000000000001, 0.11424000000000001, 0.11424000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "glint", "materialLayers": ["glint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["eye-catchlight"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(255, 255, 255, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.6, "evidenceRefs": ["zone-r0c0"], "notes": "Unlit catchlight (MeshBasicMaterial). The observed highlight is a lighting artefact, not albedo.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_glint_r_12.add(mesh_glint_r_12);
  meshes["glint-r"] = mesh_glint_r_12;
  colliders["glint-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_antenna_l_13 = makeAttachmentEndpoint(null);
  const node_antenna_l_13 = new THREE.Group();
  node_antenna_l_13.name = "Antenna (left)__pivot";
  node_antenna_l_13.scale.set(1, 1, 1);
  if (endpoint_antenna_l_13) {
    node_antenna_l_13.position.copy(endpoint_antenna_l_13.start);
    node_antenna_l_13.rotation.set(-0.34, 0.0, -0.42);
  } else {
    node_antenna_l_13.position.set(0.0512, 0.43119999999999997, 0.20400000000000001);
    node_antenna_l_13.rotation.set(-0.34, 0.0, -0.42);
  }
  node_antenna_l_13.userData.sculptComponent = {"id": "antenna-l", "name": "Antenna (left)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swept along a curve, not a straight cone - it leaves the crown near the sagittal plane and sweeps postero-dorsally AND laterally. A straight cone would pass a silhouette check while losing the sweep, which is why swept_arc_gate exists. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together. Promoted to macro: with the container nodes removed this is one of the four major masses, and it is what sets the model's total height.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as swept-tube)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "head-crown-l", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactType": "socket", "embedDepth": 0.015, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Rooted on the head crown near the sagittal plane, sweeping postero-dorsally and laterally. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.044800000000000006, "height": 0.48, "depth": 0.044800000000000006, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.0512, 0.43119999999999997, 0.20400000000000001], "rotation": [-0.34, 0.0, -0.42], "scale": [0.044800000000000006, 0.48, 0.044800000000000006]}, "actionProfile": {"animationRole": "rotate", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "taperProfile", "kind": "contour", "description": "Tapers base to tip. Deliberately THICK (0.14 HD at the base) - hair-thin antennae vanish at gameplay size.", "detailRef": "antenna-taper-and-sweep"}, {"id": "beadSegmentation", "kind": "stitch", "description": "Roughly 9 beads along the swept shaft, shortening toward the tip. Sweep stations, not separate meshes."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["antenna-bead-segmentation", "antenna-taper-and-sweep"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_antenna_l_13.userData.actionProfile = {"animationRole": "rotate", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_antenna_l_13);
  nodes["antenna-l"] = node_antenna_l_13;
  const mesh_antenna_l_13Geometry = endpoint_antenna_l_13
    ? new THREE.CylinderGeometry(endpoint_antenna_l_13.endRadius, endpoint_antenna_l_13.baseRadius, endpoint_antenna_l_13.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_antenna_l_13) {
    mesh_antenna_l_13Geometry.scale(0.044800000000000006, 0.48, 0.044800000000000006);
  }
  const mesh_antenna_l_13 = new THREE.Mesh(
    mesh_antenna_l_13Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_antenna_l_13.name = "Antenna (left)";
  if (endpoint_antenna_l_13) {
    mesh_antenna_l_13.position.copy(endpoint_antenna_l_13.midpoint);
    mesh_antenna_l_13.quaternion.copy(endpoint_antenna_l_13.quaternion);
  }
  mesh_antenna_l_13.castShadow = options.castShadow ?? true;
  mesh_antenna_l_13.receiveShadow = options.receiveShadow ?? true;
  mesh_antenna_l_13.userData.sculptComponent = {"id": "antenna-l", "name": "Antenna (left)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swept along a curve, not a straight cone - it leaves the crown near the sagittal plane and sweeps postero-dorsally AND laterally. A straight cone would pass a silhouette check while losing the sweep, which is why swept_arc_gate exists. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together. Promoted to macro: with the container nodes removed this is one of the four major masses, and it is what sets the model's total height.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as swept-tube)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "head-crown-l", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactType": "socket", "embedDepth": 0.015, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Rooted on the head crown near the sagittal plane, sweeping postero-dorsally and laterally. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.044800000000000006, "height": 0.48, "depth": 0.044800000000000006, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [0.0512, 0.43119999999999997, 0.20400000000000001], "rotation": [-0.34, 0.0, -0.42], "scale": [0.044800000000000006, 0.48, 0.044800000000000006]}, "actionProfile": {"animationRole": "rotate", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "taperProfile", "kind": "contour", "description": "Tapers base to tip. Deliberately THICK (0.14 HD at the base) - hair-thin antennae vanish at gameplay size.", "detailRef": "antenna-taper-and-sweep"}, {"id": "beadSegmentation", "kind": "stitch", "description": "Roughly 9 beads along the swept shaft, shortening toward the tip. Sweep stations, not separate meshes."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["antenna-bead-segmentation", "antenna-taper-and-sweep"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_antenna_l_13.add(mesh_antenna_l_13);
  meshes["antenna-l"] = mesh_antenna_l_13;
  colliders["antenna-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_antenna_r_14 = makeAttachmentEndpoint(null);
  const node_antenna_r_14 = new THREE.Group();
  node_antenna_r_14.name = "Antenna (right)__pivot";
  node_antenna_r_14.scale.set(1, 1, 1);
  if (endpoint_antenna_r_14) {
    node_antenna_r_14.position.copy(endpoint_antenna_r_14.start);
    node_antenna_r_14.rotation.set(-0.34, 0.0, 0.42);
  } else {
    node_antenna_r_14.position.set(-0.0512, 0.43119999999999997, 0.20400000000000001);
    node_antenna_r_14.rotation.set(-0.34, 0.0, 0.42);
  }
  node_antenna_r_14.userData.sculptComponent = {"id": "antenna-r", "name": "Antenna (right)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swept along a curve, not a straight cone - it leaves the crown near the sagittal plane and sweeps postero-dorsally AND laterally. A straight cone would pass a silhouette check while losing the sweep, which is why swept_arc_gate exists. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together. Promoted to macro: with the container nodes removed this is one of the four major masses, and it is what sets the model's total height.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as swept-tube)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "head-crown-r", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactType": "socket", "embedDepth": 0.015, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Rooted on the head crown near the sagittal plane, sweeping postero-dorsally and laterally. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.044800000000000006, "height": 0.48, "depth": 0.044800000000000006, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.0512, 0.43119999999999997, 0.20400000000000001], "rotation": [-0.34, 0.0, 0.42], "scale": [0.044800000000000006, 0.48, 0.044800000000000006]}, "actionProfile": {"animationRole": "rotate", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "taperProfile", "kind": "contour", "description": "Tapers base to tip. Deliberately THICK (0.14 HD at the base) - hair-thin antennae vanish at gameplay size.", "detailRef": "antenna-taper-and-sweep"}, {"id": "beadSegmentation", "kind": "stitch", "description": "Roughly 9 beads along the swept shaft, shortening toward the tip. Sweep stations, not separate meshes."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["antenna-bead-segmentation", "antenna-taper-and-sweep"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_antenna_r_14.userData.actionProfile = {"animationRole": "rotate", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_antenna_r_14);
  nodes["antenna-r"] = node_antenna_r_14;
  const mesh_antenna_r_14Geometry = endpoint_antenna_r_14
    ? new THREE.CylinderGeometry(endpoint_antenna_r_14.endRadius, endpoint_antenna_r_14.baseRadius, endpoint_antenna_r_14.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_antenna_r_14) {
    mesh_antenna_r_14Geometry.scale(0.044800000000000006, 0.48, 0.044800000000000006);
  }
  const mesh_antenna_r_14 = new THREE.Mesh(
    mesh_antenna_r_14Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_antenna_r_14.name = "Antenna (right)";
  if (endpoint_antenna_r_14) {
    mesh_antenna_r_14.position.copy(endpoint_antenna_r_14.midpoint);
    mesh_antenna_r_14.quaternion.copy(endpoint_antenna_r_14.quaternion);
  }
  mesh_antenna_r_14.castShadow = options.castShadow ?? true;
  mesh_antenna_r_14.receiveShadow = options.receiveShadow ?? true;
  mesh_antenna_r_14.userData.sculptComponent = {"id": "antenna-r", "name": "Antenna (right)", "level": "macro", "role": "body", "importance": 0.85, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A tapered tube swept along a curve, not a straight cone - it leaves the crown near the sagittal plane and sweeps postero-dorsally AND laterally. A straight cone would pass a silhouette check while losing the sweep, which is why swept_arc_gate exists. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together. Promoted to macro: with the container nodes removed this is one of the four major masses, and it is what sets the model's total height.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as swept-tube)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "head-crown-r", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactType": "socket", "embedDepth": 0.015, "gapTolerance": 0.002, "confidence": 0.8, "notes": "Rooted on the head crown near the sagittal plane, sweeping postero-dorsally and laterally. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.044800000000000006, "height": 0.48, "depth": 0.044800000000000006, "units": "world (1 unit = 1 maze tile)", "confidence": 0.8}, "transform": {"position": [-0.0512, 0.43119999999999997, 0.20400000000000001], "rotation": [-0.34, 0.0, 0.42], "scale": [0.044800000000000006, 0.48, 0.044800000000000006]}, "actionProfile": {"animationRole": "rotate", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "taperProfile", "kind": "contour", "description": "Tapers base to tip. Deliberately THICK (0.14 HD at the base) - hair-thin antennae vanish at gameplay size.", "detailRef": "antenna-taper-and-sweep"}, {"id": "beadSegmentation", "kind": "stitch", "description": "Roughly 9 beads along the swept shaft, shortening toward the tip. Sweep stations, not separate meshes."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r0c0"], "details": ["antenna-bead-segmentation", "antenna-taper-and-sweep"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r0c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_antenna_r_14.add(mesh_antenna_r_14);
  meshes["antenna-r"] = mesh_antenna_r_14;
  colliders["antenna-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_femur_fore_l_15 = {"parentId": null, "parentSocket": "limb-fore-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.1344, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."};
  const endpoint_femur_fore_l_15 = makeAttachmentEndpoint(attachment_femur_fore_l_15);
  const node_femur_fore_l_15 = new THREE.Group();
  node_femur_fore_l_15.name = "Fore femur (l)__pivot";
  node_femur_fore_l_15.scale.set(1, 1, 1);
  if (endpoint_femur_fore_l_15) {
    node_femur_fore_l_15.position.copy(endpoint_femur_fore_l_15.start);
    node_femur_fore_l_15.rotation.set(0.0, -0.6, -2.191);
  } else {
    node_femur_fore_l_15.position.set(0.1, 0.2822, 0.105);
    node_femur_fore_l_15.rotation.set(0.0, -0.6, -2.191);
  }
  node_femur_fore_l_15.userData.sculptComponent = {"id": "femur-fore-l", "name": "Fore femur (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-fore-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.1344, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.1344, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.1, 0.2822, 0.105], "rotation": [0.0, -0.6, -2.191], "scale": [0.064, 0.1344, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_fore_l_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_femur_fore_l_15);
  nodes["femur-fore-l"] = node_femur_fore_l_15;
  const mesh_femur_fore_l_15Geometry = endpoint_femur_fore_l_15
    ? new THREE.CylinderGeometry(endpoint_femur_fore_l_15.endRadius, endpoint_femur_fore_l_15.baseRadius, endpoint_femur_fore_l_15.length, 8, 4)
    : buildWatertightCapsule(0.35, 0.7, 4, 8, 1);
  if (!endpoint_femur_fore_l_15) {
    mesh_femur_fore_l_15Geometry.scale(0.064, 0.1344, 0.064);
  }
  const mesh_femur_fore_l_15 = new THREE.Mesh(
    mesh_femur_fore_l_15Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_femur_fore_l_15.name = "Fore femur (l)";
  if (endpoint_femur_fore_l_15) {
    mesh_femur_fore_l_15.position.copy(endpoint_femur_fore_l_15.midpoint);
    mesh_femur_fore_l_15.quaternion.copy(endpoint_femur_fore_l_15.quaternion);
  }
  mesh_femur_fore_l_15.castShadow = options.castShadow ?? true;
  mesh_femur_fore_l_15.receiveShadow = options.receiveShadow ?? true;
  mesh_femur_fore_l_15.userData.sculptComponent = {"id": "femur-fore-l", "name": "Fore femur (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-fore-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.1344, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.1344, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.1, 0.2822, 0.105], "rotation": [0.0, -0.6, -2.191], "scale": [0.064, 0.1344, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_fore_l_15.add(mesh_femur_fore_l_15);
  meshes["femur-fore-l"] = mesh_femur_fore_l_15;
  colliders["femur-fore-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tibia_fore_l_16 = makeAttachmentEndpoint(null);
  const node_tibia_fore_l_16 = new THREE.Group();
  node_tibia_fore_l_16.name = "Fore tibia (l)__pivot";
  node_tibia_fore_l_16.scale.set(1, 1, 1);
  if (endpoint_tibia_fore_l_16) {
    node_tibia_fore_l_16.position.copy(endpoint_tibia_fore_l_16.start);
    node_tibia_fore_l_16.rotation.set(0.45, 0.0, 0.0);
  } else {
    node_tibia_fore_l_16.position.set(0.0, 0.1344, 0.0);
    node_tibia_fore_l_16.rotation.set(0.45, 0.0, 0.0);
  }
  node_tibia_fore_l_16.userData.sculptComponent = {"id": "tibia-fore-l", "name": "Fore tibia (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-fore-l", "attachment": {"parentId": "femur-fore-l", "parentSocket": "femur-fore-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.1152, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.1152, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.1344, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.1152, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_fore_l_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["femur-fore-l"] ?? root).add(node_tibia_fore_l_16);
  nodes["tibia-fore-l"] = node_tibia_fore_l_16;
  const mesh_tibia_fore_l_16Geometry = endpoint_tibia_fore_l_16
    ? new THREE.CylinderGeometry(endpoint_tibia_fore_l_16.endRadius, endpoint_tibia_fore_l_16.baseRadius, endpoint_tibia_fore_l_16.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tibia_fore_l_16) {
    mesh_tibia_fore_l_16Geometry.scale(0.0288, 0.1152, 0.0288);
  }
  const mesh_tibia_fore_l_16 = new THREE.Mesh(
    mesh_tibia_fore_l_16Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tibia_fore_l_16.name = "Fore tibia (l)";
  if (endpoint_tibia_fore_l_16) {
    mesh_tibia_fore_l_16.position.copy(endpoint_tibia_fore_l_16.midpoint);
    mesh_tibia_fore_l_16.quaternion.copy(endpoint_tibia_fore_l_16.quaternion);
  }
  mesh_tibia_fore_l_16.castShadow = options.castShadow ?? true;
  mesh_tibia_fore_l_16.receiveShadow = options.receiveShadow ?? true;
  mesh_tibia_fore_l_16.userData.sculptComponent = {"id": "tibia-fore-l", "name": "Fore tibia (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-fore-l", "attachment": {"parentId": "femur-fore-l", "parentSocket": "femur-fore-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.1152, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.1152, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.1344, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.1152, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_fore_l_16.add(mesh_tibia_fore_l_16);
  meshes["tibia-fore-l"] = mesh_tibia_fore_l_16;
  colliders["tibia-fore-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tarsus_fore_l_17 = makeAttachmentEndpoint(null);
  const node_tarsus_fore_l_17 = new THREE.Group();
  node_tarsus_fore_l_17.name = "Fore tarsus (l)__pivot";
  node_tarsus_fore_l_17.scale.set(1, 1, 1);
  if (endpoint_tarsus_fore_l_17) {
    node_tarsus_fore_l_17.position.copy(endpoint_tarsus_fore_l_17.start);
    node_tarsus_fore_l_17.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tarsus_fore_l_17.position.set(0.0, 0.1152, 0.0);
    node_tarsus_fore_l_17.rotation.set(0.35, 0.0, 0.0);
  }
  node_tarsus_fore_l_17.userData.sculptComponent = {"id": "tarsus-fore-l", "name": "Fore tarsus (l)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-fore-l", "attachment": {"parentId": "tibia-fore-l", "parentSocket": "tibia-fore-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.0704, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.0704, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.1152, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.0704, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_fore_l_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["tibia-fore-l"] ?? root).add(node_tarsus_fore_l_17);
  nodes["tarsus-fore-l"] = node_tarsus_fore_l_17;
  const mesh_tarsus_fore_l_17Geometry = endpoint_tarsus_fore_l_17
    ? new THREE.CylinderGeometry(endpoint_tarsus_fore_l_17.endRadius, endpoint_tarsus_fore_l_17.baseRadius, endpoint_tarsus_fore_l_17.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tarsus_fore_l_17) {
    mesh_tarsus_fore_l_17Geometry.scale(0.0192, 0.0704, 0.0192);
  }
  const mesh_tarsus_fore_l_17 = new THREE.Mesh(
    mesh_tarsus_fore_l_17Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tarsus_fore_l_17.name = "Fore tarsus (l)";
  if (endpoint_tarsus_fore_l_17) {
    mesh_tarsus_fore_l_17.position.copy(endpoint_tarsus_fore_l_17.midpoint);
    mesh_tarsus_fore_l_17.quaternion.copy(endpoint_tarsus_fore_l_17.quaternion);
  }
  mesh_tarsus_fore_l_17.castShadow = options.castShadow ?? true;
  mesh_tarsus_fore_l_17.receiveShadow = options.receiveShadow ?? true;
  mesh_tarsus_fore_l_17.userData.sculptComponent = {"id": "tarsus-fore-l", "name": "Fore tarsus (l)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-fore-l", "attachment": {"parentId": "tibia-fore-l", "parentSocket": "tibia-fore-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.0704, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.0704, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.1152, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.0704, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_fore_l_17.add(mesh_tarsus_fore_l_17);
  meshes["tarsus-fore-l"] = mesh_tarsus_fore_l_17;
  colliders["tarsus-fore-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_femur_fore_r_18 = {"parentId": null, "parentSocket": "limb-fore-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.1344, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."};
  const endpoint_femur_fore_r_18 = makeAttachmentEndpoint(attachment_femur_fore_r_18);
  const node_femur_fore_r_18 = new THREE.Group();
  node_femur_fore_r_18.name = "Fore femur (r)__pivot";
  node_femur_fore_r_18.scale.set(1, 1, 1);
  if (endpoint_femur_fore_r_18) {
    node_femur_fore_r_18.position.copy(endpoint_femur_fore_r_18.start);
    node_femur_fore_r_18.rotation.set(0.0, 0.6, 2.191);
  } else {
    node_femur_fore_r_18.position.set(-0.1, 0.2822, 0.105);
    node_femur_fore_r_18.rotation.set(0.0, 0.6, 2.191);
  }
  node_femur_fore_r_18.userData.sculptComponent = {"id": "femur-fore-r", "name": "Fore femur (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-fore-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.1344, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.1344, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.1, 0.2822, 0.105], "rotation": [0.0, 0.6, 2.191], "scale": [0.064, 0.1344, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_fore_r_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_femur_fore_r_18);
  nodes["femur-fore-r"] = node_femur_fore_r_18;
  const mesh_femur_fore_r_18Geometry = endpoint_femur_fore_r_18
    ? new THREE.CylinderGeometry(endpoint_femur_fore_r_18.endRadius, endpoint_femur_fore_r_18.baseRadius, endpoint_femur_fore_r_18.length, 8, 4)
    : buildWatertightCapsule(0.35, 0.7, 4, 8, 1);
  if (!endpoint_femur_fore_r_18) {
    mesh_femur_fore_r_18Geometry.scale(0.064, 0.1344, 0.064);
  }
  const mesh_femur_fore_r_18 = new THREE.Mesh(
    mesh_femur_fore_r_18Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_femur_fore_r_18.name = "Fore femur (r)";
  if (endpoint_femur_fore_r_18) {
    mesh_femur_fore_r_18.position.copy(endpoint_femur_fore_r_18.midpoint);
    mesh_femur_fore_r_18.quaternion.copy(endpoint_femur_fore_r_18.quaternion);
  }
  mesh_femur_fore_r_18.castShadow = options.castShadow ?? true;
  mesh_femur_fore_r_18.receiveShadow = options.receiveShadow ?? true;
  mesh_femur_fore_r_18.userData.sculptComponent = {"id": "femur-fore-r", "name": "Fore femur (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-fore-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.1344, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.1344, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.1, 0.2822, 0.105], "rotation": [0.0, 0.6, 2.191], "scale": [0.064, 0.1344, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_fore_r_18.add(mesh_femur_fore_r_18);
  meshes["femur-fore-r"] = mesh_femur_fore_r_18;
  colliders["femur-fore-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tibia_fore_r_19 = makeAttachmentEndpoint(null);
  const node_tibia_fore_r_19 = new THREE.Group();
  node_tibia_fore_r_19.name = "Fore tibia (r)__pivot";
  node_tibia_fore_r_19.scale.set(1, 1, 1);
  if (endpoint_tibia_fore_r_19) {
    node_tibia_fore_r_19.position.copy(endpoint_tibia_fore_r_19.start);
    node_tibia_fore_r_19.rotation.set(0.45, 0.0, 0.0);
  } else {
    node_tibia_fore_r_19.position.set(0.0, 0.1344, 0.0);
    node_tibia_fore_r_19.rotation.set(0.45, 0.0, 0.0);
  }
  node_tibia_fore_r_19.userData.sculptComponent = {"id": "tibia-fore-r", "name": "Fore tibia (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-fore-r", "attachment": {"parentId": "femur-fore-r", "parentSocket": "femur-fore-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.1152, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.1152, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.1344, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.1152, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_fore_r_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["femur-fore-r"] ?? root).add(node_tibia_fore_r_19);
  nodes["tibia-fore-r"] = node_tibia_fore_r_19;
  const mesh_tibia_fore_r_19Geometry = endpoint_tibia_fore_r_19
    ? new THREE.CylinderGeometry(endpoint_tibia_fore_r_19.endRadius, endpoint_tibia_fore_r_19.baseRadius, endpoint_tibia_fore_r_19.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tibia_fore_r_19) {
    mesh_tibia_fore_r_19Geometry.scale(0.0288, 0.1152, 0.0288);
  }
  const mesh_tibia_fore_r_19 = new THREE.Mesh(
    mesh_tibia_fore_r_19Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tibia_fore_r_19.name = "Fore tibia (r)";
  if (endpoint_tibia_fore_r_19) {
    mesh_tibia_fore_r_19.position.copy(endpoint_tibia_fore_r_19.midpoint);
    mesh_tibia_fore_r_19.quaternion.copy(endpoint_tibia_fore_r_19.quaternion);
  }
  mesh_tibia_fore_r_19.castShadow = options.castShadow ?? true;
  mesh_tibia_fore_r_19.receiveShadow = options.receiveShadow ?? true;
  mesh_tibia_fore_r_19.userData.sculptComponent = {"id": "tibia-fore-r", "name": "Fore tibia (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-fore-r", "attachment": {"parentId": "femur-fore-r", "parentSocket": "femur-fore-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.1152, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.1152, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.1344, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.1152, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_fore_r_19.add(mesh_tibia_fore_r_19);
  meshes["tibia-fore-r"] = mesh_tibia_fore_r_19;
  colliders["tibia-fore-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tarsus_fore_r_20 = makeAttachmentEndpoint(null);
  const node_tarsus_fore_r_20 = new THREE.Group();
  node_tarsus_fore_r_20.name = "Fore tarsus (r)__pivot";
  node_tarsus_fore_r_20.scale.set(1, 1, 1);
  if (endpoint_tarsus_fore_r_20) {
    node_tarsus_fore_r_20.position.copy(endpoint_tarsus_fore_r_20.start);
    node_tarsus_fore_r_20.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tarsus_fore_r_20.position.set(0.0, 0.1152, 0.0);
    node_tarsus_fore_r_20.rotation.set(0.35, 0.0, 0.0);
  }
  node_tarsus_fore_r_20.userData.sculptComponent = {"id": "tarsus-fore-r", "name": "Fore tarsus (r)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-fore-r", "attachment": {"parentId": "tibia-fore-r", "parentSocket": "tibia-fore-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.0704, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.0704, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.1152, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.0704, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_fore_r_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["tibia-fore-r"] ?? root).add(node_tarsus_fore_r_20);
  nodes["tarsus-fore-r"] = node_tarsus_fore_r_20;
  const mesh_tarsus_fore_r_20Geometry = endpoint_tarsus_fore_r_20
    ? new THREE.CylinderGeometry(endpoint_tarsus_fore_r_20.endRadius, endpoint_tarsus_fore_r_20.baseRadius, endpoint_tarsus_fore_r_20.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tarsus_fore_r_20) {
    mesh_tarsus_fore_r_20Geometry.scale(0.0192, 0.0704, 0.0192);
  }
  const mesh_tarsus_fore_r_20 = new THREE.Mesh(
    mesh_tarsus_fore_r_20Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tarsus_fore_r_20.name = "Fore tarsus (r)";
  if (endpoint_tarsus_fore_r_20) {
    mesh_tarsus_fore_r_20.position.copy(endpoint_tarsus_fore_r_20.midpoint);
    mesh_tarsus_fore_r_20.quaternion.copy(endpoint_tarsus_fore_r_20.quaternion);
  }
  mesh_tarsus_fore_r_20.castShadow = options.castShadow ?? true;
  mesh_tarsus_fore_r_20.receiveShadow = options.receiveShadow ?? true;
  mesh_tarsus_fore_r_20.userData.sculptComponent = {"id": "tarsus-fore-r", "name": "Fore tarsus (r)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-fore-r", "attachment": {"parentId": "tibia-fore-r", "parentSocket": "tibia-fore-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.0704, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.0704, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.1152, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.0704, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_fore_r_20.add(mesh_tarsus_fore_r_20);
  meshes["tarsus-fore-r"] = mesh_tarsus_fore_r_20;
  colliders["tarsus-fore-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_femur_mid_l_21 = {"parentId": null, "parentSocket": "limb-mid-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.17472000000000001, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."};
  const endpoint_femur_mid_l_21 = makeAttachmentEndpoint(attachment_femur_mid_l_21);
  const node_femur_mid_l_21 = new THREE.Group();
  node_femur_mid_l_21.name = "Mid femur (l)__pivot";
  node_femur_mid_l_21.scale.set(1, 1, 1);
  if (endpoint_femur_mid_l_21) {
    node_femur_mid_l_21.position.copy(endpoint_femur_mid_l_21.start);
    node_femur_mid_l_21.rotation.set(0.0, 0.0, -2.191);
  } else {
    node_femur_mid_l_21.position.set(0.12, 0.28736, -0.06);
    node_femur_mid_l_21.rotation.set(0.0, 0.0, -2.191);
  }
  node_femur_mid_l_21.userData.sculptComponent = {"id": "femur-mid-l", "name": "Mid femur (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-mid-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.17472000000000001, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.17472000000000001, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.12, 0.28736, -0.06], "rotation": [0.0, 0.0, -2.191], "scale": [0.064, 0.17472000000000001, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_mid_l_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_femur_mid_l_21);
  nodes["femur-mid-l"] = node_femur_mid_l_21;
  const mesh_femur_mid_l_21Geometry = endpoint_femur_mid_l_21
    ? new THREE.CylinderGeometry(endpoint_femur_mid_l_21.endRadius, endpoint_femur_mid_l_21.baseRadius, endpoint_femur_mid_l_21.length, 8, 4)
    : buildWatertightCapsule(0.35, 0.7, 4, 8, 1);
  if (!endpoint_femur_mid_l_21) {
    mesh_femur_mid_l_21Geometry.scale(0.064, 0.17472000000000001, 0.064);
  }
  const mesh_femur_mid_l_21 = new THREE.Mesh(
    mesh_femur_mid_l_21Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_femur_mid_l_21.name = "Mid femur (l)";
  if (endpoint_femur_mid_l_21) {
    mesh_femur_mid_l_21.position.copy(endpoint_femur_mid_l_21.midpoint);
    mesh_femur_mid_l_21.quaternion.copy(endpoint_femur_mid_l_21.quaternion);
  }
  mesh_femur_mid_l_21.castShadow = options.castShadow ?? true;
  mesh_femur_mid_l_21.receiveShadow = options.receiveShadow ?? true;
  mesh_femur_mid_l_21.userData.sculptComponent = {"id": "femur-mid-l", "name": "Mid femur (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-mid-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.17472000000000001, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.17472000000000001, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.12, 0.28736, -0.06], "rotation": [0.0, 0.0, -2.191], "scale": [0.064, 0.17472000000000001, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_mid_l_21.add(mesh_femur_mid_l_21);
  meshes["femur-mid-l"] = mesh_femur_mid_l_21;
  colliders["femur-mid-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tibia_mid_l_22 = makeAttachmentEndpoint(null);
  const node_tibia_mid_l_22 = new THREE.Group();
  node_tibia_mid_l_22.name = "Mid tibia (l)__pivot";
  node_tibia_mid_l_22.scale.set(1, 1, 1);
  if (endpoint_tibia_mid_l_22) {
    node_tibia_mid_l_22.position.copy(endpoint_tibia_mid_l_22.start);
    node_tibia_mid_l_22.rotation.set(0.45, 0.0, 0.0);
  } else {
    node_tibia_mid_l_22.position.set(0.0, 0.17472000000000001, 0.0);
    node_tibia_mid_l_22.rotation.set(0.45, 0.0, 0.0);
  }
  node_tibia_mid_l_22.userData.sculptComponent = {"id": "tibia-mid-l", "name": "Mid tibia (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-mid-l", "attachment": {"parentId": "femur-mid-l", "parentSocket": "femur-mid-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.14976, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.14976, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.17472000000000001, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.14976, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_mid_l_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["femur-mid-l"] ?? root).add(node_tibia_mid_l_22);
  nodes["tibia-mid-l"] = node_tibia_mid_l_22;
  const mesh_tibia_mid_l_22Geometry = endpoint_tibia_mid_l_22
    ? new THREE.CylinderGeometry(endpoint_tibia_mid_l_22.endRadius, endpoint_tibia_mid_l_22.baseRadius, endpoint_tibia_mid_l_22.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tibia_mid_l_22) {
    mesh_tibia_mid_l_22Geometry.scale(0.0288, 0.14976, 0.0288);
  }
  const mesh_tibia_mid_l_22 = new THREE.Mesh(
    mesh_tibia_mid_l_22Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tibia_mid_l_22.name = "Mid tibia (l)";
  if (endpoint_tibia_mid_l_22) {
    mesh_tibia_mid_l_22.position.copy(endpoint_tibia_mid_l_22.midpoint);
    mesh_tibia_mid_l_22.quaternion.copy(endpoint_tibia_mid_l_22.quaternion);
  }
  mesh_tibia_mid_l_22.castShadow = options.castShadow ?? true;
  mesh_tibia_mid_l_22.receiveShadow = options.receiveShadow ?? true;
  mesh_tibia_mid_l_22.userData.sculptComponent = {"id": "tibia-mid-l", "name": "Mid tibia (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-mid-l", "attachment": {"parentId": "femur-mid-l", "parentSocket": "femur-mid-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.14976, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.14976, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.17472000000000001, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.14976, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_mid_l_22.add(mesh_tibia_mid_l_22);
  meshes["tibia-mid-l"] = mesh_tibia_mid_l_22;
  colliders["tibia-mid-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tarsus_mid_l_23 = makeAttachmentEndpoint(null);
  const node_tarsus_mid_l_23 = new THREE.Group();
  node_tarsus_mid_l_23.name = "Mid tarsus (l)__pivot";
  node_tarsus_mid_l_23.scale.set(1, 1, 1);
  if (endpoint_tarsus_mid_l_23) {
    node_tarsus_mid_l_23.position.copy(endpoint_tarsus_mid_l_23.start);
    node_tarsus_mid_l_23.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tarsus_mid_l_23.position.set(0.0, 0.14976, 0.0);
    node_tarsus_mid_l_23.rotation.set(0.35, 0.0, 0.0);
  }
  node_tarsus_mid_l_23.userData.sculptComponent = {"id": "tarsus-mid-l", "name": "Mid tarsus (l)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-mid-l", "attachment": {"parentId": "tibia-mid-l", "parentSocket": "tibia-mid-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.09152, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.09152, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.14976, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.09152, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_mid_l_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["tibia-mid-l"] ?? root).add(node_tarsus_mid_l_23);
  nodes["tarsus-mid-l"] = node_tarsus_mid_l_23;
  const mesh_tarsus_mid_l_23Geometry = endpoint_tarsus_mid_l_23
    ? new THREE.CylinderGeometry(endpoint_tarsus_mid_l_23.endRadius, endpoint_tarsus_mid_l_23.baseRadius, endpoint_tarsus_mid_l_23.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tarsus_mid_l_23) {
    mesh_tarsus_mid_l_23Geometry.scale(0.0192, 0.09152, 0.0192);
  }
  const mesh_tarsus_mid_l_23 = new THREE.Mesh(
    mesh_tarsus_mid_l_23Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tarsus_mid_l_23.name = "Mid tarsus (l)";
  if (endpoint_tarsus_mid_l_23) {
    mesh_tarsus_mid_l_23.position.copy(endpoint_tarsus_mid_l_23.midpoint);
    mesh_tarsus_mid_l_23.quaternion.copy(endpoint_tarsus_mid_l_23.quaternion);
  }
  mesh_tarsus_mid_l_23.castShadow = options.castShadow ?? true;
  mesh_tarsus_mid_l_23.receiveShadow = options.receiveShadow ?? true;
  mesh_tarsus_mid_l_23.userData.sculptComponent = {"id": "tarsus-mid-l", "name": "Mid tarsus (l)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-mid-l", "attachment": {"parentId": "tibia-mid-l", "parentSocket": "tibia-mid-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.09152, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.09152, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.14976, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.09152, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_mid_l_23.add(mesh_tarsus_mid_l_23);
  meshes["tarsus-mid-l"] = mesh_tarsus_mid_l_23;
  colliders["tarsus-mid-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_femur_mid_r_24 = {"parentId": null, "parentSocket": "limb-mid-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.17472000000000001, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."};
  const endpoint_femur_mid_r_24 = makeAttachmentEndpoint(attachment_femur_mid_r_24);
  const node_femur_mid_r_24 = new THREE.Group();
  node_femur_mid_r_24.name = "Mid femur (r)__pivot";
  node_femur_mid_r_24.scale.set(1, 1, 1);
  if (endpoint_femur_mid_r_24) {
    node_femur_mid_r_24.position.copy(endpoint_femur_mid_r_24.start);
    node_femur_mid_r_24.rotation.set(0.0, 0.0, 2.191);
  } else {
    node_femur_mid_r_24.position.set(-0.12, 0.28736, -0.06);
    node_femur_mid_r_24.rotation.set(0.0, 0.0, 2.191);
  }
  node_femur_mid_r_24.userData.sculptComponent = {"id": "femur-mid-r", "name": "Mid femur (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-mid-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.17472000000000001, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.17472000000000001, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.12, 0.28736, -0.06], "rotation": [0.0, 0.0, 2.191], "scale": [0.064, 0.17472000000000001, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_mid_r_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_femur_mid_r_24);
  nodes["femur-mid-r"] = node_femur_mid_r_24;
  const mesh_femur_mid_r_24Geometry = endpoint_femur_mid_r_24
    ? new THREE.CylinderGeometry(endpoint_femur_mid_r_24.endRadius, endpoint_femur_mid_r_24.baseRadius, endpoint_femur_mid_r_24.length, 8, 4)
    : buildWatertightCapsule(0.35, 0.7, 4, 8, 1);
  if (!endpoint_femur_mid_r_24) {
    mesh_femur_mid_r_24Geometry.scale(0.064, 0.17472000000000001, 0.064);
  }
  const mesh_femur_mid_r_24 = new THREE.Mesh(
    mesh_femur_mid_r_24Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_femur_mid_r_24.name = "Mid femur (r)";
  if (endpoint_femur_mid_r_24) {
    mesh_femur_mid_r_24.position.copy(endpoint_femur_mid_r_24.midpoint);
    mesh_femur_mid_r_24.quaternion.copy(endpoint_femur_mid_r_24.quaternion);
  }
  mesh_femur_mid_r_24.castShadow = options.castShadow ?? true;
  mesh_femur_mid_r_24.receiveShadow = options.receiveShadow ?? true;
  mesh_femur_mid_r_24.userData.sculptComponent = {"id": "femur-mid-r", "name": "Mid femur (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-mid-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.17472000000000001, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.17472000000000001, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.12, 0.28736, -0.06], "rotation": [0.0, 0.0, 2.191], "scale": [0.064, 0.17472000000000001, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_mid_r_24.add(mesh_femur_mid_r_24);
  meshes["femur-mid-r"] = mesh_femur_mid_r_24;
  colliders["femur-mid-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tibia_mid_r_25 = makeAttachmentEndpoint(null);
  const node_tibia_mid_r_25 = new THREE.Group();
  node_tibia_mid_r_25.name = "Mid tibia (r)__pivot";
  node_tibia_mid_r_25.scale.set(1, 1, 1);
  if (endpoint_tibia_mid_r_25) {
    node_tibia_mid_r_25.position.copy(endpoint_tibia_mid_r_25.start);
    node_tibia_mid_r_25.rotation.set(0.45, 0.0, 0.0);
  } else {
    node_tibia_mid_r_25.position.set(0.0, 0.17472000000000001, 0.0);
    node_tibia_mid_r_25.rotation.set(0.45, 0.0, 0.0);
  }
  node_tibia_mid_r_25.userData.sculptComponent = {"id": "tibia-mid-r", "name": "Mid tibia (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-mid-r", "attachment": {"parentId": "femur-mid-r", "parentSocket": "femur-mid-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.14976, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.14976, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.17472000000000001, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.14976, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_mid_r_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["femur-mid-r"] ?? root).add(node_tibia_mid_r_25);
  nodes["tibia-mid-r"] = node_tibia_mid_r_25;
  const mesh_tibia_mid_r_25Geometry = endpoint_tibia_mid_r_25
    ? new THREE.CylinderGeometry(endpoint_tibia_mid_r_25.endRadius, endpoint_tibia_mid_r_25.baseRadius, endpoint_tibia_mid_r_25.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tibia_mid_r_25) {
    mesh_tibia_mid_r_25Geometry.scale(0.0288, 0.14976, 0.0288);
  }
  const mesh_tibia_mid_r_25 = new THREE.Mesh(
    mesh_tibia_mid_r_25Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tibia_mid_r_25.name = "Mid tibia (r)";
  if (endpoint_tibia_mid_r_25) {
    mesh_tibia_mid_r_25.position.copy(endpoint_tibia_mid_r_25.midpoint);
    mesh_tibia_mid_r_25.quaternion.copy(endpoint_tibia_mid_r_25.quaternion);
  }
  mesh_tibia_mid_r_25.castShadow = options.castShadow ?? true;
  mesh_tibia_mid_r_25.receiveShadow = options.receiveShadow ?? true;
  mesh_tibia_mid_r_25.userData.sculptComponent = {"id": "tibia-mid-r", "name": "Mid tibia (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-mid-r", "attachment": {"parentId": "femur-mid-r", "parentSocket": "femur-mid-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.14976, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.14976, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.17472000000000001, 0], "rotation": [0.45, 0, 0], "scale": [0.0288, 0.14976, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_mid_r_25.add(mesh_tibia_mid_r_25);
  meshes["tibia-mid-r"] = mesh_tibia_mid_r_25;
  colliders["tibia-mid-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tarsus_mid_r_26 = makeAttachmentEndpoint(null);
  const node_tarsus_mid_r_26 = new THREE.Group();
  node_tarsus_mid_r_26.name = "Mid tarsus (r)__pivot";
  node_tarsus_mid_r_26.scale.set(1, 1, 1);
  if (endpoint_tarsus_mid_r_26) {
    node_tarsus_mid_r_26.position.copy(endpoint_tarsus_mid_r_26.start);
    node_tarsus_mid_r_26.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tarsus_mid_r_26.position.set(0.0, 0.14976, 0.0);
    node_tarsus_mid_r_26.rotation.set(0.35, 0.0, 0.0);
  }
  node_tarsus_mid_r_26.userData.sculptComponent = {"id": "tarsus-mid-r", "name": "Mid tarsus (r)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-mid-r", "attachment": {"parentId": "tibia-mid-r", "parentSocket": "tibia-mid-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.09152, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.09152, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.14976, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.09152, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_mid_r_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["tibia-mid-r"] ?? root).add(node_tarsus_mid_r_26);
  nodes["tarsus-mid-r"] = node_tarsus_mid_r_26;
  const mesh_tarsus_mid_r_26Geometry = endpoint_tarsus_mid_r_26
    ? new THREE.CylinderGeometry(endpoint_tarsus_mid_r_26.endRadius, endpoint_tarsus_mid_r_26.baseRadius, endpoint_tarsus_mid_r_26.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tarsus_mid_r_26) {
    mesh_tarsus_mid_r_26Geometry.scale(0.0192, 0.09152, 0.0192);
  }
  const mesh_tarsus_mid_r_26 = new THREE.Mesh(
    mesh_tarsus_mid_r_26Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tarsus_mid_r_26.name = "Mid tarsus (r)";
  if (endpoint_tarsus_mid_r_26) {
    mesh_tarsus_mid_r_26.position.copy(endpoint_tarsus_mid_r_26.midpoint);
    mesh_tarsus_mid_r_26.quaternion.copy(endpoint_tarsus_mid_r_26.quaternion);
  }
  mesh_tarsus_mid_r_26.castShadow = options.castShadow ?? true;
  mesh_tarsus_mid_r_26.receiveShadow = options.receiveShadow ?? true;
  mesh_tarsus_mid_r_26.userData.sculptComponent = {"id": "tarsus-mid-r", "name": "Mid tarsus (r)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-mid-r", "attachment": {"parentId": "tibia-mid-r", "parentSocket": "tibia-mid-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.09152, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.09152, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.14976, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.09152, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_mid_r_26.add(mesh_tarsus_mid_r_26);
  meshes["tarsus-mid-r"] = mesh_tarsus_mid_r_26;
  colliders["tarsus-mid-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_femur_hind_l_27 = {"parentId": null, "parentSocket": "limb-hind-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.34944000000000003, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."};
  const endpoint_femur_hind_l_27 = makeAttachmentEndpoint(attachment_femur_hind_l_27);
  const node_femur_hind_l_27 = new THREE.Group();
  node_femur_hind_l_27.name = "Hind femur (l)__pivot";
  node_femur_hind_l_27.scale.set(1, 1, 1);
  if (endpoint_femur_hind_l_27) {
    node_femur_hind_l_27.position.copy(endpoint_femur_hind_l_27.start);
    node_femur_hind_l_27.rotation.set(0.0, 0.35, -1.871);
  } else {
    node_femur_hind_l_27.position.set(0.12, 0.39972, -0.215);
    node_femur_hind_l_27.rotation.set(0.0, 0.35, -1.871);
  }
  node_femur_hind_l_27.userData.sculptComponent = {"id": "femur-hind-l", "name": "Hind femur (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-hind-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.34944000000000003, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.34944000000000003, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.12, 0.39972, -0.215], "rotation": [0.0, 0.35, -1.871], "scale": [0.064, 0.34944000000000003, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_hind_l_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_femur_hind_l_27);
  nodes["femur-hind-l"] = node_femur_hind_l_27;
  const mesh_femur_hind_l_27Geometry = endpoint_femur_hind_l_27
    ? new THREE.CylinderGeometry(endpoint_femur_hind_l_27.endRadius, endpoint_femur_hind_l_27.baseRadius, endpoint_femur_hind_l_27.length, 8, 4)
    : buildWatertightCapsule(0.35, 0.7, 4, 8, 1);
  if (!endpoint_femur_hind_l_27) {
    mesh_femur_hind_l_27Geometry.scale(0.064, 0.34944000000000003, 0.064);
  }
  const mesh_femur_hind_l_27 = new THREE.Mesh(
    mesh_femur_hind_l_27Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_femur_hind_l_27.name = "Hind femur (l)";
  if (endpoint_femur_hind_l_27) {
    mesh_femur_hind_l_27.position.copy(endpoint_femur_hind_l_27.midpoint);
    mesh_femur_hind_l_27.quaternion.copy(endpoint_femur_hind_l_27.quaternion);
  }
  mesh_femur_hind_l_27.castShadow = options.castShadow ?? true;
  mesh_femur_hind_l_27.receiveShadow = options.receiveShadow ?? true;
  mesh_femur_hind_l_27.userData.sculptComponent = {"id": "femur-hind-l", "name": "Hind femur (l)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-hind-l-root", "localStart": [0, 0, 0], "localEnd": [0, 0.34944000000000003, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.34944000000000003, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [0.12, 0.39972, -0.215], "rotation": [0.0, 0.35, -1.871], "scale": [0.064, 0.34944000000000003, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_hind_l_27.add(mesh_femur_hind_l_27);
  meshes["femur-hind-l"] = mesh_femur_hind_l_27;
  colliders["femur-hind-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tibia_hind_l_28 = makeAttachmentEndpoint(null);
  const node_tibia_hind_l_28 = new THREE.Group();
  node_tibia_hind_l_28.name = "Hind tibia (l)__pivot";
  node_tibia_hind_l_28.scale.set(1, 1, 1);
  if (endpoint_tibia_hind_l_28) {
    node_tibia_hind_l_28.position.copy(endpoint_tibia_hind_l_28.start);
    node_tibia_hind_l_28.rotation.set(1.15, 0.0, 0.0);
  } else {
    node_tibia_hind_l_28.position.set(0.0, 0.34944000000000003, 0.0);
    node_tibia_hind_l_28.rotation.set(1.15, 0.0, 0.0);
  }
  node_tibia_hind_l_28.userData.sculptComponent = {"id": "tibia-hind-l", "name": "Hind tibia (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-hind-l", "attachment": {"parentId": "femur-hind-l", "parentSocket": "femur-hind-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.29952, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.29952, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.34944000000000003, 0], "rotation": [1.15, 0, 0], "scale": [0.0288, 0.29952, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_hind_l_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["femur-hind-l"] ?? root).add(node_tibia_hind_l_28);
  nodes["tibia-hind-l"] = node_tibia_hind_l_28;
  const mesh_tibia_hind_l_28Geometry = endpoint_tibia_hind_l_28
    ? new THREE.CylinderGeometry(endpoint_tibia_hind_l_28.endRadius, endpoint_tibia_hind_l_28.baseRadius, endpoint_tibia_hind_l_28.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tibia_hind_l_28) {
    mesh_tibia_hind_l_28Geometry.scale(0.0288, 0.29952, 0.0288);
  }
  const mesh_tibia_hind_l_28 = new THREE.Mesh(
    mesh_tibia_hind_l_28Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tibia_hind_l_28.name = "Hind tibia (l)";
  if (endpoint_tibia_hind_l_28) {
    mesh_tibia_hind_l_28.position.copy(endpoint_tibia_hind_l_28.midpoint);
    mesh_tibia_hind_l_28.quaternion.copy(endpoint_tibia_hind_l_28.quaternion);
  }
  mesh_tibia_hind_l_28.castShadow = options.castShadow ?? true;
  mesh_tibia_hind_l_28.receiveShadow = options.receiveShadow ?? true;
  mesh_tibia_hind_l_28.userData.sculptComponent = {"id": "tibia-hind-l", "name": "Hind tibia (l)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-hind-l", "attachment": {"parentId": "femur-hind-l", "parentSocket": "femur-hind-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.29952, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.29952, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.34944000000000003, 0], "rotation": [1.15, 0, 0], "scale": [0.0288, 0.29952, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_hind_l_28.add(mesh_tibia_hind_l_28);
  meshes["tibia-hind-l"] = mesh_tibia_hind_l_28;
  colliders["tibia-hind-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tarsus_hind_l_29 = makeAttachmentEndpoint(null);
  const node_tarsus_hind_l_29 = new THREE.Group();
  node_tarsus_hind_l_29.name = "Hind tarsus (l)__pivot";
  node_tarsus_hind_l_29.scale.set(1, 1, 1);
  if (endpoint_tarsus_hind_l_29) {
    node_tarsus_hind_l_29.position.copy(endpoint_tarsus_hind_l_29.start);
    node_tarsus_hind_l_29.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tarsus_hind_l_29.position.set(0.0, 0.29952, 0.0);
    node_tarsus_hind_l_29.rotation.set(0.35, 0.0, 0.0);
  }
  node_tarsus_hind_l_29.userData.sculptComponent = {"id": "tarsus-hind-l", "name": "Hind tarsus (l)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-hind-l", "attachment": {"parentId": "tibia-hind-l", "parentSocket": "tibia-hind-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.18304, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.18304, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.29952, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.18304, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_hind_l_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["tibia-hind-l"] ?? root).add(node_tarsus_hind_l_29);
  nodes["tarsus-hind-l"] = node_tarsus_hind_l_29;
  const mesh_tarsus_hind_l_29Geometry = endpoint_tarsus_hind_l_29
    ? new THREE.CylinderGeometry(endpoint_tarsus_hind_l_29.endRadius, endpoint_tarsus_hind_l_29.baseRadius, endpoint_tarsus_hind_l_29.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tarsus_hind_l_29) {
    mesh_tarsus_hind_l_29Geometry.scale(0.0192, 0.18304, 0.0192);
  }
  const mesh_tarsus_hind_l_29 = new THREE.Mesh(
    mesh_tarsus_hind_l_29Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tarsus_hind_l_29.name = "Hind tarsus (l)";
  if (endpoint_tarsus_hind_l_29) {
    mesh_tarsus_hind_l_29.position.copy(endpoint_tarsus_hind_l_29.midpoint);
    mesh_tarsus_hind_l_29.quaternion.copy(endpoint_tarsus_hind_l_29.quaternion);
  }
  mesh_tarsus_hind_l_29.castShadow = options.castShadow ?? true;
  mesh_tarsus_hind_l_29.receiveShadow = options.receiveShadow ?? true;
  mesh_tarsus_hind_l_29.userData.sculptComponent = {"id": "tarsus-hind-l", "name": "Hind tarsus (l)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-hind-l", "attachment": {"parentId": "tibia-hind-l", "parentSocket": "tibia-hind-l-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.18304, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.18304, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.29952, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.18304, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_hind_l_29.add(mesh_tarsus_hind_l_29);
  meshes["tarsus-hind-l"] = mesh_tarsus_hind_l_29;
  colliders["tarsus-hind-l"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const attachment_femur_hind_r_30 = {"parentId": null, "parentSocket": "limb-hind-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.34944000000000003, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."};
  const endpoint_femur_hind_r_30 = makeAttachmentEndpoint(attachment_femur_hind_r_30);
  const node_femur_hind_r_30 = new THREE.Group();
  node_femur_hind_r_30.name = "Hind femur (r)__pivot";
  node_femur_hind_r_30.scale.set(1, 1, 1);
  if (endpoint_femur_hind_r_30) {
    node_femur_hind_r_30.position.copy(endpoint_femur_hind_r_30.start);
    node_femur_hind_r_30.rotation.set(0.0, -0.35, 1.871);
  } else {
    node_femur_hind_r_30.position.set(-0.12, 0.39972, -0.215);
    node_femur_hind_r_30.rotation.set(0.0, -0.35, 1.871);
  }
  node_femur_hind_r_30.userData.sculptComponent = {"id": "femur-hind-r", "name": "Hind femur (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-hind-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.34944000000000003, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.34944000000000003, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.12, 0.39972, -0.215], "rotation": [0.0, -0.35, 1.871], "scale": [0.064, 0.34944000000000003, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_hind_r_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["root"] ?? root).add(node_femur_hind_r_30);
  nodes["femur-hind-r"] = node_femur_hind_r_30;
  const mesh_femur_hind_r_30Geometry = endpoint_femur_hind_r_30
    ? new THREE.CylinderGeometry(endpoint_femur_hind_r_30.endRadius, endpoint_femur_hind_r_30.baseRadius, endpoint_femur_hind_r_30.length, 8, 4)
    : buildWatertightCapsule(0.35, 0.7, 4, 8, 1);
  if (!endpoint_femur_hind_r_30) {
    mesh_femur_hind_r_30Geometry.scale(0.064, 0.34944000000000003, 0.064);
  }
  const mesh_femur_hind_r_30 = new THREE.Mesh(
    mesh_femur_hind_r_30Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_femur_hind_r_30.name = "Hind femur (r)";
  if (endpoint_femur_hind_r_30) {
    mesh_femur_hind_r_30.position.copy(endpoint_femur_hind_r_30.midpoint);
    mesh_femur_hind_r_30.quaternion.copy(endpoint_femur_hind_r_30.quaternion);
  }
  mesh_femur_hind_r_30.castShadow = options.castShadow ?? true;
  mesh_femur_hind_r_30.receiveShadow = options.receiveShadow ?? true;
  mesh_femur_hind_r_30.userData.sculptComponent = {"id": "femur-hind-r", "name": "Hind femur (r)", "level": "meso", "role": "body", "importance": 0.7, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "FAT rounded lobe, nearly as thick as it is long - the zone scan corrected this from the whole-image read, where the limbs look uniformly thin.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": {"parentId": null, "parentSocket": "limb-hind-r-root", "localStart": [0, 0, 0], "localEnd": [0, 0.34944000000000003, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.002, "confidence": 0.85, "notes": "Fat proximal lobe seated in the limb root. Reparented past a container node that carried no geometry; the container's transform is folded into this component."}, "dimensions": {"width": 0.064, "height": 0.34944000000000003, "depth": 0.064, "units": "world (1 unit = 1 maze tile)", "confidence": 0.85}, "transform": {"position": [-0.12, 0.39972, -0.215], "rotation": [0.0, -0.35, 1.871], "scale": [0.064, 0.34944000000000003, 0.064]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "femurLobe", "kind": "bevel", "description": "Fat rounded proximal lobe, nearly as thick as it is long - corrected from the zone scan, where the whole-image read had suggested uniformly thin limbs."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r1c0"], "details": ["forelimb-fat-lobes"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r1c0"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_femur_hind_r_30.add(mesh_femur_hind_r_30);
  meshes["femur-hind-r"] = mesh_femur_hind_r_30;
  colliders["femur-hind-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tibia_hind_r_31 = makeAttachmentEndpoint(null);
  const node_tibia_hind_r_31 = new THREE.Group();
  node_tibia_hind_r_31.name = "Hind tibia (r)__pivot";
  node_tibia_hind_r_31.scale.set(1, 1, 1);
  if (endpoint_tibia_hind_r_31) {
    node_tibia_hind_r_31.position.copy(endpoint_tibia_hind_r_31.start);
    node_tibia_hind_r_31.rotation.set(1.15, 0.0, 0.0);
  } else {
    node_tibia_hind_r_31.position.set(0.0, 0.34944000000000003, 0.0);
    node_tibia_hind_r_31.rotation.set(1.15, 0.0, 0.0);
  }
  node_tibia_hind_r_31.userData.sculptComponent = {"id": "tibia-hind-r", "name": "Hind tibia (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-hind-r", "attachment": {"parentId": "femur-hind-r", "parentSocket": "femur-hind-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.29952, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.29952, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.34944000000000003, 0], "rotation": [1.15, 0, 0], "scale": [0.0288, 0.29952, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_hind_r_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["femur-hind-r"] ?? root).add(node_tibia_hind_r_31);
  nodes["tibia-hind-r"] = node_tibia_hind_r_31;
  const mesh_tibia_hind_r_31Geometry = endpoint_tibia_hind_r_31
    ? new THREE.CylinderGeometry(endpoint_tibia_hind_r_31.endRadius, endpoint_tibia_hind_r_31.baseRadius, endpoint_tibia_hind_r_31.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tibia_hind_r_31) {
    mesh_tibia_hind_r_31Geometry.scale(0.0288, 0.29952, 0.0288);
  }
  const mesh_tibia_hind_r_31 = new THREE.Mesh(
    mesh_tibia_hind_r_31Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tibia_hind_r_31.name = "Hind tibia (r)";
  if (endpoint_tibia_hind_r_31) {
    mesh_tibia_hind_r_31.position.copy(endpoint_tibia_hind_r_31.midpoint);
    mesh_tibia_hind_r_31.quaternion.copy(endpoint_tibia_hind_r_31.quaternion);
  }
  mesh_tibia_hind_r_31.castShadow = options.castShadow ?? true;
  mesh_tibia_hind_r_31.receiveShadow = options.receiveShadow ?? true;
  mesh_tibia_hind_r_31.userData.sculptComponent = {"id": "tibia-hind-r", "name": "Hind tibia (r)", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Thin beaded shaft. The contrast between the fat femur lobe and this thin shaft is what makes the limb read as arthropod rather than as a tube. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "femur-hind-r", "attachment": {"parentId": "femur-hind-r", "parentSocket": "femur-hind-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.29952, 0], "contactType": "socket", "embedDepth": 0.008, "gapTolerance": 0.002, "confidence": 0.7, "notes": "Thin shaft hinged off the femur; the Z-fold happens here."}, "dimensions": {"width": 0.0288, "height": 0.29952, "depth": 0.0288, "units": "world (1 unit = 1 maze tile)", "confidence": 0.7}, "transform": {"position": [0, 0.34944000000000003, 0], "rotation": [1.15, 0, 0], "scale": [0.0288, 0.29952, 0.0288]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "distalBeading", "kind": "stitch", "description": "Thin tapering shaft divided into short beads along its curve."}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tibia_hind_r_31.add(mesh_tibia_hind_r_31);
  meshes["tibia-hind-r"] = mesh_tibia_hind_r_31;
  colliders["tibia-hind-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  const endpoint_tarsus_hind_r_32 = makeAttachmentEndpoint(null);
  const node_tarsus_hind_r_32 = new THREE.Group();
  node_tarsus_hind_r_32.name = "Hind tarsus (r)__pivot";
  node_tarsus_hind_r_32.scale.set(1, 1, 1);
  if (endpoint_tarsus_hind_r_32) {
    node_tarsus_hind_r_32.position.copy(endpoint_tarsus_hind_r_32.start);
    node_tarsus_hind_r_32.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tarsus_hind_r_32.position.set(0.0, 0.29952, 0.0);
    node_tarsus_hind_r_32.rotation.set(0.35, 0.0, 0.0);
  }
  node_tarsus_hind_r_32.userData.sculptComponent = {"id": "tarsus-hind-r", "name": "Hind tarsus (r)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-hind-r", "attachment": {"parentId": "tibia-hind-r", "parentSocket": "tibia-hind-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.18304, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.18304, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.29952, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.18304, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_hind_r_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}};
  (nodes["tibia-hind-r"] ?? root).add(node_tarsus_hind_r_32);
  nodes["tarsus-hind-r"] = node_tarsus_hind_r_32;
  const mesh_tarsus_hind_r_32Geometry = endpoint_tarsus_hind_r_32
    ? new THREE.CylinderGeometry(endpoint_tarsus_hind_r_32.endRadius, endpoint_tarsus_hind_r_32.baseRadius, endpoint_tarsus_hind_r_32.length, 8, 4)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, -0.5, 0.0], "rx": 0.06, "rz": 0.04, "twist": 0.0}, {"position": [0.0, -0.1, 0.0], "rx": 0.048, "rz": 0.03, "twist": 0.0}, {"position": [0.0, 0.25, 0.0], "rx": 0.024, "rz": 0.014, "twist": 0.0}, {"position": [0.0, 0.5, 0.0], "rx": 0.0, "rz": 0.0, "twist": 0.0}], "radialSegments": 10, "capEnds": true});
  if (!endpoint_tarsus_hind_r_32) {
    mesh_tarsus_hind_r_32Geometry.scale(0.0192, 0.18304, 0.0192);
  }
  const mesh_tarsus_hind_r_32 = new THREE.Mesh(
    mesh_tarsus_hind_r_32Geometry,
    materialMap["cuticleDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tarsus_hind_r_32.name = "Hind tarsus (r)";
  if (endpoint_tarsus_hind_r_32) {
    mesh_tarsus_hind_r_32.position.copy(endpoint_tarsus_hind_r_32.midpoint);
    mesh_tarsus_hind_r_32.quaternion.copy(endpoint_tarsus_hind_r_32.quaternion);
  }
  mesh_tarsus_hind_r_32.castShadow = options.castShadow ?? true;
  mesh_tarsus_hind_r_32.receiveShadow = options.receiveShadow ?? true;
  mesh_tarsus_hind_r_32.userData.sculptComponent = {"id": "tarsus-hind-r", "name": "Hind tarsus (r)", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.6, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Final thin taper ending in a fine point; carries the terminal claw as a local feature rather than its own mesh. A tapered sweep along a curve, not a straight cone - the sweep is real geometry. Classified continuous-sculpt: one tangent-continuous surface, not parts butted together.", "geometryDescriptor": {"topologyIntent": "stylized creature part, cel-shaded (authored as tapered-cylinder)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "tibia-hind-r", "attachment": {"parentId": "tibia-hind-r", "parentSocket": "tibia-hind-r-distal", "localStart": [0, 0, 0], "localEnd": [0, 0.18304, 0], "contactType": "socket", "embedDepth": 0.005, "gapTolerance": 0.002, "confidence": 0.6, "notes": "Final taper to a fine point."}, "dimensions": {"width": 0.0192, "height": 0.18304, "depth": 0.0192, "units": "world (1 unit = 1 maze tile)", "confidence": 0.6}, "transform": {"position": [0, 0.29952, 0], "rotation": [0.35, 0, 0], "scale": [0.0192, 0.18304, 0.0192]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": ""}}, "material": "cuticleDark", "materialLayers": ["cuticleDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tarsalClaw", "kind": "bevel", "description": "Tip narrowed to a small hook. Sub-millimetre at gameplay size - a shape cue, not a separate part.", "detailRef": "distal-limb-beading"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone-r2c1"], "details": ["distal-limb-beading"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 47, 18, 1.0)", "secondaryAlbedo": "rgba(70, 30, 12, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["zone-r2c1"], "notes": "Darker cuticle on limbs, antennae, belly and rostrum. Follows the frightened recolour with the body.", "samplingNote": "Authored from the hue/value/saturation read in image-analysis.md Layer 6, NOT sampled from pixels: flea1.png carries a stock watermark over the body."}};
  node_tarsus_hind_r_32.add(mesh_tarsus_hind_r_32);
  meshes["tarsus-hind-r"] = mesh_tarsus_hind_r_32;
  colliders["tarsus-hind-r"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "no physics engine in this stack"};

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "silhouette-and-region-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": false, "normalOrBumpRequired": false, "localOverridesRequired": true, "minimumTextureResolution": 0, "preferredTextureResolution": 0, "independentMapChannels": [], "rationale": "Rewritten from the photographic default. Every material declares textureless with evidence, so map-channel targets describe nothing here. What replaces them: a flat palette whose region BOUNDARIES are geometry, and the team-colour contract."}, "lightingPass": {"matchReferenceKeyDirection": false, "rationale": "The consumer owns its own lighting rig and every enemy skin shares it; this model must read under that rig, not under the reference photograph's."}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createCartoonFleaLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Cartoon Flea look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "direction": [-0.4, 1.0, 0.6], "intensity": 1.0, "color": "#FFF6E6", "notes": "The consumer's existing scene key (src/render/scene.ts). NOT solved from the reference: the reference's lighting is a drawing convention and this model must sit in the same rig as the other enemy skins."}, {"id": "fill", "type": "hemisphere", "direction": [0.0, 1.0, 0.0], "intensity": 0.45, "color": "#BFD8FF", "notes": "Sky/ground hemisphere fill; keeps the dark accent cuticle from going to black in shadow."}, {"id": "rim", "type": "directional", "direction": [0.5, 0.4, -0.9], "intensity": 0.35, "color": "#FFFFFF", "notes": "Back rim that separates the enemy from the maze floor. With a toon ramp this is what carries the read of the dorsal arch, since there is no specular falloff to do it."}, {"id": "render-intent", "type": "render-settings", "toneMapping": "NoToneMapping", "exposure": 1.0, "notes": "TONE MAPPING IS NoToneMapping AND MUST STAY THAT WAY - it is load-bearing, not a preference. The whole scene is cel-shaded on one shared 3-step gradient ramp; a filmic/ACES curve re-compresses those bands and undoes the point of the ramp. Exposure is left at 1.0 for the same reason: the ramp positions are authored against unmodified radiance. CONTACT SHADOW / GROUND SHADOW: every mesh in this model sets castShadow, and the maze floor receives - the ground shadow under the body is what plants the enemy on the floor plane, which matters more here than usual because the flea is lifted on long limbs and would otherwise read as hovering. There is no ambient-occlusion map (an AO map would be quantised into the same ramp bands as everything else); the contact read comes from the real shadow instead."}];
  lights.userData.lookDevTargets = {"qualityPriority": "silhouette-and-region-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": false, "normalOrBumpRequired": false, "localOverridesRequired": true, "minimumTextureResolution": 0, "preferredTextureResolution": 0, "independentMapChannels": [], "rationale": "Rewritten from the photographic default. Every material declares textureless with evidence, so map-channel targets describe nothing here. What replaces them: a flat palette whose region BOUNDARIES are geometry, and the team-colour contract."}, "lightingPass": {"matchReferenceKeyDirection": false, "rationale": "The consumer owns its own lighting rig and every enemy skin shares it; this model must read under that rig, not under the reference photograph's."}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCartoonFleaEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameCartoonFleaCamera(
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
export function createCartoonFleaPresentationComposer(
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

export function configureCartoonFleaRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createCartoonFleaInspectControls(
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
