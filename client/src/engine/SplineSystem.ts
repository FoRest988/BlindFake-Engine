/**
 * SplineSystem — Catmull-Rom & Bezier splines, path following, visualization.
 *
 * Features:
 *  - Catmull-Rom spline (smooth through control points)
 *  - Cubic Bezier spline
 *  - Linear path
 *  - Path following with constant speed / easing
 *  - Looping / ping-pong
 *  - Sample position, tangent, up vector at any t
 *  - Arc-length parameterization for uniform speed
 *  - Debug visualization: line + control point spheres
 *  - SplineManager for managing multiple named paths
 */

import * as THREE from 'three';

// ── Types ───────────────────────────────────────────────────────────────────

export type SplineType = 'catmullrom' | 'bezier' | 'linear';
export type LoopMode = 'none' | 'loop' | 'pingpong';
export type EasingFn = (t: number) => number;

export interface SplineConfig {
  type: SplineType;
  points: THREE.Vector3[];
  closed: boolean;
  /** Catmull-Rom tension (0 = Catmull-Rom, 0.5 = centripetal, 1 = chordal) */
  tension: number;
}

export interface PathFollowerConfig {
  splineId: string;
  speed: number;         // units / second
  loop: LoopMode;
  lookAhead: boolean;    // rotate to face direction of travel
  upVector: THREE.Vector3;
  easing?: EasingFn;
  /** Offset distance (e.g. hover above path) */
  offset: THREE.Vector3;
  onComplete?: () => void;
  onLoop?: () => void;
}

// ── Easing presets ──────────────────────────────────────────────────────────

export const Easings = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
};

// ── Spline Class ────────────────────────────────────────────────────────────

export class Spline {
  readonly id: string;
  config: SplineConfig;
  private curve!: THREE.Curve<THREE.Vector3>;
  private arcLengths: number[] = [];
  private totalLength = 0;

  constructor(id: string, cfg: Partial<SplineConfig> & { points: THREE.Vector3[] }) {
    this.id = id;
    this.config = {
      type: cfg.type ?? 'catmullrom',
      points: cfg.points.map(p => p.clone()),
      closed: cfg.closed ?? false,
      tension: cfg.tension ?? 0.5,
    };
    this.rebuild();
  }

  rebuild(): void {
    const pts = this.config.points;
    if (pts.length < 2) return;

    switch (this.config.type) {
      case 'catmullrom':
        this.curve = new THREE.CatmullRomCurve3(pts, this.config.closed, 'centripetal', this.config.tension);
        break;
      case 'bezier':
        if (pts.length === 4) {
          this.curve = new THREE.CubicBezierCurve3(pts[0], pts[1], pts[2], pts[3]);
        } else {
          // For more than 4 points, chain cubic bezier segments via CatmullRom fallback
          this.curve = new THREE.CatmullRomCurve3(pts, this.config.closed, 'centripetal', this.config.tension);
        }
        break;
      case 'linear':
        this.curve = new THREE.CatmullRomCurve3(pts, this.config.closed, 'centripetal', 0);
        // Override: use LineCurve3 chain
        this.curve = this.buildLinearCurve(pts);
        break;
    }

    // Compute arc-length LUT for uniform speed sampling
    const samples = Math.max(pts.length * 20, 100);
    this.arcLengths = [0];
    let prev = this.curve.getPoint(0);
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const p = this.curve.getPoint(t);
      this.arcLengths.push(this.arcLengths[i - 1] + prev.distanceTo(p));
      prev = p;
    }
    this.totalLength = this.arcLengths[this.arcLengths.length - 1];
  }

  private buildLinearCurve(pts: THREE.Vector3[]): THREE.Curve<THREE.Vector3> {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < pts.length - 1; i++) {
      path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    }
    if (this.config.closed && pts.length > 2) {
      path.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]));
    }
    return path as unknown as THREE.Curve<THREE.Vector3>;
  }

  /** Convert distance along spline to curve t parameter (arc-length parameterization) */
  private distanceToT(d: number): number {
    d = Math.max(0, Math.min(d, this.totalLength));
    const n = this.arcLengths.length - 1;
    // Binary search
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.arcLengths[mid] < d) lo = mid + 1; else hi = mid;
    }
    if (this.arcLengths[lo] === d) return lo / n;
    const before = lo - 1;
    const segLen = this.arcLengths[lo] - this.arcLengths[before];
    const frac = (d - this.arcLengths[before]) / segLen;
    return (before + frac) / n;
  }

  /** t in [0,1] — uniform speed (arc-length parameterized) */
  getPoint(t: number): THREE.Vector3 {
    const d = t * this.totalLength;
    return this.curve.getPoint(this.distanceToT(d));
  }

  getTangent(t: number): THREE.Vector3 {
    const d = t * this.totalLength;
    return this.curve.getTangent(this.distanceToT(d));
  }

  getLength(): number { return this.totalLength; }

  getPointCount(): number { return this.config.points.length; }

  setPoint(index: number, pos: THREE.Vector3): void {
    if (index >= 0 && index < this.config.points.length) {
      this.config.points[index].copy(pos);
      this.rebuild();
    }
  }

  addPoint(pos: THREE.Vector3, index?: number): void {
    if (index !== undefined) {
      this.config.points.splice(index, 0, pos.clone());
    } else {
      this.config.points.push(pos.clone());
    }
    this.rebuild();
  }

  removePoint(index: number): void {
    if (this.config.points.length > 2) {
      this.config.points.splice(index, 1);
      this.rebuild();
    }
  }

  /** Get evenly-spaced points for visualization */
  getSampledPoints(count = 64): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= count; i++) {
      pts.push(this.getPoint(i / count));
    }
    return pts;
  }
}

