// OWNER: render-artist (IDEA-066 — the world around the maze)
//
// THE GROUND USED TO STOP ONE TILE PAST THE MAZE. board.ts's floor is a single
// PlaneGeometry(COLS + 2, ROWS + 2) — 21 x 23 units — and past its edge there
// was no geometry at all, only scene.ts's backdrop dome. So the "empty sky"
// around the board in every screenshot was never sky: it was the ground
// RUNNING OUT. The camera pitches 59.3 degrees down with a 23 degree half-FOV,
// which means the TOP edge of the frame points 36.3 degrees DOWNWARD and meets
// y = 0 at z = -21.2 on a desktop and z = -38.7 on a phone. THE HORIZON IS
// NEVER IN SHOT. That is the whole reason this is a bigger floor rather than a
// skybox, and it is measured, not assumed — `scripts/_scratch-surround-
// coverage.ts` unprojects a 9x9 NDC grid through the REAL camera at eight
// aspects and reports zero rays that escape above the horizon.
//
// THE EXTENT IS MEASURED, AND IT IS DELIBERATELY GENEROUS. That same sweep
// says the frame needs |x| >= 42.70 and z from -42.09 to +24.37 — against a
// floor that reaches 10.5 and 11.5. 68% of sampled frame points land off
// today's floor; that number IS the void. The shipped numbers below carry a
// 15% margin on top, because the failure mode (a visible world edge at an
// aspect nobody tested) is catastrophic and the cost of margin is one quad.
// Do NOT trim these to the measured minimum.
//
// IT SITS UNDER THE BOARD FLOOR, NOT BESIDE IT. board.ts's floor is at
// y = -0.01; this is at -0.02 and simply runs beneath it, so there is no butt
// joint to align, no crack and no z-fight. (At 30-58 units from the camera
// with near 0.1 / far 420, a 0.01 separation is roughly 40x the depth quantum.)
// The only visible boundary is the board floor's own edge.
//
// WHY NOT JUST GROW THE BOARD'S FLOOR: floorTexture.ts maps its canvas 1:1
// onto that exact plane — tile (tx,ty) lands at ((tx+1.5)*S, (ty+1.5)*S) — so
// the park's gravel walk and the road's lane markings FOLLOW THE CORRIDORS.
// Growing the plane stretches that painting off the grid. Separate geometry,
// separate material, separate texture family.
import * as THREE from "three";
import { toon } from "./toon";
import {
  SURROUND_TEXTURE_TILES,
  surroundTextureFor,
  type SurroundTextureKind,
} from "./surroundTexture";

/**
 * Which procedural neighbourhood a theme grows beyond its verge.
 *
 * Mirrors `WallTextureKind` / `FloorTextureKind` / `FenceKind` /
 * `GroundDetailKind` exactly: a KIND on the palette, so `test-board-surfaces`
 * guards it for free (every theme must name a real one, and every member must
 * be reachable from the board inspector's dropdown).
 *
 * The GROUND is not part of this — every theme gets ground, always, because a
 * theme that wants today's void back can simply set `surroundGround` to its own
 * `bg` and the plane becomes invisible. That is one fewer special case than a
 * "none" kind, and it keeps the no-sky-gap guarantee unconditional.
 */
export type SurroundKind = "none" | "plots" | "woodland" | "dunes" | "parkland" | "cityblocks";

/**
 * The surround's tunables, as a NAMED MUTABLE TABLE.
 *
 * Same contract as fence.ts's FENCE_PARAMS and groundDetail.ts's
 * GROUND_DETAIL_PARAMS, for the same reason: production NEVER writes this, the
 * dev-only editor's World tab does, and then writes the values back to THIS
 * literal so the file stays the source of truth. The alternative — threading a
 * `params` argument through every builder — changes several signatures so one
 * dev-only pane can pass an override every shipped call site would leave empty.
 */
export interface SurroundParams {
  /** Half-width of the ground plane in world units (x from -this to +this). */
  halfWidth: number;
  /** Far (north) edge, world z. Negative. */
  zFar: number;
  /** Near (south) edge, world z. Positive. */
  zNear: number;

