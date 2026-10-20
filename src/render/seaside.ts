// OWNER: render-artist (IDEA-080 — the Sunny Beach gets a sea)
//
// Nuno: *"on the Sunny beach maze we have some dunes on the environment around
// the maze but lets add instead a sea on the top on the north part of the
// maze."*
//
// THE BEACH'S SURROUND WAS A FIELD OF DUNES, AND UNDER THE SHIPPED STYLE THEY
// WERE BOULDERS. `distantDune` paints its mounds in the surround set's `sand`
// role, which was tuned to sit a hair above the ground so a dune read only on
// its curvature — and IDEA-079's snap moved that colour to the palette's pale
// `sand` entry while the ground stayed a lifted mid tan. Every mound came back
// as a pale low-poly rock on a darker plain: the quarry the material's own
// comment warns about, produced by the style rather than by the colour.
//
// A SEA IS THE ONE THING A BEACH HAS THAT NOTHING ELSE IN THIS GAME DOES, and
// the board is already oriented for it: the camera looks NORTH and DOWN, so
// the north band is the deepest strip of ground in every frame (the top 30% of
// a phone) and the only band that is never under the HUD or the D-pad. The
// apron's row of umbrellas along the board's north edge was already facing it.
//
// It is the Journey's madbox water (`journeyWater.ts`) brought to a straight
// coast, and the same finding carries it: **there is no water simulation.**
// Flat unlit meshes, one depth gradient, and everything that says WATER happens
// where it meets the land. Four things are load-bearing.
//
//  1. THE COAST IS A FUNCTION, NOT A MESH. `shoreZ(x)` is the one definition of
//     where the water starts, and the sea plane, the shore ribbon AND the
//     surround recipe's keep-out test (`inSea`) all read it. The pizza's
//     `sectorOutline` reasoning a third time: three things derived from one
//     curve cannot disagree about where the beach ends — and the recipe's
//     umbrellas standing in the surf is the defect that would otherwise ship.
//
//  2. EVERY VERTEX CARRIES ITS SIGNED DISTANCE FROM THE COAST (`aDist`, positive
//     out to sea), and BOTH shaders colour the water from that one number with
//     the same function. So the ribbon's water and the plane's water are the
//     same colour where they overlap BY CONSTRUCTION, and the seam between the
//     two meshes is invisible without anyone tuning it.
//
//  3. THE SWASH IS THE WHOLE EFFECT. The waterline runs up the sand and back
//     on a slow sine, with a hard white foam edge riding it and a band of
//     darker WET SAND left behind it. A static coastline on a flat plane is a
//     blue rectangle laid on a brown one; a line that moves is water. The
//     foam's edge is a hard `step()`, never a smoothstep — their section 4.3's
//     "stylistic decision", and the reason it reads as printed toon shapes
//     rather than as mist.
//
//  4. `<colorspace_fragment>` RUNS IN BOTH SHADERS. Every colour arrives as a
//     THREE.Color uniform, which colour management has already converted to
//     LINEAR; written raw it would display ~40% dark, which is the backdrop
//     dome's own standing defect (IDEA-072). And both take the fog chunks, or
//     the far sea would stay crisp under a sky the board fades into.
//
// UNLIT ON PURPOSE, IN BOTH LOOKS. A `ShaderMaterial` has no `color`, so
// IDEA-079's `applyMadboxStyle` passes it by exactly as it passes the island
// map's water — and the classic toon scene has no lit water to match either.
//
// It ANIMATES WITHOUT A CALLER. The ribbon writes its own clock in
// `onBeforeRender`, so the game loop, the board preview and the editor all get
// moving surf without any of them learning that a sea exists — the surround is
// a cached, borrowed group and threading an update call to it through every
// scene that can show a board is the coupling this avoids.
import * as THREE from "three";

/**
 * The coast's tunables, as a NAMED MUTABLE TABLE under SURROUND_PARAMS' own
 * contract: production never writes it, and an editor dial would write the
 * values back to this literal.
 */
