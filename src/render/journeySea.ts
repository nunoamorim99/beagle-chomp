// OWNER: render-artist (IDEA-079)
//
// THE SEA the Journey archipelago sits in — water, shoreline foam and the rocks
// between the islands.
//
// ---------------------------------------------------------------------------
// WHY A FLAT PLANE READ AS "AN EMPTY SCREEN WITH SOME ISLANDS"
// ---------------------------------------------------------------------------
//
// Nuno's words, and the cause is the renderer rather than the colour. The scene
// is cel-shaded on a THREE-STEP ramp that quantises by the surface NORMAL
// (toon.ts). A flat plane has exactly one normal, so however it is tinted it
// resolves to exactly ONE band of flat colour across the whole frame — which is
// the definition of an empty screen.
//
// So the fix is the same one IDEA-068 used on the maze wall, one surface along:
// **the geometry exists to produce BANDING, not to be seen as bumps.** A gentle
// swell is invisible as a shape at map distance and completely changes what the
// ramp does with it — the water falls into two or three values and starts
// reading as a surface with light on it.
//
// Everything else here is the cartoon vocabulary this project already uses for
// ground: a handful of named tones, real shapes rather than per-pixel noise,
// and nothing smaller than a couple of pixels (paint.ts's CARTOON rule).
//
// ---------------------------------------------------------------------------
// WHAT IT COSTS
// ---------------------------------------------------------------------------
//
// Four draw calls for the whole ocean, whatever the chain length: the water
// (one mesh), the shoreline foam (all islands merged), the open-water rocks
// (merged) and their foam collars (merged). Draw calls are this project's
// budget, not triangles (IDEA-065 rule 3), so everything that repeats is
// merged up front rather than added as a child per island.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon } from "./toon";
import { rng } from "./paint";
import {
  createSeaMaterial,
  createShoreMaterial,
  shoreRibbonGeometry,
  WATER_PARAMS,
} from "./journeyWater.js";

export interface SeaParams {
  /** Height of the waterline in world units. It must sit INSIDE an island
   *  body's own vertical range, or the islands float — which is not a figure of
   *  speech: the first build had the plane 0.3 below every island's base and
   *  you could see daylight under all forty. */
  waterY: number;
  /** Half-width of the ocean across the chain. */
  halfWidth: number;
  /** Rocks per 100 units of chain. */
  rockDensity: number;
  /** How far from the chain's centre line rocks may sit, as a fraction of
   *  `halfWidth`. TUNED FROM THE FRAME, not from the ocean: the camera sees
   *  roughly |x| < 8 at island distance, so the first build's 0.62 (about +-43
   *  units) scattered them almost entirely off screen — twenty-seven rocks
   *  built, merged, drawn, and essentially never visible. */
  rockSpread: number;
}


export const SEA_PARAMS: SeaParams = {
  waterY: -0.42,
  halfWidth: 70,
  rockDensity: 16,
  rockSpread: 0.2,
};

/** The open-water base tone. Every theme tints away from this rather than
 *  replacing it — see `makeJourneySea`'s gradient note. */
export const SEA_BASE = 0x2f7fb5;

/**
 * THE DEEP AND THE SHALLOW, which is what makes water read as water.
 *
 * Depth is the one cue a real island always has and a disc laid on a sheet
 * never does — and it has to be a big smooth field, not a ring, because a ring
 * is a halo. Both are applied in the water's own VERTEX COLOUR rather than as
 * translucent discs on top of it: a pale disc over dark water composites to
 * grey-blue, which is precisely why the first shoreline read as a flat lozenge
 * of grey stuck onto the sea. This costs no draw call and no sorting, and it
 * grades smoothly where a ring has an edge.
 */
export const SEA_DEEP = 0x1b527d;
export const SEA_SHALLOW = 0x86dcd9;

export interface JourneySea {
  group: THREE.Group;
  /** Shader materials wanting a per-frame `uTime` / `uCenter`. */
  animated: THREE.ShaderMaterial[];
  dispose: () => void;
}

export interface SeaIsland {
  position: THREE.Vector3;
  radius: number;
  /** The island's theme palette `bg`, which the water is tinted toward. */
  tint: number;
}

