import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TouchInputManager, type TouchManagerConfig } from '../client/src/engine/TouchInputManager';

// ── DOM mocks ─────────────────────────────────────────────────────────────────

class MockElement {
  private handlers = new Map<string, EventListener>();
  style: Record<string, string> = {};

  addEventListener(type: string, fn: EventListener): void  { this.handlers.set(type, fn); }
  removeEventListener(type: string, fn: EventListener): void {
    const current = this.handlers.get(type);
    if (current === fn) this.handlers.delete(type);
  }
  setPointerCapture = vi.fn();
  getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 }));

  dispatch(type: string, data: Partial<PointerEvent>): void {
    const fn = this.handlers.get(type);
    if (fn) fn({ ...data, preventDefault: vi.fn(), type } as unknown as PointerEvent);
  }
}

function makeElement(): MockElement {
  return new MockElement();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManager(el: MockElement, cfg: Partial<TouchManagerConfig> = {}) {
  return new TouchInputManager(el as unknown as HTMLElement, cfg);
}

function pointer(overrides: Partial<PointerEvent>): Partial<PointerEvent> {
  return { pointerId: 1, clientX: 100, clientY: 100, ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TouchInputManager', () => {
  let el:  MockElement;
  let mgr: TouchInputManager;

  beforeEach(() => {
    el  = makeElement();
    mgr = makeManager(el);
  });

  describe('lifecycle', () => {
    it('sets touch-action:none on element', () => {
      expect(el.style.touchAction).toBe('none');
    });

    it('dispose removes listeners', () => {
      mgr.dispose();
      // After dispose, no handlers remain — dispatching won't crash
      expect(() => el.dispatch('pointerdown', pointer({}))).not.toThrow();
    });

    it('dispose clears all subscriptions', () => {
      const tap = vi.fn();
      mgr.on('tap', tap);
      mgr.dispose();
      el.dispatch('pointerdown', pointer({ clientX: 100, clientY: 100 }));
      el.dispatch('pointerup',   pointer({ clientX: 100, clientY: 100 }));
      expect(tap).not.toHaveBeenCalled();
    });
  });

  describe('tap gesture', () => {
    it('fires tap on quick press + release', () => {
      const tap = vi.fn();
      mgr.on('tap', tap);

      el.dispatch('pointerdown', pointer({}));
      el.dispatch('pointerup',   pointer({}));

      expect(tap).toHaveBeenCalledOnce();
      expect(tap.mock.calls[0][0]).toMatchObject({ x: 100, y: 100 });
    });

    it('does not fire tap if moved too far', () => {
      const tap = vi.fn();
      mgr.on('tap', tap);

      el.dispatch('pointerdown', pointer({ clientX: 100, clientY: 100 }));
      el.dispatch('pointermove', pointer({ clientX: 200, clientY: 200 }));
      el.dispatch('pointerup',   pointer({ clientX: 200, clientY: 200 }));

      expect(tap).not.toHaveBeenCalled();
    });
  });

  describe('double-tap gesture', () => {
    it('fires doubletap on two quick taps', () => {
      const doubletap = vi.fn();
      mgr = makeManager(el, { doubleTapMaxMs: 3000 }); // generous window
      mgr.on('doubletap', doubletap);

      // First tap
      el.dispatch('pointerdown', pointer({}));
      el.dispatch('pointerup',   pointer({}));
      // Second tap
      el.dispatch('pointerdown', pointer({}));
      el.dispatch('pointerup',   pointer({}));

      expect(doubletap).toHaveBeenCalledOnce();
    });
  });

  describe('swipe gesture', () => {
    it('fires swipe right on horizontal flick', () => {
      const swipe = vi.fn();
      mgr = makeManager(el, { swipeMinPx: 30, swipeMaxMs: 5000, tapMaxMs: 100 });
      mgr.on('swipe', swipe);

      el.dispatch('pointerdown', pointer({ clientX: 100, clientY: 100 }));
      el.dispatch('pointermove', pointer({ clientX: 200, clientY: 105 }));
      el.dispatch('pointerup',   pointer({ clientX: 200, clientY: 105 }));

      expect(swipe).toHaveBeenCalledOnce();
      expect(swipe.mock.calls[0][0].direction).toBe('right');
    });

    it('fires swipe up on vertical flick', () => {
      const swipe = vi.fn();
      mgr = makeManager(el, { swipeMinPx: 30, swipeMaxMs: 5000, tapMaxMs: 100 });
      mgr.on('swipe', swipe);

      el.dispatch('pointerdown', pointer({ clientX: 100, clientY: 200 }));
      el.dispatch('pointermove', pointer({ clientX: 102, clientY: 100 }));
      el.dispatch('pointerup',   pointer({ clientX: 102, clientY: 100 }));

      expect(swipe.mock.calls[0][0].direction).toBe('up');
    });
  });

  describe('pan gesture', () => {
    it('fires pan events while dragging', () => {
      const pan = vi.fn();
      mgr = makeManager(el, { panMinPx: 5 });
      mgr.on('pan', pan);

      el.dispatch('pointerdown', pointer({ clientX: 100, clientY: 100 }));
      el.dispatch('pointermove', pointer({ clientX: 110, clientY: 110 })); // 14px dist
      el.dispatch('pointermove', pointer({ clientX: 120, clientY: 120 }));
      el.dispatch('pointerup',   pointer({ clientX: 120, clientY: 120 }));

      expect(pan.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('raw pointer events', () => {
    it('emits pointerraw on down', () => {
      const raw = vi.fn();
      mgr.on('pointerraw', raw);
      el.dispatch('pointerdown', pointer({}));
      expect(raw).toHaveBeenCalledWith(expect.objectContaining({ type: 'down' }));
    });

    it('emits pointerraw on move', () => {
      const raw = vi.fn();
      mgr.on('pointerraw', raw);
      el.dispatch('pointerdown', pointer({}));
      el.dispatch('pointermove', pointer({ clientX: 150, clientY: 150 }));
      expect(raw).toHaveBeenCalledWith(expect.objectContaining({ type: 'move' }));
    });
  });

  describe('on / off subscriptions', () => {
    it('off removes specific handler', () => {
      const tap1 = vi.fn();
      const tap2 = vi.fn();
      mgr.on('tap', tap1);
      mgr.on('tap', tap2);
      mgr.off('tap', tap1);

      el.dispatch('pointerdown', pointer({}));
      el.dispatch('pointerup',   pointer({}));

      expect(tap1).not.toHaveBeenCalled();
      expect(tap2).toHaveBeenCalled();
    });
  });

  describe('active pointer count', () => {
    it('tracks active pointers', () => {
      expect(mgr.activePointerCount).toBe(0);
      el.dispatch('pointerdown', pointer({ pointerId: 1 }));
      expect(mgr.activePointerCount).toBe(1);
      el.dispatch('pointerup',   pointer({ pointerId: 1 }));
      expect(mgr.activePointerCount).toBe(0);
    });
  });
});
