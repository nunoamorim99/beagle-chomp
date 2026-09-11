// OWNER: render-artist (IDEA-014 Challenge Level Map)
//
// A full-screen "garden path" LEVEL SELECT page, replacing the old
// #challengeBtn behavior of silently auto-continuing at getChallengeProgress()
// (src/game/game.ts previously called `this.startChallenge(getChallengeProgress())`
// directly from the button click — that call now opens THIS page instead, and
// the page's own Play button is what actually calls startChallenge(idx)).
//
// Three-free/pure-DOM, same split as src/ui/shop.ts (this module's structural
// twin): a dedicated full-screen PAGE (`#levelMap` in index.html, a sibling of
// `#mainMenu`/`#shop`), entirely (re)rendered here, reading challenge data/
// progress live from src/game/challenges.ts + src/game/profileStore.ts and
// leaving all mesh/scene work to the caller (there isn't any here — the page
// sits over the menu's existing 3D backdrop, same as #mainMenu itself does,
// just with a mostly-opaque sky-gradient panel of its own for readability —
// see the task brief: "the map opens from the menu, so a mostly-opaque
// backdrop on the page is fine").
//
// THE PATH: an inline SVG trail (soil-brown stroke, rounded caps/joins) running
// bottom (C1) to top (C8) through a centered scrollable column, with 8
// stepping-stone <g> nodes alternating left/right of center for an S-curve
// "garden path" feel. Node fill/decoration is driven entirely by CSS classes
// (see style.css's `.map-node-*` rules) keyed off each node's resolved state
// (cleared/current/locked), computed fresh every open() from
// getChallengeProgress() — this module holds no state of its own across opens
// besides which node is currently *selected* within one open session.
import {
  CHALLENGE_CHAPTERS,
  CHALLENGE_LEVELS,
  CHALLENGE_LEVEL_COUNT,
  CLASSIC_MODIFIERS,
  MAZE_NAMES,
  chapterForLevel,
  type ChallengeLevel,
} from "../game/challenges";
import { getChallengeProgress } from "../game/profileStore";
import { getMazeTheme } from "../game/themes";
import { ICON, iconHtml } from "./icons";

export type LevelNodeState = "cleared" | "current" | "locked";

export interface LevelMapCallbacks {
  /** Fired when the player taps "Play" for the currently-selected (non-locked)
   *  level. This module closes the page itself right before firing (see
   *  playSelected()) — the caller (game.ts) only needs to start the run, not
   *  also hide the map. */
  onPlayLevel?: (idx: number) => void;
  /** Fired right when the page opens (before the first render), so the caller
   *  can toggle chrome-hiding state (body.map-open) — mirrors shop.ts's
   *  onOpen exactly. */
  onOpen?: () => void;
  /** Fired when the page closes (back button), so the caller can restore
   *  chrome (body.map-open removed) — mirrors shop.ts's onClose exactly. Not
   *  fired on a successful Play (the page still closes, but the caller is
   *  about to leave the menu entirely for a running level anyway — see
   *  playSelected()'s own doc comment for why this distinction matters). */
  onClose?: () => void;
}

/** Return shape of {@link attachLevelMap} — mirrors ShopHandle exactly
 *  (`{ open, detach, isOpen }`), same rationale: `open()` lets any caller
 *  (the #challengeBtn click handler) open the page without synthesizing a
 *  click on some other internal button, `detach()` is the usual teardown,
 *  `isOpen()` lets a frame loop branch on map state if it ever needs to. */
export interface LevelMapHandle {
  /** Opens the page: re-reads progress + re-renders fresh (so a level just
   *  cleared, or replayed, always shows current state), selects the CURRENT
   *  level by default (or the last level when every level is cleared — see
   *  resolveDefaultSelection), and fires onOpen. */
  open: () => void;
  /** Unwires nothing external (the map has no HUD button of its own — it's
   *  only ever opened via game.ts calling open() directly from
   *  #challengeBtn's handler) and clears the page's contents. */
  detach: () => void;
  /** Whether the page is currently showing. */
  isOpen: () => boolean;
}

/** Resolves a level's selectable/visual state from the persisted progress
 *  (see profileStore.ts's StoredProfile doc comment for the exact
 *  `challengeProgress` convention this mirrors):
 *    - idx < progress          -> "cleared" (already beaten; replayable)
 *    - idx === progress        -> "current" (the next one to beat) — only
 *                                  reachable when progress < COUNT, since a
 *                                  progress of exactly COUNT means "every
 *                                  level cleared" and every idx is < COUNT
 *    - idx > progress          -> "locked"
 *  When progress === CHALLENGE_LEVEL_COUNT (all cleared), every valid idx
 *  (0..COUNT-1) is strictly less than progress, so this falls out of the
 *  same `idx < progress` branch automatically — no special-case needed for
 *  "every node cleared and replayable" (see the task brief). */
export function levelNodeState(idx: number, progress: number): LevelNodeState {
  if (idx < progress) return "cleared";
  if (idx === progress) return "current";
  return "locked";
}

/** IDEA-014 (desktop side panel): a short player-facing label for a node
 *  state — "Cleared" / "Up next" / "Locked" — shown on the panel above the
 *  Play button, alongside the richer name/blurb/twist-list/maze-name info.
 *  Deliberately its own small helper (not reused for the mobile footer, which
 *  has no room/need for this extra line) rather than baked into
 *  renderPanelInfo directly, so the three-state copy lives in one place.
 *
 *  The paw/padlock emoji that used to trail these two labels are gone: the
 *  same information is already carried by the stone's own glyph a few pixels
 *  away, and a second copy in a different icon vocabulary was the kind of
 *  thing the design system exists to stop. */
function stateLabel(state: LevelNodeState): string {
  if (state === "cleared") return "Cleared";
  if (state === "locked") return "Locked";
  return "Up next";
}

