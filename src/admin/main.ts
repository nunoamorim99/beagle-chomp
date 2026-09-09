// OWNER: backend / tooling (IDEA-051)
//
// The metrics portal. One operator, one screen, no build-time framework.
//
// Rendering is `innerHTML` from template strings, which is only safe because
// EVERY value that reaches the DOM goes through the escaping in charts.ts. Note
// what flows through here: usernames. They are the one genuinely
// player-controlled string in this app, and the game's own leaderboard treats
// them as untrusted for exactly that reason (src/ui/leaderboard.ts builds rows
// with createElement + textContent). The server's `^[A-Za-z0-9_-]{3,20}$` rule
// makes markup unstorable, but that is a constraint on the SERVER — this file
// must not depend on it, so `esc()` is applied at every interpolation.

import "./admin.css";
import * as api from "./api.js";
import { renderNewsTab } from "./news.js";
import {
  ENEMY_HUES,
  barChart,
  lineChart,
  cohortGrid,
  statTile,
  table,
  empty,
  fmt,
  fmtPct,
  fmtDuration,
  ACCENT,
  GOOD,
  CRITICAL,
} from "./charts.js";

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

const app = document.getElementById("app") as HTMLDivElement;

type TabId = "overview" | "retention" | "difficulty" | "content" | "health" | "players" | "news";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "retention", label: "Retention" },
  { id: "difficulty", label: "Difficulty" },
  { id: "content", label: "Content" },
  { id: "health", label: "Health" },
  { id: "players", label: "Players" },
  // The only tab that WRITES anything.
  { id: "news", label: "News" },
];

