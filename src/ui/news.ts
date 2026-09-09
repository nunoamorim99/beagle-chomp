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

    // Paragraphs from blank lines. A real <p> each — see the header for why
    // this is not a replace() into innerHTML.
    for (const para of a.body.split(/\n{2,}/)) {
      const text = para.trim();
      if (text.length === 0) continue;
      const p = document.createElement("p");
      p.className = "news-body";
      // Single newlines inside a paragraph become real <br> ELEMENTS, appended
      // between text nodes. Never a string containing "<br>".
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (i > 0) p.append(document.createElement("br"));
        p.append(document.createTextNode(line));
      });
      card.append(p);
    }

    return card;
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

  async function refreshBadge(): Promise<void> {
    try {
      const feed = await fetchAnnouncements();
      setUnread(feed.unread);
    } catch {
      // A failed badge check is not worth surfacing — the bell simply shows no
      // dot, and the next boot tries again.
    }
  }

  return {
    open,
    close,
    detach: () => {
      close();
      setUnread(0);
    },
    isOpen: () => isOpenState,
    refreshBadge,
  };
}
