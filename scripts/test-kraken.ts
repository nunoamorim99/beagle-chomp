// IDEA-086: guards Pirate Island's kraken — the boat taken on the north-west
// sea, which replaced the static wreck on the BOARD.
//
// Headless: the whole act is procedural geometry and a skeleton, so it builds
// and plays in Node. What it exists for, in order of how much each would cost
// to find by looking:
//
//  1. THE ACT STAYS ON THE WATER, EVERY FRAME. The boat sails a curve and the
//     tentacles break the surface round it; one bad path point puts a hull on
//     the beach or a tentacle up through dry sand, and it is only wrong for a
//     second of a nine-second loop. So the whole act is walked, not one pose.
//  2. EVERY COLOUR IS STYLE-REACHABLE AND ON ITS OWN RUNG. The reference this
//     was studied from paints with vertex colours, which IDEA-079's style
//     skips; and its peach belly snaps to the same `coral` as the back, so the
//     suckers vanish. Both are silent.
//  3. THE CLOTH HAS REAL BACK FACES. The style's matcaps do not keep
//     `DoubleSide`, so a single-sided sail disappears whenever the boat turns
//     its back to the camera.
//  4. IT IS CHEAP ENOUGH TO STAND ON A BOARD, and only on the island's.
import * as THREE from "three";
import { KrakenBoatEvent, KRAKEN_TIMELINE, type KrakenPhase } from "../src/render/kraken/krakenBoatEvent";
import { ISLAND_KRAKEN_SITE, buildIslandKraken } from "../src/render/kraken/islandKraken";
import { inSea } from "../src/render/seaside";
import { applyMadboxStyle, snapToPalette } from "../src/render/madboxStyle";
import { MAZE_THEMES } from "../src/game/themes";
import { buildSurroundContent, ISLAND_SET_PIECES } from "../src/render/surroundRecipe";
import { makeSurroundMaterials, disposeSurroundMaterials } from "../src/render/surroundProps";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "  ok " : "FAIL "} ${label}${detail ? "  (" + detail + ")" : ""}`);
}
function section(t: string): void {
  console.log("\n" + t);
}

/** test-madbox-style.ts's minimal canvas: just enough for a matcap to be
 *  generated in Node. Nothing here rasterises. */
function installCanvasStub(): void {
  const g = globalThis as { document?: unknown };
  if (g.document) return;
  g.document = {
    createElement(kind: string) {
      if (kind !== "canvas") return {};
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: () => {},
            fillRect: () => {},
            beginPath: () => {},
            ellipse: () => {},
            fill: () => {},
            createRadialGradient: () => ({ addColorStop: () => {} }),
            set fillStyle(_v: string) {},
            get fillStyle() {
              return "";
            },
          };
        },
      };
    },
  };
}

const ISLAND = MAZE_THEMES.find((t) => t.id === "island")!;

/** The island's kraken, standing where the board stands it. */
function islandKraken(): KrakenBoatEvent {
  const k = buildIslandKraken(new THREE.Group(), ISLAND);
  if (!k) throw new Error("the island built no kraken");
  return k;
}

section("Only the island has one");
{
  for (const t of MAZE_THEMES) {
    const scene = new THREE.Group();
    const k = buildIslandKraken(scene, t);
    const want = t.palette.surround === "island";
    ok(`${t.id}: ${want ? "has" : "has no"} kraken`, !!k === want);
    k?.dispose();
    ok(`${t.id}: dispose leaves nothing in the scene`, scene.children.length === 0);
  }
}

section("The act stays on the water, every frame");
{
  const k = islandKraken();
  k.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let dryHull = 0;
  let dryAnchor = 0;
  let samples = 0;
  const body = k.boat.getObjectByName("krakenBoatBody")!;
  for (let i = 0; i <= 120; i++) {
    k.setProgress(i / 120);
    k.updateMatrixWorld(true);
    if (k.boatRig.visible) {
      body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.attributes.position;
        for (let j = 0; j < pos.count; j += 3) {
          v.fromBufferAttribute(pos, j).applyMatrix4(m.matrixWorld);
          // A margin past the swash's reach: the boat sails in open water.
          if (!inSea(v.x, v.z, -1)) dryHull++;
        }
      });
    }
    for (const a of k.tentacles.anchors) {
      a.getWorldPosition(v);
      if (!inSea(v.x, v.z, -1)) dryAnchor++;
    }
    samples++;
  }
  ok("no hull vertex reaches the beach at any point in the act", dryHull === 0, `${dryHull} dry over ${samples} frames`);
  ok("no tentacle breaks the surface on the sand", dryAnchor === 0, `${dryAnchor} dry`);
  ok("…and it is on the NORTH-WEST, where the wreck was", ISLAND_KRAKEN_SITE.x < -3 && ISLAND_KRAKEN_SITE.z < -16);

  // Every splash lands on water too.
  let drySplash = 0;
  let splashes = 0;
  const s = new KrakenBoatEvent({
    duration: ISLAND_KRAKEN_SITE.duration,
    path: ISLAND_KRAKEN_SITE.path.map((p) => p.clone()),
    onSplash: (p) => {
      splashes++;
      if (!inSea(p.x, p.z, -0.5)) drySplash++;
    },
  });
  s.position.set(ISLAND_KRAKEN_SITE.x, 0, ISLAND_KRAKEN_SITE.z);
  s.scale.setScalar(ISLAND_KRAKEN_SITE.scale);
  s.updateMatrixWorld(true);
  for (let t = 0; t < ISLAND_KRAKEN_SITE.duration; t += 1 / 60) s.update(1 / 60);
  ok("an act throws splashes (landing, surfacing tentacles, sinking)", splashes >= 7, `${splashes}`);
  ok("every splash lands on the sea", drySplash === 0, `${drySplash} on sand`);
  s.dispose();
  k.dispose();
}

section("It plays as an act, rests, and plays again");
{
  const phases: KrakenPhase[] = [];
  const k = new KrakenBoatEvent({ duration: 4, rest: 2, onPhase: (p) => phases.push(p) });
  const step = 1 / 60;
  let restHidden = true;
  for (let t = 0; t < 4 + 2 + 1; t += step) {
    k.update(step);
    if (t > 4.05 && t < 5.9 && (k.boatRig.visible || k.phase !== "hidden")) restHidden = false;
  }
  const order = phases.join(" > ");
  ok(
    "the phases run in order",
    order.startsWith("sail > rise > grab > sink > hidden > spawn"),
    order,
  );
  ok("the sea is empty through the rest", restHidden);
  ok("…and the next act starts after it", k.phase === "spawn" || k.phase === "sail", k.phase);
  ok("the timeline's phases are in order", KRAKEN_TIMELINE.sail[1] <= KRAKEN_TIMELINE.sink[0] && KRAKEN_TIMELINE.sink[1] < KRAKEN_TIMELINE.hidden);
  k.dispose();

  // A board that is never ticked (the preview, the editor) shows a boat.
  const still = islandKraken();
  ok("an un-ticked board shows a boat under sail", still.boatRig.visible && still.phase === "sail", still.phase);
  still.dispose();
}

section("Every colour reaches the shipped style, each on its own rung");
{
  const k = islandKraken();
  const M = k.materials;
  let vertexColoured = 0;
  let foreign = 0;
  k.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if ((mat as THREE.MeshToonMaterial).vertexColors) vertexColoured++;
      // Toon (snapped by the style) or Basic (the unlit foam, which the style
      // passes by on purpose); nothing else.
      if (mat.type !== "MeshToonMaterial" && mat.type !== "MeshBasicMaterial") foreign++;
    }
  });
  ok("no vertex colours (the style skips them)", vertexColoured === 0, `${vertexColoured}`);
  ok("every material is toon or unlit foam", foreign === 0, `${foreign}`);
  ok("the keel band is declared ink", M.hullDark.userData.madboxRole === "ink");
  ok("the windows and flag are declared ink", M.ink.userData.madboxRole === "ink");
  const entry = (m: THREE.Material): string => snapToPalette((m as THREE.MeshToonMaterial).color.getHex()).id;
  const pairs: Array<[string, THREE.Material, THREE.Material]> = [
    ["tentacle back / belly", M.tentacle, M.tentacleBelly],
    ["hull / deck", M.hull, M.deck],
    ["sail / its stripe", M.cream, M.sailStripe],
    ["hull / spars", M.hull, M.spar],
    ["cabin / roof", M.cream, M.roof],
  ];
  for (const [label, a, b] of pairs) ok(`${label} land on different entries`, entry(a) !== entry(b), `${entry(a)} / ${entry(b)}`);

  // And the swap actually reaches all of it — the tentacles included, which
  // are a SkinnedMesh carrying a material ARRAY. Without a canvas the swap is
  // a silent no-op, so this needs test-madbox-style.ts's minimal stub.
  installCanvasStub();
  applyMadboxStyle(k);
  let unstyled = 0;
  k.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat.type === "MeshToonMaterial") unstyled++;
    }
  });
  ok("after the style pass nothing is left on toon", unstyled === 0, `${unstyled}`);
  const tm = k.tentacles.mesh;
  ok(
    "the tentacles keep two regions as matcaps",
    Array.isArray(tm.material) && tm.material.length === 2 && tm.material.every((m) => m.type === "MeshMatcapMaterial"),
  );
  k.dispose();
}

section("The cloth reads from both sides");
{
  const k = islandKraken();
  for (const name of ["sail", "flag"]) {
    const m = k.boat.getObjectByName(name) as THREE.Mesh;
    const n = m.geometry.attributes.normal;
    let plus = 0;
    let minus = 0;
    for (let i = 0; i < n.count; i++) (n.getX(i) > 0 ? plus++ : minus++);
    ok(`${name}: half its normals face each way`, Math.abs(plus - minus) <= n.count * 0.05, `${plus} / ${minus}`);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    ok(`${name}: does not rely on DoubleSide`, mats.every((x) => x.side === THREE.FrontSide));
  }
  k.dispose();
}

section("Cheap enough to stand on a board");
{
  const k = islandKraken();
  k.setProgress(0.82); // mid-sink: boat, every tentacle and the splashes up
  let meshes = 0;
  let tris = 0;
  k.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const groups = Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
    meshes += groups;
    const idx = m.geometry.getIndex();
    tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
  });
  // Rings are pooled and hidden until a splash; a still frame shows the floor.
  ok("at most 16 draw calls with no splash in flight", meshes <= 16, `${meshes}`);
  ok("under 20k triangles", tris < 20_000, Math.round(tris) + " tris");
  ok("the tentacles are ONE skinned mesh", k.tentacles.mesh.isSkinnedMesh && k.tentacles.anchors.length === 5);
  k.dispose();
}

section("The board's sea is the kraken's; the showcase keeps its wreck");
{
  const mats = makeSurroundMaterials(ISLAND.palette);
  const board = buildSurroundContent("island", mats, true);
  const showcase = buildSurroundContent("island", mats);
  ok("the board builds no wreck", !board.getObjectByName("wreck-site"));
  ok("the showcase still does", !!showcase.getObjectByName("wreck-site"));
  ok("the wreck is the one showcase-only piece", ISLAND_SET_PIECES.filter((p) => p.showcaseOnly).map((p) => p.name).join() === "wreck");
  for (const g of [board, showcase]) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
  disposeSurroundMaterials(mats);
}

console.log("\n" + "-".repeat(60));
console.log(`KRAKEN: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
