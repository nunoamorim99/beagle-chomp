// OWNER: render-artist
// IDEA-083: THE TUNNEL IS A PORTAL.
//
// Nuno: "on the side where we have the arch we can add on the area on the
// middle some visual effect that makes that look like a portal and then this
// will make sense because the beagle teletransport himself from one side of
// the maze to another... in all the mazes, the color of the visual effect can
// change considering the theme." Then, on v1's ground disc: "instead of being
// just a circle can it be on the space of the arch? Like fill that area we
// have empty below the arch?"
//
// The tunnel is the one crossing in the game (IDEA-067: row 9, west and east,
// on all 36 mazes) and the beagle does not walk through it, it JUMPS: it
// interpolates one tile past the west edge and then reappears on the east edge
// tile. Nothing on screen said why. A portal says why, and the pulse below
// covers the jump itself.
//
// Five rules.
//
//  1. **THE PORTAL IS THE ARCH'S OWN OPENING** (v2). A vertical membrane cut to
//     `archAperture()` — the same dials every arch kind is built from — so it
//     fills exactly the space under each theme's arch and reshapes with it if
//     the arch is retuned. v1 was a vortex on the GROUND because the play
//     camera looks down 59 degrees and a plane spanning the mouth is seen at
//     about 0.3 of its area. That is still true, which is why the membrane's
//     RIM is its brightest part (an outline survives foreshortening where a
//     fill does not) and why a faint light spill stays on the floor under it.
//
//  2. **IT IS A SHADERMATERIAL, AND THAT IS WHAT KEEPS IT OUT OF THE STYLE.**
//     `applyMadboxStyle` swaps any material carrying a `.color`; a
//     ShaderMaterial has none, so it is skipped by construction and its colour
//     is exactly the one authored here. It includes `colorspace_fragment` —
//     the backdrop dome's hand-written shader does not, and renders ~40%
//     darker than its hex because of it (IDEA-072 rule 5).
//
//  3. **IT IS GRID-DERIVED, LIKE THE ARCHES, AND IT IS NOT GATED ON ONE.** It
//     stands at `tunnelMouths(grid)` for IDEA-060 rule 9's reason. A theme
//     with no `tunnelArch` (Arcade Night) still teleports, so it gets a
//     free-standing portal of the default arch's shape, smaller.
//
//  4. **THE COLOUR IS THE THEME'S, AND IT IS CHOSEN TO CONTRAST THE BOARD.**
//     A green portal in a green garden is one more bush. See PORTAL_COLORS.
//     The white core stays SMALL: under additive blending a wide near-white
//     area clips to white, and v1's first build rendered every theme as the
//     same pale smudge.
//
//  5. **ADDITIVE, DEPTH-TESTED, NO DEPTH WRITE, NO SHADOW, NO FOG.** It is
//     light, not a surface: the beagle stays visible walking into it, and it
//     never hides the corridor. Depth TEST stays on, which is what lets the
//     nominal outline be slightly generous — wherever it runs into the arch's
//     own foliage, posts or rock, that mass hides it.
//
// It animates from `update(dt)`, called from `spinDecor`, so it pauses when the
// game does, like every other moving thing on the board.

import * as THREE from "three";
import type { Grid } from "../game/grid";
import type { MazeTheme } from "../game/themes";
import { getPropDef, type PropParams } from "../game/props";
import { ARCH_PARAMS, archAperture, archTransformFor, tunnelMouths } from "./archway";

/** One theme's portal: a bright CORE (the swirl's eye) and a saturated RIM
 *  (the outline and the arms). */
export interface PortalColors {
  core: number;
  rim: number;
}

/**
 * Per-theme portal colours, keyed by theme id.
 *
 * A table here rather than a `ThemePalette` slot, deliberately for now: a
 * palette field means a hand-written line in `boardCodegen.ts`'s writer and a
 * `test-board-surfaces` entry, and `themes.ts` is authored live in the editor.
 * If the portal colour should become an editor dial, that is the move — this
 * table is then its seed.
 *
 * Each rim is picked against the theme's own board, never by family:
 *  - garden: VIOLET — the one hue nowhere on a green hedge and green lawn.
 *  - forest: FIREFLY CYAN-MINT — a deep forest's own light, and it clears the
 *    dark green walls by value as well as by hue.
 *  - beach: SEA TURQUOISE — the water the board sits beside, against sand.
 *  - park: SUNBEAM GOLD — the park's lawn is a lighter green than the garden's,
 *    and a warm glow separates from it where violet would read muddy.
 *  - city: NEON MAGENTA — the neon gateway's own vocabulary.
 *  - classic (Arcade Night): ARCADE CYAN — the tribute board's neon blue walls
 *    want the brighter, colder sibling, not a second blue.
 */
