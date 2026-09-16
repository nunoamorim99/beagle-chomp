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
import { createAmbience, type AmbienceKind } from "./ambience";

export type { AmbienceKind } from "./ambience";

const MUTE_STORAGE_KEY = "bc_muted";
/** IDEA-073: the AMBIENCE bed's own mute, independent of the cues above.
 *  A separate key rather than a shape change to the old one, so an existing
 *  player's mute preference survives the upgrade untouched. */
const BED_MUTE_STORAGE_KEY = "bc_bed_muted";
const SFX_VOL_STORAGE_KEY = "bc_vol_sfx";
const BED_VOL_STORAGE_KEY = "bc_vol_bed";

/** Defaults for the two volume sliders. The bed sits UNDER the cues by
 *  default because that is the mix this game wants — see ambience.ts's rule
 *  about staying out of the chomp's band; the slider is there for a player
 *  whose taste differs, not to make an unbalanced default usable. */
const DEFAULT_SFX_VOLUME = 1;
const DEFAULT_BED_VOLUME = 0.7;

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

/** IDEA-073. Same contract as the pair above, generalized over a key so the
 *  bed's mute and the two volumes do not each grow their own copy of the
 *  try/catch. Every one of these must degrade to "the default, in memory for
 *  this session" rather than throwing. */
function readStoredFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* see writeStoredMuted */
  }
}

/** A 0..1 volume. Anything unparseable, out of range or absent falls back to
 *  `fallback` — a corrupt storage value must never be able to leave a player
 *  with a silent game and no obvious reason why. */
function readStoredVolume(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  } catch {
    return fallback;
  }
}

