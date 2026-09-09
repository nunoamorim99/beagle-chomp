// OWNER: pwa-mobile-engineer (IDEA-052b)
//
// Generates the images a push notification uses. Run `npm run make:icons` and
// commit the PNGs; they are build-time assets, not runtime drawing.
//
// TWO KINDS OF IMAGE, AND THEY ARE NOT INTERCHANGEABLE:
//
//   badge-96.png — the small mark Android puts in the STATUS BAR beside the
//     clock. Android uses ONLY ITS ALPHA CHANNEL and paints the result white,
//     so it must be a TRANSPARENT image with the shape in opaque pixels. A
//     normal app icon, opaque edge to edge, renders as a solid white
//     rectangle — which is exactly what shipped in the first cut of push and
//     what it looked like on a real phone. Guarded by `npm run test:badge`.
//
//   notify-*.png — the LARGE image in the notification shade. Full colour, and
//     one per KIND, so a release note, a notice and "someone beat your score"
//     are distinguishable before a word is read.
//
// Everything is drawn from the game's own Material Symbols subset and the
// design tokens, rather than hand-drawn: the notification shade then carries
// the same marks and colours as the game, and re-cutting the font keeps them in
// step automatically.

import { chromium, type Browser } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT = join(ROOT, "src/ui/fonts/material-symbols-rounded-subset.woff2");
const ICONS = join(ROOT, "public/icons");

const b64 = readFileSync(FONT).toString("base64");

/** Straight from src/ui/tokens.css. */
const T = {
  amber: "#E8A23D",
  amberInk: "#3A2205",
  wood: "#4A3928",
  rose: "#E0577A",
  outline: "#1B1512",
  cream: "#FFF7E8",
};

const FACE = `@font-face{font-family:'MS';font-style:normal;font-weight:400 700;
  font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;

interface Job {
  file: string;
  glyph: string;
  size: number;
  /** Transparent silhouette (the status-bar badge) vs a full-colour plate. */
  mode: "silhouette" | "plate";
  bg?: string;
  fg?: string;
  note: string;
}

const JOBS: Job[] = [
  {
    file: "badge-96.png",
    glyph: "pets",
    size: 96,
    mode: "silhouette",
    note: "status bar — alpha only, so it MUST be transparent",
  },
  {
    file: "notify-release.png",
    glyph: "campaign",
    size: 192,
    mode: "plate",
    bg: T.amber,
    fg: T.amberInk,
    note: "a release note — amber, the accent that marks the thing worth reading",
  },
  {
    file: "notify-notice.png",
    glyph: "notifications",
    size: 192,
    mode: "plate",
    bg: T.wood,
    fg: T.cream,
    note: "a plain notice — quieter than a release",
  },
  {
    file: "notify-rank.png",
    glyph: "leaderboard",
    size: 192,
    mode: "plate",
    bg: T.rose,
    fg: T.cream,
    note: "someone beat your score — rose, because it is the one that stings",
  },
];

function pageHtml(job: Job): string {
  if (job.mode === "silhouette") {
    return `<!doctype html><meta charset="utf-8"><style>${FACE}
      html,body{margin:0;background:transparent}
      #o{width:${job.size}px;height:${job.size}px;display:flex;align-items:center;
        justify-content:center;font-family:'MS';font-feature-settings:'liga';
        color:#fff;font-size:${Math.round(job.size * 0.78)}px;line-height:1}
    </style><body><div id="o">${job.glyph}</div></body>`;
  }
  // A plate in the game's language: filled square, thick ink outline, generous
  // corner radius — the same shape .bc-plate draws for a game object.
  const r = Math.round(job.size * 0.22);
  const border = Math.max(4, Math.round(job.size * 0.045));
  return `<!doctype html><meta charset="utf-8"><style>${FACE}
    html,body{margin:0;background:transparent}
    #o{width:${job.size}px;height:${job.size}px;box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;
      background:${job.bg};color:${job.fg};
      border:${border}px solid ${T.outline};border-radius:${r}px;
      font-family:'MS';font-feature-settings:'liga';
      font-size:${Math.round(job.size * 0.52)}px;line-height:1}
  </style><body><div id="o">${job.glyph}</div></body>`;
}

async function render(browser: Browser, job: Job): Promise<void> {
  const page = await browser.newPage({ viewport: { width: job.size, height: job.size } });
  await page.setContent(pageHtml(job));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);

  // A ligature missing from the subset renders as its own WORD, which would
  // silently produce an icon reading "campaign". Width is the tell.
  const w = await page.locator("#o").evaluate((el) => (el as HTMLElement).scrollWidth);
  if (w > job.size * 1.2) {
    throw new Error(
      `"${job.glyph}" is not in the font subset — it rendered as text (${w}px). ` +
        `Add it to ICON in src/ui/icons.ts and re-cut (recipe in src/ui/tokens.css).`,
    );
  }

  // omitBackground is what gives the badge its transparency. Harmless on a
  // plate, whose own background is opaque.
  const png = await page.locator("#o").screenshot({ omitBackground: true });
  writeFileSync(join(ICONS, job.file), png);
  await page.close();
  console.log(`  ${job.file.padEnd(22)} ${String(job.size).padStart(3)}px  ${job.glyph.padEnd(14)} ${job.note}`);
}

const browser = await chromium.launch();
console.log("Notification images\n");
for (const job of JOBS) await render(browser, job);
await browser.close();
console.log("\nVerify the badge really is a silhouette: npm run test:badge");