let currentTab: TabId = "overview";
let username = "";

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function renderLogin(message?: string): void {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login" id="loginForm">
        <h1>Beagle Chomp</h1>
        <p class="sub">Metrics portal</p>
        ${message ? `<p class="error">${esc(message)}</p>` : ""}
        <label>Username
          <input id="u" name="username" autocomplete="username" autocapitalize="off"
                 spellcheck="false" required />
        </label>
        <label>Password
          <input id="p" name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="primary" type="submit" id="go">Sign in</button>
      </form>
    </div>`;

  const form = document.getElementById("loginForm") as HTMLFormElement;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = document.getElementById("go") as HTMLButtonElement;
    const u = (document.getElementById("u") as HTMLInputElement).value.trim();
    const p = (document.getElementById("p") as HTMLInputElement).value;
    btn.disabled = true;
    btn.textContent = "Signing in…";
    void api
      .login(u, p)
      .then((name) => {
        username = name;
        renderShell();
        void loadTab();
      })
      .catch((err: unknown) => {
        // A wrong password and a non-admin account are DIFFERENT failures and
        // must read differently, or granting the flag becomes guesswork.
        const msg =
          err instanceof api.AdminApiError ? err.message : "Something went wrong. Try again.";
        renderLogin(msg);
      });
  });
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function renderShell(): void {
  app.innerHTML = `
    <div class="topbar">
      <h1>Beagle Chomp</h1>
      <span class="who">metrics · ${esc(username)}</span>
      <span class="spacer"></span>
      <button class="ghost" id="refresh">Refresh</button>
      <button class="ghost" id="signout">Sign out</button>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map(
        (t) =>
          `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${
            t.id === currentTab
          }">${esc(t.label)}</button>`,
      ).join("")}
    </div>
    <main id="view"></main>`;

  app.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab as TabId;
      app.querySelectorAll(".tab").forEach((b) =>
        b.setAttribute("aria-selected", String(b === btn)),
      );
      void loadTab();
    });
  });

  document.getElementById("refresh")?.addEventListener("click", () => void loadTab());
  document.getElementById("signout")?.addEventListener("click", () => {
    void api.logout().then(() => {
      username = "";
      renderLogin();
    });
  });
}

function view(html: string): void {
  const el = document.getElementById("view");
  if (el) el.innerHTML = html;
}

async function loadTab(): Promise<void> {
  view(`<p class="empty">Loading…</p>`);
  try {
    switch (currentTab) {
      case "overview":
        return view(renderOverview(await api.fetchOverview()));
      case "retention":
        return view(renderRetention(await api.fetchRetention()));
      case "difficulty":
        return view(renderDifficulty(await api.fetchChallenges(), await api.fetchGameplay()));
      case "content":
        return view(renderContent(await api.fetchContent()));
      case "health":
        return view(renderHealth(await api.fetchHealth()));
      case "players":
        return renderPlayers();
      case "news": {
        // Owns its own host: the composer re-renders itself on every save,
        // publish and delete, so it needs the element rather than a string.
        const el = document.getElementById("view");
        if (el) await renderNewsTab(el);
        return;
      }
    }
  } catch (err: unknown) {
    if (err instanceof api.AdminApiError && err.status === 401) {
      api.clearToken();
      renderLogin("Your session expired. Sign in again.");
      return;
    }
    const msg = err instanceof Error ? err.message : "Request failed.";
    view(`<div class="panel"><p class="error">${esc(msg)}</p></div>`);
  }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function renderOverview(d: api.Overview): string {
  const t = d.totals;
  return `
    <section class="panel">
      <h2>Right now</h2>
      <p class="sub">Active means started a run — not merely signed in, which this client does automatically.</p>
      <div class="stats">
        ${statTile("Players today", fmt(t.players_today))}
        ${statTile("Active 7d", fmt(t.players_7d))}
        ${statTile("Active 30d", fmt(t.players_30d))}
        ${statTile("Stickiness", t.players_30d > 0 ? fmtPct(t.players_7d / t.players_30d) : "—", "7d ÷ 30d")}
        ${statTile("Accounts", fmt(t.total_players), `${fmt(t.signups_7d)} new this week`)}
        ${statTile("Runs 7d", fmt(t.runs_7d))}
        ${statTile("Play time 7d", `${fmt(t.play_hours_7d)}h`)}
      </div>
    </section>

    <div class="grid2">
      <section class="panel">
        <h2>Daily players</h2>
        <p class="sub">Distinct accounts that started at least one run.</p>
        ${lineChart(d.activity.map((a) => ({ day: a.day, value: a.players })))}
      </section>
      <section class="panel">
        <h2>Daily runs</h2>
        <p class="sub">Every run started, finished or not.</p>
        ${lineChart(d.activity.map((a) => ({ day: a.day, value: a.runs })), { color: GOOD })}
      </section>
    </div>

    <section class="panel">
      <h2>The numbers</h2>
      <p class="sub">Same data as the charts above — sortable by eye, exact rather than approximate.</p>
      <div class="scroll">
        ${table(
          ["Day", "Players", "Runs", "Play time"],
          d.activity
            .slice()
            .reverse()
            .map((a) => [a.day, a.players, a.runs, fmtDuration(a.playSeconds)]),
          "No activity recorded in this window.",
        )}
      </div>
    </section>`;
}

function renderRetention(d: api.Retention): string {
  const head = d.headline;
  return `
    <section class="panel">
      <h2>Do they come back?</h2>
      <p class="sub">
        Weighted by cohort size — a 2-player cohort at 100% does not outweigh a
        200-player one at 10%. Cohorts too young to have reached an offset are
        excluded from it rather than counted as zero.
      </p>
      <div class="stats">
        ${statTile("D1", fmtPct(head["1"] ?? null))}
        ${statTile("D7", fmtPct(head["7"] ?? null))}
        ${statTile("D30", fmtPct(head["30"] ?? null))}
      </div>
    </section>

    <section class="panel">
      <h2>Signup cohorts</h2>
      <p class="sub">
        Each row is everyone who signed up that day; each cell is how many had
        started a run by then. A dashed cell means that cohort has not lived
        long enough to have a D-number yet — which is not the same as 0%.
      </p>
      <div class="scroll">${cohortGrid(d.matrix)}</div>
    </section>`;
}

function renderDifficulty(c: api.Challenges, g: api.Gameplay): string {
  const enemyBars = g.enemies.map((e) => ({
    label: e.label,
    value: e.count,
    color: ENEMY_HUES[e.slot] ?? ACCENT,
    note: fmtPct(e.share),
  }));

  const hardest = c.ranked.length
    ? table(
        ["Level", "Attempts", "Clears", "Clear rate", "Attempts / clear", "Median time", "Avg deaths"],
        c.ranked.map((s) => [
          `C${s.challengeIdx + 1}`,
          s.attempts,
          s.clears,
          fmtPct(s.clearRate),
          s.attemptsPerClear === null ? "—" : s.attemptsPerClear.toFixed(1),
          s.medianClearSeconds === null ? "—" : fmtDuration(s.medianClearSeconds),
          s.avgDeaths === null ? "—" : s.avgDeaths.toFixed(1),
        ]),
      )
    : empty("No challenge level has enough attempts to rank yet.");

  const notRanked = c.insufficient.length
    ? `<p class="sub">Not ranked (too few attempts to mean anything): ${c.insufficient
        .map((s) => `C${s.challengeIdx + 1} (${s.attempts})`)
        .join(", ")}</p>`
    : "";

  return `
    <section class="panel">
      <h2>Hardest challenge levels</h2>
      <p class="sub">
        Ordered by clear rate, hardest first. A level with fewer than 5 attempts
        is listed but not ranked — one player failing once is a 0% clear rate and
        means nothing.
      </p>
      <div class="scroll">${hardest}</div>
      ${notRanked}
    </section>

    <div class="grid2">
      <section class="panel">
        <h2>Which enemy kills you</h2>
        <p class="sub">
          ${
            g.nemesis
              ? `The <strong>${esc(g.nemesis.label)}</strong> one, ${esc(fmtPct(g.nemesis.share))} of all deaths.`
              : "No clear leader — a tie, or nothing recorded yet."
          }
        </p>
        ${barChart(enemyBars, { unit: "deaths" })}
        <div class="legend">
          ${g.enemies
            .map(
              (e) =>
                `<span><i class="swatch" style="background:${ENEMY_HUES[e.slot] ?? ACCENT}"></i>${esc(
                  e.label,
                )}</span>`,
            )
            .join("")}
        </div>
      </section>

      <section class="panel">
        <h2>Fruit eaten</h2>
        <p class="sub">
          ${
            g.favouriteFruit
              ? `Most eaten: <strong>${esc(g.favouriteFruit.label)}</strong>.`
              : "Nothing recorded yet."
          }
        </p>
        ${barChart(g.fruits.map((f) => ({ label: f.label, value: f.count, note: fmtPct(f.share) })), {
          unit: "eaten",
        })}
      </section>
    </div>

    <section class="panel">
      <h2>Where classic runs end</h2>
      <p class="sub">Maps played per accepted run — the difficulty wall, as a shape.</p>
      ${barChart(
        c.depth.map((row) => ({ label: `${row.levels_played} maps`, value: row.runs })),
        { unit: "runs" },
      )}
    </section>`;
}

function renderContent(d: api.Content): string {
  const block = (title: string, sub: string, rows: api.Share[]): string => `
    <section class="panel">
      <h2>${esc(title)}</h2>
      <p class="sub">${esc(sub)}</p>
      ${barChart(rows.map((r) => ({ label: r.value, value: r.runs, note: fmtPct(r.share) })), {
        unit: "runs",
      })}
    </section>`;

  return `
    <p class="sub" style="margin:0">
      Measured per RUN, from what was equipped when each run finished — not from
      what is equipped right now. Runs from before this shipped have no
      cosmetics recorded and count toward the total but appear in no bar, so
      shares can sum to less than 100%.
    </p>
    <div class="grid2">
      ${block("Beagle skins", "Which coat was actually being played.", d.beagleSkins)}
      ${block("Enemy skins", "Which enemy set was on screen.", d.enemySkins)}
      ${block("Maze themes", "Which garden they played in.", d.mazeThemes)}
      ${block("Control schemes", "Swipe, D-pad or thumbstick.", d.controlSchemes)}
    </div>`;
}

function renderHealth(d: api.Health): string {
  const r = d.rejections;
  const banner = r.alarming
    ? `<div class="banner bad"><strong>Rejection rate is high (${esc(fmtPct(r.rejectionRate))}).</strong>
         The usual cause is not cheating — it is a <code>config.ts</code> change that was never
         followed by <code>npm run sync</code> in <code>server/</code>, so the validator is
         refusing honest runs. Check the reason codes below.</div>`
    : `<div class="banner ok"><strong>Rejections look normal (${esc(fmtPct(r.rejectionRate))}).</strong>
         A rise here is the alarm for a forgotten <code>npm run sync</code>.</div>`;

  return `
    <section class="panel">
      <h2>Score rejections</h2>
      <p class="sub">Runs the validator refused, and why.</p>
      ${banner}
      <div class="stats" style="margin-top:12px">
        ${statTile("Accepted", fmt(r.totalAccepted))}
        ${statTile("Rejected", fmt(r.totalRejected))}
        ${statTile("Rate", fmtPct(r.rejectionRate))}
      </div>
      <div class="scroll" style="margin-top:12px">
        ${table(
          ["Reason", "Count", "Players", "Last seen"],
          r.reasons.map((x) => [x.reason_code, x.count, x.players, x.last_seen.slice(0, 10)]),
          "No rejections in this window — which is the good outcome.",
        )}
      </div>
    </section>

    <section class="panel">
      <h2>API latency</h2>
      <p class="sub">
        p95 per route, from the in-process window IDEA-039 has been logging.
        Resets every ${esc("10")} minutes when the container prints its table, so
        this shows the CURRENT window, not all time. Uptime ${esc(
          fmtDuration(d.uptimeSeconds),
        )} · v${esc(d.version)}.
      </p>
      <div class="scroll">
        ${table(
          ["Route", "Count", "p50", "p95", "max", "2xx", "4xx", "5xx"],
          d.requests.routes.map((x) => [
            x.route,
            x.count,
            `${x.p50}ms`,
            `${x.p95}ms`,
            `${x.maxMs}ms`,
            x.status2xx,
            x.status4xx,
            x.status5xx,
          ]),
          "No requests in the current window.",
        )}
      </div>
    </section>`;
}

// --- players ----------------------------------------------------------------

function renderPlayers(): void {
  view(`
    <section class="panel">
      <h2>Players</h2>
      <p class="sub">Search by the start of a username. Pick one for their year in review.</p>
      <form id="pf" style="display:flex;gap:8px;margin-bottom:12px">
        <input id="pq" placeholder="username prefix" autocapitalize="off" spellcheck="false" />
        <button class="primary" type="submit">Search</button>
      </form>
      <div id="plist"><p class="empty">Loading…</p></div>
    </section>
    <div id="rewind"></div>`);

  const load = (q: string): void => {
    void api
      .fetchPlayers(q)
      .then(({ players }) => {
        const el = document.getElementById("plist");
        if (!el) return;
        el.innerHTML = `<div class="scroll">${table(
          ["Username", "Joined", "Best", "Runs", "Last played"],
          players.map((p) => [
            p.username,
            p.created_at.slice(0, 10),
            p.high_score,
            p.runs,
            p.last_played ? p.last_played.slice(0, 10) : "never",
          ]),
          "No players match.",
        )}</div>`;
        // Clicking a row opens that player's rewind.
        el.querySelectorAll("tbody tr").forEach((tr, i) => {
          (tr as HTMLElement).style.cursor = "pointer";
          tr.addEventListener("click", () => showRewind(players[i].username));
        });
      })
      .catch((err: unknown) => {
        const el = document.getElementById("plist");
        if (el) el.innerHTML = `<p class="error">${esc((err as Error).message)}</p>`;
      });
  };

  document.getElementById("pf")?.addEventListener("submit", (e) => {
    e.preventDefault();
    load((document.getElementById("pq") as HTMLInputElement).value.trim());
  });
  load("");
}

function showRewind(name: string): void {
  const host = document.getElementById("rewind");
  if (!host) return;
  host.innerHTML = `<section class="panel"><p class="empty">Loading ${esc(name)}…</p></section>`;

  void api
    .fetchRewind(name)
    .then((d) => {
      host.innerHTML = `
        <section class="panel">
          <h2>${esc(d.username)} · ${esc(d.since.slice(0, 4))}</h2>
          <p class="sub">Joined ${esc(d.joined)} · accepted runs only.</p>
          <div class="stats">
            ${statTile("Runs", fmt(d.runs))}
            ${statTile("Days played", fmt(d.daysPlayed))}
            ${statTile("Play time", fmtDuration(d.playSeconds))}
            ${statTile("Longest run", fmtDuration(d.longestRunSeconds))}
            ${statTile("Best score", fmt(d.highScore))}
            ${statTile("Biscuits", fmt(d.pelletsEaten))}
            ${statTile("Fruit", fmt(d.fruitEaten))}
            ${statTile("Coins found", fmt(d.coinsCollected))}
            ${statTile("Enemies eaten", fmt(d.ghostsEaten))}
            ${statTile("Deaths", fmt(d.livesLost))}
            ${statTile("Maps cleared", fmt(d.levelsCleared))}
            ${statTile("Challenges", fmt(d.challengeProgress))}
          </div>
          <div class="stats" style="margin-top:12px">
            ${statTile("Nemesis", d.nemesis ? d.nemesis.label : "—", d.nemesis ? `${fmt(d.nemesis.count)} deaths` : "no clear leader")}
            ${statTile("Favourite fruit", d.favouriteFruit ? d.favouriteFruit.label : "—")}
            ${statTile("Favourite theme", d.favouriteTheme ?? "—")}
            ${statTile("Favourite coat", d.favouriteBeagleSkin ?? "—")}
          </div>
        </section>`;
      host.scrollIntoView({ behavior: "smooth", block: "start" });
    })
    .catch((err: unknown) => {
      host.innerHTML = `<section class="panel"><p class="error">${esc(
        (err as Error).message,
      )}</p></section>`;
    });
}

// ---------------------------------------------------------------------------

// A token in storage is not proof it still works — it may have expired or been
// revoked. Probe with /auth/me, which also supplies the username: that is only
// known as a side effect of logging IN, so a reload used to paint the header as
// "metrics ·" with nothing after it. A 401 here drops straight to the login form
// rather than showing a shell whose panels then fail one at a time.
if (api.getToken()) {
  void api
    .me()
    .then((name) => {
      username = name;
      renderShell();
      void loadTab();
    })
    .catch(() => {
      api.clearToken();
      renderLogin();
    });
} else {
  renderLogin();
}

// Unused import guard: CRITICAL is part of the exported status palette and is
// referenced by admin.css's banner styling rather than inline. Kept exported.
void CRITICAL;
