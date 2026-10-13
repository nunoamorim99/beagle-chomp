// SCRATCH: duplicate part NAMES in a prop. Two parts sharing a name makes the
// editor's Components tree ambiguous and the Mirror action refuse, and no
// render says a word about it.
import * as THREE from "three";
import { PROP_LIBRARY } from "../src/game/props";
import { makePropById } from "../src/render/board";

for (const def of PROP_LIBRARY) {
  const prop = makePropById(def.id, 0.17);
  const seen = new Map<string, number>();
  prop.traverse((o) => {
    if (!o.name) return;
    seen.set(o.name, (seen.get(o.name) ?? 0) + 1);
  });
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    console.log(`${def.id}: ${dupes.map(([n, c]) => `${n} x${c}`).join(", ")}`);
  }
}
void THREE;
