import io

P = "src/render/characters.ts"
s = io.open(P, encoding="utf-8").read()

# =============================================================== 1 + 2 + 3
# Abdomen: TWO rounded segments instead of three long ones, and the bands go
# from raised torus rings to broad FLAT decals lying on the surface.
OLD_ABD = """  // --- abdomen: a 3-link chain, so the trailing mass can whip with lag ------
  const ABD_LEN = W * 1.15;
  const SEG = ABD_LEN / 3;
  const abdomenJoints: THREE.Object3D[] = [];

  const abdomenRoot = new THREE.Group();
  abdomenRoot.name = "abdomenRoot";
  abdomenRoot.position.copy(THORAX_POS);
  abdomenRoot.rotation.x = AXIS; // tips the chain back and down
  hover.add(abdomenRoot);
  abdomenJoints.push(abdomenRoot);

  // Widest about a third of the way back, then tapering to a soft point — and
  // a gentle banana curve rather than a straight cone, which is what the joint
  // rotations below are for.
  const SEG_R = [W * 0.35, W * 0.315, W * 0.21];
  const SEG_CURVE = [0, -0.16, -0.2]; // down-then-up
  let link: THREE.Object3D = abdomenRoot;

  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      const joint = new THREE.Group();
      joint.name = `abdomenJoint${i}`;
      joint.position.z = -SEG;
      joint.rotation.x = SEG_CURVE[i];
      link.add(joint);
      abdomenJoints.push(joint);
      link = joint;
    }
    const seg = new THREE.Mesh(new THREE.SphereGeometry(SEG_R[i], 20, 14), bodyMat);
    seg.name = `abdomen${i}`;
    seg.scale.set(1, 0.95, (SEG / SEG_R[i]) * 0.94); // overlap the neighbour
    seg.position.z = -SEG * 0.5;
    link.add(seg);

    // A full dark ring at the FRONT of each segment: collar, then the two band
    // boundaries. They narrow as the abdomen tapers, because each ring is sized
    // off its own segment.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(SEG_R[i] * 0.95, SEG_R[i] * 0.115, 8, 22),
      darkMat,
    );
    ring.name = `abdomenBand${i}`;
    ring.scale.set(1, 0.95, 0.6);
    ring.position.z = -SEG * 0.08;
    link.add(ring);
  }

  // Sting: blunt, as wide at its base as the abdomen's tip, so it continues the
  // form instead of looking like a spike stuck on. Cute, not threatening.
  const sting = new THREE.Mesh(new THREE.ConeGeometry(SEG_R[2] * 0.5, W * 0.1, 10), darkMat);
  sting.name = "sting";
  sting.position.z = -SEG * 1.02;
  sting.rotation.x = -Math.PI / 2 - 0.25; // points back, slightly upturned
  link.add(sting);"""

