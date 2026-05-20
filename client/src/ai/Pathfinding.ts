// ─── A* Grid Pathfinding ────────────────────────────────────────────
// Grid-based A* pathfinding for 2D and 3D worlds.
// Supports weighted tiles, diagonal movement, dynamic obstacles,
// path smoothing, and NavGrid generation.

export interface GridNode {
  x: number;
  y: number;
  walkable: boolean;
  weight: number; // 1 = normal, higher = costly
  // A* internals
  g: number;
  h: number;
  f: number;
  parent: GridNode | null;
}

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathfindingConfig {
  width: number;
  height: number;
  cellSize?: number;
  allowDiagonal?: boolean;
  diagonalCost?: number;
  /** Max nodes to explore before giving up (prevents freezing) */
  maxIterations?: number;
}

export class Pathfinding {
  public grid: GridNode[][] = [];
  public width: number;
  public height: number;
  public cellSize: number;
  public allowDiagonal: boolean;
  public diagonalCost: number;
  public maxIterations: number;

  constructor(config: PathfindingConfig) {
    this.width = config.width;
    this.height = config.height;
    this.cellSize = config.cellSize ?? 1;
    this.allowDiagonal = config.allowDiagonal ?? true;
    this.diagonalCost = config.diagonalCost ?? 1.414;
    this.maxIterations = config.maxIterations ?? 10000;

    this.initGrid();
  }

