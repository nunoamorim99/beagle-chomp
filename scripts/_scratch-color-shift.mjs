import * as THREE from "three";
THREE.ColorManagement.enabled = true;
const shift = (c, k) => "0x" + new THREE.Color(c).multiplyScalar(k).getHex().toString(16).padStart(6,"0");
for (const base of [0x34683a, 0x285835, 0x24523a, 0x2e6337, 0x215426]) {
  console.log("0x"+base.toString(16), "| x1.38", shift(base,1.38), "| x1.6", shift(base,1.6), "| x1.9", shift(base,1.9), "| x0.56", shift(base,0.56), "| x0.45", shift(base,0.45));
}
