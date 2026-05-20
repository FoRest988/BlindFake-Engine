/**
 * DamagePopupSystem — Floating damage/heal/text numbers with animation.
 *
 * Features:
 *  - Spawn floating numbers at world positions
 *  - Color by damage type (physical, fire, ice, heal, critical, etc.)
 *  - Size scales with damage amount
 *  - Configurable: rise speed, duration, font, outline, random spread
 *  - Critical hit emphasis (bigger + shake)
 *  - Stacking: numbers that spawn close together merge
 *  - Billboard: always faces camera
 *  - Both 3D (Three.js sprites) and DOM overlay modes
 */

import * as THREE from 'three';

// ── Interfaces ──────────────────────────────────────────────────────────────

export type DamageType = 'physical' | 'fire' | 'ice' | 'lightning' | 'poison' | 'heal' | 'shield' | 'xp' | 'miss' | 'custom';

export interface PopupStyle {
  color: string;
  outlineColor: string;
  fontFamily: string;
  baseFontSize: number;
  /** Scale multiplier per 100 damage (so big hits = bigger text) */
  sizeScale: number;
  /** Rise speed in pixels/sec (DOM mode) or world-units/sec (3D mode) */
  riseSpeed: number;
  /** Duration before fading out */
  duration: number;
  /** Horizontal random spread */
  spreadX: number;
  /** Additional info suffix (e.g. "🔥" for fire) */
  suffix: string;
  /** Bold for critical hits */
  critMultiplier: number;
}

export interface PopupConfig {
  /** Use DOM overlay (true) or 3D sprites (false) */
  domMode: boolean;
  /** Merge popups within this world-distance */
  stackRadius: number;
  /** Max stack merge window in seconds */
  stackWindow: number;
  /** Max visible popups */
  maxPopups: number;
  /** Default style values (per-type styles override these) */
  defaultStyle: PopupStyle;
  /** Per-type style overrides */
  typeStyles: Partial<Record<DamageType, Partial<PopupStyle>>>;
}

interface ActivePopup {
  id: number;
  position: THREE.Vector3;
  screenX: number;
  screenY: number;
  value: number;
  text: string;
  type: DamageType;
  critical: boolean;
  age: number;
  duration: number;
  style: PopupStyle;
  velocityX: number;
  velocityY: number;
  element?: HTMLDivElement;
  sprite?: THREE.Sprite;
  opacity: number;
  scale: number;
}

// ── Default Styles ──────────────────────────────────────────────────────────

const DEFAULT_STYLE: PopupStyle = {
  color: '#ffffff',
  outlineColor: '#000000',
  fontFamily: 'Arial, sans-serif',
  baseFontSize: 20,
  sizeScale: 0.08,
  riseSpeed: 80,
  duration: 1.2,
  spreadX: 30,
  suffix: '',
  critMultiplier: 1.5,
};

const TYPE_STYLES: Record<DamageType, Partial<PopupStyle>> = {
  physical: { color: '#ffffff' },
  fire: { color: '#ff6622', suffix: '🔥' },
  ice: { color: '#66ccff', suffix: '❄️' },
  lightning: { color: '#ffff44', suffix: '⚡' },
  poison: { color: '#44ff44', suffix: '☠️' },
  heal: { color: '#44ff88', suffix: '+' },
  shield: { color: '#4488ff', suffix: '🛡️' },
  xp: { color: '#cc88ff', suffix: 'XP' },
  miss: { color: '#888888', baseFontSize: 16 },
  custom: {},
};

const DEFAULT_CONFIG: PopupConfig = {
  domMode: true,
  stackRadius: 1.5,
  stackWindow: 0.15,
  maxPopups: 30,
  defaultStyle: { ...DEFAULT_STYLE },
  typeStyles: TYPE_STYLES,
};

// ── DamagePopupSystem ───────────────────────────────────────────────────────