// ── Path Follower ───────────────────────────────────────────────────────────

export class PathFollower {
  readonly id: string;
  readonly config: PathFollowerConfig;
  private target: THREE.Object3D;
  private progress = 0;    // 0 → 1
  private direction = 1;   // 1 forward, -1 backward (for pingpong)
  private spline: Spline | null = null;
  private _paused = false;
  private _finished = false;

  constructor(id: string, target: THREE.Object3D, cfg: PathFollowerConfig) {
    this.id = id;
    this.target = target;
    this.config = {
      ...cfg,
      upVector: cfg.upVector?.clone() ?? new THREE.Vector3(0, 1, 0),
      offset: cfg.offset?.clone() ?? new THREE.Vector3(),
    };
  }

  bind(spline: Spline): void { this.spline = spline; }

  pause(): void { this._paused = true; }
  resume(): void { this._paused = false; }
  reset(): void { this.progress = 0; this.direction = 1; this._finished = false; }
  isFinished(): boolean { return this._finished; }
  getProgress(): number { return this.progress; }
  setProgress(t: number): void { this.progress = Math.max(0, Math.min(1, t)); }

  update(delta: number): void {
    if (!this.spline || this._paused || this._finished) return;

    const length = this.spline.getLength();
    if (length <= 0) return;

    const dt = (this.config.speed * delta) / length;
    this.progress += dt * this.direction;

    // Handle boundaries
    if (this.progress >= 1) {
      if (this.config.loop === 'loop') {
        this.progress -= 1;
        this.config.onLoop?.();
      } else if (this.config.loop === 'pingpong') {
        this.progress = 1;
        this.direction = -1;
        this.config.onLoop?.();
      } else {
        this.progress = 1;
        this._finished = true;
        this.config.onComplete?.();
      }
    } else if (this.progress <= 0 && this.config.loop === 'pingpong') {
      this.progress = 0;
      this.direction = 1;
      this.config.onLoop?.();
    }

    // Apply easing
    const eased = this.config.easing ? this.config.easing(this.progress) : this.progress;

    // Set position
    const pos = this.spline.getPoint(eased);
    pos.add(this.config.offset);
    this.target.position.copy(pos);

    // Look ahead
    if (this.config.lookAhead) {
      const tangent = this.spline.getTangent(eased);
      if (this.direction < 0) tangent.negate();
      const lookAt = pos.clone().add(tangent);
      this.target.lookAt(lookAt);
    }
  }
}

