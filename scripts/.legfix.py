import io

P = "src/render/characters.ts"
s = io.open(P, encoding="utf-8").read()

# --- 1. the sign bug, named so it cannot come back -------------------------
old = """  const makeLeg = (tag: string, s: number, z: number, yaw: number): THREE.Group => {"""
new = """  /**
   * One leg. `fanForward` is POSITIVE toward the front of the bug — front pair
   * positive, middle zero, rear pair negative.
   *
   * The sign matters and used to be wrong. `rotation.y` is applied after
   * `rotation.z` (Euler XYZ), and the leg's outward axis has a POSITIVE x
   * component, so a positive yaw swings it toward NEGATIVE z — backwards. The
   * old code passed the fan straight through as `yaw * s`, which aimed the
   * front legs behind the bug and the rear legs in front of it.
   */
  const makeLeg = (tag: string, s: number, z: number, fanForward: number): THREE.Group => {"""
assert old in s
s = s.replace(old, new, 1)

old = "    root.rotation.y = yaw * s;"
new = "    root.rotation.y = -fanForward * s;"
assert old in s
s = s.replace(old, new, 1)

# --- 2. bake the hand-tuned fans in, symmetrised ---------------------------
old = """  const legFL = makeLeg("F", -1, -0.02, 0.55);
  g.add(legFL);
  legFL.rotation.set(0, 0.597, 2.191);
  const legFR = makeLeg("F", 1, -0.02, 0.55);
  g.add(legFR);
  legFR.rotation.set(0, -0.591, -2.191);
  const legML = makeLeg("M", -1, -0.15, 0);
  g.add(legML);
  const legMR = makeLeg("M", 1, -0.15, 0);
  g.add(legMR);
  const legBL = makeLeg("B", -1, -0.28, -0.5);
  g.add(legBL);
  legBL.rotation.set(0, -0.352, 2.369);
  const legBR = makeLeg("B", 1, -0.28, -0.5);
  g.add(legBR);
  legBR.rotation.set(0, 0.302, -2.191);"""
new = """  // Front pair fans FORWARD, rear pair BACKWARD, middle straight out to the
  // side — which is both what the reference sheet asks for and what makes the
  // alternating tripod read, since the middle leg is the pivot the other two
  // swing around. The two fan values are the hand-tuned ones from the editor,
  // averaged across each pair: they came out 0.006 apart at the front and 0.05
  // apart at the rear, which is nudge drift rather than intent.
  const FAN_FRONT = 0.594;
  const FAN_REAR = -0.327;
  const legFL = makeLeg("F", -1, -0.02, FAN_FRONT);
  g.add(legFL);
  const legFR = makeLeg("F", 1, -0.02, FAN_FRONT);
  g.add(legFR);
  const legML = makeLeg("M", -1, -0.15, 0);
  g.add(legML);
  const legMR = makeLeg("M", 1, -0.15, 0);
  g.add(legMR);
  const legBL = makeLeg("B", -1, -0.28, FAN_REAR);
  g.add(legBL);
  const legBR = makeLeg("B", 1, -0.28, FAN_REAR);
  g.add(legBR);"""
assert old in s, "leg call block not found"
s = s.replace(old, new, 1)

# --- 3. the antennae: bake the tuned height, drop the overrides ------------
old = "    pivot.position.set(0.055 * s, HEAD_POS.y + HEAD_R * 0.62, HEAD_POS.z + HEAD_R * 0.5);"
new = "    pivot.position.set(0.055 * s, HEAD_POS.y + HEAD_R * 0.543, HEAD_POS.z + HEAD_R * 0.5);"
assert old in s
s = s.replace(old, new, 1)

for line in (
    "  antennaPivotL.position.set(-0.055, 0.384, 0.303);\n",
    "  antennaPivotR.position.set(0.055, 0.384, 0.303);\n",
):
    assert line in s, line
    s = s.replace(line, "", 1)

io.open(P, "w", encoding="utf-8").write(s)
print("fan sign fixed, values baked in, overrides removed")
