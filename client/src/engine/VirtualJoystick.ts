/**
 * VirtualJoystick — On-screen analogue joystick for mobile/touch games.
 *
 * Features:
 *  - Fixed or follow (floating) mode
 *  - Configurable radius, dead zone, visual colors
 *  - Normalised output: axis.x / axis.y in range -1..+1
 *  - Optional 8-direction discrete output
 *  - Renders to a 2D canvas context
 *  - Integrates with TouchInputManager OR can listen to raw pointer events
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type JoystickMode = 'fixed' | 'follow';
export type JoystickDirection8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'none';

export interface JoystickOptions {
  /** Canvas-space X of joystick centre (fixed mode). Default 120. */
  x?: number;
  /** Canvas-space Y of joystick centre (fixed mode). Default: canvas height - 120. */
  y?: number;
  /** Outer radius in pixels. Default 60. */
  radius?: number;
  /** Dead zone (normalised, 0–1). Default 0.15. */
  deadZone?: number;
  mode?: JoystickMode;
  /** Outer ring color. Default 'rgba(255,255,255,0.15)'. */
  ringColor?: string;
  /** Knob fill color. Default 'rgba(255,255,255,0.55)'. */
  knobColor?: string;
}

export interface JoystickAxis {
  /** Horizontal axis, -1 (left) to +1 (right). */
  x: number;
  /** Vertical axis, -1 (up) to +1 (down). */
  y: number;
  /** Magnitude 0–1. */
  magnitude: number;
}

// ── VirtualJoystick ───────────────────────────────────────────────────────────

export class VirtualJoystick {
  private _cx: number;
  private _cy: number;
  readonly radius: number;
  readonly deadZone: number;
  readonly mode: JoystickMode;

  private _originX: number;
  private _originY: number;

  private _knobX = 0;
  private _knobY = 0;
  private _active = false;
  private _pointerId: number | null = null;

  // Visuals
  private _ringColor: string;
  private _knobColor: string;

  // Axis output
  private _axis: JoystickAxis = { x: 0, y: 0, magnitude: 0 };

  // Callbacks
  onChange: ((axis: JoystickAxis) => void) | null = null;

  constructor(options: JoystickOptions = {}) {
    this.radius    = options.radius   ?? 60;
    this.deadZone  = options.deadZone ?? 0.15;
    this.mode      = options.mode     ?? 'fixed';
    this._ringColor = options.ringColor ?? 'rgba(255,255,255,0.15)';
    this._knobColor = options.knobColor ?? 'rgba(255,255,255,0.55)';
    this._cx = options.x ?? 120;
    this._cy = options.y ?? 400;
    this._originX = this._cx;
    this._originY = this._cy;
    this._knobX   = this._cx;
    this._knobY   = this._cy;
  }

  // ── Input ─────────────────────────────────────────────────────────

  /**
   * Call with raw pointer coordinates when a pointer goes down.
   * Returns true if the joystick claimed this pointer.
   */
  pointerDown(id: number, x: number, y: number): boolean {
    if (this._pointerId !== null) return false;

    // In follow mode — activate from wherever the finger lands
    if (this.mode === 'follow') {
      this._cx = x;
      this._cy = y;
    } else {
      // Fixed mode: only activate if inside the outer ring
      const dx = x - this._cx;
      const dy = y - this._cy;
      if (Math.sqrt(dx * dx + dy * dy) > this.radius * 1.5) return false;
    }

    this._pointerId = id;
    this._active    = true;
    this._originX   = this._cx;
    this._originY   = this._cy;
    this._updateKnob(x, y);
    return true;
  }

  /**
   * Call each frame / on pointermove when a pointer moves.
   */
  pointerMove(id: number, x: number, y: number): void {
    if (this._pointerId !== id) return;
    this._updateKnob(x, y);
  }

  /**
   * Call when a pointer is released.
   */
  pointerUp(id: number): void {
    if (this._pointerId !== id) return;
    this._pointerId = null;
    this._active    = false;
    this._knobX     = this._cx;
    this._knobY     = this._cy;
    this._axis      = { x: 0, y: 0, magnitude: 0 };
    if (this.mode === 'follow') {
      this._cx = this._originX;
      this._cy = this._originY;
      this._knobX = this._cx;
      this._knobY = this._cy;
    }
    this.onChange?.(this._axis);
  }

