// SCRATCH: which MESH covers a given pixel of a /preview-rework/ turntable
// shot? Reproduces that page's camera exactly (fov 32, dist = max(size)*3.2,
// target at the model's own centre height) and ray-casts through the pixel.
//
// It exists because eyeballing "that flat panel is on the left of the rump"
// sent me looking at the wrong parts twice. A raycast answers in one run what
// three crops could not.
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const [id, px, py, azDeg, elDeg] = [
  process.argv[2] ?? "critter-deer",
  Number(process.argv[3] ?? 415),
  Number(process.argv[4] ?? 570),
  Number(process.argv[5] ?? 42),
  Number(process.argv[6] ?? 12),
];
const W = 1000, H = 1000;
const model = makePropById(id, 0.17);
model.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
const target = new THREE.Vector3(0, centre.y, 0);
const dist = Math.max(size.x, size.y, size.z) * 3.2;
const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
cam.position.copy(target).add(
  new THREE.Vector3(-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist),
);
cam.lookAt(target);
cam.updateMatrixWorld(true);

const ndc = new THREE.Vector2((px / W) * 2 - 1, -((py / H) * 2 - 1));
const ray = new THREE.Raycaster();
ray.setFromCamera(ndc, cam);
const hits = ray.intersectObject(model, true);
console.log(`pixel (${px}, ${py}) at az ${azDeg} el ${elDeg}:`);
if (!hits.length) console.log("  nothing — background");
for (const h of hits.slice(0, 5)) {
  console.log(`  ${(h.object.name || "(unnamed)").padEnd(18)} d=${h.distance.toFixed(3)}`);
}
