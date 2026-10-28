import * as THREE from "three";

/**
 * Pooled cartoon water: expanding foam rings and ballistic droplets.
 *
 * UNLIT ON PURPOSE (`MeshBasicMaterial`), the same exception as the eye glint
 * and for a reason of its own: the sea under it is an unlit ShaderMaterial
 * (seaside.ts), so foam lit by the key light would sit on the water at a
 * different brightness from the water it is made of. Both looks pass a Basic
 * material by, so foam is the same white in classic and in the shipped style.
 *
 * The pools are small because a draw call is spent per LIVE ring; the busiest
 * moment of the act — the sinking — has five or six at once.
 */
interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  size: number;
}
interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  s: number;
}

const GRAVITY = 9.8;

export class SplashFx extends THREE.Group {
  private rings: Ring[] = [];
  private drops: Drop[] = [];
  private dropMesh: THREE.InstancedMesh;
  private ringGeo = new THREE.RingGeometry(0.78, 1, 40, 1);
  private dummy = new THREE.Object3D();
  private nextDrop = 0;
  private nextRing = 0;

  constructor(
    public seaLevel = 0,
    color: THREE.ColorRepresentation = 0xffffff,
    maxRings = 10,
    maxDrops = 120,
  ) {
    super();
    this.name = "krakenSplash";
    this.ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < maxRings; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.name = "foamRing";
      mesh.visible = false;
      // After the sea's shore ribbon, which is the other transparent thing here.
      mesh.renderOrder = 2;
      this.add(mesh);
      this.rings.push({ mesh, mat, life: 0, max: 1, size: 1 });
    }
    this.dropMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.06, 1),
      new THREE.MeshBasicMaterial({ color }),
      maxDrops,
    );
    this.dropMesh.name = "spray";
    this.dropMesh.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < maxDrops; i++) {
      this.drops.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, s: 1 });
      this.dropMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.add(this.dropMesh);
    this.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /** A foam ring on the water at local `pos`. */
  ring(pos: THREE.Vector3, size = 1, duration = 1.1): void {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.life = duration;
    r.max = duration;
    r.size = size;
    r.mesh.position.set(pos.x, this.seaLevel + 0.02, pos.z);
    r.mesh.scale.set(0.0001, 1, 0.0001);
    r.mesh.visible = true;
  }

  /** A big splash: two rings and a crown of droplets. */
  burst(pos: THREE.Vector3, strength = 1): void {
    this.ring(pos, 0.9 * strength, 0.9);
    this.ring(pos, 1.5 * strength, 1.4);
    const n = Math.round(14 * strength);
    for (let i = 0; i < n; i++) {
      const d = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % this.drops.length;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.8 + Math.random() * 1.6) * strength;
      d.p.set(pos.x + Math.cos(a) * 0.25 * strength, this.seaLevel, pos.z + Math.sin(a) * 0.25 * strength);
      d.v.set(Math.cos(a) * sp, (3 + Math.random() * 2.5) * Math.sqrt(strength), Math.sin(a) * sp);
      d.max = d.life = 1.4;
      d.s = (0.6 + Math.random() * 0.9) * Math.sqrt(strength);
    }
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      const s = r.size * (0.25 + (1 - Math.pow(1 - t, 3)));
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = 0.9 * (1 - t);
      if (r.life <= 0) r.mesh.visible = false;
    }
    let any = false;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.life <= 0) continue;
      any = true;
      d.life -= dt;
      d.v.y -= GRAVITY * dt;
      d.p.addScaledVector(d.v, dt);
      const alive = d.life > 0 && !(d.p.y < this.seaLevel && d.v.y < 0);
      if (!alive) d.life = 0;
      this.dummy.position.copy(d.p);
      this.dummy.scale.setScalar(alive ? d.s * (0.4 + 0.6 * (d.life / d.max)) : 0);
      this.dummy.updateMatrix();
      this.dropMesh.setMatrixAt(i, this.dummy.matrix);
    }
    // Only upload when something is in the air.
    if (any) this.dropMesh.instanceMatrix.needsUpdate = true;
  }

  /** Clears everything in flight — a scrub or a restart must not leave spray. */
  reset(): void {
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.drops.length; i++) {
      this.drops[i].life = 0;
      this.dropMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.removeFromParent();
    this.ringGeo.dispose();
    for (const r of this.rings) r.mat.dispose();
    this.dropMesh.geometry.dispose();
    (this.dropMesh.material as THREE.Material).dispose();
    this.dropMesh.dispose();
  }
}
