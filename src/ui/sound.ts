// OWNER: pwa-mobile-engineer (M7 audio)
// Procedural retro sound effects via the Web Audio API — no audio files, no
// fetch, nothing to precache. Every cue below is synthesized on the fly with
// OscillatorNodes + short GainNode envelopes, exactly the "juice" role that
// src/render/effects.ts plays visually, just for the ears. game.ts calls
// these at the same event points it already calls effects.* (see game.ts's
// eatAt/triggerFright/checkCollisions/beagleDies/levelClear).
//
// Contract: createSound() -> Sound (see interface below). Browser-only
// (Web Audio + localStorage) — does NOT import three or any src/game/* /
// src/render/* module, matching the "src/ui/* stays DOM/browser-only" split
// CLAUDE.md draws for src/input/touch.ts and src/ui/install.ts.
//
// Autoplay policy: every AudioContext starts (or can start) "suspended" until
// a user gesture. resume() is idempotent and safe to call from any gesture
// handler (Start click, first keydown/pointerdown, the mute button) — see
// game.ts's wiring. Nothing here throws if resume() is called before/after
// the context is already running, or many times over.

const MUTE_STORAGE_KEY = "bc_muted";

// ---------------------------------------------------------------------------
// localStorage persistence for the mute *preference* only. This is UI config,
// not core game state (CLAUDE.md's "no localStorage assumptions" rule is
// about score/lives/level etc.), so persisting it is the documented
// exception — but it must degrade gracefully: wrap every access in try/catch
// and fall back to "unmuted, in-memory only for this session" if storage
// throws (private browsing, quota, disabled storage, SSR-ish environments).

function readStoredMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false; // storage unavailable — default unmuted, in-memory only
  }
}

function writeStoredMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable/throwing — keep the setting in memory for this
       session only; nothing else to do, and this must never throw upward */
  }
}

// ---------------------------------------------------------------------------
// Small synthesis helpers. Every sound is one-shot: create oscillator(s) +
// gain node(s), schedule a short attack/release envelope so the gain is never
// snapped to/from full amplitude (which is what causes audible clicks/pops),
// then schedule `.stop()` on the oscillator so nodes never accumulate.

type OscType = OscillatorType;

interface ToneOpts {
  /** Oscillator waveform. */
  type?: OscType;
  /** Start frequency (Hz). */
  freq: number;
  /** End frequency (Hz); omit for a flat tone. */
  endFreq?: number;
  /** Total duration (s). */
  duration: number;
  /** Peak gain (0-1) reached at the end of the attack. */
  peak: number;
  /** Attack time (s) — time to ramp 0 -> peak. Kept short to avoid clicks. */
  attack?: number;
  /** When to start, in seconds from "now" (ctx.currentTime). */
  delay?: number;
}

