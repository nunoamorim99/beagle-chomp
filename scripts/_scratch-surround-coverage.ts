// IDEA-066: is there any SKY GAP between the world's edge and the frame edge?
//
// The board's floor is one PlaneGeometry(COLS + 2, ROWS + 2) -- 21 x 23 units,
// x in [-10.5, 10.5], z in [-11.5, 11.5]. Past its edge there used to be no
// geometry at all, only scene.ts's backdrop dome. So every pixel of "empty sky"
// in a screenshot was the ground RUNNING OUT, and the fix is measured in world
// units of ground, not in sky.
//
// TWO THINGS THIS PROVES, and the second is the acceptance gate:
//   1. NO RAY ESCAPES ABOVE THE HORIZON, at any aspect. The camera pitches
//      59.3 degrees down with a 23 degree half-FOV, so the TOP edge of the
//      frame points 36.3 degrees DOWNWARD. That is why a bigger floor can work
//      at all and a skybox is not needed -- but it is a claim about the fit
//      math, so it is measured rather than asserted.
//   2. EVERY SAMPLED PIXEL LANDS ON REAL GROUND. It RAYCASTS the actual
//      meshes; comparing an unprojected point against a hard-coded rect would
//      only ever re-state the constants back to you.
//
// SWEEP THE ASPECTS, not two framings. `dist` is floored at baseDist so every
// aspect >= 1 shares one camera and differs only in frustum WIDTH, while
// portrait dollies back -- the two see nearly disjoint regions, and an untested
// aspect is one browser window away from showing the world's edge.
//
//   npm run dev
//   npx tsx scripts/_scratch-surround-coverage.ts
import { chromium } from "playwright";

/** The BOARD's own floor, for the "how much of the frame was void" figure. */
const FLOOR_HALF_X = 10.5; // (COLS + 2) / 2
const FLOOR_HALF_Z = 11.5; // (ROWS + 2) / 2

/** Every aspect the game can actually be played at: a tall phone, the 390x844
 *  reference, a short phone, a tablet, square, 4:3, 16:9 and an ultrawide. */
const VIEWPORTS: Array<{ label: string; width: number; height: number }> = [
  { label: "phone tall", width: 390, height: 929 },
  { label: "phone 390x844", width: 390, height: 844 },
  { label: "phone short", width: 430, height: 768 },
  { label: "tablet portrait", width: 768, height: 1024 },
  { label: "square", width: 800, height: 800 },
  { label: "4:3", width: 1024, height: 768 },
  { label: "16:9", width: 1920, height: 1080 },
  { label: "ultrawide", width: 2560, height: 1067 },
];

type Probe = {
  cam: [number, number, number];
  aspect: number;
  hits: Array<{ x: number; z: number }>;
  /** Rays that never meet y = 0 -- i.e. point at or above the horizon. */
  misses: number;
  /** Rays that DO meet y = 0 but land on no ground mesh. This is the void. */
  sky: number;
};

const theme = process.env.THEME ?? "garden";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORTS[0], reducedMotion: "reduce" });
await page.goto(
  `http://127.0.0.1:5173/preview-board/?theme=${theme}&maze=0&view=game&hud=0`,
  { waitUntil: "load", timeout: 90000 },
);
await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });

const rows: Array<{ label: string; p: Probe }> = [];
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  // resize() is wired to the window event; give it a frame to land.
  await page.waitForTimeout(250);

  const p = (await page.evaluate(() => {
    const w = window as unknown as {
      __board: { THREE: typeof import("three"); rig: { camera: import("three").PerspectiveCamera; scene: import("three").Scene } };
    };
    const THREE = w.__board.THREE;
    const cam = w.__board.rig.camera;
    cam.updateMatrixWorld(true);

    // Every flat ground surface in the scene: the board's floor and the
    // surround plane. Named, so a future third one has to opt in rather than
    // be picked up by accident.
    const ground: import("three").Object3D[] = [];
    w.__board.rig.scene.traverse((o) => {
      const m = o as import("three").Mesh;
      if (!m.isMesh || !m.geometry) return;
      if (m.name === "surroundGround" || m.geometry.type === "PlaneGeometry") ground.push(m);
    });

    const hits: Array<{ x: number; z: number }> = [];
    let misses = 0;
    let sky = 0;
    const ray = new THREE.Raycaster();
    const steps = 9; // the 4 corners and the 4 edge midpoints are all in here
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const nx = -1 + (2 * i) / (steps - 1);
        const ny = -1 + (2 * j) / (steps - 1);
        ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
        const first = ray.intersectObjects(ground, false)[0];
        if (first) {
          hits.push({ x: first.point.x, z: first.point.z });
          continue;
        }
        const far = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
        const dir = far.sub(cam.position).normalize();
        if (dir.y >= -1e-6) misses++;
        else sky++;
      }
    }
    return { cam: cam.position.toArray() as [number, number, number], aspect: cam.aspect, hits, misses, sky };
  })) as Probe;

  rows.push({ label: vp.label, p });
}
await browser.close();

// ---------------------------------------------------------------------------
let needMaxX = 0;
let needMinZ = 0;
let needMaxZ = 0;
let totalMisses = 0;
let skyPoints = 0;
let offFloorPoints = 0;
let totalPoints = 0;

console.log(`aspect sweep -- theme "${theme}"\n`);
console.log("  viewport          aspect   camera(y,z)      |x|max    z range          ground hits");
for (const { label, p } of rows) {
  const mx = Math.max(...p.hits.map((h) => Math.abs(h.x)));
  const zmin = Math.min(...p.hits.map((h) => h.z));
  const zmax = Math.max(...p.hits.map((h) => h.z));
  const offFloor = p.hits.filter(
    (h) => Math.abs(h.x) > FLOOR_HALF_X || h.z < -FLOOR_HALF_Z || h.z > FLOOR_HALF_Z,
  ).length;
  const total = p.hits.length + p.sky;

  needMaxX = Math.max(needMaxX, mx);
  needMinZ = Math.min(needMinZ, zmin);
  needMaxZ = Math.max(needMaxZ, zmax);
  totalMisses += p.misses;
  skyPoints += p.sky;
  offFloorPoints += offFloor;
  totalPoints += total;

  console.log(
    `  ${label.padEnd(17)} ${p.aspect.toFixed(3).padStart(6)}   ` +
      `${p.cam[1].toFixed(1).padStart(5)}, ${p.cam[2].toFixed(1).padStart(5)}  ` +
      `${mx.toFixed(1).padStart(7)}   ${zmin.toFixed(1).padStart(6)} .. ${zmax.toFixed(1).padStart(5)}   ` +
      `${String(p.hits.length).padStart(3)}/${total}`,
  );
}

console.log(`\n  rays that never meet y=0 (above the horizon): ${totalMisses}`);
console.log(
  `  points beyond the BOARD's own floor: ${offFloorPoints}/${totalPoints} ` +
    `(${((offFloorPoints / totalPoints) * 100).toFixed(0)}%)  <- this WAS the void`,
);
console.log(
  `  points hitting NO ground at all:     ${skyPoints}/${totalPoints}` +
    (skyPoints === 0 ? "   <- BUDGET MET: zero sky gap" : "   <- SKY GAP: widen SURROUND_PARAMS"),
);

console.log(`\nground actually reached (union over every aspect):`);
console.log(`  |x| up to ${needMaxX.toFixed(2)}      (board floor: ${FLOOR_HALF_X})`);
console.log(`  z from ${needMinZ.toFixed(2)} to ${needMaxZ.toFixed(2)}   (board floor: -${FLOOR_HALF_Z} .. ${FLOOR_HALF_Z})`);

if (skyPoints > 0) process.exitCode = 1;