  /** Plot footprint, in TILES. The lattice is laid in tile space because
   *  everything else on this board is, and because a plot that is a whole
   *  number of tiles lines up with the maze's own grain when the two meet. */
  plotW: number;
  plotD: number;
  /** Tiles of lane between neighbouring plots. This is what reads as a
   *  street, and at 0 the whole lattice closes into one field. */
  lane: number;
  /** Fraction of eligible plots that are actually built, 0..1. The density
   *  dial. Turn it to 0 and the surround is ground only. */
  density: number;
  /**
   * THE ARCHETYPE MIX — what the neighbourhood is MADE OF, and the dial Nuno
   * actually asked for ("a balance between the houses and greenhouses and the
   * gardens").
   *
   * Every plot used to run one recipe: house + trees + shrubs + beds, every
   * time. That reads as a housing estate built in one afternoon. A real
   * neighbourhood is a MIX — some plots are a house and its garden, some are
   * an allotment with a greenhouse and no house at all, some are an orchard,
   * and some are just lawn, which is what gives the eye somewhere to rest.
   *
   * These are cumulative bands over a single hash roll, so they are three
   * independent numbers rather than a distribution that has to sum to one:
   * house, then allotment, then orchard, and whatever is left over is lawn.
   * Turn `houseChance` to 0 and the neighbourhood becomes allotments.
   *
   * Ignored on the SOUTH band, which is portrait-only, unfogged and right
   * under the HUD — that band takes low archetypes whatever the mix says.
   */
  houseChance: number;
  allotmentChance: number;
  orchardChance: number;
  /** The SOUTH band's own share of allotments — see the shipped value's
   *  note for why that band is a special case and why an allotment is the
   *  one building it can take. */
  southAllotmentChance: number;
  /** The share of SOUTH FRINGE cells carrying a small building. See the
   *  shipped value's note — this is the dial that actually fills that band. */
  southFringeBuildings: number;
  /** The share of SOUTH FRINGE cells carrying a short tree. */
  southFringeTrees: number;
  /** Tiles of clearance kept around the board, measured out from the floor
   *  plane's own edge. Must cover the apron AND the verge rings, or a
   *  procedural plot lands on top of something hand-placed. */
  keepClear: number;
  /** The size ramp: plots scale from `nearScale` at the keep-clear boundary
   *  to `farScale` this many tiles further out. Nuno's "small props near the
   *  maze, bigger ones further out" — and it pays for itself, because
   *  scaling WITH distance holds the on-screen silhouette roughly constant,
   *  so the far band stays readable on fewer, larger objects. */
  nearScale: number;
  farScale: number;
  rampDistance: number;

  /** Width, in tiles, of the FRINGE — the loose scatter filling the gap
   *  between the keep-clear boundary and wherever the plot lattice actually
   *  starts.
   *
   *  It exists because rule 2 (drop a plot, never clip it) leaves a real
   *  hole: a plot row straddling the boundary is dropped whole, so on the
   *  SOUTH side — which has room for exactly one visible row — the nearest
   *  five units came back bare in portrait. Pushing the plot outward instead
   *  would overlap its neighbour; shrinking keepClear would let plots crowd
   *  the verge. A different, lower KIND of content in that annulus is the
   *  honest answer, and it reads as the maze's own verge rather than as a
   *  neighbour's garden. */
  fringeWidth: number;
  /** Fraction of fringe cells carrying something, 0..1. */
  fringeDensity: number;
}

/**
 * IDEA-069: WHAT THE CAMERA CAN ACTUALLY SEE OF THE GROUND, in world units.
 *
 * Nuno, looking at a phone: *"much of that doesn't show, so we can optimize the
 * render of the maps for mobile to only render the necessary to cover the
 * view."* He is right, and the numbers are lopsided in a way that makes it
 * worth doing: measured by `_scratch-surround-coverage.ts`, a PORTRAIT frame
 * needs |x| >= 15.3 and z from -38.7 to +22.4, while a 16:9 DESKTOP needs
 * |x| >= 31.6 but only z from -21.2 to +11.9. `SURROUND_PARAMS` ships the
 * UNION of all eight sampled aspects — 50 / -50 / +30 — because one baked
 * recipe had to satisfy every one of them. So a phone is building and drawing
 * a band more than twice as wide as it can see, and a desktop is building one
 * far deeper than it can see.
 *
 * THE GROUND PLANE IS NOT CULLED AND MUST NOT BE. It is two triangles; the
 * no-sky-gap guarantee is unconditional and IDEA-066 rule 1 is explicit that a
 * visible world edge at an untested aspect is catastrophic while the margin
 * costs nothing. This culls only the PROPS, which are the entire cost.
 *
 * Set by `scene.ts`'s `resize()` — the one place that knows the camera — and
 * read by `surroundRecipe.ts`, which folds it into the content key so a real
 * change rebuilds and a pixel of resize does not. A module-level channel
 * rather than an argument threaded through `buildBoard`/`applyBoardTheme` and
 * every call site that would have to pass a camera it does not have: the same
 * trade `FENCE_PARAMS` makes, and for the same reason.
 */
