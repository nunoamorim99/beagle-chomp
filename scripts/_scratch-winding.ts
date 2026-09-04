// Signed volume of every mesh in makeBeagle: positive = outward winding.
import * as THREE from "three";
import { makeBeagle } from "../src/render/characters";
import { getBeagleSkin } from "../src/game/cosmetics";
const g = makeBeagle(getBeagleSkin("classic" as never));
g.updateWorldMatrix(true, true);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  const pos = geo.getAttribute("position");
  let vol = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  console.log(`${vol >= 0 ? "OK  " : "INV "} ${o.name.padEnd(16)} ${vol.toExponential(2)}`);
});
