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

import { ICON, setGlyph } from "./icons";

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
  /** IDEA-046: a power-up was collected. */
  powerup(): void;
  /** IDEA-046: a shield absorbed a hit that would have been a death. */
  shieldBreak(): void;
  /** IDEA-018: bonus life granted (maze pickup, points milestone, or perfect
   *  fright) — a distinct, happy ascending 3-note jingle, brighter/longer
   *  than coin()'s ching so it unmistakably reads as a "1-UP" moment. */
  extraLife(): void;
  frightStart(): void;
  eatGhost(chainIndex: number): void;
  death(): void;
  levelClear(): void;
  readyGo(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  resume(): void;
  /** Design system §10: the INTERFACE sound layer, under the game layer. */
  ui: UiSound;
}

/**
 * §10 Sound cues — the interface layer.
 *
 * Separate from the cues above because it answers to a different question.
 * The game cues describe what happened in the MAZE; these describe what
 * happened in the INTERFACE, and the design system asks for two things that
 * only make sense once they are grouped:
 *
 *   1. ONE VOICE. "Short wooden tap … same sample everywhere, so the
 *      interface has one voice." Every pressable thing in the game makes the
 *      same noise, and selecting something makes that same noise a fourth
 *      higher — because selection is a lighter act than committing. That is
 *      why press/select are one cue with a pitch argument rather than two
 *      independently-tuned sounds that would drift apart.
 *
 *   2. THEY DUCK. Interface cues drop 6 dB while a run is in progress, so a
 *      menu tap can never mask a chomp or a death. `setRunActive` is the one
 *      switch, and it moves a single gain node the whole layer routes
 *      through — no per-cue bookkeeping.
 *
 * Levels are the design's own, in dB, converted once in DB below.
 */
export interface UiSound {
  /** Any button. The interface's single voice. */
  press(): void;
  /** A tab or a card — the same tap, pitched up a fourth. */
  select(): void;
  /** Coins left the wallet. */
  purchase(): void;
  /** A skin or theme went on. The one place the dog itself answers you. */
  equip(): void;
  /** A challenge level flipped from grey to green. */
  unlocked(): void;
  /** Rejected — a low double thud, never a buzzer. */
  error(): void;
  /** A full-screen page opened or closed, under the hedge wipe. */
  screen(): void;
  /** Birds and distant traffic under the menu. Silent during a run. */
  menuBed(on: boolean): void;
  /** Duck the whole interface layer while a run is in progress. */
  setRunActive(active: boolean): void;
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

  function powerup(): void {
    // A four-note rising arpeggio on a triangle. Deliberately the LONGEST and
    // most "arrival"-shaped cue in the game after extraLife(): a power-up
    // changes the rules for a while, so it should land like an event rather
    // than like another pickup blip. Triangle rather than the sine everything
    // else uses, so it is a different TIMBRE and not just a different tune —
    // which is what survives being heard over the engine's other cues.
    playSequence([
      { type: "triangle", freq: 523, duration: 0.09, peak: 0.2, attack: 0.004 },
      { type: "triangle", freq: 659, duration: 0.09, peak: 0.21, attack: 0.004, delay: 0.07 },
      { type: "triangle", freq: 784, duration: 0.09, peak: 0.22, attack: 0.004, delay: 0.14 },
      { type: "triangle", freq: 1046, duration: 0.26, peak: 0.24, attack: 0.004, delay: 0.21 },
    ]);
  }

  function shieldBreak(): void {
    // A hit you SURVIVED. The hard part is that this must not be mistaken for
    // death() — the player has a fraction of a second to understand they are
    // still alive and still running. So it is short, and it rises where
    // death() falls: a bright clang, then a quick lift.
    playSequence([
      { type: "square", freq: 300, duration: 0.06, peak: 0.2, attack: 0.001 },
      { type: "sine", freq: 880, duration: 0.16, endFreq: 1320, peak: 0.2, attack: 0.004, delay: 0.05 },
    ]);
  }

