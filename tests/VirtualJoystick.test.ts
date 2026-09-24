import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VirtualJoystick, DualJoystickController, type JoystickAxis } from '../client/src/engine/VirtualJoystick';

// ── Canvas mock ───────────────────────────────────────────────────────────────

const mockCtx = {
  save:    vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  arc:     vi.fn(),
  fill:    vi.fn(),
  stroke:  vi.fn(),
  fillStyle:   '',
  strokeStyle: '',
  lineWidth:   1,
  globalAlpha: 1,
} as unknown as CanvasRenderingContext2D;

function resetCtx(): void {
  for (const v of Object.values(mockCtx)) {
    if (typeof v === 'function' && (v as ReturnType<typeof vi.fn>).mockClear) {
      (v as ReturnType<typeof vi.fn>).mockClear();
    }
  }
}

// ── VirtualJoystick ───────────────────────────────────────────────────────────

describe('VirtualJoystick', () => {
  beforeEach(resetCtx);

  describe('initial state', () => {
    it('axis is zero at rest', () => {
      const j = new VirtualJoystick();
      expect(j.axis.x).toBe(0);
      expect(j.axis.y).toBe(0);
      expect(j.axis.magnitude).toBe(0);
    });

    it('not active initially', () => {
      const j = new VirtualJoystick();
      expect(j.active).toBe(false);
    });

    it('direction8 is "none" at rest', () => {
      const j = new VirtualJoystick();
      expect(j.direction8).toBe('none');
    });
  });

  describe('fixed mode', () => {
    it('pointerDown returns true when inside outer ring', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed' });
      expect(j.pointerDown(1, 110, 110)).toBe(true);
    });

    it('pointerDown returns false outside ring * 1.5', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed' });
      expect(j.pointerDown(1, 400, 400)).toBe(false);
    });

    it('becomes active after pointerDown', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed' });
      j.pointerDown(1, 110, 100);
      expect(j.active).toBe(true);
    });

    it('axis.x > 0 when moved right', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 160, 100); // move right
      expect(j.axis.x).toBeGreaterThan(0);
    });

    it('axis.y > 0 when moved down', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 100, 160); // move down
      expect(j.axis.y).toBeGreaterThan(0);
    });

    it('magnitude clamps to 1', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 100, 500); // way past radius
      expect(j.axis.magnitude).toBeLessThanOrEqual(1.001);
    });

    it('releases to zero on pointerUp', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 160, 100);
      j.pointerUp(1);
      expect(j.axis.x).toBe(0);
      expect(j.axis.magnitude).toBe(0);
      expect(j.active).toBe(false);
    });
  });

  describe('follow mode', () => {
    it('activates wherever the pointer lands', () => {
      const j = new VirtualJoystick({ mode: 'follow', radius: 60 });
      const claimed = j.pointerDown(1, 350, 400);
      expect(claimed).toBe(true);
      expect(j.centerX).toBe(350);
      expect(j.centerY).toBe(400);
    });

    it('does not accept a second pointer', () => {
      const j = new VirtualJoystick({ mode: 'follow' });
      j.pointerDown(1, 100, 100);
      const second = j.pointerDown(2, 300, 300);
      expect(second).toBe(false);
    });
  });

  describe('dead zone', () => {
    it('axis is zero within dead zone', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0.5 });
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 120, 100); // 20/60 ≈ 0.33 < 0.5 dead zone
      expect(j.axis.x).toBe(0);
    });
  });

  describe('direction8', () => {
    const cases: [number, number, string][] = [
      [160, 100, 'E'],   // right
      [40,  100, 'W'],   // left
      [100, 40,  'N'],   // up
      [100, 160, 'S'],   // down
    ];

    for (const [mx, my, dir] of cases) {
      it(`direction8 = ${dir} when moved to (${mx},${my})`, () => {
        const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
        j.pointerDown(1, 100, 100);
        j.pointerMove(1, mx, my);
        expect(j.direction8).toBe(dir);
      });
    }
  });

  describe('onChange callback', () => {
    it('fires onChange when axis changes', () => {
      const cb = vi.fn<(axis: JoystickAxis) => void>();
      const j  = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.onChange = cb;
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 160, 100);
      expect(cb).toHaveBeenCalled();
    });

    it('fires onChange with zeroed axis on release', () => {
      const cb = vi.fn<(axis: JoystickAxis) => void>();
      const j  = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.onChange = cb;
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 160, 100);
      cb.mockClear();
      j.pointerUp(1);
      const lastCall = cb.mock.calls[0][0];
      expect(lastCall.x).toBe(0);
      expect(lastCall.magnitude).toBe(0);
    });
  });

  describe('render', () => {
    it('renders without throwing', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60 });
      expect(() => j.render(mockCtx)).not.toThrow();
    });

    it('renders active state without throwing', () => {
      const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
      j.pointerDown(1, 100, 100);
      j.pointerMove(1, 160, 100);
      expect(() => j.render(mockCtx)).not.toThrow();
    });
  });

  describe('setPosition', () => {
    it('updates center when not active', () => {
      const j = new VirtualJoystick({ x: 100, y: 100 });
      j.setPosition(200, 300);
      expect(j.centerX).toBe(200);
      expect(j.centerY).toBe(300);
    });
  });
});

// ── DualJoystickController ────────────────────────────────────────────────────

describe('DualJoystickController', () => {
  it('constructs without throwing', () => {
    expect(() => new DualJoystickController(800, 600)).not.toThrow();
  });

  it('routes left-side pointer to left joystick', () => {
    const d = new DualJoystickController(800, 600);
    // Left half
    d.handlePointerDown(1, 100, 500);
    expect(d.left.active).toBe(true);
    expect(d.right.active).toBe(false);
  });

  it('routes right-side pointer to right joystick', () => {
    const d = new DualJoystickController(800, 600);
    d.handlePointerDown(1, 700, 500);
    expect(d.right.active).toBe(true);
    expect(d.left.active).toBe(false);
  });

  it('resize updates joystick positions', () => {
    const d = new DualJoystickController(800, 600);
    d.resize(1280, 720);
    expect(d.right.centerX).toBe(1280 - 120);
    expect(d.left.centerY).toBe(720 - 120);
  });

  it('handlePointerUp releases both joysticks', () => {
    const d = new DualJoystickController(800, 600);
    d.handlePointerDown(1, 100, 500);
    d.handlePointerUp(1);
    expect(d.left.active).toBe(false);
  });

  it('render does not throw', () => {
    const d = new DualJoystickController(800, 600);
    expect(() => d.render(mockCtx)).not.toThrow();
  });
});
