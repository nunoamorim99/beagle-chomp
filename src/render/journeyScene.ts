// OWNER: render-artist (IDEA-079)
//
// THE JOURNEY MAP'S 3D SCENE — the island chain, its ocean and its camera.
//
// The fourth showcase scene after `menuScene`, `shopScene` and the game rig,
// and it follows their contract exactly: it owns a `scene` and a `camera` and
// NOTHING ELSE. There is one `WebGLRenderer` in this project (`scene.ts`) and
// `game.ts`'s `tick()` picks which scene to hand it each frame — "one renderer,
// one scene at a time", as that branch's own comment puts it. A second renderer
// for this screen would be a second GL context and a second copy of every
// texture on a phone that is already holding the board's.
//
// ---------------------------------------------------------------------------
// WHAT IS DIFFERENT FROM THE OTHER TWO, AND WHY IT IS NOT A FREE SWAP
// ---------------------------------------------------------------------------
//
//  1. **IT IS INTERACTIVE, SO IT OWNS POINTER HANDLERS ON A CANVAS IT DOES NOT
//     OWN.** `menuScene` and `shopScene` are pictures; this one is dragged,
//     flicked and tapped. The handlers go on the GAME's canvas, which is also
//     the swipe control for the beagle — so they are attached on `open()` and
//     detached on `close()` rather than for the life of the scene. A rig left
//     listening would eat the first swipe of the next run.
//
//  2. **IT IS BUILT ONCE AND KEPT.** Forty islands is ~160k triangles and a
//     second or so of geometry work; rebuilding that on every open would be a
//     visible stall on the one screen a player opens between every single run.
//     What DOES change per open is progress, and progress is drawn by the HTML
//     pin layer, not by the scene.
//
//  3. **IT TAKES A WIDTH AND A HEIGHT, NOT AN ASPECT.** The other two only need
//     an aspect because nothing is ever projected out of them. This one hands
//     CSS pixel coordinates to `journeyPins.ts` every frame, so it needs the
//     real viewport size.
//
//  4. **THERE ARE LIGHTS AND ALMOST NOTHING USES THEM.** Under the reference's
//     material system (`madboxStyle.ts`) every island is matcaps and unlit
//     bakes, and the sea is two `ShaderMaterial`s with `lights: false` — so the
//     scene is, as the reference intends, lit by nothing. The pair is kept for
//     the one material that legitimately escapes the swap: Arcade Night's deck
//     is a TEXTURED emissive toon material, deliberately skipped because a
//     matcap would throw away its neon grid. Two lights for one deck is a fair
//     trade against special-casing it.

import * as THREE from "three";
import { JOURNEY_LEVELS } from "../game/journey.js";
import { getMazeTheme } from "../game/themes.js";
import { makeJourneyIsland, ISLAND_PARAMS, PIN_ANCHOR_Y } from "./journeyIsland.js";
import { makeJourneySea, type JourneySea } from "./journeySea.js";
import { updateJourneyWater } from "./journeyWater.js";
import {
  attachJourneyCamera,
  deriveFocusPoints,
  JOURNEY_CAMERA,
  type FocusPoint,
  type JourneyCameraHandle,
} from "./journeyCamera.js";
import { applyMadboxStyle, makeMadboxCaches, MADBOX_BOUNCE } from "./madboxStyle.js";
import { makeJourneyClouds, type JourneyClouds } from "./journeyClouds.js";
import { JOURNEY_CHAPTERS } from "../game/journey.js";

/** How far apart two islands sit along the chain, and how far the chain
 *  wanders across it. Tuned against the phone frame: about three islands on
 *  screen at once, which is enough to read the chain as a route without any
 *  one of them becoming a thumbnail. */
export const CHAIN = {
  spacing: 7,
  swing: 2.6,
  /** Extra gap at each chapter boundary, so the six stages read as stages. */
  chapterGap: 5,
  chapterEvery: 5,
} as const;

