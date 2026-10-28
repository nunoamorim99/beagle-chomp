import * as THREE from "three";
import { toon } from "../toon";
import { CartoonBoat, type BoatMaterials } from "./cartoonBoat";
import { SplashFx } from "./splashFx";
import { KrakenTentacles, type TentacleShape } from "./tentacles";
import {
  clamp01,
  easeInCubic,
  easeInOutCubic,
  easeInOutSine,
  easeInQuad,
  easeOutBack,
  lerp,
  range,
} from "./easing";

/**
 * A looping "sea monster takes a boat" vignette for Pirate Island's sea.
 *
 * A boat pops in, drops onto the water and sails a curve to a stop; tentacles
 * break the surface round it, hook over the hull, squeeze, and drag it under;
 * a pause; again. ONE normalised timeline drives the boat, the tentacles and
 * the splashes, so nothing can drift out of step.
 *
 * Studied from a vignette on madbox.io's island map and REBUILT here in code —
 * no geometry, texture or animation data of theirs is used. Two departures from
 * the study are forced by this game rather than chosen:
 *   - every colour is a `toon()` material (material GROUPS, not vertex
 *     colours), so IDEA-079's style snaps it with the rest of the board;
 *   - all tentacles are one SkinnedMesh, and the boat's rigid parts collapse
 *     to one mesh per material, so the whole act costs about a dozen draw
 *     calls on a board that counts them.
 *
 * The sea is NOT part of this. Everything below `seaLevel` is hidden by the
 * island's opaque sea (seaside.ts), which is how the tentacles rise "through"
 * the water and the boat sinks into it.
 *
 * It is advanced from `spinDecor`, so it pauses with the game like the tunnel
 * portals do. Anything that never calls `update` (the board preview, the
 * editor) sees the frame `initialProgress` sets — a boat under sail.
 */

export type KrakenPhase = "spawn" | "sail" | "rise" | "grab" | "sink" | "hidden";

export interface TentacleSpot extends TentacleShape {
  /** Angle round the strike point, radians, 0 = local +Z. */
  angle: number;
  /** Distance from the strike point. */
  radius: number;
  /** Timeline delay, normalised (0..~0.06). */
  delay: number;
}

export interface KrakenBoatOptions {
  /** Seconds for one act. */
  duration?: number;
  /** Seconds of empty sea between two acts. */
  rest?: number;
  seaLevel?: number;
  /** The boat's route in local space; the LAST point is where it is taken. */
  path?: THREE.Vector3[];
  tentacles?: TentacleSpot[];
  /** Where on the timeline it starts, 0..1. */
  initialProgress?: number;
  /** Phase changes — the hook for a roar or a camera nudge. */
  onPhase?: (phase: KrakenPhase) => void;
  /** Every splash, in WORLD space — the hook for a splash sound. */
  onSplash?: (worldPos: THREE.Vector3, strength: number) => void;
}

/** The act, normalised. Retime the whole thing here. */
export const KRAKEN_TIMELINE = {
  pop: [0.0, 0.035],
  drop: [0.035, 0.09],
  sail: [0.1, 0.5],
  rise: [0.44, 0.52], // + each tentacle's delay
  grab: [0.52, 0.6], // ramps in, holds until the sink
  sink: [0.76, 0.9],
  hidden: 0.92,
} as const;

export const DEFAULT_TENTACLES: TentacleSpot[] = [
  { angle: 0.35, radius: 1.45, length: 2.7, baseRadius: 0.21, delay: 0.0 },
  { angle: 1.55, radius: 1.6, length: 3.0, baseRadius: 0.25, delay: 0.025 },
  { angle: 2.65, radius: 1.35, length: 2.5, baseRadius: 0.2, delay: 0.05 },
  { angle: 3.85, radius: 1.6, length: 3.1, baseRadius: 0.26, delay: 0.015 },
  { angle: 5.05, radius: 1.45, length: 2.6, baseRadius: 0.21, delay: 0.04 },
];