/** Builds the list of non-baseline modifier bullets for a level — e.g.
 *  `["×1.5 speed", "4 ghosts", "3s fright"]` — omitting any dial that's at
 *  its CLASSIC_MODIFIERS baseline value (a level that doesn't touch a given
 *  dial shouldn't clutter the list restating the default). Returns an empty
 *  array for a level that matches CLASSIC_MODIFIERS on every field (L1,
 *  "Warm-Up Walkies" — literally the classic baseline; see challenges.ts's
 *  own comment on it), so callers fall back to a plain "classic pace" label
 *  instead of an empty bullet list. `speedMult` and `ghostSpeedMult` are
 *  always equal in every CHALLENGE_LEVELS entry (see ChallengeModifiers' own
 *  doc comment on why), so this reports them as ONE "×N speed" bullet rather
 *  than two separate near-duplicate ones.
 *
 *  Shared by BOTH twistSummary() (mobile footer's compact "·"-joined line)
 *  and the IDEA-014 desktop side panel's own "one line per modifier" list —
 *  one source of truth for which dials count as "non-baseline", so the two
 *  presentations can never silently disagree about what counts as a twist. */
export function twistParts(level: ChallengeLevel): string[] {
  const { speedMult, ghostSpeedMult, ghostCount, frightSeconds } = level.modifiers;
  const parts: string[] = [];

  // speedMult/ghostSpeedMult: report once if either differs from baseline
  // (in practice they're always equal per-level, but guard both anyway so a
  // future level that diverges them still gets a sane, non-silent summary).
  if (speedMult !== CLASSIC_MODIFIERS.speedMult || ghostSpeedMult !== CLASSIC_MODIFIERS.ghostSpeedMult) {
    const mult = speedMult === ghostSpeedMult ? speedMult : Math.max(speedMult, ghostSpeedMult);
    parts.push(`×${trimTrailingZero(mult)} speed`);
  }
  if (ghostCount !== CLASSIC_MODIFIERS.ghostCount) {
    parts.push(`${ghostCount} ghosts`);
  }
  if (frightSeconds !== CLASSIC_MODIFIERS.frightSeconds) {
    parts.push(`${trimTrailingZero(frightSeconds)}s fright`);
  }
  return parts;
}

/** The compact "·"-joined twist summary used by the mobile footer — e.g.
 *  "×1.5 speed · 4 ghosts · 3s fright". Returns an empty string for a level
 *  with no non-baseline modifiers (see twistParts), so callers fall back to
 *  a plain "classic pace" label instead of an empty string. */
export function twistSummary(level: ChallengeLevel): string {
  return twistParts(level).join(" · ");
}

/** Formats a multiplier/duration without a pointless trailing ".0" (1.3 stays
 *  "1.3", but 2.0 renders as "2" not "2.0"). */
function trimTrailingZero(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

/** Picks which level is selected by default when the page opens: the CURRENT
 *  (next-to-beat) level, or — once every level is cleared
 *  (progress === CHALLENGE_LEVEL_COUNT, so levelNodeState never returns
 *  "current" for any idx) — the LAST level (index COUNT-1), matching the task
 *  brief's "selects the CURRENT level by default (or C8/last cleared when all
 *  clear)". */
function resolveDefaultSelection(progress: number): number {
  if (progress >= CHALLENGE_LEVEL_COUNT) return CHALLENGE_LEVEL_COUNT - 1;
  return progress;
}

/** Layout constants for the inline SVG trail — a tall, narrow viewBox (the
 *  page scrolls vertically, so the SVG's own height just needs to be tall
 *  enough to comfortably space every node, not fit a fixed viewport). Nodes
 *  alternate between LEFT_X and RIGHT_X for the S-curve feel; the path
 *  string is built by visiting each node's anchor in order (bottom to top,
 *  since level 1 is index 0 and belongs at the BOTTOM of the trail).
 *
 *  NODE_SPACING_Y (composition pass, coordinator review): was 148 — with a
 *  ~500-640px tall .map-body viewport (desktop 1100x750 / phone 390x844)
 *  that showed only ~3 (desktop) / ~5 (phone) stones at once, too sparse for
 *  a map whose whole charm is seeing the journey. Tightened ~38% to 92, which
 *  lands ~5-6 visible on desktop and ~6-7 on phone (the trail still scrolls
 *  for the rest) while keeping node circles themselves untouched (r=20, i.e.
 *  a 40px/CSS-px stone — the ~44px tap target comes from the stone plus its
 *  own hit area, unchanged by this pass).
 *
 *  IDEA-063 did NOT tighten it further for the jump from 8 stones to 40. It
 *  was tempting: at 92 the trail is roughly 4 000 SVG units tall. But the
 *  rhythm is what makes it read as a garden path rather than a list, and the
 *  navigation problem a long trail actually has is "I cannot get to stage 5",
 *  which compressing the spacing does not solve and the header's chapter jump
 *  rail does. See CHAPTER_GAP below.
 */
const SVG_WIDTH = 320;
const NODE_SPACING_Y = 92;
const SVG_TOP_MARGIN = 46;
const SVG_BOTTOM_MARGIN = 46;
const LEFT_X = 96;
const RIGHT_X = 224;
const CENTER_X = SVG_WIDTH / 2;

/** Extra vertical room inserted BEFORE each chapter's first stone (every
 *  chapter but the first), where its banner is drawn. Wide enough that the
 *  banner is clearly between two chapters rather than attached to either. */
const CHAPTER_GAP = 74;

/** Every node's y, resolved once at module load.
 *
 *  Computed as a TABLE rather than by the old `svgHeight() - idx * spacing`
 *  arithmetic because the chapter gaps make the spacing non-uniform, and a
 *  formula that has to ask "how many chapter boundaries are below me" at every
 *  call site is the kind of thing that ends up disagreeing with itself between
 *  the node, the trail path and the banner. One array, three readers.
 *
 *  Index 0 sits at the BOTTOM (largest y) and the last level at the TOP, so
 *  the trail reads bottom-to-top as the level number increases. */
const NODE_Y: readonly number[] = buildNodeYs();

/** The SVG's own logical height. NODE_Y[0] is the BOTTOM-most stone (level 1),
 *  so the box ends one bottom margin below it — and buildNodeYs starts the
 *  top-most stone exactly one top margin down, so both margins are honoured by
 *  construction rather than by a second piece of arithmetic that could drift
 *  from the table. */
const SVG_HEIGHT = NODE_Y[0] + SVG_BOTTOM_MARGIN;

function buildNodeYs(): number[] {
  // Build downward from the top of the box, then the array is reversed into
  // bottom-up order — going top-down is the only direction in which "add a
  // gap before this chapter" is a plain running sum.
  const chapterStarts = new Set(CHALLENGE_CHAPTERS.map((c) => c.from));
  const ys: number[] = [];
  let y = SVG_TOP_MARGIN;

  // Walk levels from the LAST (top of the trail) down to the first.
  for (let i = CHALLENGE_LEVEL_COUNT - 1; i >= 0; i--) {
    ys.push(y);
    // The gap belongs BELOW a chapter's first stone, i.e. between it and the
    // last stone of the chapter before it — so it is added after placing that
    // first stone, as we continue downward.
    y += NODE_SPACING_Y + (chapterStarts.has(i) && i > 0 ? CHAPTER_GAP : 0);
  }

  ys.reverse(); // now index 0 is the first level, at the largest y
  return ys;
}

function svgHeight(): number {
  return SVG_HEIGHT;
}

/** The (x,y) anchor for node `idx` (0-based). x alternates left/right,
 *  starting left for level 1. */
function nodeAnchor(idx: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(idx, CHALLENGE_LEVEL_COUNT - 1));
  return { x: clamped % 2 === 0 ? LEFT_X : RIGHT_X, y: NODE_Y[clamped] };
}

