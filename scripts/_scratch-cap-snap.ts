// SCRATCH (IDEA-080): where does the sea arch's bleached cap land on the snap?
import { snapToPalette } from "../src/render/madboxStyle";
import { hexOf, mix, rgbOf } from "../src/render/paint";
for (const rock of [0xa07a58, 0x8c6a4c, 0xb08560]) {
  for (const k of [0.45, 0.55, 0.65]) {
    const cap = hexOf(mix(rgbOf(rock), rgbOf(0xe0a868), k));
    console.log(rock.toString(16), k, cap.toString(16), snapToPalette(rock).id, "->", snapToPalette(cap).id);
  }
}
