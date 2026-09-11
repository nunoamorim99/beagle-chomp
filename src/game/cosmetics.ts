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
  /**
   * Paw/sock colour. OPTIONAL, and falls back to `white` when absent — which
   * is exactly what the paws used to be painted with, so every coat written
   * before this channel existed is a byte-for-byte no-op.
   *
   * It exists because a skin can want feet that are not the same colour as the
   * belly and snout (see `pacbeagle`'s red boots), and those three shared one
   * material until now.
   */
  paw?: number;
  /**
   * Eyebrow colour. OPTIONAL, and its ABSENCE is meaningful: the beagle has no
   * brows by default, so a coat that omits this hides them entirely. Only a
   * skin that wants that expression asks for it.
   *
   * The meshes are always built (hidden), never conditionally created — a live
   * skin switch recolours an existing model in place (see applyBeagleSkin), so
   * anything a skin can turn on has to already be there to turn on.
   */
  brow?: number;
  /**
   * Nose leather. OPTIONAL: omitted means the fixed near-black every coat
   * wore before the channel existed. Per-skin because it does NOT follow
   * `black` — Cookie's saddle is liver-brown but Nuno wants its nose black,
   * and the Pac-Beagle's nose is the tribute orange.
   */
  nose?: number;
  /** Iris colour. OPTIONAL: omitted means the default amber. */
  iris?: number;
}

/**
 * IDEA-064: what a coat DOES, beyond what it looks like.
 *
 * Every beagle carries exactly one perk, and the perk is part of the coat's
 * identity rather than a separate purchase — which is the whole reason the shop
 * calls these "Beagles" and not "skins". A later cosmetic layer (pirate hat,
 * football kit) dresses a beagle; it does not replace one, and it carries no
 * perk of its own.
 *
 * Only the ID lives here. The MAGNITUDES are balance numbers and live in
 * config.ts's BEAGLE_PERKS, and the rules for reading either — including that
 * perks are CLASSIC ONLY — live in perks.ts. Nothing else may map an id to a
 * number.
 *
 * "unlocksTribute" is the odd one and is written down rather than left as an
 * absence: the Pac-Beagle's perk is that owning it reveals the Ghost enemy and
 * the Arcade Night board. That happens at PURCHASE time in profileStore, so
 * there is nothing for perks.ts to compute during a run — but a coat with no
 * `perk` field at all would read as an oversight, and the shop needs a line to
 * print for it like it does for the other four.
 */
export type BeaglePerkId =
  | "startShield"
  | "extraLifePerMap"
  | "doubleCoins"
  | "fruitBonus"
  | "unlocksTribute";

export interface BeaglePerk {
  id: BeaglePerkId;
  /** One line for the shop card, in the player's language. Says what the perk
   *  DOES, never what it is called internally. */
  label: string;
}

export interface BeagleSkin {
  id: string;
  name: string;
  /**
   * One line for the shop, in the player's language rather than the
   * renderer's.
   *
   * The info bar used to show the name and the price and nothing else, so a
   * player choosing between five coats had only four dots of colour to go
   * on. Moving the price into the action button freed the line, and this is
   * what goes in it. Required, not optional: a card with no description is a
   * card with a hole in it.
   *
   * IDEA-064: it describes what the coat IS — its colours and markings — and
   * never what its perk DOES. The perk has its own line directly underneath
   * (`.shop-hero-perk`), and a blurb that repeated it would put the same fact
   * in two adjacent rows, which is the exact duplication that moving the price
   * onto the action button removed from this panel in the first place.
   */
  blurb: string;
  coat: BeagleCoat;
  /**
   * IDEA-064: the one thing this beagle does that the others don't.
   *
   * Required, not optional. A coat with no perk would be strictly worse than
   * every other coat for the same price, and "which beagle do I take in" is
   * meant to be a real decision rather than a colour preference.
   */
  perk: BeaglePerk;
  /** Shop price in coins (IDEA-012). 0 means "owned from the start, never
   *  purchasable" — currently true only for the default skin. */
  price: number;
}

