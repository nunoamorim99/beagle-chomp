// OWNER: pwa-mobile-engineer (IDEA-073 themed ambience)
//
// The AMBIENCE BEDS — one continuous, quiet, slow-moving texture per maze
// theme, playing under a run as well as under the menu.
//
// Split out of sound.ts rather than added to it, because the two answer
// different questions. sound.ts owns CUES: short, loud, event-shaped, one
// per thing that happened. This owns BEDS: endless, quiet, nothing-shaped,
// one per PLACE. They share an AudioContext and nothing else.
//
// Contract: createAmbience(ctx, destination) -> Ambience. Browser-only, no
// three, no src/game import. The caller says which bed by KIND; it never
// asks what a theme is (MazeTheme.ambience is where that decision lives, the
// same way tunnelArch answers "which arch").
//
// ---------------------------------------------------------------------------
// WHY THIS IS SYNTHESIS AND NOT FILES
//
// This project ships ZERO audio assets and fetches nothing (see sound.ts's
// header, and CLAUDE.md on the Google Fonts incident — type was the last
// thing phoning home on the boot path and it took the whole visual language
// down when it was blocked). The five beds below are also, conveniently, the
// five best cases synthesis has: surf, wind and distant traffic are all
// literally filtered noise with a slow swell on the cutoff, and birdsong is a
// short pitch-sweep. What synthesis CANNOT do is a melody that sounds like an
// instrument, which is why there is no music here and why that is a feature —
// a tune loops and grates inside three minutes of a chase, a texture never
// does.
//
// ---------------------------------------------------------------------------
// THE TWO RULES EVERY BED OBEYS
//
//  1. STAY OUT OF THE CHOMP'S BAND. biscuit() is a 340-520 Hz triangle blip
//     and it is the most frequent sound in the game — a bed that sits on top
//     of it makes the corridor run feel muddy without anyone being able to say
//     why. So every bed lives at the EXTREMES: rumble and traffic below
//     ~320 Hz, leaves and birds above ~1.2 kHz, and the middle is left to the
//     cues. This is the whole answer to "use the two sounds and feel good
//     anyway" — it is a frequency split, not a volume fight.
//
//  2. MOVE SLOWLY. Relaxing is a TIME-SCALE, not a level. Every modulator
//     below runs at 0.03-0.12 Hz (8 to 30 seconds a cycle) and every pair of
//     them is deliberately INCOMMENSURATE, so the combined swell never
//     repeats on a period the ear can learn. Events (a bird, a passing car)
//     are scheduled on a random interval for the same reason the menu bed's
//     birds already are: anything on a fixed timer reads as a machine.

/**
 * Which bed a place has. Declared here because THIS module owns what beds
 * exist; `MazeTheme.ambience` names one, exactly as `tunnelArch` names an
 * arch, so a theme answers WHICH and never HOW.
 *
 * "none" is a real, deliberate value and not an oversight — Arcade Night is
 * the neon tribute board whose surround is already `"none"`, and a hedge full
 * of birds under it would break the one place in this game that is meant to
 * be an empty void.
 */
export type AmbienceKind = "birds" | "surf" | "forest" | "city" | "park" | "none";

export const AMBIENCE_KINDS: readonly AmbienceKind[] = [
  "birds",
  "surf",
  "forest",
  "city",
  "park",
  "none",
];

export interface Ambience {
  /** Cross-fade to this bed. A no-op if it is already the one playing — which
   *  matters: classic mode plays 36 levels on one theme and re-starting the
   *  bed at every level boundary would be an audible hiccup on the only sound
   *  that is supposed to be seamless. */
  set(kind: AmbienceKind): void;
  /** What is playing, for tests and for the caller's own bookkeeping. */
  current(): AmbienceKind;
  /** Fade out and tear down every node. Idempotent. */
  stop(): void;
}

/** Seconds of noise in the shared loop buffer.
 *
 *  SIX, not sound.ts's 1.5. That buffer is fine for one-shots and for a
 *  heavily low-passed rumble, where a 1.5 s period is below anything the ear
 *  can pick out — but a BRIGHT looping layer (leaves at 2 kHz, sea spray)
 *  develops an audible 1.5-second pulse within a few passes, and a bed that
 *  ticks is the opposite of the thing this module is for. Six seconds costs
 *  ~1.1 MB at 48 kHz and is allocated lazily, so a player who never leaves
 *  Arcade Night never pays it. */
const NOISE_SECONDS = 6;

/** Fade times. Out is quicker than in on purpose: leaving a place should feel
 *  like a door closing, arriving should feel like nothing happened. */
