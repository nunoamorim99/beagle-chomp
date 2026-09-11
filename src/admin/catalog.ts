// OWNER: backend / tooling (IDEA-051)
//
// WHAT THE IDS MEAN. The API answers in the database's vocabulary — `pacbeagle`,
// `maki`, `dpad`, `challenge_idx: 33` — because that is what `run_stats` stores
// and the server has no display names to give it: `catalog.generated.ts` carries
// ids and PRICES, since its job is charging for a purchase without trusting the
// client, not labelling a chart.
//
// So the names come from the game itself. THE PORTAL IS A CLIENT IN THIS REPO,
// built by its own Vite config from the same `src/`, so it can import the real
// registries rather than keeping a second list beside them. That matters more
// here than the handful of kilobytes it costs: this dashboard exists to reflect
// the game, and a hand-typed name table is a copy that goes stale the first time
// someone adds a skin — silently, because a missing name looks exactly like a
// skin nobody has played. Between IDEA-053 and IDEA-059 the enemy cast went from
// four to eleven; a copied list would have shown seven bars labelled with raw
// ids and nobody would have noticed which were which.
//
// The one thing a direct import CANNOT catch is the server's catalog drifting
// behind the game's — that is what `npm run sync` is for, and the Difficulty tab
// compares its own CHALLENGE_LEVEL_COUNT against the one the API reports so a
// forgotten sync shows up as a banner rather than as a table that is quietly
// the wrong length.
//
// NOTHING HERE IMPORTS FROM src/render. Every import below is pure game data
// (`src/game/*`), which is exactly the boundary CLAUDE.md draws for testability
// — and it is also what keeps three.js out of an operator dashboard's bundle.
// `themes.ts` reaches into `src/render` for FOUR TYPE-ONLY imports, which esbuild
// elides; if one of those ever becomes a value import, this file drags the whole
// renderer into the portal. `npm run build:admin` failing on bundle size is the
// symptom.

import { BEAGLE_SKINS, ENEMY_SKINS } from "../game/cosmetics";
import { MAZE_THEMES } from "../game/themes";
import {
  CHALLENGE_LEVELS,
  CHALLENGE_LEVEL_COUNT,
  chapterForLevel,
  MAZE_NAMES,
} from "../game/challenges";
import type { Share } from "./api.js";

export { CHALLENGE_LEVEL_COUNT };

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** One catalogue entry as the portal needs it: what it is called, and one line
 *  of context worth putting under a bar. */
export interface CatalogEntry {
  id: string;
  name: string;
  /** Shown beside the value. The beagle's is its PERK, which is the whole
   *  reason "which coat" stopped being a colour preference (IDEA-064). */
  note?: string;
}

export const BEAGLE_CATALOG: readonly CatalogEntry[] = BEAGLE_SKINS.map((s) => ({
  id: s.id,
  name: s.name,
  // `perk.label` is already written in the player's language for the shop card,
  // so it needs no second phrasing here — and reusing it means a retuned perk
  // relabels this chart for free.
  note: s.perk.label,
}));

export const ENEMY_CATALOG: readonly CatalogEntry[] = ENEMY_SKINS.map((s) => ({
  id: s.id,
  name: s.name,
  // The Ghost is unlocked by buying the Pac-Beagle rather than bought, so a low
  // share means something different for it than for a 25-coin skin.
  note: s.secret ? "unlocked with the Pac-Beagle" : undefined,
}));

export const THEME_CATALOG: readonly CatalogEntry[] = MAZE_THEMES.map((t) => ({
  id: t.id,
  name: t.name,
  note: t.secret ? "unlocked with the Pac-Beagle" : undefined,
}));

/**
 * The three touch schemes, spelled the way a person says them.
 *
 * Hand-written because there is no registry to import: `ControlScheme` is a
 * union in the client types and a CHECK constraint in migration 005, and neither
 * carries a display name. Adding a fourth means adding it here — the same
 * migration-plus-list trip CLAUDE.md already describes, with one more stop.
 */