NEW_ABD = """  // --- abdomen: TWO rounded segments on a 2-link chain ---------------------
  // Three long segments read as a mosquito, not a bee. Two near-spherical ones
  // give the short, fat, bumbly abdomen the silhouette wants, and the chain
  // still lets the trailing mass swing with lag.
  const SEG_R = [W * 0.37, W * 0.3];
  const abdomenJoints: THREE.Object3D[] = [];

  const abdomenRoot = new THREE.Group();
  abdomenRoot.name = "abdomenRoot";
  abdomenRoot.position.copy(THORAX_POS);
  abdomenRoot.rotation.x = AXIS; // tips the chain back and down
  hover.add(abdomenRoot);
  abdomenJoints.push(abdomenRoot);

  /**
   * A broad FLAT band lying on a segment, rather than a torus ring standing
   * proud of it. Same flush-decal idea used everywhere else in this file — a
   * theta slice of a very slightly larger sphere — with one twist: the slice is
   * rotated so its pole points along the chain (+Z) instead of up (+Y), which
   * is what makes the band wrap the segment's waist rather than its equator.
   */
  const abdomenBand = (r: number, thetaStart: number, thetaLen: number): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(r * 1.012, 26, 16, 0, Math.PI * 2, thetaStart, thetaLen);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, darkMat);
  };

  let link: THREE.Object3D = abdomenRoot;
  for (let i = 0; i < 2; i++) {
    if (i > 0) {
      const joint = new THREE.Group();
      joint.name = `abdomenJoint${i}`;
      joint.position.z = -(SEG_R[0] + SEG_R[1]) * 0.66; // overlap, no gap
      joint.rotation.x = -0.14; // the gentle down-then-up curve
      link.add(joint);
      abdomenJoints.push(joint);
      link = joint;
    }
    // Near-spherical: the roundness IS the read.
    const seg = new THREE.Mesh(new THREE.SphereGeometry(SEG_R[i], 22, 16), bodyMat);
    seg.name = `abdomen${i}`;
    seg.scale.set(1, 0.96, 1.04);
    link.add(seg);

    // ONE band per segment, sized off its own segment so it narrows with the
    // taper, and wide enough to read as a stripe rather than a wire.
    const stripe = abdomenBand(SEG_R[i], 1.05, 0.72);
    stripe.name = `abdomenBand${i}`;
    stripe.scale.set(1, 0.96, 1.04);
    link.add(stripe);
  }

  // Sting: blunt, as wide at its base as the abdomen's tip, so it continues the
  // form instead of looking like a spike stuck on. Cute, not threatening.
  const sting = new THREE.Mesh(new THREE.ConeGeometry(SEG_R[1] * 0.46, W * 0.1, 10), darkMat);
  sting.name = "sting";
  sting.position.z = -SEG_R[1] * 0.95;
  sting.rotation.x = -Math.PI / 2 - 0.25; // points back, slightly upturned
  link.add(sting);"""
assert OLD_ABD in s, "abdomen block not found"
s = s.replace(OLD_ABD, NEW_ABD, 1)

# ===================================================================== 4
# Wings move back off the head and onto the body.
OLD_MOUNT = """    mount.position.set(0.03 * s, THORAX_POS.y + W * 0.24, THORAX_POS.z + 0.01);"""
NEW_MOUNT = """    // Set BACK over the front of the abdomen rather than tucked behind the
    // head — mounted at the head they crowded the face and read as ears.
    mount.position.set(0.03 * s, THORAX_POS.y + W * 0.1, THORAX_POS.z - W * 0.42);"""
assert OLD_MOUNT in s
s = s.replace(OLD_MOUNT, NEW_MOUNT, 1)

# ===================================================================== 5
# Limbs anchored INSIDE the masses they hang from, so they visibly grow out of
# the body instead of floating near it.
OLD_LIMBS = """    addLimb("limbArm", s, new THREE.Vector3(W * 0.34, HEAD_POS.y - HEAD_R * 0.86, 0.05), W * 0.25, -0.9, -0.85, W * 0.1);
    // Rear legs: dangling from the thorax underside, bent ~100 degrees and
    // trailing slightly back. No weight on them.
    addLimb("limbLeg", s, new THREE.Vector3(W * 0.26, THORAX_POS.y - W * 0.22, -0.06), W * 0.22, -1.0, 0.3, W * 0.085);"""
NEW_LIMBS = """    // Anchors sit INSIDE the mass each limb hangs from — the arm root within
    // the head's lower front, the leg root within the thorax. Previously both
    // sat just outside their sphere, which is why they read as detached blobs
    // floating near the body rather than limbs growing out of it.
    addLimb("limbArm", s, new THREE.Vector3(W * 0.26, HEAD_POS.y - HEAD_R * 0.7, 0.02), W * 0.25, -0.9, -0.85, W * 0.1);
    // Rear legs: dangling from the thorax underside, bent ~100 degrees and
    // trailing slightly back. No weight on them.
    addLimb("limbLeg", s, new THREE.Vector3(W * 0.17, THORAX_POS.y - W * 0.1, -0.075), W * 0.22, -1.0, 0.3, W * 0.085);"""
assert OLD_LIMBS in s
s = s.replace(OLD_LIMBS, NEW_LIMBS, 1)

io.open(P, "w", encoding="utf-8").write(s)
print("abdomen shortened + rounded, bands flattened, wings moved back, limbs connected")