/** A smooth-ish winding path string through every node's anchor, using a
 *  cubic bezier per segment with both control points pulled to the shared
 *  center X so consecutive left/right anchors curve through the middle rather
 *  than zig-zagging with sharp corners. Across a chapter gap the same curve
 *  simply spans further, which is what makes the banner sit ON the path
 *  instead of interrupting it. */
function buildTrailPath(): string {
  const anchors = Array.from({ length: CHALLENGE_LEVEL_COUNT }, (_, i) => nodeAnchor(i));
  let d = `M ${anchors[0].x} ${anchors[0].y}`;
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    const midY = (prev.y + cur.y) / 2;
    d += ` C ${CENTER_X} ${midY}, ${CENTER_X} ${midY}, ${cur.x} ${cur.y}`;
  }
  return d;
}

/** Builds a rounded hill silhouette as an SVG path. The silhouette's actual
 *  undulating top edge is built ONLY from waypoints inside the visible
 *  viewBox span (0..SVG_WIDTH) — `WAYPOINT_FRACTIONS` below, each paired with
 *  a rise/dip so the crest reads as a real rolling hill rather than a flat
 *  line — and the bleed on either side (well past the viewBox, so the hill
 *  always fills the full card width even though .map-path-svg is itself
 *  narrower than .map-page on wide viewports) is added as a SEPARATE final
 *  straight segment out to a low shoulder point, entirely after the visible
 *  curvature is already established.
 *
 *  This replaces an earlier version whose curve endpoints reached all the
 *  way OUT to the bled edges (a span nearly 3x SVG_WIDTH) with only a shallow
 *  control-point offset — spreading what little curvature existed across
 *  such a wide invisible span made the VISIBLE portion (just the 320-unit
 *  viewBox) read as an almost perfectly flat, hard-edged line, exactly the
 *  "slab" look coordinator review flagged. Keeping every curve waypoint
 *  strictly within 0..SVG_WIDTH guarantees the rolling shape is actually
 *  visible regardless of how far the bleed extends.
 *
 *  `crestY` is the topmost point of the silhouette's central rise (where it
 *  very nearly touches its anchor node). `dipY` and `floorY` are the OTHER
 *  two y-levels the silhouette extends to (below the crest for the ground
 *  hill, above it for the summit hill — see buildGroundHill/buildSummitHill):
 *  `dipY` is the shoulder level flanking the crest (where the two `L`
 *  segments at the far left/right of the undulating top edge sit) and
 *  `floorY` is the final straight edge past that. BOTH are taken as EXPLICIT
 *  parameters (not derived internally from crestY+humpHeight the way an
 *  earlier version derived dipY) specifically so callers can clamp EVERY
 *  y-coordinate the shape visits to the SVG's own logical box
 *  (`0`..`svgHeight()`) — clamping only `floorY` while leaving `dipY`
 *  internally derived was a real bug this function itself introduced: the
 *  shape's actual bounding box is governed by whichever of dipY/floorY is
 *  more extreme, so a caller could believe it had fully clamped a hill by
 *  only capping floorY while dipY silently still poked past the boundary
 *  (this is exactly how the ground hill's bottom-bleed follow-up check
 *  caught a residual escape after the summit hill's floorY-only clamp had
 *  already fixed the originally-reported header bug). Both current callers
 *  clamp dipY and floorY to the SAME bound (svgHeight() for the ground hill,
 *  0 for the summit hill) via a shared clampDipAndFloor() helper, so the
 *  entire shape — not just one of its two extremes — is guaranteed to never
 *  cross the SVG's own box. This matters because `.map-path-svg` needs
 *  `overflow:visible` for the hill's horizontal bleed (see above) to fill
 *  the desktop trail column's full width, and on desktop nothing else clips
 *  the SVG's vertical overflow either (unlike mobile, where
 *  `.map-body{overflow-y:auto}` clips it) — any uncapped y-coordinate there
 *  paints hill pixels outside the SVG's own box and into whatever chrome
 *  happens to sit there (the actual reported bug: the summit hill's old
 *  unclamped extremes bled up behind the sticky header). */