// ── Spline Manager ──────────────────────────────────────────────────────────

export class SplineManager {
  private splines: Map<string, Spline> = new Map();
  private followers: Map<string, PathFollower> = new Map();
  private scene: THREE.Scene;

  // Debug visualization
  private debugLines: Map<string, THREE.Line> = new Map();
  private debugPoints: Map<string, THREE.Group> = new Map();
  private debugVisible = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // ── Splines ──────────────────────────────────────────────────────────────

  createSpline(id: string, cfg: Partial<SplineConfig> & { points: THREE.Vector3[] }): Spline {
    const s = new Spline(id, cfg);
    this.splines.set(id, s);
    if (this.debugVisible) this.rebuildDebug(id);
    return s;
  }

  getSpline(id: string): Spline | undefined { return this.splines.get(id); }

  removeSpline(id: string): void {
    this.splines.delete(id);
    this.clearDebug(id);
  }

  // ── Followers ────────────────────────────────────────────────────────────

  createFollower(id: string, target: THREE.Object3D, cfg: PathFollowerConfig): PathFollower {
    const f = new PathFollower(id, target, cfg);
    const spline = this.splines.get(cfg.splineId);
    if (spline) f.bind(spline);
    this.followers.set(id, f);
    return f;
  }

  getFollower(id: string): PathFollower | undefined { return this.followers.get(id); }

  removeFollower(id: string): void { this.followers.delete(id); }

  // ── Update ───────────────────────────────────────────────────────────────

  update(delta: number): void {
    this.followers.forEach(f => f.update(delta));
  }

  // ── Debug Visualization ──────────────────────────────────────────────────

  setDebugVisible(v: boolean): void {
    this.debugVisible = v;
    if (v) {
      this.splines.forEach((_, id) => this.rebuildDebug(id));
    } else {
      this.debugLines.forEach(l => this.scene.remove(l));
      this.debugPoints.forEach(g => this.scene.remove(g));
      this.debugLines.clear();
      this.debugPoints.clear();
    }
  }

  private rebuildDebug(id: string): void {
    const s = this.splines.get(id);
    if (!s) return;

    this.clearDebug(id);

    // Line
    const pts = s.getSampledPoints(100);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.name = `splineDebug_${id}`;
    this.scene.add(line);
    this.debugLines.set(id, line);

    // Control points
    const group = new THREE.Group();
    group.name = `splinePoints_${id}`;
    const sphereGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    for (const cp of s.config.points) {
      const m = new THREE.Mesh(sphereGeo, sphereMat);
      m.position.copy(cp);
      group.add(m);
    }
    this.scene.add(group);
    this.debugPoints.set(id, group);
  }

  private clearDebug(id: string): void {
    const l = this.debugLines.get(id);
    if (l) { this.scene.remove(l); l.geometry.dispose(); this.debugLines.delete(id); }
    const g = this.debugPoints.get(id);
    if (g) { this.scene.remove(g); this.debugPoints.delete(id); }
  }

  // ── Serialization ────────────────────────────────────────────────────────

  serialize(): object[] {
    const out: object[] = [];
    this.splines.forEach(s => {
      out.push({
        id: s.id,
        type: s.config.type,
        closed: s.config.closed,
        tension: s.config.tension,
        points: s.config.points.map(p => [p.x, p.y, p.z]),
      });
    });
    return out;
  }

  deserialize(data: { id: string; type: SplineType; closed: boolean; tension: number; points: number[][] }[]): void {
    for (const d of data) {
      const pts = d.points.map(a => new THREE.Vector3(a[0], a[1], a[2]));
      this.createSpline(d.id, { type: d.type, points: pts, closed: d.closed, tension: d.tension });
    }
  }

  dispose(): void {
    this.debugLines.forEach(l => { this.scene.remove(l); l.geometry.dispose(); });
    this.debugPoints.forEach(g => this.scene.remove(g));
    this.debugLines.clear();
    this.debugPoints.clear();
    this.splines.clear();
    this.followers.clear();
  }
}