export interface JourneyScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Per-frame. `dt` in SECONDS (the camera's damping), `elapsedMs` in
   *  MILLISECONDS (the water's foam scroll — journeyWater.ts's own note). */
  update: (dt: number, elapsedMs: number) => void;
  resize: (width: number, height: number) => void;
  /** Start listening for drags on `dom`. Call when the screen opens. */
  activate: (dom: HTMLElement) => void;
  /** Stop listening. Call when it closes, or the rig eats the next run's
   *  first swipe. */
  deactivate: () => void;
  /** Screen position of level `i`'s pin anchor, in CSS pixels. */
  project: (i: number) => { x: number; y: number; onScreen: boolean; distance: number };
  focus: (i: number | null) => void;
  /** Open the map with level `i` in the middle of the frame. */
  frameLevel: (i: number) => void;
  isDragging: () => boolean;
  /** Fired on a TAP that was not a drag, so the screen can dismiss its card. */
  onTap: (fn: () => void) => void;
  /** Clouds sit over the chapters this has not reached. Called when the map
   *  opens, so a chapter unlocked since the last visit clears as it is shown. */
  setProgress: (progress: number) => void;
  dispose: () => void;
}

/** Where each island sits. Exported because the pin layer and any measuring
 *  script must agree with the scene rather than re-deriving it. */
export function chainPositions(count: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let z = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      z += CHAIN.spacing;
      // The gap lands BEFORE the first island of a chapter, so a boundary is
      // read as the space you cross to reach the next stage rather than as a
      // trailing margin on the last one.
      if (i % CHAIN.chapterEvery === 0) z += CHAIN.chapterGap;
    }
    out.push(new THREE.Vector3(Math.sin(i * 0.72) * CHAIN.swing, 0, -z));
  }
  return out;
}

