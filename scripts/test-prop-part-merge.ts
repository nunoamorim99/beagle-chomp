// IDEA-062: the pure half of the props editor's save path.
//
// This suite exists because of the single worst bug the editor has had, and
// because that bug was a PURE DATA bug wearing a browser costume. The Props
// tab's "Save to props.ts" was deleting previously-saved part edits — the
// treehouse def went from seven to one in Nuno's working tree — and none of
// the three Playwright editor suites could catch it, because each of them
// only ever saved ONCE per page. The defect only appears on the SECOND
// session over the same def, which is exactly the thing a browser suite is
// expensive to express and a data test is trivial at.
//
// So the rule this file encodes: the merge is PropPartEditLog's job, it is
// pure, and it is tested here with no Vite, no Chromium and no DOM. The
// browser suite (scripts/test-editor-props.ts) still covers the wiring —
// that a save really reaches disk and really survives — but the SEMANTICS
// live here.
//
// Runs under `npm run test` (the headless logic suite), not `npm run
// test:editor`. It imports `three` (PropPartEditLog is THREE-aware by
// design: it records gestures on live Object3Ds), which is fine for a Node
// script — the "no three in src/game" rule is about the GAME's pure logic,
// and this is the editor's.
import * as THREE from "three";
import { PropPartEditLog, type LiveAddedPropPart } from "../src/editor/propPartEditLog";
import { buildPartList, type PartNode } from "../src/editor/partTree";
import { toon } from "../src/render/toon";
import type { PropPartLayer, PropPartEdit } from "../src/game/props";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
    failures++;
  }
}

/** A stand-in for a built prop: a root Group with three mesh children, so
 *  paths "0", "1", "2" exist. Deliberately NOT a real makePropFromDef call —
 *  this suite is about the log's merge arithmetic, and a real prop would tie
 *  every assertion to whichever factory happened to build it. */
function fixtureMesh(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), toon({ color: 0x888888 }));
    m.name = `part${i}`;
    g.add(m);
  }
  return g;
}

/** Applies a saved layer's TRANSFORM edits to the fixture the way
 *  board.ts's applyPropParts would, so the log's baselines are taken from a
 *  mesh that already carries the saved work — which is the whole reason the
 *  merge is needed. Only the channels these tests use; this is a fixture,
 *  not a second implementation of applyPropParts. */
function applySaved(nodes: PartNode[], saved: PropPartLayer): void {
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  for (const e of saved.edits) {
    const node = byPath.get(e.path);
    if (!node) continue;
    if (e.position) node.object.position.set(...(e.position as [number, number, number]));
    if (e.rotation) node.object.rotation.set(...(e.rotation as [number, number, number]));
    if (e.scale) node.object.scale.set(...(e.scale as [number, number, number]));
    if (e.visible !== undefined) node.object.visible = e.visible;
  }
}

/** Builds a log baselined against a fixture that already carries `saved` —
 *  i.e. exactly the state main.ts's rebuildPropsPreview leaves behind. */
function loggedFixture(saved?: PropPartLayer): { log: PropPartEditLog; nodes: PartNode[]; mesh: THREE.Group } {
  const mesh = fixtureMesh();
  let nodes = buildPartList(mesh, "Fixture");
  if (saved) applySaved(nodes, saved);
  nodes = buildPartList(mesh, "Fixture");
  const log = new PropPartEditLog();
  log.snapshot(nodes, saved);
  return { log, nodes, mesh };
}

function nodeAt(nodes: PartNode[], path: string): PartNode {
  const n = nodes.find((x) => x.path === path);
  if (!n) throw new Error(`fixture has no part at path "${path}"`);
  return n;
}

function editFor(layer: PropPartLayer | undefined, path: string): PropPartEdit | undefined {
  return layer?.edits.find((e) => e.path === path);
}

