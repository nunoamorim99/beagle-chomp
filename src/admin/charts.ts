// OWNER: backend / tooling (IDEA-051)
//
// Hand-rolled SVG chart primitives. No chart library — STACK.md §0 says don't
// add moving parts, and the shapes here are a few dozen lines of geometry each.
//
// THE PALETTE WAS VALIDATED, NOT CHOSEN BY EYE. The five enemy hues are the
// game's own colours stepped down for this dark surface (#2F2318), because on
// the enemy chart COLOUR IS THE ENTITY — the "rose one" must be rose, or the
// chart stops being about the thing the player saw. Checked with the dataviz
// validator: lightness inside the dark band, chroma above the floor, contrast
// over 3:1, and normal-vision separation 21.4.
//
// The rose/teal pair sits at ΔE 6.3 for deuteranopia, in the 6-8 floor band
// that is permissible ONLY with secondary encoding. So every enemy bar carries
// a DIRECT NAME LABEL — identity is never colour-alone here. Do not remove
// those labels to save space; they are what makes this palette legal.
//
// Everything else is single-series and needs no categorical palette at all:
// magnitude is one amber ramp, the activity line is one stroke, and status
// (the rejection alarm) uses reserved status colours that are never reused as
// a series.

/** The five enemy hues, in ENEMY_SLOTS order, tuned for the dark surface. */
export const ENEMY_HUES = ["#DD5075", "#00A79D", "#C47E1C", "#9764D4", "#529B33"] as const;

/** One-hue sequential ramp for magnitude (the cohort grid). Monotonically
 *  lighter — never a rainbow, never a hue at a midpoint. */
export const AMBER_RAMP = ["#3A2A18", "#5E421C", "#8A6220", "#B5821F", "#E8A23D"] as const;

export const INK = "#FFF7E8";
export const MUTED = "#A99883";
export const GRID = "#4A3928";
export const ACCENT = "#E8A23D";
export const GOOD = "#6FB84A";
export const CRITICAL = "#E0577A";

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

/** Compact number: 12 345 → 12.3k. Charts are read at a glance; the exact
 *  figure belongs in the tooltip and the table view. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n * 100) / 100);
}

export function fmtPct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`;
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** An empty state, which is the state this dashboard actually launches in.
 *  Says WHY there is nothing rather than drawing an axis around a void. */
export function empty(message: string): string {
  return `<p class="empty">${esc(message)}</p>`;
}

// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  /** Optional per-bar colour. Only the enemy chart uses this — everything else
   *  is single-series and takes the one accent. */
  color?: string;
  /** Shown in the tooltip beside the value. */
  note?: string;
}

/**
 * Horizontal bars. Chosen over vertical for every categorical breakdown here
 * because the labels are words ("Strawberry", "beagle-thumbstick") and vertical
 * bars would either clip them or turn them 90°, which nobody reads.
 *
 * Bars are direct-labelled with their value at the end — selectively, not a
 * number on every tick. A 4px rounded data-end anchors to the baseline.
 */
