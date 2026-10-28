import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { collapseByMaterial, splitByGroup } from "../propMerge";
import { addBackFaces, regroupTriangles } from "./geometryGroups";

/**
 * The little sailboat the kraken takes. Built from deformed primitives, no
 * assets. Bow along local +Z, waterline at y = 0, about 2 units long.
 *
 * Everything that does not move relative to the hull is COLLAPSED to one mesh
 * per material (`collapseByMaterial`), because this is one object on a board
 * that counts draw calls; only the sail and the flag stay separate, since they
 * are re-shaped on the CPU every frame.
 */
export interface BoatMaterials {
  /** Below the waterline band: a declared INK, so the style keeps it dark. */
  hullDark: THREE.Material;
  hull: THREE.Material;
  /** The cream gunwale stripe, the cabin, the masthead knob and the sail. */
  cream: THREE.Material;
  deck: THREE.Material;
  spar: THREE.Material;
  roof: THREE.Material;
  sailStripe: THREE.Material;
  /** Windows and the flag. */
  ink: THREE.Material;
}

const ss = THREE.MathUtils.smoothstep;

// The sail and flag frame, shared by the builder and the per-frame cloth.
const MAST_Z = 0.22;
const MAST_H = 1.55;
const SAIL_W = 0.88;
const SAIL_H = 1.05;
const SAIL_Y0 = 0.48;
const FLAG_W = 0.36;

/** A plain part: uv dropped so every body part carries the same attributes
 *  into the collapse. */
