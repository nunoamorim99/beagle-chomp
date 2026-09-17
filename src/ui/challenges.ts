// OWNER: gameplay-engineer (IDEA-078)
//
// The Challenges screen: every goal, how far along it is, and the button that
// takes the reward.
//
// Follows the attachX() => handle pattern; no `three` imports. A full-screen
// PAGE in its own container, like the shop, the level map and the news — so
// opening it never clobbers #center or #mainMenu.
//
// ---------------------------------------------------------------------------
// THE SCREEN DRAWS THE SERVER'S NUMBERS, NOT ITS OWN
// ---------------------------------------------------------------------------
//
// `value`, `target`, `reward`, `done` and `claimed` all come off the wire. The
// local definition table supplies only the name, the blurb, the category and
// the order — the things the server has no business knowing. That split is not
// tidiness: progress is derived from `run_stats`, which this side has never
// seen, and the reward is coins, which only the server may bank. A bar drawn
// against a locally-held target would be the one drift a player could be hurt
// by, so `viewChallenges` prefers the server's figures on every row.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A CLAIM BUTTON AT ALL
// ---------------------------------------------------------------------------
//
// Nuno's call, and it is what gives this screen a job. Auto-paying at run end
// needs no table and no endpoint — and leaves a list you can only read, which
// nobody opens twice. A claim gives the menu chip a badge with a real number on
// it, and lets a player SEE what they earned instead of finding coins already
// in the wallet.

import {
  CHALLENGES,
  CHALLENGE_CATEGORIES,
  CATEGORY_LABELS,
  MODE_LABELS,
  claimableCoins,
  claimableCount,
  viewChallenges,
  type ChallengeCategory,
  type ChallengeView,
} from "../game/challenges";
import { fetchChallenges, claimChallenge, type ChallengeRowDTO } from "../net/endpoints";
import { ICON, iconHtml, plateHtml, type PlateKind } from "./icons";
import { escapeHtml } from "./escape";

export interface ChallengesHandle {
  open: () => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
  /** Fetch the ladder and update the menu chip's badge without opening
   *  anything. Called once after sign-in and again after every finished run —
   *  a run is the only thing that can complete a challenge. */
  refreshBadge: () => Promise<void>;
}

export interface ChallengesCallbacks {
  onClose?: () => void;
  /** A reward was taken. The caller reconciles the profile cache and the HUD /
   *  menu coin lines — this module deliberately does not reach into either. */
  onClaimed?: (coinsAwarded: number, profile: unknown) => void;
  /**
   * A cue this screen cannot get for free.
   *
   * Deliberately NOT the press tap: `attachUiSounds` already claims every
   * `<button>` on the page through one delegated capture-phase listener, so
   * firing a tap here as well would play two sounds on every press. Only the
   * two outcomes that have their own meaning are routed out — a reward landing
   * and a claim failing. Kept as a callback rather than importing sound.ts so
   * this module stays a pure DOM layer.
   */
  onSound?: (kind: "claim" | "error") => void;
}

/** Which tab is showing. "ready" is not a category — it is a filter across all
 *  of them, and it only exists while something is claimable. */
type Tab = ChallengeCategory | "ready";

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachChallenges: missing element #${id} — check index.html`);
  return el;
}

/** The mark a category wears. Deliberately drawn from the GAME OBJECT plates
 *  rather than from chrome glyphs where one exists: a "collect" goal is about
 *  things you pick up in the maze, and §05's plate/icon split says those are
 *  drawn as lit outlined squares. */
const CATEGORY_PLATE: Readonly<Record<ChallengeCategory, PlateKind>> = {
  collect: "coin",
  score: "biscuit",
  levels: "trophy",
};

