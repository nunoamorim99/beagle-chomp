// OWNER: backend / tooling (IDEA-052)
//
// The composer: write a release note or a notice, and publish it to the game.
//
// This is the ONLY screen in the portal that writes anything. Everything else
// reads numbers. Two rules follow from that:
//
//   1. SAVING AND PUBLISHING ARE DIFFERENT ACTS. Save creates or edits a draft
//      that no player can see; Publish is a second, deliberate press with a
//      confirmation, because it puts text in front of everyone who opens the
//      game. The server enforces the same split — `create` cannot publish.
//   2. NOTHING HERE IS THE XSS DEFENCE. The body is stored verbatim and the
//      GAME renders it with createElement + textContent. This screen escapes
//      when it echoes text back into its own DOM, but that protects the
//      operator's own browser, not the players'.
//
// The preview is deliberately literal: it renders the body the same way the
// game does (paragraphs from blank lines, text nodes only), so what you see
// here is what a player sees — including that markup shows as characters.

import * as api from "./api.js";

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

type Draft = api.AnnouncementDraft & { id: string | null };

const blank = (): Draft => ({ id: null, kind: "notice", version: null, title: "", body: "" });

let editing: Draft = blank();
let items: api.AdminAnnouncement[] = [];
let status: { kind: "ok" | "error"; text: string } | null = null;

/** Render the body the way the GAME does — real paragraphs from blank lines,
 *  text nodes only. Same rule, so the preview cannot flatter the real thing. */
function renderPreview(host: HTMLElement, body: string): void {
  host.textContent = "";
  for (const para of body.split(/\n{2,}/)) {
    const text = para.trim();
    if (!text) continue;
    const p = document.createElement("p");
    text.split("\n").forEach((line, i) => {
      if (i > 0) p.append(document.createElement("br"));
      p.append(document.createTextNode(line));
    });
    host.append(p);
  }
  if (host.childElementCount === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nothing to preview yet.";
    host.append(p);
  }
}

function listHtml(): string {
  if (items.length === 0) {
    return `<p class="empty">Nothing written yet.</p>`;
  }
  return `<div class="scroll"><table class="data">
    <thead><tr><th>Status</th><th>Kind</th><th>Title</th><th>Published</th><th></th></tr></thead>
    <tbody>${items
      .map(
        (a) => `<tr data-id="${esc(a.id)}">
        <td>${a.isDraft ? `<span class="pill pill--draft">Draft</span>` : `<span class="pill pill--live">Live</span>`}</td>
        <td>${esc(a.kind === "release" ? a.version ?? "release" : "notice")}</td>
        <td>${esc(a.title)}</td>
        <td>${a.publishedAt ? esc(a.publishedAt.slice(0, 10)) : "—"}</td>
        <td class="row-actions">
          <button class="ghost sm" data-act="edit">Edit</button>
          <button class="ghost sm" data-act="toggle">${a.isDraft ? "Publish" : "Unpublish"}</button>
          <button class="ghost sm danger" data-act="delete">Delete</button>
        </td>
      </tr>`,
      )
      .join("")}</tbody></table></div>`;
}

function composerHtml(): string {
  const d = editing;
  return `
  <section class="panel">
    <h2>${d.id ? "Edit note" : "Write a note"}</h2>
    <p class="sub">
      Saving creates a DRAFT that no player can see. Publishing is a separate,
      deliberate press.
    </p>
    ${status ? `<p class="${status.kind === "ok" ? "banner ok" : "error"}">${esc(status.text)}</p>` : ""}
    <form id="composer" class="composer">
      <div class="row">
        <label>Kind
          <select id="f-kind">
            <option value="notice"${d.kind === "notice" ? " selected" : ""}>Notice</option>
            <option value="release"${d.kind === "release" ? " selected" : ""}>Release note</option>
          </select>
        </label>
        <label id="f-version-wrap" class="${d.kind === "release" ? "" : "hidden"}">Version
          <input id="f-version" maxlength="${api.LIMITS.version}" placeholder="v8.0"
                 value="${esc(d.version ?? "")}" />
        </label>
      </div>
      <label>
        <span class="field-head">Title <span class="count" id="c-title"></span></span>
        <input id="f-title" maxlength="${api.LIMITS.title}" value="${esc(d.title)}" />
      </label>
      <label>
        <span class="field-head">Body <span class="count" id="c-body"></span></span>
        <textarea id="f-body" rows="9" maxlength="${api.LIMITS.body}"
                  placeholder="Plain text. A blank line starts a new paragraph.">${esc(d.body)}</textarea>
      </label>
      <div class="row">
        <button class="primary" type="submit">${d.id ? "Save changes" : "Save draft"}</button>
        ${d.id ? `<button class="ghost" type="button" id="f-new">New</button>` : ""}
      </div>
    </form>
  </section>

  <section class="panel">
    <h2>Preview</h2>
    <p class="sub">Rendered exactly as the game renders it — markup shows as characters.</p>
    <article class="news-preview">
      <h3 id="p-title"></h3>
      <p class="sub" id="p-sub"></p>
      <div id="p-body"></div>
    </article>
  </section>

  <section class="panel">
    <h2>Everything written</h2>
    <p class="sub">Drafts are invisible to players until published.</p>
    <div id="news-list">${listHtml()}</div>
  </section>`;
}

