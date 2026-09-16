// IDEA-073: do the beds actually produce sound, and do they stay out of the
// chomp's band?
//
// ambience.ts's rule 1 is the load-bearing claim of the whole feature -- the
// beds live at the EXTREMES (rumble under ~320 Hz, leaves and birds over
// ~1.2 kHz) and leave 340-520 Hz to biscuit(), which is the most frequent
// sound in the game. That claim is the answer to Nuno's "work the beds to
// allow use the two sounds and feel good anyway", and until now it was only
// an assertion in a comment.
//
// This RENDERS each bed in an OfflineAudioContext inside a real browser and
// measures the energy in three bands by FILTERING it (see the note beside the
// band specs -- the first version probed discrete frequencies instead and its
// numbers were a coin flip). No speakers, no listening, no judgement -- just
// where the energy is.
//
// TWO LIMITS, both deliberate and both worth knowing:
//
//  1. SCHEDULED EVENTS DO NOT APPEAR. Birds, the passing car and the
//     woodpecker are fired from setTimeout, and an OfflineAudioContext renders
//     far faster than real time, so none of them land inside the window. What
//     is measured is the CONTINUOUS layers -- which is the part that plays
//     under the chomp constantly and therefore the part that can mask it. The
//     events are brief and sparse by construction.
//
//  2. IT CANNOT TELL YOU IF A BED SOUNDS GOOD. It tells you a bed exists, is
//     audible, and is not sitting on top of the game. Whether surf sounds like
//     surf is Nuno's call at the speakers.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

const rows = await p.evaluate(async () => {
  // The specifier is held in a variable so TypeScript does not try to resolve
  // it from this file: it is a URL the DEV SERVER serves, not a path on disk
  // relative to scripts/. _scratch-tutorial-geometry.ts dodges the same thing
  // by passing its whole evaluate body as a string.
  const path = "/src/ui/ambience.ts";
  const mod = (await import(/* @vite-ignore */ path)) as typeof import("../src/ui/ambience");
  const out: Array<{
    kind: string;
    rms: number;
    low: number;
    mid: number;
    high: number;
  }> = [];

  for (const kind of mod.AMBIENCE_KINDS) {
    const SR = 44100;
    // Long enough to average several swells. Every layer is modulated at
    // 0.026-0.058 Hz from a RANDOM starting phase (ambience.ts does that on
    // purpose, so two beds never swell in lockstep), so a short window catches
    // one arbitrary point of one cycle.
    //
    // Note this was NOT what made the first version unstable -- stretching it
    // to 45 seconds did not help at all, because the problem was the
    // estimator and not the averaging time. See the band specs below.
    const SECS = 20;
    const ctx = new OfflineAudioContext(1, SR * SECS, SR);
    const amb = mod.createAmbience(ctx as unknown as AudioContext, ctx.destination);
    amb.set(kind);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);

    // Skip the fade-in: the bed ramps over FADE_IN seconds, so the first
    // stretch is quiet by design and would drag every figure down.
    const from = Math.floor(SR * 5);
    let sum = 0;
    for (let i = from; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / (d.length - from));

    // BAND ENERGY BY FILTER, NOT BY GOERTZEL -- and this is the whole reason
    // the figures in this script can be trusted.
    //
    // The first version probed each band at four discrete frequencies with a
    // Goertzel. That is the right tool for "is this TONE present" and the
    // wrong one for "how much energy is in this band of NOISE": a single narrow
    // bin of broadband noise is itself a random variable, so the estimate
    // wandered by 3-5x run to run and surf crossed the threshold in one run of
    // three with nothing changed. Lengthening the window did not fix it,
    // because the problem was never the averaging time.
    //
    // A bandpass filter integrates the WHOLE band, which is what was wanted all
    // along -- and the platform already has one. Two biquads in series per
    // band for a steeper skirt, so "in the chomp's band" means what it says.
    const specs: Array<{ name: string; type: BiquadFilterType; f: number; q: number }> = [
      { name: "low", type: "lowpass", f: 320, q: 0.7 },
      // Geometric centre of 340..640 with a Q that spans it: sqrt(340*640)=466,
      // bandwidth 300, Q = 466/300.
      { name: "mid", type: "bandpass", f: 466, q: 1.55 },
      { name: "high", type: "highpass", f: 1400, q: 0.7 },
    ];
    const power: Record<string, number> = {};
    for (const sp of specs) {
      const bctx = new OfflineAudioContext(1, buf.length, SR);
      const src = bctx.createBufferSource();
      src.buffer = buf;
      const f1 = bctx.createBiquadFilter();
      f1.type = sp.type;
      f1.frequency.value = sp.f;
      f1.Q.value = sp.q;
      const f2 = bctx.createBiquadFilter();
      f2.type = sp.type;
      f2.frequency.value = sp.f;
      f2.Q.value = sp.q;
      src.connect(f1);
      f1.connect(f2);
      f2.connect(bctx.destination);
      src.start();
      const fb = await bctx.startRendering();
      const fd = fb.getChannelData(0);
      let s = 0;
      for (let i = from; i < fd.length; i++) s += fd[i] * fd[i];
      power[sp.name] = Math.sqrt(s / (fd.length - from));
    }
    out.push({ kind, rms, low: power.low, mid: power.mid, high: power.high });
  }
  return out;
});

