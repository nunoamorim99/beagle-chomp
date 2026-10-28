import * as THREE from "three";
import { regroupTriangles } from "./geometryGroups";

/**
 * Every tentacle of the kraken as ONE SkinnedMesh.
 *
 * The reference builds each tentacle as its own skinned mesh on an ~11-joint
 * chain. Five meshes with two colour regions each would be ten draw calls for
 * one piece of scenery, so here every chain lives in one skeleton: each
 * tentacle is an ANCHOR bone (where it breaks the surface, and which way it
 * faces) carrying a chain of `bones` joints. Two draw calls for the lot —
 * the orange back and the pale suckered belly.
 *
 * Convention per chain, as in the reference: it grows along the anchor's local
 * +Y, and a positive curl bends it toward local +Z — the belly side, so aiming
 * an anchor's +Z at the boat is what makes a tentacle hook OVER it.
 */
export interface TentacleShape {
  length: number;
  baseRadius: number;
}

export interface TentacleBuildOptions {
  tipRadius?: number;
  bones?: number;
  radialSegments?: number;
}

export class KrakenTentacles {
  readonly mesh: THREE.SkinnedMesh;
  /** One per tentacle: position and yaw it in the kraken's local space. */
  readonly anchors: THREE.Bone[] = [];
  /** The joints of each tentacle, root first. */
  readonly chains: THREE.Bone[][] = [];
  readonly lengths: number[] = [];

  constructor(
    shapes: TentacleShape[],
    materials: [top: THREE.Material, belly: THREE.Material],
    o: TentacleBuildOptions = {},
  ) {
    const tip = o.tipRadius ?? 0.025;
    const nBones = o.bones ?? 12;
    const radial = o.radialSegments ?? 14;

    const positions: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    const belly: number[] = [];
    const index: number[] = [];
    const allBones: THREE.Bone[] = [];

    for (const shape of shapes) {
      const L = shape.length;
      const base = shape.baseRadius;
      const segLen = L / (nBones - 1);
      const geo = new THREE.CylinderGeometry(tip, base, L, radial, (nBones - 1) * 4, false);
      geo.translate(0, L / 2, 0);

      const anchor = new THREE.Bone();
      anchor.name = `krakenAnchor${this.anchors.length}`;
      const anchorIdx = allBones.length;
      allBones.push(anchor);
      const chain: THREE.Bone[] = [];
      for (let i = 0; i < nBones; i++) {
        const bone = new THREE.Bone();
        bone.position.y = i === 0 ? 0 : segLen;
        (i === 0 ? anchor : chain[i - 1]).add(bone);
        chain.push(bone);
        allBones.push(bone);
      }

      const vOffset = positions.length / 3;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const u = THREE.MathUtils.clamp(y / L, 0, 1);
        const r = Math.hypot(x, z);
        // 1 on the +Z side, the inside of the curl.
        const b01 = r > 1e-5 ? Math.max(0, z / r) : 0;
        let k = 1;
        if (r > 1e-5) {
          // A fat root and a long thin tip, rather than the cylinder's straight
          // taper, plus a small swelling right at the waterline.
          const linear = base + (tip - base) * u;
          let profile = tip + (base - tip) * Math.pow(1 - u, 0.85);
          profile *= 1 + 0.18 * Math.exp(-u * 18);
          // Sucker bumps, belly side only.
          if (u > 0.06 && u < 0.92) {
            const ring = Math.pow(Math.max(0, Math.sin(u * L * 9 * Math.PI)), 4);
            profile *= 1 + 0.16 * ring * THREE.MathUtils.smoothstep(b01, 0.55, 0.95);
          }
          k = profile / linear;
        }
        positions.push(x * k, y, z * k);
        belly.push(b01);
        // Linear skinning between the two nearest joints of THIS chain.
        const f = y / segLen;
        const b0 = Math.min(nBones - 2, Math.max(0, Math.floor(f)));
        const w = THREE.MathUtils.clamp(f - b0, 0, 1);
        const j0 = anchorIdx + 1 + b0;
        skinIndex.push(j0, j0 + 1, 0, 0);
        skinWeight.push(1 - w, w, 0, 0);
      }
      const idx = geo.getIndex()!;
      for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + vOffset);
      geo.dispose();

      this.anchors.push(anchor);
      this.chains.push(chain);
      this.lengths.push(L);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    geo.setIndex(index);
    // The reference blends top into belly through a smoothstep on the vertex
    // colour; as material groups the boundary is per triangle, and at the
    // board's ~20px a tentacle that is invisible.
    regroupTriangles(geo, 2, (a, b, c) => ((belly[a] + belly[b] + belly[c]) / 3 > 0.47 ? 1 : 0));
    geo.computeVertexNormals();

    this.mesh = new THREE.SkinnedMesh(geo, materials);
    this.mesh.name = "krakenTentacles";
    for (const a of this.anchors) this.mesh.add(a);
    // Bind at REST — every anchor at the origin, every chain straight — so the
    // inverse bind matrices are computed against the geometry as built.
    this.mesh.bind(new THREE.Skeleton(allBones));
    // The bounds move every frame; the box is a few units of sea.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /**
   * Pose tentacle `k`. `fn(u, i)` returns `[curl, sway]` in radians for joint
   * i, where u in [0, 1] is how far along the tentacle the joint sits.
   */
  pose(k: number, fn: (u: number, i: number) => [number, number]): void {
    const chain = this.chains[k];
    const n = chain.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = fn(i / (n - 1), i);
      chain[i].rotation.set(ax, 0, az);
    }
  }

  /** A tentacle that is off is collapsed onto its anchor, not hidden: one mesh
   *  draws all of them. */
  setActive(k: number, on: boolean): void {
    this.anchors[k].scale.setScalar(on ? 1 : 1e-4);
  }

  /** Frees the geometry and the bone texture. The materials are the caller's. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
  }
}
