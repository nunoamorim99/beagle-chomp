// Scratch: canned API payloads for the admin-portal layout harness.
//
// Shaped to be the WORST realistic case for layout rather than the prettiest:
// a full 30-day window, the whole 40-level ladder, every cosmetic in the
// catalogue and the longest route names the API actually emits. A dashboard
// that survives this survives a real one.

const day = (i: number): string => {
  const d = new Date(Date.UTC(2026, 7, 19));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};

export const overview = {
  totals: {
    players_today: 12,
    players_7d: 148,
    players_30d: 412,
    total_players: 1207,
    signups_7d: 63,
    runs_7d: 1834,
    play_hours_7d: 127,
  },
  activity: Array.from({ length: 30 }, (_, i) => ({
    day: day(i),
    players: 6 + ((i * 7) % 23),
    runs: 18 + ((i * 13) % 61),
    playSeconds: 600 + ((i * 917) % 5400),
  })),
};

export const retention = {
  matrix: Array.from({ length: 14 }, (_, r) => ({
    cohortDay: day(16 + r),
    cohortSize: 4 + ((r * 5) % 31),
    cells: [0, 1, 3, 7, 14, 30].reduce<Record<number, unknown>>((acc, o) => {
      const reached = o <= 30 - r;
      acc[o] = {
        dayOffset: o,
        returned: reached ? Math.max(0, 9 - o / 3 - r / 4) | 0 : 0,
        rate: reached ? Math.max(0, 0.95 - o * 0.028 - r * 0.02) : 0,
        reached,
      };
      return acc;
    }, {}),
  })),
  headline: { "1": 0.42, "7": 0.19, "30": 0.08 },
};

export const challenges = {
  standings: Array.from({ length: 40 }, (_, i) => ({
    challengeIdx: i,
    attempts: Math.max(0, 140 - i * 4),
    clears: Math.max(0, 90 - i * 3),
    clearRate: i > 34 ? null : Math.max(0.02, 0.9 - i * 0.022),
    playersAttempted: Math.max(0, 40 - i),
    playersCleared: Math.max(0, 30 - i),
    attemptsPerClear: i > 34 ? null : 1 + i * 0.11,
    medianClearSeconds: i > 34 ? null : 60 + i * 7,
    avgDeaths: i > 34 ? null : 0.4 + i * 0.09,
  })),
  get ranked() {
    return this.standings.filter((s) => s.attempts >= 5);
  },
  get insufficient() {
    return this.standings.filter((s) => s.attempts > 0 && s.attempts < 5);
  },
  levelCount: 40,
  depth: Array.from({ length: 18 }, (_, i) => ({ levels_played: i + 1, runs: 300 - i * 15 })),
};

export const gameplay = {
  enemies: [
    { slot: 0, label: "First", count: 412, share: 0.34 },
    { slot: 1, label: "Second", count: 301, share: 0.25 },
    { slot: 2, label: "Third", count: 244, share: 0.2 },
    { slot: 3, label: "Fourth", count: 151, share: 0.13 },
    { slot: 4, label: "Fifth", count: 98, share: 0.08 },
  ],
  fruits: [
    { slot: 0, label: "Apple", count: 902, share: 0.41 },
    { slot: 1, label: "Banana", count: 611, share: 0.28 },
    { slot: 2, label: "Carrot", count: 380, share: 0.17 },
    { slot: 3, label: "Strawberry", count: 208, share: 0.09 },
    { slot: 4, label: "Mango", count: 103, share: 0.05 },
  ],
  get nemesis() {
    return this.enemies[0];
  },
  get favouriteFruit() {
    return this.fruits[0];
  },
};

const shares = (ids: string[]) =>
  ids.map((value, i) => ({
    value,
    runs: 400 - i * 37,
    players: 90 - i * 7,
    share: Math.max(0.01, 0.33 - i * 0.05),
  }));

export const content = {
  beagleSkins: shares(["bagel", "cookie", "muffin", "pepper", "pac-beagle"]),
  enemySkins: shares(["flea", "beetle", "bee", "ladybug", "crab", "mosquito", "maki"]),
  mazeThemes: shares(["garden", "forest", "park", "beach", "city"]),
  controlSchemes: shares(["swipe", "dpad", "stick"]),
};