export function attachChallenges(callbacks: ChallengesCallbacks = {}): ChallengesHandle {
  const root = requireEl<HTMLDivElement>("challenges");
  const chip = document.getElementById("menuChallengeBtn");
  const badge = document.getElementById("menuChallengeBadge");

  let isOpenState = false;
  let rows: ChallengeView[] = [];
  let tab: Tab = "collect";
  /** Ids currently mid-claim, so a double-tap cannot fire two requests. The
   *  server's primary key would refuse the second anyway — this is about not
   *  showing the player an error for something that worked. */
  const claiming = new Set<string>();

  // Removes the live listeners on detach. startApp() re-runs on sign-out and on
  // a mid-session 401, so without this they stack one set per session.
  const live = new AbortController();
  const signal = live.signal;

  // --- the menu chip's badge ------------------------------------------------

  function setBadge(n: number): void {
    if (!badge) return;
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
    }
    chip?.setAttribute(
      "aria-label",
      n > 0 ? `Challenges, ${n} ready to claim` : "Challenges",
    );
  }

  function absorb(dto: ChallengeRowDTO[]): void {
    rows = viewChallenges(dto);
    setBadge(claimableCount(rows));
  }

  // --- rendering ------------------------------------------------------------

  function tabsHtml(): string {
    const ready = claimableCount(rows);
    const tabs: Array<{ id: Tab; label: string; count?: number }> = [];
    // The Ready tab only exists while there is something in it. A tab that is
    // permanently empty for a new player is noise on the screen whose whole job
    // is telling them what to aim at next.
    if (ready > 0) tabs.push({ id: "ready", label: "Ready", count: ready });
    for (const c of CHALLENGE_CATEGORIES) tabs.push({ id: c, label: CATEGORY_LABELS[c] });

    return (
      '<div class="ch-tabs" role="tablist">' +
      tabs
        .map(
          (t) =>
            `<button type="button" class="ch-tab${t.id === tab ? " is-on" : ""}" ` +
            `role="tab" aria-selected="${t.id === tab}" data-tab="${t.id}">` +
            escapeHtml(t.label) +
            (t.count ? `<span class="ch-tab-count">${t.count}</span>` : "") +
            "</button>",
        )
        .join("") +
      "</div>"
    );
  }

  function cardHtml(r: ChallengeView): string {
    const pct = r.target > 0 ? Math.round((r.value / r.target) * 100) : 0;
    const state = r.claimed ? "is-claimed" : r.claimable ? "is-ready" : "";

    // The action slot is one of three things and never empty: a button, a
    // "claimed" stamp, or the progress figure. An empty slot makes every
    // unfinished card look like a broken button.
    const action = r.claimed
      ? `<span class="ch-stamp">${iconHtml(ICON.check)}Claimed</span>`
      : r.claimable
        ? `<button type="button" class="ch-claim" data-claim="${escapeHtml(r.id)}">` +
          `Claim ${plateHtml("coin", "inline")}${r.reward}</button>`
        : `<span class="ch-count">${r.value}<span class="ch-of">/${r.target}</span></span>`;

    return (
      `<li class="ch-card ${state}">` +
      '<div class="ch-card-head">' +
      `<span class="ch-mark">${plateHtml(CATEGORY_PLATE[r.def.category], "inline")}</span>` +
      '<div class="ch-titles">' +
      `<h3>${escapeHtml(r.def.name)}</h3>` +
      `<p class="ch-blurb">${escapeHtml(r.def.blurb)}</p>` +
      "</div>" +
      `<span class="ch-mode ch-mode--${r.def.mode}">${escapeHtml(MODE_LABELS[r.def.mode])}</span>` +
      "</div>" +
      '<div class="ch-foot">' +
      `<div class="ch-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${r.target}" ` +
      `aria-valuenow="${r.value}" aria-label="${escapeHtml(r.def.name)} progress">` +
      `<div class="ch-bar-fill" style="width:${pct}%"></div>` +
      "</div>" +
      `<div class="ch-action">${action}</div>` +
      "</div>" +
      "</li>"
    );
  }

  function visibleRows(): ChallengeView[] {
    if (tab === "ready") return rows.filter((r) => r.claimable);
    // Within a category, unfinished first and claimable above everything: the
    // screen is a to-do list, and burying a finished reward under forty
    // untouched ones is the one ordering that makes the claim hard to find.
    // Ties keep CHALLENGES' own order, which is the ladder — so a family reads
    // 5, 10, 15 rather than being scattered by how far along each tier is.
    const inTab = rows.filter((r) => r.def.category === tab);
    return [
      ...inTab.filter((r) => r.claimable),
      ...inTab.filter((r) => !r.claimable && !r.claimed),
      ...inTab.filter((r) => r.claimed),
    ];
  }

  function render(): void {
    const ready = claimableCount(rows);
    const coins = claimableCoins(rows);
    const donePct =
      rows.length > 0 ? Math.round((rows.filter((r) => r.done).length / rows.length) * 100) : 0;

    // The lead line leads with COINS, not with a count: "3 rewards" says less
    // than "23 coins waiting", and coins are what the player is actually here
    // for.
    const lead =
      ready > 0
        ? `${coins} coin${coins === 1 ? "" : "s"} waiting`
        : `${rows.filter((r) => r.done).length} of ${rows.length} done`;

    const list = visibleRows();
    const body =
      list.length > 0
        ? `<ul class="ch-list">${list.map(cardHtml).join("")}</ul>`
        : '<p class="ch-empty">Nothing here yet — play a run and come back.</p>';

    root.innerHTML =
      '<div class="ch-sheet">' +
      '<div class="ch-head">' +
      `<button type="button" class="map-back" id="challengesBackBtn" aria-label="Back to menu">${iconHtml(ICON.back)}</button>` +
      '<div class="ch-head-text">' +
      "<h1>Challenges</h1>" +
      `<p class="ch-lead">${escapeHtml(lead)}</p>` +
      "</div>" +
      "</div>" +
      `<div class="ch-overall"><div class="ch-overall-fill" style="width:${donePct}%"></div></div>` +
      tabsHtml() +
      body +
      "</div>";
  }

  function renderMessage(text: string): void {
    root.innerHTML =
      '<div class="ch-sheet">' +
      '<div class="ch-head">' +
      `<button type="button" class="map-back" id="challengesBackBtn" aria-label="Back to menu">${iconHtml(ICON.back)}</button>` +
      '<div class="ch-head-text"><h1>Challenges</h1></div>' +
      "</div>" +
      `<p class="ch-empty">${escapeHtml(text)}</p>` +
      "</div>";
  }

  // --- claiming -------------------------------------------------------------

  async function doClaim(id: string, btn: HTMLButtonElement): Promise<void> {
    if (claiming.has(id)) return;
    claiming.add(id);
    // Disabled AND relabelled: a button that looks pressable while a request is
    // in flight gets pressed again, and the second press is the one that shows
    // the player an "already claimed" error for a claim that worked.
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.textContent = "…";

    try {
      const res = await claimChallenge(id);
      callbacks.onSound?.("claim");
      callbacks.onClaimed?.(res.coinsAwarded, res.profile);
      // Re-read rather than patching the row locally. A claim can only change
      // one row, but a run may have finished in another tab since this screen
      // loaded, and a refetch is one cheap request against being subtly wrong.
      const fresh = await fetchChallenges();
      absorb(fresh.challenges);
      if (isOpenState) render();
    } catch {
      callbacks.onSound?.("error");
      claiming.delete(id);
      if (!isOpenState) return;
      btn.disabled = false;
      btn.innerHTML = original;
      // The claim failed and the row is unchanged, so say so on the card rather
      // than replacing the screen: losing the whole list because one button
      // failed is a worse outcome than the failure.
      const card = btn.closest(".ch-card");
      if (card && !card.querySelector(".ch-error")) {
        const p = document.createElement("p");
        p.className = "ch-error";
        p.textContent = "Couldn't claim that — try again in a moment.";
        card.appendChild(p);
      }
      return;
    }
    claiming.delete(id);
  }

  // --- wiring ---------------------------------------------------------------

  // ONE delegated listener over the whole page rather than a handler per
  // button: the list is re-rendered on every tab change and after every claim,
  // so per-button handlers would have to be re-attached each time and any one
  // that was missed would be a dead control.
  root.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;

      const back = target.closest("#challengesBackBtn");
      if (back) {
        close();
        return;
      }

      const tabBtn = target.closest<HTMLElement>("[data-tab]");
      if (tabBtn) {
        const next = tabBtn.dataset.tab as Tab | undefined;
        if (next && next !== tab) {
          tab = next;
          render();
        }
        return;
      }

      const claimBtn = target.closest<HTMLButtonElement>("[data-claim]");
      if (claimBtn?.dataset.claim) {
        void doClaim(claimBtn.dataset.claim, claimBtn);
      }
    },
    { signal },
  );

  // The chip's listener lives here rather than in main.ts because this module
  // owns the badge drawn on it — one owner for the control and its state.
  if (chip) {
    chip.addEventListener("click", () => open(), { signal });
  }

  // --- lifecycle ------------------------------------------------------------

  function open(): void {
    isOpenState = true;
    root.classList.remove("hidden");
    document.body.classList.add("challenges-open");
    // Open on whatever has a reward waiting, otherwise on the first category.
    // A player who has something to collect should not have to find it.
    tab = claimableCount(rows) > 0 ? "ready" : "collect";

    // Render what is already in hand FIRST, then refresh. On every visit after
    // the first that means the screen is populated instantly and merely
    // updates, rather than flashing "Loading…" over a list it already has.
    if (rows.length > 0) render();
    else renderMessage("Loading…");

    void fetchChallenges()
      .then((res) => {
        absorb(res.challenges);
        if (!isOpenState) return;
        if (tab !== "ready" && claimableCount(rows) > 0) tab = "ready";
        render();
      })
      .catch(() => {
        if (isOpenState && rows.length === 0) {
          renderMessage("Couldn't load your challenges. Try again in a moment.");
        }
      });
  }

  function close(): void {
    isOpenState = false;
    root.classList.add("hidden");
    document.body.classList.remove("challenges-open");
    root.textContent = "";
    callbacks.onClose?.();
  }

  async function refreshBadge(): Promise<void> {
    try {
      const res = await fetchChallenges();
      absorb(res.challenges);
      if (isOpenState) render();
    } catch {
      // A failed badge refresh is not worth telling anyone about: the count
      // simply stays as it was and corrects itself on the next run or open.
    }
  }

  return {
    open,
    close,
    detach: () => {
      live.abort();
      if (isOpenState) close();
    },
    isOpen: () => isOpenState,
    refreshBadge,
  };
}

/** Re-exported so callers can size a badge without importing the game module
 *  as well. */
export { CHALLENGES };