  private initGrid(): void {
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = {
          x, y,
          walkable: true,
          weight: 1,
          g: 0, h: 0, f: 0,
          parent: null,
        };
      }
    }
  }

  /** Set a cell as walkable or blocked */
  setWalkable(x: number, y: number, walkable: boolean): void {
    if (this.isValid(x, y)) {
      this.grid[y][x].walkable = walkable;
    }
  }

  /** Set movement cost for a cell (1 = normal, higher = slower) */
  setWeight(x: number, y: number, weight: number): void {
    if (this.isValid(x, y)) {
      this.grid[y][x].weight = weight;
    }
  }

  /** Fill a rectangular area as blocked */
  setRect(x: number, y: number, w: number, h: number, walkable: boolean): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setWalkable(x + dx, y + dy, walkable);
      }
    }
  }

  /** Find path from start to end using A* */
  findPath(startX: number, startY: number, endX: number, endY: number): PathPoint[] {
    if (!this.isValid(startX, startY) || !this.isValid(endX, endY)) return [];
    if (!this.grid[startY][startX].walkable || !this.grid[endY][endX].walkable) return [];
    if (startX === endX && startY === endY) return [{ x: startX, y: startY }];

    // Reset nodes
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const node = this.grid[y][x];
        node.g = 0;
        node.h = 0;
        node.f = 0;
        node.parent = null;
      }
    }

    const start = this.grid[startY][startX];
    const end = this.grid[endY][endX];

    const openSet: GridNode[] = [start];
    const closedSet = new Set<GridNode>();
    let iterations = 0;

    start.g = 0;
    start.h = this.heuristic(startX, startY, endX, endY);
    start.f = start.h;

    while (openSet.length > 0) {
      iterations++;
      if (iterations > this.maxIterations) return []; // Bail

      // Find node with lowest f
      let lowestIdx = 0;
      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].f < openSet[lowestIdx].f) lowestIdx = i;
      }
      const current = openSet[lowestIdx];

      // Found the destination
      if (current === end) {
        return this.reconstructPath(end);
      }

      // Move current from open to closed
      openSet.splice(lowestIdx, 1);
      closedSet.add(current);

      // Explore neighbors
      const neighbors = this.getNeighbors(current);
      for (const neighbor of neighbors) {
        if (closedSet.has(neighbor) || !neighbor.walkable) continue;

        const isDiagonal = neighbor.x !== current.x && neighbor.y !== current.y;
        const moveCost = isDiagonal ? this.diagonalCost : 1;
        const tentativeG = current.g + moveCost * neighbor.weight;

        const inOpen = openSet.includes(neighbor);
        if (!inOpen || tentativeG < neighbor.g) {
          neighbor.g = tentativeG;
          neighbor.h = this.heuristic(neighbor.x, neighbor.y, endX, endY);
          neighbor.f = neighbor.g + neighbor.h;
          neighbor.parent = current;

          if (!inOpen) openSet.push(neighbor);
        }
      }
    }

    return []; // No path found
  }

  /** Find path and return world-space coordinates */
  findPathWorld(
    startWX: number, startWZ: number,
    endWX: number, endWZ: number,
    offsetX = 0, offsetZ = 0,
  ): PathPoint[] {
    const sx = Math.floor((startWX - offsetX) / this.cellSize);
    const sy = Math.floor((startWZ - offsetZ) / this.cellSize);
    const ex = Math.floor((endWX - offsetX) / this.cellSize);
    const ey = Math.floor((endWZ - offsetZ) / this.cellSize);

    const gridPath = this.findPath(sx, sy, ex, ey);
    return gridPath.map((p) => ({
      x: p.x * this.cellSize + offsetX + this.cellSize / 2,
      y: p.y * this.cellSize + offsetZ + this.cellSize / 2,
    }));
  }

  /** Smooth a path by removing unnecessary waypoints (line of sight) */
  smoothPath(path: PathPoint[]): PathPoint[] {
    if (path.length <= 2) return path;

    const result: PathPoint[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      let farthest = current + 1;
      for (let i = path.length - 1; i > current + 1; i--) {
        if (this.hasLineOfSight(path[current], path[i])) {
          farthest = i;
          break;
        }
      }
      result.push(path[farthest]);
      current = farthest;
    }

    return result;
  }

  /** Check if there's a clear line of sight between two points */
  hasLineOfSight(a: PathPoint, b: PathPoint): boolean {
    // Bresenham's line for grid cells
    let x0 = a.x, y0 = a.y;
    const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      if (!this.isValid(x0, y0) || !this.grid[y0][x0].walkable) return false;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return true;
  }

  /** Get neighbors of a node */
  private getNeighbors(node: GridNode): GridNode[] {
    const { x, y } = node;
    const neighbors: GridNode[] = [];

    // Cardinal
    if (this.isValid(x, y - 1)) neighbors.push(this.grid[y - 1][x]);     // up
    if (this.isValid(x, y + 1)) neighbors.push(this.grid[y + 1][x]);     // down
    if (this.isValid(x - 1, y)) neighbors.push(this.grid[y][x - 1]);     // left
    if (this.isValid(x + 1, y)) neighbors.push(this.grid[y][x + 1]);     // right

    // Diagonal
    if (this.allowDiagonal) {
      if (this.isValid(x - 1, y - 1)) neighbors.push(this.grid[y - 1][x - 1]);
      if (this.isValid(x + 1, y - 1)) neighbors.push(this.grid[y - 1][x + 1]);
      if (this.isValid(x - 1, y + 1)) neighbors.push(this.grid[y + 1][x - 1]);
      if (this.isValid(x + 1, y + 1)) neighbors.push(this.grid[y + 1][x + 1]);
    }

    return neighbors;
  }

  /** Heuristic (octile distance for diagonal, manhattan otherwise) */
  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    if (this.allowDiagonal) {
      return Math.max(dx, dy) + (this.diagonalCost - 1) * Math.min(dx, dy);
    }
    return dx + dy;
  }

  private reconstructPath(end: GridNode): PathPoint[] {
    const path: PathPoint[] = [];
    let current: GridNode | null = end;
    while (current) {
      path.unshift({ x: current.x, y: current.y });
      current = current.parent;
    }
    return path;
  }

  private isValid(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Check if a specific cell is walkable */
  isWalkable(x: number, y: number): boolean {
    return this.isValid(x, y) && this.grid[y][x].walkable;
  }

  /** Generate a debug visualization string */
  toDebugString(path?: PathPoint[]): string {
    const pathSet = new Set<string>();
    if (path) {
      for (const p of path) pathSet.add(`${p.x},${p.y}`);
    }

    let result = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (pathSet.has(`${x},${y}`)) result += '* ';
        else if (!this.grid[y][x].walkable) result += '# ';
        else result += '. ';
      }
      result += '\n';
    }
    return result;
  }
}
