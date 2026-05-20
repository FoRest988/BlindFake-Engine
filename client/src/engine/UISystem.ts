/**
 * UISystem — Canvas-overlay 2D UI for BlindFake: Phantom.
 *
 * Features:
 *  - Full widget set: Panel, Label, Button, Image, ProgressBar, Slider, Toggle, ScrollView
 *  - Anchor/alignment system relative to canvas size
 *  - Theme system with live hot-swap
 *  - Event propagation (pointer down/up/move) with hit-testing
 *  - World-space UI (billboard) marker interface for 3D integration
 */

// ── Anchor ────────────────────────────────────────────────────────────────────

export type AnchorPreset =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
  | 'stretch-full';

// ── Theme ─────────────────────────────────────────────────────────────────────

export interface UITheme {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  borderColor: string;
  textColor: string;
  mutedColor: string;
  fontFamily: string;
  fontSize: number;
  borderRadius: number;
  padding: number;
  borderWidth: number;
}

export const DEFAULT_THEME: UITheme = {
  primaryColor:     '#3B82F6',
  accentColor:      '#8B5CF6',
  backgroundColor:  'rgba(10,10,20,0.92)',
  surfaceColor:     'rgba(30,30,50,0.96)',
  borderColor:      '#2E2E50',
  textColor:        '#E0E0F0',
  mutedColor:       '#8888A0',
  fontFamily:       'system-ui, sans-serif',
  fontSize:         14,
  borderRadius:     6,
  padding:          10,
  borderWidth:      1,
};

// ── Rect ──────────────────────────────────────────────────────────────────────

export interface UIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Base Widget ───────────────────────────────────────────────────────────────

export abstract class UIWidget {
  /** Offset from anchor point (pixels). */
  x = 0;
  y = 0;
  width  = 100;
  height = 40;
  anchor: AnchorPreset = 'top-left';
  visible = true;
  enabled = true;
  /** Opaque z-order within parent (higher = on top). */
  zOrder  = 0;

  private _children: UIWidget[] = [];
  protected _parent: UIWidget | null = null;

  // ── Tree ─────────────────────────────────────────────────────────

  addChild(child: UIWidget): this {
    if (child._parent) child._parent.removeChild(child);
    child._parent = this;
    this._children.push(child);
    this._children.sort((a, b) => a.zOrder - b.zOrder);
    return this;
  }

  removeChild(child: UIWidget): this {
    const idx = this._children.indexOf(child);
    if (idx >= 0) { this._children.splice(idx, 1); child._parent = null; }
    return this;
  }

  get children(): readonly UIWidget[] { return this._children; }
  get parent(): UIWidget | null { return this._parent; }

  // ── Resolved rect (absolute canvas coordinates) ──────────────────

  resolveRect(canvasWidth: number, canvasHeight: number): UIRect {
    const parentRect = this._parent
      ? this._parent.resolveRect(canvasWidth, canvasHeight)
      : { x: 0, y: 0, width: canvasWidth, height: canvasHeight };

    if (this.anchor === 'stretch-full') {
      return { x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height };
    }

    const px = parentRect.x;
    const py = parentRect.y;
    const pw = parentRect.width;
    const ph = parentRect.height;

    let bx = 0;
    let by = 0;

    switch (this.anchor) {
      case 'top-left':       bx = px;              by = py;              break;
      case 'top-center':     bx = px + pw / 2 - this.width / 2;  by = py;  break;
      case 'top-right':      bx = px + pw - this.width;           by = py;  break;
      case 'middle-left':    bx = px;              by = py + ph / 2 - this.height / 2; break;
      case 'middle-center':  bx = px + pw / 2 - this.width / 2;  by = py + ph / 2 - this.height / 2; break;
      case 'middle-right':   bx = px + pw - this.width;           by = py + ph / 2 - this.height / 2; break;
      case 'bottom-left':    bx = px;              by = py + ph - this.height; break;
      case 'bottom-center':  bx = px + pw / 2 - this.width / 2;  by = py + ph - this.height; break;
      case 'bottom-right':   bx = px + pw - this.width;           by = py + ph - this.height; break;
    }

    return { x: bx + this.x, y: by + this.y, width: this.width, height: this.height };
  }

