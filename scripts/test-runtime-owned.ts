// Headless checks for src/editor/runtimeOwned.ts (IDEA-041) — the registry of
// part/property pairs the RUNTIME overwrites, so the editor can refuse them
// with a real reason instead of accepting an edit that can never stick.
//
// Crucially these also assert against the REAL src/render/characters.ts: every
// part the registry claims is runtime-driven must still be written by the
// animation code, and every animated write must still be covered. If someone
// renames a part or stops animating it, this suite says so — otherwise the
// registry would quietly start lying, which is the exact failure it exists to
// prevent. Run: tsx scripts/test-runtime-owned.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runtimeOwnerFor,
  runtimeOwnedChannels,
  shortNote,
  ENEMY_BUILDERS,
  BEAGLE_BUILDER,
} from "../src/editor/runtimeOwned";

const SRC = readFileSync(resolve("src/render/characters.ts"), "utf-8");

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

console.log("\n--- the beagle's animated joints are claimed ---");
{
  for (const part of ["tail", "earL", "earR", "jaw", "legFL", "legFR", "legBL", "legBR"]) {
    const owned = runtimeOwnerFor(BEAGLE_BUILDER, part, "rotation");
    check(`${part}.rotation is runtime-owned`, owned !== null);
    check(`${part}'s reason names the animator`, !!owned && /animateBeagleParts/.test(owned.reason));
    check(`${part} points at a real owner`, !!owned?.owner);
  }
}

console.log("\n--- …but their other channels are still editable ---");
{
  // Only ROTATION is animated on these joints — position/scale are authored,
  // so the editor must keep letting you change them.
  for (const part of ["tail", "earL", "jaw", "legFL"]) {
    check(`${part}.position stays editable`, runtimeOwnerFor(BEAGLE_BUILDER, part, "position") === null);
    check(`${part}.scale stays editable`, runtimeOwnerFor(BEAGLE_BUILDER, part, "scale") === null);
  }
  check("a plain part is fully editable", runtimeOwnedChannels(BEAGLE_BUILDER, "body").length === 0);
  check("the muzzle is fully editable", runtimeOwnedChannels(BEAGLE_BUILDER, "haunch").length === 0);
}

console.log("\n--- coat colour belongs to the skin ---");
{
  for (const mat of ["tan", "white", "black", "earMat"]) {
    const owned = runtimeOwnerFor(BEAGLE_BUILDER, mat, "color");
    check(`${mat}.color is runtime-owned`, owned !== null);
    check(`${mat} points at cosmetics.ts`, !!owned && /cosmetics\.ts/.test(owned.owner ?? ""));
  }
  check(
    "roughness is NOT claimed — the builder really owns it",
    runtimeOwnerFor(BEAGLE_BUILDER, "tan", "roughness") === null,
  );
}

console.log("\n--- enemies: hem wobble, pupils, state colours ---");
{
  for (const builder of ENEMY_BUILDERS) {
    // The hem wobble and skirt breathe are RELATIVE to the authored rest pose
    // now, so an edit to them survives — they must NOT be locked.
    check(
      `${builder}: hem0.position stays editable (the wobble is relative)`,
      runtimeOwnerFor(builder, "hem0", "position") === null,
    );
    check(
      `${builder}: hem3.scale stays editable`,
      runtimeOwnerFor(builder, "hem3", "scale") === null,
    );
    check(
      `${builder}: skirt.scale stays editable`,
      runtimeOwnerFor(builder, "skirt", "scale") === null,
    );
    // Every enemy now carries flush decal-cap eyes on a dart pivot, so the
    // runtime drives the PIVOT's rotation and no longer any pupil position.
    check(
      `${builder}: the pupil PIVOT's rotation is runtime-owned`,
      runtimeOwnerFor(builder, "pupilPivotL", "rotation") !== null,
    );
    check(
      `${builder}: …and names PUPIL_SWEEP as the owner`,
      /PUPIL_SWEEP/.test(runtimeOwnerFor(builder, "pupilPivotR", "rotation")?.owner ?? ""),
    );
    check(
      `${builder}: pupil position is NOT claimed (it is a cap, not a ball)`,
      runtimeOwnerFor(builder, "pupilL", "position") === null,
    );
    check(`${builder}: bodyMat.color is runtime-owned`, runtimeOwnerFor(builder, "bodyMat", "color") !== null);
    check(
      `${builder}: skirt.position stays editable`,
      runtimeOwnerFor(builder, "skirt", "position") === null,
    );
  }
  check(
    "the beagle is not subject to the enemy rules",
    runtimeOwnerFor(BEAGLE_BUILDER, "hem0", "position") === null &&
      runtimeOwnerFor(BEAGLE_BUILDER, "bodyMat", "color") === null,
  );
}

