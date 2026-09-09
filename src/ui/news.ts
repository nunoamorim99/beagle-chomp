// OWNER: gameplay-engineer (IDEA-052)
//
// The News screen: release notes and notices, written from the metrics portal.
//
// SECURITY NOTE — read this before touching the render.
//
// This is the SECOND screen in the game that renders a string the client did
// not author (leaderboard.ts is the first, for usernames), and it is the more
// dangerous of the two. A username is boxed in by the server's
// `^[A-Za-z0-9_-]{3,20}$`, so markup is unstorable; an announcement body is
// FREE-FORM TEXT up to 4,000 characters and is meant to be. "Written by the
// operator" is not a safety property — to this file it arrives over the network
// exactly like a username does.
//
// So the cards are built with createElement + textContent. Not escapeHtml into
// innerHTML: `escapeHtml` is a text-node escaper, not a sanitiser, and the
// moment anyone wants a link in a note it stops being sufficient (it does not
// neutralise `javascript:`). textContent makes markup structurally impossible
// rather than escaped-and-hopefully-correct.
//
// The paragraph split is where this would most plausibly go wrong. Blank lines
// separate paragraphs, and the tempting one-liner is
// `body.replace(/\n\n/g, "<br><br>")` into innerHTML — which reintroduces the
// hole in one line. Split the string, make a real <p> per paragraph.
//
// Follows the attachX() => handle pattern; no `three` imports.

import {
  fetchAnnouncements,
  markAnnouncementsSeen,
  type Announcement,
} from "../net/endpoints";
import { ICON, icon } from "./icons";

export interface NewsHandle {
  open: () => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
  /** Fetch the unread count and update the bell, without opening anything.
   *  Called once after sign-in. */
  refreshBadge: () => Promise<void>;
}

export interface NewsCallbacks {
  onClose?: () => void;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachNews: missing element #${id} — check index.html`);
  return el;
}

/** A note's date, as something a person reads. Falls back to the raw string
 *  rather than showing "Invalid Date" if the server ever sends something odd. */
function formatDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  // "en-GB", not the browser's locale. Every other string in this game is
  // English (tokens.css: "usernames are [A-Za-z0-9_-] and every string is
  // English"), and a note headed "9 de setembro de 2026" above English body
  // copy reads as a bug rather than as thoughtfulness. Caught on a Portuguese
  // browser, where `undefined` did exactly that.
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function attachNews(callbacks: NewsCallbacks = {}): NewsHandle {
  const root = require<HTMLDivElement>("news");
  const bell = document.getElementById("menuNewsBtn");
  const dot = document.getElementById("menuNewsDot");
  let isOpenState = false;
  // Removes the live listeners on detach. startApp() re-runs on sign-out and on
  // a mid-session 401, so without this they stack one set per session.
  const live = new AbortController();
  const liveSignal = live.signal;

  /**
   * One card. NOTHING here touches innerHTML.
   *
   * `sub` is the version and date line; a notice has no version, so it shows
   * only the date rather than an empty separator.
   */
  function buildCard(a: Announcement): HTMLElement {
    const card = document.createElement("article");
    card.className = `news-card${a.isNew ? " news-card--new" : ""}`;

    const head = document.createElement("header");
    head.className = "news-card-head";

    const mark = document.createElement("span");
    mark.className = `news-mark news-mark--${a.kind}`;
    mark.setAttribute("aria-hidden", "true");
    // An icon element carries its ligature as TEXT, so this is the one place a
    // textContent write is the correct way to set an icon.
    const glyph = document.createElement("i");
    glyph.className = "bc-i";
    glyph.textContent = a.kind === "release" ? ICON.announcement : ICON.news;
    mark.append(glyph);

    const titles = document.createElement("div");
    titles.className = "news-titles";

    const h = document.createElement("h2");
    h.textContent = a.title;

    const sub = document.createElement("p");
    sub.className = "news-sub";
    const day = formatDay(a.publishedAt);
    sub.textContent = a.version ? `${a.version} · ${day}` : day;

    titles.append(h, sub);
    head.append(mark, titles);

    if (a.isNew) {
      const badge = document.createElement("span");
      badge.className = "news-new";
      badge.textContent = "New";
      head.append(badge);
    }

    card.append(head);

    // A PREVIEW on the card, the whole thing in the detail sheet. The list is
    // for scanning — a 4,000-character release note would push every other
    // card off the screen and bury the one you were looking for.
    const preview = document.createElement("p");
    preview.className = "news-body news-body--clamp";
    preview.textContent = a.body.replace(/\s*\n\s*/g, " ").trim();
    card.append(preview);

    const more = document.createElement("span");
    more.className = "news-more";
    more.textContent = "Read more";
    card.append(more);

    // The whole card is the target, not just the link — a 44px row is easier to
    // hit than a word, and the affordance is already the card.
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.addEventListener("click", () => openDetail(a));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(a);
      }
    });

    return card;
  }

  /**
   * Render a plain-text body into real paragraphs.
   *
   * Blank lines separate paragraphs; single newlines become real <br>
   * ELEMENTS between text nodes. NEVER a string containing "<br>" — that is the
   * one line that would turn this whole screen back into an innerHTML sink, and
   * it is the most tempting shortcut in the file. See the header.
   */
  function renderBody(host: HTMLElement, body: string): void {
    for (const para of body.split(/\n{2,}/)) {
      const text = para.trim();
      if (text.length === 0) continue;
      const p = document.createElement("p");
      p.className = "news-body";
      text.split("\n").forEach((line, i) => {
        if (i > 0) p.append(document.createElement("br"));
        p.append(document.createTextNode(line));
      });
      host.append(p);
    }
  }

  /**
   * The full note, over the list.
   *
   * A sheet rather than a second screen: the player is reading a list and wants
   * one item out of it, so going "into" a note and back should not lose their
   * place. Escape and the backdrop both close it, because a modal you can only
   * leave by finding the right button is a trap on a phone.
   */
  function openDetail(a: Announcement): void {
    const existing = root.querySelector(".news-detail");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "news-detail";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const sheet = document.createElement("div");
    sheet.className = "news-detail-sheet";

    const head = document.createElement("header");
    head.className = "news-card-head";

    const mark = document.createElement("span");
    mark.className = `news-mark news-mark--${a.kind}`;
    mark.setAttribute("aria-hidden", "true");
    const glyph = document.createElement("i");
    glyph.className = "bc-i";
    // An icon element carries its ligature as TEXT — this is the one place a
    // textContent write is the correct way to set an icon.
    glyph.textContent = a.kind === "release" ? ICON.announcement : ICON.news;
    mark.append(glyph);

    const titles = document.createElement("div");
    titles.className = "news-titles";
    const h = document.createElement("h2");
    h.textContent = a.title;
    const sub = document.createElement("p");
    sub.className = "news-sub";
    const day = formatDay(a.publishedAt);
    sub.textContent = a.version ? `${a.version} · ${day}` : day;
    titles.append(h, sub);
    head.append(mark, titles);
    sheet.append(head);

    const bodyHost = document.createElement("div");
    bodyHost.className = "news-detail-body";
    renderBody(bodyHost, a.body);
    sheet.append(bodyHost);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-primary";
    // `icon()` returns an ELEMENT — interpolating it into a template string
    // gives "[object HTMLElement]".
    close.append(icon(ICON.close), document.createTextNode("Close"));
    sheet.append(close);

    const dismiss = (): void => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") dismiss();
    }
    close.addEventListener("click", dismiss);
    // Backdrop only — a click INSIDE the sheet must not close it, which is the
    // usual bug with this pattern.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener("keydown", onKey);

    overlay.append(sheet);
    root.append(overlay);
    close.focus();
  }

  /** Paint the bell's unread dot. Hidden at zero rather than shown empty. */
  function setUnread(count: number): void {
    if (!dot) return;
    dot.classList.toggle("hidden", count <= 0);
    if (count > 0) {
      dot.textContent = count > 9 ? "9+" : String(count);
      bell?.setAttribute("aria-label", `News — ${count} unread`);
    } else {
      dot.textContent = "";
      bell?.setAttribute("aria-label", "News");
    }
  }

  function shell(children: HTMLElement[], subtitle?: string): void {
    root.textContent = "";

    const sheet = document.createElement("div");
    sheet.className = "news-sheet";

    const header = document.createElement("header");
    header.className = "news-head";
    const h1 = document.createElement("h1");
    h1.textContent = "What's new";
    header.append(h1);
    if (subtitle) {
      const p = document.createElement("p");
      p.className = "news-lead";
      p.textContent = subtitle;
      header.append(p);
    }
    sheet.append(header);

    const list = document.createElement("div");
    list.className = "news-list";
    list.append(...children);
    sheet.append(list);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn-primary";
    // `icon()` returns an ELEMENT — interpolating it into a template string
    // gives "[object HTMLElement]Back", which is exactly what shipped in the
    // first cut and what a screenshot caught. `iconHtml()` is the string form;
    // appending the element is better still, since it keeps innerHTML out of
    // this file entirely.
    back.append(icon(ICON.back), document.createTextNode("Back"));
    back.addEventListener("click", () => close());
    sheet.append(back);

    root.append(sheet);
  }

  function renderMessage(message: string): void {
    const p = document.createElement("p");
    p.className = "news-empty";
    p.textContent = message;
    shell([p]);
  }

  function open(): void {
    isOpenState = true;
    root.classList.remove("hidden");
    document.body.classList.add("news-open");
    renderMessage("Loading…");

    void fetchAnnouncements()
      .then((feed) => {
        if (!isOpenState) return;
        if (feed.items.length === 0) {
          renderMessage("Nothing yet. Updates will show up here.");
        } else {
          shell(
            feed.items.map(buildCard),
            feed.unread > 0 ? `${feed.unread} new since you last looked` : undefined,
          );
        }

        // Mark seen only AFTER the notes are on screen — a failed fetch must
        // not silently clear the dot for something the player never saw.
        // Fire-and-forget: the badge is already cleared locally, and a failed
        // mark just means it reappears on the next boot, which is the safe way
        // round.
        setUnread(0);
        void markAnnouncementsSeen().catch(() => {
          /* see above */
        });
      })
      .catch(() => {
        if (isOpenState) renderMessage("Couldn't load the news. Try again in a moment.");
      });
  }

  function close(): void {
    isOpenState = false;
    root.classList.add("hidden");
    document.body.classList.remove("news-open");
    root.textContent = "";
    callbacks.onClose?.();
  }

  /** Guards against re-checking on every tab switch. A note is published a few
   *  times a year; once a minute is already generous. */
  let lastBadgeCheck = 0;
  const BADGE_MIN_GAP_MS = 60_000;

  async function refreshBadge(force = false): Promise<void> {
    if (!force && Date.now() - lastBadgeCheck < BADGE_MIN_GAP_MS) return;
    lastBadgeCheck = Date.now();
    try {
      const feed = await fetchAnnouncements();
      setUnread(feed.unread);
    } catch {
      // A failed badge check is not worth surfacing — the bell simply shows no
      // dot, and the next check tries again.
    }
  }

  /**
   * Keep the bell HONEST while the game is open.
   *
   * The badge used to be read exactly once, at sign-in. That is wrong in the
   * one case that matters most: a note published while the player already has
   * the game open never appeared — they got the push on their phone, opened the
   * app, and the bell was bare. Reported from a real device.
   *
   * Two cheap signals cover it:
   *   - `visibilitychange`, for "I tapped the notification and came back to a
   *     tab that was already loaded". Throttled, because switching tabs is
   *     common and publishing is not.
   *   - a message from the service worker, which is precise: push-sw.js tells
   *     every open window the moment a push lands, so the pill appears while
   *     the player is looking at the menu. Not throttled — a push IS the event.
   *
   * Deliberately NOT a poll. A timer would be a request per player per interval,
   * forever, for something that changes a few times a year.
   */
  function watchForNews(): void {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible" && !isOpenState) void refreshBadge();
      },
      { signal: liveSignal },
    );

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "message",
        (event: MessageEvent) => {
          const data = event.data as { type?: string } | null;
          if (data?.type !== "beagle-push") return;
          // force: a push is the event itself, so the throttle must not eat it.
          if (!isOpenState) void refreshBadge(true);
        },
        { signal: liveSignal },
      );
    }
  }

  watchForNews();

  return {
    open,
    close,
    detach: () => {
      live.abort();
      close();
      setUnread(0);
    },
    isOpen: () => isOpenState,
    refreshBadge: () => refreshBadge(true),
  };
}
