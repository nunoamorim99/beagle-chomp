// OWNER: character editor (IDEA-025, dev-only).
// Turns the EditLog into a readable, paste-ready three.js snippet (added
// parts read their live transform off the recorded objects — they never
// animate, so live reads are stable). The output references the same variable
// names as characters.ts so pasting a line right after the part's creation
// "just works". Also owns the primitive-geometry table: the real constructor
// (for the live preview) and its code string live side by side here so the
// preview and the generated code can never drift apart.
import * as THREE from "three";
import {
  type EditLog,
  type TransformEditRecord,
  type AddedPartRecord,
  type PrimKind,
  type Vec3Tuple,
} from "./editLog";

/** Rounds to 3 decimals and avoids "-0" so snippets stay tidy. */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

function hex(color: number): string {
  return `0x${color.toString(16).padStart(6, "0")}`;
}

function vec3Call(target: string, prop: "position" | "scale", v: Vec3Tuple): string {
  if (prop === "scale" && v[0] === v[1] && v[1] === v[2]) {
    return `${target}.scale.setScalar(${fmt(v[0])});`;
  }
  return `${target}.${prop}.set(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])});`;
}

/** Rotation reads best per-axis when only one axis moved. */
function rotationLines(target: string, v: Vec3Tuple, baselineless: boolean): string[] {
  const axes: Array<["x" | "y" | "z", number]> = [
    ["x", v[0]],
    ["y", v[1]],
    ["z", v[2]],
  ];
  const nonZero = axes.filter(([, value]) => Math.abs(value) > 1e-4);
  if (baselineless && nonZero.length > 0 && nonZero.length < 3) {
    return nonZero.map(([axis, value]) => `${target}.rotation.${axis} = ${fmt(value)};`);
  }
  return [`${target}.rotation.set(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])});`];
}

function transformEditLines(record: TransformEditRecord): string[] {
  const lines: string[] = [];
  if (record.isAutoNamed) {
    lines.push(
      `// NOTE: "${record.varName}" has no variable name in the source yet — it is the`,
      `// ${record.locator}. Give it a local const in the builder first, then use that name:`,
    );
  }
  if (record.position) lines.push(vec3Call(record.varName, "position", record.position));
  if (record.rotation) lines.push(...rotationLines(record.varName, record.rotation, false));
  if (record.scale) lines.push(vec3Call(record.varName, "scale", record.scale));
  if (record.visible !== undefined) lines.push(`${record.varName}.visible = ${record.visible};`);
  return lines;
}

const GEOMETRY_CTORS: Record<PrimKind, (p: Record<string, number>) => string> = {
  sphere: (p) => `new THREE.SphereGeometry(${fmt(p.radius)}, 20, 14)`,
  box: (p) => `new THREE.BoxGeometry(${fmt(p.width)}, ${fmt(p.height)}, ${fmt(p.depth)})`,
  cylinder: (p) =>
    `new THREE.CylinderGeometry(${fmt(p.radiusTop)}, ${fmt(p.radiusBottom)}, ${fmt(p.height)}, 20)`,
  cone: (p) => `new THREE.ConeGeometry(${fmt(p.radius)}, ${fmt(p.height)}, 20)`,
  capsule: (p) => `new THREE.CapsuleGeometry(${fmt(p.radius)}, ${fmt(p.length)}, 6, 12)`,
};

/** Starting params per primitive kind (small, character-scale sizes). */
export const GEOMETRY_DEFAULTS: Record<PrimKind, Record<string, number>> = {
  sphere: { radius: 0.12 },
  box: { width: 0.2, height: 0.2, depth: 0.2 },
  cylinder: { radiusTop: 0.08, radiusBottom: 0.08, height: 0.2 },
  cone: { radius: 0.1, height: 0.2 },
  capsule: { radius: 0.07, length: 0.15 },
};

/** The live counterpart of GEOMETRY_CTORS — must construct exactly what the
 *  emitted code string says. */
