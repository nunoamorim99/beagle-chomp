// OWNER: gameplay-engineer (IDEA-020 shared scoreboard)
//
// The leaderboard: top classic scores, plus where the player sits.
//
// CLASSIC MODE ONLY, deliberately. Challenge levels carry modifiers (up to 5
// ghosts at ×2 speed, where the ghost-chain ceiling is 18,400/level against
// classic's 5,600), so their scores aren't comparable — ranking them together
// would hand the board to whoever grinds the hardest challenge level. The
// header says so, otherwise a player who just cleared C8 would reasonably
// wonder where their score went.
//
// SECURITY NOTE: this is the ONLY screen in the game that renders strings
// authored by OTHER PLAYERS. Every other page interpolates constants into
// innerHTML, which is safe. Here the rows are built with createElement +
// textContent instead, so a username has no path to being parsed as markup at
// all — structurally impossible rather than escaped-and-hopefully-correct.
// (The server's username regex already forbids the characters, and escape.ts
// covers the rest of the page; this is the third layer.)
//
// Follows the attachX(root, callbacks) => handle pattern; no `three` imports.

import { fetchLeaderboard, type LeaderboardEntry } from "../net/endpoints";
import { ICON, icon } from "./icons";

export interface LeaderboardHandle {
  open: () => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

export interface LeaderboardCallbacks {
  onClose?: () => void;
}

// ONE BOARD: each player's personal best, one row each.
//
// There was an "All runs" tab beside it, ranking individual attempts so one
// player could hold several places including more than one podium spot. Nuno
// removed it ("we don't need that, just the best ones from each user") — a
// board whose top ten can be one person having a good evening answers a
// different question from the one the menu button implies, and having to pick
// between two boards to find out who is winning is a choice nobody wanted to
// make.

/** Group every score the same way.
 *
 *  Plain toLocaleString() is locale-dependent in a way that shows: pt-PT (and
 *  several others) leave 4-digit numbers ungrouped, so a board would mix "7400"
 *  with "40 800" in the same column. `useGrouping: "always"` pins it. */
//  The double cast is deliberate: `useGrouping: "always"` is ES2023, and this
//  project's TS lib still types the field as boolean. The string value is what
//  browsers implement, so casting through unknown is the honest way to say
//  "newer than the type definitions" rather than weakening the option type.
const scoreFormat = new Intl.NumberFormat(undefined, {
  useGrouping: "always",
} as unknown as Intl.NumberFormatOptions);

function formatScore(n: number): string {
  return scoreFormat.format(n);
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachLeaderboard: missing element #${id} — check index.html`);
  return el;
}

/** How many rows the board shows before "Show all". Ten is a real ranking and
 *  still fits a phone screen without scrolling. */
const COLLAPSED_ROWS = 10;

/** The server caps `limit` at 100; ask for that once rather than paginating —
 *  a board this size is a few KB and pagination would be machinery for nothing. */
const FULL_LIMIT = 100;

export function attachLeaderboard(callbacks: LeaderboardCallbacks = {}): LeaderboardHandle {
  const root = require<HTMLDivElement>("leaderboard");
  let isOpenState = false;
  /** Reset on every open: the board always opens collapsed to the top 10. */
  let showingAll = false;

  /** Build one row with NO innerHTML anywhere near the username. */
  function buildRow(
    entry: { rank: number; username: string; isMe: boolean },
    score: number,
    isMe: boolean,
  ): HTMLElement {
    const row = document.createElement("li");
    // The podium sits on the lighter bark, the rest on the darker fill: the
    // top of a board should look different from the middle of it even before
    // the numbers are read.
    const podium = entry.rank <= 3 ? " lb-row-podium" : "";
    row.className = isMe ? "lb-row lb-row-me" : `lb-row${podium}`;

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    // The rank is a PLATE carrying its own number — gold, silver and bronze
    // for the podium, ink for everyone else.
    //
    // It replaced three medal emoji, and then a single Material Symbols medal
    // in three tints. Both had the same problem: at the size a row allows,
    // three medals are three near-identical discs, and the reader still has
    // to count rows to know which place they are looking at. A numbered plate
    // says the place outright and still ranks by colour at a glance, and it
    // is the same object the rest of the interface uses for a game item.
    rank.textContent = `${entry.rank}`;
    if (entry.rank <= 3) rank.classList.add(`lb-rank-${entry.rank}`);

    const name = document.createElement("span");
    name.className = "lb-name";
    // textContent, never innerHTML — this is the untrusted string.
    name.textContent = entry.username;

    const scoreEl = document.createElement("span");
    scoreEl.className = "lb-score";
    scoreEl.textContent = formatScore(score);

    row.append(rank, name, scoreEl);
    return row;
  }

  /** `pinned` renders between the header and the scrolling list, so "Your best"
   *  stays on screen while the table scrolls underneath it. */
  function shell(
    bodyBuilder: (body: HTMLElement) => void,
    pinned?: HTMLElement,
    footer?: HTMLElement,
  ): void {
    root.textContent = "";

    const sheet = document.createElement("div");
    sheet.className = "lb-sheet";

    const header = document.createElement("header");
    header.className = "lb-header";

    // An icon square, like the shop's and the map's — three full-screen pages
    // that all leave the same way should leave it the same way.
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "lb-back";
    closeBtn.setAttribute("aria-label", "Close leaderboard");
    closeBtn.append(icon(ICON.back));
    closeBtn.addEventListener("click", () => close());

    const h1 = document.createElement("h1");
    h1.textContent = "Leaderboard";

    // Balances the back button so the title is optically centred in the row —
    // the same trick the challenge map's header used before it grew a progress
    // bar to fill that side.
    const spacer = document.createElement("div");
    spacer.className = "lb-header-spacer";
    spacer.setAttribute("aria-hidden", "true");

    header.append(closeBtn, h1, spacer);
    sheet.append(header);

    // WHICH board this is, under the title.
    //
    // The design's header is a single centred row and has no room for it, but
    // the line itself is load-bearing: it is the only place the screen says
    // CLASSIC ONLY, and without it a player who just cleared J8 is left
    // wondering where that score went (the reason this module's header comment
    // gives for the line existing at all). It stayed when the tab bar went,
    // because the tabs were never what made it necessary.
    const sub = document.createElement("p");
    sub.className = "lb-sub";
    sub.textContent = "Classic mode — each player's personal best";
    sheet.append(sub);

    if (pinned) sheet.append(pinned);

    const body = document.createElement("div");
    body.className = "lb-body";
    bodyBuilder(body);
    sheet.append(body);
    // Outside .lb-body so it never scrolls out of reach — it's the affordance
    // that reveals the rest of the board, and a player shouldn't have to scroll
    // past ten rows to discover it exists.
    if (footer) sheet.append(footer);

    root.append(sheet);
  }

  function renderLoading(): void {
    shell((body) => {
      const p = document.createElement("p");
      p.className = "lb-message";
      p.textContent = "Loading scores…";
      body.append(p);
    });
  }

  function renderError(): void {
    shell((body) => {
      const p = document.createElement("p");
      p.className = "lb-message";
      p.textContent = "Couldn't load the leaderboard. Check your connection.";
      body.append(p);

      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn-secondary";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => void load());
      body.append(retry);
    });
  }

  /** The player's own best, always shown as its own block above the table.
   *  The point is comparison: the top score is right there, so "how far off am
   *  I?" is answerable without hunting for your row in the list. */
  function buildMyBest(me: LeaderboardEntry | null, best: LeaderboardEntry | undefined): HTMLElement {
    const card = document.createElement("section");
    card.className = "lb-mine";

    const heading = document.createElement("h2");
    heading.className = "lb-mine-title";
    heading.textContent = "Your best";
    card.append(heading);

    if (!me) {
      const empty = document.createElement("p");
      empty.className = "lb-mine-empty";
      empty.textContent = "No classic score yet — play a run to get on the board.";
      card.append(empty);
      return card;
    }

    const figures = document.createElement("div");
    figures.className = "lb-mine-figures";

    const scoreBlock = document.createElement("div");
    scoreBlock.className = "lb-mine-block";
    const scoreValue = document.createElement("span");
    scoreValue.className = "lb-mine-value";
    scoreValue.textContent = formatScore(me.highScore);
    const scoreLabel = document.createElement("span");
    scoreLabel.className = "lb-mine-label";
    scoreLabel.textContent = "your score";
    scoreBlock.append(scoreValue, scoreLabel);

    const rankBlock = document.createElement("div");
    rankBlock.className = "lb-mine-block";
    const rankValue = document.createElement("span");
    rankValue.className = "lb-mine-value";
    rankValue.textContent = `#${me.rank}`;
    const rankLabel = document.createElement("span");
    rankLabel.className = "lb-mine-label";
    rankLabel.textContent = "your rank";
    rankBlock.append(rankValue, rankLabel);

    figures.append(scoreBlock, rankBlock);
    card.append(figures);

    // The gap to first place — the number that actually motivates another run.
    if (best && best.highScore > me.highScore) {
      const gap = document.createElement("p");
      gap.className = "lb-mine-gap";
      gap.textContent = `${formatScore(best.highScore - me.highScore)} points behind 1st`;
      card.append(gap);
    } else if (me.rank === 1) {
      const gap = document.createElement("p");
      gap.className = "lb-mine-gap lb-mine-leader";
      gap.append(icon(ICON.trophy), document.createTextNode("You're top of the board."));
      card.append(gap);
    }

    return card;
  }

  /** The show-all / show-less toggle, or undefined when the whole board already
   *  fits in the collapsed view and there is nothing to reveal. */
  function buildToggle(data: {
    top: LeaderboardEntry[];
    me: LeaderboardEntry | null;
    total: number;
  }): HTMLElement | undefined {
    const { top, me, total } = data;
    if (top.length === 0 || total <= COLLAPSED_ROWS) return undefined;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary lb-more";
    btn.textContent = showingAll ? "Show top 10" : `Show all ${total.toLocaleString()}`;
    btn.addEventListener("click", () => {
      showingAll = !showingAll;
      // Up to FULL_LIMIT rows are already in hand, so re-render rather than
      // re-fetch unless the board is bigger than the page we asked for.
      if (showingAll && top.length < total) void load();
      else renderBoard({ top, me, total });
    });
    return btn;
  }

  function renderBoard(data: {
    top: LeaderboardEntry[];
    me: LeaderboardEntry | null;
    total: number;
  }): void {
    const { top, me, total } = data;

    shell((body) => {
      if (top.length === 0) {
        const p = document.createElement("p");
        p.className = "lb-message";
        p.textContent = "No scores yet. Play a classic run and you'll be first.";
        body.append(p);
        return;
      }

      // Ten by default — enough to be a real ranking, short enough to read at a
      // glance on a phone without scrolling. "Show all" reveals the rest.
      const visible = showingAll ? top : top.slice(0, COLLAPSED_ROWS);

      const list = document.createElement("ol");
      list.className = "lb-list";
      for (const entry of visible) {
        list.append(buildRow(entry, entry.highScore, entry.isMe));
      }
      body.append(list);

      // Pin the player's own row when they rank below the visible cut, so the
      // list always shows where they stand relative to the names above them.
      //
      // position:sticky (see .lb-standing) keeps it pinned to the bottom of the
      // scroller rather than sitting at row 11, where a low-ranked player would
      // have to scroll to find themselves — the opposite of the point.
      if (me && !visible.some((e) => e.isMe)) {
        const standing = document.createElement("div");
        standing.className = "lb-standing";

        const divider = document.createElement("p");
        divider.className = "lb-divider";
        divider.textContent = "···";

        const mine = document.createElement("ol");
        mine.className = "lb-list";
        mine.append(buildRow(me, me.highScore, true));

        standing.append(divider, mine);
        body.append(standing);
      }

    }, buildMyBest(me, top[0]), buildToggle({ top, me, total }));
  }

  /** Short, locale-aware run date — "12 Aug", or "12 Aug 2025" once it's not
   *  this year, so an old run never reads as a recent one. */
  async function load(): Promise<void> {
    renderLoading();
    try {
      const { top, me, total } = await fetchLeaderboard(FULL_LIMIT);
      // Guard against a late response landing after the player closed the page.
      if (!isOpenState) return;
      renderBoard({ top, me, total });
    } catch {
      if (isOpenState) renderError();
    }
  }

  function close(): void {
    isOpenState = false;
    root.classList.add("hidden");
    document.body.classList.remove("leaderboard-open");
    root.textContent = "";
    callbacks.onClose?.();
  }

  return {
    open(): void {
      isOpenState = true;
      showingAll = false;
      root.classList.remove("hidden");
      document.body.classList.add("leaderboard-open");
      void load();
    },
    close,
    detach(): void {
      root.textContent = "";
      root.classList.add("hidden");
      document.body.classList.remove("leaderboard-open");
    },
    isOpen: () => isOpenState,
  };
}