const DEFAULT_PATH = [
  new THREE.Vector3(-6.0, 0, 4.2),
  new THREE.Vector3(-3.8, 0, 3.2),
  new THREE.Vector3(-1.6, 0, 1.4),
  new THREE.Vector3(0, 0, 0),
];

/**
 * The colours, as `toon()` materials. Each lands on its own rung of the
 * style's palette (`test-kraken.ts` holds them to it): the tentacle's back is
 * `coral` and its belly `sand`, which is the read that makes it a tentacle
 * rather than a red pipe — the reference's peach belly snaps to coral too and
 * the suckers vanish into the back.
 */
export interface KrakenMaterials extends BoatMaterials {
  tentacle: THREE.Material;
  tentacleBelly: THREE.Material;
}

function ink(hex: number): THREE.MeshToonMaterial {
  const m = toon({ color: hex });
  // A marking that must stay dark (madboxStyle.ts) — without it the style
  // lifts a near-black onto `slate`, a blue-grey.
  m.userData.madboxRole = "ink";
  return m;
}

export function makeKrakenMaterials(): KrakenMaterials {
  return {
    tentacle: toon({ color: 0xe8553a }),
    tentacleBelly: toon({ color: 0xf6e3b8 }),
    hullDark: ink(0x5a3020),
    hull: toon({ color: 0xc9773f }),
    cream: toon({ color: 0xf0efea }),
    deck: toon({ color: 0xcfb07a }),
    spar: toon({ color: 0x9a6038 }),
    roof: toon({ color: 0x4fb3c9 }),
    sailStripe: toon({ color: 0xe8553a }),
    ink: ink(0x2a2626),
  };
}

export class KrakenBoatEvent extends THREE.Group {
  readonly boat: CartoonBoat;
  readonly boatRig = new THREE.Group();
  readonly fx: SplashFx;
  readonly tentacles: KrakenTentacles;
  readonly spots: TentacleSpot[];
  readonly materials: KrakenMaterials;

  duration: number;
  rest: number;
  speed = 1;
  playing = true;

  private seaLevel: number;
  private curve: THREE.CatmullRomCurve3;
  private target: THREE.Vector3;
  private progress = 0;
  private prevProgress = 0;
  private restLeft = 0;
  /** Never resets: drives the idle bob and sway. */
  private elapsed = 0;
  private wakeTimer = 0;
  private _phase: KrakenPhase = "spawn";
  private opts: KrakenBoatOptions;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(opts: KrakenBoatOptions = {}) {
    super();
    this.name = "kraken";
    this.opts = opts;
    this.duration = opts.duration ?? 8;
    this.rest = opts.rest ?? 0;
    this.seaLevel = opts.seaLevel ?? 0;
    const path = (opts.path ?? DEFAULT_PATH).map((p) => p.clone());
    this.curve = new THREE.CatmullRomCurve3(path, false, "centripetal");
    this.target = this.curve.getPointAt(1, new THREE.Vector3());
    this.materials = makeKrakenMaterials();
    const M = this.materials;

    this.boat = new CartoonBoat(M);
    this.boatRig.name = "krakenBoatRig";
    this.boatRig.add(this.boat);
    this.add(this.boatRig);

    this.fx = new SplashFx(this.seaLevel);
    this.add(this.fx);

    this.spots = opts.tentacles ?? DEFAULT_TENTACLES;
    this.tentacles = new KrakenTentacles(this.spots, [M.tentacle, M.tentacleBelly]);
    this.add(this.tentacles.mesh);

    this.setProgress(opts.initialProgress ?? 0);
  }

  get phase(): KrakenPhase {
    return this._phase;
  }
  /** 0..1 position in the act. */
  get time01(): number {
    return this.progress;
  }