const FADE_IN = 2.5;
const FADE_OUT = 1.1;

export function createAmbience(ctx: AudioContext, destination: AudioNode): Ambience {
  // One noise buffer for every layer of every bed, built on first use.
  let noise: AudioBuffer | null = null;
  function getNoise(): AudioBuffer {
    if (noise) return noise;
    const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Slightly pink-ish rather than pure white: one pole of smoothing takes
    // the hiss off, which is the difference between "wind" and "static".
    // Pure white through a low-pass still reads as a hiss escaping at the top.
    let last = 0;
    for (let i = 0; i < frames; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.035 * w) / 1.035;
      data[i] = last * 3.2;
    }
    noise = buf;
    return buf;
  }

  /**
   * Everything a running bed owns, so `stop()` is one loop and can never
   * leave a looping source or a setTimeout behind. A leaked AudioBufferSource
   * plays FOREVER — it outlives the Game object and there is no second handle
   * on it — which is the one failure mode in this file that a player would
   * actually notice.
   */
  interface Rig {
    gain: GainNode;
    nodes: AudioScheduledSourceNode[];
    timers: ReturnType<typeof setTimeout>[];
  }

  function newRig(): Rig {
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(destination);
    return { gain, nodes: [], timers: [] };
  }

  function teardown(rig: Rig): void {
    for (const t of rig.timers) clearTimeout(t);
    rig.timers.length = 0;
    const t = ctx.currentTime;
    rig.gain.gain.cancelScheduledValues(t);
    rig.gain.gain.setValueAtTime(rig.gain.gain.value, t);
    // Fade, never cut: a noise bed stopped hard is a click, and a click is
    // the single most noticeable thing a quiet bed can do.
    rig.gain.gain.linearRampToValueAtTime(0.0001, t + FADE_OUT);
    for (const n of rig.nodes) {
      try {
        n.stop(t + FADE_OUT + 0.05);
      } catch {
        /* already stopped — stop() twice throws on some engines, and there is
           nothing to do about a node that is already silent */
      }
    }
    rig.nodes.length = 0;
    // Drop the gain node off the graph once the fade has finished, so a long
    // session switching themes does not accumulate dead nodes on `destination`.
    setTimeout(
      () => {
        try {
          rig.gain.disconnect();
        } catch {
          /* already disconnected */
        }
      },
      (FADE_OUT + 0.2) * 1000,
    );
  }

  // ---- layer primitives ----------------------------------------------------

  interface LayerOpts {
    /** Filter shape. "lowpass" for anything below the chomp, "bandpass" for
     *  anything above it — see rule 1 in the header. */
    type: BiquadFilterType;
    /** Centre/cutoff in Hz. */
    freq: number;
    q?: number;
    /** Steady level for this layer. */
    level: number;
    /** Playback rate of the noise loop. Under 1 stretches the loop (and drops
     *  its spectrum), which both deepens a rumble and pushes the loop period
     *  further out of earshot. */
    rate?: number;
  }

  /** One continuous filtered-noise layer. Returns its filter and gain so a
   *  modulator can be aimed at either. */
  function layer(rig: Rig, opts: LayerOpts): { filter: BiquadFilterNode; gain: GainNode } {
    const { type, freq, q = 0.7, level, rate = 1 } = opts;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    src.playbackRate.value = rate;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.value = level;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(rig.gain);
    // A random start offset means two layers built in the same frame are not
    // the same waveform in lockstep, which would fuse them into one sound.
    src.start(ctx.currentTime, Math.random() * NOISE_SECONDS);
    rig.nodes.push(src);
    return { filter, gain };
  }

  /**
   * A slow sine modulator aimed at an AudioParam.
   *
   * `hz` is deliberately tiny (0.03-0.12 — eight to thirty seconds a cycle).
   * Two of these on one bed must never share a rate or a simple ratio of one:
   * incommensurate rates beat against each other with a period far longer
   * than either, which is what stops a two-minute level from ever hearing the
   * same swell twice.
   */
  function modulate(rig: Rig, param: AudioParam, hz: number, depth: number): void {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = hz;
    const amt = ctx.createGain();
    amt.gain.value = depth;
    lfo.connect(amt);
    amt.connect(param);
    // Start at a random phase, or every bed in the game begins its swell at
    // exactly the same point in the cycle.
    lfo.start(ctx.currentTime + Math.random() * (1 / hz));
    rig.nodes.push(lfo);
  }

  /** Re-arms `fn` on an irregular interval for as long as the rig is alive.
   *  Anything on a fixed timer reads as a machine — the menu bed's birds have
   *  carried that note since IDEA-048 and it applies to every event here. */
  function every(rig: Rig, minMs: number, maxMs: number, fn: () => void): void {
    const arm = (): void => {
      const t = setTimeout(
        () => {
          fn();
          arm();
        },
        minMs + Math.random() * (maxMs - minMs),
      );
      rig.timers.push(t);
    };
    arm();
  }

  /** A short pitch-sweeping sine — the shape every bird call here is made of. */
  function whistle(rig: Rig, freq: number, to: number, dur: number, peak: number, delay: number): void {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.max(freq, 1), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.4));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(rig.gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** A short filtered-noise event: the passing car, the woodpecker knock. */
  function gust(rig: Rig, o: {
    freq: number;
    endFreq?: number;
    dur: number;
    peak: number;
    q?: number;
    type?: BiquadFilterType;
  }): void {
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.setValueAtTime(o.freq, t0);
    if (o.endFreq !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(o.endFreq, 20), t0 + o.dur);
    }
    f.Q.value = o.q ?? 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    // A long symmetric attack/decay, not a transient: this is something
    // passing by in the distance, not something happening to the player.
    env.gain.linearRampToValueAtTime(o.peak, t0 + o.dur * 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(env);
    env.connect(rig.gain);
    src.start(t0, Math.random() * NOISE_SECONDS);
    src.stop(t0 + o.dur + 0.05);
  }

  // ---- the beds ------------------------------------------------------------
  //
  // Levels below are the MIX. The bus this rig hangs off carries the player's
  // own ambience volume, so these numbers only have to be right relative to
  // each other and to biscuit()'s 0.16 peak — which every one of them clears
  // by a wide margin, on purpose. A bed you notice is a bed that is too loud.

  /** BEACH. Surf is the best thing this technique does: a constant low
   *  rumble with a brighter WASH that swells over it. Both halves are needed
   *  — rumble alone is a lorry idling, wash alone is a hiss. */
  function buildSurf(rig: Rig): void {
    const deep = layer(rig, { type: "lowpass", freq: 150, q: 0.6, level: 0.085, rate: 0.7 });
    modulate(rig, deep.gain.gain, 0.041, 0.03);

    const wash = layer(rig, { type: "bandpass", freq: 900, q: 0.5, level: 0.05 });
    // The wave itself: the cutoff opens as it breaks and closes as it draws
    // back, and the gain follows on a slightly different clock so the two
    // never quite line up twice.
    modulate(rig, wash.filter.frequency, 0.047, 430);
    modulate(rig, wash.gain.gain, 0.033, 0.042);
  }

  /** GARDEN. The bed Nuno already had under the menu, now a place you can
   *  stand in: a soft breeze with birds over it. The chirps are the brightest
   *  thing in this file (2.2-3.1 kHz) and that is what keeps them clear of the
   *  chomp without having to be loud. */
  function buildBirds(rig: Rig, opts: { minMs: number; maxMs: number; breeze: number }): void {
    const air = layer(rig, { type: "lowpass", freq: 300, q: 0.5, level: opts.breeze });
    modulate(rig, air.gain.gain, 0.037, opts.breeze * 0.35);

    const shimmer = layer(rig, { type: "bandpass", freq: 2600, q: 0.4, level: 0.012 });
    modulate(rig, shimmer.gain.gain, 0.058, 0.008);

    every(rig, opts.minMs, opts.maxMs, () => {
      const base = 2200 + Math.random() * 900;
      const notes = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < notes; i++) {
        const f = base * (1 + i * 0.06);
        whistle(rig, f, f * 1.25, 0.05, 0.05, i * 0.075);
      }
    });
  }

  /** DEEP FOREST. The separator from the garden is the RUSTLE — a broad
   *  band-passed layer with a deep swell on it, which is what "wind in a lot
   *  of leaves" is — plus birds that are LOWER and much further apart. A
   *  forest is quieter than a garden and the gaps are most of the effect. */
  function buildForest(rig: Rig): void {
    const deep = layer(rig, { type: "lowpass", freq: 150, q: 0.6, level: 0.075, rate: 0.75 });
    modulate(rig, deep.gain.gain, 0.029, 0.022);

    // MEASURED, and retuned because of it. This shipped at freq 1900 / Q 0.5
    // swinging +-700, and _scratch-bed-spectrum.ts reported the forest's mid
    // band as loud as its low -- alone among the five. A bandpass at Q 0.5 is
    // very broad, so at the bottom of that swing (1200 Hz) its lower skirt
    // reaches right down into the 340-520 Hz the chomp lives in. Rule 1 was
    // being honoured by the CENTRE frequency and broken by the SKIRT, which is
    // exactly the kind of thing no amount of reading the number tells you.
    // Higher centre, tighter Q, smaller swing: the rustle is unchanged to the
    // ear and the corridor is clear.
    const leaves = layer(rig, { type: "bandpass", freq: 2200, q: 0.9, level: 0.05 });
    modulate(rig, leaves.filter.frequency, 0.036, 500);
    modulate(rig, leaves.gain.gain, 0.052, 0.036);

    // A wood pigeon rather than a songbird: low, two soft notes, falling.
    every(rig, 5200, 13000, () => {
      const base = 620 + Math.random() * 220;
      whistle(rig, base, base * 0.86, 0.22, 0.036, 0);
      whistle(rig, base * 0.97, base * 0.8, 0.26, 0.028, 0.32);
    });

    // And rarely, a woodpecker. Three or four knocks of filtered noise — the
    // one percussive event in any of these beds, which is why it is this rare.
    every(rig, 17000, 44000, () => {
      const knocks = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < knocks; i++) {
        const t = setTimeout(
          () => gust(rig, { freq: 1500, dur: 0.045, peak: 0.05, q: 1.4 }),
          i * 70,
        );
        rig.timers.push(t);
      }
    });
  }

  /** NIGHT CITY. Already half-written — the menu bed's "distant traffic" was
   *  exactly this. What makes it a PLACE rather than a hum is the events: a
   *  car passing every few seconds and, rarely, a horn a long way off.
   *
   *  Everything steady here is under 320 Hz, well below the chomp. The passing
   *  car does sweep up through it, which is the one deliberate exception in
   *  this file: it is slow, quiet and occasional, so it colours the corridor
   *  rather than masking a transient. */
  function buildCity(rig: Rig): void {
    const road = layer(rig, { type: "lowpass", freq: 300, q: 0.5, level: 0.09, rate: 0.8 });
    modulate(rig, road.filter.frequency, 0.031, 90);
    modulate(rig, road.gain.gain, 0.044, 0.028);

    const rumble = layer(rig, { type: "lowpass", freq: 170, q: 0.7, level: 0.055, rate: 0.6 });
    modulate(rig, rumble.gain.gain, 0.026, 0.02);

    every(rig, 5500, 14000, () => {
      gust(rig, { freq: 240, endFreq: 640, dur: 3.4, peak: 0.038, q: 0.8 });
    });

    // Two soft detuned sines, a long way off. A horn is the one thing that
    // says "city" outright, so it only has to happen occasionally to work.
    every(rig, 26000, 62000, () => {
      whistle(rig, 392, 392, 0.55, 0.02, 0);
      whistle(rig, 466, 466, 0.55, 0.015, 0.02);
    });
  }

  /** CITY PARK. The garden's recipe opened up: more air, fewer birds. It sits
   *  between the two on purpose — a park is a garden you do not own. */
  function buildPark(rig: Rig): void {
    buildBirds(rig, { minMs: 3400, maxMs: 9000, breeze: 0.05 });
    const open = layer(rig, { type: "bandpass", freq: 1500, q: 0.4, level: 0.028 });
    modulate(rig, open.gain.gain, 0.043, 0.02);
  }

  function build(kind: AmbienceKind): Rig | null {
    if (kind === "none") return null;
    const rig = newRig();
    switch (kind) {
      case "surf":
        buildSurf(rig);
        break;
      case "birds":
        buildBirds(rig, { minMs: 2200, maxMs: 6500, breeze: 0.045 });
        break;
      case "forest":
        buildForest(rig);
        break;
      case "city":
        buildCity(rig);
        break;
      case "park":
        buildPark(rig);
        break;
    }
    rig.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN);
    return rig;
  }

  // ---- the public switch ---------------------------------------------------

  let kind: AmbienceKind = "none";
  let rig: Rig | null = null;

  return {
    set(next: AmbienceKind): void {
      // The no-op is load-bearing, not an optimisation. Classic mode plays up
      // to 36 levels on ONE theme, and startLevel calls this every time — so
      // without this line the bed would tear down and cross-fade at every
      // level boundary, which is an audible hiccup on the one sound in the
      // game that is supposed to be seamless.
      if (next === kind) return;
      kind = next;
      if (rig) teardown(rig);
      rig = build(next);
    },

    current(): AmbienceKind {
      return kind;
    },

    stop(): void {
      kind = "none";
      if (rig) teardown(rig);
      rig = null;
    },
  };
}