  hitTest(px: number, py: number, canvasWidth: number, canvasHeight: number): boolean {
    if (!this.visible) return false;
    const r = this.resolveRect(canvasWidth, canvasHeight);
    return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }

  // ── Render ────────────────────────────────────────────────────────

  renderTree(ctx: CanvasRenderingContext2D, theme: UITheme, canvasWidth: number, canvasHeight: number): void {
    if (!this.visible) return;
    this.render(ctx, theme, canvasWidth, canvasHeight);
    for (const child of this._children) child.renderTree(ctx, theme, canvasWidth, canvasHeight);
  }

  abstract render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void;

  // ── Events ────────────────────────────────────────────────────────

  /** Override to handle pointer down. Return true to consume event. */
  onPointerDown?(x: number, y: number, cw: number, ch: number): boolean;
  /** Override to handle pointer up. Return true to consume event. */
  onPointerUp?(x: number, y: number, cw: number, ch: number): boolean;
  /** Override to handle pointer move. Return true to consume event. */
  onPointerMove?(x: number, y: number, cw: number, ch: number): boolean;
}

// ── UIPanel ───────────────────────────────────────────────────────────────────

export class UIPanel extends UIWidget {
  title: string | null = null;
  titleHeight = 28;

  constructor(options: Partial<{ x: number; y: number; width: number; height: number; title: string; anchor: AnchorPreset }> = {}) {
    super();
    Object.assign(this, options);
    if (options.title !== undefined) this.title = options.title;
  }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    ctx.save();

    // Background
    ctx.fillStyle = theme.surfaceColor;
    roundRect(ctx, r.x, r.y, r.width, r.height, theme.borderRadius);
    ctx.fill();

    // Border
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth   = theme.borderWidth;
    roundRect(ctx, r.x, r.y, r.width, r.height, theme.borderRadius);
    ctx.stroke();

    // Title bar
    if (this.title) {
      ctx.fillStyle = theme.primaryColor + '22';
      roundRect(ctx, r.x, r.y, r.width, this.titleHeight, theme.borderRadius);
      ctx.fill();

      ctx.fillStyle = theme.textColor;
      ctx.font = `600 ${theme.fontSize}px ${theme.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.title, r.x + theme.padding, r.y + this.titleHeight / 2);
    }

    ctx.restore();
  }
}

// ── UILabel ───────────────────────────────────────────────────────────────────

export class UILabel extends UIWidget {
  text: string;
  textAlign: CanvasTextAlign = 'left';
  bold = false;
  fontSize: number | null = null;
  color: string | null = null;

  constructor(text: string, options: Partial<Pick<UILabel, 'x'|'y'|'width'|'height'|'anchor'|'textAlign'|'bold'|'fontSize'|'color'>> = {}) {
    super();
    this.text = text;
    Object.assign(this, options);
  }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    ctx.save();
    const size = this.fontSize ?? theme.fontSize;
    ctx.font = `${this.bold ? '700' : '400'} ${size}px ${theme.fontFamily}`;
    ctx.fillStyle = this.color ?? theme.textColor;
    ctx.textAlign = this.textAlign;
    ctx.textBaseline = 'middle';
    const tx = this.textAlign === 'center' ? r.x + r.width / 2 : this.textAlign === 'right' ? r.x + r.width : r.x;
    ctx.fillText(this.text, tx, r.y + r.height / 2);
    ctx.restore();
  }
}

// ── UIButton ──────────────────────────────────────────────────────────────────

export class UIButton extends UIWidget {
  label: string;
  private _pressed  = false;
  private _hovered  = false;
  onClick: (() => void) | null = null;

  constructor(label: string, options: Partial<Pick<UIButton, 'x'|'y'|'width'|'height'|'anchor'|'onClick'>> = {}) {
    super();
    this.label  = label;
    this.width  = 120;
    this.height = 36;
    Object.assign(this, options);
  }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    ctx.save();

    // Fill
    const base = this.enabled
      ? (this._pressed ? theme.accentColor : this._hovered ? theme.primaryColor + 'CC' : theme.primaryColor)
      : theme.mutedColor;
    ctx.fillStyle = base;
    roundRect(ctx, r.x, r.y, r.width, r.height, theme.borderRadius);
    ctx.fill();

    // Label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${theme.fontSize}px ${theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, r.x + r.width / 2, r.y + r.height / 2);

    ctx.restore();
  }

  onPointerDown(px: number, py: number, cw: number, ch: number): boolean {
    if (!this.enabled) return false;
    if (this.hitTest(px, py, cw, ch)) { this._pressed = true; return true; }
    return false;
  }

  onPointerUp(px: number, py: number, cw: number, ch: number): boolean {
    if (this._pressed && this.hitTest(px, py, cw, ch)) {
      this._pressed = false;
      this.onClick?.();
      return true;
    }
    this._pressed = false;
    return false;
  }

  onPointerMove(px: number, py: number, cw: number, ch: number): boolean {
    this._hovered = this.hitTest(px, py, cw, ch);
    return false;
  }

  get isPressed(): boolean  { return this._pressed; }
  get isHovered(): boolean  { return this._hovered; }
}

// ── UIProgressBar ─────────────────────────────────────────────────────────────

export class UIProgressBar extends UIWidget {
  private _value = 0;  // 0–1
  showLabel = true;
  labelFormat: ((v: number) => string) | null = null;

  constructor(value = 0, options: Partial<Pick<UIProgressBar, 'x'|'y'|'width'|'height'|'anchor'|'showLabel'>> = {}) {
    super();
    this._value = Math.max(0, Math.min(1, value));
    this.width  = 200;
    this.height = 20;
    Object.assign(this, options);
  }

  get value(): number { return this._value; }
  set value(v: number) { this._value = Math.max(0, Math.min(1, v)); }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    ctx.save();

    // Track
    ctx.fillStyle = theme.borderColor;
    roundRect(ctx, r.x, r.y, r.width, r.height, theme.borderRadius);
    ctx.fill();

    // Fill
    const fillW = r.width * this._value;
    if (fillW > 0) {
      ctx.fillStyle = theme.primaryColor;
      roundRect(ctx, r.x, r.y, fillW, r.height, theme.borderRadius);
      ctx.fill();
    }

    // Label
    if (this.showLabel) {
      const text = this.labelFormat ? this.labelFormat(this._value) : `${Math.round(this._value * 100)}%`;
      ctx.fillStyle = theme.textColor;
      ctx.font = `${theme.fontSize - 2}px ${theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, r.x + r.width / 2, r.y + r.height / 2);
    }