export function makeJourneySea(
  islands: readonly SeaIsland[],
  zFrom: number,
  zTo: number,
  params: SeaParams = SEA_PARAMS,
): JourneySea {
  const group = new THREE.Group();
  group.name = "journey-sea";
  const disposables: Array<{ dispose: () => void }> = [];
  const animated: THREE.ShaderMaterial[] = [];

  const depth = Math.abs(zTo - zFrom);
  const midZ = (zFrom + zTo) / 2;

  // THE SURFACE IS FLAT, and that is the madbox position rather than a
  // simplification: "the water surface never moves". There was a `heightAt`
  // here so a caller could float something on the swell; with no swell it
  // returned `params.waterY` and nothing ever called it, so it went with the
  // swell rather than staying as an API promising a variation that no longer
  // exists.


  // --- the sea ---------------------------------------------------------------
  //
  // A FLAT UNLIT PLANE CARRYING A RADIAL GRADIENT, plus one merged coastline
  // ribbon doing animated foam and a contact shadow (journeyWater.ts).
  //
  // It replaced a displaced, toon-lit, canvas-textured plane with lagoon
  // discs, and the two shipped side by side behind `?sea=` for as long as the
  // comparison was live. That is settled, so the loser is gone rather than
  // left as a second sea to keep working — the standing rule here is that an
  // A/B stays only while it is still answering something.
  const wp = WATER_PARAMS;

  // ONE QUAD. Their sea is a 200-triangle mesh shaped to the composition;
  // ours has no composition to be shaped to, because the map pans, and a
  // gradient evaluated in world space needs no vertices to carry it.
  const geo = new THREE.PlaneGeometry(params.halfWidth * 2, depth, 1, 1);
  const mat = createSeaMaterial(wp);
  const water = new THREE.Mesh(geo, mat);
  water.name = "sea-water";
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, params.waterY, midZ);
  // NO `receiveShadow`: the material is unlit and would ignore it anyway,
  // and leaving it true implies a lighting path that does not exist here.
  group.add(water);
  disposables.push(geo, mat);
  animated.push(mat);

  const ribbon = shoreRibbonGeometry(islands, wp, params.waterY);
  if (ribbon) {
    const shoreMat = createShoreMaterial(wp);
    const shore = new THREE.Mesh(ribbon, shoreMat);
    shore.name = "sea-shore";
    // AFTER the sea in the draw order. It is transparent with depthWrite
    // off, so it must not be sorted in front of nothing.
    shore.renderOrder = 1;
    group.add(shore);
    disposables.push(ribbon, shoreMat);
    animated.push(shoreMat);
  }

  // --- rocks in the open water ----------------------------------------------
  //
  // The thing that stops the water between islands being empty. They are the
  // reason it reads as an ARCHIPELAGO — scattered stone is what tells you the
  // islands are the tops of something rather than discs laid on a sheet.
  //
  // Placed off the lanes and never inside a lagoon: a rock in the shallows
  // reads as debris against the one island the player is looking at.
  {
    const rand = rng(0x15_1a_2d);
    const count = Math.max(0, Math.round((depth / 100) * params.rockDensity));
    const rocks: THREE.BufferGeometry[] = [];
    const collars: THREE.BufferGeometry[] = [];
    // In gradient mode a rock gets the SAME coastline treatment an island does
    // — it is a circle in water, which is the only thing `shoreRibbonGeometry`
    // needs. The flat pale collar that stood in for it reads as a grey donut
    // the moment the sea is a saturated cyan, and a rock with real foam round
    // it is what tells you the water has a surface at all out there.
    const rockShores: Array<{ position: THREE.Vector3; radius: number }> = [];

    for (let i = 0; i < count * 3 && rocks.length < count; i++) {
      const x = (rand() * 2 - 1) * params.halfWidth * params.rockSpread;
      const z = zFrom - rand() * depth;
      let clear = true;
      for (const isl of islands) {
        if (Math.hypot(x - isl.position.x, z - isl.position.z) < isl.radius * 2.2) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      const r = 0.22 + rand() * 0.3;
      const g = new THREE.IcosahedronGeometry(r, 0);
      // Squashed and turned: an unmodified icosahedron at this size is a
      // recognisable die, and twenty identical dice in a row is worse than
      // bare water.
      g.scale(1, 0.55 + rand() * 0.35, 1);
      g.rotateY(rand() * Math.PI * 2);
      // PROUD OF THE WATER, not flush with it. Sat at the waterline the rock is
      // a dark top inside a white foam ring, which from the map camera's
      // shallow angle reads as a HOLE rather than as stone — a manhole in the
      // sea. Only the steeper first camera hid it; the framing change is what
      // exposed it.
      g.translate(x, params.waterY + r * 0.34, z);
      rocks.push(g);

      rockShores.push({ position: new THREE.Vector3(x, 0, z), radius: r * 1.25 });
    }

    if (rocks.length > 0) {
      const mergedRock = mergeGeometries(rocks, false);
      const mergedCollar = collars.length ? mergeGeometries(collars, false) : null;
      if (rockShores.length > 0) {
        // Their own foam, on their own ribbon, merged into ONE more mesh —
        // never folded into the islands' ribbon, because these sit at a
        // different scale and want a much tighter noise frequency.
        const rg = shoreRibbonGeometry(rockShores, { ...WATER_PARAMS, frequency: [3, 6], ribbonOuter: 2.6 }, params.waterY);
        if (rg) {
          const rm = createShoreMaterial({ ...WATER_PARAMS, frequency: [3, 6], aoAlpha: WATER_PARAMS.aoAlpha * 0.8 });
          const rmesh = new THREE.Mesh(rg, rm);
          rmesh.name = "sea-rock-shore";
          rmesh.renderOrder = 1;
          group.add(rmesh);
          disposables.push(rg, rm);
          animated.push(rm);
        }
      }
      for (const g of rocks) g.dispose();
      for (const g of collars) g.dispose();

      if (mergedRock) {
        const mat = toon({ color: 0x5c6472 });
        const m = new THREE.Mesh(mergedRock, mat);
        m.name = "sea-rocks";
        group.add(m);
        disposables.push(mergedRock, mat);
      }
      if (mergedCollar) {
        const mat = toon({ color: 0xeaf6ff, transparent: true, opacity: 0.75 });
        const m = new THREE.Mesh(mergedCollar, mat);
        m.name = "sea-rock-foam";
        group.add(m);
        disposables.push(mergedCollar, mat);
      }
    }
  }

  return {
    group,
    animated,
    dispose(): void {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