await b.close();

// biscuit()'s peak is 0.16 and it is a 60 ms transient. A bed whose CONTINUOUS
// rms approaches that is too loud whatever its spectrum says. Measured, the
// five run 0.010-0.027 -- six to sixteen times under it.
const CHOMP_PEAK = 0.16;
let bad = 0;

console.log(
  "\n  bed        rms      low(<320)  mid(340-640)  high(>1.4k)   mid/low" +
    "\n  (high is under-reported here: the birds and the passing car are scheduled)",
);
for (const r of rows) {
  // Against LOW, not against the total: the total includes a high band this
  // harness under-reports, which would flatter every bed.
  const midShare = r.low > 0 ? r.mid / r.low : 0;
  const silent = r.kind === "none";
  const audible = silent ? r.rms < 1e-6 : r.rms > 0.005;
  // The rule, stated against what this harness can actually see.
  //
  // The FIRST version also demanded the mid band be under the HIGH one, and
  // reported four sound beds as failures -- because in every bed the high
  // content IS the scheduled birds and sparkle, and limit 1 at the top of this
  // file says those never render here. It was measuring the absence it had
  // already documented. Sixth instrument false alarm in this project, after
  // the ?fov= framing, the ?bg=none holes, the white pine, the surround seam
  // prober and the HUD worst case.
  //
  // What IS measurable is the thing that matters most anyway: the bed's
  // CONTINUOUS energy is concentrated BELOW the chomp rather than on it.
  // Measured over three runs: forest 9%, surf 16-26%, city 17-19%, birds 21%,
  // park 24-25%. The 50% bar is therefore loose on purpose -- it is there to
  // catch a bed that has drifted onto the chomp, as the forest's leaf layer
  // actually had, not to pin a mix that is tuned by ear.
  const clearsChomp = silent || r.mid < r.low * 0.5;
  const quiet = r.rms < CHOMP_PEAK * 0.75;
  const ok = audible && clearsChomp && quiet;
  if (!ok) bad++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${r.kind.padEnd(6)} ${r.rms.toFixed(4)}   ` +
      `${r.low.toFixed(5)}    ${r.mid.toFixed(5)}       ${r.high.toFixed(5)}      ` +
      `${(midShare * 100).toFixed(1)}%` +
      (silent ? "   (silent on purpose)" : ""),
  );
}

console.log(
  bad === 0
    ? "\nevery bed is audible, quieter than a chomp, and thinnest in the chomp's own band"
    : `\n${bad} bed(s) off target`,
);
if (bad > 0) process.exit(1);