    ctx.restore();
  }
}

// ── UISlider ──────────────────────────────────────────────────────────────────

export class UISlider extends UIWidget {
  private _value = 0;  // 0–1
  min = 0;
  max = 1;
  onChange: ((value: number) => void) | null = null;
  private _dragging = false;

  constructor(value = 0, options: Partial<Pick<UISlider, 'x'|'y'|'width'|'height'|'anchor'|'min'|'max'|'onChange'>> = {}) {
    super();
    Object.assign(this, options);
    this._value = Math.max(this.min, Math.min(this.max, value));
    this.width  = 200;
    this.height = 24;
  }

  get value(): number { return this._value; }
  set value(v: number) { this._value = Math.max(this.min, Math.min(this.max, v)); }
  get normalizedValue(): number { return (this._value - this.min) / (this.max - this.min || 1); }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    const track = { x: r.x, y: r.y + r.height / 2 - 3, width: r.width, height: 6 };
    const thumbX = r.x + this.normalizedValue * r.width;
    const thumbR = 10;

    ctx.save();

    // Track
    ctx.fillStyle = theme.borderColor;
    roundRect(ctx, track.x, track.y, track.width, track.height, 3);
    ctx.fill();

    // Filled portion
    ctx.fillStyle = theme.primaryColor;
    roundRect(ctx, track.x, track.y, thumbX - track.x, track.height, 3);
    ctx.fill();

    // Thumb
    ctx.beginPath();
    ctx.arc(thumbX, r.y + r.height / 2, thumbR, 0, Math.PI * 2);
    ctx.fillStyle = this._dragging ? theme.accentColor : theme.primaryColor;
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  private _setFromPointer(px: number, r: UIRect): void {
    const norm = Math.max(0, Math.min(1, (px - r.x) / r.width));
    this._value = this.min + norm * (this.max - this.min);
    this.onChange?.(this._value);
  }

  onPointerDown(px: number, py: number, cw: number, ch: number): boolean {
    if (!this.enabled || !this.hitTest(px, py, cw, ch)) return false;
    this._dragging = true;
    this._setFromPointer(px, this.resolveRect(cw, ch));
    return true;
  }

