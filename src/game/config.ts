// Central tunables. Keep gameplay numbers here so they're easy to balance.
export const SPEEDS = {
  beagle: 5.2,
  ghost: 4.6,
  frightened: 3.0,
  eaten: 9.0,
} as const;

export const SCORE = {
  biscuit: 10,
  bone: 50,
  fruit: 100,
  ghostBase: 200,   // doubles per ghost eaten within one fright window
} as const;

export const TIMING = {
  frightSeconds: 7,
  readySeconds: 1.6,
  deathSeconds: 1.3,
  // global scatter/chase schedule (seconds); last entry is "chase forever"
  schedule: [7, 20, 7, 20, 5, 1e9],
} as const;

export const START_LIVES = 3;

// Palette (hex) — shared by renderer and UI
// Bright daytime garden (IDEA-008): soft sky, hedge-green walls, warm soil
// floor. Everything else in render/* reads these values, so a future theme
// system (IDEA-012) can swap the palette without touching this shape.
export const COLORS = {
  bg: 0x9ecbe8,
  wall: 0x3f8f3a,
  wallEmissive: 0x0e2a0e,
  floor: 0x6b4a2f,
  beagleTan: 0xc98a3c,
  beagleWhite: 0xf4efe6,
  beagleBlack: 0x2a2320,
  biscuit: 0xf0cf8e,
  ghostRose: 0xe0577a,
  ghostTeal: 0x53c7c0,
  ghostAmber: 0xe8a23d,
  frightened: 0x2537c8,
} as const;