function writeStoredVolume(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* see writeStoredMuted */
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
  /** Which bus to land on. Defaults to the EFFECTS bus; the ambience bed
   *  passes its own so a bird is silenced by the bed button and not by the
   *  effects one. */
  destination?: AudioNode;
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
  /** EFFECTS mute: the chomp, the death, every interface tap. Keeps its name
   *  and its `bc_muted` key from before IDEA-073 split the two. */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** IDEA-073: the AMBIENCE bed's own mute, independent of the above. */
  setBedMuted(muted: boolean): void;
  isBedMuted(): boolean;
  /** 0..1, persisted. The profile screen's two sliders. */
  setSfxVolume(v: number): void;
  getSfxVolume(): number;
  setBedVolume(v: number): void;
  getBedVolume(): number;
  /**
   * IDEA-073: cross-fade to a place's ambience bed.
   *
   * Called with the theme the board currently WEARS, which is `sceneThemeId`
   * and not the equipped theme — a challenge level forces its own, owned or
   * not, and the ears should be in the same place as the eyes. Re-calling it
   * with the bed already playing is free, which is what lets startLevel call
   * it unconditionally.
   */
  ambience(kind: AmbienceKind): void;
  /** What bed is playing. For tests, and for the bed button's label. */
  currentAmbience(): AmbienceKind;
  /**
   * IDEA-073 v2: fires whenever a MUTE flag moves, so every attached button
   * re-renders.
   *
   * It exists because the menu's single button and the HUD's two now overlap:
   * muting effects in the HUD changes what the menu's master button should be
   * showing, and before the split that was free (one handler drove every
   * `.mute-btn` on the page). Two independent toggles over shared state is
   * exactly the "two attachments that could disagree about whether sound is
   * off" that attachToggle's own comment warns about — this is what stops it.
   *
   * Returns an unsubscribe, so a detached button stops being re-rendered.
   */
  onStateChange(fn: () => void): () => void;
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

  // IDEA-073: master now forks into TWO independently controlled buses, and
  // that split is the whole feature Nuno asked for —
  //
  //    master -> sfxBus -> (game cues, and uiBus under them)
  //           -> bedBus -> (the ambience bed, and the menu bed)
  //
  // because the two answer to different buttons. The existing control keeps
  // its name, its storage key and its meaning (EFFECTS — the chomp, the
  // death, every interface tap), so nothing that already calls setMuted has
  // to change. The new one silences the place you are standing in without
  // taking the game's feedback with it.
  //
  // Each bus carries its own volume as well as its own mute, and mute is
  // expressed as "hold the bus at 0" rather than as a flag each cue consults
  // — same reasoning the single master gain had, now twice.
  const sfxBus = ctx.createGain();
  sfxBus.connect(master);
  const bedBus = ctx.createGain();
  bedBus.connect(master);

  let muted = readStoredMuted();
  let bedMuted = readStoredFlag(BED_MUTE_STORAGE_KEY);
  let sfxVolume = readStoredVolume(SFX_VOL_STORAGE_KEY, DEFAULT_SFX_VOLUME);
  let bedVolume = readStoredVolume(BED_VOL_STORAGE_KEY, DEFAULT_BED_VOLUME);

  function applySfxGain(): void {
    sfxBus.gain.value = muted ? 0 : sfxVolume;
  }

  function applyBedGain(): void {
    // Ramped rather than assigned: a slider being dragged writes this on
    // every input event, and stepping a live noise bed's gain in jumps is
    // audible as zipper noise. 60 ms is under the eye's notice and over the
    // ear's.
    const t = ctx.currentTime;
    const target = bedMuted ? 0 : bedVolume;
    bedBus.gain.cancelScheduledValues(t);
    bedBus.gain.setValueAtTime(bedBus.gain.value, t);
    bedBus.gain.linearRampToValueAtTime(target, t + 0.06);
  }

  applySfxGain();
  bedBus.gain.value = bedMuted ? 0 : bedVolume;

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
      destination,
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
    env.connect(destination ?? sfxBus);

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
  // IDEA-073: uiBus -> sfxBus -> master. An interface tap is an EFFECT, so
  // the button that silences the chomp silences the taps with it; the bed
  // button leaves both alone.
  uiBus.connect(sfxBus);

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

  // ---- the ambience bed ----------------------------------------------------
  //
  // IDEA-073. This REPLACED a hand-rolled menu bed that lived here — a looping
  // low-passed noise "distant traffic" plus a scheduled bird chirp. Both
  // recipes survive, in ambience.ts, as the CITY and GARDEN beds: the menu bed
  // was already two of the five places this game has, it was simply nailed to
  // the menu and mixed together (birds AND traffic, which is nowhere).
  //
  // Deleting it rather than keeping it alongside is the point. Two bird
  // implementations are two things to retune and one of them will be forgotten
  // — and the whole ask was "put the birds we already have on the game moment
  // too", which is one bed shown in two places, not a second bed.
  const ambienceEngine = createAmbience(ctx, bedBus);


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
    applySfxGain();
    writeStoredMuted(muted);
    notifyState();
  }

  function isMuted(): boolean {
    return muted;
  }

  const stateListeners = new Set<() => void>();
  function notifyState(): void {
    for (const fn of stateListeners) fn();
  }

  function setBedMuted(next: boolean): void {
    bedMuted = next;
    applyBedGain();
    writeStoredFlag(BED_MUTE_STORAGE_KEY, next);
    notifyState();
  }

  function isBedMuted(): boolean {
    return bedMuted;
  }

  /** Clamp once, here, rather than trusting every caller. The profile slider
   *  is the only one today, but a stored value can be anything. */
  function clamp01(v: number): number {
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }

  function setSfxVolume(v: number): void {
    sfxVolume = clamp01(v);
    applySfxGain();
    writeStoredVolume(SFX_VOL_STORAGE_KEY, sfxVolume);
  }

  function getSfxVolume(): number {
    return sfxVolume;
  }

  function setBedVolume(v: number): void {
    bedVolume = clamp01(v);
    applyBedGain();
    writeStoredVolume(BED_VOL_STORAGE_KEY, bedVolume);
  }

  function getBedVolume(): number {
    return bedVolume;
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
    setBedMuted,
    isBedMuted,
    setSfxVolume,
    getSfxVolume,
    setBedVolume,
    getBedVolume,
    onStateChange(fn: () => void): () => void {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    ambience: (kind: AmbienceKind) => ambienceEngine.set(kind),
    currentAmbience: () => ambienceEngine.current(),
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
const BED_OFF_ICON = ICON.ambienceOff;
const BED_ON_ICON = ICON.ambienceOn;

/**
 * Wires the HUD's mute button (`#muteBtn` in index.html) to `sound`: reflects
 * the persisted mute state on load, toggles it (+ calls `sound.resume()`) on
 * click, and keeps the icon/aria-pressed in sync. Call once from
 * Game's constructor. Returns a detach function for symmetry with
 * attachKeyboard/attachTouch, even though the button's lifetime currently
 * matches the whole app (no teardown call site needed yet).
 */
/**
 * IDEA-073: the two sound buttons are ONE mechanism with two configurations.
 *
 * `attachMuteButton` and `attachBedButton` differ only in which class they
 * wire, which pair of glyphs they draw and which flag they flip — so writing
 * them twice would be two renderers to keep in step, and the one that is
 * wrong is the one nobody is looking at. The design system's §10 makes the
 * same argument about press/select being one cue with a pitch argument.
 */
interface ToggleSpec {
  selector: string;
  /** Read the CURRENT off-state. True means "silenced". */
  isOff: () => boolean;
  /** Flip it. */
  toggle: () => void;
  glyphOn: string;
  glyphOff: string;
  labelOn: string;
  labelOff: string;
  missing: string;
}

function attachToggle(root: ParentNode, sound: Sound, spec: ToggleSpec): () => void {
  // EVERY matching button on the page, not just the one in the HUD.
  //
  // The screen redesign gave the main menu its own sound control (the in-run
  // one lives in the HUD chrome, which the menu hides), and there is exactly
  // one state per toggle — so the honest wiring is one handler over every
  // button with a shared render, not two attachments that could disagree
  // about whether sound is off.
  const scope: ParentNode = root ?? document;
  const found = [
    ...scope.querySelectorAll<HTMLButtonElement>(spec.selector),
    ...(scope === document ? [] : document.querySelectorAll<HTMLButtonElement>(spec.selector)),
  ];
  const buttons = [...new Set(found)];
  if (buttons.length === 0) throw new Error(spec.missing);

  function render(): void {
    const off = spec.isOff();
    for (const btn of buttons) {
      // Writes into the inner <i>, creating it if the markup lacks one — see
      // setGlyph. Setting textContent on the BUTTON would delete the icon
      // element and print the ligature name.
      setGlyph(btn, off ? spec.glyphOff : spec.glyphOn);
      btn.setAttribute("aria-pressed", String(off));
      btn.setAttribute("aria-label", off ? spec.labelOff : spec.labelOn);
    }
  }

  function onClick(): void {
    // Tapping the button is a user gesture in its own right, so this is also
    // a valid place to unlock audio (in case Start/first-input somehow never
    // fired — e.g. a player who lands mid-session via some future deep link).
    sound.resume();
    spec.toggle();
    render();
  }

  render(); // reflect the persisted state immediately on load
  for (const btn of buttons) btn.addEventListener("click", onClick);
  // ...and re-render whenever ANOTHER button moves the same state.
  const unsubscribe = sound.onStateChange(render);

  return () => {
    unsubscribe();
    for (const btn of buttons) btn.removeEventListener("click", onClick);
  };
}

export function attachMuteButton(root: ParentNode, sound: Sound): () => void {
  return attachToggle(root, sound, {
    selector: ".mute-btn",
    isOff: () => sound.isMuted(),
    toggle: () => sound.setMuted(!sound.isMuted()),
    glyphOn: UNMUTED_ICON,
    glyphOff: MUTED_ICON,
    labelOn: "Mute game sounds",
    labelOff: "Unmute game sounds",
    missing: "attachMuteButton: no .mute-btn found — check index.html",
  });
}

/**
 * IDEA-073 v2: the MENU's single sound button -- a MASTER toggle over both
 * layers.
 *
 * Nuno: *"on the main menu we can only have one button because we only have
 * one sound on the menus; on the game yes keep the two buttons."* A run has
 * both layers going at once and they compete for the same ears, which is the
 * whole reason the split exists; a menu does not, so two controls there would
 * be two switches for one decision.
 *
 * It moves BOTH flags rather than only the bed, and that is the one judgement
 * call in this function. The bed is the only thing you HEAR continuously on
 * the menu, so bed-only is the other honest reading of "one sound" -- but the
 * interface taps play on this screen too, and the menu is the only place this
 * button can be reached before a run starts. Bed-only would leave them
 * unmutable from anywhere except a slider on the account screen, which is a
 * regression on what this same button did before the layers were split.
 *
 * OFF means BOTH are off. Pressing it while only one is muted silences the
 * rest rather than un-muting half -- "make it quiet" is what a player means by
 * pressing a speaker with a line through it, and the alternative (toggling
 * each independently) makes the icon lie about the state it is in.
 */
export function attachSoundButton(root: ParentNode, sound: Sound): () => void {
  return attachToggle(root, sound, {
    selector: ".sound-btn",
    isOff: () => sound.isMuted() && sound.isBedMuted(),
    toggle: () => {
      const silenced = sound.isMuted() && sound.isBedMuted();
      sound.setMuted(!silenced);
      sound.setBedMuted(!silenced);
    },
    glyphOn: UNMUTED_ICON,
    glyphOff: MUTED_ICON,
    labelOn: "Mute sound",
    labelOff: "Unmute sound",
    missing: "attachSoundButton: no .sound-btn found — check index.html",
  });
}

/** IDEA-073: the AMBIENCE bed's toggle. Same mechanism, different flag. */
export function attachBedButton(root: ParentNode, sound: Sound): () => void {
  return attachToggle(root, sound, {
    selector: ".bed-btn",
    isOff: () => sound.isBedMuted(),
    toggle: () => sound.setBedMuted(!sound.isBedMuted()),
    glyphOn: BED_ON_ICON,
    glyphOff: BED_OFF_ICON,
    labelOn: "Mute ambience",
    labelOff: "Unmute ambience",
    missing: "attachBedButton: no .bed-btn found — check index.html",
  });
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