export const BEAGLE_SKINS: readonly BeagleSkin[] = [
  {
    id: "bagel",
    name: "Bagel",

    blurb: "The classic tricolor · tan, white and black",
    // The classic tricolor beagle. tan/white/black MUST stay identical to
    // config.ts's COLORS.beagleTan/White/Black (test-cosmetics asserts it),
    // so equipping the default skin is a visual no-op.
    //
    // `ear` is the coat's MID-BROWN: it dresses the ear leather AND the
    // saddle's blend band, which is why it is a light tan-brown rather than
    // the near-black it used to be. It has to work as the step between
    // `tan` and `black`, not just as an ear colour — and it carries more of
    // that job now that `black` is a real black rather than a dark brown.
    coat: { tan: 0xd6934f, white: 0xf0efec, black: 0x1b1815, ear: 0xb87438, nose: 0x141210 },
    // The free coat has a real perk on purpose. It is the one every player
    // starts on, so a blank slot there would make "beagles have powers" a thing
    // you only discover after spending 25 coins — and a shield is the perk that
    // teaches the shield power-up's own rules for free.
    perk: { id: "startShield", label: "Starts every run with a shield" },
    // Default skin: free and always owned (see profileStore.ts's
    // defaultProfile()).
    price: 0,
  },
  {
    id: "cookie",
    name: "Cookie",

    blurb: "Warm chocolate liver coat · cream belly",
    // Warm chocolate/liver coat: a rich chocolate-brown body in place of
    // tan, a soft cream (not stark white) belly, a deep dark-brown
    // "black" saddle/nose/eyes (kept a touch lighter than true black so
    // it doesn't flatten into a silhouette), and an ear a shade darker
    // than the body for a tonal, all-brown liver look.
    coat: { tan: 0x8a5a2b, white: 0xe8dcc8, black: 0x3a2416, ear: 0x5c3a1e, nose: 0x141210, iris: 0x4f3215 },
    // The endurance coat: a life at the start of every map, the first included,
    // so a run opens on four. LIVES.max is what keeps it honest — the grant is
    // wasted at the cap, so Cookie buys depth on a long run rather than
    // immortality on a short one.
    perk: { id: "extraLifePerMap", label: "An extra life at the start of every map" },
    price: 25,
  },
  {
    id: "muffin",
    name: "Muffin",

    blurb: "Pale lemon and white · soft brown markings",
    // Pale lemon & white coat: a light lemon-tan body, bright white
    // belly/snout, and a soft warm brown (not near-black) for the
    // saddle/markings so it reads as a lemon beagle rather than a
    // tricolor; ear a gentle tan-brown that stays close to the body tone.
    coat: { tan: 0xe4c58a, white: 0xfaf6ee, black: 0x9c7248, ear: 0xb6864f, nose: 0x141210, iris: 0x6f522e },
    // The money maker. Coins are the whole shop economy and there are only five
    // in a map (IDEA-016 v2 removed every other source), so doubling them is
    // the strongest long-game perk here — and the only one that pays out after
    // the run is over rather than during it.
    perk: { id: "doubleCoins", label: "Every coin you grab is worth double" },
    price: 25,
  },
  {
    id: "pacbeagle",
    name: "Pac-Beagle",

    blurb: "Yellow coat, red boots · angry arcade brows",
    // A tip of the collar to the game this one is descended from. The mapping
    // of the reference onto the beagle's own material groups is deliberate
    // rather than a flat repaint:
    //   tan   -> the body yellow
    //   white -> a PALER yellow, not white, so belly/snout/blaze stay in family
    //   black -> the deep orange the saddle and nose wear (a black saddle on a
    //            yellow dog reads as a shadow, not a marking)
    //   ear   -> the mid orange, sitting between the two above
    //   paw   -> the red boots
    //   brow  -> the angry black brows, the one thing that makes it read as a
    //            tribute rather than as a yellow dog
    // Buying this also unlocks the Ghost AND the Arcade Night board — see
    // TRIBUTE_ENEMY_SKIN_ID and themes.ts's TRIBUTE_MAZE_THEME_ID. That IS its
    // perk (IDEA-064): it is the only coat whose power is paid out once, at the
    // till, instead of every run.
    // Brighter than the first pass across the board. The cel ramp quantises a
    // lit surface into three bands, and its middle band pulled a 0xf7c600 body
    // down to a mustard/olive — the one colour a Pac-Man tribute cannot be. The
    // hexes are chosen for what comes OUT of the ramp, not what looks right in
    // a swatch.
    coat: {
      tan: 0xffd21e,
      white: 0xffeeaa,
      black: 0xd96a0c,
      ear: 0xf28f1c,
      paw: 0xe01f26,
      brow: 0x141210,
      nose: 0xed8207,
      iris: 0xed8207,
    },
    // The tribute coat's perk is the unlock itself. No run-time effect, which
    // is why perks.ts computes nothing for it — the whole payout happens in
    // profileStore.buyBeagleSkin the moment it is bought.
    perk: { id: "unlocksTribute", label: "Unlocks the Ghost enemy and the Arcade Night board" },
    // Dearer than the plain coats: it is the only skin that unlocks two OTHER
    // items, and the only one that changes the model's silhouette (brows). At
    // 50 it buys three things, which is what keeps it worth twice a plain coat
    // now that every coat carries a perk of its own.
    price: 50,
  },
  {
    id: "pepper",
    name: "Pepper",

    blurb: "Cool blue-tick grey · near-black saddle",
    // Cool blue-tick grey-black coat: a slate/blue-grey body, white
    // belly/snout, near-black saddle/nose/eyes for strong markings, and a
    // dark cool grey ear — deliberately cool-toned to contrast the three
    // warm coats above.
    coat: { tan: 0x7d8794, white: 0xf2f3f5, black: 0x1c1f24, ear: 0x4a4f57, nose: 0x141210, iris: 0x5c6266 },
    // The scoring coat: every fruit pays BEAGLE_PERKS.fruitBonusPoints on top
    // of the ladder, so a mango is 600 and — more to the point — an apple is
    // 200, which doubles the worth of the fruit you were going to walk past.
    perk: { id: "fruitBonus", label: "Every fruit you eat pays 100 more" },
    price: 25,
  },
] as const;

