// IDEA-072: guards the ambience the menu and the shop stages now stand in.
//
// Headless and pure: it builds the real band geometry in Node and reads two
// sources as text, so it runs in the plain `npm run test` chain. It never
// touches the ground TEXTURE, which needs a canvas — the browser sheet
// (`_scratch-showcase-sheet.ts`) is where that is looked at.
//
// FIVE THINGS IT EXISTS FOR, and four of them are defects this feature
// actually shipped into a render before anyone could see them.
//
//  1. THE SUBJECT MUST BE AT ZERO FOG. It is the constraint that binds every
//     other number here: the player is deciding whether to spend 25 coins on a
//     coat, and a hazy dog is the one outcome that makes the screen worse than
//     the blue void it replaced. Asserted on every theme, at every stage.
//  2. THE FOG MUST CLEAR THE BAND. The first build derived the far plane from
//     the band's outer radius but measured it from the STAGE CENTRE, while the
//     shop's diorama camera sits 10.6 units out — so its whole band fell past
//     the end of the curve and rendered as nothing at all. Built, merged,
//     added to the scene, invisible.
//  3. AND FOG REACH IS NOT BAND EXTENT. Collapsing the two meant a stage with
//     no band got a far plane at the camera's own distance, and the theme
//     diorama came back as an empty blue screen with the model fogged out from
//     eight units away.
//  4. `scale: 0` AND `"none"` BOTH MEAN NOTHING IS BUILT. The first is the
//     diorama's contract, the second is Arcade Night's — IDEA-066 bought that
//     void deliberately and a menu that fills it is a regression in a thing
//     somebody paid 50 coins for.
//  5. THE BAND IS ONE MESH PER MATERIAL. It is a few hundred objects rendered
//     behind a fully animated character on a menu that never stops drawing, so
//     a per-object draw call is not affordable.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { makeSurroundMaterials } from "../src/render/surroundProps";
import {
  SHOWCASE_BAND,
  SHOWCASE_BEHIND_WEDGE,
  SHOWCASE_FOG_REACH,
  SHOWCASE_FRONTED,
  buildShowcaseBand,
  faceCameraYaw,
  horizonSkyColor,
  showcaseFog,
} from "../src/render/showcaseSurround";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n${t}`);
}

/** The three real rigs, read off their own modules' constants. */
const STAGES = [
  { id: "menu", camDist: 3.2, bandScale: 1, fogReach: SHOWCASE_FOG_REACH, subject: 3.2 },
  { id: "shop character", camDist: 3.6, bandScale: 1, fogReach: SHOWCASE_FOG_REACH, subject: 3.6 },
  // The diorama is a ~4.4-unit slab, so its nearest corner is well inside its
  // 10.6-unit camera distance — 8 is the honest worst case to hold to zero.
  { id: "shop diorama", camDist: 10.6, bandScale: 0, fogReach: 26, subject: 8 },
];

// ---------------------------------------------------------------------------
section("The subject is never fogged, and the fog always clears the band");

for (const t of MAZE_THEMES) {
  for (const st of STAGES) {
    const f = showcaseFog(t.palette, st.fogReach, st.camDist);
    ok(
      `"${t.id}" @ ${st.id}: the subject sits in front of the fog`,
      st.subject <= f.near,
      `subject at ${st.subject}, fog starts ${f.near.toFixed(1)}`,
    );
    if (st.bandScale > 0 && t.palette.surround !== "none") {
      // The far side of the outer ring is what has to finish dissolving; it is
      // `camDist + outer`, NOT `outer`, and that distinction is defect #2.
      const bandFar = st.camDist + SHOWCASE_BAND.outer * st.bandScale;
      ok(
        `…and the far ring dissolves inside the fog`,
        bandFar <= f.far,
        `band far ${bandFar.toFixed(1)}, fog ends ${f.far.toFixed(1)}`,
      );
      const bandNear = st.camDist + SHOWCASE_BAND.inner * st.bandScale;
      // VISIBLE, which means inside the far plane — and deliberately NOT "past
      // the near plane too". IDEA-072 v2 brought the band in from 34 to 26 and
      // Night City's short fog (28/54, a ratio of 1.93) then starts 0.8 units
      // BEHIND its near ring, so that ring renders unfogged. That is not a
      // defect: a 3-5 unit tower at 29 units is small whether it is hazed or
      // not, and the themes that pull their fog in are the ones whose near
      // content is supposed to stay crisp. What would be a defect is a ring
      // past the far plane, which is the shape of the bug that made the shop
      // diorama's whole band invisible.
      ok(
        `…while the near ring is inside the fog's reach`,
        bandNear < f.far,
        `band near ${bandNear.toFixed(1)} against a far plane of ${f.far.toFixed(1)}`,
      );
    }
  }
}

