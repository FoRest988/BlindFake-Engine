// ─── Input Action System ────────────────────────────────────────────
// Rebindable input actions, multiple bindings per action, gamepad
// support, dead zones, input buffering, and axis composites.

import { InputManager } from './InputManager';

// ── Binding Types ───────────────────────────────────────────────────

export type BindingSource =
  | { type: 'key'; code: string }
  | { type: 'mouse'; button: number }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'gamepadButton'; index: number }
  | { type: 'gamepadAxis'; index: number; direction: 1 | -1; threshold?: number };

export interface InputAction {
  name: string;
  bindings: BindingSource[];
  /** Whether action is currently held */
  held: boolean;
  /** Whether action was just pressed this frame */
  pressed: boolean;
  /** Whether action was just released this frame */
  released: boolean;
  /** Analog value (0..1 for buttons/keys, -1..1 for axes) */
  value: number;
}

export interface AxisComposite {
  name: string;
  positive: string; // action name
  negative: string; // action name
  value: number;    // -1..1
}

// ── Input Action Manager ────────────────────────────────────────────

export class InputActionManager {
  private input: InputManager;
  private actions = new Map<string, InputAction>();
  private axes = new Map<string, AxisComposite>();
  private gamepadIndex: number | null = null;
  private gamepadDeadzone = 0.15;
  private previousGamepadButtons = new Map<number, boolean>();

  // Input buffering: remember presses for a short window
  private bufferWindow = 0.15; // seconds
  private buffered = new Map<string, number>(); // action → remaining buffer time

  // Vibration
  private vibrationDuration = 0;
  private vibrationWeak = 0;
  private vibrationStrong = 0;

  // Stored listeners for cleanup
  private onGPConnected: (e: Event) => void;
  private onGPDisconnected: (e: Event) => void;

  constructor(input: InputManager) {
    this.input = input;

    // Detect gamepad
    this.onGPConnected = (e) => {
      this.gamepadIndex = (e as GamepadEvent).gamepad.index;
    };
    this.onGPDisconnected = (e) => {
      if (this.gamepadIndex === (e as GamepadEvent).gamepad.index) {
        this.gamepadIndex = null;
      }
    };
    window.addEventListener('gamepadconnected', this.onGPConnected);
    window.addEventListener('gamepaddisconnected', this.onGPDisconnected);
  }

  destroy(): void {
    window.removeEventListener('gamepadconnected', this.onGPConnected);
    window.removeEventListener('gamepaddisconnected', this.onGPDisconnected);
    this.actions.clear();
    this.axes.clear();
    this.buffered.clear();
  }

  // ── Registration ────────────────────────────────────────────────

  /** Register an action with default bindings */
  register(name: string, bindings: BindingSource[]): InputAction {
    const action: InputAction = {
      name,
      bindings: [...bindings],
      held: false,
      pressed: false,
      released: false,
      value: 0,
    };
    this.actions.set(name, action);
    return action;
  }

  /** Register a composite axis from two actions (e.g., left/right → horizontal) */
  registerAxis(name: string, positiveAction: string, negativeAction: string): void {
    this.axes.set(name, {
      name,
      positive: positiveAction,
      negative: negativeAction,
      value: 0,
    });
  }

  /** Rebind an action — replaces all bindings */
  rebind(actionName: string, bindings: BindingSource[]): void {
    const action = this.actions.get(actionName);
    if (action) action.bindings = [...bindings];
  }

  /** Add an extra binding to an existing action */
  addBinding(actionName: string, binding: BindingSource): void {
    const action = this.actions.get(actionName);
    if (action) action.bindings.push(binding);
  }

  // ── Queries ─────────────────────────────────────────────────────

  /** Check if an action is held */
  isHeld(name: string): boolean {
    return this.actions.get(name)?.held ?? false;
  }

  /** Check if an action was just pressed (or buffered) */
  isPressed(name: string): boolean {
    return (this.actions.get(name)?.pressed ?? false) || (this.buffered.get(name) ?? 0) > 0;
  }

  /** Check if an action was just released */
  isReleased(name: string): boolean {
    return this.actions.get(name)?.released ?? false;
  }

  /** Get analog value for an action (0..1 for digital, -1..1 for axis) */
  getValue(name: string): number {
    return this.actions.get(name)?.value ?? 0;
  }

  /** Get composite axis value (-1..1) */
  getAxis(name: string): number {
    return this.axes.get(name)?.value ?? 0;
  }

  /** Consume a buffered press (returns true once, then clears buffer) */
  consumePress(name: string): boolean {
    if (this.isPressed(name)) {
      this.buffered.delete(name);
      const action = this.actions.get(name);
      if (action) action.pressed = false;
      return true;
    }
    return false;
  }

  /** Get the action definition */
  getAction(name: string): InputAction | undefined {
    return this.actions.get(name);
  }

  /** Get all registered actions */
  getAllActions(): InputAction[] {
    return Array.from(this.actions.values());
  }

  // ── Gamepad ─────────────────────────────────────────────────────

  get hasGamepad(): boolean {
    return this.gamepadIndex !== null;
  }

  setDeadzone(value: number): void {
    this.gamepadDeadzone = Math.max(0, Math.min(0.5, value));
  }

  /** Trigger gamepad vibration (if supported) */
  vibrate(durationMs: number, weakMagnitude = 0.5, strongMagnitude = 0.5): void {
    if (this.gamepadIndex === null) return;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (gp?.vibrationActuator) {
      (gp.vibrationActuator as any).playEffect?.('dual-rumble', {
        duration: durationMs,
        weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
        strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
      });
    }
  }

  // ── Update ──────────────────────────────────────────────────────