function buildHillPath(crestY: number, dipY: number, floorY: number): string {
  const bleed = SVG_WIDTH * 0.6;
  const left = -bleed;
  const right = SVG_WIDTH + bleed;
  // Waypoints strictly within the visible viewBox (0..SVG_WIDTH), alternating
  // a shallow dip / the crest / a shallow dip so the line reads as one
  // gentle rolling rise rather than a flat shelf. Fractions chosen so the
  // crest sits dead-center and the two dips sit comfortably inboard of the
  // edges (not so close to 0/SVG_WIDTH that the bleed's straight drop-off
  // reads as an abrupt corner right next to a curve).
  const w1x = SVG_WIDTH * 0.16;
  const w2x = SVG_WIDTH * 0.5;
  const w3x = SVG_WIDTH * 0.84;
  const c1x = SVG_WIDTH * 0.33;
  const c2x = SVG_WIDTH * 0.67;
  return (
    `M ${left} ${floorY} ` +
    `L ${left} ${dipY} ` +
    `L ${w1x} ${dipY} ` +
    `Q ${c1x} ${crestY}, ${w2x} ${crestY} ` +
    `Q ${c2x} ${crestY}, ${w3x} ${dipY} ` +
    `L ${right} ${dipY} ` +
    `L ${right} ${floorY} Z`
  );
}

/** Clamps BOTH the shoulder level (`dipY = crestY + humpHeight`, signed by
 *  `direction`) and the final floor edge to the same SVG-box bound, so a
 *  hill's entire shape — not just its floorY endpoint — stays within
 *  `[0, svgHeight()]` (see buildHillPath's own doc comment for why clamping
 *  only floorY was an incomplete fix). `direction` is `1` for a
 *  downward-bleeding hill (the ground hill: dipY/floorY both clamp to an
 *  UPPER bound, i.e. Math.min against `bound`) or `-1` for an
 *  upward-bleeding hill (the summit hill: both clamp to a LOWER bound, i.e.
 *  Math.max against `bound`). */
function clampDipAndFloor(
  crestY: number,
  humpHeight: number,
  floorMargin: number,
  bound: number,
  direction: 1 | -1,
): { dipY: number; floorY: number } {
  const rawDipY = crestY + direction * humpHeight;
  const rawFloorY = rawDipY + direction * floorMargin;
  const clamp = direction === 1 ? Math.min : Math.max;
  return { dipY: clamp(rawDipY, bound), floorY: clamp(rawFloorY, bound) };
}

/** The ground hill: a soft rounded hedge-green silhouette hugging the very
 *  BOTTOM of the SVG's own coordinate space, directly behind C1 (idx 0 — the
 *  start of the journey, y === svgHeight() - SVG_BOTTOM_MARGIN). Drawn IN the
 *  SVG (not as a separately-positioned HTML element) specifically so it
 *  scrolls WITH the trail content and can never end up floating mid-air over
 *  some other node once the page is scrolled — coordinator review flagged
 *  exactly that bug in the previous absolutely-positioned-over-the-viewport
 *  version.
 *
 *  Both the shoulder level AND the floor edge are clamped to svgHeight()
 *  (the SVG's own logical bottom edge) via clampDipAndFloor — see that
 *  function's own doc comment for why BOTH y-levels need clamping, not just
 *  floorY (an earlier version clamped only floorY here, which left the
 *  shoulder waypoints — the shape's actual deepest points — still poking 26
 *  units past svgHeight(); caught by the coordinator's explicit follow-up
 *  ask to double-check this hill for the same class of bug the summit hill
 *  had). There's no sticky footer chrome at the page bottom on desktop
 *  today, so this couldn't visibly bleed into chrome the way the summit
 *  hill did, but it's fixed on the same "never cross the SVG's own logical
 *  box" principle regardless. */
function buildGroundHill(): string {
  const startAnchor = nodeAnchor(0); // C1
  const crestY = startAnchor.y + 32; // the hill's highest point, just below C1's stone
  const { dipY, floorY } = clampDipAndFloor(crestY, 40, 40, svgHeight(), 1);
  return (
    '<g class="map-ground-hill" aria-hidden="true">' +
    `<path d="${buildHillPath(crestY, dipY, floorY)}"></path>` +
    "</g>"
  );
}

/** The optional summit hill (task brief: "Optionally a smaller, lighter
 *  distant hill peeking at the very top behind C8 ... subtle"): a much
 *  smaller, lighter/paler silhouette peeking up from the very TOP edge of the
 *  SVG, directly behind C8 (idx COUNT-1, the smallest y) — reads as a distant
 *  peak rather than a second ground band, so it's deliberately low-contrast
 *  (a paler, more desaturated green than the ground hill — see style.css) and
 *  short (a shallower hump height than the ground hill, and floors out just
 *  above C8 rather than reaching all the way to the SVG's own top edge) so it
 *  never risks being mistaken for another full floating band.
 *
 *  Both the shoulder level AND the floor edge are clamped to 0 (the SVG's
 *  own logical top edge) via clampDipAndFloor — THIS is the fix for the
 *  reported "pale-green band bleeds up behind the sticky header" bug: an
 *  earlier version's floorY (`crestY-humpHeight-40`, well ABOVE y=0) sat ~38
 *  SVG units above the SVG's own box, and its INTERNALLY-derived dipY
 *  (`crestY-humpHeight`, before this fix moved dipY to an explicit clamped
 *  parameter) sat ~18 units above y=0 too. On mobile that was invisible
 *  (`.map-body{overflow-y:auto}` clipped anything above the SVG), but the
 *  desktop rework's page-level scroll requires `.map-body{overflow:visible}`
 *  (so it stops competing with #levelMap as a second scroll container — see
 *  style.css's own comment on that), which also means nothing clips the
 *  SVG's vertical overflow anymore on desktop — so that pale hill fill
 *  painted straight up into the sticky header's own screen region whenever
 *  the page was scrolled near the top. clampDipAndFloor's Math.max(...,0)
 *  guarantees BOTH the summit hill's shoulder AND floor never cross y=0
 *  regardless of crestY/humpHeight tuning, so it can never repeat this
 *  failure mode even if those numbers change later. Paired with a
 *  z-index/opaque-background belt on the header itself (see style.css's
 *  .map-header rules) as a second line of defence, per the coordinator's
 *  "prefer BOTH belts" guidance. */
function buildSummitHill(): string {
  const summitAnchor = nodeAnchor(CHALLENGE_LEVEL_COUNT - 1); // C8
  const crestY = summitAnchor.y - 24; // the hill's highest point, just above C8's stone
  const { dipY, floorY } = clampDipAndFloor(crestY, 20, 40, 0, -1);
  return (
    '<g class="map-summit-hill" aria-hidden="true">' +
    `<path d="${buildHillPath(crestY, dipY, floorY)}"></path>` +
    "</g>"
  );
}