  /** Restart the act from the beginning. */
  play(): void {
    this.progress = this.prevProgress = 0;
    this.restLeft = 0;
    this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }
  resume(): void {
    this.playing = true;
  }
  /** Scrub to a point in the act. Fires no splashes. */
  setProgress(p: number): void {
    this.progress = this.prevProgress = clamp01(p);
    this.restLeft = 0;
    this.fx.reset();
    this.apply(0);
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;
    if (this.playing) {
      if (this.restLeft > 0) {
        this.restLeft -= dt * this.speed;
        if (this.restLeft <= 0) this.progress = this.prevProgress = 0;
      } else {
        this.prevProgress = this.progress;
        this.progress += (dt * this.speed) / this.duration;
        if (this.progress >= 1) {
          this.progress = 0;
          this.prevProgress = 0;
          this.restLeft = this.rest;
          // Hold the empty frame through the rest.
          if (this.rest > 0) this.progress = this.prevProgress = 1;
        }
      }
    }
    this.apply(dt);
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------------------

  private crossed(a: number): boolean {
    return this.playing && this.prevProgress < a && this.progress >= a;
  }

  private splash(local: THREE.Vector3, strength: number): void {
    this.fx.burst(local, strength);
    this.opts.onSplash?.(this.localToWorld(local.clone()), strength);
  }

  private setPhase(p: KrakenPhase): void {
    if (p === this._phase) return;
    this._phase = p;
    this.opts.onPhase?.(p);
  }

  private grabOf(k: number, p: number): number {
    const T = KRAKEN_TIMELINE;
    const d = this.spots[k].delay * 0.5;
    return easeInOutCubic(range(p, T.grab[0] + d, T.grab[1] + d));
  }

  private apply(dt: number): void {
    const p = this.progress;
    const T = KRAKEN_TIMELINE;
    const e = this.elapsed;
    const sea = this.seaLevel;

    this.setPhase(
      p >= T.hidden
        ? "hidden"
        : p >= T.sink[0]
          ? "sink"
          : p >= T.grab[0]
            ? "grab"
            : p >= T.rise[0]
              ? "rise"
              : p >= T.sail[0]
                ? "sail"
                : "spawn",
    );

    // ---------------- boat ----------------
    const pop = easeOutBack(range(p, T.pop[0], T.pop[1]), 2.2);
    const drop = easeInQuad(range(p, T.drop[0], T.drop[1]));
    const sailT = easeInOutSine(range(p, T.sail[0], T.sail[1]));
    const sink = easeInCubic(range(p, T.sink[0], T.sink[1]));

    // The tentacles' combined grip is what rocks the boat.
    let grabAvg = 0;
    for (let k = 0; k < this.spots.length; k++) grabAvg += this.grabOf(k, p);
    grabAvg /= Math.max(1, this.spots.length);

    const pos = this.curve.getPointAt(sailT, this.tmp);
    const tan = this.curve.getTangentAt(Math.min(sailT, 0.999), this.tmp2);
    const speed01 = Math.sin(Math.PI * range(p, T.sail[0], T.sail[1])); // 0 -> 1 -> 0

    // A landing bounce after the drop.
    const sinceLand = range(p, T.drop[1], T.drop[1] + 0.06);
    const bounce =
      sinceLand > 0 && sinceLand < 1 ? Math.sin(sinceLand * Math.PI * 2) * (1 - sinceLand) * 0.12 : 0;

    const bob = 0.045 * Math.sin(e * 2.4);
    let y = sea + lerp(0.9, 0, drop) - bounce + bob;
    y -= 0.14 * grabAvg + 0.05 * grabAvg * Math.sin(e * 9);
    y -= sink * 3.4;

    const roll = 0.05 * Math.sin(e * 1.6) + 0.2 * grabAvg * Math.sin(e * 7.0) + sink * 0.35;
    const pitch =
      0.035 * Math.sin(e * 2.1 + 1) - 0.06 * speed01 + 0.1 * grabAvg * Math.sin(e * 5.3 + 0.7) + sink * 0.55;

    this.boatRig.position.set(pos.x, y, pos.z);
    this.boatRig.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
    this.boat.rotation.set(pitch, 0, roll);
    this.boatRig.visible = p < T.hidden;
    this.boatRig.scale.setScalar(Math.max(0.0001, pop));
    this.boat.update(e, 0.4 + 0.6 * speed01);

    // Splashes: the landing, the wake, the sinking.
    if (this.crossed(T.drop[1])) this.splash(this.tmp.set(pos.x, sea, pos.z), 1.0);
    if (this.playing && speed01 > 0.15 && p < T.sail[1]) {
      this.wakeTimer -= dt;
      if (this.wakeTimer <= 0) {
        this.wakeTimer = 0.2;
        const back = this.tmp2.set(-tan.x, 0, -tan.z).multiplyScalar(0.9).add(pos);
        this.fx.ring(back, 0.55, 1.2);
      }
    }
    if (this.crossed(T.sink[0] + 0.02)) this.splash(this.tmp.set(pos.x, sea, pos.z), 1.6);
    if (this.crossed(T.sink[0] + 0.09)) this.splash(this.tmp.set(pos.x, sea, pos.z), 1.0);

    // ---------------- tentacles ----------------
    const target = this.target;
    const n = this.tentacles.chains[0]?.length ?? 1;
    for (let k = 0; k < this.spots.length; k++) {
      const spot = this.spots[k];
      const anchor = this.tentacles.anchors[k];
      const L = this.tentacles.lengths[k];
      const seed = k * 1.913 + 0.37;

      const rise = easeOutBack(range(p, T.rise[0] + spot.delay, T.rise[1] + spot.delay), 1.4);
      const grab = this.grabOf(k, p);
      const tSink = easeInCubic(range(p, T.sink[0] - 0.01 + spot.delay * 0.3, T.sink[1] + 0.02));

      // The anchor slides in toward the boat as it takes hold.
      const rad = spot.radius * (1 - 0.18 * grab);
      const ax = target.x + Math.sin(spot.angle) * rad;
      const az = target.z + Math.cos(spot.angle) * rad;
      anchor.position.set(ax, sea - L * 1.05 * (1 - rise) - tSink * (L + 1.2), az);
      // Face the boat: the belly (+Z) toward the strike point.
      anchor.rotation.set(0, Math.atan2(target.x - ax, target.z - az), 0);
      this.tentacles.setActive(k, p < T.hidden + 0.02 && (rise > 0 || tSink < 1));

      if (this.crossed(T.rise[0] + spot.delay + 0.012)) this.splash(this.tmp.set(ax, sea, az), 0.7);

      const pre = rise * (1 - grab); // up and searching
      const squeeze = grab * (0.5 + 0.5 * Math.sin(e * 7 + seed)); // pulses with the rocking
      const hookMul = 0.8 + 0.4 * ((seed * 7.31) % 1);
      this.tentacles.pose(k, (u) => {
        const wave = Math.sin(e * 2.6 + seed * 3 - u * 4.5);
        // The curl lives in the last quarter of the chain.
        const spiral = Math.pow(u, 5) * (6 / n);
        let curl = pre * (0.22 * wave * (0.3 + u) + 1.1 * u * u * (3 / n) + 1.4 * spiral);
        // Taking hold: lean the base in, hook the tip over the hull.
        const lean = (1 - u) * (1 - u) * (3 / n) * 0.55;
        const hook = u * u * (3 / n) * (2.1 + 0.5 * tSink) * hookMul;
        curl += grab * (lean + hook + 1.8 * spiral + 0.05 * squeeze * u + 0.06 * wave * u);
        const sway = 0.1 * Math.sin(e * 1.9 + seed + u * 3.0) * (0.2 + u) * (1 - 0.5 * grab);
        return [curl, sway];
      });
    }
  }

  /** Frees every geometry and material this owns and removes it. */
  dispose(): void {
    this.removeFromParent();
    this.tentacles.dispose();
    this.boat.dispose();
    this.fx.dispose();
    for (const m of new Set(Object.values(this.materials))) m.dispose();
  }
}
