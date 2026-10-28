import * as THREE from "three";
import type { MazeTheme } from "../../game/themes";
import { KrakenBoatEvent } from "./krakenBoatEvent";

/**
 * WHERE the kraken strikes on Pirate Island's board: the sea to the
 * north-west, in the spot the static wreck used to hold (Nuno: "change that
 * fixed boat by this"). The wreck itself is kept for the menu and shop
 * horizon, which have no game loop to animate anything.
 *
 * World units. The strike point and the whole route stay well out past the
 * swash (shore at z -16, wandering +-0.95), so the boat never sails onto the
 * beach and no tentacle breaks the surface on dry sand — `test-kraken.ts`
 * walks the act and holds every frame to that. It sits on a phone's north
 * band; a 16:9 desktop's frame ends at z -21.2, so desktop sees the boat's
 * approach and the tentacles' tops, as it saw the wreck's stern.
 */
export const ISLAND_KRAKEN_SITE = {
  x: -8.5,
  z: -21,
  /** A little over life-size: the act happens 25-40 px a unit on a phone. */
  scale: 1.15,
  /** Local route (before `scale`); the last point is the strike. In from the
   *  west, parallel to the coast, so the approach is in shot the whole way. */
  path: [
    new THREE.Vector3(-5, 0, 1.6),
    new THREE.Vector3(-3.2, 0, 1.8),
    new THREE.Vector3(-1.4, 0, 1.1),
    new THREE.Vector3(0, 0, 0),
  ],
  duration: 9,
  /** Empty sea between two acts. It is at the edge of the play area; a
   *  monster eating a boat every eight seconds, back to back, is the thing on
   *  screen rather than the scenery around it. */
  rest: 5,
} as const;

/** The island's kraken, or null for every other theme. Added to `scene`. */
export function buildIslandKraken(scene: THREE.Object3D, theme: MazeTheme): KrakenBoatEvent | null {
  if (theme.palette.surround !== "island") return null;
  const S = ISLAND_KRAKEN_SITE;
  const k = new KrakenBoatEvent({
    duration: S.duration,
    rest: S.rest,
    path: S.path.map((p) => p.clone()),
    // Mid-voyage, so a board that is never ticked (the preview, the editor)
    // still shows a boat under sail rather than an empty sea.
    initialProgress: 0.3,
  });
  k.position.set(S.x, 0, S.z);
  k.scale.setScalar(S.scale);
  scene.add(k);
  return k;
}
