import { buildSurroundContent } from "../src/render/surroundRecipe";
import { makeSurroundMaterials } from "../src/render/surroundProps";
import { MAZE_THEMES } from "../src/game/themes";
import { setSurroundView } from "../src/render/surround";
const G = MAZE_THEMES.find((t) => t.id === "garden")!;
function run(label: string) {
  const host = buildSurroundContent("plots", makeSurroundMaterials(G.palette));
  const by: Record<string, [number, number]> = {};
  for (const c of host.children) {
    let t = 0; c.traverse((o: any) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const k = c.children.some((x) => x.name.startsWith("picket")) ? "fence" : c.children.some((x) => x.name.startsWith("flower") && x.children.length) ? "patch" : c.children.some((x) => x.name.startsWith("bloom")) && c.children.some((x)=>x.name.startsWith("blob")) ? "fshrub" : c.children.some((x)=>x.name==="kerb") ? "bed" : c.children.some((x)=>x.name.startsWith("flower")) ? "border" : c.children.some((x)=>x.name.startsWith("blob")) ? "shrub" : "tree/other";
    by[k] ??= [0, 0]; by[k][0]++; by[k][1] += t;
  }
  let tot = 0; for (const v of Object.values(by)) tot += v[1];
  console.log(label, Math.round(tot), JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${v[0]} / ${Math.round(v[1])}`]))));
}
run("full");
setSurroundView(15.3, 22.4, -38.7); run("phone");
setSurroundView(31.6, 11.9, -21.2); run("desktop");
