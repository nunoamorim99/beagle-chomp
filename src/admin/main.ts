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
  BEAGLE_CATALOG,
  ENEMY_CATALOG,
  THEME_CATALOG,
  CONTROL_CATALOG,
  CHALLENGE_LEVEL_COUNT,
  challengeMeta,
  nameShares,
  type CatalogEntry,
} from "./catalog.js";
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

type TabId =
  | "overview"
  | "retention"
  | "difficulty"
  | "content"
  | "health"
  | "players"
  | "reach"
  | "news";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "retention", label: "Retention" },
  { id: "difficulty", label: "Difficulty" },
  { id: "content", label: "Content" },
  { id: "health", label: "Health" },
  { id: "players", label: "Players" },
  { id: "reach", label: "Reach" },
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
      case "reach":
        return view(renderReach(await api.fetchNotifications()));
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

/** One challenge row, named. A bare "C33" is unreadable on a 40-level ladder —
 *  a tour level IS its maze, so the name is what makes a ranking mean anything. */
function challengeRow(s: api.ChallengeStanding): (string | number)[] {
  const m = challengeMeta(s.challengeIdx);
  return [
    `${m.code} · ${m.name}`,
    m.kind === "twist" ? "Twist" : m.chapter,
    s.attempts,
    s.clears,
    fmtPct(s.clearRate),
    s.attemptsPerClear === null ? "—" : s.attemptsPerClear.toFixed(1),
    s.medianClearSeconds === null ? "—" : fmtDuration(s.medianClearSeconds),
    s.avgDeaths === null ? "—" : s.avgDeaths.toFixed(1),
  ];
}

const CHALLENGE_COLUMNS = [
  "Level",
  "Chapter",
  "Attempts",
  "Clears",
  "Clear rate",
  "Attempts / clear",
  "Median time",
  "Avg deaths",
];

function renderDifficulty(c: api.Challenges, g: api.Gameplay): string {
  const enemyBars = g.enemies.map((e) => ({
    label: e.label,
    value: e.count,
    color: ENEMY_HUES[e.slot] ?? ACCENT,
    note: fmtPct(e.share),
  }));

  // The one thing importing the game's own ladder cannot catch: the SERVER's
  // generated catalog falling behind challenges.ts. That is a forgotten
  // `npm run sync`, which this dashboard exists to surface — and unflagged it
  // would show as a table that is quietly the wrong length.
  const drift =
    c.levelCount === CHALLENGE_LEVEL_COUNT
      ? ""
      : `<div class="banner bad"><strong>The server's catalog is out of step.</strong>
          The game has ${esc(CHALLENGE_LEVEL_COUNT)} challenge levels; the API reports
          ${esc(c.levelCount)}. That is a <code>npm run sync</code> in <code>server/</code>
          that never ran — the same drift that makes the validator refuse honest runs.
          Everything below is measured against the API's figure.</div>`;

  // Thin data and no data are DIFFERENT answers and must not be one list. A
  // level three people have tried and failed is a level to watch; a level nobody
  // has opened says something about how far down the ladder anyone gets.
  const tried = c.insufficient.filter((s) => s.attempts > 0);
  const untouched = c.insufficient.filter((s) => s.attempts === 0);
  const attempted = c.standings.filter((s) => s.attempts > 0).length;

  const hardest = c.ranked.length
    ? table(CHALLENGE_COLUMNS, c.ranked.map(challengeRow))
    : empty("No challenge level has enough attempts to rank yet.");

  const thin = tried.length
    ? `<h3>Too thin to rank</h3>
       <p class="sub">
         Attempted, but under 5 goes — one player failing once is a 0% clear rate
         and means nothing. Shown so a level being hard is not confused with a
         level being new.
       </p>
       <div class="scroll">${table(CHALLENGE_COLUMNS, tried.map(challengeRow))}</div>`
    : "";

  // Per chapter, because the ladder is two different things: thirty tour levels
  // that are the same game on thirty boards, and ten twists that change the
  // rules. "Nobody has reached stage 5" and "the twists are brutal" are separate
  // findings and a flat list of forty rows hides both.
  const chapters = new Map<string, api.ChallengeStanding[]>();
  for (const s of c.standings) {
    const m = challengeMeta(s.challengeIdx);
    const key = m.kind === "twist" ? "The Twists" : m.chapter;
    chapters.set(key, [...(chapters.get(key) ?? []), s]);
  }
  const coverage = table(
    ["Chapter", "Levels", "Attempted", "Cleared by someone", "Hardest so far"],
    [...chapters.entries()].map(([title, levels]) => {
      const withData = levels.filter((s) => s.attempts >= 5 && s.clearRate !== null);
      const worst = withData.sort((a, b) => (a.clearRate ?? 1) - (b.clearRate ?? 1))[0];
      return [
        title,
        levels.length,
        levels.filter((s) => s.attempts > 0).length,
        levels.filter((s) => s.playersCleared > 0).length,
        worst ? `${challengeMeta(worst.challengeIdx).code} (${fmtPct(worst.clearRate)})` : "—",
      ];
    }),
    "The ladder is empty.",
  );

  return `
    ${drift}
    <section class="panel">
      <h2>Hardest challenge levels</h2>
      <p class="sub">
        Ordered by clear rate, hardest first. Every level is counted, including
        the ones nobody has opened — on a ${esc(c.levelCount)}-level ladder, "no
        one has got this far" is usually the honest answer and it is not the same
        as 0%.
      </p>
      <div class="stats" style="margin-bottom:12px">
        ${statTile("Levels", fmt(c.levelCount), "the whole ladder")}
        ${statTile("Attempted", fmt(attempted), "at least once")}
        ${statTile("Ranked", fmt(c.ranked.length), "5+ attempts")}
        ${statTile("Never opened", fmt(untouched.length))}
      </div>
      <div class="scroll">${hardest}</div>
      ${thin}
    </section>

    <section class="panel">
      <h2>How far down the ladder anyone gets</h2>
      <p class="sub">
        The tour is one level per playable maze, in maze order; the twists change
        the rules. A stage with nothing attempted is content nobody has reached
        yet rather than content nobody likes.
      </p>
      <div class="scroll">${coverage}</div>
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
          By the enemy's PLACE IN THE PACK, which is what a run records — the five
          hues are fixed, and the skin worn over them is the Content tab.
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
      <p class="sub">
        Maps played per accepted run — the difficulty wall, as a shape. A lap is
        36 maps and the count never resets, so anything past that is a second lap.
      </p>
      ${barChart(
        c.depth.map((row) => ({
          label: `${row.levels_played} ${row.levels_played === 1 ? "map" : "maps"}`,
          value: row.runs,
        })),
        { unit: "runs" },
      )}
    </section>`;
}

