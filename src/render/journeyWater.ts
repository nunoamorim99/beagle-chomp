// OWNER: render-artist (IDEA-079)
//
// THE MADBOX WATER, PORTED.
//
// Built from Nuno's reverse engineering of madbox.io (`MADBOX_WATER.md`), whose
// central finding is worth restating because it is the opposite of the obvious
// approach: **there is no water simulation.** No reflection, no refraction, no
// normal map, no vertex displacement, no depth read, no render target. The
// ocean is flat unlit meshes with two tiny shaders, and water reads as water
// almost entirely because of WHAT HAPPENS WHERE IT MEETS LAND.
//
// That matched a problem we already had. The previous sea was a displaced,
// toon-lit, canvas-textured plane, and all three of those were fighting it: the
// displacement put wave slopes into the toon ramp's middle band, which blotched
// the water dark; the canvas foam multiplied the whole ocean by 0.8 to leave
// room for highlights; and the lagoons needed a separate mesh because the plane
// could not resolve them.
//
// ---------------------------------------------------------------------------
// FOUR THINGS THAT COULD NOT BE COPIED AS WRITTEN
// ---------------------------------------------------------------------------
//
//  1. **THE COASTLINE RIBBON IS GENERATED, NOT MODELLED — and that is the one
//     place this port is EASIER than the original.** Their section 7 is a
//     Blender checklist: select the boundary loop of every island, flatten,
//     offset outward, unwrap so V runs across, join. It is most of their
//     authoring cost. Our islands are CIRCLES, so a coastline ribbon is an
//     annulus and the whole asset step collapses to twenty lines of arithmetic.
//
//  2. **THE NOISE MUST BE PERIODIC, OR EVERY ISLAND GETS A SEAM.** Theirs is
//     one merged open perimeter, so U runs 0..1 once across hundreds of metres
//     and its two ends never meet. Ours are CLOSED loops: U = 0 and U = 1 are
//     the same vertices, and Perlin is not periodic, so `cnoise` would draw a
//     hard radial line down every island. `pnoise` with `rep.x = uFrequency.x`
//     is exact — which also makes that frequency an INTEGER rather than a taste
//     value, since a fractional repeat does not close.
//
//  3. **THEIR FREQUENCY IS NOT OURS.** `uFrequency.x = 40` is 40 noise cells
//     spread over the merged perimeter of every island in their scene. Applied
//     per island that is static. Their own note says to start near 6 when
//     unwrapping per-island, and that is what this ships.
//
//  4. **FOG, WHICH THEY DELIBERATELY DO NOT HAVE.** Their section 9 lists "no
//     fog" among the traps avoided. We have per-theme fog and the map leans on
//     it for depth down a 280-unit chain, so an unlit `ShaderMaterial` that
//     ignored it would leave the sea crisp behind islands that are fading out.
//     Both materials take the fog chunks and `fog: true`.
//
// And one trap that is OURS rather than theirs:
//
//  5. **`<colorspace_fragment>` IS NOT OPTIONAL HERE.** Their shaders end with
//     `<encodings_fragment>` (the r126 spelling; r152+ renamed it). It is
//     tempting to drop, because this project already ships four hand-written
//     gradient shaders that omit it — and [[IDEA-072]] measured what that costs:
//     they render **~40% dark**, because `new THREE.Color(hex)` converts to
//     LINEAR under colour management and writing that triple raw displays it as
//     if it were sRGB. `palette.bg` 0x9ecbe8 shows on screen as 0x5798ce. Every
//     colour in this file arrives as a THREE.Color uniform, so the conversion
//     has to run.
//
// Their own deviations we keep exactly: `uTime` is MILLISECONDS (feed it
// seconds and `uSpeed = -0.0004` looks frozen, not wrong), `uSpeed` is NEGATIVE
// so foam rolls toward the coast rather than out to sea, and the foam threshold
// is a hard `step()` rather than a `smoothstep()` — their section 4.3 calls
// that "the stylistic decision", and a soft one gives generic mist where the
// hard one gives the flat printed shapes a toon scene wants.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** One island's coastline, in world space. */
export interface ShoreIsland {
  position: THREE.Vector3;
  radius: number;
}

export interface WaterParams {
  /** Sea gradient, near/centre -> far/edge. */
  shallow: number;
  deep: number;
  /** How far from the gradient's centre the deep colour is reached, in world
   *  units, per axis. Two numbers rather than one because the map is a CHAIN:
   *  it wants to stay bright along its length and go deep at the sides. */
  radiusX: number;
  radiusZ: number;
  /** Foam cells along the coast (INTEGER — see rule 2) and across the ribbon. */
  frequency: readonly [number, number];
  /** Scroll rate against a MILLISECOND clock. Negative rolls foam shoreward. */
  speed: number;
  /** Hard cut on the noise. Lower = more foam. */
  threshold: number;
  /** Contact shadow at the waterline. Deep indigo, never black — their note is
   *  that a darkened water colour reads muddy while a violet one reads as a
   *  cool bounce and keeps the palette clean. */
  aoColor: number;
  aoPower: number;
  aoAlpha: number;
  /** Ribbon extent, as multiples of an island's radius. */
  ribbonInner: number;
  ribbonOuter: number;
  ribbonSegments: number;
  /** How far the ribbon floats above the sea. Never coplanar. */
  lift: number;
}