export const SEASIDE_PARAMS = {
  /**
   * Mean world z of the waterline. Negative is north.
   *
   * -16 leaves a strip of open beach between the board's north apron (which
   * carries the theme's row of umbrellas at z = -10.5) and the surf, and keeps
   * the sea in shot on a 16:9 DESKTOP — whose frame ends at z = -21.2, so the
   * coast cannot sit much further out than this or desktop players never see
   * it. It must stay north of the keep-clear box (z = -14.5) on its nearest
   * swell, which `scripts/test-surround.ts` asserts.
   */
  shoreZ: -16,
  /** How far the coastline wanders either side of `shoreZ`, world units. A
   *  ruled-straight coast is the one thing a real one never is. */
  shoreWander: 0.95,
  /** Turquoise at the waterline, deep blue offshore. */
  shallow: 0x3fd6cc,
  deep: 0x1c7fd0,
  /** World units of water before the deep colour is fully reached. */
  depthReach: 14,
  /** Wet sand, laid OVER the beach as a translucent darkening rather than as
   *  a colour of its own, so it follows whatever the ground is lifted to. */
  wetSand: 0x6a4a28,
  wetAlpha: 0.42,
  /** How far up the sand the swash runs at its peak, world units. */
  swashReach: 0.75,
  /** Width of the wet band left behind the swash's highest reach. */
  wetWidth: 0.9,
  /** Width of the solid foam line riding the waterline, world units. */
  foamWidth: 0.2,
  /** Foam dashes: cells per world unit ALONG the coast, and how far out to
   *  sea they reach. */
  dashFrequency: 0.55,
  dashReach: 3.2,
  /** Hard cut on the dash noise. Lower = more foam. */
  dashThreshold: 0.36,
  /** Swash period, seconds. Slow — this is a beach, not a storm. */
  swashPeriod: 7.5,
};

/** Where the ribbon starts above the sand and ends out at sea, in `aDist`. */
function ribbonExtent(): [number, number] {
  const P = SEASIDE_PARAMS;
  return [-(P.swashReach + P.wetWidth + 0.15), P.dashReach];
}

/**
 * THE coastline: world z of the waterline at world x.
 *
 * Two incommensurate sines, so the bays do not repeat at a period the eye can
 * pick up across a desktop's 63-unit-wide frame. Normalised so `shoreWander`
 * is the true peak, which is what the keep-clear assertion reads.
 */
export function shoreZ(x: number): number {
  const P = SEASIDE_PARAMS;
  const w = Math.sin(x * 0.17 + 0.6) + 0.5 * Math.sin(x * 0.43 + 2.1);
  return P.shoreZ + (P.shoreWander * w) / 1.5;
}

/**
 * Is (x, z) in the water — or within `margin` of it?
 *
 * The surround recipe's keep-out test. Positive `margin` keeps a thing that
 * much further up the beach than the waterline's MEAN, and callers should pass
 * at least the swash reach plus the object's own radius, because the swash
 * runs UP the sand: an umbrella planted exactly at the mean waterline is
 * standing in the surf half the time.
 */
export function inSea(x: number, z: number, margin = 0): boolean {
  return z < shoreZ(x) + margin;
}

// Classic PERIODIC Perlin 2D, Stefan Gustavson (MIT) — the same function
// journeyWater.ts carries. Periodic is not needed on an open coast (it never
// closes into a loop), but sharing the exact noise keeps the island map's
// surf and the beach's surf one family.
const PNOISE = /* glsl */ `
vec4 mod289_s(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute_s(vec4 x){ return mod289_s(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt_s(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade_s(vec2 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }
float pnoise_s(vec2 P, vec2 rep) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod(Pi, rep.xyxy);
  Pi = mod289_s(Pi);
  vec4 ix = Pi.xzxz, iy = Pi.yyww;
  vec4 fx = Pf.xzxz, fy = Pf.yyww;
  vec4 i  = permute_s(permute_s(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  gx = gx - floor(gx + 0.5);
  vec2 g00 = vec2(gx.x, gy.x), g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z), g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt_s(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade_s(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}
`;

/** Rule 2: the ONE water colour, shared by both shaders. */
const WATER_COLOUR = /* glsl */ `
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uDepthReach;
vec3 waterAt(float d) {
  // The ease is what makes it read as depth rather than as a vignette —
  // journeyWater.ts's note, kept.
  return mix(uShallow, uDeep, smoothstep(0.0, 1.0, max(d, 0.0) / uDepthReach));
}
`;