export const PORTAL_COLORS: Record<string, PortalColors> = {
  garden: { core: 0xf6e8ff, rim: 0xa45cff },
  forest: { core: 0xeafff4, rim: 0x3fe0b0 },
  beach: { core: 0xeafcff, rim: 0x22c4e8 },
  park: { core: 0xfff6d8, rim: 0xffb21f },
  city: { core: 0xffe8fa, rim: 0xff3fc8 },
  classic: { core: 0xe8fbff, rim: 0x34d4ff },
};

/** A theme with no entry (a new one, before anyone has picked) falls back to
 *  its own second bloom colour — a hue the theme already uses as an ACCENT —
 *  over a near-white core. Never undefined: an unknown theme gets a portal. */
export function portalColorsFor(theme: MazeTheme): PortalColors {
  const known = PORTAL_COLORS[theme.id];
  if (known) return known;
  const blooms = theme.palette.bloomColors;
  const rim = blooms[1] ?? blooms[0] ?? theme.palette.biscuit;
  return { core: 0xffffff, rim };
}

/** Exported for the test. */
export const PORTAL_PARAMS = {
  /** How far the membrane is pulled IN from the arch's nominal outline, in
   *  world units — enough that it never pokes out past a thin neon post. */
  inset: 0.03,
  /** A theme with no arch gets the default arch's opening at this scale: a
   *  full-size 2-unit membrane with nothing framing it reads as a wall of
   *  light rather than as a doorway. */
  framelessScale: 0.72,
  /** Half-extent of the light spill on the floor along the direction of
   *  travel (across, it follows the opening's width). */
  spillAlong: 0.85,
  /** Rising motes per portal. */
  motes: 22,
  /** How long a traverse pulse takes to decay, in seconds. */
  pulseLife: 0.55,
};

/** The opening one portal fills, in the portal's own frame (spanning local X,
 *  standing on y = 0). */
export interface PortalShape {
  hw: number;
  springY: number;
  rise: number;
  curve: number;
}

/** The opening for `theme`'s arch as it is PLACED — the def's params at the
 *  fixture's own scale — inset a touch, or the frameless default. Pure, so the
 *  test can check every shipped arch without a renderer. */
export function portalShapeFor(theme: MazeTheme): PortalShape {
  const params: PropParams | null = theme.tunnelArch
    ? ((getPropDef(theme.tunnelArch).params ?? {}) as PropParams)
    : null;
  const ap = archAperture(params ?? {});
  const k = params ? ARCH_PARAMS.scale : PORTAL_PARAMS.framelessScale;
  const inset = PORTAL_PARAMS.inset;
  return {
    hw: Math.max(0.1, ap.hw * k - inset),
    springY: ap.springY * k,
    rise: Math.max(0.05, ap.rise * k - inset),
    curve: ap.curve,
  };
}

/** The membrane's outline: straight sides up to the springing, then the
 *  superellipse head — `archCurvePoints`' own formula, so the two cannot
 *  disagree about what curve an `archCurve` value means. */
function membraneGeometry(sh: PortalShape): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-sh.hw, 0);
  shape.lineTo(sh.hw, 0);
  shape.lineTo(sh.hw, sh.springY);
  const n = sh.curve;
  const SEG = 40;
  for (let i = 1; i < SEG; i++) {
    const t = 1 - (i / SEG) * 2; // +1 -> -1
    const a = Math.abs(t);
    shape.lineTo(t * sh.hw, sh.springY + sh.rise * Math.pow(Math.max(0, 1 - Math.pow(a, n)), 1 / n));
  }
  shape.lineTo(-sh.hw, sh.springY);
  return new THREE.ShapeGeometry(shape, 1);
}

export interface TunnelPortals {
  group: THREE.Group;
  /** Advance the swirl and decay any pulse. Called from `spinDecor`. */
  update(dt: number): void;
  /** Flash every portal — something just went through the tunnel. Both ends
   *  light at once, because they are the two ends of ONE crossing. */
  pulse(strength?: number): void;
  /** Frees every geometry and material and removes the group. */
  dispose(): void;
}

const COMMON_UNIFORMS = `
  uniform float uTime;
  uniform float uPulse;
  uniform vec3 uCore;
  uniform vec3 uRim;
  uniform float uPx;
  uniform float uHw;
  uniform float uSpring;
  uniform float uRise;
  uniform float uCurve;
`;