export const WATER_PARAMS: WaterParams = {
  shallow: 0x21c7ff,
  deep: 0x0a3fb8,
  radiusX: 17,
  radiusZ: 34,
  // 10, not their 6-ish per-island suggestion. Measured on our geometry: an
  // island's waterline is ~19 units round, so 6 cells is a 3.2-unit dash and
  // at map distance those read as SPEED LINES rather than surf. Ten lands near
  // 2 units, which is the short-dash look their own verification render shows.
  frequency: [10, 10],
  speed: -0.0004,
  // 0.42, against their 0.5. Their coastlines are hundreds of metres of
  // irregular shore and ours is a 13-unit circle, so the same threshold yields
  // two or three dashes an island — which reads as debris rather than surf.
  threshold: 0.42,
  aoColor: 0x0c0840,
  // 5, not 7, and ALPHA WELL UP. Their exponent is tuned against a ribbon
  // 1-2 units wide on a large island; on our 2-unit ribbon round a 2.1-unit
  // rock, pow 7 confines the contact shadow to the last few pixels and it
  // stops doing the one job it exists for — their own tuning table says
  // exactly this ("islands look pasted on the water: raise uAOAlpha, or lower
  // uAOPower"), and pasted-on is the note this whole pass started from.
  aoPower: 5,
  aoAlpha: 0.55,
  ribbonInner: 0.985,
  // Pulled in from 2.05: their tuning table's "foam reaches too far into open
  // water" symptom, and at 2.05 the dashes ran a full two island-radii out and
  // started colliding with the next island's.
  ribbonOuter: 1.8,
  ribbonSegments: 56,
  lift: 0.02,
};

// Classic PERIODIC Perlin 2D, Stefan Gustavson (MIT) — glsl-noise/periodic/2d.
// The periodic variant rather than their `cnoise`: see rule 2.
const PNOISE = /* glsl */ `
vec4 mod289_w(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute_w(vec4 x){ return mod289_w(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt_w(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade_w(vec2 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

float pnoise_w(vec2 P, vec2 rep) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod(Pi, rep.xyxy);
  Pi = mod289_w(Pi);
  vec4 ix = Pi.xzxz, iy = Pi.yyww;
  vec4 fx = Pf.xzxz, fy = Pf.yyww;
  vec4 i  = permute_w(permute_w(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  gx = gx - floor(gx + 0.5);
  vec2 g00 = vec2(gx.x, gy.x), g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z), g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt_w(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade_w(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}
`;

/**
 * THE SEA: one flat plane, one radial gradient, no lights and no movement.
 *
 * The gradient is evaluated in WORLD space against a moving centre, which is
 * this port's fifth deviation. Theirs is baked into the plane's own UVs — fine
 * for a fixed hero shot, and wrong the moment the surface pans: a gradient
 * nailed to the mesh slides across the frame as the map scrolls, so the
 * composition it was tuned for only holds at one scroll position. Driven off a
 * centre that tracks the camera it stays put on screen, which is what the
 * gradient is FOR — their note is that a radial one "stays lit from the middle
 * from any angle", and for us that has to survive the camera moving as well.
 *
 * Elliptical rather than circular for the same reason the map is a chain and
 * not a diorama: bright along the run of islands, deep at the left and right
 * edges of frame.
 */