export interface SurroundView {
  /** Half-width of the visible ground footprint, world units. */
  halfX: number;
  /** Nearest (largest z) the frame reaches on the ground. */
  zNear: number;
  /** Furthest (most negative z) the frame reaches. */
  zFar: number;
}

/**
 * The margin added to the measured footprint before anything is culled.
 *
 * A plot is dropped on its CENTRE, and the things standing in it are up to a
 * house tall and half a plot from that centre — so the box has to be generous
 * enough that nothing pops at the frame edge when the window changes. Six
 * units is a plot and a half; the visible saving is in the twenty-plus units
 * beyond it, not here.
 */
const VIEW_MARGIN = 6;

/** Starts at SURROUND_PARAMS' own extent, so a page that never calls
 *  `setSurroundView` (a test, a harness, the editor's board stage) gets
 *  exactly the shipped behaviour rather than an empty band. */
export const SURROUND_VIEW: SurroundView = { halfX: 50, zNear: 30, zFar: -50 };

/**
 * Quantised to 4 units on purpose. A resize fires on every pixel of a window
 * drag, and the surround is several hundred props; keying the rebuild on a
 * continuous value would rebuild it on every frame of a drag. Four units is
 * far below the margin above, so the quantisation can never expose an edge.
 */
function quantise(v: number): number {
  return Math.round(v / 4) * 4;
}

/** Called by scene.ts on every resize. Returns true when the value actually
 *  MOVED — the caller uses it to decide whether a rebuild is worth asking for. */
export function setSurroundView(halfX: number, zNear: number, zFar: number): boolean {
  const P = SURROUND_PARAMS;
  // Clamped to the shipped extent in both directions: never larger (there is
  // no ground out there) and never smaller than the keep-clear box plus a
  // margin (a frame that somehow measured tiny must not delete the whole
  // neighbourhood).
  const next: SurroundView = {
    halfX: Math.min(P.halfWidth, Math.max(20, quantise(halfX + VIEW_MARGIN))),
    zNear: Math.min(P.zNear, Math.max(16, quantise(zNear + VIEW_MARGIN))),
    zFar: Math.max(P.zFar, Math.min(-16, quantise(zFar - VIEW_MARGIN))),
  };
  if (
    next.halfX === SURROUND_VIEW.halfX &&
    next.zNear === SURROUND_VIEW.zNear &&
    next.zFar === SURROUND_VIEW.zFar
  ) {
    return false;
  }
  SURROUND_VIEW.halfX = next.halfX;
  SURROUND_VIEW.zNear = next.zNear;
  SURROUND_VIEW.zFar = next.zFar;
  return true;
}

