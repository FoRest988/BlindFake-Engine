import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../client/src/engine/EventBus';

describe('EventBus', () => {
  it('emits events to subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.emit('test', 42);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('supports multiple listeners', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('e', a);
    bus.on('e', b);
    bus.emit('e', 'hello');
    expect(a).toHaveBeenCalledWith('hello');
    expect(b).toHaveBeenCalledWith('hello');
  });

  it('unsubscribes with returned function', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on('x', handler);
    unsub();
    bus.emit('x');
    expect(handler).not.toHaveBeenCalled();
  });

  it('off removes a specific listener', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('x', handler);
    bus.off('x', handler);
    bus.emit('x');
    expect(handler).not.toHaveBeenCalled();
  });

  it('once fires only once', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('o', handler);
    bus.emit('o', 1);
    bus.emit('o', 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('clear removes all listeners', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('a', h1);
    bus.on('b', h2);
    bus.clear();
    bus.emit('a');
    bus.emit('b');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('clear with event name removes only that event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('a', h1);
    bus.on('b', h2);
    bus.clear('a');
    bus.emit('a');
    bus.emit('b');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('hasListeners returns correct state', () => {
    const bus = new EventBus();
    expect(bus.hasListeners('x')).toBe(false);
    bus.on('x', () => {});
    expect(bus.hasListeners('x')).toBe(true);
  });

  it('getLastEmit returns last args', () => {
    const bus = new EventBus();
    bus.emit('data', 10, 'abc');
    expect(bus.getLastEmit('data')).toEqual([10, 'abc']);
  });

  it('listenerCount is accurate', () => {
    const bus = new EventBus();
    expect(bus.listenerCount('x')).toBe(0);
    bus.on('x', () => {});
    bus.on('x', () => {});
    expect(bus.listenerCount('x')).toBe(2);
  });

  it('emits with context', () => {
    const bus = new EventBus();
    const ctx = { val: 0 };
    bus.on('e', function (this: typeof ctx) { this.val = 99; }, ctx);
    bus.emit('e');
    expect(ctx.val).toBe(99);
  });
});
