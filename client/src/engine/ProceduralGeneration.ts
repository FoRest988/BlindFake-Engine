/**
 * ProceduralGeneration — Tools for generating content procedurally:
 * - Perlin/Simplex noise (2D, 3D)
 * - Procedural mesh generation (plane, sphere, cylinder, torus, tube, stairs)
 * - Maze/dungeon generator
 * - Tree/vegetation L-system
 * - Rock/stone generator
 * - City block / building generator
 */

import * as THREE from 'three';

/* ─── Noise ─────────────────────────────────────────── */

export class Noise {
  private perm: Uint8Array;

  constructor(seed: number = 0) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Fisher-Yates with seed
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 0) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 2D Perlin noise, returns [-1, 1] */
  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);

    const u = this.fade(x);
    const v = this.fade(y);

    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;

    return this.lerp(v,
      this.lerp(u, this.grad2D(this.perm[A], x, y), this.grad2D(this.perm[B], x - 1, y)),
      this.lerp(u, this.grad2D(this.perm[A + 1], x, y - 1), this.grad2D(this.perm[B + 1], x - 1, y - 1))
    );
  }

  /** 3D Perlin noise */
  noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this.lerp(w,
      this.lerp(v,
        this.lerp(u, this.grad3D(this.perm[AA], x, y, z), this.grad3D(this.perm[BA], x - 1, y, z)),
        this.lerp(u, this.grad3D(this.perm[AB], x, y - 1, z), this.grad3D(this.perm[BB], x - 1, y - 1, z))),
      this.lerp(v,
        this.lerp(u, this.grad3D(this.perm[AA + 1], x, y, z - 1), this.grad3D(this.perm[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad3D(this.perm[AB + 1], x, y - 1, z - 1), this.grad3D(this.perm[BB + 1], x - 1, y - 1, z - 1)))
    );
  }

  /** Fractal Brownian Motion (fBm) */
  fbm2D(x: number, y: number, octaves: number = 6, lacunarity: number = 2, persistence: number = 0.5): number {
    let total = 0, amplitude = 1, frequency = 1, maxVal = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxVal += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return total / maxVal;
  }

  /** Ridged noise */
  ridged2D(x: number, y: number, octaves: number = 6): number {
    let total = 0, amplitude = 1, frequency = 1;
    for (let i = 0; i < octaves; i++) {
      total += (1 - Math.abs(this.noise2D(x * frequency, y * frequency))) * amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / octaves;
  }

  private fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
  private lerp(t: number, a: number, b: number): number { return a + t * (b - a); }
  private grad2D(hash: number, x: number, y: number): number {
    const h = hash & 3;
    return ((h & 1) === 0 ? x : -x) + ((h & 2) === 0 ? y : -y);
  }
  private grad3D(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
}

/* ─── Procedural Meshes ─────────────────────────────── */

export class ProceduralMesh {

  /** Generate a subdivided plane with noise displacement */
  static noisePlane(width: number, depth: number, segments: number, noise: Noise, amplitude: number = 5, frequency: number = 0.1): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(width, depth, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, noise.fbm2D(x * frequency, z * frequency) * amplitude);
    }

    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true }));
  }

  /** Generate stairs */
  static stairs(count: number, stepWidth: number, stepHeight: number, stepDepth: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Stairs';
    const geo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
    const mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, i * stepHeight + stepHeight / 2, i * stepDepth);
      mesh.name = `Step_${i}`;
      group.add(mesh);
    }
    return group;
  }

  /** Generate a tube along a path */
  static tube(path: THREE.Vector3[], radius: number = 0.5, segments: number = 64, radialSegments: number = 8): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(path);
    const geo = new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
  }

  /** Generate a procedural rock */
  static rock(radius: number = 1, detail: number = 2, noiseAmp: number = 0.3, seed: number = 42): THREE.Mesh {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const noise = new Noise(seed);
    const pos = geo.getAttribute('position');

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const len = Math.sqrt(x * x + y * y + z * z);
      const n = noise.noise3D(x * 2, y * 2, z * 2) * noiseAmp;
      const scale = (radius + n) / len;
      pos.setXYZ(i, x * scale, y * scale, z * scale);
    }

    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x777777, flatShading: true }));
  }

  /** Generate a wall with windows */
  static buildingWall(width: number, height: number, floors: number, windowsPerFloor: number): THREE.Group {
    const group = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xbbaa88 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x335577, metalness: 0.5, roughness: 0.1 });
    const floorH = height / floors;

    // Main wall
    const wallGeo = new THREE.BoxGeometry(width, height, 0.3);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = height / 2;
    group.add(wall);

    // Windows
    const winW = (width / (windowsPerFloor + 1)) * 0.6;
    const winH = floorH * 0.5;
    const winGeo = new THREE.BoxGeometry(winW, winH, 0.35);

    for (let f = 0; f < floors; f++) {
      for (let w = 0; w < windowsPerFloor; w++) {
        const win = new THREE.Mesh(winGeo, windowMat);
        win.position.x = -width / 2 + (w + 1) * (width / (windowsPerFloor + 1));
        win.position.y = f * floorH + floorH * 0.6;
        win.position.z = 0.05;
        group.add(win);
      }
    }

    return group;
  }
}