export const SURROUND_PARAMS: SurroundParams = {
  halfWidth: 50,
  zFar: -50,
  zNear: 30,
  plotW: 7,
  plotD: 6,
  lane: 1,
  density: 0.85,
  houseChance: 0.42,
  allotmentChance: 0.2,
  orchardChance: 0.2,
  /**
   * IDEA-070: the SOUTH band's own share of ALLOTMENTS — a greenhouse, a
   * shed and beds, never a house.
   *
   * The south band took orchards and lawns and nothing else, on the reasoning
   * IDEA-066 rule 6 records: it is portrait-only, at ZERO fog, at the largest
   * on-screen size anything in the surround ever has, and directly under the
   * HUD and the D-pad. Only ONE plot row is ever visible there, so whatever
   * stands in it is the biggest thing in the picture.
   *
   * Nuno, looking at it: *"on the bottom of the maze, on the zone we have the
   * buttons and the joystick, we should balance the world — there are no
   * houses or greenhouses there, we should have something there."* He is
   * right that a fifth of a portrait frame reading as lawn and trees while
   * the other three sides are a neighbourhood is not a balance, it is a gap.
   *
   * The ALLOTMENT is the archetype that answers it without giving the rule
   * away: a greenhouse measures 2.08 wide-over-tall against a house's 1.40
   * (`.img2threejs/garden-greenhouse/measurements.json`), so it is the one
   * building in the set that is LOW AND LONG — it fills ground without
   * standing up into the frame. A full house stays out; that is still the
   * nearest, largest, least-forgiving band on the board.
   */
  southAllotmentChance: 0.45,
  /**
   * The share of SOUTH FRINGE cells that carry a small building rather than
   * planting — and this, not the archetype mix, is what actually fills that
   * band.
   *
   * Measured on a phone: the visible south window is z 14.5..22.4 and the
   * plot lattice lands at 22.5..24.1, so exactly ONE plot falls inside it.
   * The south looked empty because almost nothing was ever BUILT there, not
   * because of what the plots rolled. The fringe is the layer that owns
   * that annulus (IDEA-066 rule 7 added it for exactly this gap), so it is
   * where a south building has to come from.
   *
   * Greenhouses and sheds only — the two buildings low enough for the
   * nearest, unfogged, largest-on-screen band. Turn it to 0 and the south
   * goes back to the planting it had.
   */
  southFringeBuildings: 0.34,
  /**
   * The share of SOUTH FRINGE cells carrying a TREE rather than low
   * planting — Nuno: *"to fill that gap add some trees on that part of the
   * world."*
   *
   * Kept SHORT (a wall's height and a bit) for the reason everything in
   * this band is: it is unfogged, nearest the camera and the largest
   * anything in the surround ever draws. A tree at the size the north band
   * uses does not read as a distant tree down here, it reads as a tree
   * standing on the maze.
   */
  southFringeTrees: 0.32,
  keepClear: 3,
  nearScale: 0.9,
  farScale: 1.5,
  rampDistance: 24,
  fringeWidth: 8,
  // RAISED from 0.55 when IDEA-070 stopped the fringe building inside plots:
  // that correctly dropped 74 of 179 cells, and the band visibly thinned. The
  // density is a share of ELIGIBLE cells, so the eligible set shrinking means
  // this number has to rise to keep the same amount of stuff on the ground.
  fringeDensity: 0.72,
};

/** board.ts's floor sits at -0.01; this runs beneath it. */
const SURROUND_Y = -0.02;

/**
 * Which tiling ground a theme's surround wears, DERIVED from the board's own
 * `floorTexture` rather than carried as a second palette field.
 *
 * The two have to relate — the surround is the same ground continuing past the
 * board's edge — so a separate slot would only ever be a chance for them to
 * disagree, and the seam is the one place a disagreement shows. Deriving also
 * means a new floor kind cannot silently ship with no surround treatment.
 *
 * `road` maps to flat on purpose: Night City's floor is painted FROM THE GRID
 * (lane markings follow the corridors), and there is no grid out here for road
 * markings to follow. A tiled road surround would be markings that lead
 * nowhere.
 */
// EXPORTED because IDEA-072's showcase ground needs the SAME mapping, and a
// second copy of it is a second chance for the menu's ground and the board's
// to disagree about what a theme's floor is made of -- which would show as a
// different surface on the screen advertising the board.
export function surroundTextureKindFor(floorTexture: string): SurroundTextureKind {
  if (floorTexture === "lawn" || floorTexture === "parkGrass") return "lawn";
  if (floorTexture === "earth") return "earth";
  if (floorTexture === "sand") return "sand";
  return "flat";
}

/**
 * Relative luminance, Rec. 709, from a packed 0xRRGGBB.
 *
 * Used for ONE job — see buildSurroundGround's emissive note — and computed on
 * `surroundGround` rather than by reading the floor canvas back, because the
 * floor texture is GRID-DERIVED and rebuilt per level: sampling it would make
 * the surround a level asset for no benefit.
 *
 * `surroundGround` can stand in for it because that value IS the floor
 * texture's measured mean — `scripts/_scratch-surround-seam.ts` reads it off
 * the real canvas and prints the number to paste here. An earlier version of
 * this note claimed `palette.floor` was close enough "by construction", on the
 * grounds that the texture bakes it in as its ground. It does, and then the
 * lawn painter covers it: the garden's floor is SOIL and its texture is GRASS,
 * 48/255 apart. Reasoning about what a painter starts from says nothing about
 * what it ends at.
 */
