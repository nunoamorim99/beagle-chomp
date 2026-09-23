// OWNER: gameplay-engineer (IDEA-079)
//
// THE JOURNEY MAP — the screen that replaced the SVG trail.
//
// A DROP-IN FOR `attachLevelMap`. Same call shape, same handle
// (`{ open, detach, isOpen }`), same callbacks, same `#levelMap` root and
// therefore the same `body.map-open` chrome rules and the same hedge-wipe
// transition. `game.ts` changed by one import: this screen is a different
// PICTURE of the same thing, not a different thing, and every other part of the
// game that knew about the level map should not have had to hear about it.
//
// ---------------------------------------------------------------------------
// WHAT THE SVG TRAIL EARNED THAT THIS HAD TO KEEP
// ---------------------------------------------------------------------------
//
// `levelMap.ts` took two revisions to get its behaviour right and none of that
// was about how it looked:
//
//  * **A LOCKED STONE IS SELECTABLE** ([[IDEA-063]] v2). Tapping one fills the
//    card with its name, theme and twists; only PLAY refuses, and it says why
//    — "Clear stone N first", because unlocking is strictly sequential so
//    `progress + 1` is the one fact a disabled button would otherwise leave the
//    player to work out. A new player has thirty-nine padlocks and the screen's
//    whole job is showing what the game contains.
//  * It is therefore NOT `aria-disabled` and NOT `tabindex="-1"` — it is a
//    control that does something.
//  * The default selection is the CURRENT level, or the LAST one once every
//    level is cleared (`progress === JOURNEY_LEVEL_COUNT` means no index is
//    ever "current").
//
// ---------------------------------------------------------------------------
// AND THREE THINGS THAT ARE NEW BECAUSE THE PICTURE IS 3D
// ---------------------------------------------------------------------------
//
//  1. **THE PAGE IS A HOLE.** `#levelMap` is already `pointer-events: none`
//     with its header opting back in, which the SVG version needed for its own
//     reasons and which this one needs absolutely: the scene behind it is
//     DRAGGED, so everything except the header, the pins and the card has to
//     let a pointer through to the canvas. The opaque sky gradient goes with it
//     — `.map--islands` clears it, because the 3D IS the background now.
//
//  2. **THE SCENE'S POINTER HANDLERS LIVE EXACTLY AS LONG AS THE SCREEN.**
//     They attach to the GAME's canvas, which is also the beagle's swipe
//     control. `activate`/`deactivate` bracket `open`/`close` for that reason
//     and no other.
//
//  3. **THE CARD IS DISMISSED BY TAPPING THE WATER**, which a list of stones
//     had no equivalent of. The scene only reports a tap that was not a drag,
//     so this cannot fire at the end of a pan.

import { JOURNEY_LEVELS, JOURNEY_LEVEL_COUNT, getJourneyLevel } from "../game/journey.js";
import { getMazeTheme } from "../game/themes.js";
import { getChallengeProgress } from "../game/profileStore.js";
import { ICON, iconHtml } from "./icons.js";
import { attachJourneyPins, type JourneyPinsHandle, type PinState } from "./journeyPins.js";
import { defaultSelectedLevel, levelNodeState, twistSummary } from "./levelMapInfo.js";
import type { JourneyScene } from "../render/journeyScene.js";

export interface JourneyMapCallbacks {
  /** Fired when the player taps Play for the selected, unlocked level. This
   *  module closes itself first, so the caller only starts the run. */
  onPlayLevel?: (idx: number) => void;
  /** Fired as the page opens, so the caller can add `body.map-open`. */
  onOpen?: () => void;
  /**
   * Fired whenever the page closes — INCLUDING on a successful Play.
   *
   * The old screen's JSDoc claimed Play was an exception and its code did the
   * opposite (`playSelected` called `close()`, which always fired this). I
   * implemented the COMMENT, and the result was that `body.map-open` survived
   * into the run: that class sets `.hud{display:none}`, so the whole HUD and
   * the home button were invisible for the entire level. A prose contract that
   * disagrees with its own code is worth less than the code.
   */
  onClose?: () => void;
}