const MEMBRANE_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// `inside` is 1 deep in the opening and 0 on its outline, measured the same way
// the outline was built (straight sides, superellipse head), so the rim glow
// follows the arch's own curve at any `archCurve`. The swirl winds round the
// middle of the opening — where the eye goes in a doorway.
const MEMBRANE_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS}
  varying vec2 vPos;
  float inside(vec2 p) {
    float ux = min(1.0, abs(p.x) / uHw);
    if (p.y < uSpring) return 1.0 - ux;
    float vy = (p.y - uSpring) / uRise;
    return 1.0 - pow(pow(ux, uCurve) + pow(max(vy, 0.0), uCurve), 1.0 / uCurve);
  }
  void main() {
    float d = inside(vPos);
    if (d <= 0.0) discard;
    float top = uSpring + uRise;
    vec2 q = (vPos - vec2(0.0, top * 0.5)) / vec2(uHw, top * 0.5);
    float r = length(q);
    float a = atan(q.y, q.x);
    float arms = 0.5 + 0.5 * sin(3.0 * a + 7.0 * r - uTime * 3.0);
    float arms2 = 0.5 + 0.5 * sin(-4.0 * a + 4.0 * r - uTime * 1.6);
    float swirl = mix(arms, arms2, 0.4);
    float ripple = 0.5 + 0.5 * sin(vPos.y * 18.0 - uTime * 4.0);
    float rim = smoothstep(0.2, 0.0, d);
    float eye = smoothstep(0.32, 0.0, r);
    // Fades into the ground rather than stopping at a hard line on it.
    float foot = smoothstep(0.0, 0.18, vPos.y);
    float body = (0.16 + 0.34 * swirl + 0.06 * ripple) * smoothstep(1.25, 0.15, r);
    float glow = (body + rim * 0.95 + eye * 0.4) * mix(0.35, 1.0, foot);
    vec3 col = mix(uRim, uCore, eye * 0.6 + rim * 0.2);
    gl_FragColor = vec4(col * glow * 0.9 * (1.0 + 1.4 * uPulse), 1.0);
    #include <colorspace_fragment>
  }
`;

const SPILL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The light the doorway throws on the floor: no pattern, just a soft pool, so
// it grounds the membrane without competing with it.
const SPILL_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS}
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float glow = pow(1.0 - r, 1.5) * (0.7 + 0.1 * sin(uTime * 2.0)) * (1.0 + 1.6 * uPulse);
    gl_FragColor = vec4(uRim * glow, 1.0);
    #include <colorspace_fragment>
  }
`;

// Motes: each carries a phase in aSeed; position is derived from time so no
// attribute is rewritten on the CPU. They rise through the opening, drifting a
// little either side of the membrane so the doorway has some depth.
const MOTE_VERT = /* glsl */ `
  ${COMMON_UNIFORMS}
  attribute vec3 aSeed;
  varying float vLife;
  void main() {
    float life = fract(aSeed.z + uTime * 0.3);
    vLife = life;
    float top = uSpring + uRise;
    float x = (aSeed.x * 2.0 - 1.0) * uHw * 0.8 + 0.06 * sin(uTime * 1.7 + aSeed.y * 9.0);
    float z = (aSeed.y * 2.0 - 1.0) * 0.18;
    vec3 pos = vec3(x * (1.0 - 0.45 * life), life * top * 0.95, z);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // World-sized, so a mote is a few pixels on a phone at the play camera
    // and grows with the view rather than staying a speck.
    float worldSize = (0.08 + 0.05 * uPulse) * (1.0 - 0.5 * life);
    gl_PointSize = worldSize * projectionMatrix[1][1] * uPx / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAG = /* glsl */ `
  ${COMMON_UNIFORMS}
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 2.0);
    float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - vLife);
    vec3 col = mix(uCore, uRim, smoothstep(0.0, 0.35, vLife));
    gl_FragColor = vec4(col * soft * fade * (1.2 + 1.5 * uPulse), 1.0);
    #include <colorspace_fragment>
  }