  /** Call once per frame BEFORE input.update() */
  update(delta: number): void {
    // Read gamepad state
    const gp = this.gamepadIndex !== null ? navigator.getGamepads()[this.gamepadIndex] : null;

    for (const action of this.actions.values()) {
      const wasHeld = action.held;
      let isHeld = false;
      let maxValue = 0;

      for (const binding of action.bindings) {
        const [active, value] = this.evalBinding(binding, gp);
        if (active) isHeld = true;
        if (Math.abs(value) > Math.abs(maxValue)) maxValue = value;
      }

      action.held = isHeld;
      action.pressed = isHeld && !wasHeld;
      action.released = !isHeld && wasHeld;
      action.value = maxValue;

      // Buffer presses
      if (action.pressed) {
        this.buffered.set(action.name, this.bufferWindow);
      }
    }

    // Update composite axes
    for (const axis of this.axes.values()) {
      const pos = this.actions.get(axis.positive)?.value ?? 0;
      const neg = this.actions.get(axis.negative)?.value ?? 0;
      axis.value = pos - neg;
    }

    // Decay buffers
    for (const [name, remaining] of this.buffered) {
      const newVal = remaining - delta;
      if (newVal <= 0) {
        this.buffered.delete(name);
      } else {
        this.buffered.set(name, newVal);
      }
    }

    // Update previous gamepad button state
    if (gp) {
      for (let i = 0; i < gp.buttons.length; i++) {
        this.previousGamepadButtons.set(i, gp.buttons[i].pressed);
      }
    }
  }

  // ── Presets ─────────────────────────────────────────────────────

  /** Register standard FPS/action game bindings */
  registerDefaults(): void {
    this.register('moveForward', [
      { type: 'key', code: 'w' },
      { type: 'key', code: 'arrowup' },
      { type: 'gamepadAxis', index: 1, direction: -1 },
    ]);
    this.register('moveBackward', [
      { type: 'key', code: 's' },
      { type: 'key', code: 'arrowdown' },
      { type: 'gamepadAxis', index: 1, direction: 1 },
    ]);
    this.register('moveLeft', [
      { type: 'key', code: 'a' },
      { type: 'key', code: 'arrowleft' },
      { type: 'gamepadAxis', index: 0, direction: -1 },
    ]);
    this.register('moveRight', [
      { type: 'key', code: 'd' },
      { type: 'key', code: 'arrowright' },
      { type: 'gamepadAxis', index: 0, direction: 1 },
    ]);
    this.register('jump', [
      { type: 'key', code: ' ' },
      { type: 'gamepadButton', index: 0 }, // A button
    ]);
    this.register('sprint', [
      { type: 'key', code: 'shift' },
      { type: 'gamepadButton', index: 10 }, // L3
    ]);
    this.register('interact', [
      { type: 'key', code: 'e' },
      { type: 'gamepadButton', index: 2 }, // X button
    ]);
    this.register('attack', [
      { type: 'mouse', button: 0 },
      { type: 'gamepadButton', index: 5 }, // RB
    ]);
    this.register('block', [
      { type: 'mouse', button: 2 },
      { type: 'gamepadButton', index: 4 }, // LB
    ]);
    this.register('inventory', [
      { type: 'key', code: 'i' },
      { type: 'gamepadButton', index: 3 }, // Y button
    ]);
    this.register('pause', [
      { type: 'key', code: 'escape' },
      { type: 'gamepadButton', index: 9 }, // Start
    ]);

    this.registerAxis('horizontal', 'moveRight', 'moveLeft');
    this.registerAxis('vertical', 'moveForward', 'moveBackward');
  }

  /** Serialize bindings for saving/restoring rebinds */
  serializeBindings(): Record<string, BindingSource[]> {
    const result: Record<string, BindingSource[]> = {};
    for (const [name, action] of this.actions) {
      result[name] = action.bindings;
    }
    return result;
  }

  /** Restore serialized bindings */
  deserializeBindings(data: Record<string, BindingSource[]>): void {
    for (const [name, bindings] of Object.entries(data)) {
      this.rebind(name, bindings);
    }
  }

  // ── Private ─────────────────────────────────────────────────────

  private evalBinding(binding: BindingSource, gp: Gamepad | null): [boolean, number] {
    switch (binding.type) {
      case 'key':
        return [this.input.isKeyDown(binding.code), this.input.isKeyDown(binding.code) ? 1 : 0];

      case 'mouse':
        return [this.input.isMouseButtonDown(binding.button), this.input.isMouseButtonDown(binding.button) ? 1 : 0];

      case 'scroll': {
        const scrollVal = this.input.scrollDelta;
        if (binding.direction === 'up' && scrollVal < 0) return [true, 1];
        if (binding.direction === 'down' && scrollVal > 0) return [true, 1];
        return [false, 0];
      }

      case 'gamepadButton': {
        if (!gp || binding.index >= gp.buttons.length) return [false, 0];
        const btn = gp.buttons[binding.index];
        return [btn.pressed, btn.value];
      }

      case 'gamepadAxis': {
        if (!gp || binding.index >= gp.axes.length) return [false, 0];
        let raw = gp.axes[binding.index];
        // Apply deadzone
        if (Math.abs(raw) < this.gamepadDeadzone) raw = 0;
        else {
          // Remap from [deadzone..1] to [0..1]
          raw = (Math.abs(raw) - this.gamepadDeadzone) / (1 - this.gamepadDeadzone) * Math.sign(raw);
        }
        const threshold = binding.threshold ?? 0.3;
        const directionMatch = binding.direction > 0 ? raw > threshold : raw < -threshold;
        const value = binding.direction > 0 ? Math.max(0, raw) : Math.max(0, -raw);
        return [directionMatch, value];
      }
    }
  }
}