function renderContent(d: api.Content): string {
  const block = (
    title: string,
    sub: string,
    rows: api.Share[],
    catalog: readonly CatalogEntry[],
  ): string => {
    const named = nameShares(rows, catalog);
    const played = named.filter((r) => r.runs > 0);
    const idle = named.filter((r) => r.runs === 0);
    // A zero bar is a real answer, so the never-played are named rather than
    // omitted — but they go in a line under the chart instead of as a column of
    // empty tracks, which would push the ones with data off the panel.
    const unused = idle.length
      ? `<p class="sub">Never played: ${idle.map((r) => esc(r.label)).join(", ")}.</p>`
      : "";
    const unknown = named.filter((r) => !r.known);
    const stale = unknown.length
      ? `<p class="sub">Recorded under ${unknown
          .map((r) => `<code>${esc(r.label)}</code>`)
          .join(", ")} — ids this build of the game no longer has. Real runs, kept.</p>`
      : "";

    return `
    <section class="panel">
      <h2>${esc(title)}</h2>
      <p class="sub">${sub}</p>
      ${
        played.length
          ? barChart(
              played.map((r) => ({
                label: r.label,
                value: r.runs,
                note: r.note ? `${fmtPct(r.share)} · ${r.note}` : fmtPct(r.share),
              })),
              { unit: "runs" },
            )
          : empty("Nothing played yet.")
      }
      ${unused}
      ${stale}
    </section>`;
  };

  // The coats are a TABLE, not bars, and that is the dataviz rule rather than a
  // preference: five rows whose most interesting attribute is a sentence is not
  // a magnitude comparison. The perk was in the bar chart's tooltip first, which
  // is the same as not showing it — "which coat" stopped being about colour in
  // IDEA-064, so the power is the column the operator is actually here to read.
  const coats = nameShares(d.beagleSkins, BEAGLE_CATALOG);
  const coatTable = table(
    ["Coat", "Perk", "Runs", "Share", "Players"],
    coats.map((c) => [
      c.label,
      c.note ?? "—",
      c.runs,
      c.runs > 0 ? fmtPct(c.share) : "never played",
      c.players,
    ]),
    "No runs with a coat recorded yet.",
  );

  return `
    <p class="sub" style="margin:0">
      Measured per RUN, from what was worn when each run finished — not from what
      is equipped right now. Runs from before this shipped have no cosmetics
      recorded and count toward the total but appear in no bar, so shares can sum
      to less than 100%.
    </p>
    <section class="panel">
      <h2>Beagle coats</h2>
      <p class="sub">
        Which coat was actually taken in — and since IDEA-064 that is a choice of
        POWER, not of colour, so the perk is the column that matters. Perks apply
        in CLASSIC ONLY, so a coat's share here includes challenge runs where its
        perk did nothing.
      </p>
      <div class="scroll">${coatTable}</div>
    </section>
    <div class="grid2">
      ${block(
        "Enemy skins",
        `Which cast was on screen. All ${ENEMY_CATALOG.length} are accounted for —
         any nobody has equipped are named under the chart rather than left out,
         because "nobody plays the crab" is the answer worth acting on.`,
        d.enemySkins,
        ENEMY_CATALOG,
      )}
      ${block(
        "Maze themes",
        `CLASSIC RUNS ONLY. Every challenge level forces a theme, so a challenge
         run records the theme the player had equipped rather than the one they
         played in — counting those would answer neither question.`,
        d.mazeThemes,
        THEME_CATALOG,
      )}
      ${block(
        "Control schemes",
        "Swipe, D-pad or thumbstick. The cross-tab worth having: whether the thumbstick helped anyone.",
        d.controlSchemes,
        CONTROL_CATALOG,
      )}
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

/** A stored id as a person would say it. Falls back to the raw id rather than a
 *  dash — a run really was played on it, and hiding that makes a renamed skin
 *  look like a player who never equipped anything. */
function labelOf(id: string | null, catalog: readonly CatalogEntry[]): string {
  if (!id) return "—";
  return catalog.find((c) => c.id === id)?.name ?? id;
}

/** The coat's perk, for the Rewind — the interesting half of "favourite coat"
 *  now that a coat is a power (IDEA-064). */
function perkOf(id: string | null): string | undefined {
  if (!id) return undefined;
  return BEAGLE_CATALOG.find((c) => c.id === id)?.note;
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
            ${statTile(
              "Challenges",
              `${fmt(d.challengeProgress)} / ${CHALLENGE_LEVEL_COUNT}`,
              "stones cleared",
            )}
          </div>
          <div class="stats" style="margin-top:12px">
            ${statTile("Nemesis", d.nemesis ? d.nemesis.label : "—", d.nemesis ? `${fmt(d.nemesis.count)} deaths` : "no clear leader")}
            ${statTile("Favourite fruit", d.favouriteFruit ? d.favouriteFruit.label : "—")}
            ${statTile("Favourite theme", labelOf(d.favouriteTheme, THEME_CATALOG))}
            ${statTile(
              "Favourite coat",
              labelOf(d.favouriteBeagleSkin, BEAGLE_CATALOG),
              perkOf(d.favouriteBeagleSkin),
            )}
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

function renderReach(d: api.NotificationsReport): string {
  const r = d.reach;
  const e = d.engagement;

  const offBanner = d.pushEnabled
    ? ""
    : `<div class="banner bad"><strong>Push is switched off.</strong> VAPID keys
        aren't set on the API, so no player can subscribe and no notification can
        be sent. The numbers below will stay at zero until they are — that is
        configuration, not disinterest.</div>`;

  const noteRows = d.notes.map((n) => [
    n.publishedAt,
    n.version ? `${n.kind} ${n.version}` : n.kind,
    n.title,
    `${n.seenBy} / ${n.audience}`,
    n.share === null ? "—" : fmtPct(n.share),
  ]);

  return `
    <section class="panel">
      <h2>Who can be reached</h2>
      <p class="sub">
        Counted in PLAYERS, not devices — one person with a phone and a laptop is
        one person you can tell. Devices are shown separately.
      </p>
      ${offBanner}
      <div class="stats" style="margin-top:12px">
        ${statTile("Subscribed", fmt(r.players_subscribed), `of ${fmt(r.players_total)} players`)}
        ${statTile(
          "Reach",
          r.players_total > 0 ? fmtPct(r.players_subscribed / r.players_total) : "—",
          "opted in on a device",
        )}
        ${statTile("Devices", fmt(r.devices))}
        ${statTile("Want updates", fmt(r.wants_announcements))}
        ${statTile("Want rank alerts", fmt(r.wants_rank))}
        ${statTile("Devices reached", fmt(r.devices_healthy), "had a push accepted")}
        ${statTile("Devices failing", fmt(r.devices_failing), "soft failures")}
      </div>
    </section>

    <section class="panel">
      <h2>Is anyone opening the News screen?</h2>
      <p class="sub">
        This is the honest measure of whether notes are being read — notification
        CLICKS are not tracked anywhere, so nothing here pretends to know them.
      </p>
      <div class="stats">
        ${statTile("Opened it ever", fmt(e.opened_ever))}
        ${statTile("Opened in 7d", fmt(e.opened_7d))}
        ${statTile("Never opened", fmt(e.never_opened))}
      </div>
    </section>

    <section class="panel">
      <h2>Each note</h2>
      <p class="sub">
        "Seen" means a player opened the News screen AFTER this went live, so the
        card was on their screen. It does not mean they read it. The audience is
        players who already existed when it was published — counting everyone
        would make an old note look less read every time someone new signs up.
      </p>
      <div class="scroll">
        ${table(
          ["Published", "Kind", "Title", "Seen by", "Share"],
          noteRows,
          "Nothing published yet.",
        )}
      </div>
    </section>`;
}