/* ─── Maze / Dungeon Generator ──────────────────────── */

export interface MazeCell {
  x: number;
  y: number;
  walls: { north: boolean; south: boolean; east: boolean; west: boolean };
  visited: boolean;
}

export class MazeGenerator {
  private grid: MazeCell[][] = [];
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** Generate maze using recursive backtracker */
  generate(seed: number = 0): MazeCell[][] {
    // Init grid
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = {
          x, y,
          walls: { north: true, south: true, east: true, west: true },
          visited: false,
        };
      }
    }

    // Seeded random
    let s = seed || (Date.now() % 2147483647);
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    // Recursive backtracker
    const stack: MazeCell[] = [];
    const start = this.grid[0][0];
    start.visited = true;
    stack.push(start);

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = this.getUnvisitedNeighbors(current);

      if (neighbors.length === 0) {
        stack.pop();
      } else {
        const next = neighbors[Math.floor(rand() * neighbors.length)];
        this.removeWall(current, next);
        next.visited = true;
        stack.push(next);
      }
    }

    return this.grid;
  }

  /** Convert maze to 3D geometry */
  toMesh(cellSize: number = 4, wallHeight: number = 3): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Maze';
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        const cx = x * cellSize;
        const cz = y * cellSize;

        if (cell.walls.north) {
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(cellSize, wallHeight, 0.2),
            wallMat
          );
          wall.position.set(cx + cellSize / 2, wallHeight / 2, cz);
          group.add(wall);
        }
        if (cell.walls.west) {
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, wallHeight, cellSize),
            wallMat
          );
          wall.position.set(cx, wallHeight / 2, cz + cellSize / 2);
          group.add(wall);
        }
      }
    }

    // Outer walls (east & south boundaries)
    for (let x = 0; x < this.width; x++) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(cellSize, wallHeight, 0.2),
        wallMat
      );
      wall.position.set(x * cellSize + cellSize / 2, wallHeight / 2, this.height * cellSize);
      group.add(wall);
    }
    for (let y = 0; y < this.height; y++) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, wallHeight, cellSize),
        wallMat
      );
      wall.position.set(this.width * cellSize, wallHeight / 2, y * cellSize + cellSize / 2);
      group.add(wall);
    }

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width * cellSize, this.height * cellSize),
      new THREE.MeshStandardMaterial({ color: 0x555555 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.width * cellSize / 2, 0, this.height * cellSize / 2);
    group.add(floor);

    return group;
  }

  private getUnvisitedNeighbors(cell: MazeCell): MazeCell[] {
    const { x, y } = cell;
    const neighbors: MazeCell[] = [];
    if (y > 0 && !this.grid[y - 1][x].visited) neighbors.push(this.grid[y - 1][x]);
    if (y < this.height - 1 && !this.grid[y + 1][x].visited) neighbors.push(this.grid[y + 1][x]);
    if (x > 0 && !this.grid[y][x - 1].visited) neighbors.push(this.grid[y][x - 1]);
    if (x < this.width - 1 && !this.grid[y][x + 1].visited) neighbors.push(this.grid[y][x + 1]);
    return neighbors;
  }

  private removeWall(a: MazeCell, b: MazeCell): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 1) { a.walls.east = false; b.walls.west = false; }
    if (dx === -1) { a.walls.west = false; b.walls.east = false; }
    if (dy === 1) { a.walls.south = false; b.walls.north = false; }
    if (dy === -1) { a.walls.north = false; b.walls.south = false; }
  }
}

/* ─── L-System Tree Generator ───────────────────────── */

export class LSystemTree {
  private rules: Record<string, string>;
  private axiom: string;
  private angle: number;

