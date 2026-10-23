import { snapToPalette } from "../src/render/madboxStyle";
for (const h of [0xa8743e, 0xcfb07a, 0xd8bf88, 0xe0c890, 0xc8a870, 0xe8e5dd, 0xf0efea, 0xf2c23a, 0x2a8048, 0x6aa850])
  console.log(h.toString(16), snapToPalette(h).id);