  function extraLife(): void {
    // Unmistakably "1-UP": a happy 3-note ascending arpeggio, brighter and a
    // touch longer than coin()'s two-note ching (and lower-pitched than its
    // second note, so it doesn't just read as "coin but bigger") — a
    // milestone worth pausing for, not just another pickup blip.
    playSequence([
      { type: "sine", freq: 660, duration: 0.11, peak: 0.2, attack: 0.004 },
      { type: "sine", freq: 880, duration: 0.11, peak: 0.22, attack: 0.004, delay: 0.09 },
      { type: "sine", freq: 1320, duration: 0.22, peak: 0.24, attack: 0.004, delay: 0.18 },
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

  // ---- §10: the interface sound layer --------------------------------------
  //
  // Everything below routes through `uiBus` rather than straight to `master`,
  // which is what makes the 6 dB duck one assignment instead of a peak
  // adjustment on every cue. uiBus -> master means mute still wins over all of
  // it, unchanged.
  const uiBus = ctx.createGain();
  uiBus.gain.value = 1;
  uiBus.connect(master);

  /** The design's levels, as linear gains. 10^(dB/20). */
  const DB = {
    press: 0.251, // -12
    select: 0.158, // -16
    purchase: 0.398, // -8
    equip: 0.398, // -8
    unlocked: 0.501, // -6
    error: 0.316, // -10
    screen: 0.126, // -18
    bed: 0.063, // -24
  } as const;

  /** How far the interface layer drops while a run is on. -6 dB. */
  const DUCK = 0.501;

  /**
   * One shot of filtered white noise — the ingredient every non-musical cue
   * here is made of (the wooden tap's body, the leaf rustle, the tin, the
   * traffic bed).
   *
   * The buffer is built once and reused: a fresh Float32Array per tap would
   * allocate on the most frequent event in the interface.
   */
  let noiseBuffer: AudioBuffer | null = null;
  function getNoise(): AudioBuffer {
    if (noiseBuffer) return noiseBuffer;
    const frames = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  }

  interface NoiseOpts {
    duration: number;
    peak: number;
    /** Bandpass centre (Hz). */
    freq: number;
    /** Sweep the centre to here over the duration; omit to hold. */
    endFreq?: number;
    q?: number;
    delay?: number;
    type?: BiquadFilterType;
    destination?: AudioNode;
  }

  function playNoise(opts: NoiseOpts): void {
    const {
      duration,
      peak,
      freq,
      endFreq,
      q = 1,
      delay = 0,
      type = "bandpass",
      destination = uiBus,
    } = opts;
    const t0 = ctx.currentTime + Math.max(delay, 0);

    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    // A random start offset stops repeated taps sounding like the same
    // waveform replayed, which is audible on a cue fired several times a
    // second.
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(Math.max(freq, 20), t0);
    if (endFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), t0 + duration);
    }
    filter.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.006, duration * 0.4));
    env.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 0.0001), t0 + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(destination);
    src.start(t0, Math.random() * 1.0);
    src.stop(t0 + duration + 0.02);
  }

  /**
   * THE tap. A short wooden knock: a low body tone plus a noise transient,
   * both gone in 60ms.
   *
   * `ratio` is the only thing that varies between press and select — 1 for a
   * press, 4/3 for a select (a fourth up). Two cues, one sound.
   */
  function tap(level: number, ratio: number): void {
    playTone({
      type: "triangle",
      freq: 190 * ratio,
      endFreq: 120 * ratio,
      duration: 0.06,
      peak: level,
      attack: 0.002,
    });
    // The knock itself. Without it the tone alone reads as a musical note
    // rather than as wood being struck.
    playNoise({ duration: 0.035, peak: level * 0.55, freq: 1500 * ratio, q: 0.7 });
  }

  // The menu bed's nodes, held so it can be stopped. Built lazily — a player
  // who never reaches the menu never allocates them.
  let bedTraffic: AudioBufferSourceNode | null = null;
  let bedGain: GainNode | null = null;
  let bedBirdTimer: ReturnType<typeof setTimeout> | null = null;

  function stopBed(): void {
    if (bedBirdTimer !== null) {
      clearTimeout(bedBirdTimer);
      bedBirdTimer = null;
    }
    if (bedGain) {
      // Fade rather than cut: a noise bed stopped hard is a click.
      const t = ctx.currentTime;
      bedGain.gain.cancelScheduledValues(t);
      bedGain.gain.setValueAtTime(bedGain.gain.value, t);
      bedGain.gain.linearRampToValueAtTime(0.0001, t + 0.35);
    }
    if (bedTraffic) {
      bedTraffic.stop(ctx.currentTime + 0.4);
      bedTraffic = null;
    }
    bedGain = null;
  }

  /** One bird: two or three short whistles a semitone or two apart. */
  function chirp(): void {
    if (!bedGain) return;
    const base = 2200 + Math.random() * 900;
    const notes = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < notes; i++) {
      playTone({
        type: "sine",
        freq: base * (1 + i * 0.06),
        endFreq: base * (1 + i * 0.06) * 1.25,
        duration: 0.05,
        peak: DB.bed * 1.6,
        attack: 0.006,
        delay: i * 0.075,
      });
    }
  }

  function scheduleBird(): void {
    // Irregular on purpose — birds on a timer read as a machine.
    bedBirdTimer = setTimeout(
      () => {
        if (!bedGain) return;
        chirp();
        scheduleBird();
      },
      1800 + Math.random() * 4200,
    );
  }

  function startBed(): void {
    if (bedGain) return;
    bedGain = ctx.createGain();
    bedGain.gain.value = 0.0001;
    bedGain.connect(uiBus);
    // Distant traffic: heavily low-passed noise, well under everything else.
    // It is not meant to be identifiable, only to stop the menu sounding like
    // a muted television.
    bedTraffic = ctx.createBufferSource();
    bedTraffic.buffer = getNoise();
    bedTraffic.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    lp.Q.value = 0.5;
    bedTraffic.connect(lp);
    lp.connect(bedGain);
    bedTraffic.start();
    bedGain.gain.linearRampToValueAtTime(DB.bed, ctx.currentTime + 1.2);
    scheduleBird();
  }

  const ui: UiSound = {
    press(): void {
      tap(DB.press, 1);
    },

    select(): void {
      tap(DB.select, 4 / 3);
    },

    purchase(): void {
      // A coin dropped into a tin: the bright ching the maze already uses for
      // a coin, then the dull ring of the container it lands in. Two halves,
      // because "money left the wallet" should not sound the same as "money
      // arrived".
      playSequence([
        { type: "sine", freq: 1380, duration: 0.06, peak: DB.purchase * 0.5, attack: 0.002 },
        {
          type: "sine",
          freq: 980,
          duration: 0.09,
          peak: DB.purchase * 0.45,
          attack: 0.002,
          delay: 0.04,
        },
      ]);
      playNoise({
        duration: 0.22,
        peak: DB.purchase * 0.35,
        freq: 700,
        endFreq: 260,
        q: 4,
        delay: 0.06,
      });
    },

    equip(): void {
      // A single bark. Two descending bursts through a formant-ish bandpass:
      // the fast pitch drop is what makes a short noise read as a voice rather
      // than as a thud.
      playTone({
        type: "sawtooth",
        freq: 420,
        endFreq: 190,
        duration: 0.09,
        peak: DB.equip * 0.55,
        attack: 0.004,
      });
      playNoise({ duration: 0.11, peak: DB.equip * 0.4, freq: 1100, endFreq: 520, q: 2.2 });
    },

    unlocked(): void {
      // Three notes rising, timed to land with the stone flipping grey to
      // green.
      playSequence([
        { type: "triangle", freq: 587, duration: 0.1, peak: DB.unlocked * 0.5, attack: 0.004 },
        {
          type: "triangle",
          freq: 740,
          duration: 0.1,
          peak: DB.unlocked * 0.52,
          attack: 0.004,
          delay: 0.1,
        },
        {
          type: "triangle",
          freq: 880,
          duration: 0.3,
          peak: DB.unlocked * 0.55,
          attack: 0.004,
          delay: 0.2,
        },
      ]);
    },

    error(): void {
      // A low double thud with NO musical pitch — the design is explicit that
      // this is never a harsh buzzer. Noise, not a tone, so there is nothing
      // to hear as a wrong note.
      playNoise({ duration: 0.09, peak: DB.error * 0.6, freq: 150, q: 1.4 });
      playNoise({ duration: 0.11, peak: DB.error * 0.5, freq: 120, q: 1.4, delay: 0.11 });
    },

    screen(): void {
      // Leaf rustle, under the hedge wipe. A high band sweeping down as the
      // band crosses the frame; quiet enough (-18 dB) to be felt rather than
      // heard.
      playNoise({ duration: 0.3, peak: DB.screen, freq: 4200, endFreq: 1400, q: 0.8 });
    },

    menuBed(on: boolean): void {
      if (on) startBed();
      else stopBed();
    },

    setRunActive(active: boolean): void {
      const t = ctx.currentTime;
      uiBus.gain.cancelScheduledValues(t);
      uiBus.gain.setValueAtTime(uiBus.gain.value, t);
      uiBus.gain.linearRampToValueAtTime(active ? DUCK : 1, t + 0.12);
    },
  };

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
    powerup,
    shieldBreak,
    extraLife,
    frightStart,
    eatGhost,
    death,
    levelClear,
    readyGo,
    setMuted,
    isMuted,
    resume,
    ui,
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
// Material Symbols ligatures, not emoji: the speaker emoji rendered in three
// different styles across iOS/Android/Chrome and carried its own colour, so it
// could never take part in the ink-outline language the rest of the chrome
// uses. See src/ui/icons.ts.
const MUTED_ICON = ICON.soundOff;
const UNMUTED_ICON = ICON.soundOn;

