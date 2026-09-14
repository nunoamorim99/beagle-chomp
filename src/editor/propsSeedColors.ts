// OWNER: render-artist / editor
// The value a COLOUR field snaps to the first time the Props tab turns it on.
//
// This is a separate module from propsInspector.ts for one reason: it is PURE
// (no lil-gui, no DOM), so `scripts/test-garden-props.ts` can import it and
// assert that every colour field a shape exposes actually has a seed. That
// assertion is the point of the file — see below.
//
// **A SEED DEFAULT THAT DEPENDS ON ANOTHER FIELD'S VALUE CANNOT BE A
// CONSTANT, AND A MISSING SEED IS WHITE.** This project has now shipped that
// defect twice, in the same shape both times:
//
//   IDEA-060 — `petalColor`/`centerColor` went into the flat field-to-number
//   table, so opening "petal color" on the SUNFLOWER seeded it with the
//   DAISY's cream and wrote that into props.ts on the next save.
//
//   IDEA-065 — `furColor`/`bellyColor`/`accentColor` went into the colour
//   field list and into NO seed table at all. The fallback is `0xffffff`, so
//   merely SELECTING a critter in the Props tab wrote white into its params,
//   and a save persisted it: all six woodland animals shipped pure white,
//   with their per-kind palettes in forestCritters.ts intact and unreachable
//   because a def-level override now existed.
//
// The second one is worse than the first and for an instructive reason: the
// flower defect repainted a flower as a DIFFERENT flower, which looks like a
// bug. A missing seed paints white, which looks like a lighting problem, a
// material problem, or a merge problem — every place I looked before looking
// here.
//
// So the rule is enforced rather than documented: `seedColorFor` is the only
// way the inspector may pick a starting colour, and the test asserts that no
// colour field reachable from `PROP_SHAPE_FIELDS` falls through to white.
import type { PropParams } from "../game/props";

/** Colour fields with ONE right answer, independent of every other field. */
export const FIELD_SEED_COLOR: Partial<Record<keyof PropParams, number>> = {
  windowColor: 0xf4d060,
  trunkColor: 0x6b4a2f,
  glowColor: 0xf4d060,
  signBoardColor: 0x33333c,
  birdColor: 0x3f9ede,
  // IDEA-065.
  eyeColor: 0xe8c24a,
  roofColor: 0x4a3a33,
};

/**
 * Seed colours for `petalColor`/`centerColor`, PER FLOWER KIND.
 * Mirrors gardenProps.ts's FLOWER_DEFAULTS, which is what the factory reads
 * when a def leaves these unset.
 */
export const FLOWER_SEED_COLORS: Record<string, { petalColor: number; centerColor: number }> = {
  daisy: { petalColor: 0xfaf6ec, centerColor: 0xf2b632 },
  sunflower: { petalColor: 0xf5c518, centerColor: 0x6b4526 },
  rose: { petalColor: 0xd8384a, centerColor: 0x9c2333 },
  tulip: { petalColor: 0xd42f4c, centerColor: 0xf09aa8 },
  blossom: { petalColor: 0xb289de, centerColor: 0xf3e46a },
};

/**
 * Seed colours for the three critter tones, PER CRITTER KIND.
 * Mirrors forestCritters.ts's CRITTER_COLORS, for FLOWER_SEED_COLORS' reason:
 * these are what the factory actually uses when a def leaves them unset, so
 * turning the control on must not change what is on screen.
 */
export const CRITTER_SEED_COLORS: Record<
  string,
  { furColor: number; bellyColor: number; accentColor: number }
> = {
  deer: { furColor: 0xc97f3e, bellyColor: 0xf2e2c8, accentColor: 0x6b4a2f },
  fox: { furColor: 0xe07a2c, bellyColor: 0xf6efe2, accentColor: 0x2e2620 },
  rabbit: { furColor: 0xd9a468, bellyColor: 0xf4e3c6, accentColor: 0xe8a3a0 },
  raccoon: { furColor: 0x8d8a86, bellyColor: 0xc9c4bc, accentColor: 0x2f2c2a },
  squirrel: { furColor: 0xd4682a, bellyColor: 0xf3e6d2, accentColor: 0x8a3f14 },
  squirrelExplorer: { furColor: 0xdd6f24, bellyColor: 0xf6ead6, accentColor: 0xd8c99a },
};

/** Colour fields whose seed depends on another field, and on which one. */
export const KIND_DEPENDENT_COLOR_FIELDS: Partial<Record<keyof PropParams, "flowerKind" | "critterKind">> = {
  petalColor: "flowerKind",
  centerColor: "flowerKind",
  furColor: "critterKind",
  bellyColor: "critterKind",
  accentColor: "critterKind",
};

/**
 * The starting colour for `key` given the def's CURRENT params.
 *
 * Returns `undefined` when nothing knows — which the caller must treat as a
 * reason not to offer the control rather than as a licence to use white. That
 * signature is deliberate: the previous `?? 0xffffff` made "nobody wrote a
 * seed for this field" indistinguishable from "the answer is white".
 */
export function seedColorFor(key: keyof PropParams, params: PropParams): number | undefined {
  const dependsOn = KIND_DEPENDENT_COLOR_FIELDS[key];
  if (dependsOn === "flowerKind") {
    const kind = (params.flowerKind ?? "daisy") as string;
    const row = FLOWER_SEED_COLORS[kind] ?? FLOWER_SEED_COLORS.daisy;
    return row[key as "petalColor" | "centerColor"];
  }
  if (dependsOn === "critterKind") {
    const kind = (params.critterKind ?? "rabbit") as string;
    const row = CRITTER_SEED_COLORS[kind] ?? CRITTER_SEED_COLORS.rabbit;
    return row[key as "furColor" | "bellyColor" | "accentColor"];
  }
  return FIELD_SEED_COLOR[key];
}