export const DEFAULT_BEAGLE_SKIN_ID = "bagel";

/** Returns a beagle skin's shop price, 0 for the default/unknown id. Never
 *  throws — mirrors getBeagleSkin's fallback-to-default behaviour. */
export function getBeagleSkinPrice(id: string): number {
  return getBeagleSkin(id).price;
}

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
  /** See BeagleSkin.blurb. */
  blurb: string;
  /**
   * Hidden from the shop until the player has earned the right to see it.
   *
   * Ownership is still the real gate — this only controls LISTING, so a secret
   * skin the player already owns shows up normally (which is how every account
   * from before the ghost became secret keeps the ghost it already had).
   */
  secret?: boolean;
  /** Shop price in coins (IDEA-012). 0 means "owned from the start, never
   *  purchasable" — currently true only for the default skin. */
  price: number;
}

export const ENEMY_SKINS: readonly EnemySkin[] = [
  // THE DEFAULT (IDEA-064). Free and always owned (see profileStore.ts's
  // defaultProfile()).
  //
  // It took this over from the beetle, which had taken it from the ghost. The
  // argument each time has been the same one and the flea finally wins it
  // outright: the enemy a player meets before they have bought anything should
  // say what THIS game is, and this game is a beagle. A beetle is a garden
  // creature and belongs in the garden; a flea belongs on the dog, which is one
  // step more specific and the only skin in the cast that could not exist in
  // any other game.
  //
  // Every account created before this owns the beetle and not the flea.
  // initProfileFromCache grants the current default for free on the next boot,
  // exactly as it did when the beetle replaced the ghost — so nobody loses the
  // beetle they already have and everybody gains the flea.
  { id: "flea", name: "Flea", blurb: "The beagle's own pest · banded shell, spring-loaded legs", price: 0 },
  // Priced with its siblings now that it is no longer the free one. Existing
  // accounts already OWN it, so this is only a price for somebody arriving
  // after this change.
  { id: "beetle", name: "Beetle", blurb: "The garden's own · shell and six legs", price: 25 },
  { id: "bee", name: "Bee", blurb: "Striped and buzzing · wings that blur", price: 25 },
  { id: "ladybug", name: "Ladybug", blurb: "Red shell, black spots · small and quick", price: 25 },
  // The widest enemy in the game, and the only one that is wider than it is
  // tall — which is the whole point of it: the other four are bugs of roughly
  // one silhouette. Priced with its siblings.
  { id: "crab", name: "Crab", blurb: "Sideways and armed · wide shell, open pincers", price: 25 },
  // Priced with the rest — another sibling skin, not a premium one. The blurb
  // leads with the proboscis because that is the feature the model is built
  // around: it is the one thing no other enemy in the cast has, and the only
  // reliable separator from the bee once both are wearing the same team colour.
  { id: "mosquito", name: "Mosquito", blurb: "All needle and wings · the garden's whine", price: 25 },
  // THE SUSHI PAIR (IDEA-056, IDEA-057). The first enemies in the game that are
  // not bugs, and the first that stand upright — a beagle chasing its dinner
  // rather than a garden pest. They ship together on purpose: each is built
  // against the other as its main risk, and the pair reads as one idea. Priced
  // with their siblings; nothing about them is premium.
  { id: "maki", name: "Maki Roll", blurb: "Nori, rice and a salmon face · stands on two boots", price: 25 },
  { id: "nigiri", name: "Nigiri", blurb: "A prawn on a rice pillow · belted in nori", price: 25 },
  // THE PIZZA (IDEA-058). The first enemy that is a PERSON rather than an
  // animate object: it has hair, it wears gloves and boots, and it walks. Also
  // the tallest and most vertical thing in the cast, and the only triangle.
  // Priced with its siblings — the cast has no premium tier and this is not
  // where one starts.
  { id: "pizza", name: "Pizza Slice", blurb: "Crust for hair, gloves and boots · the one that walks", price: 25 },
  // THE BURGER (IDEA-059). Ten enemies have a body that is ONE mass wearing
  // marks; this one's body is a STACK of six contrasting bands, and it is the
  // only enemy in the game with FINGERS — it walks around holding a V up at
  // the beagle. Priced with its siblings, like every skin since IDEA-009.
  { id: "burger", name: "Burger", blurb: "Six stacked bands and a peace sign · sesame and red boots", price: 25 },
  // THE EASTER EGG. Free, but not listed until it is revealed, and revealed by
  // owning the Pac-Beagle coat: the two tributes to the arcade game this one
  // descends from unlock each other, which needs no UI copy to explain. Price 0
  // is what makes the grant work without a special path — profileStore's buy
  // check is `coins < price`, so a 0-coin purchase always succeeds and the
  // server's own catalog check agrees.
  { id: "ghost", name: "Ghost", blurb: "The arcade original · unlocked by Pac-Beagle", price: 0, secret: true },
] as const;