`;

function glowMaterial(
  uniforms: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
  side: THREE.Side = THREE.FrontSide,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    fog: false,
  });
}

/** Deterministic per-mote seeds. Fixed rather than Math.random so a level
 *  rebuild draws the same portal and a screenshot diff means something. */
function moteSeeds(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  let s = 0x2f6b1d;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    out[i * 3] = rnd();
    out[i * 3 + 1] = rnd();
    out[i * 3 + 2] = i / n + rnd() * (0.5 / n);
  }
  return out;
}

/**
 * Builds one portal at every tunnel mouth in `grid`, shaped to `theme`'s arch
 * and coloured for it, and adds them to `scene`. `null` when the maze has no
 * tunnel.
 *
 * Every portal shares ONE uniform block, so the pair swirls in step and a
 * pulse lights both ends at once — and so `update` is a couple of float
 * writes, never a traversal.
 */
export function buildTunnelPortals(
  scene: THREE.Object3D,
  grid: Grid,
  theme: MazeTheme,
): TunnelPortals | null {
  const mouths = tunnelMouths(grid);
  if (mouths.length === 0) return null;
  return buildPortalsAt(
    scene,
    theme,
    mouths.map((m) => ({ ...archTransformFor(m), name: `tunnelPortal-${m.tx}-${m.ty}` })),
  );
}

/** Where one portal stands: the arch's own frame, local X spanning the
 *  opening. */
export interface PortalPlacement {
  x: number;
  z: number;
  rotationY: number;
  name?: string;
}

/**
 * The same portals at caller-chosen spots — for the menu vignette and the shop
 * diorama, which stand a tunnel mouth that is not on any grid. Shape, colour,
 * lift and animation are exactly the board's, so a showcase cannot advertise a
 * different doorway from the one a run walks through.
 */
export function buildPortalsAt(
  scene: THREE.Object3D,
  theme: MazeTheme,
  placements: readonly PortalPlacement[],
): TunnelPortals {
  const colors = portalColorsFor(theme);
  const sh = portalShapeFor(theme);
  const lift = theme.tunnelArch ? ARCH_PARAMS.lift : 0;
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uPulse: { value: 0 },
    uCore: { value: new THREE.Color(colors.core) },
    uRim: { value: new THREE.Color(colors.rim) },
    // Half the drawing-buffer height in pixels, for the motes' point size.
    // Written per draw from onBeforeRender, so a resize needs no wiring.
    uPx: { value: 400 },
    uHw: { value: sh.hw },
    uSpring: { value: sh.springY },
    uRise: { value: sh.rise },
    uCurve: { value: sh.curve },
  };
  const bufferSize = new THREE.Vector2();

  const membraneGeo = membraneGeometry(sh);
  const spillGeo = new THREE.CircleGeometry(1, 40);
  spillGeo.rotateX(-Math.PI / 2);
  const moteGeo = new THREE.BufferGeometry();
  // `position` is required for the draw count and is otherwise unused: the
  // vertex shader derives every position from aSeed and the clock.
  moteGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PORTAL_PARAMS.motes * 3), 3));
  moteGeo.setAttribute("aSeed", new THREE.BufferAttribute(moteSeeds(PORTAL_PARAMS.motes), 3));

  // Double-sided: the camera sees one face at the west mouth and the other at
  // the east.
  const membraneMat = glowMaterial(uniforms, MEMBRANE_VERT, MEMBRANE_FRAG, THREE.DoubleSide);
  const spillMat = glowMaterial(uniforms, SPILL_VERT, SPILL_FRAG);
  const moteMat = glowMaterial(uniforms, MOTE_VERT, MOTE_FRAG);

  const group = new THREE.Group();
  group.name = "tunnelPortals";

  for (const at of placements) {
    const portal = new THREE.Group();
    portal.name = at.name ?? "tunnelPortal";
    // The arch's own frame: local X spans the corridor and the opening stands
    // in local XY. Lifted with the arch, so a sunk or raised arch keeps its
    // doorway.
    portal.position.set(at.x, lift, at.z);
    portal.rotation.y = at.rotationY;

    const membrane = new THREE.Mesh(membraneGeo, membraneMat);
    membrane.name = "portalMembrane";
    membrane.renderOrder = 3;

    const spill = new THREE.Mesh(spillGeo, spillMat);
    spill.name = "portalSpill";
    spill.scale.set(sh.hw * 1.25, 1, PORTAL_PARAMS.spillAlong);
    // Above the floor plane (y = -0.01) and the surround ground, so it never
    // z-fights either, whatever the arch's lift.
    spill.position.y = 0.012 - lift;
    spill.renderOrder = 2;

    const motes = new THREE.Points(moteGeo, moteMat);
    motes.name = "portalMotes";
    // The motes' positions live in the shader, so their bounding sphere is
    // meaningless to the CPU; never cull them against it.
    motes.frustumCulled = false;
    motes.renderOrder = 4;
    motes.onBeforeRender = (renderer) => {
      uniforms.uPx.value = renderer.getDrawingBufferSize(bufferSize).y / 2;
    };

    portal.add(spill, membrane, motes);
    group.add(portal);
  }

  scene.add(group);

  let pulse = 0;
  return {
    group,
    update(dt: number): void {
      uniforms.uTime.value += dt;
      if (pulse > 0) {
        pulse = Math.max(0, pulse - dt / PORTAL_PARAMS.pulseLife);
        // Ease out: most of the flash is in the first third, which is what
        // covers the frame where the beagle actually vanishes.
        uniforms.uPulse.value = pulse * pulse;
      }
    },
    pulse(strength = 1): void {
      pulse = Math.max(pulse, Math.min(1, strength));
      uniforms.uPulse.value = pulse * pulse;
    },
    dispose(): void {
      scene.remove(group);
      membraneGeo.dispose();
      spillGeo.dispose();
      moteGeo.dispose();
      membraneMat.dispose();
      spillMat.dispose();
      moteMat.dispose();
    },
  };
}