/** The chapter banners drawn between chapters (IDEA-063).
 *
 *  A stroked plaque straddling the trail at the midpoint of the CHAPTER_GAP,
 *  so it reads as a signpost the path runs past rather than as a break in it.
 *  The first chapter gets none: the ground hill and level 1 already say where
 *  the trail starts, and a banner under the very first stone would push the
 *  whole journey down a screen for no information.
 *
 *  Width is measured from the title's own length rather than fixed, because
 *  "Stage 1" and "The Twists" differ by three characters and a plaque sized
 *  for the longer one has a lot of empty board on the shorter. The estimate is
 *  deliberately generous (the display font is wide) — a plaque slightly too
 *  big is invisible; one too small clips its own text, and there is no layout
 *  engine inside an SVG <text> to catch it.
 *
 *  `aria-hidden`: every level's own node already announces its name and state,
 *  and the header's jump rail names all seven chapters as real buttons, so a
 *  screen reader reading these too would be a third copy. */
function buildChapterBanners(): string {
  let out = "";
  for (const ch of CHALLENGE_CHAPTERS) {
    if (ch.from === 0) continue;
    const below = nodeAnchor(ch.from - 1).y;
    const above = nodeAnchor(ch.from).y;
    const y = (below + above) / 2;
    const w = Math.max(124, ch.title.length * 10 + 40);
    out +=
      `<g class="map-chapter map-chapter--${ch.kind}" aria-hidden="true">` +
      `<rect class="map-chapter-plate" x="${CENTER_X - w / 2}" y="${y - 15}" width="${w}" height="30" rx="10"></rect>` +
      `<text class="map-chapter-label" x="${CENTER_X}" y="${y + 1}" text-anchor="middle" dominant-baseline="middle">${ch.title}</text>` +
      "</g>";
  }
  return out;
}

/** A handful of small decorative flower dots scattered along the trail edges
 *  (purely cosmetic — see the task brief's "small flower dots along the trail
 *  edges ... tasteful, not busy"). Positions are DETERMINISTIC (not random)
 *  so re-renders within one open() don't jitter the garden, offset a fixed
 *  distance out from each node anchor on the side away from center so they
 *  read as trailside accents rather than crowding the stones themselves. */
const FLOWER_COLORS = ["#f4efe6", "#f2d43a", "#e8709a"] as const;

/** How many stones apart the flower clusters sit. At 8 levels every stone got
 *  a pair and that read as "tasteful, not busy"; at 40 the same rule is 80
 *  dots down a single trail, which reads as ground cover and competes with the
 *  stones themselves. Every third stone keeps the accent without the carpet. */
const FLOWER_EVERY = 3;

function buildFlowers(): string {
  let out = "";
  let colorIdx = 0;
  for (let i = 0; i < CHALLENGE_LEVEL_COUNT; i += FLOWER_EVERY) {
    const { x, y } = nodeAnchor(i);
    const side = x < CENTER_X ? 1 : -1; // flower sits on the FAR side from center
    const offsets: Array<[number, number]> = [
      [side * 46, -18],
      [side * 58, 22],
    ];
    for (const [dx, dy] of offsets) {
      const color = FLOWER_COLORS[colorIdx % FLOWER_COLORS.length];
      colorIdx++;
      const fx = Math.min(Math.max(x + dx, 14), SVG_WIDTH - 14);
      const fy = y + dy;
      out += `<circle class="map-flower" cx="${fx}" cy="${fy}" r="4" fill="${color}" opacity="0.85"></circle>`;
    }
  }
  return out;
}

/** Renders one stepping-stone node <g> at its anchor: a circular stone
 *  (fill/decoration keyed by CSS class off its state), the level number, and
 *  a small state glyph (paw for cleared, lock for locked, nothing extra for
 *  current — the pulse ring is a pure-CSS animation on `.map-node-current`,
 *  see style.css). A real <button> wrapped by a <foreignObject> would be more
 *  semantically "correct" for an SVG-embedded control, but plain <g data-*>
 *  with a delegated click/keyboard handler (see wireNodes below) keeps the
 *  markup simple and matches the rest of this codebase's event-delegation
 *  style (shop.ts's data-card-id pattern) — accessibility is covered via
 *  role="button"/tabindex/aria-disabled/aria-label on the <g> itself, which
 *  is a valid SVG accessibility pattern. */
function renderNode(level: ChallengeLevel, idx: number, state: LevelNodeState, selected: boolean): string {
  const { x, y } = nodeAnchor(idx);
  const classes = ["map-node", `map-node-${state}`];
  if (selected) classes.push("map-node-selected");
  const locked = state === "locked";
  // Material Symbols by LIGATURE NAME, exactly as everywhere else.
  //
  // This deliberately used raw codepoints for a while, on the theory that
  // ligature substitution is unreliable inside an SVG <text> node. Measured,
  // that is backwards on both counts: ligatures resolve fine in SVG in
  // Chromium and Firefox, and it is the CODEPOINTS that break — the icon font
  // is subset to the ~46 glyphs this game uses (src/ui/tokens.css explains
  // why), and Google's subsetter does not preserve the original private-use
  // codepoints. U+E668 happened to survive; U+E899 did not, so a locked stone
  // rendered a tofu box.
  //
  // Keeping the ligature name also means these two glyphs are covered by the
  // same "every name in ICON must be in the subset" rule as the rest of the
  // interface, instead of being a second, invisible way to depend on the font.
  // A LOCKED stone shows a padlock INSTEAD of its number; a reachable one
  // shows the number. The redesign drops the little corner badge the cleared
  // stones used to carry: colour already says cleared (green) versus next
  // (amber), so the badge was a third signal for a fact two were already
  // carrying, and it hung half off the stone's edge to do it.
  const label = `Level ${idx + 1}: ${level.name} — ${state}`;
  // IDEA-063: the ladder runs to 40, so a stone's face is now one OR TWO
  // characters on a disc whose radius did not change. The display font at 16px
  // overflows a 20px-radius circle's inner width at two digits, so the
  // two-digit case takes a modifier class rather than a smaller size for
  // everything — a single-digit stone should not pay for the ones that need it.
  const numClass = idx + 1 >= 10 ? "map-node-num map-node-num--wide" : "map-node-num";
  const face = locked
    ? `<text class="map-node-glyph" x="0" y="1" text-anchor="middle" dominant-baseline="middle">${ICON.lock}</text>`
    : `<text class="${numClass}" x="0" y="1" text-anchor="middle" dominant-baseline="middle">${idx + 1}</text>`;
  return (
    `<g class="${classes.join(" ")}" transform="translate(${x},${y})" data-node-idx="${idx}" ` +
    `role="button" tabindex="${locked ? "-1" : "0"}" aria-disabled="${locked}" aria-label="${label}">` +
    (state === "current" ? '<circle class="map-node-glow" r="26"></circle>' : "") +
    '<circle class="map-node-stone" r="20"></circle>' +
    face +
    "</g>"
  );
}

