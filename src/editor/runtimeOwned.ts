// OWNER: character editor (IDEA-041, dev-only).
// Which part/property pairs are written by the RUNTIME rather than owned by
// the builder in characters.ts.
//
// Why this exists: a control that accepts your edit, saves it correctly, and
// is then overwritten 60 times a second is worse than no control at all — it
// is the single biggest reason the editor felt like it "doesn't save". Rotate
// an ear and `animateBeagleParts` reassigns `earL.rotation.x` on the very next
// frame. Recolour the coat and `applyBeagleSkin` resets it from the equipped
// skin. The value written to characters.ts was correct; it just never had a
// chance to matter.
//
// So the editor now knows, up front, which channels it does not own — and
// says so (and where the value REALLY lives) instead of pretending.
//
// Pure data + lookups. No `three`, no DOM: unit-testable in Node
// (scripts/test-runtime-owned.ts), and consumed by both the inspector (to
// annotate controls) and the save path (to refuse with a real reason).

/** The channels the editor can edit on a part or material. */
export type Channel = "position" | "rotation" | "scale" | "visible" | "color" | "roughness";

export interface RuntimeOwnership {
  /** What overwrites it, in plain language — shown to the user verbatim. */
  reason: string;
  /** Where the value can actually be changed, when there is such a place. */
  owner?: string;
}

interface Rule {
  /** Builders this applies to; `null` means every enemy builder. */
  builders: readonly string[] | null;
  /** Part or material variable names; a function allows families (hem0…hemN). */
  match: readonly string[] | ((varName: string) => boolean);
  channels: readonly Channel[];
  reason: string;
  owner?: string;
}

export const ENEMY_BUILDERS = ["makeGhost", "makeBeetle", "makeBee", "makeLadybug"] as const;
export const BEAGLE_BUILDER = "makeBeagle";

const BEAGLE_LEGS = ["legFL", "legFR", "legBL", "legBR"] as const;
/** The four coat materials makeBeagle builds from the equipped skin. */
export const BEAGLE_COAT_MATS = ["tan", "white", "black", "ear", "earMat"] as const;