export function barChart(data: readonly BarDatum[], opts: { unit?: string } = {}): string {
  if (data.length === 0) return empty("Nothing recorded yet.");

  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = 30;
  const gap = 2; // the 2px surface gap between adjacent fills
  const labelW = 104;
  const valueW = 62;
  const w = 560;
  const h = data.length * (rowH + gap);
  const trackW = w - labelW - valueW;

  const rows = data
    .map((d, i) => {
      const y = i * (rowH + gap);
      const barW = Math.max((d.value / max) * trackW, d.value > 0 ? 3 : 0);
      const fill = d.color ?? ACCENT;
      const title = `${d.label}: ${fmt(d.value)}${opts.unit ? ` ${opts.unit}` : ""}${
        d.note ? ` · ${d.note}` : ""
      }`;
      return `
      <g class="bar-row">
        <title>${esc(title)}</title>
        <text x="0" y="${y + rowH / 2}" class="bar-label" dominant-baseline="middle">${esc(d.label)}</text>
        <rect x="${labelW}" y="${y + 5}" width="${trackW}" height="${rowH - 10}" rx="4" class="bar-track"/>
        ${
          barW > 0
            ? `<rect x="${labelW}" y="${y + 5}" width="${barW}" height="${rowH - 10}" rx="4" fill="${fill}"/>`
            : ""
        }
        <text x="${w - valueW + 8}" y="${y + rowH / 2}" class="bar-value" dominant-baseline="middle">${esc(
          fmt(d.value),
        )}</text>
      </g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" preserveAspectRatio="xMinYMin meet">${rows}</svg>`;
}

/**
 * A single-series line over time.
 *
 * One series, one stroke, no legend — the panel title names it. 2px stroke,
 * markers only when the series is short enough that they don't merge into a
 * caterpillar.
 */
export function lineChart(
  points: readonly { day: string; value: number }[],
  opts: { color?: string } = {},
): string {
  if (points.length === 0) return empty("No activity in this window.");
  if (points.length === 1) {
    return `<p class="single-point">${esc(points[0].day)}: <strong>${esc(
      fmt(points[0].value),
    )}</strong> <span class="muted">(one day of data — not enough for a trend)</span></p>`;
  }

  const w = 560;
  const h = 180;
  const padL = 34;
  const padB = 22;
  const padT = 10;
  const max = Math.max(...points.map((p) => p.value), 1);
  const plotW = w - padL - 8;
  const plotH = h - padB - padT;

  const x = (i: number): number => padL + (i / (points.length - 1)) * plotW;
  const y = (v: number): number => padT + plotH - (v / max) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${padT + plotH} L${padL},${padT + plotH} Z`;

  // Three gridlines, recessive. More would compete with the data.
  const ticks = [0, 0.5, 1].map((f) => {
    const gy = padT + plotH - f * plotH;
    return `<line x1="${padL}" y1="${gy}" x2="${w - 8}" y2="${gy}" class="grid"/>
            <text x="${padL - 6}" y="${gy}" class="axis" text-anchor="end" dominant-baseline="middle">${esc(
              fmt(max * f),
            )}</text>`;
  });

  const markers =
    points.length <= 30
      ? points
          .map(
            (p, i) =>
              `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" class="dot">
                 <title>${esc(`${p.day}: ${fmt(p.value)}`)}</title>
               </circle>`,
          )
          .join("")
      : "";

  const first = points[0].day;
  const last = points[points.length - 1].day;

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" preserveAspectRatio="xMinYMin meet">
    ${ticks.join("")}
    <path d="${area}" class="area"/>
    <path d="${path}" fill="none" stroke="${opts.color ?? ACCENT}" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round"/>
    ${markers}
    <text x="${padL}" y="${h - 5}" class="axis">${esc(first)}</text>
    <text x="${w - 8}" y="${h - 5}" class="axis" text-anchor="end">${esc(last)}</text>
  </svg>`;
}

/**
 * The retention cohort grid.
 *
 * A SEQUENTIAL encoding — one hue, dark to light — because the value is
 * magnitude, not identity. An empty cell is drawn as the ramp's floor and NOT
 * left blank: zero returners is the most important reading on the chart, and a
 * hole would render as "no data" exactly where the answer is "nobody".
 */
export function cohortGrid(
  matrix: readonly { cohortDay: string; cohortSize: number; cells: readonly CohortLike[] }[],
  offsets: readonly number[] = [0, 1, 3, 7, 14, 30],
): string {
  if (matrix.length === 0) return empty("No signups in this window yet.");

  const cellW = 58;
  const cellH = 26;
  const labelW = 96;
  const headH = 20;

  const head = offsets
    .map(
      (o, i) =>
        `<text x="${labelW + i * cellW + cellW / 2}" y="${headH - 6}" class="axis" text-anchor="middle">D${o}</text>`,
    )
    .join("");

  const rows = matrix
    .map((cohort, r) => {
      const y = headH + r * cellH;
      const cells = offsets
        .map((o, i) => {
          const cell = cohort.cells[o];
          const x = labelW + i * cellW;
          // `reached: false` means the cohort is younger than this offset. It
          // must be drawn as a void, never as 0% — see aggregate.ts.
          if (!cell || !cell.reached) {
            // The cohort is younger than this offset — it has not FAILED D7, it
            // has not had one. Drawn as a hatch, never as 0%.
            return `<rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="3" class="cell-void"><title>${esc(
              `${cohort.cohortDay} · D${o}: not reached yet`,
            )}</title></rect>`;
          }
          const step = Math.min(AMBER_RAMP.length - 1, Math.floor(cell.rate * AMBER_RAMP.length));
          const fill = cell.rate === 0 ? AMBER_RAMP[0] : AMBER_RAMP[step];
          // Ink flips to dark on the brightest steps so the number stays legible.
          const dark = step >= 3 && cell.rate > 0;
          return `<g><title>${esc(
            `${cohort.cohortDay} · D${o}: ${cell.returned} of ${cohort.cohortSize} (${fmtPct(cell.rate)})`,
          )}</title>
            <rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="3" fill="${fill}"/>
            <text x="${x + cellW / 2}" y="${y + cellH / 2}" text-anchor="middle" dominant-baseline="middle"
                  class="cell-text ${dark ? "on-bright" : ""}">${esc(fmtPct(cell.rate))}</text>
          </g>`;
        })
        .join("");
      return `<g>
        <text x="0" y="${y + cellH / 2}" class="bar-label" dominant-baseline="middle">${esc(
          cohort.cohortDay,
        )} <tspan class="muted">(${cohort.cohortSize})</tspan></text>
        ${cells}
      </g>`;
    })
    .join("");

  const w = labelW + offsets.length * cellW;
  const h = headH + matrix.length * cellH;
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" preserveAspectRatio="xMinYMin meet">${head}${rows}</svg>`;
}

interface CohortLike {
  dayOffset: number;
  returned: number;
  rate: number;
  reached: boolean;
}

/** A KPI tile. Not a chart — a single number's job is to be read, and wrapping
 *  it in axes would only slow that down. */
export function statTile(label: string, value: string, note?: string): string {
  return `<div class="stat">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(value)}</div>
    ${note ? `<div class="stat-note">${esc(note)}</div>` : ""}
  </div>`;
}

/** A plain table — the accessible view every chart on this page also has, and
 *  the right form outright for the p95 latency data (many columns, exact
 *  numbers, no shape worth drawing). */
export function table(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  emptyMessage = "Nothing to show.",
): string {
  if (rows.length === 0) return empty(emptyMessage);
  return `<table class="data">
    <thead><tr>${headers.map((th) => `<th>${esc(th)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr>${r.map((td) => `<td>${esc(td)}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table>`;
}
