import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UICanvas, UIPanel, UILabel, UIButton, UIProgressBar,
  UISlider, UIToggle, UIImage, UIScrollView,
  DEFAULT_THEME, type UITheme,
} from '../client/src/engine/UISystem';

// ── Canvas 2D mock ────────────────────────────────────────────────────────────

const mockCtx = {
  save:                   vi.fn(),
  restore:                vi.fn(),
  fillRect:               vi.fn(),
  strokeRect:             vi.fn(),
  clearRect:              vi.fn(),
  beginPath:              vi.fn(),
  moveTo:                 vi.fn(),
  lineTo:                 vi.fn(),
  arc:                    vi.fn(),
  quadraticCurveTo:       vi.fn(),
  closePath:              vi.fn(),
  fill:                   vi.fn(),
  stroke:                 vi.fn(),
  clip:                   vi.fn(),
  rect:                   vi.fn(),
  roundRect:              vi.fn(),
  translate:              vi.fn(),
  fillText:               vi.fn(),
  measureText:            vi.fn(() => ({ width: 40 })),
  drawImage:              vi.fn(),
  fillStyle:              '',
  strokeStyle:            '',
  lineWidth:              1,
  font:                   '',
  textAlign:              'left' as CanvasTextAlign,
  textBaseline:           'alphabetic' as CanvasTextBaseline,
  globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
} as unknown as CanvasRenderingContext2D;