export const CONTROL_CATALOG: readonly CatalogEntry[] = [
  { id: "swipe", name: "Swipe", note: "the default" },
  { id: "dpad", name: "D-pad" },
  { id: "stick", name: "Thumbstick" },
];

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export interface NamedShare {
  label: string;
  note?: string;
  runs: number;
  players: number;
  share: number;
  /** False when the API returned an id this build of the game does not have. */
  known: boolean;
}

/**
 * Name every share, and add back the ones with no runs at all.
 *
 * Both halves matter and they fail in opposite directions.
 *
 * The ZERO-FILL is `tallySlots`' argument, one layer up: SQL returns no row for
 * a skin nobody has played, so without it a new skin is invisible on the chart
 * that exists to say whether anyone plays it — indistinguishable from a skin
 * that does not exist. "Nobody has ever equipped the crab" is the answer, and it
 * is the one worth acting on.
 *
 * The UNKNOWN passthrough is the other direction: an id in the data that the
 * catalogue does not have is real history — runs genuinely played on a skin that
 * has since been renamed or removed — so it is kept, flagged, and shown under
 * its raw id. Dropping it would silently shrink the denominator and quietly
 * inflate everything else.
 */
export function nameShares(
  rows: readonly Share[],
  catalog: readonly CatalogEntry[],
): NamedShare[] {
  const seen = new Set<string>();
  const named: NamedShare[] = [];

  for (const row of rows) {
    const entry = catalog.find((c) => c.id === row.value);
    seen.add(row.value);
    named.push({
      label: entry ? entry.name : row.value,
      note: entry?.note,
      runs: row.runs,
      players: row.players,
      share: row.share,
      known: entry !== undefined,
    });
  }

  for (const entry of catalog) {
    if (seen.has(entry.id)) continue;
    named.push({ label: entry.name, note: entry.note, runs: 0, players: 0, share: 0, known: true });
  }

  // Played first, biggest first. Never-played keep the catalogue's own order,
  // which is shop order — so the list still reads as the shop does.
  return named.sort((a, b) => b.runs - a.runs);
}

// ---------------------------------------------------------------------------
// The challenge ladder
// ---------------------------------------------------------------------------

export interface ChallengeMeta {
  /** "C7" — the short form the level map and the HUD both use. */
  code: string;
  name: string;
  /** "Stage 2" or "The Twists". */
  chapter: string;
  kind: "tour" | "twist";
  mazeName: string;
  themeName: string;
}

/**
 * One row of context per level, indexed by `challenge_idx`.
 *
 * Built once at module load from the real ladder. Forty bare "C33"s is a table
 * nobody can read: a tour level IS its maze (it is the same game on a board most
 * players will never otherwise see), so the name and the chapter are what make
 * "C33 is the wall" mean something — and the tour/twist split is the difference
 * between a level being hard and a level being a BOARD players find hard.
 */
export const CHALLENGE_META: readonly ChallengeMeta[] = CHALLENGE_LEVELS.map((level, idx) => {
  const theme = MAZE_THEMES.find((t) => t.id === level.themeId);
  return {
    code: `C${idx + 1}`,
    name: level.name,
    chapter: chapterForLevel(idx).title,
    kind: level.kind,
    mazeName: MAZE_NAMES[level.mazeIdx] ?? `maze ${level.mazeIdx}`,
    // A forced theme is part of what a tour level IS, so it is named rather
    // than left as an id. A theme that no longer exists falls back to the id
    // instead of blanking the cell — test-cosmetics.ts asserts this cannot
    // happen, and it is one `??` to stay honest if it ever does.
    themeName: theme ? theme.name : level.themeId,
  };
});

/** Context for a level index, including one the ladder does not have — which is
 *  the catalog-drift case, and must read as unknown rather than crash. */
export function challengeMeta(idx: number): ChallengeMeta {
  return (
    CHALLENGE_META[idx] ?? {
      code: `C${idx + 1}`,
      name: "Unknown level",
      chapter: "—",
      kind: "twist",
      mazeName: "—",
      themeName: "—",
    }
  );
}