console.log("\n--- the registry agrees with the REAL animation code ---");
{
  // Every claim below must still be true of characters.ts, or the registry is
  // lying to the user.
  check(
    "animateBeagleParts still writes tail.rotation.y",
    /parts\.tail\.rotation\.y\s*=/.test(SRC),
  );
  check(
    "…and both ears' rotation.x",
    /parts\.earL\.rotation\.x\s*=/.test(SRC) && /parts\.earR\.rotation\.x\s*=/.test(SRC),
  );
  check(
    "…and all four legs' rotation.x",
    [0, 1, 2, 3].every((i) => new RegExp(`parts\\.legs\\[${i}\\]\\.rotation\\.x\\s*=`).test(SRC)),
  );
  check("…and the jaw's rotation.x", /parts\.jaw\.rotation\.x\s*=/.test(SRC));
  // The wobble must stay RELATIVE. If someone reverts it to absolute values,
  // the bee's stripes and the ladybug's spots fall onto the floor again — a bug
  // that shipped once and is invisible in the editor, so it needs a test.
  check(
    "the hem wobble is relative to the authored rest pose",
    /hem\[i\]\.position\.y = rest\.y \+ wave/.test(SRC),
  );
  check("…and hem scale is relative", /hem\[i\]\.scale\.set\(rest\.sx \*/.test(SRC));
  check("…and the skirt breathe is relative", /skirt\.scale\.set\(rest\.sx \* breathe/.test(SRC));
  check(
    "no absolute hem height survives",
    !/hem\[i\]\.position\.y = 0\.02 \+/.test(SRC),
  );
  check("applyBeagleSkin still resets all 4 coat colours", (SRC.match(/mats\.\w+\.color\.setHex/g) ?? []).length === 4);
  check("applyGhostState still recolours bodyMat", /ud\.bodyMat\.color\.setHex/.test(SRC));
  check(
    "…and ROTATES every enemy's pupil pivots",
    /pivot\.rotation\.y\s*=\s*ud\.pupOffset\.x\s*\*\s*PUPIL_SWEEP/.test(SRC),
  );
  check(
    "no ball-pupil translation survives anywhere",
    !/p\.position\.z\s*=\s*0\.27/.test(SRC),
  );
  // EVERY character now builds its own eyes. The shared addPaintedEyes helper
  // has been fully superseded and removed — which is the EnemyBehaviour seam
  // working as intended: the shared layer holds what is genuinely common and
  // nothing else. What all four still share is the dart PIVOT and its name,
  // which is why one registry rule covers every enemy.
  check(
    "the superseded shared eye helper is gone",
    !/addPaintedEyes/.test(SRC),
  );
  // One site per enemy now: addPaintedEyes for the ghost, and one each in the
  // beetle, bee and ladybug.
  check(
    "every enemy still names its dart pivot pupilPivotL/R",
    (SRC.match(/"pupilPivotL" : "pupilPivotR"/g) ?? []).length === 4,
  );
  check("PUPIL_SWEEP still exists", /const PUPIL_SWEEP\s*=/.test(SRC));
  check(
    "the shared helper still names its pivots pupilPivotL/R",
    /pivot\.name = s < 0 \? "pupilPivotL" : "pupilPivotR"/.test(SRC),
  );
  // The eaten look no longer hides anything — it turns the body into a
  // translucent spirit and leaves the eyes solid, so an eaten enemy running for
  // the pen keeps a silhouette a player can follow.
  check("eaten dims the body to a spirit rather than hiding it", /const EATEN_OPACITY\s*=/.test(SRC));
  check(
    "…and nothing hides the children any more",
    !/mesh\.children\.forEach\(\(o\) => \{ o\.visible = false; \}\)/.test(SRC),
  );
  check(
    "…and the spirit stops casting a shadow",
    /if \(o instanceof THREE\.Mesh\) o\.castShadow = false;/.test(SRC),
  );
  // Toggling Material.transparent invalidates the shader program, so the look
  // MUST only be applied on a state transition — never every frame.
  check(
    "the look is gated on a state transition",
    /if \(clock\.look !== kind\)/.test(SRC),
  );

  // The leg pivots really are named legFL/legFR/legBL/legBR.
  check("leg pivots are still named leg<F|B><L|R>", /const legName = `leg\$\{dz < 0 \? "F" : "B"\}\$\{s < 0 \? "L" : "R"\}`/.test(SRC));
  // The hem pieces really are named hem<N> in all four enemy builders.
  // NO character populates `hem` any more, and none has hem meshes at all. The
  // ghost's scallops became the undulating bottom EDGE of its own body — see
  // wavyLathe — so the shared animateGhostHem now only ever breathes a skirt.
  check("no builder creates hem meshes any more", !/\.name = `hem\$\{/.test(SRC));
  check("the ghost's hem is generated geometry now", /wavyLathe\(/.test(SRC));
  check(
    "…and its bottom edge genuinely undulates",
    /amp \* dip \* p\.w/.test(SRC),
  );
}

console.log("\n--- presentation ---");
{
  const owned = runtimeOwnerFor(BEAGLE_BUILDER, "tail", "rotation");
  check("shortNote mentions where it lives", !!owned && /lives in/.test(shortNote(owned)));
  const noOwner = runtimeOwnerFor(ENEMY_BUILDERS[0], "eyeL", "visible");
  check("a rule without an owner still yields a note", !!noOwner && shortNote(noOwner).length > 0);
  check("an unknown part is unclaimed", runtimeOwnerFor(BEAGLE_BUILDER, "notAPart", "rotation") === null);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
if (failures > 0) process.exit(1);
