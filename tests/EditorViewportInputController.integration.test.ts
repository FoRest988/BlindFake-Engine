// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewportInputController } from '../client/src/editor/EditorViewportInputController';

describe('EditorViewportInputController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fires click selection for quick pointer taps', () => {
    const canvas = document.createElement('canvas');
    const viewport = document.createElement('div');
    document.body.appendChild(viewport);
    viewport.appendChild(canvas);

    const onViewportClick = vi.fn();
    const controller = new EditorViewportInputController({
      canvas,
      getViewportContainer: () => viewport,
      isInteractionBlocked: () => false,
      isTransformDragging: () => false,
      isJustFinishedDragging: () => false,
      onViewportClick,
      onMarqueeSelect: vi.fn(),
      onAssetDrop: vi.fn(),
    });
    controller.attach();

    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 20 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 12, clientY: 22 }));

    expect(onViewportClick).toHaveBeenCalledOnce();
  });

  it('creates marquee selection and forwards dropped assets', () => {
    const canvas = document.createElement('canvas');
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 400, right: 500, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(viewport);
    viewport.appendChild(canvas);

    const onMarqueeSelect = vi.fn();
    const onAssetDrop = vi.fn();
    const controller = new EditorViewportInputController({
      canvas,
      getViewportContainer: () => viewport,
      isInteractionBlocked: () => false,
      isTransformDragging: () => false,
      isJustFinishedDragging: () => false,
      onViewportClick: vi.fn(),
      onMarqueeSelect,
      onAssetDrop,
    });
    controller.attach();

    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 20 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { button: 0, clientX: 50, clientY: 70 }));
    expect(viewport.querySelector('.marquee-selection')).toBeTruthy();
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 50, clientY: 70 }));

    expect(onMarqueeSelect).toHaveBeenCalledWith(10, 20, 50, 70);
    expect(viewport.querySelector('.marquee-selection')).toBeNull();

    const dropEvent = new Event('drop', {
      bubbles: true,
      cancelable: true,
    }) as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        getData: () => JSON.stringify({ type: 'model', path: '/crate.glb' }),
      },
    });
    canvas.dispatchEvent(dropEvent);

    expect(onAssetDrop).toHaveBeenCalledWith({ type: 'model', path: '/crate.glb' }, dropEvent);
  });
});