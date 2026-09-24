// OWNER: render-artist (IDEA-079)
//
// CLOUDS OVER THE CHAPTERS YOU HAVE NOT REACHED.
//
// Nuno: *"The clouds over the locked chapters could be a good improvement like
// a cloud ambience but when unlock they are clear."*
//
// ---------------------------------------------------------------------------
// SHROUDED, NOT HIDDEN — AND THAT IS THE WHOLE DESIGN CONSTRAINT
// ---------------------------------------------------------------------------
//
// [[IDEA-063]] v2 spent a revision establishing that a locked stone must stay
// SELECTABLE, because looking ahead at what the game contains is what this
// screen is for: a new player has thirty-nine locked levels, and a wall of
// padlocks with nothing behind them is a screen that tells them nothing.
//
// A cloud that OCCLUDES its chapter would undo that in one line. So these are
// translucent, they sit between the camera and the islands rather than on
// them, and they are deliberately sparse enough to read through. What they add
// is DISTANCE — the sense that the chapter is somewhere you have not been yet
// — not concealment. The pins stay on top regardless: they are HTML.
//
// ---------------------------------------------------------------------------
// FOUR THINGS
// ---------------------------------------------------------------------------
//
//  1. **ONE MESH PER CHAPTER, and the chapter is the unit because that is what
//     unlocks.** Progress advances a level at a time but a chapter clears as a
//     block, so a per-island cloud would have to fade in fives anyway and cost
//     forty draw calls to do it.
//
//  2. **THEY DRIFT, WHICH IS THE "AMBIENCE" HALF OF THE ASK.** A static cloud
//     is a lid. The motion is per-puff and incommensurate — the same rule
//     `ambience.ts` uses for its beds, and for the same reason: anything on
//     one shared period reads as a machine rather than as weather.
//
//  3. **A MATCAP, AND THE FIRST VERSION'S REASONING WAS BACKWARDS.** It shipped
//     for one render on `MeshBasicMaterial`, on the argument that a cloud is
//     "a soft value with no form to shade" and the toon ramp would band a white
//     blob into crumpled paper. The banding half is true; the conclusion was
//     not. UNLIT means NO shading, so every face of a blob returns the same
//     white and the whole thing collapses to a flat silhouette — they rendered
//     as white PLATES, or ice floes, not clouds. A matcap is the third option
//     neither half considered: a smooth gradient with no bands and no lights,
//     which is what puffiness actually is.
//
//  4. **THEY CLEAR BY OPACITY, NOT BY `visible`.** A chapter that unlocks
//     between two visits should feel like weather lifting, so `setProgress`
//     eases them out over a second or so the next time the map is opened. A
//     hard toggle is free and reads as a bug.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lobedFoliageGeometry } from "./foliage.js";
import { makeMatcapTexture } from "./matcap.js";

export interface CloudParams {
  /** Puffs per chapter. Sparse on purpose — see the shroud rule. */
  perChapter: number;
  /** How high the bank floats above the islands. Between the decks (y 0, props
   *  to ~1.3) and the camera, so it reads as being IN FRONT rather than on. */
  height: number;
  /** Vertical wander, so a bank is not a flat ceiling. */
  heightSpread: number;
  /** How far across the chain the bank spreads. */
  halfWidth: number;
  /**
   * A clear corridor down the middle of the chain, in world units.
   *
   * WITHOUT IT A PUFF LANDS ON A DECK AND READS AS FOG ON THE GROUND, not as
   * sky above it — at this camera a cloud three units up projects onto the
   * island behind it with no depth cue to separate them, so it simply looks
   * stuck to the deck. Keeping the centre line clear fixes that and serves the
   * shroud rule at the same time: the weather gathers AROUND a chapter you
   * have not reached instead of sitting on top of what you are trying to look
   * at. An island's radius is 2.1, so this clears it with margin.
   */
  centreGap: number;
  /** Puff size range. */
  minRadius: number;
  maxRadius: number;
  /** Settled opacity. Low enough to read an island through. */
  opacity: number;
  /** Drift speed in world units per second. */
  drift: number;
  /** How long a chapter's clouds take to lift once it unlocks, in seconds. */
  clearSeconds: number;
}

export const CLOUD_PARAMS: CloudParams = {
  // MORE AND SMALLER. Fourteen big puffs read as a handful of separate slabs;
  // a cloud bank is a crowd, and overlap is most of what makes one.
  perChapter: 30,
  height: 3.4,
  heightSpread: 1.1,
  halfWidth: 8.5,
  centreGap: 3.2,
  minRadius: 0.55,
  maxRadius: 1.15,
  // Low enough to read an island through — the shroud rule is the binding
  // constraint, not the look.
  opacity: 0.5,
  drift: 0.22,
  clearSeconds: 1.1,
};

