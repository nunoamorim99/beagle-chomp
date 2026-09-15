// IDEA-066 phase 0: how TALL may a prop be, per band, per ring?
//
// board.ts caps a "tall" apron prop to 0.55 on the south row and 1.0 on the
// east/west columns. Those read as camera-safety numbers. They are not -- this
// solves the real grazing ray and the geometric limit is roughly FOUR TIMES
// more generous, so the caps are an AESTHETIC judgement about crowding. That
// distinction has to be written down, or the verge inherits 0.55 and a
// neighbour house ships at a quarter of its size for a reason that does not
// exist out there.
//
// Reads the real camera at every aspect rather than reasoning from BASE_POS --
// IDEA-060 v5's lesson: the portrait fit dollies to y = 49.9 / z = 29.1, not
// 27 / 15.5, and the binding camera is whichever is worst per band.
//
// A prop of height h at (x_p, z_p) hides ground back to where the ray from the
// camera through its TOP meets y = 0:
//     t     = cy / (cy - h)
//     z_hit = cz + t * (z_p - cz)        x_hit = cx + t * (x_p - cx)
// Solve for the h at which that hit first touches the board.
//
//   npm run dev
//   npx tsx scripts/_scratch-surround-sightline.ts
import { chromium } from "playwright";

/** The maze's own outer wall face. Beyond this is apron floor, not play area. */
const PLAY_HALF_X = 10.5 - 1; // outermost wall tile centres at |x| = 9, box to 9.5
const PLAY_HALF_Z = 11.5 - 1; // ... and |z| = 10, box to 10.5
const BOARD_HALF_X = 10.5; // the AABB the camera fit uses
const BOARD_HALF_Z = 11.5;

const VIEWPORTS = [
  { label: "phone tall", width: 390, height: 929 },
  { label: "phone 390x844", width: 390, height: 844 },
  { label: "tablet portrait", width: 768, height: 1024 },
  { label: "square", width: 800, height: 800 },
  { label: "16:9", width: 1920, height: 1080 },
  { label: "ultrawide", width: 2560, height: 1067 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORTS[0], reducedMotion: "reduce" });
await page.goto("http://127.0.0.1:5173/preview-board/?theme=garden&maze=0&view=game&hud=0", {
  waitUntil: "load",
});
await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });

const cams: Array<{ label: string; x: number; y: number; z: number }> = [];
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(220);
  const c = await page.evaluate(() => {
    const w = window as unknown as { __board: { rig: { camera: { position: { toArray(): number[] } } } } };
    return w.__board.rig.camera.position.toArray();
  });
  cams.push({ label: vp.label, x: c[0], y: c[1], z: c[2] });
}
await browser.close();