function part(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  geo.deleteAttribute("uv");
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

export class CartoonBoat extends THREE.Group {
  private sail: THREE.Mesh;
  private sailBase: Float32Array;
  private flag: THREE.Mesh;
  private flagBase: Float32Array;

  constructor(M: BoatMaterials) {
    super();
    this.name = "krakenBoat";
    const body = new THREE.Group();
    body.name = "krakenBoatBody";

    // ---------- Hull ----------
    // Four bands, carried through the deformation as a per-vertex class so
    // they come out as material groups: 0 deck, 1 stripe, 2 hull, 3 dark.
    const W = 0.95;
    const H = 0.5;
    const LZ = 2.0;
    let hull: THREE.BufferGeometry = new THREE.BoxGeometry(W, H, LZ, 6, 10, 16);
    {
      const pos = hull.attributes.position as THREE.BufferAttribute;
      const nrm = hull.attributes.normal as THREE.BufferAttribute;
      const band = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const yn = (pos.getY(i) + H / 2) / H;
        band[i] = nrm.getY(i) > 0.5 ? 0 : yn > 0.8 ? 1 : yn < 0.3 ? 3 : 2;
      }
      hull.setAttribute("band", new THREE.BufferAttribute(band, 1));
      hull.deleteAttribute("normal");
      hull.deleteAttribute("uv");
      // Welds the side faces into one surface while keeping the deck's own
      // vertices apart (they differ in `band`), so the deck can drop below the
      // gunwale without tearing the sides.
      hull = mergeVertices(hull);

      const p = hull.attributes.position as THREE.BufferAttribute;
      const b = hull.attributes.band as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const xn = x / (W / 2);
        const yn = (y + H / 2) / H;
        const zn = z / (LZ / 2);
        const bow = 1 - Math.pow(ss(zn, 0.05, 1), 1.35) * 0.96;
        const stern = 1 - ss(-zn, 0.55, 1) * 0.22;
        const belly = 0.4 + 0.6 * Math.pow(yn, 0.65);
        let nx = x * bow * stern * belly;
        let ny =
          y +
          yn * 0.2 * ss(zn, 0.25, 1) +
          yn * 0.07 * ss(-zn, 0.5, 1) +
          (1 - yn) * 0.22 * ss(zn, 0.35, 1);
        // A sunken deck inside a little gunwale lip.
        if (b.getX(i) === 0 && Math.abs(xn) < 0.99 && Math.abs(zn) < 0.99) {
          ny -= 0.1;
          nx *= 0.92;
        }
        p.setXYZ(i, nx, ny - 0.05, z);
      }
      // A triangle takes the band two of its corners agree on.
      regroupTriangles(hull, 4, (i0, i1, i2) => {
        const a = b.getX(i0);
        const c = b.getX(i1);
        const d = b.getX(i2);
        return a === c || a === d ? a : c === d ? c : Math.min(a, c, d);
      });
      hull.deleteAttribute("band");
      hull.computeVertexNormals();
    }
    const bandMats = [M.deck, M.cream, M.hull, M.hullDark];
    const bandNames = ["deck", "hullStripe", "hull", "hullKeel"];
    splitByGroup(hull).forEach((g, k) => {
      if (g) body.add(part(g, bandMats[k], bandNames[k]));
    });
    hull.dispose();

    // ---------- Cabin ----------
    const cabin = part(new THREE.BoxGeometry(0.5, 0.28, 0.45), M.cream, "cabin");
    cabin.position.set(0, 0.28, -0.5);
    const roof = part(new THREE.BoxGeometry(0.6, 0.07, 0.55), M.roof, "cabinRoof");
    roof.position.set(0, 0.45, -0.5);
    body.add(cabin, roof);
    for (const sx of [-1, 1]) {
      // A shallow cylinder rather than the reference's flat circle: a flat
      // disc is one-sided, and the shipped style does not keep `DoubleSide`.
      const win = part(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14), M.ink, sx < 0 ? "windowL" : "windowR");
      win.rotation.z = Math.PI / 2;
      win.position.set(sx * 0.25, 0.3, -0.5);
      body.add(win);
    }

    // ---------- Mast, boom, masthead ----------
    const mast = part(new THREE.CylinderGeometry(0.035, 0.045, MAST_H, 8), M.spar, "mast");
    mast.position.set(0, 0.12 + MAST_H / 2, MAST_Z);
    const boom = part(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8), M.spar, "boom");
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.42, MAST_Z - 0.45);
    const knob = part(new THREE.SphereGeometry(0.055, 12, 8), M.cream, "masthead");
    knob.position.set(0, 0.12 + MAST_H + 0.02, MAST_Z);
    body.add(mast, boom, knob);

    collapseByMaterial(body);
    this.add(body);

    // ---------- Sail: CPU-billowed cloth ----------
    const sailGeo = new THREE.PlaneGeometry(SAIL_W, SAIL_H, 10, 12);
    sailGeo.deleteAttribute("uv");
    sailGeo.rotateY(Math.PI / 2);
    sailGeo.translate(0, SAIL_Y0 + SAIL_H / 2, MAST_Z - SAIL_W / 2 - 0.04);
    addBackFaces(sailGeo);
    {
      const p = sailGeo.attributes.position as THREE.BufferAttribute;
      const band = (i: number): boolean => {
        const v = (p.getY(i) - SAIL_Y0) / SAIL_H;
        return v > 0.38 && v < 0.6;
      };
      // A stripe across the middle of the sail, by triangle majority.
      regroupTriangles(sailGeo, 2, (a, b, c) => (Number(band(a)) + Number(band(b)) + Number(band(c)) >= 2 ? 1 : 0));
    }
    sailGeo.computeVertexNormals();
    this.sail = new THREE.Mesh(sailGeo, [M.cream, M.sailStripe]);
    this.sail.name = "sail";
    this.sailBase = (sailGeo.attributes.position.array as Float32Array).slice();
    this.add(this.sail);

    // ---------- Flag: CPU wave ----------
    const flagGeo = new THREE.PlaneGeometry(FLAG_W, 0.2, 12, 3);
    flagGeo.deleteAttribute("uv");
    flagGeo.rotateY(Math.PI / 2);
    flagGeo.translate(0, 0.12 + MAST_H - 0.12, MAST_Z - FLAG_W / 2 - 0.03);
    addBackFaces(flagGeo);
    flagGeo.computeVertexNormals();
    this.flag = new THREE.Mesh(flagGeo, M.ink);
    this.flag.name = "flag";
    this.flagBase = (flagGeo.attributes.position.array as Float32Array).slice();
    this.add(this.flag);

    this.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /** Animate the cloth. `wind` 0..1 scales the billow and the flutter. */
  update(time: number, wind = 1): void {
    // The sail is held at the mast (its +Z edge) and the boom (its foot), and
    // bellies out sideways between them.
    const sp = this.sail.geometry.attributes.position as THREE.BufferAttribute;
    const sb = this.sailBase;
    const luff = MAST_Z - 0.04;
    const billow = (0.12 + 0.03 * Math.sin(time * 2.7)) * wind + 0.03;
    for (let i = 0; i < sp.count; i++) {
      const z = sb[i * 3 + 2];
      const y = sb[i * 3 + 1];
      const u = THREE.MathUtils.clamp((luff - z) / SAIL_W, 0, 1);
      const v = THREE.MathUtils.clamp((y - SAIL_Y0) / SAIL_H, 0, 1);
      sp.setX(i, Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.1)) * billow);
    }
    sp.needsUpdate = true;
    this.sail.geometry.computeVertexNormals();

    const fp = this.flag.geometry.attributes.position as THREE.BufferAttribute;
    const fb = this.flagBase;
    for (let i = 0; i < fp.count; i++) {
      const d = MAST_Z - 0.03 - fb[i * 3 + 2]; // distance from the mast
      fp.setX(i, Math.sin(d * 16 - time * 10) * 0.045 * (d / FLAG_W) * (0.4 + wind * 0.6));
    }
    fp.needsUpdate = true;
    this.flag.geometry.computeVertexNormals();
  }

  /** Frees every geometry. The materials are the caller's. */
  dispose(): void {
    this.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
