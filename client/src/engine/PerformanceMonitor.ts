/**
 * PerformanceMonitor — Advanced performance analysis tools.
 * Features:
 * - Scene complexity analyzer (draw calls, tri count, overdraw estimate)
 * - Memory leak detector (tracks object creation/disposal)
 * - Bottleneck advisor (identifies perf issues)
 * - Frame budget tracker with warnings
 * - Render statistics history with export
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export interface SceneAnalysis {
  totalObjects: number;
  meshes: number;
  lights: number;
  cameras: number;
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
  textureMemoryMB: number;
  geometryMemoryMB: number;
  heaviestObjects: Array<{ name: string; triangles: number; path: string }>;
  duplicateGeometries: number;
  duplicateMaterials: number;
  warnings: string[];
}

export interface FrameBudget {
  targetFPS: number;
  budgetMs: number;
  currentMs: number;
  overBudget: boolean;
  breakdown: {
    physics: number;
    render: number;
    scripts: number;
    other: number;
  };
}

export interface MemorySnapshot {
  timestamp: number;
  geometries: number;
  textures: number;
  programs: number;
  jsHeapMB: number;
}

export interface PerformanceAdvice {
  category: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
}

// ─── Performance Monitor ─────────────────────────────

export class PerformanceMonitor {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;

  // Frame budget
  private targetFPS = 60;
  private frameTimes: number[] = [];
  private maxFrameHistory = 300;

  // Memory tracking
  private memorySnapshots: MemorySnapshot[] = [];
  private maxSnapshots = 600;
  private snapshotInterval = 1000; // ms
  private lastSnapshotTime = 0;

  // Section timing
  private sections = new Map<string, { start: number; total: number }>();

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setTargetFPS(fps: number): void {
    this.targetFPS = fps;
  }

  // ─── Frame Tracking ─────────────────────────────

  recordFrameTime(ms: number): void {
    this.frameTimes.push(ms);
    if (this.frameTimes.length > this.maxFrameHistory) {
      this.frameTimes.shift();
    }

    // Periodic memory snapshot
    const now = performance.now();
    if (now - this.lastSnapshotTime > this.snapshotInterval) {
      this.takeMemorySnapshot();
      this.lastSnapshotTime = now;
    }
  }

  beginSection(name: string): void {
    this.sections.set(name, { start: performance.now(), total: 0 });
  }

  endSection(name: string): void {
    const section = this.sections.get(name);
    if (section) {
      section.total = performance.now() - section.start;
    }
  }

  // ─── Scene Complexity Analysis ──────────────────

  analyzeScene(): SceneAnalysis | null {
    if (!this.scene || !this.renderer) return null;

    const analysis: SceneAnalysis = {
      totalObjects: 0, meshes: 0, lights: 0, cameras: 0,
      triangles: 0, vertices: 0,
      materials: 0, textures: 0,
      textureMemoryMB: 0, geometryMemoryMB: 0,
      heaviestObjects: [],
      duplicateGeometries: 0, duplicateMaterials: 0,
      warnings: [],
    };

    const materialSet = new Set<string>();
    const textureSet = new Set<string>();
    const geometryMap = new Map<string, number>();
    const materialMap = new Map<string, number>();
    const meshDetails: Array<{ name: string; triangles: number; path: string }> = [];

    this.scene.traverse(obj => {
      analysis.totalObjects++;

      if (obj instanceof THREE.Light) analysis.lights++;
      if (obj instanceof THREE.Camera) analysis.cameras++;

      if (obj instanceof THREE.Mesh) {
        analysis.meshes++;
        const geo = obj.geometry;
        const triCount = geo.index
          ? geo.index.count / 3
          : (geo.attributes.position?.count ?? 0) / 3;
        const vertCount = geo.attributes.position?.count ?? 0;

        analysis.triangles += triCount;
        analysis.vertices += vertCount;

        // Track geometry duplication
        const geoId = geo.uuid;
        geometryMap.set(geoId, (geometryMap.get(geoId) ?? 0) + 1);

        // Estimate geometry memory
        let geoBytes = 0;
        for (const attrName of Object.keys(geo.attributes)) {
          const attr = geo.getAttribute(attrName);
          if (attr) geoBytes += attr.array.byteLength;
        }
        if (geo.index) geoBytes += geo.index.array.byteLength;
        analysis.geometryMemoryMB += geoBytes / (1024 * 1024);

        const path = this.getObjectPath(obj);
        meshDetails.push({ name: obj.name || '(unnamed)', triangles: triCount, path });

        // Track materials
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          materialSet.add(mat.uuid);
          materialMap.set(mat.uuid, (materialMap.get(mat.uuid) ?? 0) + 1);

          // Track textures
          const texSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
          for (const slot of texSlots) {
            const tex = (mat as any)[slot] as THREE.Texture | null;
            if (tex && !textureSet.has(tex.uuid)) {
              textureSet.add(tex.uuid);
              // Estimate texture memory
              const img = tex.image;
              if (img && img.width && img.height) {
                analysis.textureMemoryMB += (img.width * img.height * 4) / (1024 * 1024);
              }
            }
          }
        }
      }
    });

    analysis.materials = materialSet.size;
    analysis.textures = textureSet.size;
    analysis.duplicateGeometries = [...geometryMap.values()].filter(c => c > 1).length;
    analysis.duplicateMaterials = [...materialMap.values()].filter(c => c > 1).length;

    // Top 10 heaviest meshes
    analysis.heaviestObjects = meshDetails
      .sort((a, b) => b.triangles - a.triangles)
      .slice(0, 10);

    // Generate warnings
    if (analysis.triangles > 1000000) analysis.warnings.push(`High triangle count: ${(analysis.triangles / 1000000).toFixed(1)}M`);
    if (analysis.lights > 8) analysis.warnings.push(`Many lights (${analysis.lights}) — may cause slow rendering`);
    if (analysis.textureMemoryMB > 256) analysis.warnings.push(`High texture memory: ${analysis.textureMemoryMB.toFixed(0)}MB`);
    if (analysis.materials > 50) analysis.warnings.push(`Many unique materials (${analysis.materials}) — batch if possible`);
    if (analysis.duplicateGeometries > 5) analysis.warnings.push(`${analysis.duplicateGeometries} duplicate geometries — consider instancing`);

    return analysis;
  }

  private getObjectPath(obj: THREE.Object3D): string {
    const parts: string[] = [];
    let current: THREE.Object3D | null = obj;
    while (current) {
      parts.unshift(current.name || current.type);
      current = current.parent;
    }
    return parts.join('/');
  }

  // ─── Frame Budget ──────────────────────────────

  getFrameBudget(): FrameBudget {
    const budgetMs = 1000 / this.targetFPS;
    const recent = this.frameTimes.slice(-30);
    const currentMs = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;

    return {
      targetFPS: this.targetFPS,
      budgetMs,
      currentMs,
      overBudget: currentMs > budgetMs,
      breakdown: {
        physics: this.sections.get('physics')?.total ?? 0,
        render: this.sections.get('render')?.total ?? 0,
        scripts: this.sections.get('scripts')?.total ?? 0,
        other: Math.max(0, currentMs - (
          (this.sections.get('physics')?.total ?? 0) +
          (this.sections.get('render')?.total ?? 0) +
          (this.sections.get('scripts')?.total ?? 0)
        )),
      },
    };
  }

  // ─── Memory Tracking ───────────────────────────

  private takeMemorySnapshot(): void {
    const info = this.renderer?.info;
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      programs: info?.programs?.length ?? 0,
      jsHeapMB: (performance as any).memory?.usedJSHeapSize
        ? (performance as any).memory.usedJSHeapSize / (1024 * 1024)
        : 0,
    };
    this.memorySnapshots.push(snapshot);
    if (this.memorySnapshots.length > this.maxSnapshots) {
      this.memorySnapshots.shift();
    }
  }

  /** Detect potential memory leaks by checking if resources are growing over time */
  detectMemoryLeaks(): { leaking: boolean; details: string[] } {
    if (this.memorySnapshots.length < 10) {
      return { leaking: false, details: ['Not enough data yet'] };
    }

    const recent = this.memorySnapshots.slice(-30);
    const earlier = this.memorySnapshots.slice(0, 30);

    const avgRecent = (arr: MemorySnapshot[], field: keyof MemorySnapshot) =>
      arr.reduce((s, v) => s + (v[field] as number), 0) / arr.length;

    const details: string[] = [];
    let leaking = false;

    const geoGrowth = avgRecent(recent, 'geometries') - avgRecent(earlier, 'geometries');
    if (geoGrowth > 5) { details.push(`Geometry count growing (+${geoGrowth.toFixed(0)})`); leaking = true; }

    const texGrowth = avgRecent(recent, 'textures') - avgRecent(earlier, 'textures');
    if (texGrowth > 3) { details.push(`Texture count growing (+${texGrowth.toFixed(0)})`); leaking = true; }

    const heapGrowth = avgRecent(recent, 'jsHeapMB') - avgRecent(earlier, 'jsHeapMB');
    if (heapGrowth > 50) { details.push(`JS heap growing (+${heapGrowth.toFixed(0)}MB)`); leaking = true; }

    if (!leaking) details.push('No leaks detected');

    return { leaking, details };
  }

  // ─── Performance Advice ────────────────────────

  getAdvice(): PerformanceAdvice[] {
    const advice: PerformanceAdvice[] = [];
    const budget = this.getFrameBudget();
    const analysis = this.analyzeScene();
    const leaks = this.detectMemoryLeaks();

    if (budget.overBudget) {
      advice.push({
        category: 'critical',
        title: 'Over frame budget',
        detail: `Frame time ${budget.currentMs.toFixed(1)}ms exceeds ${budget.budgetMs.toFixed(1)}ms budget (${this.targetFPS} FPS target)`,
      });

      // Identify the biggest bottleneck
      const { physics, render, scripts } = budget.breakdown;
      const max = Math.max(physics, render, scripts);
      if (max === render) {
        advice.push({ category: 'warning', title: 'Rendering bottleneck', detail: `Render takes ${render.toFixed(1)}ms — reduce draw calls, enable LOD, or lower shadow quality` });
      } else if (max === physics) {
        advice.push({ category: 'warning', title: 'Physics bottleneck', detail: `Physics takes ${physics.toFixed(1)}ms — reduce collider count or physics step rate` });
      } else if (max === scripts) {
        advice.push({ category: 'warning', title: 'Script bottleneck', detail: `Scripts take ${scripts.toFixed(1)}ms — optimize update loops` });
      }
    }

    if (analysis) {
      if (analysis.duplicateGeometries > 5) {
        advice.push({ category: 'info', title: 'Use instancing', detail: `${analysis.duplicateGeometries} duplicate geometries could use InstancedMesh` });
      }
      if (analysis.lights > 4) {
        advice.push({ category: 'warning', title: 'Too many lights', detail: `${analysis.lights} lights — consider baked lighting or fewer dynamic lights` });
      }
      if (analysis.textureMemoryMB > 128) {
        advice.push({ category: 'warning', title: 'High texture memory', detail: `${analysis.textureMemoryMB.toFixed(0)}MB — compress textures or reduce resolution` });
      }
    }

    if (leaks.leaking) {
      advice.push({ category: 'critical', title: 'Memory leak detected', detail: leaks.details.join('; ') });
    }

    return advice;
  }

  // ─── Statistics Export ─────────────────────────

  getFrameTimeHistory(): number[] {
    return [...this.frameTimes];
  }

  getMemoryHistory(): MemorySnapshot[] {
    return [...this.memorySnapshots];
  }

  /** Export performance data as JSON */
  exportReport(): string {
    return JSON.stringify({
      analysis: this.analyzeScene(),
      budget: this.getFrameBudget(),
      advice: this.getAdvice(),
      leaks: this.detectMemoryLeaks(),
      frameHistory: this.frameTimes.slice(-120),
      memoryHistory: this.memorySnapshots.slice(-60),
    }, null, 2);
  }

  reset(): void {
    this.frameTimes = [];
    this.memorySnapshots = [];
    this.sections.clear();
  }
}