/**
 * Wires the HUD's mute button (`#muteBtn` in index.html) to `sound`: reflects
 * the persisted mute state on load, toggles it (+ calls `sound.resume()`) on
 * click, and keeps the icon/aria-pressed in sync. Call once from
 * Game's constructor. Returns a detach function for symmetry with
 * attachKeyboard/attachTouch, even though the button's lifetime currently
 * matches the whole app (no teardown call site needed yet).
 */
export function attachMuteButton(root: ParentNode, sound: Sound): () => void {
  // EVERY .mute-btn on the page, not just #muteBtn.
  //
  // The screen redesign gave the main menu its own sound control (the in-run
  // one lives in the HUD chrome, which the menu hides), and there is exactly
  // one mute STATE — so the honest wiring is one handler over both buttons
  // with a shared render, not two attachments that could disagree about
  // whether sound is off.
  const scope: ParentNode = root ?? document;
  const found = [
    ...scope.querySelectorAll<HTMLButtonElement>(".mute-btn"),
    ...(scope === document ? [] : document.querySelectorAll<HTMLButtonElement>(".mute-btn")),
  ];
  const buttons = [...new Set(found)];
  if (buttons.length === 0) {
    throw new Error("attachMuteButton: no .mute-btn found — check index.html");
  }

  function render(): void {
    const muted = sound.isMuted();
    for (const btn of buttons) {
      // Writes into the inner <i>, creating it if the markup lacks one — see
      // setGlyph. Setting textContent on the BUTTON would delete the icon
      // element and print the ligature name.
      setGlyph(btn, muted ? MUTED_ICON : UNMUTED_ICON);
      btn.setAttribute("aria-pressed", String(muted));
      btn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    }
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
  for (const btn of buttons) btn.addEventListener("click", onClick);

  return () => {
    for (const btn of buttons) btn.removeEventListener("click", onClick);
  };
}

// ---------------------------------------------------------------------------
// §10: the interface's one voice, wired once.
//
// The design system asks for "the same tap everywhere, so the interface has
// one voice". The way to actually get that is a single delegated listener,
// not a call at each of the ~40 places a button is created — one of those
// would inevitably be missed, and a silent button in an otherwise-clicky
// interface reads as a broken button.
//
// `pointerdown`, not `click`: the sound has to land when the finger lands,
// which is also the frame the button's own press animation starts. Waiting
// for a full press-and-release puts the sound after the picture.

/** Things that SELECT rather than commit — they take the tap a fourth up.
 *  A tab, a card, a dot and a trail stone are all "show me that one", which
 *  the design calls "a lighter act than committing". */
const SELECT_SELECTOR = [
  ".shop-tab",
  ".lb-tab",
  ".auth-tab",
  ".shop-rail-card",
  ".carousel-item",
  ".tut-dot",
  ".map-node",
  ".control-option",
  ".dpad-btn",
].join(",");

/** Anything that makes the interface's noise at all. Buttons plus the SVG
 *  trail stones, which are <g role="button"> rather than real elements. */
const PRESSABLE_SELECTOR = `button,${SELECT_SELECTOR}`;

/**
 * Give every control in the app its press sound.
 *
 * Call once from Game's constructor, alongside attachMuteButton. Returns a
 * detach function for symmetry with the other attach* helpers.
 */
export function attachUiSounds(sound: Sound): () => void {
  function onPointerDown(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const hit = target.closest(PRESSABLE_SELECTOR);
    if (!hit) return;

    // A disabled control gives no feedback — a sound would say "that worked".
    // The D-pad is exempt from the aria check below only because it has none;
    // `closest` on a disabled <button> is enough for everything else.
    if (hit instanceof HTMLButtonElement && hit.disabled) return;
    if (hit.getAttribute("aria-disabled") === "true") return;

    // A press is a user gesture, so it is also a valid place to unlock audio —
    // and on the very first tap of a session it is usually the FIRST one.
    sound.resume();

    if (hit.matches(SELECT_SELECTOR)) sound.ui.select();
    else sound.ui.press();
  }

  // Capture phase: a handler that stops propagation (the D-pad calls
  // preventDefault and the shop cards re-render themselves out of the DOM on
  // click) must not be able to swallow the interface's own feedback.
  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () =>
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
}