export interface Sound {
  biscuit(): void;
  bone(): void;
  fruit(): void;
  /** IDEA-016/IDEA-017: coin banked/collected — bright metallic "ching",
   *  distinct from fruit()'s sweep and bone()'s square-wave chime. */
  coin(): void;
  frightStart(): void;
  eatGhost(chainIndex: number): void;
  death(): void;
  levelClear(): void;
  readyGo(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  resume(): void;
}

export function createSound(): Sound {
  // Lazily-constructed AudioContext: constructing it doesn't require a user
  // gesture (only *starting playback* does, which is what resume() is for),
  // so building it eagerly here is fine and keeps every method below simple
  // (no "is the context ready" branching scattered through each cue).
  const ctx = new AudioContext();

  // Master gain: every node in this module routes through here, so mute is
  // just "set this one gain to 0" — no per-oscillator cleanup bookkeeping,
  // and no risk of a sound slipping out unmuted because it forgot to check a
  // flag.
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  let muted = readStoredMuted();
  master.gain.value = muted ? 0 : 1;

  // Deterministic-ish per-call pitch wobble for biscuit() so a rapid run of
  // them (once per pellet along a corridor) doesn't read as a single
  // monotonous buzz. A cheap incrementing counter through a short fixed
  // sequence — no Math.random, so behaviour is reproducible, but still
  // varies call to call.
  const BISCUIT_WOBBLE = [0, 1, -1, 2, -2, 1, 0, -1] as const;
  let biscuitTick = 0;

  /** Builds one oscillator -> gain(envelope) -> master chain and schedules it start-to-stop. Never throws even if muted (the master gain being 0 just makes it silent — cheaper than branching per call). */
  function playTone(opts: ToneOpts): void {
    const {
      type = "sine",
      freq,
      endFreq,
      duration,
      peak,
      attack = 0.008,
      delay = 0,
    } = opts;

    const t0 = ctx.currentTime + Math.max(delay, 0);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(freq, 1), t0);
    if (endFreq !== undefined) {
      // Exponential ramps can't target/leave 0, and both endpoints must be
      // positive — clamp defensively so a caller passing a tiny/zero endFreq
      // (shouldn't happen given the constants below, but cheap insurance)
      // never throws a DOMException mid-gameplay.
      osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + duration);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    // Short attack ramp (never jump straight to `peak`) avoids the click a
    // hard-edged step in gain produces; a longer release than attack gives a
    // soft tail instead of a second click at cutoff.
    const attackEnd = t0 + Math.min(attack, duration * 0.5);
    env.gain.linearRampToValueAtTime(peak, attackEnd);
    env.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 0.0001), t0 + duration);

    osc.connect(env);
    env.connect(master);

    osc.start(t0);
    // Stop a hair after the envelope's target time so the exponential ramp's
    // tail isn't truncated; the node is then eligible for GC (Web Audio has
    // no explicit "dispose" — dropping all references after stop() is the
    // normal, leak-free pattern for one-shot oscillators).
    osc.stop(t0 + duration + 0.05);
  }

  /** Two-note (or more) tones fired back-to-back via `delay`, for chime/arpeggio-style cues. */
  function playSequence(notes: ToneOpts[]): void {
    notes.forEach((n) => playTone(n));
  }

  // ---- individual cues -----------------------------------------------------

  function biscuit(): void {
    // Very short, quiet blip. Tiny per-call pitch wobble (deterministic
    // sequence, not random) keeps a rapid corridor-run of these pleasant
    // rather than a machine-gun buzz. Triangle wave reads as a soft "chomp"
    // rather than sine's plainness or square's harshness.
    const wobble = BISCUIT_WOBBLE[biscuitTick % BISCUIT_WOBBLE.length];
    biscuitTick++;
    playTone({
      type: "triangle",
      freq: 520 + wobble * 14,
      endFreq: 340 + wobble * 10,
      duration: 0.06,
      peak: 0.16,
      attack: 0.004,
    });
  }

  function bone(): void {
    // Satisfying power-up chime: a quick two-note upward step, clearly
    // distinct from the biscuit blip (square wave, louder, longer, two
    // discrete notes rather than one blip).
    playSequence([
      { type: "square", freq: 330, duration: 0.11, peak: 0.22, attack: 0.006 },
      { type: "square", freq: 495, duration: 0.16, peak: 0.24, attack: 0.006, delay: 0.09 },
    ]);
  }

  function fruit(): void {
    // Bright pickup: a fast upward sweep on a sine, sitting higher in pitch
    // than bone()'s chime so the two never get confused.
    playTone({
      type: "sine",
      freq: 660,
      endFreq: 990,
      duration: 0.14,
      peak: 0.22,
      attack: 0.005,
    });
  }

  function coin(): void {
    // Bright, short metallic "ching": a quick two-note sine chime pitched
    // higher than fruit()'s sweep and using discrete notes (like bone()) so
    // it's clearly its own cue rather than a variant of either.
    playSequence([
      { type: "sine", freq: 1180, duration: 0.07, peak: 0.16, attack: 0.003 },
      { type: "sine", freq: 1580, duration: 0.11, peak: 0.18, attack: 0.003, delay: 0.05 },
    ]);
  }

  function frightStart(): void {
    // "Ghosts scared" cue: a downward whoop (siren-ish) — sawtooth swept from
    // high to low reads as an alarm/power-shift rather than a pickup.
    playTone({
      type: "sawtooth",
      freq: 720,
      endFreq: 180,
      duration: 0.42,
      peak: 0.18,
      attack: 0.015,
    });
  }

  // Base frequency + per-chain-step multiplier for eatGhost's ascending tone.
  // 2^(chainIndex/3) climbs a little over an octave across the chain-of-4 cap
  // (SCORE.ghostBase doubles per ghost up to index 3 — this mirrors that
  // escalating feel without importing config.ts's score numbers, since the
  // pitch curve is a sound-tuning choice, not shared game balance).
  const EAT_GHOST_BASE_FREQ = 300;

  function eatGhost(chainIndex: number): void {
    const idx = Math.max(chainIndex, 0);
    const freq = EAT_GHOST_BASE_FREQ * Math.pow(2, idx / 3);
    playTone({
      type: "square",
      freq,
      endFreq: freq * 1.7,
      duration: 0.16,
      peak: 0.2,
      attack: 0.004,
    });
  }

  function death(): void {
    // Descending "aww" warble: a slow downward sweep with a touch of
    // vibrato-like waver by chaining two overlapping tones a semitone-ish
    // apart, giving a wobble without a separate LFO node.
    playTone({
      type: "sawtooth",
      freq: 380,
      endFreq: 70,
      duration: 0.65,
      peak: 0.22,
      attack: 0.01,
    });
    playTone({
      type: "sine",
      freq: 360,
      endFreq: 65,
      duration: 0.65,
      peak: 0.12,
      attack: 0.01,
      delay: 0.03,
    });
  }

  function levelClear(): void {
    // Short triumphant ascending arpeggio (four notes, major-ish steps).
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    playSequence(
      notes.map((freq, i) => ({
        type: "square" as const,
        freq,
        duration: 0.16,
        peak: 0.2,
        attack: 0.004,
        delay: i * 0.1,
      })),
    );
  }

  function readyGo(): void {
    // Subtle short blip when play begins — deliberately smaller/quieter than
    // the other cues per the "keep optional ones subtle" guidance.
    playTone({
      type: "sine",
      freq: 440,
      endFreq: 660,
      duration: 0.1,
      peak: 0.14,
      attack: 0.006,
    });
  }

  // ---- mute / resume --------------------------------------------------------

  function setMuted(next: boolean): void {
    muted = next;
    master.gain.value = muted ? 0 : 1;
    writeStoredMuted(muted);
  }

  function isMuted(): boolean {
    return muted;
  }

  function resume(): void {
    // Idempotent + safe to call repeatedly/redundantly: resume() on an
    // already-running context is a documented no-op that resolves
    // immediately, and any rejection (extremely rare — e.g. a context whose
    // page is being torn down) is swallowed rather than surfaced, since
    // audio unlocking must never be able to break a gesture handler that
    // also does real game work (Start click, first input).
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => { /* ignore — best-effort unlock */ });
    }
  }

  return {
    biscuit,
    bone,
    fruit,
    coin,
    frightStart,
    eatGhost,
    death,
    levelClear,
    readyGo,
    setMuted,
    isMuted,
    resume,
  };
}

