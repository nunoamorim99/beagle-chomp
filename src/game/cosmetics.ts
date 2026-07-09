// OWNER: gameplay-engineer (IDEA-010 beagle skins — pure profile/cosmetics
// foundation for v2.0)
//
// Pure data + in-memory "equipped skin" state for beagle coat cosmetics. NO
// `three` import (src/render/* owns turning a BeagleCoat into materials — see
// src/render/characters.ts's makeBeagle, which currently reads COLORS.beagle*
// + a local EAR_BROWN const directly; a later render pass wires it to
// getEquippedBeagleSkin() instead) and NO localStorage/persistence here either
// — that's the isolated job of src/game/profileStore.ts, kept separate so
// this module stays trivially unit-testable in Node with zero browser globals
// (mirrors the "keep pure game logic free of side effects" split CLAUDE.md
// draws for src/game/* generally).

/** The four hex colors a beagle skin swaps, matching makeBeagle's material
 *  groups: tan = body/head/legs/tail, white = belly/snout/jaw/tail-tip,
 *  black = saddle/nose/eyes, ear = the ear pivots' own material (currently
 *  the EAR_BROWN local const in characters.ts). */
export interface BeagleCoat {
  tan: number;
  white: number;
  black: number;
  ear: number;
}

export interface BeagleSkin {
  id: string;
  name: string;
  coat: BeagleCoat;
}

export const BEAGLE_SKINS: readonly BeagleSkin[] = [
  {
    id: "bagel",
    name: "Bagel",
    // The current classic tricolor beagle — values MUST match
    // config.ts's COLORS.beagleTan/White/Black and characters.ts's
    // EAR_BROWN exactly, so equipping the default skin is a visual no-op
    // and nothing regresses for players who never touch the skin picker.
    coat: { tan: 0xc98a3c, white: 0xf4efe6, black: 0x2a2320, ear: 0x6b3f22 },
  },
  {
    id: "cookie",
    name: "Cookie",
    // Warm chocolate/liver coat: a rich chocolate-brown body in place of
    // tan, a soft cream (not stark white) belly, a deep dark-brown
    // "black" saddle/nose/eyes (kept a touch lighter than true black so
    // it doesn't flatten into a silhouette), and an ear a shade darker
    // than the body for a tonal, all-brown liver look.
    coat: { tan: 0x8a5a2b, white: 0xe8dcc8, black: 0x3a2416, ear: 0x5c3a1e },
  },
  {
    id: "muffin",
    name: "Muffin",
    // Pale lemon & white coat: a light lemon-tan body, bright white
    // belly/snout, and a soft warm brown (not near-black) for the
    // saddle/markings so it reads as a lemon beagle rather than a
    // tricolor; ear a gentle tan-brown that stays close to the body tone.
    coat: { tan: 0xe4c58a, white: 0xfaf6ee, black: 0x9c7248, ear: 0xb6864f },
  },
  {
    id: "pepper",
    name: "Pepper",
    // Cool blue-tick grey-black coat: a slate/blue-grey body, white
    // belly/snout, near-black saddle/nose/eyes for strong markings, and a
    // dark cool grey ear — deliberately cool-toned to contrast the three
    // warm coats above.
    coat: { tan: 0x7d8794, white: 0xf2f3f5, black: 0x1c1f24, ear: 0x4a4f57 },
  },
] as const;

export const DEFAULT_BEAGLE_SKIN_ID = "bagel";

/** Looks up a skin by id. Never throws — an unknown/stale id (e.g. read back
 *  from storage after a skin was renamed/removed) degrades to the default
 *  skin instead of breaking rendering. */
export function getBeagleSkin(id: string): BeagleSkin {
  return BEAGLE_SKINS.find((s) => s.id === id) ?? getDefaultBeagleSkin();
}

function getDefaultBeagleSkin(): BeagleSkin {
  // BEAGLE_SKINS is a non-empty readonly const above, and its first entry is
  // DEFAULT_BEAGLE_SKIN_ID by construction, but look it up by id rather than
  // index so the two can never silently drift apart.
  const found = BEAGLE_SKINS.find((s) => s.id === DEFAULT_BEAGLE_SKIN_ID);
  if (!found) {
    // Unreachable given the const above; satisfies strict TS without `any`
    // and gives a loud signal if BEAGLE_SKINS/DEFAULT_BEAGLE_SKIN_ID are ever
    // edited out of sync.
    throw new Error("cosmetics: DEFAULT_BEAGLE_SKIN_ID has no matching entry in BEAGLE_SKINS");
  }
  return found;
}

// ---------------------------------------------------------------------------
// In-memory equipped state. Module-level, not persisted here — see
// src/game/profileStore.ts for the localStorage bridge (initProfileFromStorage
// below reads it in, saveEquippedBeagleSkinId there is called by callers that
// want a change to survive reload).

let equippedBeagleSkinId: string = DEFAULT_BEAGLE_SKIN_ID;

export function getEquippedBeagleSkinId(): string {
  return equippedBeagleSkinId;
}

