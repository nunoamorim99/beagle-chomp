// OWNER: render-artist
// The theme's real SURFACES, applied to the showcase scenes.
//
// The menu vignette and the shop previews were already themed — palette
// colours, palette lighting — but they were themed the way the board was
// BEFORE wallTexture.ts and floorTexture.ts existed: flat colour on a plain
// box, flat colour on a plain disc. So the one screen where a player is
// deciding whether to BUY a theme showed strictly less of it than the maze
// they were buying it for. A hedge maze, a beach and a night city arrived as
// three shades of the same moulded plastic.
//
// This is the shared half of the fix — the part both showcases need and
// neither should own a private copy of. The wall map comes straight from
// wallTextureFor (cached, shared with the real board, so a showcase hedge and
// a maze wall are literally the same surface). The floor map is drawn from a
// small hand-authored tile patch instead of a maze, because those patterns
// FOLLOW THE CORRIDORS and a showcase has no grid — see floorPreviewTexture.
//
// Two rules carried over from board.ts's syncBoardMaterials, both load-bearing:
//
//  1. A floor texture bakes `palette.floor` in as its own ground, so the
//     material must be held at WHITE while one is present or the tint lands
//     twice and drags the surface toward black.
//  2. Swapping a `map` between null and a texture changes the shader program,
//     so `needsUpdate` is required — and only when the map actually changed,
//     since a needless recompile stalls the frame.
import * as THREE from "three";
import type { ThemePalette } from "../game/themes";
import { floorPreviewTexture } from "./floorTexture";
import { wallTextureFor } from "./wallTexture";

/**
 * The tile patch under a round vignette disc — the menu's garden patch and the
 * shop's character stage.
 *
 * A crossroads with a wall above and below it, which is the smallest layout
 * that still says every theme's piece: the garden gets stepping stones with
 * lawn to either side, the park gets its gravel walk with grass verges, and
 * the city gets a lane marking (a dash only appears on a straight run with a
 * wall across it — a patch of pure corridor would be one blank sheet of
 * asphalt, which is exactly the detail the player is looking for).
 *
 * Three tiles across, because the disc is ~2.3 units wide and a maze tile is
 * 1 — so the pattern lands at close to the size it will be underfoot in a
 * real run rather than a shrunken doll's-house version of it.
 */
export const VIGNETTE_CELLS: readonly string[] = [".#.", "...", ".#."];

/** Every material in a showcase that stands in for part of the real board. */
export interface ShowcaseSurfaces {
  /** Materials playing the part of the board's WALLS — hedges, wall blocks. */
  wall: readonly THREE.MeshToonMaterial[];
  /** Materials playing the part of the board's FLOOR — the soil disc, a slab. */
  floor: readonly THREE.MeshToonMaterial[];
  /** The tile patch the floor materials are painted from. Pick one whose
   *  corridors match the ground the camera can actually see. */
  cells: readonly string[];
}

/**
 * Re-surfaces a showcase for `palette`, in place.
 *
 * Each scene still tints its OWN materials from the palette — it knows which
 * of its parts maps to which board slot and this does not. What this owns is
 * the surfaces, and with them the `wall` and `floor` COLOURS, for the one
 * reason given in rule 1 above: both textures bake the palette colour in, so
 * the material has to stay white while one is present. A scene that also
 * paints those two slots itself would be tinting them twice.
 *
 * Safe to call repeatedly (every theme switch): the outgoing floor texture is
 * disposed here, since nothing else owns it.
 */
export function applyShowcaseSurfaces(s: ShowcaseSurfaces, palette: ThemePalette): void {
  const wallMap = wallTextureFor(palette.wallTexture, palette.wall);
  for (const m of s.wall) {
    if (m.map !== wallMap) {
      m.map = wallMap;
      m.needsUpdate = true;
    }
    // A wall texture bakes palette.wall in, so the material stays white while
    // one is present — the same rule the floor materials follow below.
    m.color.setHex(wallMap ? 0xffffff : palette.wall);
  }

  // One texture for every floor material in the showcase — they are all the
  // same ground, and drawing it once per material would pay for the same
  // canvas twice.
  const previous = s.floor[0]?.map ?? null;
  const next = floorPreviewTexture(palette.floorTexture, s.cells, palette.floor);
  if (previous !== next) previous?.dispose();
  for (const m of s.floor) {
    if (m.map !== next) {
      m.map = next;
      // The emissive lift every floor palette carries is added AFTER the map
      // multiplies, so on the dark themes it swamps the pattern unless the
      // same texture drives it — see floorTexture.ts's header.
      m.emissiveMap = next;
      m.needsUpdate = true;
    }
    m.color.setHex(next ? 0xffffff : palette.floor);
  }
}

/** Releases the floor texture a showcase is holding. Call from dispose(). */
export function disposeShowcaseSurfaces(s: ShowcaseSurfaces): void {
  s.floor[0]?.map?.dispose();
}
