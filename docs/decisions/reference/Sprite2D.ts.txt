import * as THREE from 'three';

// ─── 2D Sprite Renderer ────────────────────────────────────────────
// Renders 2D sprites using Three.js orthographic camera and planes.
// Supports sprite sheets, animations, batching, z-ordering, flipping.

export interface SpriteFrame {
  x: number;       // pixel X in spritesheet
  y: number;       // pixel Y in spritesheet
  width: number;   // frame width in pixels
  height: number;  // frame height in pixels
}

export interface SpriteSheetConfig {
  texture: THREE.Texture;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  /** Total frames (defaults to columns * rows) */
  totalFrames?: number;
}

export interface SpriteAnimationClip {
  name: string;
  frames: number[]; // frame indices
  fps: number;
  loop: boolean;
}

// ── Sprite Sheet ──────────────────────────────────────────────────

export class SpriteSheet {
  public texture: THREE.Texture;
  public frames: SpriteFrame[] = [];
  public frameWidth: number;
  public frameHeight: number;
  public columns: number;
  public rows: number;

  constructor(config: SpriteSheetConfig) {
    this.texture = config.texture;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.frameWidth = config.frameWidth;
    this.frameHeight = config.frameHeight;
    this.columns = config.columns;
    this.rows = config.rows;

    const totalFrames = config.totalFrames ?? config.columns * config.rows;
    for (let i = 0; i < totalFrames; i++) {
      const col = i % config.columns;
      const row = Math.floor(i / config.columns);
      this.frames.push({
        x: col * config.frameWidth,
        y: row * config.frameHeight,
        width: config.frameWidth,
        height: config.frameHeight,
      });
    }
  }

  /** Get UV coordinates for a specific frame */
  getFrameUVs(frameIndex: number): { offsetX: number; offsetY: number; repeatX: number; repeatY: number } {
    const frame = this.frames[frameIndex % this.frames.length];
    const texW = this.texture.image?.width ?? this.columns * this.frameWidth;
    const texH = this.texture.image?.height ?? this.rows * this.frameHeight;

    return {
      offsetX: frame.x / texW,
      offsetY: 1 - (frame.y + frame.height) / texH,
      repeatX: frame.width / texW,
      repeatY: frame.height / texH,
    };
  }
}

// ── Sprite (individual 2D object) ─────────────────────────────────

export class Sprite2D {
  public mesh: THREE.Mesh;
  public spriteSheet: SpriteSheet | null = null;
  public material: THREE.MeshBasicMaterial;
  public layer = 0;       // z-order (higher = in front)
  public flipX = false;
  public flipY = false;
  public pixelWidth: number;
  public pixelHeight: number;
  public anchor = { x: 0.5, y: 0.5 }; // 0-1, center by default
  public visible = true;
  public tint = new THREE.Color(1, 1, 1);

  // Animation
  private animations = new Map<string, SpriteAnimationClip>();
  private currentAnimation: SpriteAnimationClip | null = null;
  private animFrame = 0;
  private animTimer = 0;
  public currentFrameIndex = 0;

  // Pixel-per-unit scale
  private ppu: number;