// ---------------------------------------------------------------------------
// Mute-button DOM wiring. Thin on purpose — just reflects/toggles `sound`'s
// own mute state and calls resume() (tapping the button is itself a user
// gesture, so it doubles as an unlock point). Kept here rather than in
// game.ts so game.ts's constructor stays a couple of lines (construct sound,
// call this) and no DOM/icon logic leaks into the integration layer, mirroring
// how src/ui/install.ts owns its own banner's DOM wiring rather than main.ts.
//
// index.html guarantees #muteBtn exists (same "fail loudly, not silently
// no-op" stance src/ui/hud.ts takes for its own required elements) since a
// missing/renamed button id is a markup bug worth surfacing immediately
// rather than shipping silent audio controls.
const MUTED_ICON = "\u{1F507}"; // 🔇
const UNMUTED_ICON = "\u{1F50A}"; // 🔊

/**
 * Wires the HUD's mute button (`#muteBtn` in index.html) to `sound`: reflects
 * the persisted mute state on load, toggles it (+ calls `sound.resume()`) on
 * click, and keeps the icon/aria-pressed in sync. Call once from
 * Game's constructor. Returns a detach function for symmetry with
 * attachKeyboard/attachTouch, even though the button's lifetime currently
 * matches the whole app (no teardown call site needed yet).
 */
export function attachMuteButton(root: ParentNode, sound: Sound): () => void {
  const btn = (root.querySelector("#muteBtn") ?? document.getElementById("muteBtn")) as HTMLButtonElement | null;
  if (!btn) {
    throw new Error("attachMuteButton: missing #muteBtn — check index.html");
  }

  function render(): void {
    const muted = sound.isMuted();
    btn!.textContent = muted ? MUTED_ICON : UNMUTED_ICON;
    btn!.setAttribute("aria-pressed", String(muted));
    btn!.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }

  function onClick(): void {
    // Tapping the button is a user gesture in its own right, so this is also
    // a valid place to unlock audio (in case Start/first-input somehow never
    // fired — e.g. a player who lands mid-session via some future deep link).
    sound.resume();
    sound.setMuted(!sound.isMuted());
    render();
  }

  render(); // reflect the persisted state immediately on load
  btn.addEventListener("click", onClick);

  return () => btn.removeEventListener("click", onClick);
}
