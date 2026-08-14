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

export interface LeaderboardHandle {
  open: () => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

export interface LeaderboardCallbacks {
  onClose?: () => void;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachLeaderboard: missing element #${id} — check index.html`);
  return el;
}

export function attachLeaderboard(callbacks: LeaderboardCallbacks = {}): LeaderboardHandle {
  const root = require<HTMLDivElement>("leaderboard");
  let isOpenState = false;

  /** Build one row with NO innerHTML anywhere near the username. */
  function buildRow(entry: LeaderboardEntry, isMe: boolean): HTMLElement {
    const row = document.createElement("li");
    row.className = isMe ? "lb-row lb-row-me" : "lb-row";

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    // Medals for the podium; plain numbers below.
    rank.textContent =
      entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `${entry.rank}`;

    const name = document.createElement("span");
    name.className = "lb-name";
    // textContent, never innerHTML — this is the untrusted string.
    name.textContent = entry.username;

    const score = document.createElement("span");
    score.className = "lb-score";
    score.textContent = entry.highScore.toLocaleString();

    row.append(rank, name, score);
    return row;
  }

  function shell(bodyBuilder: (body: HTMLElement) => void): void {
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
    sub.textContent = "Classic mode — top scores";
    titles.append(h1, sub);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-link";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => close());

    header.append(titles, closeBtn);
    sheet.append(header);

    const body = document.createElement("div");
    body.className = "lb-body";
    bodyBuilder(body);
    sheet.append(body);

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

  function renderBoard(top: LeaderboardEntry[], me: LeaderboardEntry | null): void {
    shell((body) => {
      if (top.length === 0) {
        const p = document.createElement("p");
        p.className = "lb-message";
        p.textContent = "No scores yet. Play a classic run and you'll be first.";
        body.append(p);
        return;
      }

      const list = document.createElement("ol");
      list.className = "lb-list";
      for (const entry of top) {
        list.append(buildRow(entry, me !== null && entry.rank === me.rank));
      }
      body.append(list);

      // Pin the player's own row when they're outside the visible top N, so
      // they can always see where they stand.
      if (me && !top.some((e) => e.rank === me.rank)) {
        const divider = document.createElement("p");
        divider.className = "lb-divider";
        divider.textContent = "···";
        body.append(divider);

        const mine = document.createElement("ol");
        mine.className = "lb-list";
        mine.append(buildRow(me, true));
        body.append(mine);
      }

      if (!me) {
        const hint = document.createElement("p");
        hint.className = "lb-message lb-hint";
        hint.textContent = "Play a classic run to get on the board.";
        body.append(hint);
      }
    });
  }

  async function load(): Promise<void> {
    renderLoading();
    try {
      const { top, me } = await fetchLeaderboard(50);
      // Guard against a late response landing after the player closed the page.
      if (!isOpenState) return;
      renderBoard(top, me);
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