const RULES: readonly Rule[] = [
  // --- the beagle's animated joints (animateBeagleParts, every frame) ---
  {
    builders: [BEAGLE_BUILDER],
    match: ["tail"],
    channels: ["rotation"],
    reason:
      "The tail's rotation is animated every frame by animateBeagleParts() — it wags on idle and " +
      "harder while moving, so a value saved here is overwritten immediately.",
    owner: "TAIL_WAG_AMPLITUDE / TAIL_IDLE_WAG_AMPLITUDE in src/render/characters.ts",
  },
  {
    builders: [BEAGLE_BUILDER],
    match: ["earL", "earR"],
    channels: ["rotation"],
    reason:
      "Ear rotation is animated every frame by animateBeagleParts() (idle sway + twitch, flop while " +
      "moving), so a value saved here is overwritten immediately.",
    owner: "EAR_IDLE_SWAY_AMPLITUDE / EAR_FLOP_AMPLITUDE in src/render/characters.ts",
  },
  {
    builders: [BEAGLE_BUILDER],
    match: BEAGLE_LEGS,
    channels: ["rotation"],
    reason:
      "Leg rotation is the trot cycle, written every frame by animateBeagleParts(). It blends to 0 " +
      "when the beagle stands still, so a saved rotation cannot survive.",
    owner: "LEG_TROT_AMPLITUDE in src/render/characters.ts",
  },
  {
    builders: [BEAGLE_BUILDER],
    match: ["jaw"],
    channels: ["rotation"],
    reason:
      "The jaw's rotation is the chomp animation, written every frame by animateBeagleParts().",
    owner: "JAW_CHOMP_AMPLITUDE in src/render/characters.ts",
  },
  // --- the beagle's coat colours (applyBeagleSkin) ---
  {
    builders: [BEAGLE_BUILDER],
    match: BEAGLE_COAT_MATS,
    channels: ["color"],
    reason:
      "Coat colour belongs to the equipped SKIN, not to makeBeagle(): applyBeagleSkin() resets all " +
      "four coat materials from skin.coat whenever a skin is applied, so a colour written into " +
      "characters.ts would be overwritten.",
    owner: "the skin's coat in src/game/cosmetics.ts (BEAGLE_SKINS)",
  },

  // --- every enemy: the hem/skirt idle wobble (animateGhostHem) ---
  // NOT claimed any more, deliberately. animateGhostHem used to write absolute
  // values and discard whatever the builder authored, which made these channels
  // genuinely un-editable — and dropped the bee's stripes and the ladybug's
  // spots off their bodies onto the floor. It now wobbles RELATIVE to each
  // part's authored rest pose (see restPose in characters.ts), so an edit here
  // survives and simply becomes the value the wobble oscillates around. Locking
  // a channel the user CAN change is exactly as wrong as leaving one unlocked
  // that they cannot.
  // --- the beetle's walking rig (animateInsectLimbs, every frame) ---
  // Both are DEDICATED pivots that carry nothing authored, which is the point:
  // the leg's own `root` keeps its splay and fan and stays fully editable, and
  // only the inner swing node is claimed here. Rotating a node that mixed
  // authored values with animated ones would force the whole channel to be
  // locked, taking the splay with it.
  {
    builders: ["makeBeetle"],
    match: (v) => /^legSwing[FMB][LR]$/.test(v),
    channels: ["rotation"],
    reason:
      "This is the leg's gait pivot — animateInsectLimbs() writes its rotation every frame for the " +
      "alternating-tripod walk cycle. Edit the leg's `root` instead: that carries the splay and fan, " +
      "and nothing overwrites it.",
    owner: "LEG_GAIT_SWING / LEG_GAIT_FREQ in src/render/characters.ts",
  },
  {
    builders: ["makeBeetle"],
    match: ["antennaPivotL", "antennaPivotR"],
    channels: ["rotation"],
    reason:
      "The antenna sway is written every frame by animateInsectLimbs() — it never stops, even when " +
      "the beetle is standing still. The antenna's shape lives in its curve, not in this rotation.",
    owner: "ANTENNA_SWAY / ANTENNA_SWAY_FREQ in src/render/characters.ts",
  },

  // --- every enemy: eyes, pupils and state colours (applyGhostState) ---
  // Every enemy's pupils are flush decal caps on a dart pivot now (they used
  // to be free-floating balls that TRANSLATED). So it is the PIVOT's rotation
  // the runtime drives — the cap's own transform is untouched, and its aim is
  // baked into its geometry rather than set on the node.
  {
    builders: null,
    match: ["pupilPivotL", "pupilPivotR"],
    channels: ["rotation"],
    reason:
      "This pivot's rotation IS the eye-dart: applyGhostState() sweeps it every frame so the pupil " +
      "cap slides across the form while staying flush on it.",
    owner: "PUPIL_SWEEP / PUPIL_SMOOTH_RATE in src/render/characters.ts",
  },
  {
    builders: null,
    match: ["bodyMat"],
    channels: ["color"],
    reason:
      "The enemy body colour is state-driven: applyGhostState() sets it to the frightened blue, or " +
      "back to the per-enemy base colour, on every frame. The base colour itself is passed INTO the " +
      "builder as an argument, not written inside it.",
    owner: "COLORS.ghostRose / ghostTeal / ghostAmber in src/game/config.ts",
  },
  {
    builders: null,
    match: ["pupM"],
    channels: ["color"],
    reason: "Pupil colour is state-driven — applyGhostState() sets it per ghost state every frame.",
    owner: "the setHex calls in applyGhostState (src/render/characters.ts)",
  },
  {
    builders: null,
    match: (v) =>
      /^(eyeL|eyeR|pupilL|pupilR|pupilPivotL|pupilPivotR|glintL|glintR|hem\d+|shell|dome|body|skirt|seam|head)$/.test(v),
    channels: ["visible"],
    reason:
      "Visibility is state-driven: applyGhostState() re-asserts every child as visible whenever the " +
      "enemy's state changes, so a part hidden here would reappear the moment it was chased, " +
      "frightened or eaten.",
  },
];

function builderMatches(rule: Rule, builderName: string): boolean {
  if (rule.builders === null) {
    return (ENEMY_BUILDERS as readonly string[]).includes(builderName);
  }
  return rule.builders.includes(builderName);
}

function nameMatches(rule: Rule, varName: string): boolean {
  return typeof rule.match === "function" ? rule.match(varName) : rule.match.includes(varName);
}

/**
 * What overwrites `varName`'s `channel` at runtime, or null when the builder
 * genuinely owns it and an edit will stick.
 */
export function runtimeOwnerFor(
  builderName: string,
  varName: string,
  channel: Channel,
): RuntimeOwnership | null {
  for (const rule of RULES) {
    if (!builderMatches(rule, builderName)) continue;
    if (!rule.channels.includes(channel)) continue;
    if (!nameMatches(rule, varName)) continue;
    return { reason: rule.reason, owner: rule.owner };
  }
  return null;
}

/** Every channel of `varName` the runtime owns — for annotating the inspector
 *  in one pass instead of querying channel by channel. */
export function runtimeOwnedChannels(builderName: string, varName: string): Channel[] {
  const all: Channel[] = ["position", "rotation", "scale", "visible", "color", "roughness"];
  return all.filter((c) => runtimeOwnerFor(builderName, varName, c) !== null);
}

/** The one-line note the inspector shows next to a control it cannot honour. */
export function shortNote(ownership: RuntimeOwnership): string {
  return ownership.owner ? `driven at runtime · lives in ${ownership.owner}` : "driven at runtime";
}
