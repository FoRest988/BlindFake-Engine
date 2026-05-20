/**
 * TouchInputManager — Unified touch and pointer input for mobile & desktop.
 *
 * Wraps the Web Pointer Events API (pointermove/pointerdown/pointerup) with:
 *  - Multi-touch tracking (up to 10 simultaneous touches)
 *  - Gesture recognition: Tap, DoubleTap, LongPress, Swipe, Pinch, Pan
 *  - Configurable thresholds
 *  - TypeScript event callbacks — no EventTarget coupling
 *
 * Usage:
 *   const tim = new TouchInputManager(canvas);
 *   tim.on('tap',   ({ x, y })       => handleTap(x, y));
 *   tim.on('swipe', ({ direction })  => handleSwipe(direction));
 *   tim.on('pinch', ({ scale })      => handleZoom(scale));
 *   tim.on('pan',   ({ dx, dy })     => handlePan(dx, dy));
 *   // In your cleanup:
 *   tim.dispose();
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

export interface TapEvent       { x: number; y: number; }
export interface DoubleTapEvent { x: number; y: number; }
export interface LongPressEvent { x: number; y: number; }
export interface SwipeEvent     { direction: SwipeDirection; startX: number; startY: number; endX: number; endY: number; velocity: number; }
export interface PinchEvent     { scale: number; centerX: number; centerY: number; }
export interface PanEvent       { dx: number; dy: number; x: number; y: number; }
export interface PointerRawEvent { x: number; y: number; pointerId: number; type: 'down' | 'up' | 'move'; }

export interface TouchManagerEvents {
  tap:        TapEvent;
  doubletap:  DoubleTapEvent;
  longpress:  LongPressEvent;
  swipe:      SwipeEvent;
  pinch:      PinchEvent;
  pan:        PanEvent;
  pointerraw: PointerRawEvent;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface TouchManagerConfig {
  tapMaxMs:        number;   // max duration for a tap (default 250 ms)
  tapMaxPx:        number;   // max movement for a tap (default 10 px)
  doubleTapMaxMs:  number;   // window for double-tap (default 300 ms)
  longPressMs:     number;   // duration to trigger long press (default 600 ms)
  swipeMinPx:      number;   // min displacement for a swipe (default 50 px)
  swipeMaxMs:      number;   // max duration for a swipe (default 400 ms)
  panMinPx:        number;   // min displacement to start pan (default 5 px)
}

const DEFAULT_CONFIG: TouchManagerConfig = {
  tapMaxMs:       250,
  tapMaxPx:       10,
  doubleTapMaxMs: 300,
  longPressMs:    600,
  swipeMinPx:     50,
  swipeMaxMs:     400,
  panMinPx:       5,
};

// ── TouchInputManager ─────────────────────────────────────────────────────────

type EventMap = { [K in keyof TouchManagerEvents]: Array<(e: TouchManagerEvents[K]) => void> };

export class TouchInputManager {
  private cfg: TouchManagerConfig;
  private element: HTMLElement;

  private points = new Map<number, TouchPoint>();
  private listeners: Partial<EventMap> = {};

  // Tap / double-tap tracking
  private _lastTapTime  = 0;
  private _lastTapX     = 0;
  private _lastTapY     = 0;

  // Long press
  private _longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private _longPressActive = false;

  // Pan
  private _isPanning = false;
  private _panLastX  = 0;
  private _panLastY  = 0;

  // Bound handlers (kept for removal)
  private _onDown: (e: PointerEvent) => void;
  private _onUp:   (e: PointerEvent) => void;
  private _onMove: (e: PointerEvent) => void;

  constructor(element: HTMLElement, config: Partial<TouchManagerConfig> = {}) {
    this.element = element;
    this.cfg     = { ...DEFAULT_CONFIG, ...config };

    this._onDown = this._handleDown.bind(this);
    this._onUp   = this._handleUp.bind(this);
    this._onMove = this._handleMove.bind(this);

    element.addEventListener('pointerdown', this._onDown);
    element.addEventListener('pointerup',   this._onUp);
    element.addEventListener('pointermove', this._onMove);
    element.addEventListener('pointercancel', this._onUp);
    element.style.touchAction = 'none'; // prevent native scroll
  }

  // ── Subscription ─────────────────────────────────────────────────

  on<K extends keyof TouchManagerEvents>(event: K, handler: (e: TouchManagerEvents[K]) => void): this {
    if (!this.listeners[event]) (this.listeners as EventMap)[event] = [];
    (this.listeners[event] as Array<(e: TouchManagerEvents[K]) => void>).push(handler);
    return this;
  }

  off<K extends keyof TouchManagerEvents>(event: K, handler: (e: TouchManagerEvents[K]) => void): this {
    const list = this.listeners[event] as Array<(e: TouchManagerEvents[K]) => void> | undefined;
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
    return this;
  }

  private _emit<K extends keyof TouchManagerEvents>(event: K, data: TouchManagerEvents[K]): void {
    const list = this.listeners[event];
    if (list) for (const fn of list) fn(data as never);
  }

  // ── Pointer → canvas coords ───────────────────────────────────────

  private _coords(e: PointerEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── Event handlers ────────────────────────────────────────────────

  private _handleDown(e: PointerEvent): void {
    e.preventDefault();
    const { x, y } = this._coords(e);
    const pt: TouchPoint = { id: e.pointerId, x, y, startX: x, startY: y, startTime: Date.now() };
    this.points.set(e.pointerId, pt);
    (this.element as HTMLElement).setPointerCapture?.(e.pointerId);

    this._emit('pointerraw', { x, y, pointerId: e.pointerId, type: 'down' });

    // Long press
    this._cancelLongPress();
    this._longPressActive = false;
    this._longPressTimer = setTimeout(() => {
      this._longPressActive = true;
      this._emit('longpress', { x, y });
      this._cancelLongPress();
    }, this.cfg.longPressMs);

    // Pan reset
    this._panLastX = x;
    this._panLastY = y;
    this._isPanning = false;
  }

  private _handleMove(e: PointerEvent): void {
    const pt = this.points.get(e.pointerId);
    if (!pt) return;
    const { x, y } = this._coords(e);
    pt.x = x;
    pt.y = y;

    this._emit('pointerraw', { x, y, pointerId: e.pointerId, type: 'move' });

    // Cancel long press on movement
    const dx = x - pt.startX;
    const dy = y - pt.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.cfg.tapMaxPx) this._cancelLongPress();

    // Pinch (2 fingers)
    if (this.points.size === 2) {
      const pts = Array.from(this.points.values());
      const a = pts[0], b = pts[1];
      const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      const dStart = Math.sqrt((a.startX - b.startX) ** 2 + (a.startY - b.startY) ** 2);
      if (dStart > 1) {
        this._emit('pinch', {
          scale: d / dStart,
          centerX: (a.x + b.x) / 2,
          centerY: (a.y + b.y) / 2,
        });
      }
      return;
    }

    // Pan (1 finger, threshold exceeded)
    if (this.points.size === 1) {
      const pdx = x - this._panLastX;
      const pdy = y - this._panLastY;
      if (!this._isPanning && dist >= this.cfg.panMinPx) this._isPanning = true;
      if (this._isPanning) {
        this._emit('pan', { dx: pdx, dy: pdy, x, y });
        this._panLastX = x;
        this._panLastY = y;
      }
    }
  }

  private _handleUp(e: PointerEvent): void {
    const pt = this.points.get(e.pointerId);
    if (!pt) return;
    const { x, y } = this._coords(e);
    this._emit('pointerraw', { x, y, pointerId: e.pointerId, type: 'up' });
    this._cancelLongPress();

    if (!this._longPressActive) {
      const dt    = Date.now() - pt.startTime;
      const dx    = x - pt.startX;
      const dy    = y - pt.startY;
      const dist  = Math.sqrt(dx * dx + dy * dy);

      // Tap
      if (dt <= this.cfg.tapMaxMs && dist <= this.cfg.tapMaxPx) {
        const now = Date.now();
        if (
          now - this._lastTapTime <= this.cfg.doubleTapMaxMs &&
          Math.abs(x - this._lastTapX) <= this.cfg.tapMaxPx * 2 &&
          Math.abs(y - this._lastTapY) <= this.cfg.tapMaxPx * 2
        ) {
          this._emit('doubletap', { x, y });
          this._lastTapTime = 0;
        } else {
          this._emit('tap', { x, y });
          this._lastTapTime = now;
          this._lastTapX    = x;
          this._lastTapY    = y;
        }
      }

      // Swipe
      if (dist >= this.cfg.swipeMinPx && dt <= this.cfg.swipeMaxMs) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const dir: SwipeDirection = absDx > absDy
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down'  : 'up');
        const velocity = dist / dt; // px/ms
        this._emit('swipe', { direction: dir, startX: pt.startX, startY: pt.startY, endX: x, endY: y, velocity });
      }
    }

    this.points.delete(e.pointerId);
    this._isPanning = false;
    this._longPressActive = false;
  }

  private _cancelLongPress(): void {
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────

  get activePointerCount(): number { return this.points.size; }
  getActivePointers(): TouchPoint[] { return Array.from(this.points.values()); }

  // ── Cleanup ───────────────────────────────────────────────────────

  dispose(): void {
    this._cancelLongPress();
    this.element.removeEventListener('pointerdown',   this._onDown);
    this.element.removeEventListener('pointerup',     this._onUp);
    this.element.removeEventListener('pointermove',   this._onMove);
    this.element.removeEventListener('pointercancel', this._onUp);
    this.listeners = {};
    this.points.clear();
  }
}