export function createSeaMaterial(p: WaterParams = WATER_PARAMS): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    lights: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: new THREE.Vector2(p.radiusX, p.radiusZ) },
        uColorA: { value: new THREE.Color(p.shallow) },
        uColorB: { value: new THREE.Color(p.deep) },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec2 vWorldXZ;
      #include <fog_pars_vertex>
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uCenter;
      uniform vec2 uRadius;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vWorldXZ;
      #include <fog_pars_fragment>
      void main() {
        vec2 g = (vWorldXZ - uCenter) / uRadius;
        // Their note: do NOT drop the smoothstep. length() alone is linear and
        // reads as a cheap vignette; the ease is what makes it feel like depth.
        float strength = smoothstep(0.0, 1.0, length(g));
        gl_FragColor = vec4(mix(uColorA, uColorB, strength), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/**
 * THE SHORE RIBBON — the whole effect, per their section 4.
 *
 * `sqrt(vUv.y)` is applied TWICE and the two do different jobs: before the
 * `step()` it biases the noise so more of it crosses the threshold near the
 * waterline (changing HOW MANY dashes appear), and after it fades the survivors
 * outward (changing HOW VISIBLE they are). Doing only one gives either a hard
 * wall of foam or a uniform scatter.
 *
 * `pow(vUv.y, 7)` is the contact shadow, invisible until the last ~15% of the
 * ribbon. Their section 4.3 calls it out as what makes islands look like they
 * are IN the water rather than pasted onto it, which was exactly our complaint.
 */
export function createShoreMaterial(p: WaterParams = WATER_PARAMS): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    // The ribbon floats 2 cm above the sea. Writing depth would make it fight
    // the plane and anything drawn after it. Test, do not write.
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    lights: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uFrequency: { value: new THREE.Vector2(Math.round(p.frequency[0]), p.frequency[1]) },
        uSpeed: { value: p.speed },
        uThreshold: { value: p.threshold },
        uAOColor: { value: new THREE.Color(p.aoColor) },
        uAOPower: { value: p.aoPower },
        uAOAlpha: { value: p.aoAlpha },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2  uFrequency;
      uniform float uSpeed;
      uniform float uThreshold;
      uniform vec3  uAOColor;
      uniform float uAOPower;
      uniform float uAOAlpha;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      ${PNOISE}
      void main() {
        vec2 wavesUv = vUv * uFrequency;
        wavesUv.y += uTime * uSpeed;

        float wavesDepth = sqrt(vUv.y);

        // rep.x closes the loop around the island; rep.y is large because that
        // axis scrolls rather than wrapping (it simply recurs every 100 cells).
        float w = pnoise_w(wavesUv, vec2(uFrequency.x, 100.0));
        w *= wavesDepth;
        w  = step(uThreshold, w);
        w *= wavesDepth;

        float ao = pow(vUv.y, uAOPower) * uAOAlpha;

        gl_FragColor = vec4(1.0);
        gl_FragColor.rgb = mix(uAOColor, vec3(1.0), 1.0 - step(w, 0.01));
        gl_FragColor.a   = max(w, ao);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/**
 * One annulus per island, merged into a single geometry — their "all coastlines
 * are one mesh" rule, which is why their entire ocean is three draw calls.
 *
 * TWO RINGS IS EXACT, not an approximation, and the instinct to subdivide
 * radially is wasted work: V is linear in radius and the rasteriser interpolates
 * it linearly, so a fragment halfway across the ribbon receives the true V
 * whatever the tessellation. Every non-linearity in the shader — both `sqrt`s,
 * the `pow(v, 7)`, the noise — is evaluated PER FRAGMENT from that value. Extra
 * rings would change nothing at all.
 */
export function shoreRibbonGeometry(
  islands: readonly ShoreIsland[],
  p: WaterParams = WATER_PARAMS,
  waterY = 0,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const seg = p.ribbonSegments;

  for (const isl of islands) {
    const ri = isl.radius * p.ribbonInner;
    const ro = isl.radius * p.ribbonOuter;
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const uv = new Float32Array((seg + 1) * 2 * 2);
    const idx: number[] = [];

    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const a = u * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Outer vertex is V = 0 (open water), inner is V = 1 (the waterline).
      // Their checklist warns that a flipped V is the commonest mistake here —
      // it puts the foam and the contact shadow out at sea instead of at the
      // coast, and it renders perfectly happily.
      for (let j = 0; j < 2; j++) {
        const r = j === 0 ? ro : ri;
        const o = (i * 2 + j) * 3;
        pos[o] = isl.position.x + ca * r;
        pos[o + 1] = waterY + p.lift;
        pos[o + 2] = isl.position.z + sa * r;
        uv[(i * 2 + j) * 2] = u;
        uv[(i * 2 + j) * 2 + 1] = j;
      }
      if (i < seg) {
        const b = i * 2;
        // WOUND SO THE RIBBON FACES UP, and the obvious order does not.
        // Writing the quad in reading order — outer_i, outer_i+1, inner_i —
        // gives a normal of (0, -1, 0): with U increasing anticlockwise in the
        // XZ plane and V pointing INWARD, the natural traversal crosses to a
        // DOWNWARD normal, so a FrontSide annulus is culled to nothing. That
        // renders exactly like the shader having failed, which is how the
        // first build read. [[IDEA-059]] rule 11 is the same defect on a patch
        // grid; this is its polar twin.
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    parts.push(g);
  }

  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * Per-frame update. `elapsedMs` is MILLISECONDS — their note, and it is the one
 * mistake that shows up as the foam being perfectly still rather than as an
 * error. `groundCenter` moves the gradient so the composition survives a pan.
 */
export function updateJourneyWater(
  materials: readonly THREE.ShaderMaterial[],
  elapsedMs: number,
  groundCenter?: THREE.Vector2,
): void {
  for (const m of materials) {
    if (m.uniforms.uTime) m.uniforms.uTime.value = elapsedMs;
    if (groundCenter && m.uniforms.uCenter) {
      (m.uniforms.uCenter.value as THREE.Vector2).copy(groundCenter);
    }
  }
}
