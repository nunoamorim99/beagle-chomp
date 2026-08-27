// OWNER: character editor (IDEA-025, dev-only).
// The animation timeline: play / pause / step / scrub the character's REAL
// animation, with one track row per channel the animation actually drives.
//
// Adapted from the three.js editor's Sidebar.Animation.js (MIT —
// mrdoob/three.js). The transport, the 150px label gutter, the playhead and
// the per-channel track colours are theirs. Everything behind the UI is not,
// because THIS PROJECT HAS NO ANIMATION CLIPS.
//
// The reference panel browses `AnimationClip`s off an imported glTF and
// scrubs them through an `AnimationMixer`. Our characters are built from
// primitives in code and animated PROCEDURALLY every frame by the real game
// functions (`syncToEntity` / `applyGhostState` — see registry.ts). There is
// no clip to list, no keyframe track to draw diamonds from, and no mixer to
// set `.time` on.
//
// So the two halves are rebuilt against what we do have:
//
//   * TIME is accumulated `dt` fed to the real animate() call. Scrubbing to
//     t means "restore the authored pose, then replay the animation from 0
//     to t" — replaying forward from wherever we already are when that is
//     cheaper. This is what makes the scrub honest: every frame you look at
//     was produced by the code that ships, not by an interpolation of it.
//
//   * TRACKS are DISCOVERED by sampling. We step the cycle, record every
//     part's position/rotation/scale, and a channel earns a row if it
//     actually moves. That answers a question the reference panel cannot
//     even ask of us: "which parts does the runtime own?" — the exact
//     question behind IDEA-041, and behind the shipped bug where the bee's
//     stripes fell through the floor every game while the editor sat there
//     showing them glued on, because nothing here ever ran the animation.
import * as THREE from "three";
import { type PartNode } from "./partTree";

/** The window the timeline shows, in seconds. Long enough to contain a full
 *  walk cycle and a slow idle breath at the speeds config.ts uses. */
export const CYCLE_SECONDS = 2;

/** How many samples the track scan takes across the cycle. 60 is one per
 *  frame at 60fps — finer than that tells you nothing new about a curve
 *  this smooth, and each sample costs a full replay step. */
const SAMPLES = 60;

/** Replay step. Matches the game's own frame budget, so the animation sees
 *  the size of dt it was tuned against rather than one huge jump. */
const STEP = 1 / 60;

/** Below this a channel counts as still. Generous enough to ignore float
 *  drift, tight enough to catch a subtle ear bob. */
const MOVED_EPS = 1e-4;

export type TrackChannel = "position" | "rotation" | "scale";

/** §6's palette, kept verbatim — these colours are a convention worth
 *  matching for anyone who has used the three.js editor. */
const CHANNEL_COLOR: Record<TrackChannel, string> = {
  position: "#4CAF50",
  rotation: "#2196F3",
  scale: "#FF9800",
};

export interface Track {
  varName: string;
  channel: TrackChannel;
  /** Normalised 0..1 window over the cycle where this channel is moving. */
  from: number;
  to: number;
  /** Peak absolute deviation from the channel's resting value — drives the
   *  bar's opacity so a 2° ear waggle reads differently from a full stride. */
  amplitude: number;
}

export interface TimelineHost {
  /** Restores the authored pose and clears any accumulated animation phase.
   *  main.ts routes this to the same setAnimation("off") path the GUI uses. */
  reset(): void;
  /** Advances the REAL game animation by dt. */
  step(dt: number): void;
  /** The parts to watch. */
  nodes(): PartNode[];
  /** False when the preview is "off" — nothing to scrub. */
  isAnimating(): boolean;
}

export interface Timeline {
  /** Re-scans the tracks. Call on character switch / animation-mode change. */
  rebuild(): void;
  /** Per frame. Advances playback and repaints the playhead. */
  update(dt: number): void;
  dispose(): void;
}

function channelValue(o: THREE.Object3D, channel: TrackChannel): [number, number, number] {
  const v = channel === "position" ? o.position : channel === "rotation" ? o.rotation : o.scale;
  return [v.x, v.y, v.z];
}