  private _updateKnob(px: number, py: number): void {
    let dx = px - this._cx;
    let dy = py - this._cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clamp knob to outer radius
    if (dist > this.radius) {
      const scale = this.radius / dist;
      dx *= scale;
      dy *= scale;
    }

    this._knobX = this._cx + dx;
    this._knobY = this._cy + dy;

    // Normalise
    const normX  = dx / this.radius;
    const normY  = dy / this.radius;
    const mag    = Math.min(1, dist / this.radius);
    const dz     = this.deadZone;

    const outX   = Math.abs(normX) > dz ? normX : 0;
    const outY   = Math.abs(normY) > dz ? normY : 0;
    const outMag = mag > dz ? mag : 0;

    this._axis = { x: outX, y: outY, magnitude: outMag };
    this.onChange?.(this._axis);
  }

  // ── Output ────────────────────────────────────────────────────────

  get axis(): JoystickAxis { return { ...this._axis }; }
  get active(): boolean    { return this._active; }

  /**
   * Returns one of 8 discrete directions or 'none' when at rest.
   */
  get direction8(): JoystickDirection8 {
    const { x, y, magnitude } = this._axis;
    if (magnitude < this.deadZone) return 'none';
    const angle = (Math.atan2(y, x) * 180) / Math.PI; // -180 to +180
    const a = ((angle + 360) % 360); // 0 to 360 (0 = East)
    if (a < 22.5  || a >= 337.5) return 'E';
    if (a < 67.5)                return 'SE';
    if (a < 112.5)               return 'S';
    if (a < 157.5)               return 'SW';
    if (a < 202.5)               return 'W';
    if (a < 247.5)               return 'NW';
    if (a < 292.5)               return 'N';
    return 'NE';
  }

  // ── Render ────────────────────────────────────────────────────────

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // Outer ring
    ctx.beginPath();
    ctx.arc(this._cx, this._cy, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = this._ringColor;
    ctx.lineWidth   = 3;
    ctx.stroke();

    // Ring fill (slightly transparent)
    ctx.fillStyle = this._ringColor.replace('0.15', '0.05');
    ctx.fill();

    // Inner border circle
    ctx.beginPath();
    ctx.arc(this._cx, this._cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = this._ringColor;
    ctx.fill();

    // Knob
    const knobRadius = this.radius * 0.38;
    ctx.beginPath();
    ctx.arc(this._knobX, this._knobY, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = this._knobColor;
    ctx.fill();

    // Knob border
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.restore();
  }

  // ── Position ──────────────────────────────────────────────────────

  setPosition(x: number, y: number): void {
    this._cx = x;
    this._cy = y;
    this._originX = x;
    this._originY = y;
    if (!this._active) {
      this._knobX = x;
      this._knobY = y;
    }
  }

  get centerX(): number { return this._cx; }
  get centerY(): number { return this._cy; }
}

// ── DualJoystickController ────────────────────────────────────────────────────

/**
 * Convenience wrapper: manages a left joystick (movement) and right
 * joystick (look/camera) with integrated pointer routing.
 */
export class DualJoystickController {
  readonly left:  VirtualJoystick;
  readonly right: VirtualJoystick;
  private _canvasW = 0;
  private _canvasH = 0;

  constructor(canvasWidth: number, canvasHeight: number, opts: { leftOpts?: JoystickOptions; rightOpts?: JoystickOptions } = {}) {
    this._canvasW = canvasWidth;
    this._canvasH = canvasHeight;

    this.left  = new VirtualJoystick({ x: 120, y: canvasHeight - 120, mode: 'follow', ...opts.leftOpts });
    this.right = new VirtualJoystick({ x: canvasWidth - 120, y: canvasHeight - 120, mode: 'follow', ...opts.rightOpts });
  }

  /** Call on canvas resize. */
  resize(w: number, h: number): void {
    this._canvasW = w;
    this._canvasH = h;
    this.left.setPosition(120, h - 120);
    this.right.setPosition(w - 120, h - 120);
  }

  /**
   * Route a pointer event to the correct joystick.
   * Should be called from your touch / pointer event listeners.
   */
  handlePointerDown(id: number, x: number, y: number): void {
    // Left half → left joystick, right half → right joystick
    if (x < this._canvasW / 2) this.left.pointerDown(id, x, y);
    else                        this.right.pointerDown(id, x, y);
  }

  handlePointerMove(id: number, x: number, y: number): void {
    this.left.pointerMove(id, x, y);
    this.right.pointerMove(id, x, y);
  }

  handlePointerUp(id: number): void {
    this.left.pointerUp(id);
    this.right.pointerUp(id);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.left.render(ctx);
    this.right.render(ctx);
  }
}