export interface JourneyMapHandle {
  open: () => void;
  /** Per-frame while open — repositions the pins from the live camera. Driven
   *  by game.ts's own loop rather than a `requestAnimationFrame` of its own,
   *  because a second loop would keep running behind a paused game and would
   *  race the one that owns the renderer. */
  tick: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

function pinStateFor(idx: number, progress: number): PinState {
  const s = levelNodeState(idx, progress);
  return s === "cleared" ? "cleared" : s === "current" ? "current" : "locked";
}

export function attachJourneyMap(
  root: ParentNode,
  scene: JourneyScene,
  /**
   * The GAME CANVAS — where the map's drag/tap listeners go.
   *
   * NOT `document.body`, and this is a bug fix rather than a preference. On
   * body the rig sees every pointer event on the page, including the ones on
   * this screen's own controls: pressing PLAY fired the rig's `onTap` on
   * `pointerup`, which dismissed the card and cleared the selection, and then
   * the button's `click` — which runs after `pointerup` — found nothing
   * selected and returned. The button looked completely dead.
   *
   * The canvas is the right surface by construction: the card and the header
   * sit above it and take their own pointer events, while the pin layer is
   * `pointer-events: none` except for the pins themselves, so a drag started
   * over empty map still reaches the canvas exactly as it should.
   */
  canvas: HTMLElement,
  callbacks: JourneyMapCallbacks = {},
): JourneyMapHandle {
  const scope: ParentNode = root ?? document;
  const found =
    (scope.querySelector("#levelMap") as HTMLElement | null) ??
    document.getElementById("levelMap");
  if (!found) throw new Error("attachJourneyMap: missing #levelMap — check index.html");
  const mapRoot: HTMLElement = found;

  // The modifier, not a new id: keeping `#levelMap` is what keeps
  // `body.map-open`, the z-index and the hedge-wipe `::before` working with no
  // change to any of them.
  mapRoot.classList.add("map--islands");

  mapRoot.innerHTML =
    '<div class="map-header">' +
    `<button type="button" class="map-back" id="mapBackBtn" aria-label="Back to menu">${iconHtml(ICON.back)}</button>` +
    '<div class="map-title-block">' +
    '<div class="map-title">The Journey</div>' +
    // The header reuses the SVG map's own markup and therefore its own CSS —
    // the back button, the title block and the progress bar were already
    // designed, already responsive and already the right thing. Only the
    // picture below them changed.
    '<div class="map-progress">' +
    `<div class="map-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${JOURNEY_LEVEL_COUNT}" aria-valuenow="0" id="mapBar">` +
    '<div class="map-progress-fill" id="mapBarFill"></div></div>' +
    '<div class="map-progress-count" id="mapCount"></div></div>' +
    "</div>" +
    "</div>" +
    '<div class="jp-layer" id="mapPins"></div>' +
    '<div class="map-card" id="mapCard" role="dialog" aria-live="polite">' +
    '<div class="map-card-head"><span class="map-card-num" id="mapCardNum"></span>' +
    '<h2 class="map-card-title" id="mapCardTitle"></h2></div>' +
    '<p class="map-card-sub" id="mapCardSub"></p>' +
    '<div class="map-card-row">' +
    '<button type="button" class="map-play-btn" id="mapPlayBtn"></button>' +
    "</div></div>";

  const pinsRoot = mapRoot.querySelector<HTMLElement>("#mapPins")!;
  const backBtn = mapRoot.querySelector<HTMLButtonElement>("#mapBackBtn")!;
  const card = mapRoot.querySelector<HTMLElement>("#mapCard")!;
  const cardNum = mapRoot.querySelector<HTMLElement>("#mapCardNum")!;
  const cardTitle = mapRoot.querySelector<HTMLElement>("#mapCardTitle")!;
  const cardSub = mapRoot.querySelector<HTMLElement>("#mapCardSub")!;
  const playBtn = mapRoot.querySelector<HTMLButtonElement>("#mapPlayBtn")!;
  const barFill = mapRoot.querySelector<HTMLElement>("#mapBarFill")!;
  const countEl = mapRoot.querySelector<HTMLElement>("#mapCount")!;
  const bar = mapRoot.querySelector<HTMLElement>("#mapBar")!;

  let isOpenState = false;
  let progress = 0;
  let selected = -1;

  const pins: JourneyPinsHandle = attachJourneyPins(pinsRoot, {
    levels: JOURNEY_LEVELS.map((lv, i) => ({
      id: `l${i}`,
      number: i + 1,
      name: lv.name,
      state: "locked" as PinState,
    })),
    project: (i) => scene.project(i),
    isDragging: () => scene.isDragging(),
    onSelect: (_level, i) => select(i),
  });

  function closeCard(): void {
    if (selected < 0) return;
    selected = -1;
    card.classList.remove("is-open");
    pins.setSelected(null);
    scene.focus(null);
  }

  function select(i: number): void {
    selected = i;
    pins.setSelected(`l${i}`);
    scene.focus(i);

    const lv = getJourneyLevel(i);
    const state = levelNodeState(i, progress);
    const themeName = getMazeTheme(lv.themeId).name;
    const twists = twistSummary(lv);

    cardNum.textContent = String(i + 1);
    cardTitle.textContent = lv.name;
    cardSub.textContent = twists ? `${themeName} · ${twists}` : `${themeName} · classic pace`;

    // A LOCKED LEVEL STILL OPENS THE CARD — looking ahead is what this screen
    // is for. Only Play refuses, and it names the stone that unlocks this one.
    if (state === "locked") {
      playBtn.disabled = true;
      playBtn.innerHTML = `${iconHtml(ICON.lock)}Clear stone ${progress + 1} first`;
    } else {
      playBtn.disabled = false;
      playBtn.innerHTML =
        state === "cleared"
          ? `${iconHtml(ICON.replay)}Replay stone ${i + 1}`
          : `${iconHtml(ICON.play)}Play stone ${i + 1}`;
    }
    card.classList.add("is-open");
  }

  function close(): void {
    isOpenState = false;
    closeCard();
    scene.deactivate();
    mapRoot.classList.add("hidden");
    // ALWAYS. See onClose's own note: skipping it on the Play path leaves
    // `body.map-open` set and the run has no HUD.
    callbacks.onClose?.();
  }

  backBtn.addEventListener("click", close);

  playBtn.addEventListener("click", () => {
    if (playBtn.disabled || selected < 0) return;
    const idx = selected;
    close();
    callbacks.onPlayLevel?.(idx);
  });

  // Tapping the water dismisses the card. The scene only reports a tap that
  // cleared its own drag threshold test, so a pan can never trigger this.
  scene.onTap(() => closeCard());

  function open(): void {
    isOpenState = true;
    progress = getChallengeProgress();

    pins.setStates(JOURNEY_LEVELS.map((_, i) => pinStateFor(i, progress)));
    // Clouds over the chapters still ahead. Set BEFORE the first frame so a
    // chapter that was already open does not flash a bank and then clear it.
    scene.setProgress(progress);
    const done = Math.min(progress, JOURNEY_LEVEL_COUNT);
    barFill.style.width = `${(done / JOURNEY_LEVEL_COUNT) * 100}%`;
    countEl.textContent = `${done}/${JOURNEY_LEVEL_COUNT}`;
    bar.setAttribute("aria-valuenow", String(done));
    bar.setAttribute("aria-label", `${done} of ${JOURNEY_LEVEL_COUNT} levels cleared`);

    // Un-hide BEFORE framing: the camera rig measures the viewport, and a
    // `display:none` page reports zero — which would leave the projection
    // matrix built for a 0x0 frame and every pin at the origin. The SVG
    // version had the same ordering rule for `scrollIntoView`.
    mapRoot.classList.remove("hidden");
    scene.activate(canvas);
    scene.resize(window.innerWidth, window.innerHeight);
    scene.frameLevel(defaultSelectedLevel(progress));
    closeCard();
    callbacks.onOpen?.();
  }

  return {
    open,
    tick: () => pins.update(),
    isOpen: () => isOpenState,
    detach(): void {
      close();
      pins.detach();
      mapRoot.innerHTML = "";
      mapRoot.classList.remove("map--islands");
    },
  };
}
