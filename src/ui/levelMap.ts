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
  CHALLENGE_LEVELS,
  CHALLENGE_LEVEL_COUNT,
  CLASSIC_MODIFIERS,
  MAZE_NAMES,
  type ChallengeLevel,
} from "../game/challenges";
import { getChallengeProgress } from "../game/profileStore";

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
 *  state — "Cleared 🐾" / "Up next" / "Locked 🔒" — shown on the panel above
 *  the Play button, alongside the richer name/blurb/twist-list/maze-name
 *  info. Deliberately its own small helper (not reused for the mobile
 *  footer, which has no room/need for this extra line) rather than baked
 *  into renderPanelInfo directly, so the three-state copy lives in one place. */
function stateLabel(state: LevelNodeState): string {
  if (state === "cleared") return "Cleared \u{1F43E}";
  if (state === "locked") return "Locked \u{1F512}";
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
 *  enough to comfortably space 8 nodes, not fit a fixed viewport). Nodes
 *  alternate between LEFT_X and RIGHT_X for the S-curve feel; the path
 *  string is built by visiting each node's anchor in order (bottom to top,
 *  since C1 is index 0 and belongs at the BOTTOM of the trail — the task
 *  brief: "from bottom (C1) to top (C8)").
 *
 *  NODE_SPACING_Y (composition pass, coordinator review): was 148 — with a
 *  ~500-640px tall .map-body viewport (desktop 1100x750 / phone 390x844)
 *  that showed only ~3 (desktop) / ~5 (phone) of the 8 stones at once, too
 *  sparse for a map whose whole charm is seeing the journey. Tightened ~38%
 *  to 92, which lands ~5-6 visible on desktop and ~6-7 on phone (the trail
 *  still scrolls for the rest) while keeping node circles themselves
 *  untouched (r=20, i.e. a 40px/CSS-px stone — the ~44px tap target comes
 *  from the stone plus its own hit area, unchanged by this pass) and the
 *  left/right S-curve alternation intact. SVG_TOP/BOTTOM_MARGIN shrunk
 *  proportionally (70 -> 46) so the trail's end-caps don't silently re-add
 *  back most of the compression just removed from the node rhythm; the
 *  bottom margin still leaves just enough room for the ground hill (drawn
 *  IN the SVG itself now, behind C1 — see buildGroundHill) and the top
 *  margin for the small summit hill behind C8 (buildSummitHill). */
const SVG_WIDTH = 320;
const NODE_SPACING_Y = 92;
const SVG_TOP_MARGIN = 46;
const SVG_BOTTOM_MARGIN = 46;
const LEFT_X = 96;
const RIGHT_X = 224;
const CENTER_X = SVG_WIDTH / 2;

function svgHeight(): number {
  return SVG_TOP_MARGIN + NODE_SPACING_Y * (CHALLENGE_LEVEL_COUNT - 1) + SVG_BOTTOM_MARGIN;
}

/** The (x,y) anchor for node `idx` (0-based) — y counts DOWN from the top of
 *  the SVG per normal SVG convention, but idx 0 (C1) is placed at the BOTTOM
 *  (largest y) and idx COUNT-1 (C8) at the TOP (smallest y), so the trail
 *  reads bottom-to-top as the level number increases. x alternates
 *  left/right, starting left for C1. */
function nodeAnchor(idx: number): { x: number; y: number } {
  const rowFromBottom = idx; // 0 = bottom row
  const y = svgHeight() - SVG_BOTTOM_MARGIN - rowFromBottom * NODE_SPACING_Y;
  const x = idx % 2 === 0 ? LEFT_X : RIGHT_X;
  return { x, y };
}

/** A smooth-ish winding path string through every node's anchor, using a
 *  quadratic bezier per segment with the control point pulled toward the
 *  shared center X so consecutive left/right anchors curve through the
 *  middle rather than zig-zagging with sharp corners. */
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

/** A handful of small decorative flower dots scattered along the trail edges
 *  (purely cosmetic — see the task brief's "small flower dots along the trail
 *  edges ... tasteful, not busy"). Positions are DETERMINISTIC (not random)
 *  so re-renders within one open() don't jitter the garden, offset a fixed
 *  distance out from each node anchor on the side away from center so they
 *  read as trailside accents rather than crowding the stones themselves. */
const FLOWER_COLORS = ["#f4efe6", "#f2d43a", "#e8709a"] as const;

function buildFlowers(): string {
  let out = "";
  let colorIdx = 0;
  for (let i = 0; i < CHALLENGE_LEVEL_COUNT; i++) {
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
  const glyph = state === "cleared" ? "\u{1F43E}" : state === "locked" ? "\u{1F512}" : "";
  const label = `Level ${idx + 1}: ${level.name} — ${state}`;
  return (
    `<g class="${classes.join(" ")}" transform="translate(${x},${y})" data-node-idx="${idx}" ` +
    `role="button" tabindex="${locked ? "-1" : "0"}" aria-disabled="${locked}" aria-label="${label}">` +
    (state === "current" ? '<circle class="map-node-glow" r="26"></circle>' : "") +
    '<circle class="map-node-stone" r="20"></circle>' +
    `<text class="map-node-num" x="0" y="1" text-anchor="middle" dominant-baseline="middle">${idx + 1}</text>` +
    (glyph ? `<text class="map-node-glyph" x="15" y="-13" text-anchor="middle">${glyph}</text>` : "") +
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

  function open(): void {
    isOpenState = true;
    progress = getChallengeProgress();
    selectedIdx = resolveDefaultSelection(progress);
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
      '<button type="button" class="map-back" id="mapBackBtn" aria-label="Back to menu">&larr; Menu</button>' +
      '<div class="map-title-block">' +
      '<div class="map-title">Challenge</div>' +
      `<div class="map-progress">${cleared} / ${CHALLENGE_LEVEL_COUNT} cleared</div>` +
      "</div>" +
      '<div class="map-header-spacer" aria-hidden="true"></div>' +
      "</div>"
    );
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
      : '<div class="map-panel-twist-line">Classic pace — no twists</div>';
    const disabled = state === "locked" ? "disabled" : "";
    const playLabel = state === "cleared" ? "▶ Replay" : "▶ Play";
    const mazeName = MAZE_NAMES[level.mazeIdx] ?? MAZE_NAMES[0];
    return (
      '<div class="map-panel-info">' +
      '<div class="map-panel-info-body">' +
      `<div class="map-footer-title">C${selectedIdx + 1} · ${level.name}</div>` +
      `<div class="map-footer-blurb">${level.blurb}</div>` +
      // Mobile-only compact line (hidden on desktop via CSS, where the full
      // twistListHtml below is shown instead).
      `<div class="map-footer-twist">${compactTwistLine}</div>` +
      // Desktop-only richer block (hidden on mobile via CSS): full twist
      // list, maze name, explicit state label — see the function doc comment.
      '<div class="map-panel-extra">' +
      `<div class="map-panel-twist-list">${twistListHtml}</div>` +
      `<div class="map-panel-maze">on ${mazeName}</div>` +
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
