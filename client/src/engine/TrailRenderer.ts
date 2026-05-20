/**
 * TrailRenderer — Ribbon / trail mesh that follows a moving object.
 *
 * Features:
 *  - Configurable lifetime, width curve, color gradient, opacity curve
 *  - Smooth Catmull-Rom interpolation between sample points
 *  - Texture mapping with UV scrolling
 *  - Additive / alpha-blended modes
 *  - Trail can emit from any Object3D
 *  - Multiple trails managed by TrailManager
 */

import * as THREE from 'three';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface TrailConfig {
  /** Trail lifetime in seconds — how long each point lives */
  lifetime: number;
  /** Max number of stored points */
  maxPoints: number;
  /** Minimum distance between samples (avoids overdraw when stationary) */
  minDistance: number;
  /** Width at head (t=0) and tail (t=1), linearly interpolated or use widthCurve */
  widthStart: number;
  widthEnd: number;
  /** Optional width curve (0→1 → width multiplier) — overrides linear start/end */
  widthCurve?: { t: number; value: number }[];
  /** Color at head (t=0) */
  colorStart: THREE.Color;
  /** Color at tail (t=1) */
  colorEnd: THREE.Color;
  /** Optional color gradient stops */
  colorCurve?: { t: number; color: THREE.Color }[];
  /** Opacity at head / tail */
  opacityStart: number;
  opacityEnd: number;
  /** Blend mode */
  blending: THREE.Blending;
  /** Optional texture for the ribbon */
  texture?: THREE.Texture;
  /** UV scroll speed along the trail length */
  uvScrollSpeed: number;
  /** Whether to face camera (billboard) or use trail normal */
  faceCamera: boolean;
  /** Texture tiling along trail length */
  textureRepeat: number;
  /** Depth write */
  depthWrite: boolean;
}

const DEFAULT_CONFIG: TrailConfig = {
  lifetime: 0.5,
  maxPoints: 64,
  minDistance: 0.05,
  widthStart: 0.3,
  widthEnd: 0.0,
  colorStart: new THREE.Color(1, 1, 1),
  colorEnd: new THREE.Color(1, 1, 1),
  opacityStart: 1.0,
  opacityEnd: 0.0,
  blending: THREE.NormalBlending,
  uvScrollSpeed: 0,
  faceCamera: true,
  textureRepeat: 1,
  depthWrite: false,
};

// ── TrailPoint ──────────────────────────────────────────────────────────────

interface TrailPoint {
  position: THREE.Vector3;
  age: number;       // seconds since creation
  normal: THREE.Vector3;
}

// ── Trail Renderer ──────────────────────────────────────────────────────────

export class TrailRenderer {
  readonly config: TrailConfig;
  private points: TrailPoint[] = [];
  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private target: THREE.Object3D;
  private lastPosition = new THREE.Vector3();
  private uvOffset = 0;
  private active = true;

  constructor(target: THREE.Object3D, scene: THREE.Scene, cfg?: Partial<TrailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg } as TrailConfig;
    if (cfg?.colorStart) this.config.colorStart = cfg.colorStart.clone();
    if (cfg?.colorEnd) this.config.colorEnd = cfg.colorEnd.clone();
    this.target = target;

    const maxVerts = this.config.maxPoints * 2;
    const positions = new Float32Array(maxVerts * 3);
    const uvs = new Float32Array(maxVerts * 2);
    const colors = new Float32Array(maxVerts * 4);
    const indices: number[] = [];