  constructor(axiom: string = 'F', rules: Record<string, string> = { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: number = 25) {
    this.axiom = axiom;
    this.rules = rules;
    this.angle = angle;
  }

  /** Expand the L-system string */
  expand(iterations: number): string {
    let current = this.axiom;
    for (let i = 0; i < iterations; i++) {
      let next = '';
      for (const ch of current) {
        next += this.rules[ch] ?? ch;
      }
      current = next;
    }
    return current;
  }

  /** Generate 3D tree mesh from L-system */
  generate(iterations: number = 4, segmentLength: number = 1, radius: number = 0.05): THREE.Group {
    const str = this.expand(iterations);
    const group = new THREE.Group();
    group.name = 'LSystemTree';

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d2e });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d7a2d });

    type TurtleState = { pos: THREE.Vector3; dir: THREE.Vector3; right: THREE.Vector3; len: number; rad: number };

    const state: TurtleState = {
      pos: new THREE.Vector3(0, 0, 0),
      dir: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      len: segmentLength,
      rad: radius,
    };

    const stack: TurtleState[] = [];
    const angleRad = (this.angle * Math.PI) / 180;

    for (const ch of str) {
      switch (ch) {
        case 'F': {
          const start = state.pos.clone();
          const end = state.pos.clone().add(state.dir.clone().multiplyScalar(state.len));

          // Create cylinder segment
          const segGeo = new THREE.CylinderGeometry(state.rad * 0.8, state.rad, state.len, 6);
          const seg = new THREE.Mesh(segGeo, trunkMat);

          // Position and orient
          const mid = start.clone().add(end).multiplyScalar(0.5);
          seg.position.copy(mid);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), state.dir.clone().normalize());

          group.add(seg);
          state.pos.copy(end);
          break;
        }
        case '+': {
          // Rotate right
          state.dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), angleRad);
          break;
        }
        case '-': {
          // Rotate left
          state.dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), -angleRad);
          break;
        }
        case '[': {
          stack.push({
            pos: state.pos.clone(),
            dir: state.dir.clone(),
            right: state.right.clone(),
            len: state.len,
            rad: state.rad,
          });
          state.len *= 0.75;
          state.rad *= 0.7;
          break;
        }
        case ']': {
          // Add leaf at branch end
          const leafGeo = new THREE.SphereGeometry(state.len * 1.5, 6, 6);
          const leaf = new THREE.Mesh(leafGeo, leafMat);
          leaf.position.copy(state.pos);
          leaf.scale.y = 0.5;
          group.add(leaf);

          const prev = stack.pop();
          if (prev) {
            state.pos.copy(prev.pos);
            state.dir.copy(prev.dir);
            state.right.copy(prev.right);
            state.len = prev.len;
            state.rad = prev.rad;
          }
          break;
        }
      }
    }

    return group;
  }
}

/* ─── Scatter/Placement Utility ─────────────────────── */

export class ScatterUtil {
  /** Scatter instances in a rectangular area using Poisson disk sampling (approximate) */
  static poissonDisk(areaWidth: number, areaDepth: number, minDist: number, maxAttempts: number = 30, seed: number = 0): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const cellSize = minDist / Math.SQRT2;
    const gridW = Math.ceil(areaWidth / cellSize);
    const gridH = Math.ceil(areaDepth / cellSize);
    const grid = new Array(gridW * gridH).fill(-1);

    let s = seed || 1;
    const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

    const active: number[] = [];

    const addPoint = (p: THREE.Vector3): number => {
      const idx = points.length;
      points.push(p);
      const gx = Math.floor(p.x / cellSize);
      const gz = Math.floor(p.z / cellSize);
      if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridH) {
        grid[gz * gridW + gx] = idx;
      }
      active.push(idx);
      return idx;
    };

    // Start with random point
    addPoint(new THREE.Vector3(rand() * areaWidth, 0, rand() * areaDepth));

    while (active.length > 0) {
      const ai = Math.floor(rand() * active.length);
      const pidx = active[ai];
      const p = points[pidx];
      let found = false;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const angle = rand() * Math.PI * 2;
        const dist = minDist + rand() * minDist;
        const nx = p.x + Math.cos(angle) * dist;
        const nz = p.z + Math.sin(angle) * dist;

        if (nx < 0 || nx >= areaWidth || nz < 0 || nz >= areaDepth) continue;

        const gx = Math.floor(nx / cellSize);
        const gz = Math.floor(nz / cellSize);

        let valid = true;
        for (let dz = -2; dz <= 2 && valid; dz++) {
          for (let dx = -2; dx <= 2 && valid; dx++) {
            const cx = gx + dx;
            const cz = gz + dz;
            if (cx >= 0 && cx < gridW && cz >= 0 && cz < gridH) {
              const ci = grid[cz * gridW + cx];
              if (ci >= 0) {
                const cp = points[ci];
                const ddx = cp.x - nx;
                const ddz = cp.z - nz;
                if (ddx * ddx + ddz * ddz < minDist * minDist) {
                  valid = false;
                }
              }
            }
          }
        }

        if (valid) {
          addPoint(new THREE.Vector3(nx, 0, nz));
          found = true;
          break;
        }
      }

      if (!found) {
        active.splice(ai, 1);
      }
    }

    return points;
  }
}