{
  // Fog reach is NOT band extent — defect #3, asserted directly.
  const g = MAZE_THEMES[0].palette;
  const noBand = showcaseFog(g, 26, 10.6);
  ok(
    "a stage with NO band still gets a far plane past its own camera",
    noBand.far > 10.6 * 1.5,
    `${noBand.far.toFixed(1)}`,
  );
}

// ---------------------------------------------------------------------------
section("What each theme builds");

for (const t of MAZE_THEMES) {
  const mats = makeSurroundMaterials(t.palette);
  const band = buildShowcaseBand(t.palette.surround, mats, 1, 1);
  const meshes: THREE.Mesh[] = [];
  band.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });

  if (t.palette.surround === "none") {
    ok(`"${t.id}" is propless by contract, and stays propless`, meshes.length === 0);
  } else {
    ok(`"${t.id}" builds a band at all`, meshes.length > 0, `${meshes.length} meshes`);
    // One mesh per distinct material — defect #5, and the ceiling is the
    // BOARD SURROUND'S OWN 18 rather than a tighter guess. The garden's band
    // legitimately lands on 15 (hedge lit/dark, foliage lit/dark, trunk, two
    // wall tones, roof, roof trim, two glasses, three blooms, stone), because
    // it is the one recipe that builds houses as well as planting; the forest
    // and the park are 5 and the beach 4. A first pass at 14 failed the
    // garden, which is a budget too tight to hold the shipped configuration —
    // the same mistake `fenceReadability`'s 1.95px floor exists to avoid.
    ok(
      `…merged to one mesh per material (${meshes.length})`,
      meshes.length <= 18,
      `${meshes.length} meshes — did mergeBySignature run?`,
    );
    ok(`…and it is genuinely dense`, (band.userData.itemCount as number) > 60, `${band.userData.itemCount} items`);
  }

  // NOTHING IS ENTIRELY BURIED — and that is the assertion, not "nothing dips
  // below zero". The first version tested the lowest vertex and failed the
  // BEACH on a correct model: `distantDune` is a blob centred at y = 0 and
  // flattened to 0.12, so half of it is under the sand ON PURPOSE, which is
  // how a dune is shaped and is invisible through opaque ground. Suspect the
  // instrument first (CLAUDE.md's own standing note about this family). What
  // would be a real defect is a prop whose TOP is below the ground, which is
  // this project's most-repeated bug in a new place.
  let lowest = Infinity;
  let highest = -Infinity;
  const v = new THREE.Vector3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y < lowest) lowest = v.y;
      if (v.y > highest) highest = v.y;
    }
  }
  if (meshes.length > 0) {
    ok(`…and shows above the ground`, highest > 0.1, `highest vertex ${highest.toFixed(3)}`);
    ok(
      `…without anything sunk absurdly deep`,
      lowest > -1.5,
      `lowest vertex ${lowest.toFixed(3)} (a dune is half-buried by design; a tree is not)`,
    );
  }

  // The behind-camera wedge really is empty. Every rig looks from +Z, so a
  // prop sitting there is pure cost.
  let inWedge = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.hypot(v.x, v.z) < 5) continue;
      const a = Math.atan2(v.x, v.z); // 0 = straight toward +Z, i.e. the camera
      if (Math.abs(a) < SHOWCASE_BEHIND_WEDGE / 2 - 0.25) inWedge++;
    }
  }
  ok(`…and nothing is built behind the camera`, inWedge === 0, `${inWedge} vertices in the wedge`);

  band.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}

// ---------------------------------------------------------------------------
section("A stage with no band builds nothing, whatever the theme says");

for (const t of MAZE_THEMES) {
  const mats = makeSurroundMaterials(t.palette);
  const band = buildShowcaseBand(t.palette.surround, mats, 1, 0);
  let n = 0;
  band.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  ok(`"${t.id}" at scale 0 builds nothing`, n === 0, `${n} meshes`);
}

// ---------------------------------------------------------------------------
section("The fog colour matches the sky the dome actually DISPLAYS");