// EXPORTED for IDEA-072's showcase ground, which has to reproduce this
// module's emissive rule exactly rather than approximate it.
export function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The ground beyond the board, as one two-triangle plane.
 *
 * THE EMISSIVE IS THE TRAP HERE, and it is the seam's whole story. board.ts
 * sets `matFloor.emissiveMap = <the floor texture>`, so the board's emissive
 * lift is MODULATED BY THAT TEXTURE — every texel scales it. A flat plane
 * carrying the same `emissiveIntensity` with no map gets the lift at FULL
 * strength everywhere, so it renders measurably brighter than the board and
 * draws a hard bright line right around the maze. Correctly built, correctly
 * coloured, and wrong: the same family as the buried nori belt and the
 * inverted band normal. Scaling by the floor colour's own luminance is the
 * approximation that makes the two match without making this a level asset.
 * `scripts/_scratch-surround-seam.ts` is what proves it.
 */
export function buildSurroundGround(
  scene: THREE.Object3D,
  palette: {
    surroundGround: number;
    floorTexture: string;
    floorEmissive: number;
    floorEmissiveIntensity: number;
  },
): THREE.Mesh {
  const w = SURROUND_PARAMS.halfWidth * 2;
  const d = SURROUND_PARAMS.zNear - SURROUND_PARAMS.zFar;
  const geo = new THREE.PlaneGeometry(w, d);
  // A theme whose floor is "flat" has NO emissiveMap on the board either, so
  // its lift is already at full strength there and scaling here would make the
  // surround darker than the board it joins. Every other kind drives the
  // emissive THROUGH the texture, so the surround has to stand in for that
  // texture's mean -- and `surroundGround` IS that mean: it is the value
  // _scratch-surround-seam.ts measures off the real floor canvas. That is what
  // makes its luminance the honest proxy, and palette.floor a wrong one. The
  // garden proves it: palette.floor is the SOIL at luminance 0.152, the lawn
  // painter covers it in grass at 0.424, and the first build was 2.8x too dark
  // -- and 48/255 too BROWN, which is the same mistake in the colour channel.
  const lift =
    palette.floorTexture === "flat" ? 1 : luminance(palette.surroundGround);
  // The map BAKES palette.surroundGround in, so when there is one the material
  // is held at white — a map multiplies, and tinting twice is the trap the
  // floor and wall painters both carry a note about.
  const map = surroundTextureFor(surroundTextureKindFor(palette.floorTexture), palette.surroundGround);
  if (map) {
    map.repeat.set(w / SURROUND_TEXTURE_TILES, d / SURROUND_TEXTURE_TILES);
  }
  const mat = toon({
    color: map ? 0xffffff : palette.surroundGround,
    map,
    // Driven by the same map, exactly as board.ts drives the floor's — which
    // is what the `lift` above exists to stand in for when there is NO map.
    // With one, the modulation is real and the approximation is not needed.
    emissiveMap: map,
    emissive: palette.floorEmissive,
    emissiveIntensity: palette.floorEmissiveIntensity * (map ? 1 : lift),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "surroundGround";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, SURROUND_Y, (SURROUND_PARAMS.zFar + SURROUND_PARAMS.zNear) / 2);
  // It is outside the key light's shadow camera (+-14 x, +-16 z) everywhere it
  // is visible, and under the board floor where it is not — so a shadow flag
  // here buys nothing and costs a shadow-map pass over a full-frame quad.
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  // Drawn before the board floor would be a full-frame overdraw; opaque
  // front-to-back sorting already puts the nearer board floor first and depth
  // -rejects the covered fragments, so leave renderOrder alone.
  scene.add(mesh);
  return mesh;
}

/** Frees a plane from `buildSurroundGround` — geometry AND material, since
 *  both are owned by it (the same ownership rule as buildFence). */
export function disposeSurroundGround(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}