const VERTEX = /* glsl */ `
attribute float aDist;
varying float vDist;
varying float vAlong;
#include <fog_pars_vertex>
void main() {
  vDist = aDist;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vAlong = worldPos.x;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

function waterUniforms(): Record<string, THREE.IUniform> {
  const P = SEASIDE_PARAMS;
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uShallow: { value: new THREE.Color(P.shallow) },
      uDeep: { value: new THREE.Color(P.deep) },
      uDepthReach: { value: P.depthReach },
      uTime: { value: 0 },
    },
  ]);
}

/**
 * THE SEA: the depth gradient, plus faint crest lines drifting shoreward far
 * out. The crests are what keep a hundred square units of one gradient from
 * reading as a painted floor; they are kept faint (a quarter of the way to
 * white) because the foam at the coast has to stay the loudest white in the
 * picture.
 */
export function createBeachSeaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    lights: false,
    fog: true,
    uniforms: waterUniforms(),
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vDist;
      varying float vAlong;
      #include <fog_pars_fragment>
      ${WATER_COLOUR}
      ${PNOISE}
      void main() {
        vec3 col = waterAt(vDist);
        // Crests as THIN LINES: a narrow band of the noise rather than
        // everything above a threshold. The threshold version drew whole
        // noise blobs, and at sea those read as pale PUDDLES lying on the
        // water — or as cloud reflections — rather than as waves. A band
        // between two cuts is the blob's contour, which is the wavy ink line
        // a cartoon sea is drawn with. Stretched along the coast and
        // scrolling toward it.
        float n = pnoise_s(vec2(vAlong * 0.11, vDist * 0.42 + uTime * 0.00012), vec2(289.0));
        float crest = (step(0.5, n) - step(0.58, n)) * smoothstep(3.0, 7.0, vDist);
        // ...and BROKEN, because a contour of a blob is a CLOSED loop and a
        // field of closed loops reads as doodles rather than as waves. A
        // second, coarser noise keeps roughly half of each loop: open arcs.
        crest *= step(0.05, pnoise_s(vec2(vAlong * 0.32, vDist * 0.21), vec2(289.0)));
        col = mix(col, vec3(1.0), crest * 0.34);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** THE SHORE: swash, foam line, dashes and wet sand — rule 3. */
export function createBeachShoreMaterial(): THREE.ShaderMaterial {
  const P = SEASIDE_PARAMS;
  const u = waterUniforms();
  Object.assign(u, {
    uWet: { value: new THREE.Color(P.wetSand) },
    uWetAlpha: { value: P.wetAlpha },
    uSwashReach: { value: P.swashReach },
    uWetWidth: { value: P.wetWidth },
    uFoamWidth: { value: P.foamWidth },
    uDashFreq: { value: P.dashFrequency },
    uDashReach: { value: P.dashReach },
    uDashThreshold: { value: P.dashThreshold },
    uSwashOmega: { value: (Math.PI * 2) / (P.swashPeriod * 1000) },
  });
  return new THREE.ShaderMaterial({
    transparent: true,
    // It lies a hair above the sea and the sand. Test, never write: writing
    // depth would make it fight both, and anything drawn after it.
    depthWrite: false,
    lights: false,
    fog: true,
    uniforms: u,
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uWet;
      uniform float uWetAlpha;
      uniform float uSwashReach;
      uniform float uWetWidth;
      uniform float uFoamWidth;
      uniform float uDashFreq;
      uniform float uDashReach;
      uniform float uDashThreshold;
      uniform float uSwashOmega;
      varying float vDist;
      varying float vAlong;
      #include <fog_pars_fragment>
      ${WATER_COLOUR}
      ${PNOISE}
      void main() {
        // The waterline, in aDist units: 0 at the swash's lowest ebb, and
        // -uSwashReach at its highest run up the sand. Phase drifts along the
        // coast so the whole beach does not breathe in unison, which reads as
        // the plane moving rather than the water.
        float phase = uTime * uSwashOmega + vAlong * 0.11;
        float wl = -uSwashReach * (0.5 + 0.5 * sin(phase));
        // Ragged by noise, so the edge is a line somebody DREW rather than a
        // ruler's — static along the coast, so it does not shimmer.
        float rag = pnoise_s(vec2(vAlong * 1.3, 3.7), vec2(289.0));
        float d = vDist;
        vec4 outCol = vec4(0.0);
        if (d < wl) {
          // Up the beach: wet sand, darkest at the water and fading to dry.
          // Its upper edge sits at the swash's HIGHEST reach whatever the
          // phase, which is what a real beach does — the sand stays dark
          // where the last wave got to.
          float top = -uSwashReach - uWetWidth * (0.75 + 0.25 * rag);
          float wet = smoothstep(top, -uSwashReach * 0.6, d);
          outCol = vec4(uWet, wet * uWetAlpha);
        } else {
          float e = d - wl;
          // The foam line riding the swash. Hard edge — rule 3.
          float foam = step(e, uFoamWidth * (0.75 + 0.5 * rag));
          // Dashes, scrolling shoreward and thinning out to sea.
          float fade = 1.0 - smoothstep(0.0, uDashReach, d);
          float n = pnoise_s(vec2(vAlong * uDashFreq, d * 1.4 + uTime * 0.0005), vec2(289.0));
          float dash = step(uDashThreshold, n * sqrt(fade)) * fade;
          float white = max(foam, dash);
          // Over the sand (d < 0) the ribbon has to paint the water itself,
          // because the sea plane starts at d = 0; past that the plane is
          // underneath and only the foam needs drawing.
          float waterA = 1.0 - step(0.0, d);
          vec3 water = mix(waterAt(d), vec3(1.0), 0.12);
          outCol = vec4(mix(water, vec3(1.0), white), max(waterA, white));
        }
        gl_FragColor = outCol;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/**
 * A strip of quads following the coast, `cols` across x and one row per entry
 * of `dists`, with `aDist` stamped per vertex.
 *
 * TWO ROWS ARE EXACT for the ribbon, for journeyWater.ts's reason: z is linear
 * in aDist across the strip, so the rasteriser interpolates the true distance
 * and every non-linearity in the shader is evaluated per fragment. The sea
 * needs more rows only because its far edge is a FIXED z rather than a fixed
 * distance, which bends the mapping.
 *
 * WOUND TO FACE UP. With x increasing along a row and the next row further
 * NORTH (smaller z), (a, b, c) / (b, d, c) crosses to +Y; the reading-order
 * winding faces DOWN and a FrontSide plane culls to nothing, which renders
 * exactly like the shader having failed (journeyWater.ts's ribbon, and
 * IDEA-059 rule 11 before it).
 */
function coastStrip(
  halfWidth: number,
  cols: number,
  rowDist: (x: number, j: number) => number,
  rows: number,
  y: number,
): THREE.BufferGeometry {
  const pos = new Float32Array((cols + 1) * rows * 3);
  const dist = new Float32Array((cols + 1) * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = -halfWidth + (i / cols) * halfWidth * 2;
      const d = rowDist(x, j);
      const k = j * (cols + 1) + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = shoreZ(x) - d;
      dist[k] = d;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + (cols + 1);
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export interface Seaside {
  group: THREE.Group;
  /** Owned: freed by `disposeSeaside`, never by the surround's material set. */
  materials: THREE.ShaderMaterial[];
}

/**
 * Build the sea north of `shoreZ`, out to `zFar`, across `halfWidth`.
 *
 * Takes the extent rather than reading SURROUND_PARAMS so this module has no
 * import edge back into the surround — the recipe owns WHEN there is a sea,
 * this owns what one is.
 */
export function buildSeaside(halfWidth: number, zFar: number): Seaside {
  const group = new THREE.Group();
  group.name = "seaside";
  const seaMat = createBeachSeaMaterial();
  const shoreMat = createBeachShoreMaterial();

  // The sea's far rows are spaced on a SQUARE so they bunch near the coast,
  // where the gradient changes fastest — eleven rows is plenty for a curve
  // that is linear by the time it reaches the fog.
  const rows = 12;
  const sea = coastStrip(
    halfWidth,
    96,
    (x, j) => Math.pow(j / (rows - 1), 2) * Math.max(1, shoreZ(x) - zFar),
    rows,
    // Between the surround ground (-0.02) and the board floor (-0.01): the
    // sea never meets the board, and above the ground is all it needs.
    -0.012,
  );
  const seaMesh = new THREE.Mesh(sea, seaMat);
  seaMesh.name = "sea";
  group.add(seaMesh);

  const [inner, outer] = ribbonExtent();
  const shore = coastStrip(halfWidth, 160, (_x, j) => (j === 0 ? inner : outer), 2, -0.004);
  const shoreMesh = new THREE.Mesh(shore, shoreMat);
  shoreMesh.name = "shore";
  // Transparent, so it sorts after the opaque sea and sand regardless.
  shoreMesh.renderOrder = 1;
  group.add(shoreMesh);

  // The clock (see the header). Milliseconds, as journeyWater.ts's shaders
  // expect — the one unit mistake that renders as perfectly still water.
  const tick = (): void => {
    const t = performance.now();
    seaMat.uniforms.uTime.value = t;
    shoreMat.uniforms.uTime.value = t;
  };
  seaMesh.onBeforeRender = tick;
  shoreMesh.onBeforeRender = tick;

  for (const m of [seaMesh, shoreMesh]) {
    m.castShadow = false;
    m.receiveShadow = false;
    // It is generated in WORLD space, so its bounds are the coast itself; the
    // default sphere test is correct and keeps it out of frames that cannot
    // see it.
  }
  return { group, materials: [seaMat, shoreMat] };
}

export function disposeSeaside(s: Seaside): void {
  s.group.removeFromParent();
  s.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  for (const m of s.materials) m.dispose();
}