export function createJourneyScene(): JourneyScene {
  const scene = new THREE.Scene();
  const positions = chainPositions(JOURNEY_LEVELS.length);
  const pinPositions = positions.map((v) => v.clone().setY(PIN_ANCHOR_Y));
  const chainEnd = Math.abs(positions[positions.length - 1].z);

  // --- atmosphere -----------------------------------------------------------
  // The garden's sky and fog, not the equipped theme's: this screen shows all
  // six themes at once, so keying the atmosphere to whichever one the player
  // happens to own would leave five of them under the wrong sky. Same call
  // `menuScene` makes for its own vignette and for the same reason.
  const pal = getMazeTheme("garden").palette;
  scene.background = new THREE.Color(pal.bg);
  scene.fog = new THREE.Fog(0x8fc3e8, 26, 96);

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiIntensity);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(pal.sunColor, pal.sunIntensity);
  key.position.set(6, 20, 10);
  scene.add(key);

  // --- the ocean ------------------------------------------------------------
  const sea: JourneySea = makeJourneySea(
    positions.map((v, i) => ({
      position: v,
      radius: ISLAND_PARAMS.radius,
      tint: getMazeTheme(JOURNEY_LEVELS[i].themeId).palette.bg,
    })),
    45,
    -chainEnd - 45,
  );
  scene.add(sea.group);

  // --- the islands ----------------------------------------------------------
  const caches = makeMadboxCaches();
  const islands = JOURNEY_LEVELS.map((level, i) => {
    const isl = makeJourneyIsland(level, i, undefined, "signature");
    isl.group.position.copy(positions[i]);
    applyMadboxStyle(isl.group, MADBOX_BOUNCE, caches);
    scene.add(isl.group);
    return isl;
  });

  // --- the weather ----------------------------------------------------------
  // One bank per CHAPTER, because that is what unlocks. See journeyClouds.ts
  // for why they shroud rather than hide.
  const clouds: JourneyClouds = makeJourneyClouds(
    JOURNEY_CHAPTERS.map((ch) => ({
      from: ch.from,
      zFrom: positions[ch.from].z,
      zTo: positions[Math.min(ch.from + ch.count - 1, positions.length - 1)].z,
    })),
  );
  scene.add(clouds.group);

  // --- the camera -----------------------------------------------------------
  const focusPoints: FocusPoint[] = deriveFocusPoints(
    positions,
    JOURNEY_LEVELS.map((_, i) => `l${i}`),
  );

  const tapHandlers: Array<() => void> = [];
  let rig: JourneyCameraHandle | null = null;
  // Kept across activate/deactivate so reopening the map does not jump back to
  // the start of the chain, and so `resize` before the first `activate` is not
  // a crash. The camera the renderer is handed must also be stable — game.ts
  // reads `.camera` once per frame.
  let lastSize: [number, number] = [1, 1];
  let pan = 0;

  const placeholder = new THREE.PerspectiveCamera(42, 1, 0.5, JOURNEY_CAMERA.far);

  function activate(dom: HTMLElement): void {
    if (rig) return;
    rig = attachJourneyCamera(dom, {
      chain: positions,
      onTap: () => {
        for (const h of tapHandlers) h();
      },
    });
    rig.resize(lastSize[0], lastSize[1]);
    rig.frame(pan);
  }

  function deactivate(): void {
    if (!rig) return;
    // Remember where the player left the map. `frame()` re-centres on this z,
    // so storing the framed point rather than the camera's own position keeps
    // the round trip exact.
    rig.detach();
    rig = null;
  }

  const seaCenter = new THREE.Vector2();
  // How far ahead of the camera the middle of the frame lands on the water, so
  // the sea gradient's bright centre sits where the player is looking rather
  // than under the camera's feet. Same arithmetic `frame()` uses.
  const SEA_LOOK_AHEAD = JOURNEY_CAMERA.baseHeight / Math.tan(-JOURNEY_CAMERA.basePitch);

  const api: JourneyScene = {
    scene,
    get camera(): THREE.PerspectiveCamera {
      return rig?.camera ?? placeholder;
    },
    update(dt, elapsedMs) {
      rig?.update(dt);
      clouds.update(dt);
      const cam = rig?.camera ?? placeholder;
      seaCenter.set(cam.position.x, cam.position.z - SEA_LOOK_AHEAD);
      updateJourneyWater(sea.animated, elapsedMs, seaCenter);
    },
    resize(width, height) {
      lastSize = [width, height];
      rig?.resize(width, height);
      placeholder.aspect = width / Math.max(1, height);
      placeholder.updateProjectionMatrix();
    },
    activate,
    deactivate,
    project(i) {
      return (
        rig?.project(pinPositions[i]) ?? { x: 0, y: 0, onScreen: false, distance: Infinity }
      );
    },
    focus(i) {
      rig?.focus(i === null ? null : focusPoints[i]);
    },
    frameLevel(i) {
      pan = positions[Math.max(0, Math.min(positions.length - 1, i))].z;
      rig?.frame(pan);
    },
    isDragging() {
      return rig?.isDragging() ?? false;
    },
    onTap(fn) {
      tapHandlers.push(fn);
    },
    setProgress(progress) {
      clouds.setProgress(progress);
    },
    dispose() {
      deactivate();
      scene.remove(clouds.group);
      clouds.dispose();
      for (const isl of islands) {
        scene.remove(isl.group);
        isl.dispose();
      }
      scene.remove(sea.group);
      sea.dispose();
      for (const m of caches.matcap.values()) {
        m.matcap?.dispose();
        m.dispose();
      }
      for (const m of caches.deck.values()) {
        m.map?.dispose();
        m.dispose();
      }
      // The tint materials themselves live in a WeakMap keyed by their source
      // and go with the meshes that hold them; their shared TEXTURE does not,
      // so it is freed here with the rest of this scene's caches.
      for (const t of caches.tintTex.values()) t.dispose();
      caches.tintTex.clear();
      tapHandlers.length = 0;
    },
  };

  return api;
}