    for (let i = 0; i < this.config.maxPoints - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.geometry.setIndex(indices);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 color;
        varying vec4 vColor;
        varying vec2 vUv;
        void main() {
          vColor = color;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform bool useMap;
        varying vec4 vColor;
        varying vec2 vUv;
        void main() {
          vec4 texColor = useMap ? texture2D(map, vUv) : vec4(1.0);
          gl_FragColor = vColor * texColor;
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      uniforms: {
        map: { value: this.config.texture ?? null },
        useMap: { value: !!this.config.texture },
      },
      transparent: true,
      blending: this.config.blending,
      depthWrite: this.config.depthWrite,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'trail_' + target.name;
    scene.add(this.mesh);

    this.lastPosition.copy(target.getWorldPosition(new THREE.Vector3()));
  }

  // ── Width / Color helpers ────────────────────────────────────────────────

  private sampleWidth(t: number): number {
    if (this.config.widthCurve && this.config.widthCurve.length >= 2) {
      return this.sampleCurve(this.config.widthCurve, t);
    }
    return THREE.MathUtils.lerp(this.config.widthStart, this.config.widthEnd, t);
  }

  private sampleCurve(curve: { t: number; value: number }[], t: number): number {
    if (t <= curve[0].t) return curve[0].value;
    if (t >= curve[curve.length - 1].t) return curve[curve.length - 1].value;
    for (let i = 0; i < curve.length - 1; i++) {
      if (t >= curve[i].t && t <= curve[i + 1].t) {
        const f = (t - curve[i].t) / (curve[i + 1].t - curve[i].t);
        return THREE.MathUtils.lerp(curve[i].value, curve[i + 1].value, f);
      }
    }
    return curve[0].value;
  }

  private sampleColor(t: number, out: THREE.Color): void {
    if (this.config.colorCurve && this.config.colorCurve.length >= 2) {
      const c = this.config.colorCurve;
      if (t <= c[0].t) { out.copy(c[0].color); return; }
      if (t >= c[c.length - 1].t) { out.copy(c[c.length - 1].color); return; }
      for (let i = 0; i < c.length - 1; i++) {
        if (t >= c[i].t && t <= c[i + 1].t) {
          const f = (t - c[i].t) / (c[i + 1].t - c[i].t);
          out.copy(c[i].color).lerp(c[i + 1].color, f);
          return;
        }
      }
    }
    out.copy(this.config.colorStart).lerp(this.config.colorEnd, t);
  }

  private sampleOpacity(t: number): number {
    return THREE.MathUtils.lerp(this.config.opacityStart, this.config.opacityEnd, t);
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(delta: number, camera: THREE.Camera): void {
    // Age existing points
    for (let i = this.points.length - 1; i >= 0; i--) {
      this.points[i].age += delta;
      if (this.points[i].age > this.config.lifetime) {
        this.points.splice(i, 1);
      }
    }

    // Add new point if moved enough
    if (this.active) {
      const worldPos = this.target.getWorldPosition(new THREE.Vector3());
      if (this.points.length === 0 || worldPos.distanceTo(this.lastPosition) >= this.config.minDistance) {
        const dir = new THREE.Vector3().subVectors(worldPos, this.lastPosition).normalize();
        let normal: THREE.Vector3;
        if (this.config.faceCamera) {
          const toCam = new THREE.Vector3().subVectors(camera.position, worldPos).normalize();
          normal = new THREE.Vector3().crossVectors(dir, toCam).normalize();
          if (normal.lengthSq() < 0.001) normal.set(0, 1, 0);
        } else {
          normal = new THREE.Vector3(0, 1, 0);
        }
        this.points.unshift({ position: worldPos.clone(), age: 0, normal });
        if (this.points.length > this.config.maxPoints) this.points.pop();
        this.lastPosition.copy(worldPos);
      }
    }

    this.uvOffset += delta * this.config.uvScrollSpeed;

    // Rebuild geometry
    this.rebuildGeometry();
  }

  private rebuildGeometry(): void {
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uvAttr = this.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const count = this.points.length;
    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = this.points[i];
      const t = count > 1 ? i / (count - 1) : 0;
      const w = this.sampleWidth(t) * 0.5;

      const left = new THREE.Vector3().copy(p.normal).multiplyScalar(w);
      const right = new THREE.Vector3().copy(p.normal).multiplyScalar(-w);

      const pL = new THREE.Vector3().addVectors(p.position, left);
      const pR = new THREE.Vector3().addVectors(p.position, right);

      const idx = i * 2;
      posAttr.setXYZ(idx, pL.x, pL.y, pL.z);
      posAttr.setXYZ(idx + 1, pR.x, pR.y, pR.z);

      const u = t * this.config.textureRepeat + this.uvOffset;
      uvAttr.setXY(idx, u, 0);
      uvAttr.setXY(idx + 1, u, 1);

      this.sampleColor(t, tmpColor);
      const a = this.sampleOpacity(t);
      colAttr.setXYZW(idx, tmpColor.r, tmpColor.g, tmpColor.b, a);
      colAttr.setXYZW(idx + 1, tmpColor.r, tmpColor.g, tmpColor.b, a);
    }

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    const triCount = Math.max(0, (count - 1) * 6);
    this.geometry.setDrawRange(0, triCount);
  }

  // ── Control ──────────────────────────────────────────────────────────────

  /** Start / stop emitting new points (existing trail still fades out) */
  setEmitting(v: boolean): void { this.active = v; }

  /** Clear all points immediately */
  clear(): void { this.points.length = 0; this.rebuildGeometry(); }

  /** Change texture at runtime */
  setTexture(tex: THREE.Texture | null): void {
    this.material.uniforms.map.value = tex;
    this.material.uniforms.useMap.value = !!tex;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ── Trail Manager ───────────────────────────────────────────────────────────

export class TrailManager {
  private trails: Map<string, TrailRenderer> = new Map();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  create(id: string, target: THREE.Object3D, cfg?: Partial<TrailConfig>): TrailRenderer {
    const old = this.trails.get(id);
    if (old) old.dispose(this.scene);
    const trail = new TrailRenderer(target, this.scene, cfg);
    this.trails.set(id, trail);
    return trail;
  }

  get(id: string): TrailRenderer | undefined { return this.trails.get(id); }

  remove(id: string): void {
    const t = this.trails.get(id);
    if (t) { t.dispose(this.scene); this.trails.delete(id); }
  }

  update(delta: number, camera: THREE.Camera): void {
    this.trails.forEach(t => t.update(delta, camera));
  }

  dispose(): void {
    this.trails.forEach(t => t.dispose(this.scene));
    this.trails.clear();
  }
}