console.log("=== a saved channel SURVIVES a session that touched a different one ===");
console.log("    (the treehouse bug: 7 edits -> 1, because the whole field was replaced)");
{
  const saved: PropPartLayer = {
    edits: [{ path: "1", position: [0, 0.98, 0.339], scale: [1, 1.95, 1] }],
    added: [],
  };
  const { log, nodes } = loggedFixture(saved);

  // The user moves part 1 this session. They do NOT touch its scale.
  const node = nodeAt(nodes, "1");
  node.object.position.set(0.5, 1.2, 0.4);
  log.touchTransform(node, "position");

  const merged = log.mergeIntoSaved();
  const e = editFor(merged, "1");
  eq("the new position is written", e?.position, [0.5, 1.2, 0.4]);
  eq("the SAVED scale survives untouched", e?.scale, [1, 1.95, 1]);
  check("exactly one edit, not two", merged?.edits.length === 1);

  // Pin the defect itself, so this suite fails loudly if anyone ever routes
  // main.ts back through toPropPartLayer(). That method is NOT wrong — it
  // honestly reports this session's deltas, which is all it ever claimed —
  // it was wrong only as the value assigned to `def.parts`. Asserting on it
  // here records the distinction rather than leaving the next reader to
  // rediscover why there are two methods.
  const sessionOnly = log.toPropPartLayer();
  check(
    "toPropPartLayer alone would have LOST the saved scale (the old bug)",
    sessionOnly.edits.find((x) => x.path === "1")?.scale === undefined,
  );
}

console.log("\n=== every one of the treehouse's seven edits survives one new edit ===");
{
  const saved: PropPartLayer = {
    edits: [
      { path: "0", scale: [1, 1.08, 1] },
      { path: "1", position: [0, 0.98, 0.339], scale: [1, 1.95, 1] },
      { path: "2", rotation: [-0.048, -0.042, 1.049], scale: [1, 1.1, 1] },
    ],
    added: [],
  };
  const { log, nodes } = loggedFixture(saved);
  const node = nodeAt(nodes, "2");
  node.object.position.set(-0.861, 0.662, -0.091);
  log.touchTransform(node, "position");

  const merged = log.mergeIntoSaved();
  check("all three saved paths are still present", merged?.edits.length === 3);
  eq("path 0's saved scale is intact", editFor(merged, "0")?.scale, [1, 1.08, 1]);
  eq("path 1's saved position is intact", editFor(merged, "1")?.position, [0, 0.98, 0.339]);
  eq("path 2 carries saved rotation AND the new position", editFor(merged, "2")?.rotation, [
    -0.048, -0.042, 1.049,
  ]);
  eq("…and its new position", editFor(merged, "2")?.position, [-0.861, 0.662, -0.091]);
  eq("…and its saved scale", editFor(merged, "2")?.scale, [1, 1.1, 1]);
}

console.log("\n=== an UNTOUCHED log merges to exactly the saved layer ===");
console.log("    (re-entering Props mode must never rewrite a def)");
{
  const saved: PropPartLayer = {
    edits: [{ path: "1", position: [0, 0.98, 0.339] }, { path: "2", scale: [1, 1.1, 1] }],
    added: [],
  };
  const { log } = loggedFixture(saved);
  const merged = log.mergeIntoSaved();
  eq("identical to what was saved", merged?.edits, saved.edits);
  check("and the log reports itself clean, so main.ts skips the write entirely", !log.isDirty);
}

console.log("\n=== a session edit nudged BACK to baseline keeps the saved value ===");
{
  const saved: PropPartLayer = { edits: [{ path: "1", position: [0, 0.98, 0.339] }], added: [] };
  const { log, nodes } = loggedFixture(saved);
  const node = nodeAt(nodes, "1");
  node.object.position.set(0.4, 0.4, 0.4);
  log.touchTransform(node, "position");
  node.object.position.set(0, 0.98, 0.339); // dragged back to where it was
  log.touchTransform(node, "position");

  const merged = log.mergeIntoSaved();
  eq("the saved position is what remains", editFor(merged, "1")?.position, [0, 0.98, 0.339]);
  check("the log is still DIRTY (the user did interact)", log.isDirty);
}

console.log("\n=== clearSavedEdit is the only way back to factory ===");
console.log("    (without it the merge makes every saved edit permanent)");
{
  const saved: PropPartLayer = {
    edits: [{ path: "1", position: [0, 0.98, 0.339] }, { path: "2", scale: [1, 1.1, 1] }],
    added: [],
  };
  const { log } = loggedFixture(saved);
  check("hasSavedEdit sees path 1", log.hasSavedEdit("1"));
  check("hasSavedEdit is false for an unedited path", !log.hasSavedEdit("0"));
  log.clearSavedEdit("1");

  const merged = log.mergeIntoSaved();
  check("path 1 is gone", editFor(merged, "1") === undefined);
  eq("path 2 is untouched", editFor(merged, "2")?.scale, [1, 1.1, 1]);
  check("clearing marks the log dirty so the write actually happens", log.isDirty);
}

