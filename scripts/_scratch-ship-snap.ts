import { snapToPalette } from "../src/render/madboxStyle";
import { hexOf, mix, rgbOf } from "../src/render/paint";
for (const [t, k] of [[0xf0d8a8,0.7],[0xf0d8a8,0.8],[0xead4a4,0.75],[0xe0b878,0.9]] as const) {
  const h = hexOf(mix(rgbOf(0xb07a3e), rgbOf(t), k));
  console.log(t.toString(16), k, h.toString(16), snapToPalette(h).id);
}