/**
 * Attaches the full-screen Challenge level-select page into `#levelMap`
 * (must already exist in index.html — see the module doc comment). Call once
 * from Game's constructor, alongside attachShop. Returns a
 * {@link LevelMapHandle}.
 */
export function attachLevelMap(root: ParentNode, callbacks: LevelMapCallbacks = {}): LevelMapHandle {
  const scope: ParentNode = root ?? document;

  function require<T extends HTMLElement>(id: string): T {
    const el = (scope.querySelector(`#${id}`) ?? document.getElementById(id)) as T | null;
    if (!el) {
      throw new Error(`attachLevelMap: missing #${id} — check index.html`);
    }
    return el;
  }

  const mapRoot = require<HTMLElement>("levelMap");

  let isOpenState = false;
  let progress = 0;
  let selectedIdx = 0;
  // Which chapter the trail is SCROLLED to — not which one holds the selected
  // level. The two start equal and diverge the moment a jump chip is tapped,
  // which is the whole point of the rail: looking ahead at a chapter you have
  // not reached must not disturb what Play is armed with.
  let viewChapterFrom = 0;

  function open(): void {
    isOpenState = true;
    progress = getChallengeProgress();
    selectedIdx = resolveDefaultSelection(progress);
    viewChapterFrom = chapterForLevel(selectedIdx).from;
    // Un-hide BEFORE render(): render()'s own scroll-to-selected-node call
    // (see the bottom of render()) needs the page to already be laid out
    // (non `display:none`) for scrollIntoView's geometry math to mean
    // anything — computing it while still hidden is a silent no-op, which
    // would otherwise strand the player at the top of the trail (C8's end)
    // instead of scrolled to the default-selected node (typically C1, at the
    // BOTTOM of the trail) on every open().
    mapRoot.classList.remove("hidden");
    render();
    callbacks.onOpen?.();
  }

  /** Closes the page AND fires onClose — used by BOTH the Back button and
   *  playSelected(). onClose is what lets the caller restore chrome state
   *  (game.ts removes `body.map-open` there, which un-hides the HUD and
   *  #mainMenu). An earlier version skipped onClose on the Play path as a
   *  "redundant toggle" — that was a real shipped bug: nothing else removes
   *  `body.map-open`, so the HUD stayed hidden for the whole run and the
   *  menu's buttons stayed hidden after a game-over → Menu. Always fire it. */
  function close(): void {
    isOpenState = false;
    mapRoot.classList.add("hidden");
    callbacks.onClose?.();
  }

  function selectNode(idx: number): void {
    const state = levelNodeState(idx, progress);
    if (state === "locked") return;
    if (selectedIdx === idx) return;
    selectedIdx = idx;
    // render() scrolls the selected node into view, so the chapter in view is
    // about to be this stone's chapter whether the rail says so or not.
    viewChapterFrom = chapterForLevel(idx).from;
    render();
  }

  function playSelected(): void {
    const state = levelNodeState(selectedIdx, progress);
    if (state === "locked") return;
    close();
    callbacks.onPlayLevel?.(selectedIdx);
  }

  function renderHeader(): string {
    const cleared = Math.min(progress, CHALLENGE_LEVEL_COUNT);
    return (
      '<div class="map-header">' +
      // Back is an icon-only square now: the word "Menu" beside the arrow was
      // paying for a third of the header bar to repeat what the arrow says,
      // and the header needs that room for the progress bar.
      `<button type="button" class="map-back" id="mapBackBtn" aria-label="Back to menu">${iconHtml(ICON.back)}</button>` +
      '<div class="map-title-block">' +
      '<div class="map-title">Challenge garden</div>' +
      // Progress as a BAR, not a count. "3 / 8 cleared" is a fact you read;
      // a filled bar is a distance you see, which is what a trail of eight
      // stones is actually about. The exact figure stays beside it, and the
      // track carries the accessible name.
      '<div class="map-progress">' +
      `<div class="map-progress-track" role="progressbar" aria-valuemin="0" ` +
      `aria-valuemax="${CHALLENGE_LEVEL_COUNT}" aria-valuenow="${cleared}" ` +
      `aria-label="${cleared} of ${CHALLENGE_LEVEL_COUNT} levels cleared">` +
      `<div class="map-progress-fill" style="width:${(cleared / CHALLENGE_LEVEL_COUNT) * 100}%"></div>` +
      "</div>" +
      `<div class="map-progress-count">${cleared}/${CHALLENGE_LEVEL_COUNT}</div>` +
      "</div>" +
      "</div>" +
      renderChapterRail() +
      "</div>"
    );
  }

  /** The chapter jump rail (IDEA-063) — one chip per chapter, in the header.
   *
   *  Forty stones at NODE_SPACING_Y is about 4 000 SVG units of trail. Walking
   *  it is the point; being unable to GET anywhere on it is not, and the
   *  existing scroll-to-selected only ever lands you where you already are.
   *  Each chip scrolls the trail to that chapter's first stone.
   *
   *  It deliberately does NOT select anything. Selection drives the Play
   *  button, and a chip that both moved the view and re-armed Play would let a
   *  player tap "jump to stage 4" and then "Play stone 16" without ever having
   *  looked at stone 16. Scrolling is a way of LOOKING (the same split the
   *  editor's viewport furniture is built on).
   *
   *  A chip whose whole chapter is still locked is dimmed but NOT disabled —
   *  seeing what is ahead is exactly what a locked chapter is for, and this
   *  screen's job in IDEA-063 is showing the player what the game contains. */
  function renderChapterRail(): string {
    const chips = CHALLENGE_CHAPTERS.map((ch) => {
      const classes = ["map-chapter-chip"];
      if (ch.from === viewChapterFrom) classes.push("map-chapter-chip--on");
      if (ch.from > progress) classes.push("map-chapter-chip--locked");
      // The twists chapter is not a numbered stage, so its chip is not a
      // figure — it is the one place in the rail that reads as a different
      // KIND of destination. `short` stays on the chapter as the text
      // fallback for a font subset that has gone stale.
      const face = ch.kind === "twist" ? iconHtml(ICON.star) : ch.short;
      return (
        `<button type="button" class="${classes.join(" ")}" data-chapter-from="${ch.from}" ` +
        `aria-label="Jump to ${ch.title}">${face}</button>`
      );
    }).join("");
    return `<div class="map-chapter-rail" role="group" aria-label="Jump to a chapter">${chips}</div>`;
  }

  function renderPath(): string {
    const nodes = CHALLENGE_LEVELS.map((level, idx) =>
      renderNode(level, idx, levelNodeState(idx, progress), idx === selectedIdx),
    ).join("");
    return (
      '<div class="map-path-scroll">' +
      `<svg class="map-path-svg" viewBox="0 0 ${SVG_WIDTH} ${svgHeight()}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Challenge path">` +
      // Hills paint FIRST (SVG's painter's model: earlier siblings render
      // behind later ones) so the trail/flowers/nodes always sit on top of
      // them — summit hill behind C8 first (top of the SVG), ground hill
      // behind C1 last-among-hills (bottom of the SVG), matching their
      // physical top-to-bottom order in the document.
      buildSummitHill() +
      buildGroundHill() +
      '<path class="map-trail" ' +
      `d="${buildTrailPath()}"></path>` +
      buildFlowers() +
      // Banners paint BEFORE the nodes for the same painter's-model reason the
      // hills do: a stone that happens to sit near a chapter boundary must be
      // on top of the plaque, never under it.
      buildChapterBanners() +
      nodes +
      "</svg>" +
      "</div>"
    );
  }

  /**
   * IDEA-014 (desktop rework): the shared "about the selected level" info
   * block — ONE markup styled TWO ways by CSS, exactly mirroring shop.ts's
   * `.shop-panel{display:contents}` + `order` trick (see that module's own
   * render() doc comment): on mobile (≤820px) this renders as the pinned
   * FOOTER BAR at the bottom of the page (unchanged from the shipped mobile
   * layout — name/blurb/compact twist-summary/Play), and on desktop
   * (>820px) the exact same DOM becomes a translucent-chrome RIGHT SIDE
   * PANEL with richer content: the full non-baseline twist LIST (one line
   * per modifier, via twistParts — not the compact "·"-joined
   * twistSummary string mobile uses), which maze it's played on
   * (MAZE_NAMES[level.mazeIdx]), and an explicit state line (stateLabel) —
   * all things the cramped mobile footer bar has no room for, but the
   * desktop panel does. One render path, one source of truth for the
   * content; CSS alone decides which subset/layout shows where (see
   * style.css's `.map-panel-info`/`.map-panel-extra` rules and the
   * `min-width:821px` media query, matching the shop's own breakpoint). */
  function renderPanelInfo(): string {
    const level = CHALLENGE_LEVELS[selectedIdx];
    const state = levelNodeState(selectedIdx, progress);
    const summary = twistSummary(level);
    const compactTwistLine = summary || "Classic pace — no twists";
    const parts = twistParts(level);
    const twistListHtml = parts.length
      ? parts.map((p) => `<div class="map-panel-twist-line">${p}</div>`).join("")
      : '<div class="map-panel-twist-line">Classic pace — 3 enemies, full fright</div>';
    const disabled = state === "locked" ? "disabled" : "";
    // §05: the primary action always carries an icon. Replay reads as a
    // different act from Play, so it takes a different one.
    // The button names the stone it opens. "Play" alone left the player to
    // remember which of eight they had selected — a real question on a trail
    // where tapping a stone only moves a highlight.
    const stone = selectedIdx + 1;
    const playLabel =
      state === "cleared"
        ? `${iconHtml(ICON.replay)}Replay stone ${stone}`
        : `${iconHtml(ICON.play)}Play stone ${stone}`;
    const mazeName = MAZE_NAMES[level.mazeIdx] ?? MAZE_NAMES[0];
    // getMazeTheme falls back to the default for an unknown id rather than
    // throwing, so a typo in challenges.ts shows the wrong name here instead of
    // taking the page down — and scripts/test-cosmetics.ts fails the build.
    const themeName = getMazeTheme(level.themeId).name;
    const chapter = chapterForLevel(selectedIdx);
    return (
      '<div class="map-panel-info">' +
      '<div class="map-panel-info-body">' +
      // The stone's own number as a plate, then the name — so the panel and
      // the trail identify the level the same way.
      '<div class="map-panel-head">' +
      `<span class="map-panel-num">${stone}</span>` +
      `<span class="map-footer-title">${level.name}</span>` +
      "</div>" +
      `<div class="map-footer-blurb">${level.blurb}</div>` +
      // Mobile-only compact line (hidden on desktop via CSS, where the full
      // twistListHtml below is shown instead).
      // A TAG rather than a line of text: a twist is a warning about how this
      // level differs, and it should read as a label on the level, not as more
      // prose. Warning-orange, the same colour a power-up uses for its last
      // three seconds — both mean "this changes what you expect".
      // Two tags, and which ones appear says which CHAPTER you are in.
      //
      // The theme tag is the one IDEA-063 added and it is not decoration: a
      // challenge level forces its theme whether or not the player owns it, so
      // this is the only place the game tells them that the board they are
      // about to play is dressed in something from the shop. On a tour level
      // it is the ONLY tag, which is correct — a tour level has no twists, and
      // an amber warning tag saying "Classic pace" was a warning about
      // nothing.
      `<div class="map-tag-row">` +
      `<div class="map-theme-tag">${iconHtml(ICON.themes)}${themeName}</div>` +
      (parts.length ? `<div class="map-twist-tag">${iconHtml(ICON.error)}${compactTwistLine}</div>` : "") +
      "</div>" +
      // Desktop-only richer block (hidden on mobile via CSS): full twist
      // list, maze name, explicit state label — see the function doc comment.
      '<div class="map-panel-extra">' +
      `<div class="map-panel-twist-list">${twistListHtml}</div>` +
      // A tour level IS its maze, so its name and the maze's name are the same
      // string and printing "on The Pergola" under a title already reading
      // "The Pergola" is a line that says nothing. The twists reuse mazes the
      // tour already named, so there the line is real information.
      (level.kind === "twist" ? `<div class="map-panel-maze">on ${mazeName}</div>` : "") +
      `<div class="map-panel-maze">${chapter.title}, level ${selectedIdx + 1} of ${CHALLENGE_LEVEL_COUNT}</div>` +
      `<div class="map-panel-state">${stateLabel(state)}</div>` +
      "</div>" +
      "</div>" +
      `<button type="button" class="map-play-btn" id="mapPlayBtn" ${disabled}>${playLabel}</button>` +
      "</div>"
    );
  }

  function render(): void {
    // Note: no separate absolutely-positioned "hill" element here anymore —
    // the ground/summit hills are drawn INSIDE the SVG returned by
    // renderPath() (see buildGroundHill/buildSummitHill), specifically so
    // they scroll together with the trail content and stay pinned behind
    // C1/C8 respectively rather than floating over the .map-body VIEWPORT at
    // whatever the current scroll position happens to be (the bug the
    // previous position:absolute;bottom:0 version had).
    //
    // IDEA-014 (desktop rework): .map-header is now a DIRECT sibling of
    // .map-stage (not nested inside a narrow max-width column together with
    // it) so CSS can make the header span the FULL page width on desktop
    // while .map-stage's own trail-column + side-panel content stays
    // constrained/centered — mirrors the task brief's "full-width top bar,
    // like the shop's". .map-stage wraps the trail body + the shared
    // panel/footer info block (renderPanelInfo) — on mobile a plain column
    // (unchanged), on desktop a flex ROW with the trail centered in the
    // space left of the fixed-width side panel (mirrors shop.ts's
    // .shop-stage exactly).
    mapRoot.innerHTML =
      '<div class="map-page">' +
      renderHeader() +
      '<div class="map-stage">' +
      '<div class="map-body">' +
      renderPath() +
      "</div>" +
      renderPanelInfo() +
      "</div>" +
      "</div>";

    const backBtn = mapRoot.querySelector<HTMLButtonElement>("#mapBackBtn");
    backBtn?.addEventListener("click", close);

    const playBtn = mapRoot.querySelector<HTMLButtonElement>("#mapPlayBtn");
    playBtn?.addEventListener("click", playSelected);

    // Chapter jump chips: scroll only, never select — see renderChapterRail.
    mapRoot.querySelectorAll<HTMLButtonElement>("[data-chapter-from]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const from = Number(btn.dataset.chapterFrom);
        viewChapterFrom = from;
        // Deliberately NOT render(): render() ends by scrolling the SELECTED
        // node into view, so re-rendering here would scroll the trail straight
        // back to where it was and the jump would look like a dead button.
        // The only thing that changed is which chip is lit, so that is the only
        // thing written to the DOM.
        mapRoot.querySelectorAll<HTMLButtonElement>("[data-chapter-from]").forEach((other) => {
          other.classList.toggle("map-chapter-chip--on", Number(other.dataset.chapterFrom) === from);
        });
        const node = mapRoot.querySelector<SVGGElement>(`[data-node-idx="${from}"]`);
        node?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      });
    });

    mapRoot.querySelectorAll<SVGGElement>("[data-node-idx]").forEach((g) => {
      const idx = Number(g.dataset.nodeIdx);
      g.addEventListener("click", () => selectNode(idx));
      g.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          selectNode(idx);
        }
      });
    });

    // Keep the selected node scrolled into view (e.g. reopening deep into
    // the path shouldn't strand the player scrolled to the top, and
    // open()'s default selection is usually near the BOTTOM of the trail —
    // C1 lives at the largest y — so without this the player would land
    // looking at C8's end of the path instead). Deferred one frame via
    // requestAnimationFrame: scrollIntoView's geometry math needs the
    // freshly-inserted innerHTML (and, on open(), the just-unhidden page) to
    // have actually been laid out first — calling it in the same synchronous
    // tick as the innerHTML write measures against not-yet-computed geometry
    // and silently no-ops.
    requestAnimationFrame(() => {
      // IDEA-063: publish the header's MEASURED height so the desktop side
      // panel can stick below it.
      //
      // The panel's sticky offset used to be the literal `72px` — the height of
      // a header that was one row of title over a progress bar. The chapter
      // jump rail added a second row and the panel's own head (its number plate
      // and the level name) slid underneath the header, which looks exactly
      // like a panel that forgot to render its title. Measuring is the fix
      // rather than a bigger literal: the header also grows if the title wraps,
      // which it does at narrower desktop widths and in any longer translation.
      const headerEl = mapRoot.querySelector<HTMLElement>(".map-header");
      if (headerEl) {
        mapRoot.style.setProperty("--map-header-h", `${Math.round(headerEl.getBoundingClientRect().height)}px`);
      }

      const selectedNode = mapRoot.querySelector<SVGGElement>(".map-node-selected");
      selectedNode?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }

  return {
    open,
    isOpen: () => isOpenState,
    detach: () => {
      mapRoot.innerHTML = "";
    },
  };
}