  constructor(
    texture: THREE.Texture | SpriteSheet,
    width?: number,
    height?: number,
    pixelsPerUnit = 16,
  ) {
    this.ppu = pixelsPerUnit;

    if (texture instanceof SpriteSheet) {
      this.spriteSheet = texture;
      this.pixelWidth = width ?? texture.frameWidth;
      this.pixelHeight = height ?? texture.frameHeight;
      this.material = new THREE.MeshBasicMaterial({
        map: texture.texture.clone(),
        transparent: true,
        side: THREE.DoubleSide,
      });
    } else {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      this.pixelWidth = width ?? texture.image?.width ?? 16;
      this.pixelHeight = height ?? texture.image?.height ?? 16;
      this.material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      });
    }

    const worldW = this.pixelWidth / this.ppu;
    const worldH = this.pixelHeight / this.ppu;
    const geo = new THREE.PlaneGeometry(worldW, worldH);
    this.mesh = new THREE.Mesh(geo, this.material);
  }

  /** Add a named animation */
  addAnimation(clip: SpriteAnimationClip): this {
    this.animations.set(clip.name, clip);
    return this;
  }

  /** Play a named animation */
  play(name: string): void {
    const clip = this.animations.get(name);
    if (!clip || clip === this.currentAnimation) return;
    this.currentAnimation = clip;
    this.animFrame = 0;
    this.animTimer = 0;
    this.setFrame(clip.frames[0]);
  }

  /** Stop animation */
  stop(): void {
    this.currentAnimation = null;
  }

  /** Set a specific frame from the spritesheet */
  setFrame(frameIndex: number): void {
    if (!this.spriteSheet || !this.material.map) return;
    this.currentFrameIndex = frameIndex;
    const uvs = this.spriteSheet.getFrameUVs(frameIndex);
    this.material.map.offset.set(uvs.offsetX, uvs.offsetY);
    this.material.map.repeat.set(uvs.repeatX, uvs.repeatY);
  }

  /** Set position in world units */
  setPosition(x: number, y: number): void {
    this.mesh.position.set(x, y, this.layer * 0.01);
  }

  /** Set scale */
  setScale(x: number, y: number): void {
    this.mesh.scale.set(
      x * (this.flipX ? -1 : 1),
      y * (this.flipY ? -1 : 1),
      1,
    );
  }

  /** Set rotation in radians */
  setRotation(angle: number): void {
    this.mesh.rotation.z = angle;
  }

  /** Set opacity (0-1) */
  setOpacity(alpha: number): void {
    this.material.opacity = alpha;
    this.material.transparent = alpha < 1;
  }

  /** Update animation (call each frame) */
  update(delta: number): void {
    if (!this.currentAnimation || !this.spriteSheet) return;

    this.animTimer += delta;
    const frameDuration = 1 / this.currentAnimation.fps;

    if (this.animTimer >= frameDuration) {
      this.animTimer -= frameDuration;
      this.animFrame++;

      if (this.animFrame >= this.currentAnimation.frames.length) {
        if (this.currentAnimation.loop) {
          this.animFrame = 0;
        } else {
          this.animFrame = this.currentAnimation.frames.length - 1;
          this.currentAnimation = null;
          return;
        }
      }

      if (this.currentAnimation) {
        this.setFrame(this.currentAnimation.frames[this.animFrame]);
      }
    }

    // Update flip
    const scaleX = Math.abs(this.mesh.scale.x) * (this.flipX ? -1 : 1);
    const scaleY = Math.abs(this.mesh.scale.y) * (this.flipY ? -1 : 1);
    this.mesh.scale.set(scaleX, scaleY, 1);

    // Update tint
    this.material.color.copy(this.tint);
    this.mesh.visible = this.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ── 2D Camera ─────────────────────────────────────────────────────

export class Camera2D {
  public camera: THREE.OrthographicCamera;
  public position = { x: 0, y: 0 };
  public zoom = 1;
  public rotation = 0;
  public pixelsPerUnit: number;

  // Smooth follow
  public target: { x: number; y: number } | null = null;
  public followSmoothing = 5;
  public deadZone = { x: 0, y: 0 }; // dead zone in world units

  // Bounds
  public bounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  // Shake
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTimer = 0;
  private shakeOffset = { x: 0, y: 0 };

  constructor(pixelsPerUnit = 16) {
    this.pixelsPerUnit = pixelsPerUnit;
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = window.innerHeight / pixelsPerUnit / 2;
    const halfW = halfH * aspect;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
    this.camera.position.z = 100;
  }

  /** Smoothly follow a target position */
  follow(x: number, y: number): void {
    this.target = { x, y };
  }

  /** Camera shake effect */
  shake(intensity: number, duration: number): void {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = 0;
  }

  /** Set camera bounds to prevent scrolling outside the map */
  setBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    this.bounds = { minX, minY, maxX, maxY };
  }

  /** Update camera (call each frame) */
  update(delta: number): void {
    // Follow target
    if (this.target) {
      const dx = this.target.x - this.position.x;
      const dy = this.target.y - this.position.y;

      // Apply dead zone
      if (Math.abs(dx) > this.deadZone.x) {
        this.position.x += dx * this.followSmoothing * delta;
      }
      if (Math.abs(dy) > this.deadZone.y) {
        this.position.y += dy * this.followSmoothing * delta;
      }
    }

    // Clamp to bounds
    if (this.bounds) {
      this.position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.position.x));
      this.position.y = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, this.position.y));
    }

    // Shake
    if (this.shakeTimer < this.shakeDuration) {
      this.shakeTimer += delta;
      const decay = 1 - this.shakeTimer / this.shakeDuration;
      const intensity = this.shakeIntensity * decay;
      this.shakeOffset.x = (Math.random() * 2 - 1) * intensity;
      this.shakeOffset.y = (Math.random() * 2 - 1) * intensity;
    } else {
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
    }

    // Apply to THREE camera
    this.camera.position.x = this.position.x + this.shakeOffset.x;
    this.camera.position.y = this.position.y + this.shakeOffset.y;
    this.camera.rotation.z = this.rotation;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
  }

  /** Convert screen coordinates to world coordinates */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = window.innerHeight / this.pixelsPerUnit / 2 / this.zoom;
    const halfW = halfH * aspect;

    const nx = (screenX / window.innerWidth) * 2 - 1;
    const ny = -(screenY / window.innerHeight) * 2 + 1;

    return {
      x: this.position.x + nx * halfW,
      y: this.position.y + ny * halfH,
    };
  }

  /** Resize camera viewport */
  resize(width: number, height: number): void {
    const aspect = width / height;
    const halfH = height / this.pixelsPerUnit / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }
}