export class DamagePopupSystem {
  private config: PopupConfig;
  private popups: ActivePopup[] = [];
  private nextId = 0;
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private container: HTMLDivElement | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera, cfg?: Partial<PopupConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg };
    this.scene = scene;
    this.camera = camera;

    if (this.config.domMode) {
      this.initDOMContainer();
    }
  }

  private initDOMContainer(): void {
    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.top = '0';
    this.container.style.left = '0';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.pointerEvents = 'none';
    this.container.style.zIndex = '1000';
    this.container.style.overflow = 'hidden';
    document.body.appendChild(this.container);
  }

  // ── Resolve style ────────────────────────────────────────────────────────

  private resolveStyle(type: DamageType, critical: boolean, value: number): PopupStyle {
    const base = this.config.defaultStyle;
    const override = this.config.typeStyles[type] ?? {};
    const style: PopupStyle = { ...base, ...override };

    // Scale font by value
    const absVal = Math.abs(value);
    style.baseFontSize += absVal * style.sizeScale;

    // Critical emphasis
    if (critical) {
      style.baseFontSize *= style.critMultiplier;
    }

    return style;
  }

  // ── Spawn ────────────────────────────────────────────────────────────────

  /**
   * Spawn a damage/heal number at a world position.
   * @param worldPos Position in 3D world
   * @param value Number to display (negative = damage, positive = heal)
   * @param type Damage type for coloring
   * @param critical Whether this is a critical hit
   * @param customText Override the displayed text
   */
  spawn(worldPos: THREE.Vector3, value: number, type: DamageType = 'physical', critical = false, customText?: string): void {
    // Try to stack with nearby recent popup
    const recent = this.popups.find(p =>
      p.type === type &&
      p.age < this.config.stackWindow &&
      p.position.distanceTo(worldPos) < this.config.stackRadius
    );
    if (recent) {
      recent.value += value;
      recent.text = this.formatText(recent.value, type, critical, customText);
      recent.critical = recent.critical || critical;
      recent.style = this.resolveStyle(type, recent.critical, recent.value);
      if (recent.element) {
        recent.element.textContent = recent.text;
      }
      return;
    }

    // Cap popups
    if (this.popups.length >= this.config.maxPopups) {
      this.removePopup(this.popups[0]);
      this.popups.shift();
    }

    const style = this.resolveStyle(type, critical, value);
    const text = this.formatText(value, type, critical, customText);

    const popup: ActivePopup = {
      id: this.nextId++,
      position: worldPos.clone(),
      screenX: 0,
      screenY: 0,
      value,
      text,
      type,
      critical,
      age: 0,
      duration: style.duration,
      style,
      velocityX: (Math.random() - 0.5) * style.spreadX * 2,
      velocityY: -style.riseSpeed,
      opacity: 1,
      scale: critical ? 1.3 : 1.0,
    };

    if (this.config.domMode) {
      popup.element = this.createDOMElement(popup);
    } else {
      popup.sprite = this.create3DSprite(popup);
    }

    this.popups.push(popup);
  }

  /** Convenience: spawn "MISS" text */
  spawnMiss(worldPos: THREE.Vector3): void {
    this.spawn(worldPos, 0, 'miss', false, 'MISS');
  }

  /** Convenience: spawn custom text */
  spawnText(worldPos: THREE.Vector3, text: string, color = '#ffffff'): void {
    const cfg = { ...this.config };
    cfg.typeStyles = { ...cfg.typeStyles, custom: { color } };
    this.config = cfg;
    this.spawn(worldPos, 0, 'custom', false, text);
  }

  private formatText(value: number, type: DamageType, critical: boolean, custom?: string): string {
    if (custom) return custom;
    const style = this.resolveStyle(type, critical, value);
    const absVal = Math.abs(Math.round(value));
    const prefix = type === 'heal' || value > 0 ? '+' : '';
    const critTag = critical ? '!' : '';
    return `${prefix}${absVal}${style.suffix}${critTag}`;
  }

  // ── DOM Mode ─────────────────────────────────────────────────────────────

  private createDOMElement(popup: ActivePopup): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = popup.text;
    el.style.position = 'absolute';
    el.style.fontFamily = popup.style.fontFamily;
    el.style.fontSize = popup.style.baseFontSize + 'px';
    el.style.fontWeight = popup.critical ? '900' : '700';
    el.style.color = popup.style.color;
    el.style.textShadow = `
      -1px -1px 0 ${popup.style.outlineColor},
       1px -1px 0 ${popup.style.outlineColor},
      -1px  1px 0 ${popup.style.outlineColor},
       1px  1px 0 ${popup.style.outlineColor},
       0    0   4px ${popup.style.outlineColor}
    `;
    el.style.userSelect = 'none';
    el.style.whiteSpace = 'nowrap';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.transition = 'none';
    el.style.pointerEvents = 'none';
    this.container?.appendChild(el);
    return el;
  }

  // ── 3D Sprite Mode ───────────────────────────────────────────────────────

  private create3DSprite(popup: ActivePopup): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fontSize = popup.style.baseFontSize * 3;
    ctx.font = `${popup.critical ? '900' : '700'} ${fontSize}px ${popup.style.fontFamily}`;
    const metrics = ctx.measureText(popup.text);
    canvas.width = Math.ceil(metrics.width) + 20;
    canvas.height = fontSize + 20;

    // Redraw with proper canvas size
    ctx.font = `${popup.critical ? '900' : '700'} ${fontSize}px ${popup.style.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Outline
    ctx.strokeStyle = popup.style.outlineColor;
    ctx.lineWidth = 4;
    ctx.strokeText(popup.text, canvas.width / 2, canvas.height / 2);

    // Fill
    ctx.fillStyle = popup.style.color;
    ctx.fillText(popup.text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(popup.position);
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(aspect * 0.5, 0.5, 1);
    this.scene.add(sprite);
    return sprite;
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(delta: number): void {
    const toRemove: ActivePopup[] = [];

    for (const popup of this.popups) {
      popup.age += delta;

      // Fade out in last 30% of life
      const fadeStart = popup.duration * 0.7;
      if (popup.age > fadeStart) {
        popup.opacity = Math.max(0, 1 - (popup.age - fadeStart) / (popup.duration - fadeStart));
      }

      // Scale spring for critical
      if (popup.critical && popup.age < 0.15) {
        popup.scale = 1.3 + Math.sin(popup.age * 40) * 0.2;
      }

      if (popup.age >= popup.duration) {
        toRemove.push(popup);
        continue;
      }

      if (this.config.domMode && popup.element) {
        // Project world position to screen
        const projected = popup.position.clone().project(this.camera);
        const hw = window.innerWidth / 2;
        const hh = window.innerHeight / 2;
        popup.screenX = projected.x * hw + hw + popup.velocityX * popup.age;
        popup.screenY = -projected.y * hh + hh + popup.velocityY * popup.age;

        popup.element.style.left = popup.screenX + 'px';
        popup.element.style.top = popup.screenY + 'px';
        popup.element.style.opacity = String(popup.opacity);
        popup.element.style.transform = `translate(-50%, -50%) scale(${popup.scale})`;
      } else if (popup.sprite) {
        popup.sprite.position.y += popup.style.riseSpeed * 0.01 * delta;
        (popup.sprite.material as THREE.SpriteMaterial).opacity = popup.opacity;
      }
    }

    for (const p of toRemove) {
      this.removePopup(p);
      const idx = this.popups.indexOf(p);
      if (idx >= 0) this.popups.splice(idx, 1);
    }
  }

  private removePopup(popup: ActivePopup): void {
    if (popup.element && popup.element.parentElement) {
      popup.element.parentElement.removeChild(popup.element);
    }
    if (popup.sprite) {
      this.scene.remove(popup.sprite);
      (popup.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (popup.sprite.material as THREE.SpriteMaterial).dispose();
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  clear(): void {
    for (const p of this.popups) this.removePopup(p);
    this.popups.length = 0;
  }

  dispose(): void {
    this.clear();
    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
