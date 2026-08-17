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

import {
  fetchLeaderboard,
  fetchRunBoard,
  type LeaderboardEntry,
  type RunBoardEntry,
  type RunBoardResponse,
} from "../net/endpoints";

export interface LeaderboardHandle {
  open: () => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

export interface LeaderboardCallbacks {
  onClose?: () => void;
}

/** The two boards. "players" ranks people by their personal best (one row
 *  each); "runs" ranks individual attempts, so one player can hold several
 *  places — including more than one podium spot. */
type BoardTab = "players" | "runs";

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

/** The runs board grows with every game played, not with the player count, so
 *  it gets a larger page. The server caps this at 200. */
const RUNS_LIMIT = 200;

export function attachLeaderboard(callbacks: LeaderboardCallbacks = {}): LeaderboardHandle {
  const root = require<HTMLDivElement>("leaderboard");
  let isOpenState = false;
  /** Reset on every open: the board always opens collapsed to the top 10. */
  let showingAll = false;
  /** Which board is showing. "players" folds each player to their personal
   *  best; "runs" lists every individual attempt. */
  let tab: BoardTab = "players";

  /** Build one row with NO innerHTML anywhere near the username.
   *
   *  Shared by both tabs: `sub` carries the run date on the all-runs board and
   *  is omitted on the players board, so the two tabs stay visually identical
   *  apart from that one line. */
  function buildRow(
    entry: { rank: number; username: string; isMe: boolean },
    score: number,
    isMe: boolean,
    sub?: string,
  ): HTMLElement {
    const row = document.createElement("li");
    row.className = isMe ? "lb-row lb-row-me" : "lb-row";

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    // Medals for the podium; plain numbers below. On the all-runs board the
    // same player can legitimately take more than one medal.
    rank.textContent =
      entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `${entry.rank}`;

    const name = document.createElement("span");
    name.className = "lb-name";
    // textContent, never innerHTML — this is the untrusted string.
    name.textContent = entry.username;

    if (sub) {
      const when = document.createElement("span");
      when.className = "lb-when";
      when.textContent = sub;
      name.append(when);
    }

    const scoreEl = document.createElement("span");
    scoreEl.className = "lb-score";
    scoreEl.textContent = formatScore(score);

    row.append(rank, name, scoreEl);
    return row;
  }

  /** The Players / All runs switch. Mirrors the auth screen's tab pattern so
   *  the two screens feel the same. */
  function buildTabs(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "lb-tabs";
    bar.setAttribute("role", "tablist");

    const make = (which: BoardTab, label: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.className = tab === which ? "lb-tab is-active" : "lb-tab";
      btn.setAttribute("aria-selected", String(tab === which));
      btn.textContent = label;
      btn.addEventListener("click", () => {
        if (tab === which) return;
        tab = which;
        // Each tab starts collapsed at its own top 10 — carrying an expanded
        // state across would land the player deep in a list they didn't open.
        showingAll = false;
        void load();
      });
      return btn;
    };

    bar.append(make("players", "Players"), make("runs", "All runs"));
    return bar;
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

    const titles = document.createElement("div");
    const h1 = document.createElement("h1");
    h1.textContent = "🏆 Leaderboard";
    const sub = document.createElement("p");
    sub.className = "lb-sub";
    // Spell out which board this is — the difference between "one row per
    // player" and "one row per run" is exactly what confused people.
    sub.textContent =
      tab === "players"
        ? "Classic mode — each player's personal best"
        : "Classic mode — every run, best first";
    titles.append(h1, sub);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-link";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => close());

    header.append(titles, closeBtn);
    sheet.append(header);
    sheet.append(buildTabs());
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
      gap.textContent = "🏆 You're top of the board.";
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
  function formatRunDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  }

  function renderRuns(data: RunBoardResponse): void {
    const { runs, myBest } = data;

    shell(
      (body) => {
        if (runs.length === 0) {
          const p = document.createElement("p");
          p.className = "lb-message";
          p.textContent = "No runs yet. Play a classic game and you'll be first.";
          body.append(p);
          return;
        }

        const visible = showingAll ? runs : runs.slice(0, COLLAPSED_ROWS);

        const list = document.createElement("ol");
        list.className = "lb-list";
        for (const run of visible) {
          list.append(buildRow(run, run.score, run.isMe, formatRunDate(run.finishedAt)));
        }
        body.append(list);

        // Same sticky treatment as the players board: if the player's best run
        // falls below the cut, keep it on screen rather than making them hunt.
        if (myBest && !visible.some((r) => r.rank === myBest.rank)) {
          const standing = document.createElement("div");
          standing.className = "lb-standing";

          const divider = document.createElement("p");
          divider.className = "lb-divider";
          divider.textContent = "···";

          const mine = document.createElement("ol");
          mine.className = "lb-list";
          mine.append(
            buildRow(myBest, myBest.score, true, formatRunDate(myBest.finishedAt)),
          );

          standing.append(divider, mine);
          body.append(standing);
        }
      },
      buildRunsMyBest(myBest, runs[0]),
      buildRunsToggle(data),
    );
  }

  /** "Your best run" card for the runs tab — the same shape as the players
   *  card, reading from a run rather than a personal best. */
  function buildRunsMyBest(
    myBest: RunBoardEntry | null,
    best: RunBoardEntry | undefined,
  ): HTMLElement {
    const card = document.createElement("section");
    card.className = "lb-mine";

    const heading = document.createElement("h2");
    heading.className = "lb-mine-title";
    heading.textContent = "Your best run";
    card.append(heading);

    if (!myBest) {
      const empty = document.createElement("p");
      empty.className = "lb-mine-empty";
      empty.textContent = "No classic runs yet — play one to get on the board.";
      card.append(empty);
      return card;
    }

    const figures = document.createElement("div");
    figures.className = "lb-mine-figures";

    const scoreBlock = document.createElement("div");
    scoreBlock.className = "lb-mine-block";
    const scoreValue = document.createElement("span");
    scoreValue.className = "lb-mine-value";
    scoreValue.textContent = formatScore(myBest.score);
    const scoreLabel = document.createElement("span");
    scoreLabel.className = "lb-mine-label";
    scoreLabel.textContent = "your best run";
    scoreBlock.append(scoreValue, scoreLabel);

    const rankBlock = document.createElement("div");
    rankBlock.className = "lb-mine-block";
    const rankValue = document.createElement("span");
    rankValue.className = "lb-mine-value";
    rankValue.textContent = `#${myBest.rank}`;
    const rankLabel = document.createElement("span");
    rankLabel.className = "lb-mine-label";
    rankLabel.textContent = "of all runs";
    rankBlock.append(rankValue, rankLabel);

    figures.append(scoreBlock, rankBlock);
    card.append(figures);

    if (best && best.score > myBest.score) {
      const gap = document.createElement("p");
      gap.className = "lb-mine-gap";
      gap.textContent = `${formatScore(best.score - myBest.score)} points behind the best run`;
      card.append(gap);
    } else if (myBest.rank === 1) {
      const gap = document.createElement("p");
      gap.className = "lb-mine-gap lb-mine-leader";
      gap.textContent = "🏆 Best run on the board.";
      card.append(gap);
    }

    return card;
  }

  function buildRunsToggle(data: RunBoardResponse): HTMLElement | undefined {
    const { runs, total } = data;
    if (runs.length === 0 || total <= COLLAPSED_ROWS) return undefined;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary lb-more";
    btn.textContent = showingAll ? "Show top 10" : `Show all ${total.toLocaleString()}`;
    btn.addEventListener("click", () => {
      showingAll = !showingAll;
      if (showingAll && runs.length < total) void load();
      else renderRuns(data);
    });
    return btn;
  }

  async function load(): Promise<void> {
    renderLoading();
    try {
      if (tab === "runs") {
        const data = await fetchRunBoard(RUNS_LIMIT);
        if (!isOpenState) return;
        renderRuns(data);
        return;
      }
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
      // Always open on the players board — it answers "who's winning?", which
      // is the question the menu button implies.
      tab = "players";
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