export const DEFAULT_ENEMY_SKIN_ID = "flea";

/**
 * The pair that unlocks each other.
 *
 * Held here, next to both registries, rather than in the shop UI: "owning X
 * grants Y" has to hold however the purchase was made, and the shop is only
 * one caller. profileStore.buyBeagleSkin does the granting; ui/shop.ts does
 * the revealing.
 */
export const TRIBUTE_BEAGLE_SKIN_ID = "pacbeagle";
export const TRIBUTE_ENEMY_SKIN_ID = "ghost";

/**
 * The enemy skins a player can SEE, given what they own.
 *
 * A secret skin is listed once it has been earned — either because the tribute
 * coat that unlocks it is owned, or because the skin itself already is. That
 * second clause is not redundant: an account created before the ghost became
 * secret already owns it, and hiding a skin somebody owns (and may have
 * equipped) would read as it being taken away.
 *
 * IDEA-064, AND THIS IS WORTH KNOWING BEFORE TRUSTING THAT CLAUSE: for two
 * releases it matched EVERY account, so the ghost was listed for everyone and
 * "buy the Pac-Beagle to unlock the Ghost" was copy nobody could ever reach.
 * Nothing here was wrong. `001_init.sql` defaulted `owned_enemy_skin_ids` to
 * ARRAY['ghost'] — written when the ghost WAS the default — and never moved
 * when the beetle replaced it or when the flea did, so Postgres handed the
 * ghost to every account it created. `012_default_enemy_skin_flea.sql` moves
 * the defaults and takes the ghost back from anyone who did not earn it.
 * The lesson generalises past the ghost: **a rule expressed as "unless they
 * already own it" is only as good as what grants ownership**, and the grant may
 * not be in this codebase at all.
 *
 * Lives here rather than in ui/shop.ts because it is a rule about the
 * REGISTRY, not about markup — which also lets it be tested without a browser.
 * Ownership stays the real gate everywhere else; this only decides listing.
 */
export function visibleEnemySkins(
  ownsTributeCoat: boolean,
  isOwned: (id: string) => boolean,
): readonly EnemySkin[] {
  return ENEMY_SKINS.filter((s) => !s.secret || ownsTributeCoat || isOwned(s.id));
}

/** Returns an enemy skin's shop price, 0 for the default/unknown id. Never
 *  throws — mirrors getEnemySkin's fallback-to-default behaviour. */
export function getEnemySkinPrice(id: string): number {
  return getEnemySkin(id).price;
}

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
