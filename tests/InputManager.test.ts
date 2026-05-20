// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { InputManager } from '../client/src/engine/InputManager';

describe('InputManager', () => {
  it('recognizes both keyboard keys and keyboard codes', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const input = new InputManager(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' }));

    expect(input.isKeyDown('w')).toBe(true);
    expect(input.isKeyDown('KeyW')).toBe(true);
    expect(input.isKeyJustPressed('w')).toBe(true);
    expect(input.isKeyJustPressed('KeyW')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW' }));

    expect(input.isKeyDown('w')).toBe(false);
    expect(input.isKeyDown('KeyW')).toBe(false);

    input.dispose();
  });

  it('rebinds mouse input when the active canvas changes', () => {
    const firstCanvas = document.createElement('canvas');
    const secondCanvas = document.createElement('canvas');
    document.body.append(firstCanvas, secondCanvas);

    const input = new InputManager(firstCanvas);
    firstCanvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    expect(input.isMouseButtonDown(2)).toBe(true);

    input.setCanvas(secondCanvas);
    firstCanvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    expect(input.isMouseButtonDown(2)).toBe(false);

    secondCanvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    secondCanvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 30, movementX: 7, movementY: -4 }));

    expect(input.isMouseButtonDown(2)).toBe(true);
    expect(input.mouseDeltaX).toBe(7);
    expect(input.mouseDeltaY).toBe(-4);

    input.dispose();
  });

  it('continues receiving mouse movement from the document while pointer lock is active', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    const input = new InputManager(canvas);
    Object.defineProperty(document, 'pointerLockElement', {
      value: canvas,
      configurable: true,
    });

    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 11, movementY: -6 }));

    expect(input.mouseDeltaX).toBe(11);
    expect(input.mouseDeltaY).toBe(-6);

    input.dispose();
  });
});