// ── 2D Tilemap ────────────────────────────────────────────────────

export interface TileDefinition {
  id: number;
  name: string;
  frame: number;       // frame index in the tileset sprite sheet
  walkable: boolean;
  properties?: Record<string, any>;
}

export interface TilemapLayerConfig {
  name: string;
  data: number[][]; // 2D array of tile IDs (0 = empty)
  visible?: boolean;
  opacity?: number;
  zIndex?: number;
}

export class Tilemap {
  public tileWidth: number;
  public tileHeight: number;
  public mapWidth: number;  // in tiles
  public mapHeight: number; // in tiles
  public pixelsPerUnit: number;
  public layers: TilemapLayer[] = [];
  public tileDefinitions = new Map<number, TileDefinition>();
  public tilesetSheet: SpriteSheet;
  public root = new THREE.Group();

  constructor(
    tilesetSheet: SpriteSheet,
    tileWidth: number,
    tileHeight: number,
    pixelsPerUnit = 16,
  ) {
    this.tilesetSheet = tilesetSheet;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.pixelsPerUnit = pixelsPerUnit;
  }

  /** Define a tile type */
  defineTile(id: number, name: string, frame: number, walkable = true, properties?: Record<string, any>): this {
    this.tileDefinitions.set(id, { id, name, frame, walkable, properties });
    return this;
  }

  /** Add a layer to the tilemap */
  addLayer(config: TilemapLayerConfig): TilemapLayer {
    const layer = new TilemapLayer(this, config);
    this.layers.push(layer);
    this.root.add(layer.group);

    // Update map dimensions
    if (config.data.length > 0) {
      this.mapHeight = Math.max(this.mapHeight, config.data.length);
      this.mapWidth = Math.max(this.mapWidth, config.data[0].length);
    }

    return layer;
  }

  /** Build all layers (creates meshes) */
  build(): void {
    for (const layer of this.layers) {
      layer.build();
    }
  }

  /** Flush all dirty layers (call once per frame) */
  flush(): void {
    for (const layer of this.layers) {
      layer.flush();
    }
  }

  /** Get tile at grid position from a specific layer */
  getTile(layerIndex: number, x: number, y: number): number {
    if (layerIndex < 0 || layerIndex >= this.layers.length) return 0;
    return this.layers[layerIndex].getTile(x, y);
  }

  /** Set tile at grid position in a specific layer */
  setTile(layerIndex: number, x: number, y: number, tileId: number): void {
    if (layerIndex < 0 || layerIndex >= this.layers.length) return;
    this.layers[layerIndex].setTile(x, y, tileId);
  }

  /** Check if a grid position is walkable (checks all layers) */
  isWalkable(x: number, y: number): boolean {
    for (const layer of this.layers) {
      const tileId = layer.getTile(x, y);
      if (tileId === 0) continue;
      const def = this.tileDefinitions.get(tileId);
      if (def && !def.walkable) return false;
    }
    return true;
  }

  /** Convert world position to grid position */
  worldToGrid(worldX: number, worldY: number): { x: number; y: number } {
    const tileW = this.tileWidth / this.pixelsPerUnit;
    const tileH = this.tileHeight / this.pixelsPerUnit;
    return {
      x: Math.floor(worldX / tileW),
      y: Math.floor(worldY / tileH),
    };
  }

  /** Convert grid position to world center position */
  gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    const tileW = this.tileWidth / this.pixelsPerUnit;
    const tileH = this.tileHeight / this.pixelsPerUnit;
    return {
      x: gridX * tileW + tileW / 2,
      y: gridY * tileH + tileH / 2,
    };
  }

  /** Get map size in world units */
  getWorldSize(): { width: number; height: number } {
    return {
      width: this.mapWidth * this.tileWidth / this.pixelsPerUnit,
      height: this.mapHeight * this.tileHeight / this.pixelsPerUnit,
    };
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
    this.layers.length = 0;
  }
}

// ── Tilemap Layer ─────────────────────────────────────────────────