export interface JourneyClouds {
  group: THREE.Group;
  /**
   * Which chapters are still locked.
   *
   * Takes the PROGRESS and works the rest out, rather than a list of booleans:
   * unlocking is strictly sequential here, so a caller passing its own array
   * would be a second place that could disagree about what "locked" means.
   */
  setProgress: (progress: number) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

interface Bank {
  mesh: THREE.Mesh;
  material: THREE.MeshMatcapMaterial;
  /** Where this bank wants to be: 1 while its chapter is locked, 0 after. */
  target: number;
  /** Where it is now. Eased toward `target` so a chapter clearing reads as
   *  weather lifting rather than as a switch. */
  now: number;
  /** Per-puff drift phases, so the bank moves as a crowd rather than a sheet. */
  phase: number;
}

/** Deterministic per-chapter jitter — a chapter must look the same every time
 *  the map is opened, for `journeyIsland.ts`'s reason: a place that rearranges
 *  itself between visits stops being a place. */
function rand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export interface CloudChapter {
  /** World z of the chapter's first and last island. */
  zFrom: number;
  zTo: number;
  /** Index of the first level in the chapter — a chapter is locked while
   *  progress has not reached it. */
  from: number;
}

/** Squashed wide and flat, which is most of what makes a blob a cloud rather
 *  than a ball. Named so the placement can account for the width it adds. */
const CLOUD_SCALE: [number, number, number] = [1.35, 0.72, 1.15];
const CLOUD_AMPLITUDE = 0.26;

export function makeJourneyClouds(
  chapters: readonly CloudChapter[],
  params: CloudParams = CLOUD_PARAMS,
): JourneyClouds {
  const group = new THREE.Group();
  group.name = "journey-clouds";
  const banks: Bank[] = [];

  // ONE texture for every puff in the map. A white body over a faintly blue
  // bounce, so the underside picks up the sea rather than going grey — the
  // same shared-bounce idea the rest of the style runs on.
  const matcap = makeMatcapTexture(0xffffff, 0xcfe6f7);

  chapters.forEach((ch, ci) => {
    const r = rand(ci + 1);
    const parts: THREE.BufferGeometry[] = [];
    // Padded past the chapter's own islands so a bank does not stop dead at a
    // boundary — weather has no edges, and a hard one would draw attention to
    // exactly the seam this is meant to soften.
    const zA = Math.max(ch.zFrom, ch.zTo) + 3;
    const zB = Math.min(ch.zFrom, ch.zTo) - 3;

    for (let i = 0; i < params.perChapter; i++) {
      const radius = params.minRadius + r() * (params.maxRadius - params.minRadius);
      // Lobed rather than spherical, for foliage.ts's own reason one subject
      // along: a sphere reads as a ball, and the outline wander is what makes
      // it read as something soft.
      const g = lobedFoliageGeometry(radius, {
        detail: 2,
        lobes: 7,
        sharpness: 6,
        amplitude: CLOUD_AMPLITUDE,
        scale: CLOUD_SCALE,
      });
      // Either side of the corridor, never through it — and pushed out by the
      // puff's OWN half-width, so it is the body that clears, not the centre.
      const side = r() < 0.5 ? -1 : 1;
      const halfExtent = radius * CLOUD_SCALE[0] * (1 + CLOUD_AMPLITUDE);
      const span = Math.max(0.5, params.halfWidth - params.centreGap);
      const across = side * (params.centreGap + halfExtent + r() * span);
      g.translate(
        across,
        params.height + (r() * 2 - 1) * params.heightSpread,
        zB + r() * (zA - zB),
      );
      parts.push(g);
    }

    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) return;

    // The matcap key is OMITTED rather than set to undefined when there is no
    // canvas (a headless test): three warns about an explicitly-undefined
    // parameter, and a warning that fires on every run is one nobody reads.
    const material = new THREE.MeshMatcapMaterial({
      ...(matcap ? { matcap } : {}),
      color: matcap ? 0xffffff : 0xf4f8ff,
      transparent: true,
      opacity: params.opacity,
      // A cloud must not punch a hole in the depth buffer for the islands
      // behind it — they are the thing being looked at THROUGH it.
      depthWrite: false,
      // FrontSide: a translucent DoubleSide blob blends its own far wall
      // through its near one, which muddies the shading the matcap is there
      // to provide, and doubles the fill for nothing.
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `cloud-chapter-${ci}`;
    // After the islands, so the blend is over them rather than under.
    mesh.renderOrder = 2;
    group.add(mesh);
    banks.push({ mesh, material, target: 1, now: 1, phase: r() * Math.PI * 2 });
  });

  let t = 0;
  // THE FIRST setProgress SNAPS; every later one EASES.
  //
  // Banks are built locked, so without this the first open of the map would
  // show a bank over every already-cleared chapter and then lift them all —
  // a second of weather clearing off ground the player finished weeks ago.
  // Easing is for the ONE chapter that changed while they were away, which is
  // the moment the effect exists for.
  let primed = false;

  return {
    group,
    setProgress(progress: number): void {
      chapters.forEach((ch, i) => {
        const bank = banks[i];
        if (!bank) return;
        bank.target = progress >= ch.from ? 0 : 1;
        if (!primed) {
          bank.now = bank.target;
          bank.material.opacity = params.opacity * bank.now;
          bank.mesh.visible = bank.now > 0.004;
        }
      });
      primed = true;
    },
    update(dt: number): void {
      t += dt;
      for (const b of banks) {
        if (b.now !== b.target) {
          // Exponential ease, as the camera rig uses: frame-rate independent,
          // and it never quite arrives, so it is snapped when close enough to
          // stop paying for a mesh nobody can see.
          const k = 1 - Math.exp(-(1 / params.clearSeconds) * 4 * dt);
          b.now += (b.target - b.now) * k;
          if (Math.abs(b.now - b.target) < 0.01) b.now = b.target;
          b.material.opacity = params.opacity * b.now;
          b.mesh.visible = b.now > 0.004;
        }
        if (!b.mesh.visible) continue;
        // Drift across the chain, not along it: along would look like the map
        // itself moving, which is what a pan already does.
        b.mesh.position.x = Math.sin(t * params.drift + b.phase) * 1.6;
        b.mesh.position.y = Math.sin(t * params.drift * 0.63 + b.phase * 1.7) * 0.18;
      }
    },
    dispose(): void {
      for (const b of banks) {
        group.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.material.dispose();
      }
      matcap?.dispose();
      banks.length = 0;
    },
  };
}