function resetCtx(): void {
  for (const fn of Object.values(mockCtx)) {
    if (typeof fn === 'function' && (fn as ReturnType<typeof vi.fn>).mockClear) {
      (fn as ReturnType<typeof vi.fn>).mockClear();
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CW = 1280;
const CH = 720;

function makeCanvas(): UICanvas { return new UICanvas(CW, CH); }

// ── UICanvas ──────────────────────────────────────────────────────────────────

describe('UICanvas', () => {
  beforeEach(resetCtx);

  it('constructs with default size', () => {
    const c = makeCanvas();
    expect(c.width).toBe(CW);
    expect(c.height).toBe(CH);
  });

  it('adds and removes widgets', () => {
    const c = makeCanvas();
    const w = new UILabel('hi');
    c.add(w);
    expect(c.getWidgets()).toHaveLength(1);
    c.remove(w);
    expect(c.getWidgets()).toHaveLength(0);
  });

  it('clear removes all widgets', () => {
    const c = makeCanvas();
    c.add(new UILabel('a'));
    c.add(new UILabel('b'));
    c.clear();
    expect(c.getWidgets()).toHaveLength(0);
  });

  it('resize updates dimensions', () => {
    const c = makeCanvas();
    c.resize(800, 600);
    expect(c.width).toBe(800);
    expect(c.height).toBe(600);
  });

  it('setTheme merges into default', () => {
    const c = makeCanvas();
    c.setTheme({ primaryColor: '#FF0000' });
    expect(c.theme.primaryColor).toBe('#FF0000');
    expect(c.theme.textColor).toBe(DEFAULT_THEME.textColor);
  });

  it('renders without throwing', () => {
    const c = makeCanvas();
    c.add(new UILabel('test'));
    expect(() => c.render(mockCtx)).not.toThrow();
  });

  it('dispatches pointerDown to widgets', () => {
    const c = makeCanvas();
    const btn = new UIButton('Click', { x: 0, y: 0, width: 200, height: 40 });
    c.add(btn);
    expect(() => c.pointerDown(50, 10)).not.toThrow();
  });
});

// ── UIWidget tree ─────────────────────────────────────────────────────────────

describe('UIWidget tree', () => {
  it('addChild / removeChild', () => {
    const parent = new UIPanel();
    const child  = new UILabel('x');
    parent.addChild(child);
    expect(parent.children).toHaveLength(1);
    expect(child.parent).toBe(parent);
    parent.removeChild(child);
    expect(parent.children).toHaveLength(0);
    expect(child.parent).toBeNull();
  });

  it('re-parenting moves child to new parent', () => {
    const p1 = new UIPanel({ title: 'A' });
    const p2 = new UIPanel({ title: 'B' });
    const child = new UILabel('x');
    p1.addChild(child);
    p2.addChild(child); // should remove from p1
    expect(p1.children).toHaveLength(0);
    expect(p2.children).toHaveLength(1);
  });
});

// ── Anchor system ─────────────────────────────────────────────────────────────

describe('Anchor system', () => {
  const w = 100;
  const h = 40;

  it('top-left resolves to origin', () => {
    const lbl = new UILabel('x');
    lbl.width = w; lbl.height = h; lbl.anchor = 'top-left';
    const r = lbl.resolveRect(CW, CH);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('middle-center centers widget', () => {
    const lbl = new UILabel('x');
    lbl.width = w; lbl.height = h; lbl.anchor = 'middle-center';
    const r = lbl.resolveRect(CW, CH);
    expect(r.x).toBe((CW - w) / 2);
    expect(r.y).toBe((CH - h) / 2);
  });

  it('bottom-right aligns to bottom-right corner', () => {
    const lbl = new UILabel('x');
    lbl.width = w; lbl.height = h; lbl.anchor = 'bottom-right';
    const r = lbl.resolveRect(CW, CH);
    expect(r.x).toBe(CW - w);
    expect(r.y).toBe(CH - h);
  });

  it('stretch-full fills parent', () => {
    const lbl = new UILabel('x');
    lbl.anchor = 'stretch-full';
    const r = lbl.resolveRect(CW, CH);
    expect(r.width).toBe(CW);
    expect(r.height).toBe(CH);
  });

  it('offset (x, y) shifts from anchor', () => {
    const lbl = new UILabel('x');
    lbl.width = w; lbl.height = h; lbl.anchor = 'top-left';
    lbl.x = 20; lbl.y = 30;
    const r = lbl.resolveRect(CW, CH);
    expect(r.x).toBe(20);
    expect(r.y).toBe(30);
  });

  it('hit test passes inside widget', () => {
    const lbl = new UILabel('x');
    lbl.width = 100; lbl.height = 40;
    expect(lbl.hitTest(50, 20, CW, CH)).toBe(true);
  });

  it('hit test fails outside widget', () => {
    const lbl = new UILabel('x');
    lbl.width = 100; lbl.height = 40;
    expect(lbl.hitTest(200, 200, CW, CH)).toBe(false);
  });

  it('hit test fails when invisible', () => {
    const lbl = new UILabel('x');
    lbl.visible = false;
    expect(lbl.hitTest(50, 20, CW, CH)).toBe(false);
  });
});

// ── UIPanel ───────────────────────────────────────────────────────────────────

describe('UIPanel', () => {
  it('renders without throwing', () => {
    const p = new UIPanel({ title: 'Settings', width: 300, height: 200 });
    expect(() => p.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });

  it('renders without title', () => {
    const p = new UIPanel({ width: 200, height: 100 });
    expect(() => p.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });
});

// ── UILabel ───────────────────────────────────────────────────────────────────

describe('UILabel', () => {
  it('renders text', () => {
    const l = new UILabel('Score: 0');
    expect(() => l.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
    expect((mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.some(c => c[0] === 'Score: 0')).toBe(true);
  });

  it('bold label uses 700 font weight', () => {
    const l = new UILabel('Title', { bold: true });
    l.render(mockCtx, DEFAULT_THEME, CW, CH);
    expect((mockCtx as unknown as { font: string }).font).toContain('700');
  });
});

// ── UIButton ──────────────────────────────────────────────────────────────────

describe('UIButton', () => {
  beforeEach(resetCtx);

  it('renders without throwing', () => {
    const b = new UIButton('Play');
    expect(() => b.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });

  it('fires onClick on pointer down + up', () => {
    const onClick = vi.fn();
    const b = new UIButton('OK', { x: 0, y: 0, width: 120, height: 36, onClick });
    b.onPointerDown!(10, 10, CW, CH);
    b.onPointerUp!(10, 10, CW, CH);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire onClick if pointer up outside', () => {
    const onClick = vi.fn();
    const b = new UIButton('OK', { x: 0, y: 0, width: 120, height: 36, onClick });
    b.onPointerDown!(10, 10, CW, CH);
    b.onPointerUp!(500, 500, CW, CH);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled button does not fire onClick', () => {
    const onClick = vi.fn();
    const b = new UIButton('OK', { onClick });
    b.enabled = false;
    b.onPointerDown!(10, 10, CW, CH);
    b.onPointerUp!(10, 10, CW, CH);
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ── UIProgressBar ─────────────────────────────────────────────────────────────

describe('UIProgressBar', () => {
  it('clamps value 0–1', () => {
    const p = new UIProgressBar(2);
    expect(p.value).toBe(1);
    p.value = -1;
    expect(p.value).toBe(0);
  });

  it('renders without throwing', () => {
    const p = new UIProgressBar(0.5);
    expect(() => p.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });
});

// ── UISlider ──────────────────────────────────────────────────────────────────

describe('UISlider', () => {
  it('normalizedValue reflects position in range', () => {
    const s = new UISlider(50, { min: 0, max: 100 });
    expect(s.normalizedValue).toBeCloseTo(0.5);
  });

  it('clamps value to min/max', () => {
    const s = new UISlider(0, { min: 0, max: 100 });
    s.value = -10;
    expect(s.value).toBe(0);
    s.value = 200;
    expect(s.value).toBe(100);
  });

  it('calls onChange when dragged', () => {
    const cb = vi.fn();
    const s  = new UISlider(0, { x: 0, y: 0, width: 200, height: 24, onChange: cb });
    s.onPointerDown!(100, 12, CW, CH);
    expect(cb).toHaveBeenCalled();
    const v = cb.mock.calls[0][0] as number;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('stops dragging on pointer up', () => {
    const s = new UISlider(0, { x: 0, y: 0, width: 200, height: 24 });
    s.onPointerDown!(50, 12, CW, CH);
    expect(s.isDragging).toBe(true);
    s.onPointerUp!(50, 12, CW, CH);
    expect(s.isDragging).toBe(false);
  });
});

// ── UIToggle ──────────────────────────────────────────────────────────────────

describe('UIToggle', () => {
  it('toggles checked on pointer up', () => {
    const t = new UIToggle('Sound', false, { x: 0, y: 0, width: 160, height: 28 });
    t.onPointerDown!(10, 10, CW, CH);
    t.onPointerUp!(10, 10, CW, CH);
    expect(t.checked).toBe(true);
  });

  it('calls onChange on toggle', () => {
    const cb = vi.fn();
    const t  = new UIToggle('Sound', false, { x: 0, y: 0, width: 160, height: 28, onChange: cb });
    t.onPointerDown!(10, 10, CW, CH);
    t.onPointerUp!(10, 10, CW, CH);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('renders without throwing', () => {
    const t = new UIToggle('Music', true);
    expect(() => t.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });
});

// ── UIImage ───────────────────────────────────────────────────────────────────

describe('UIImage', () => {
  it('renders placeholder when no image', () => {
    const img = new UIImage(undefined, { width: 64, height: 64 });
    expect(() => img.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });
});

// ── UIScrollView ──────────────────────────────────────────────────────────────

describe('UIScrollView', () => {
  it('clamps scrollY to 0 when no overflow', () => {
    const sv = new UIScrollView({ x: 0, y: 0, width: 200, height: 200 });
    sv.scrollY = -100;
    sv.render(mockCtx, DEFAULT_THEME, CW, CH);
    expect(sv.scrollY).toBe(0);
  });

  it('drags scrollY', () => {
    const sv = new UIScrollView({ x: 0, y: 0, width: 200, height: 200 });
    sv.contentHeight = 600;
    sv.onPointerDown!(10, 50, CW, CH);
    sv.onPointerMove!(10, 10, CW, CH); // moved up 40px
    expect(sv.scrollY).toBeGreaterThan(0);
    sv.onPointerUp!(10, 10, CW, CH);
  });

  it('renders without throwing', () => {
    const sv = new UIScrollView({ width: 200, height: 200 });
    sv.contentHeight = 400;
    sv.addChild(new UILabel('item'));
    expect(() => sv.render(mockCtx, DEFAULT_THEME, CW, CH)).not.toThrow();
  });
});