/** Sets the equipped skin id, in memory only (no persistence — see
 *  `equipBeagleSkin` below for the persisting wrapper UI code should call).
 *  Ignores unknown ids (clamps to the default) so callers can never leave
 *  the module in a state where getEquippedBeagleSkin() would need to guess. */
export function setEquippedBeagleSkinId(id: string): void {
  equippedBeagleSkinId = BEAGLE_SKINS.some((s) => s.id === id) ? id : DEFAULT_BEAGLE_SKIN_ID;
}

export function getEquippedBeagleSkin(): BeagleSkin {
  return getBeagleSkin(getEquippedBeagleSkinId());
}

/** Returns the next skin id after `currentId` in BEAGLE_SKINS order,
 *  wrapping around — used by the temporary cycle button until a real skin
 *  picker UI exists. An unknown current id returns the first skin's id
 *  (i.e. treats "not found" as "before the start of the list"). */
export function cycleBeagleSkinId(currentId: string): string {
  const idx = BEAGLE_SKINS.findIndex((s) => s.id === currentId);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % BEAGLE_SKINS.length;
  return BEAGLE_SKINS[nextIdx].id;
}

// Note: the localStorage bridge (initProfileFromStorage / equipBeagleSkin)
// lives in profileStore.ts, not here — this module stays pure data +
// in-memory state with zero browser globals and zero dependency on
// profileStore.ts, so profileStore.ts can depend on cosmetics.ts (for
// BEAGLE_SKINS validation) without creating an import cycle.

// ---------------------------------------------------------------------------
// IDEA-009 enemy skins. Mirrors the BeagleSkin section above exactly (same
// registry/default/getter/setter/cycle shape), but with one key difference:
// an EnemySkin does NOT carry any color. The three team colors
// (rose/teal/amber — see COLORS.ghost* in config.ts) plus the frightened/eaten
// palette are applied per-enemy by the renderer at build time, independent of
// which skin is equipped. An enemy skin only swaps the creature's FORM (e.g.
// classic ghost blob vs. a garden beetle), whereas a beagle skin swaps COLOR
// only (same coat shape, different hex values). So EnemySkin is just id+name
// — no coat/color payload to look up here.

export interface EnemySkin {
  id: string;
  name: string;
}

export const ENEMY_SKINS: readonly EnemySkin[] = [
  { id: "ghost", name: "Ghost" },
  { id: "beetle", name: "Beetle" },
  { id: "bee", name: "Bee" },
  { id: "ladybug", name: "Ladybug" },
] as const;

export const DEFAULT_ENEMY_SKIN_ID = "ghost";

/** Looks up an enemy skin by id. Never throws — an unknown/stale id degrades
 *  to the default skin instead of breaking rendering. */
export function getEnemySkin(id: string): EnemySkin {
  return ENEMY_SKINS.find((s) => s.id === id) ?? getDefaultEnemySkin();
}

function getDefaultEnemySkin(): EnemySkin {
  // ENEMY_SKINS is a non-empty readonly const above, and its first entry is
  // DEFAULT_ENEMY_SKIN_ID by construction, but look it up by id rather than
  // index so the two can never silently drift apart.
  const found = ENEMY_SKINS.find((s) => s.id === DEFAULT_ENEMY_SKIN_ID);
  if (!found) {
    // Unreachable given the const above; satisfies strict TS without `any`
    // and gives a loud signal if ENEMY_SKINS/DEFAULT_ENEMY_SKIN_ID are ever
    // edited out of sync.
    throw new Error("cosmetics: DEFAULT_ENEMY_SKIN_ID has no matching entry in ENEMY_SKINS");
  }
  return found;
}

// In-memory equipped state. Module-level, not persisted here — see
// src/game/profileStore.ts for the localStorage bridge.

let equippedEnemySkinId: string = DEFAULT_ENEMY_SKIN_ID;

export function getEquippedEnemySkinId(): string {
  return equippedEnemySkinId;
}

/** Sets the equipped enemy skin id, in memory only (no persistence — see
 *  `equipEnemySkin` in profileStore.ts for the persisting wrapper UI code
 *  should call). Ignores unknown ids (clamps to the default) so callers can
 *  never leave the module in a state where getEquippedEnemySkin() would need
 *  to guess. */
export function setEquippedEnemySkinId(id: string): void {
  equippedEnemySkinId = ENEMY_SKINS.some((s) => s.id === id) ? id : DEFAULT_ENEMY_SKIN_ID;
}

export function getEquippedEnemySkin(): EnemySkin {
  return getEnemySkin(getEquippedEnemySkinId());
}

/** Returns the next skin id after `currentId` in ENEMY_SKINS order, wrapping
 *  around — mirrors cycleBeagleSkinId. An unknown current id returns the
 *  first skin's id (i.e. treats "not found" as "before the start of the
 *  list"). */
export function cycleEnemySkinId(currentId: string): string {
  const idx = ENEMY_SKINS.findIndex((s) => s.id === currentId);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % ENEMY_SKINS.length;
  return ENEMY_SKINS[nextIdx].id;
}