/** Read the form into `editing`, so a re-render never loses what was typed. */
function readForm(): void {
  const kind = (document.getElementById("f-kind") as HTMLSelectElement | null)?.value;
  editing.kind = kind === "release" ? "release" : "notice";
  editing.version =
    (document.getElementById("f-version") as HTMLInputElement | null)?.value.trim() || null;
  editing.title = (document.getElementById("f-title") as HTMLInputElement | null)?.value ?? "";
  editing.body = (document.getElementById("f-body") as HTMLTextAreaElement | null)?.value ?? "";
}

function syncPreview(): void {
  const title = document.getElementById("p-title");
  const sub = document.getElementById("p-sub");
  const body = document.getElementById("p-body");
  if (!title || !sub || !body) return;

  // textContent, not innerHTML — the preview must behave like the game.
  title.textContent = editing.title || "Untitled";
  sub.textContent =
    editing.kind === "release" && editing.version ? `${editing.version} · today` : "today";
  renderPreview(body as HTMLElement, editing.body);

  const ct = document.getElementById("c-title");
  const cb = document.getElementById("c-body");
  if (ct) ct.textContent = `${editing.title.length}/${api.LIMITS.title}`;
  if (cb) cb.textContent = `${editing.body.length}/${api.LIMITS.body}`;

  document
    .getElementById("f-version-wrap")
    ?.classList.toggle("hidden", editing.kind !== "release");
}

export async function renderNewsTab(host: HTMLElement): Promise<void> {
  host.innerHTML = `<p class="empty">Loading…</p>`;
  try {
    items = (await api.listAnnouncements()).items;
  } catch (err) {
    host.innerHTML = `<div class="panel"><p class="error">${esc((err as Error).message)}</p></div>`;
    return;
  }

  host.innerHTML = composerHtml();
  syncPreview();
  status = null;

  const form = document.getElementById("composer") as HTMLFormElement | null;
  for (const id of ["f-kind", "f-version", "f-title", "f-body"]) {
    document.getElementById(id)?.addEventListener("input", () => {
      readForm();
      syncPreview();
    });
    document.getElementById(id)?.addEventListener("change", () => {
      readForm();
      syncPreview();
    });
  }

  document.getElementById("f-new")?.addEventListener("click", () => {
    editing = blank();
    void renderNewsTab(host);
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    readForm();
    const draft: api.AnnouncementDraft = {
      kind: editing.kind,
      version: editing.kind === "release" ? editing.version : null,
      title: editing.title,
      body: editing.body,
    };
    const saved = editing.id
      ? api.updateAnnouncement(editing.id, draft)
      : api.createAnnouncement(draft);
    void saved
      .then(({ announcement }) => {
        editing = { ...draft, id: announcement.id };
        status = { kind: "ok", text: "Saved as a draft. Publish it when you're ready." };
        return renderNewsTab(host);
      })
      .catch((err: unknown) => {
        // The server's message is written for exactly this box — show it rather
        // than a generic failure.
        status = { kind: "error", text: (err as Error).message };
        host.innerHTML = composerHtml();
        syncPreview();
        void renderNewsTab(host);
      });
  });

  // Row actions. Delegated, so the table can re-render without rebinding.
  document.getElementById("news-list")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-act]");
    if (!btn) return;
    const id = btn.closest("tr")?.getAttribute("data-id");
    const item = items.find((a) => a.id === id);
    if (!item) return;

    const act = btn.getAttribute("data-act");
    if (act === "edit") {
      editing = { id: item.id, kind: item.kind, version: item.version, title: item.title, body: item.body };
      void renderNewsTab(host);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (act === "toggle") {
      // Publishing puts text in front of every player. Ask.
      if (
        item.isDraft &&
        !window.confirm(`Publish "${item.title}" to every player?`)
      ) {
        return;
      }
      void api
        .publishAnnouncement(item.id, item.isDraft)
        .then(() => renderNewsTab(host))
        .catch((err: unknown) => {
          status = { kind: "error", text: (err as Error).message };
          void renderNewsTab(host);
        });
      return;
    }

    if (act === "delete") {
      if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
      void api
        .deleteAnnouncement(item.id)
        .then(() => {
          if (editing.id === item.id) editing = blank();
          return renderNewsTab(host);
        })
        .catch((err: unknown) => {
          status = { kind: "error", text: (err as Error).message };
          void renderNewsTab(host);
        });
    }
  });
}