export class TilemapLayer {
  public name: string;
  private tilemap: Tilemap;
  private data: number[][];
  public group = new THREE.Group();
  private tileMeshes: (THREE.Mesh | null)[][] = [];
  private opacity: number;
  /** Single batched mesh for the entire layer (1 draw call) */
  private batchedMesh: THREE.Mesh | null = null;
  private dirty = false;

  constructor(tilemap: Tilemap, config: TilemapLayerConfig) {
    this.name = config.name;
    this.tilemap = tilemap;
    this.data = config.data.map((row) => [...row]);
    this.group.visible = config.visible ?? true;
    this.opacity = config.opacity ?? 1;
    this.group.position.z = (config.zIndex ?? 0) * 0.01;
  }

  build(): void {
    // Clear existing
    this.dispose();

    const tileW = this.tilemap.tileWidth / this.tilemap.pixelsPerUnit;
    const tileH = this.tilemap.tileHeight / this.tilemap.pixelsPerUnit;

    // Count visible tiles to pre-allocate buffers
    let tileCount = 0;
    for (let y = 0; y < this.data.length; y++) {
      for (let x = 0; x < this.data[y].length; x++) {
        const id = this.data[y][x];
        if (id !== 0 && this.tilemap.tileDefinitions.has(id)) tileCount++;
      }
    }

    if (tileCount === 0) return;

    // Build single merged geometry — 4 verts + 6 indices per tile
    const positions = new Float32Array(tileCount * 4 * 3);
    const uvs = new Float32Array(tileCount * 4 * 2);
    const indices = new Uint32Array(tileCount * 6);
    let vi = 0; // vertex index
    let ii = 0; // index index
    let qi = 0; // quad index

    this.tileMeshes = [];

    for (let y = 0; y < this.data.length; y++) {
      this.tileMeshes[y] = [];
      for (let x = 0; x < this.data[y].length; x++) {
        const tileId = this.data[y][x];
        if (tileId === 0) { this.tileMeshes[y][x] = null; continue; }

        const def = this.tilemap.tileDefinitions.get(tileId);
        if (!def) { this.tileMeshes[y][x] = null; continue; }

        const uv = this.tilemap.tilesetSheet.getFrameUVs(def.frame);
        const px = x * tileW;
        const py = -(y * tileH);

        // Quad: bottom-left, bottom-right, top-right, top-left
        const base = qi * 4;
        // positions (3 floats per vertex)
        positions[vi]     = px;           positions[vi + 1] = py - tileH;  positions[vi + 2] = 0;
        positions[vi + 3] = px + tileW;   positions[vi + 4] = py - tileH;  positions[vi + 5] = 0;
        positions[vi + 6] = px + tileW;   positions[vi + 7] = py;          positions[vi + 8] = 0;
        positions[vi + 9] = px;           positions[vi + 10] = py;         positions[vi + 11] = 0;
        vi += 12;

        // UVs (map from offset+repeat to actual corners)
        const u0 = uv.offsetX;
        const v0 = uv.offsetY;
        const u1 = uv.offsetX + uv.repeatX;
        const v1 = uv.offsetY + uv.repeatY;
        uvs[qi * 8]     = u0; uvs[qi * 8 + 1] = v0; // BL
        uvs[qi * 8 + 2] = u1; uvs[qi * 8 + 3] = v0; // BR
        uvs[qi * 8 + 4] = u1; uvs[qi * 8 + 5] = v1; // TR
        uvs[qi * 8 + 6] = u0; uvs[qi * 8 + 7] = v1; // TL

        // Indices (2 triangles)
        indices[ii]     = base;     indices[ii + 1] = base + 1; indices[ii + 2] = base + 2;
        indices[ii + 3] = base;     indices[ii + 4] = base + 2; indices[ii + 5] = base + 3;
        ii += 6;
        qi++;

        // Store null — no per-tile mesh needed in batched mode
        this.tileMeshes[y][x] = null;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const mat = new THREE.MeshBasicMaterial({
      map: this.tilemap.tilesetSheet.texture,
      transparent: true,
      opacity: this.opacity,
    });

    this.batchedMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.batchedMesh);
  }

  getTile(x: number, y: number): number {
    if (y < 0 || y >= this.data.length || x < 0 || x >= this.data[y].length) return 0;
    return this.data[y][x];
  }

  setTile(x: number, y: number, tileId: number): void {
    if (y < 0 || y >= this.data.length || x < 0 || x >= this.data[y].length) return;
    this.data[y][x] = tileId;
    this.dirty = true;
  }

  /** Rebuild if tiles changed. Call once per frame or on demand. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.build();
  }

  dispose(): void {
    if (this.batchedMesh) {
      this.batchedMesh.geometry.dispose();
      if (this.batchedMesh.material instanceof THREE.Material) this.batchedMesh.material.dispose();
      this.group.remove(this.batchedMesh);
      this.batchedMesh = null;
    }
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.material instanceof THREE.Material && child.material.dispose();
      }
    }
    this.tileMeshes = [];
  }
}

// ── Sprite Batcher ────────────────────────────────────────────────
// Renders many sprites sharing one SpriteSheet as a single merged
// geometry (1 draw call). Each sprite can have its own position,
// scale, rotation, frame, flip and tint.  Call rebuild() once per
// frame after modifying entries.

export interface BatchedSpriteEntry {
  x: number;
  y: number;
  /** z-order layer (converted to z = layer * 0.01) */
  layer: number;
  /** Frame index in the SpriteSheet */
  frame: number;
  scaleX: number;
  scaleY: number;
  /** Rotation in radians */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  visible: boolean;
  /** Opacity 0-1 */
  opacity: number;
}

export class SpriteBatch {
  public spriteSheet: SpriteSheet;
  public entries: BatchedSpriteEntry[] = [];
  public mesh: THREE.Mesh | null = null;
  public group = new THREE.Group();
  private pixelsPerUnit: number;
  private dirty = true;