{
  // Those backdrop shaders write gl_FragColor with no colour-space conversion,
  // so the sky is its LINEAR triple shown raw — measured, palette.bg 0x9ecbe8
  // renders as (87, 152, 206). The fog is converted properly, so handing it the
  // palette hex lands ~40% too light and paints a pale band across the horizon.
  const garden = MAZE_THEMES.find((t) => t.id === "garden")!;
  const bottomOnly = horizonSkyColor(garden.palette.bg, garden.palette.bg, -6);
  const asLinear = new THREE.Color(garden.palette.bg);
  const r = Math.round(bottomOnly.r * 255);
  const g = Math.round(bottomOnly.g * 255);
  const b = Math.round(bottomOnly.b * 255);
  ok(
    "the fog colour is the dome's LINEAR triple, not its hex",
    Math.abs(bottomOnly.r - asLinear.r) > 0.05,
    `fog ${r},${g},${b} vs palette-as-linear ${asLinear.r.toFixed(3)}`,
  );
  // And it must sit between the two gradient stops rather than outside them.
  const top = horizonSkyColor(garden.palette.bg, garden.palette.backdropTop, 40);
  ok("…and eye height moves it toward the dome's top colour", top.r > bottomOnly.r);
}

// ---------------------------------------------------------------------------
section("A landmark with a front turns it toward the viewer");

{
  // Nuno: *"rotate the treehouse to have the front of the treehouse pointing
  // to the user."* The maths is what a test can reach — which way a given
  // prop's local +Z points is a fact about its own source, checked there.
  const camDist = 3.2;
  const dead = faceCameraYaw(0, -8, camDist);
  ok("a landmark on the centre line faces straight out", Math.abs(dead) < 1e-9, `${dead}`);

  // Off the axis it must turn TOWARD the camera, not square to the world — the
  // whole point, since squaring still shows a sliver of the side wall.
  const right = faceCameraYaw(1.9, -7.8, camDist);
  const left = faceCameraYaw(-1.9, -7.8, camDist);
  ok("…one to the right turns back toward the centre", right < 0 && right > -0.4, `${right.toFixed(3)} rad`);
  ok("…and one to the left mirrors it", Math.abs(left + right) < 1e-9, `${left.toFixed(3)} rad`);

  // Pointing it AT the camera means the vector from prop to camera, rotated by
  // the yaw, lands on +Z. Verified rather than asserted by construction.
  const px = 1.9;
  const pz = -7.8;
  const y = faceCameraYaw(px, pz, camDist);
  const dx = 0 - px;
  const dz = camDist - pz;
  const len = Math.hypot(dx, dz);
  // The prop's own +Z after the turn.
  const fx = Math.sin(y);
  const fz = Math.cos(y);
  const dot = (fx * dx + fz * dz) / len;
  ok("…and its front really does point at the camera", Math.abs(dot - 1) < 1e-9, `dot ${dot.toFixed(6)}`);

  ok("the fronted set names the treehouse Nuno asked about", SHOWCASE_FRONTED.has("treehouse"));
  ok(
    "…and only props whose front was VERIFIED as local +Z",
    [...SHOWCASE_FRONTED].every((id) => ["treehouse", "log-cabin", "birdhouse"].includes(id)),
    [...SHOWCASE_FRONTED].join(", "),
  );
}

// ---------------------------------------------------------------------------
section("The scenes are actually wired to it");

const menuSrc = readFileSync("src/render/menuScene.ts", "utf8");
const shopSrc = readFileSync("src/render/shopScene.ts", "utf8");
ok("the menu creates a showcase surround", menuSrc.includes("createShowcaseSurround"));
ok("…and disposes it", /surround\.dispose\(\)/.test(menuSrc));
ok("the shop creates one", shopSrc.includes("createShowcaseSurround"));
ok("…and disposes it", /surround\.dispose\(\)/.test(shopSrc));
ok(
  "…and re-themes it wherever it re-themes its patch",
  (shopSrc.match(/surround\.apply\(/g) ?? []).length >= 3,
  `${(shopSrc.match(/surround\.apply\(/g) ?? []).length} call sites`,
);
ok(
  "the diorama is registered as a no-band stage",
  /DIORAMA_SURROUND_SCALE = 0;/.test(shopSrc),
);

console.log(`\n${"-".repeat(60)}`);
console.log(`SHOWCASE SURROUND: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