export function createTimeline(root: HTMLElement, host: TimelineHost): Timeline {
  let time = 0;
  let playing = false;
  let tracks: Track[] = [];

  // --- DOM ---------------------------------------------------------------
  root.textContent = "";
  const transport = document.createElement("div");
  transport.className = "tl-transport";

  function button(label: string, title: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tl-btn";
    b.textContent = label;
    b.title = title;
    transport.appendChild(b);
    return b;
  }

  const playBtn = button("▶", "Play / pause the real game animation");
  const stopBtn = button("■", "Stop and restore the authored pose");
  const stepBackBtn = button("◀|", "Step back one frame");
  const stepFwdBtn = button("|▶", "Step forward one frame");

  const readout = document.createElement("span");
  readout.className = "tl-readout";
  transport.appendChild(readout);

  const hint = document.createElement("span");
  hint.className = "tl-hint";
  transport.appendChild(hint);

  const scrub = document.createElement("input");
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "1000";
  scrub.value = "0";
  scrub.className = "tl-scrub";

  const trackList = document.createElement("div");
  trackList.className = "tl-tracks";

  root.append(transport, scrub, trackList);

  // --- time --------------------------------------------------------------

  /**
   * Puts the character at `t` seconds into the cycle.
   *
   * Forward from where we already are when possible — a procedural animation
   * accumulates phase, so replaying from 0 on every scrub frame would cost
   * 120 animate() calls per pointer move. Going BACKWARDS has no shortcut:
   * the phase only runs one way, so it resets and replays.
   */
  function seek(t: number): void {
    const target = Math.max(0, Math.min(t, CYCLE_SECONDS));
    if (target < time) {
      host.reset();
      time = 0;
    }
    let guard = 0;
    while (time < target - STEP / 2 && guard++ < SAMPLES * 4) {
      const dt = Math.min(STEP, target - time);
      host.step(dt);
      time += dt;
    }
    time = target;
    paint();
  }

  function paint(): void {
    scrub.value = String(Math.round((time / CYCLE_SECONDS) * 1000));
    readout.textContent = `${time.toFixed(2)}s / ${CYCLE_SECONDS.toFixed(2)}s`;
    playBtn.textContent = playing ? "❚❚" : "▶";
    // Unitless 0..1 — the stylesheet multiplies it inside a calc(), which a
    // percentage cannot be.
    trackList.style.setProperty("--tl-playhead", (time / CYCLE_SECONDS).toFixed(4));
  }

  // --- track discovery ---------------------------------------------------

  /**
   * Steps the whole cycle once, recording every part's transform at each
   * sample, then keeps the channels that actually moved.
   *
   * This LEAVES the character at t=0 (authored pose) rather than wherever
   * the scan finished — a scan is a measurement, and it must not be visible
   * as a jump in the viewport.
   */
  function scanTracks(): Track[] {
    const nodes = host.nodes().filter((n) => n.path !== "");
    if (nodes.length === 0 || !host.isAnimating()) return [];

    const channels: TrackChannel[] = ["position", "rotation", "scale"];
    // samples[sampleIndex][nodeIndex][channelIndex] = xyz
    const samples: Array<Array<Record<TrackChannel, [number, number, number]>>> = [];

    host.reset();
    time = 0;
    for (let s = 0; s < SAMPLES; s++) {
      const frame = nodes.map((n) => ({
        position: channelValue(n.object, "position"),
        rotation: channelValue(n.object, "rotation"),
        scale: channelValue(n.object, "scale"),
      }));
      samples.push(frame);
      host.step(CYCLE_SECONDS / SAMPLES);
    }
    host.reset();
    time = 0;

    const found: Track[] = [];
    nodes.forEach((node, ni) => {
      for (const channel of channels) {
        const base = samples[0][ni][channel];
        let first = -1;
        let last = -1;
        let amplitude = 0;
        for (let s = 0; s < SAMPLES; s++) {
          const v = samples[s][ni][channel];
          const d = Math.max(
            Math.abs(v[0] - base[0]),
            Math.abs(v[1] - base[1]),
            Math.abs(v[2] - base[2]),
          );
          if (d > MOVED_EPS) {
            if (first === -1) first = s;
            last = s;
            amplitude = Math.max(amplitude, d);
          }
        }
        if (first === -1) continue;
        found.push({
          varName: node.varName,
          channel,
          from: first / (SAMPLES - 1),
          to: last / (SAMPLES - 1),
          amplitude,
        });
      }
    });
    // Busiest first — the parts carrying the animation are what you came to
    // look at, and a 40-row list sorted by tree order buries them.
    return found.sort((a, b) => b.amplitude - a.amplitude);
  }

  function drawTracks(): void {
    trackList.textContent = "";
    if (!host.isAnimating()) {
      hint.textContent = "preview is off — pick idle or walk to scrub";
      return;
    }
    hint.textContent =
      tracks.length === 0
        ? "this animation moves nothing on this character"
        : `${tracks.length} animated channels — these are the ones the RUNTIME owns`;

    const peak = tracks.reduce((m, t) => Math.max(m, t.amplitude), 0) || 1;
    for (const track of tracks) {
      const row = document.createElement("div");
      row.className = "tl-track";

      const label = document.createElement("span");
      label.className = "tl-track-label";
      label.textContent = `${track.varName}.${track.channel}`;
      label.title = `peak Δ ${track.amplitude.toFixed(4)}`;

      const lane = document.createElement("span");
      lane.className = "tl-lane";
      const bar = document.createElement("span");
      bar.className = "tl-bar";
      bar.style.left = `${track.from * 100}%`;
      bar.style.width = `${Math.max((track.to - track.from) * 100, 1.5)}%`;
      bar.style.background = CHANNEL_COLOR[track.channel];
      // Amplitude as opacity: a hard-working channel reads solid, a subtle
      // one reads faint, without a second axis or a number to decode.
      bar.style.opacity = String(0.35 + 0.65 * (track.amplitude / peak));
      lane.appendChild(bar);

      row.append(label, lane);
      trackList.appendChild(row);
    }
  }

  // --- events ------------------------------------------------------------
  playBtn.addEventListener("click", () => {
    if (!host.isAnimating()) return;
    playing = !playing;
    paint();
  });
  stopBtn.addEventListener("click", () => {
    playing = false;
    host.reset();
    time = 0;
    paint();
  });
  stepFwdBtn.addEventListener("click", () => {
    playing = false;
    seek(time + STEP);
  });
  stepBackBtn.addEventListener("click", () => {
    playing = false;
    seek(time - STEP);
  });
  scrub.addEventListener("input", () => {
    playing = false;
    seek((Number(scrub.value) / 1000) * CYCLE_SECONDS);
  });

  paint();

  return {
    rebuild(): void {
      playing = false;
      tracks = scanTracks();
      drawTracks();
      paint();
    },
    update(dt: number): void {
      if (!playing || !host.isAnimating()) return;
      // Wrap rather than stop: the cycle is a loop, and a scrubber that
      // halts at the right-hand edge makes a looping walk look broken.
      if (time + dt >= CYCLE_SECONDS) {
        host.reset();
        time = 0;
      } else {
        host.step(dt);
        time += dt;
      }
      paint();
    },
    dispose(): void {
      playing = false;
      root.textContent = "";
    },
  };
}