console.log("\n=== a previously-ADDED part is carried forward, not deleted ===");
console.log("    (board.ts rebuilds it as a plain mesh, so the log's `added` starts empty)");
{
  const mesh = fixtureMesh();
  // What makePropFromDef leaves behind for a saved added part: a real mesh
  // whose NAME is the AddedPropPart id (board.ts's addPropPart), parented
  // under the prop root.
  const added = new THREE.Mesh(new THREE.SphereGeometry(0.1), toon({ color: 0xe8a23d }));
  added.name = "added-sphere-1";
  added.position.set(0, 0.4, 0);
  mesh.add(added);

  const saved: PropPartLayer = {
    edits: [{ path: "0", scale: [1, 1.08, 1] }],
    added: [
      {
        id: "added-sphere-1",
        parentPath: "",
        kind: "sphere",
        params: { radius: 0.1 },
        position: [0, 0.4, 0],
        color: 0xe8a23d,
      },
    ],
  };

  // main.ts's rebuild order: tag -> walk -> snapshot(saved) -> adopt.
  added.userData.editorAdded = true;
  added.userData.addedPropPartId = "added-sphere-1";
  const nodes = buildPartList(mesh, "Fixture");
  const log = new PropPartEditLog();
  log.snapshot(nodes, saved);

  const addedNode = nodes.find((n) => n.object === added);
  check("the tree marks the rebuilt part as ADDED", addedNode?.isAdded === true);

  const record: LiveAddedPropPart = {
    id: "added-sphere-1",
    parentPath: "",
    kind: "sphere",
    object: added,
    material: added.material as THREE.MeshToonMaterial,
    params: { radius: 0.1 },
  };
  log.adoptSaved(record);
  check("adopting does NOT mark the log dirty", !log.isDirty);

  // Nothing else happens this session. The part must still be there.
  const untouched = log.mergeIntoSaved();
  check("the added part survives a session that did not touch it", untouched?.added.length === 1);
  eq("at its saved pose", untouched?.added[0]?.position, [0, 0.4, 0]);
  eq("and the base edit survives too", editFor(untouched, "0")?.scale, [1, 1.08, 1]);

  // Now move it. It must update its OWN record, and emit no path edit.
  added.position.set(0.2, 0.6, 0.1);
  log.touchTransform(addedNode!, "position");
  const moved = log.mergeIntoSaved();
  eq("moving it updates the added record", moved?.added[0]?.position, [0.2, 0.6, 0.1]);
  check("…and emits NO path edit for it", moved?.edits.every((e) => e.path !== "3") === true);
  check("still exactly one added part", moved?.added.length === 1);

  // Delete it. It must leave.
  log.removePart(added);
  const deleted = log.mergeIntoSaved();
  check("deleting an adopted part removes it from the def", deleted?.added.length === 0);
  eq("the base edit is still not collateral damage", editFor(deleted, "0")?.scale, [1, 1.08, 1]);
}

console.log("\n=== a genuine all-clear still clears the field ===");
{
  const saved: PropPartLayer = { edits: [{ path: "1", position: [0, 0.98, 0.339] }], added: [] };
  const { log } = loggedFixture(saved);
  log.clearSavedEdit("1");
  const merged = log.mergeIntoSaved();
  check("mergeIntoSaved returns undefined so main.ts deletes def.parts", merged === undefined);
}

console.log("\n=== every EDIT_CHANNEL round-trips through the merge ===");
console.log("    (a channel missing from mergeEdit's switch is a silent data loss)");
{
  const saved: PropPartLayer = {
    edits: [
      {
        path: "1",
        position: [1, 1, 1],
        rotation: [0.1, 0.2, 0.3],
        scale: [2, 2, 2],
        color: 0x112233,
        emissive: 0x445566,
        visible: false,
      },
    ],
    added: [],
  };
  const { log, nodes } = loggedFixture(saved);
  // Touch ONE channel; every other saved channel must come through.
  const node = nodeAt(nodes, "1");
  node.object.scale.set(3, 3, 3);
  log.touchTransform(node, "scale");

  const e = editFor(log.mergeIntoSaved(), "1");
  eq("position", e?.position, [1, 1, 1]);
  eq("rotation", e?.rotation, [0.1, 0.2, 0.3]);
  eq("scale (the one the session changed)", e?.scale, [3, 3, 3]);
  eq("color", e?.color, 0x112233);
  eq("emissive", e?.emissive, 0x445566);
  eq("visible", e?.visible, false);
}

console.log("\n" + "-".repeat(60));
if (failures === 0) console.log("PROP PART MERGE: all passed");
else {
  console.log(`PROP PART MERGE: ${failures} FAILED`);
  process.exit(1);
}