  onPointerMove(px: number, _py: number, cw: number, ch: number): boolean {
    if (this._dragging) { this._setFromPointer(px, this.resolveRect(cw, ch)); return true; }
    return false;
  }

  onPointerUp(_px: number, _py: number, _cw: number, _ch: number): boolean {
    this._dragging = false;
    return false;
  }

  get isDragging(): boolean { return this._dragging; }
}

// ── UIToggle ──────────────────────────────────────────────────────────────────

export class UIToggle extends UIWidget {
  private _checked: boolean;
  label: string;
  onChange: ((checked: boolean) => void) | null = null;

  constructor(label: string, checked = false, options: Partial<Pick<UIToggle, 'x'|'y'|'width'|'height'|'anchor'|'onChange'>> = {}) {
    super();
    this.label    = label;
    this._checked = checked;
    this.width    = 160;
    this.height   = 28;
    Object.assign(this, options);
  }

  get checked(): boolean { return this._checked; }
  set checked(v: boolean) { this._checked = v; }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    const tw = 40;
    const th = 20;
    const tx = r.x;
    const ty = r.y + (r.height - th) / 2;
    const knobX = this._checked ? tx + tw - th + 2 : tx + 2;

    ctx.save();

    // Track
    ctx.fillStyle = this._checked ? theme.primaryColor : theme.borderColor;
    roundRect(ctx, tx, ty, tw, th, th / 2);
    ctx.fill();