/** Max h at (x_p, z_p) before its shadow reaches the given board half-extents. */
function maxHeight(
  cam: { x: number; y: number; z: number },
  xp: number,
  zp: number,
  halfX: number,
  halfZ: number,
): number {
  // Binary search on h: monotone (taller hides more), and far clearer than
  // inverting the piecewise "which face does it touch first" algebra.
  const hides = (h: number): boolean => {
    if (h >= cam.y) return true;
    const t = cam.y / (cam.y - h);
    const xh = cam.x + t * (xp - cam.x);
    const zh = cam.z + t * (zp - cam.z);
    // The shadow runs from the prop's foot to (xh, zh). It touches the board if
    // any point of that segment is inside the board rect.
    return segmentHitsRect(xp, zp, xh, zh, halfX, halfZ);
  };
  let lo = 0;
  let hi = cam.y;
  if (!hides(hi - 1e-6)) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (hides(mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** Does the segment (x0,z0)-(x1,z1) intersect the axis-aligned rect? */
function segmentHitsRect(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  halfX: number,
  halfZ: number,
): boolean {
  // Liang-Barsky clip of the segment against the rect.
  const dx = x1 - x0;
  const dz = z1 - z0;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x0 - -halfX) && clip(dx, halfX - x0) && clip(-dz, z0 - -halfZ) && clip(dz, halfZ - z0)
  );
}

// ---------------------------------------------------------------------------
// Bands. worldX(tx) = tx - 9, worldZ(ty) = ty - 10; COLS = 19, ROWS = 21.
const BANDS: Array<{ name: string; ring: (r: number) => { xp: number; zp: number } }> = [
  { name: "south (ty = ROWS+r-1)", ring: (r) => ({ xp: 0, zp: 10 + r }) },
  { name: "north (ty = -r)", ring: (r) => ({ xp: 0, zp: -10 - r }) },
  { name: "east  (tx = COLS+r-1)", ring: (r) => ({ xp: 9 + r, zp: 0 }) },
  { name: "SE corner", ring: (r) => ({ xp: 9 + r, zp: 10 + r }) },
];

console.log("cameras read off the running page:");
for (const c of cams) console.log(`  ${c.label.padEnd(17)} y=${c.y.toFixed(2).padStart(6)}  z=${c.z.toFixed(2).padStart(6)}`);

for (const target of [
  { label: "the MAZE's outer wall face", hx: PLAY_HALF_X, hz: PLAY_HALF_Z },
  { label: "the board AABB (camera-fit corners)", hx: BOARD_HALF_X, hz: BOARD_HALF_Z },
]) {
  console.log(`\n\nmax prop height before its shadow touches ${target.label}`);
  console.log(`  (worst over every aspect; "-" = unreachable at any height)\n`);
  console.log(`  band                    ring 1 (apron)   ring 2 (verge)   ring 3 (verge)`);
  for (const band of BANDS) {
    const cells: string[] = [];
    for (const r of [1, 2, 3]) {
      const { xp, zp } = band.ring(r);
      let worst = Infinity;
      for (const cam of cams) worst = Math.min(worst, maxHeight(cam, xp, zp, target.hx, target.hz));
      // cam.y is the "never occludes" sentinel from maxHeight.
      const unreachable = worst >= Math.min(...cams.map((c) => c.y)) - 1e-3;
      cells.push(unreachable ? "     -    " : worst.toFixed(2).padStart(10));
    }
    console.log(`  ${band.name.padEnd(22)}  ${cells.join("       ")}`);
  }
}

console.log(`\n\nshipped caps, against the geometry:`);
console.log(`  SOUTH_ROW_TALL_SCALE_CAP    = 0.55   (apron, ty = ROWS)`);
console.log(`  EAST_WEST_TALL_SCALE_CAP    = 1.00   (apron, tx = -1 | COLS)`);
console.log(`  treehouse is 2.478 tall at scale 1, garden-tree 1.151, garden-shrub 0.446.`);

console.log(`
WHAT THIS SAYS
  1. ONLY THE SOUTH BAND CAN EVER OCCLUDE THE MAZE. North, east, west and the
     corners are "-" at every ring and every aspect, because their shadow ray
     travels AWAY from the board -- north props shadow further north, east props
     shadow further east. That is not a tuning result, it is the geometry, and
     it means the verge needs no cap anywhere except south.
  2. THE SHIPPED CAPS ARE AESTHETIC, NOT GEOMETRIC. The south apron's real limit
     is 1.28 and it ships at 0.55; the east/west columns cannot occlude the maze
     at any height and ship at 1.00. Both are crowding judgements. Do NOT copy
     0.55 outward -- at verge ring 2 the geometry allows 3.85.
  3. THE BINDING CAMERA IS THE TALL PHONE, NOT THE DESKTOP. It sits higher
     (y 54.3 vs 27.0) but much further back (z 31.7 vs 15.5), so its ray to a
     south prop is the SHALLOWEST relative to the board. Reasoning from
     BASE_POS (27, 15.5) gives 2.70 for the south apron -- more than twice the
     real answer. IDEA-060 v5's lesson, confirmed in the opposite direction from
     the obvious guess.
  4. The "board AABB" table is degenerate at ring 1 by construction: the apron
     tiles sit INSIDE that rect (|z| <= 11.5), so a prop standing there is
     already "touching" it at height 0. The MAZE WALL FACE is the governing
     number; the AABB column is the stricter reading for rings 2-3 only.`);