export function buildPrimitiveGeometry(
  kind: PrimKind,
  p: Record<string, number>,
): THREE.BufferGeometry {
  switch (kind) {
    case "sphere":
      return new THREE.SphereGeometry(p.radius, 20, 14);
    case "box":
      return new THREE.BoxGeometry(p.width, p.height, p.depth);
    case "cylinder":
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 20);
    case "cone":
      return new THREE.ConeGeometry(p.radius, p.height, 20);
    case "capsule":
      return new THREE.CapsuleGeometry(p.radius, p.length, 6, 12);
  }
}

function addedPartLines(part: AddedPartRecord): string[] {
  const { name, object, material } = part;
  const lines: string[] = [
    `// new part: ${name} (${part.kind}) attached to ${part.parentVar}`,
    `const ${name}Mat = new THREE.MeshStandardMaterial({ color: ${hex(material.color.getHex())}, roughness: ${fmt(material.roughness)} });`,
    `const ${name} = new THREE.Mesh(${GEOMETRY_CTORS[part.kind](part.params)}, ${name}Mat);`,
    `${name}.name = "${name}";`,
  ];
  const p = object.position;
  lines.push(`${name}.position.set(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)});`);
  const r = object.rotation;
  if (Math.abs(r.x) > 1e-4 || Math.abs(r.y) > 1e-4 || Math.abs(r.z) > 1e-4) {
    lines.push(...rotationLines(name, [r.x, r.y, r.z], true));
  }
  const s = object.scale;
  if (Math.abs(s.x - 1) > 1e-4 || Math.abs(s.y - 1) > 1e-4 || Math.abs(s.z - 1) > 1e-4) {
    lines.push(vec3Call(name, "scale", [s.x, s.y, s.z]));
  }
  lines.push(`${name}.castShadow = true;`, `${part.parentVar}.add(${name});`);
  return lines;
}

/**
 * The edit lines grouped in blocks (one block per edited part / material /
 * added part), in tree order — shared by the snippet view (generateCode) and
 * the full-file export (fileExport.ts), so the two can never disagree.
 */
export function collectEditBlocks(log: EditLog, builderName: string): string[][] {
  const blocks: string[][] = [];

  // Tree order = path order (paths are index-based, so a numeric-aware sort
  // of the split segments reproduces DFS order).
  const transformRecords = [...log.transformEdits.values()].sort((a, b) => {
    const as = a.path === "" ? [] : a.path.split("/").map(Number);
    const bs = b.path === "" ? [] : b.path.split("/").map(Number);
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const d = (as[i] ?? -1) - (bs[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  });
  for (const record of transformRecords) {
    const lines = transformEditLines(record);
    if (lines.length > 0) blocks.push(lines);
  }

  for (const record of log.materialEdits.values()) {
    const { info } = record;
    const lines: string[] = [];
    if (info.shareCount > 1) {
      lines.push(`// shared material — this recolors all ${info.shareCount} parts using "${info.varName}":`);
    }
    if (!info.isKnownVar) {
      lines.push(
        `// NOTE: "${info.varName}" is not a real variable in the source — it is the material`,
        `// of "${info.firstUserVar}". Find its "new THREE.MeshStandardMaterial" in ${builderName}().`,
      );
    }
    if (record.color !== undefined) lines.push(`${info.varName}.color.setHex(${hex(record.color)});`);
    if (record.roughness !== undefined) lines.push(`${info.varName}.roughness = ${fmt(record.roughness)};`);
    blocks.push(lines);
  }

  for (const part of log.addedParts) {
    blocks.push(addedPartLines(part));
  }

  return blocks;
}

/**
 * The full generated snippet for the current character's edits, in tree
 * order (transform edits), then materials, then added parts.
 */
export function generateCode(log: EditLog, builderName: string): string {
  if (log.isEmpty) {
    return [
      `// No edits yet.`,
      `// Select a part (click it in the tree or in the 3D view) and tweak it,`,
      `// or add a new part — the three.js code for every change appears here.`,
    ].join("\n");
  }

  const header = [
    `// --- edits for ${builderName}() in src/render/characters.ts ---`,
    `// Paste each line inside ${builderName}(), after the part it modifies is`,
    `// created — or use "Copy full file" to get characters.ts with these`,
    `// already applied. Variable names match the source.`,
  ].join("\n");

  return [header, ...collectEditBlocks(log, builderName).map((b) => b.join("\n"))].join("\n\n");
}