    // Knob
    ctx.beginPath();
    ctx.arc(knobX + (th - 4) / 2, ty + th / 2, (th - 4) / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    // Label
    ctx.fillStyle = theme.textColor;
    ctx.font = `${theme.fontSize}px ${theme.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, tx + tw + 8, r.y + r.height / 2);

    ctx.restore();
  }

  onPointerDown(px: number, py: number, cw: number, ch: number): boolean {
    if (!this.enabled || !this.hitTest(px, py, cw, ch)) return false;
    return true;
  }

  onPointerUp(px: number, py: number, cw: number, ch: number): boolean {
    if (!this.enabled) return false;
    if (this.hitTest(px, py, cw, ch)) {
      this._checked = !this._checked;
      this.onChange?.(this._checked);
      return true;
    }
    return false;
  }
}

// ── UIImage ───────────────────────────────────────────────────────────────────

export class UIImage extends UIWidget {
  private _img: HTMLImageElement | ImageBitmap | null = null;
  tint: string | null = null;
  objectFit: 'fill' | 'contain' | 'cover' = 'fill';

  constructor(src?: string | HTMLImageElement, options: Partial<Pick<UIImage, 'x'|'y'|'width'|'height'|'anchor'|'tint'|'objectFit'>> = {}) {
    super();
    this.width  = 64;
    this.height = 64;
    Object.assign(this, options);
    if (typeof src === 'string') {
      const img = new Image();
      img.src = src;
      this._img = img;
    } else if (src) {
      this._img = src;
    }
  }

  setImage(img: HTMLImageElement | ImageBitmap): void { this._img = img; }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    ctx.save();

    if (this._img) {
      ctx.drawImage(this._img as CanvasImageSource, r.x, r.y, r.width, r.height);
    } else {
      // Placeholder
      ctx.fillStyle = theme.borderColor;
      roundRect(ctx, r.x, r.y, r.width, r.height, theme.borderRadius);
      ctx.fill();
    }

    if (this.tint) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = this.tint;
      ctx.fillRect(r.x, r.y, r.width, r.height);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }
}

// ── UIScrollView ──────────────────────────────────────────────────────────────

export class UIScrollView extends UIWidget {
  scrollY = 0;
  contentHeight = 0;
  private _isDragging = false;
  private _dragStartY = 0;
  private _dragStartScroll = 0;

  constructor(options: Partial<Pick<UIScrollView, 'x'|'y'|'width'|'height'|'anchor'>> = {}) {
    super();
    this.width  = 200;
    this.height = 200;
    Object.assign(this, options);
  }

  render(ctx: CanvasRenderingContext2D, theme: UITheme, cw: number, ch: number): void {
    const r = this.resolveRect(cw, ch);
    ctx.save();

    // Clip
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.clip();

    // Background
    ctx.fillStyle = theme.backgroundColor;
    ctx.fillRect(r.x, r.y, r.width, r.height);

    // Render children with scroll offset
    const maxScroll = Math.max(0, this.contentHeight - r.height);
    this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));

    ctx.translate(0, -this.scrollY);
    for (const child of this.children) {
      child.renderTree(ctx, theme, cw, ch);
    }
    ctx.translate(0, this.scrollY);

    // Scrollbar
    if (this.contentHeight > r.height) {
      const barH = (r.height / this.contentHeight) * r.height;
      const barY = r.y + (this.scrollY / this.contentHeight) * r.height;
      ctx.fillStyle = theme.mutedColor + '66';
      roundRect(ctx, r.x + r.width - 6, barY, 4, barH, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  onPointerDown(px: number, py: number, cw: number, ch: number): boolean {
    if (this.hitTest(px, py, cw, ch)) {
      this._isDragging   = true;
      this._dragStartY    = py;
      this._dragStartScroll = this.scrollY;
      return true;
    }
    return false;
  }

  onPointerMove(_px: number, py: number, _cw: number, _ch: number): boolean {
    if (this._isDragging) {
      this.scrollY = this._dragStartScroll - (py - this._dragStartY);
      return true;
    }
    return false;
  }

  onPointerUp(_px: number, _py: number, _cw: number, _ch: number): boolean {
    this._isDragging = false;
    return false;
  }
}

// ── UICanvas (root renderer) ──────────────────────────────────────────────────

export class UICanvas {
  private _widgets: UIWidget[] = [];
  private _theme: UITheme      = { ...DEFAULT_THEME };
  private _width  = 0;
  private _height = 0;

  constructor(width = 1280, height = 720) {
    this._width  = width;
    this._height = height;
  }

  add(widget: UIWidget): this {
    if (!this._widgets.includes(widget)) {
      this._widgets.push(widget);
      this._widgets.sort((a, b) => a.zOrder - b.zOrder);
    }
    return this;
  }

  remove(widget: UIWidget): this {
    const idx = this._widgets.indexOf(widget);
    if (idx >= 0) this._widgets.splice(idx, 1);
    return this;
  }

  clear(): this { this._widgets = []; return this; }

  setTheme(partial: Partial<UITheme>): this {
    Object.assign(this._theme, partial);
    return this;
  }

  get theme(): UITheme { return { ...this._theme }; }

  resize(w: number, h: number): void { this._width = w; this._height = h; }

  get width():  number { return this._width; }
  get height(): number { return this._height; }

  render(ctx: CanvasRenderingContext2D): void {
    for (const w of this._widgets) {
      w.renderTree(ctx, this._theme, this._width, this._height);
    }
  }

  // ── Input dispatch ──────────────────────────────────────────────

  private _dispatchEvent(
    type: 'down' | 'up' | 'move',
    px: number, py: number,
  ): boolean {
    // Iterate in reverse z-order (top-most first)
    for (let i = this._widgets.length - 1; i >= 0; i--) {
      const w = this._widgets[i];
      let consumed = false;
      switch (type) {
        case 'down': consumed = w.onPointerDown?.(px, py, this._width, this._height) ?? false; break;
        case 'up':   consumed = w.onPointerUp?.(px, py, this._width, this._height)   ?? false; break;
        case 'move': consumed = w.onPointerMove?.(px, py, this._width, this._height)  ?? false; break;
      }
      if (consumed) return true;
    }
    return false;
  }

  pointerDown(x: number, y: number): boolean  { return this._dispatchEvent('down', x, y); }
  pointerUp(x: number, y: number): boolean    { return this._dispatchEvent('up',   x, y); }
  pointerMove(x: number, y: number): boolean  { return this._dispatchEvent('move', x, y); }

  getWidgets(): readonly UIWidget[] { return this._widgets; }
}

// ── World-space UI marker ─────────────────────────────────────────────────────

/**
 * Attach this to a THREE.Object3D to render a UICanvas as a billboard in 3D space.
 * The game loop is responsible for projecting the world position to screen coords
 * and rendering the attached UICanvas at that location.
 */
export interface WorldSpaceUI {
  canvas: UICanvas;
  /** World space size in units */
  worldWidth: number;
  worldHeight: number;
  /** Whether to always face the camera */
  billboard: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
): void {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
}
