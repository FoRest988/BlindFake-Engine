/**
 * BillboardSystem — Sprites that always face the camera.
 * Supports: full rotation, Y-axis only, animated sprite sheets,
 * damage numbers, floating text, and batched billboard groups.
 */

import * as THREE from 'three';

// ── Single Billboard Sprite ───────────────────────────────────────

export interface BillboardConfig {
  texture?: THREE.Texture;
  color?: THREE.ColorRepresentation;
  width?: number;
  height?: number;
  opacity?: number;
  /** 'full' = face camera completely, 'y' = only rotate around Y axis */
  mode?: 'full' | 'y';
  /** Enable sprite sheet animation */
  spriteSheet?: {
    cols: number;
    rows: number;
    totalFrames: number;
    fps: number;
  };
  /** Auto-dispose after this many seconds (0 = never) */
  lifetime?: number;
  /** Velocity for animated billboards (e.g., damage numbers floating up) */
  velocity?: THREE.Vector3;
  depthTest?: boolean;
  depthWrite?: boolean;
}

export class Billboard {
  public mesh: THREE.Mesh;
  public mode: 'full' | 'y';
  public velocity: THREE.Vector3;
  public lifetime: number;
  public age = 0;
  public alive = true;

  // Sprite sheet
  private spriteSheet: BillboardConfig['spriteSheet'] | undefined;
  private frameTime = 0;
  private currentFrame = 0;

  constructor(config: BillboardConfig = {}) {
    const w = config.width ?? 1;
    const h = config.height ?? 1;

    const geometry = new THREE.PlaneGeometry(w, h);
    const material = new THREE.MeshBasicMaterial({
      map: config.texture ?? null,
      color: config.color ?? 0xffffff,
      transparent: true,
      opacity: config.opacity ?? 1,
      side: THREE.DoubleSide,
      depthTest: config.depthTest ?? true,
      depthWrite: config.depthWrite ?? false,
      alphaTest: 0.01,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 999;
    this.mode = config.mode ?? 'full';
    this.velocity = config.velocity?.clone() ?? new THREE.Vector3();
    this.lifetime = config.lifetime ?? 0;
    this.spriteSheet = config.spriteSheet;

    // Set initial UV for sprite sheet
    if (this.spriteSheet) {
      this.setFrame(0);
    }
  }

  /** Update sprite sheet animation and lifetime */
  update(delta: number, camera: THREE.Camera): void {
    if (!this.alive) return;

    // Face camera
    if (this.mode === 'full') {
      this.mesh.quaternion.copy(camera.quaternion);
    } else {
      // Y-axis only: look at camera but keep upright
      const camPos = camera.position;
      const pos = this.mesh.position;
      const angle = Math.atan2(camPos.x - pos.x, camPos.z - pos.z);
      this.mesh.rotation.set(0, angle, 0);
    }

    // Apply velocity
    if (this.velocity.lengthSq() > 0) {
      this.mesh.position.addScaledVector(this.velocity, delta);
    }

    // Sprite sheet animation
    if (this.spriteSheet) {
      this.frameTime += delta;
      const frameDuration = 1 / this.spriteSheet.fps;
      if (this.frameTime >= frameDuration) {
        this.frameTime -= frameDuration;
        this.currentFrame = (this.currentFrame + 1) % this.spriteSheet.totalFrames;
        this.setFrame(this.currentFrame);
      }
    }

    // Lifetime
    if (this.lifetime > 0) {
      this.age += delta;
      if (this.age >= this.lifetime) {
        this.alive = false;
        // Fade out in last 20% of life
      } else if (this.age > this.lifetime * 0.8) {
        const fade = 1 - (this.age - this.lifetime * 0.8) / (this.lifetime * 0.2);
        (this.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
      }
    }
  }

  private setFrame(frame: number): void {
    if (!this.spriteSheet) return;
    const { cols, rows } = this.spriteSheet;
    const col = frame % cols;
    const row = Math.floor(frame / cols);

    const uSize = 1 / cols;
    const vSize = 1 / rows;
    const u = col * uSize;
    const v = 1 - (row + 1) * vSize;

    const uvAttr = this.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    uvAttr.setXY(0, u, v + vSize);         // bottom-left
    uvAttr.setXY(1, u + uSize, v + vSize); // bottom-right
    uvAttr.setXY(2, u, v);                 // top-left
    uvAttr.setXY(3, u + uSize, v);         // top-right
    uvAttr.needsUpdate = true;
  }

  dispose(): void {
    this.alive = false;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

// ── Billboard Manager ─────────────────────────────────────────────

export class BillboardManager {
  private billboards: Billboard[] = [];
  private scene: THREE.Scene | null = null;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /** Create and add a billboard to the scene */
  add(config: BillboardConfig, position?: THREE.Vector3): Billboard {
    const bb = new Billboard(config);
    if (position) bb.mesh.position.copy(position);
    this.billboards.push(bb);
    if (this.scene) this.scene.add(bb.mesh);
    return bb;
  }

  /**
   * Create a floating text billboard (damage number, label, etc.)
   * Uses canvas to render text as a texture.
   */
  addText(
    text: string,
    position: THREE.Vector3,
    options: {
      fontSize?: number;
      color?: string;
      bgColor?: string;
      floatUp?: boolean;
      lifetime?: number;
      scale?: number;
    } = {}
  ): Billboard {
    const fontSize = options.fontSize ?? 48;
    const color = options.color ?? '#ffffff';
    const bgColor = options.bgColor ?? 'transparent';
    const scale = options.scale ?? 1;

    // Render text to canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `bold ${fontSize}px Arial`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize * 1.3;

    canvas.width = Math.ceil(textWidth + 16);
    canvas.height = Math.ceil(textHeight + 8);

    if (bgColor !== 'transparent') {
      ctx.fillStyle = bgColor;
      ctx.roundRect(0, 0, canvas.width, canvas.height, 6);
      ctx.fill();
    }

    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const aspect = canvas.width / canvas.height;
    const bb = this.add(
      {
        texture,
        width: scale * aspect,
        height: scale,
        lifetime: options.lifetime ?? 2,
        velocity: options.floatUp !== false ? new THREE.Vector3(0, 1.5, 0) : undefined,
        depthTest: false,
      },
      position
    );

    return bb;
  }

  /** Spawn a damage number that floats up and fades */
  addDamageNumber(value: number, position: THREE.Vector3, critical = false): Billboard {
    return this.addText(
      critical ? `${value}!` : `${value}`,
      position.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        0.5,
        (Math.random() - 0.5) * 0.5
      )),
      {
        fontSize: critical ? 64 : 48,
        color: critical ? '#ff4444' : '#ffffff',
        floatUp: true,
        lifetime: 1.5,
        scale: critical ? 1.2 : 0.8,
      }
    );
  }

  /** Update all billboards */
  update(delta: number, camera: THREE.Camera): void {
    for (let i = this.billboards.length - 1; i >= 0; i--) {
      const bb = this.billboards[i];
      bb.update(delta, camera);

      if (!bb.alive) {
        bb.dispose();
        this.billboards.splice(i, 1);
      }
    }
  }

  /** Get count of active billboards */
  get count(): number {
    return this.billboards.length;
  }

  /** Remove all billboards */
  clear(): void {
    for (const bb of this.billboards) {
      bb.dispose();
    }
    this.billboards.length = 0;
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }
}
