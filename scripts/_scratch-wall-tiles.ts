import { MAZES } from "../src/game/mazes";
const rows = MAZES[0].length, cols = MAZES[0][0].length;
const always: [number, number][] = [];
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  let n = 0;
  for (const m of MAZES) if (m[y]?.[x] === "#") n++;
  if (n === MAZES.length) always.push([x, y]);
}
console.log("mazes", MAZES.length, "always-wall", always.length);
console.log(always.map(([x,y]) => `${x},${y}`).join(" "));
