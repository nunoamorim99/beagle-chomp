// SCRATCH: the local position of every GROUP in a prop, so a part edit can be
// re-based when its part moves into one.
import { makePropById } from "../src/render/board";
import * as THREE from "three";
const prop = makePropById(process.argv[2] ?? "critter-deer", 0.17);
const out: Record<string, [number, number, number]> = {};
prop.traverse((o) => {
  if (!(o as THREE.Mesh).isMesh && o.name) out[o.name] = [o.position.x, o.position.y, o.position.z];
});
console.log(JSON.stringify(out));