  constructor(spriteSheet: SpriteSheet, pixelsPerUnit = 16) {
    this.spriteSheet = spriteSheet;
    this.pixelsPerUnit = pixelsPerUnit;
  }

  /** Add a sprite and return its index */
  add(x: number, y: number, frame = 0, layer = 0): number {
    this.entries.push({
      x, y, layer, frame,
      scaleX: 1, scaleY: 1, rotation: 0,
      flipX: false, flipY: false, visible: true, opacity: 1,
    });
    this.dirty = true;
    return this.entries.length - 1;
  }

  /** Mark dirty so next flush() rebuilds the mesh */
  markDirty(): void { this.dirty = true; }

  /** Rebuild geometry if dirty. Call once per frame. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }

  private rebuild(): void {
    // Dispose old
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.group.remove(this.mesh);
    }

    const visible = this.entries.filter(e => e.visible);
    if (visible.length === 0) { this.mesh = null; return; }

    const fw = this.spriteSheet.frameWidth / this.pixelsPerUnit;
    const fh = this.spriteSheet.frameHeight / this.pixelsPerUnit;
    const halfW = fw / 2;
    const halfH = fh / 2;

    const count = visible.length;
    const positions = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const colors = new Float32Array(count * 4 * 4);
    const indices = new Uint32Array(count * 6);

    let vi = 0, ui = 0, ci = 0, ii = 0, qi = 0;

    for (const e of visible) {
      const uv = this.spriteSheet.getFrameUVs(e.frame);
      const sx = e.scaleX * (e.flipX ? -1 : 1);
      const sy = e.scaleY * (e.flipY ? -1 : 1);
      const w = halfW * sx;
      const h = halfH * sy;
      const cos = Math.cos(e.rotation);
      const sin = Math.sin(e.rotation);
      const z = e.layer * 0.01;

      // 4 corners relative to center: BL, BR, TR, TL
      const corners = [
        [-w, -h], [w, -h], [w, h], [-w, h],
      ];
      for (const [cx, cy] of corners) {
        positions[vi++] = e.x + cx * cos - cy * sin;
        positions[vi++] = e.y + cx * sin + cy * cos;
        positions[vi++] = z;
      }

      const u0 = uv.offsetX;
      const v0 = uv.offsetY;
      const u1 = uv.offsetX + uv.repeatX;
      const v1 = uv.offsetY + uv.repeatY;
      uvs[ui++] = u0; uvs[ui++] = v0;
      uvs[ui++] = u1; uvs[ui++] = v0;
      uvs[ui++] = u1; uvs[ui++] = v1;
      uvs[ui++] = u0; uvs[ui++] = v1;

      for (let k = 0; k < 4; k++) {
        colors[ci++] = 1; colors[ci++] = 1; colors[ci++] = 1; colors[ci++] = e.opacity;
      }

      const base = qi * 4;
      indices[ii++] = base;     indices[ii++] = base + 1; indices[ii++] = base + 2;
      indices[ii++] = base;     indices[ii++] = base + 2; indices[ii++] = base + 3;
      qi++;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    if (!this.mesh) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.spriteSheet.texture,
        transparent: true,
        vertexColors: true,
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.group.add(this.mesh);
    } else {
      this.mesh.geometry = geo;
    }
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose();
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    this.entries.length = 0;
  }
}