export const health = {
  version: "8.0.1",
  uptimeSeconds: 384_213,
  requests: {
    lifetimeRequests: 1_284_003,
    lifetimeSlowRequests: 212,
    routes: [
      "/api/v1/admin/players/:username/rewind",
      "/api/v1/announcements/:id/seen",
      "/api/v1/scores/submit",
      "/api/v1/auth/login",
      "/api/v1/profile",
      "/api/v1/leaderboard",
      "/api/v1/push/subscribe",
      "/api/v1/admin/challenges",
    ].map((route, i) => ({
      route,
      count: 12_000 - i * 900,
      p50: 4 + i,
      p95: 22 + i * 9,
      maxMs: 180 + i * 61,
      status2xx: 11_000 - i * 800,
      status4xx: 40 + i * 3,
      status5xx: i,
    })),
  },
  rejections: {
    reasons: [
      { reason_code: "SCORE_ITEM_MISMATCH", count: 41, players: 9, last_seen: "2026-09-16T10:02:00Z" },
      { reason_code: "LIVES_IMPOSSIBLE", count: 12, players: 4, last_seen: "2026-09-15T18:41:00Z" },
      { reason_code: "DURATION_IMPLAUSIBLE", count: 7, players: 3, last_seen: "2026-09-14T09:12:00Z" },
    ],
    byDay: [],
    totalAccepted: 8123,
    totalRejected: 60,
    rejectionRate: 0.0073,
    alarming: false,
  },
};

export const players = {
  players: Array.from({ length: 22 }, (_, i) => ({
    username: `player_with_a_long_name_${i}`.slice(0, 20),
    created_at: `2026-0${1 + (i % 8)}-1${i % 9}T00:00:00Z`,
    high_score: 24_000 - i * 730,
    runs: 140 - i * 5,
    last_played: i % 5 === 0 ? null : `2026-09-1${i % 7}T00:00:00Z`,
  })),
};

export const rewind = {
  username: "ChorizoBoss",
  since: "2026-01-01",
  joined: "2026-02-14",
  highScore: 24_310,
  coins: 812,
  challengeProgress: 17,
  runs: 142,
  daysPlayed: 38,
  playSeconds: 41_300,
  longestRunSeconds: 1_842,
  pelletsEaten: 38_112,
  fruitEaten: 402,
  coinsCollected: 1_204,
  ghostsEaten: 611,
  livesLost: 388,
  levelsCleared: 219,
  enemies: gameplay.enemies,
  fruits: gameplay.fruits,
  nemesis: gameplay.enemies[0],
  favouriteFruit: gameplay.fruits[0],
  favouriteTheme: "garden",
  favouriteBeagleSkin: "muffin",
};

export const notifications = {
  pushEnabled: true,
  reach: {
    players_total: 1207,
    players_subscribed: 318,
    devices: 402,
    wants_announcements: 301,
    wants_rank: 288,
    devices_healthy: 371,
    devices_failing: 31,
  },
  engagement: { opened_ever: 622, opened_7d: 141, never_opened: 585 },
  notes: Array.from({ length: 9 }, (_, i) => ({
    id: `n${i}`,
    kind: i % 2 ? "release" : "notice",
    version: i % 2 ? `v${8 - i * 0.1}` : null,
    title: `A note whose title runs on a good deal longer than you would like #${i}`,
    publishedAt: day(20 - i),
    seenBy: 200 - i * 17,
    audience: 900 - i * 20,
    share: (200 - i * 17) / (900 - i * 20),
  })),
};

export const announcements = {
  items: Array.from({ length: 6 }, (_, i) => ({
    id: `a${i}`,
    kind: i % 2 ? "release" : "notice",
    version: i % 2 ? `v${8 - i}.0` : null,
    title: `Announcement number ${i} with a title long enough to push the table wide`,
    body: "Line one.\n\nLine two.",
    publishedAt: i % 3 === 0 ? null : day(20 - i),
    isDraft: i % 3 === 0,
    createdAt: day(10),
    updatedAt: day(11),
  })),
};
