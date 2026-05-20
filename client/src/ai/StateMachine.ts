// ─── Finite State Machine ──────────────────────────────────────────
// Generic FSM for character states, game states, menus, AI behaviors.
// Supports enter/exit/update callbacks, transitions with conditions,
// and hierarchical sub-states.

export type StateCallback<T = any> = (context: T, delta: number) => void;
export type TransitionCondition<T = any> = (context: T) => boolean;

export interface StateDefinition<T = any> {
  name: string;
  onEnter?: (context: T) => void;
  onUpdate?: StateCallback<T>;
  onExit?: (context: T) => void;
}

export interface TransitionDefinition<T = any> {
  from: string;
  to: string;
  condition: TransitionCondition<T>;
  /** Priority — higher = checked first */
  priority?: number;
}

export class StateMachine<T = any> {
  private states = new Map<string, StateDefinition<T>>();
  private transitions: TransitionDefinition<T>[] = [];
  private currentState: StateDefinition<T> | null = null;
  private context: T;
  private previousStateName: string | null = null;

  // State history for debugging
  private history: { state: string; time: number }[] = [];
  private maxHistory = 50;

  constructor(context: T) {
    this.context = context;
  }

  /** Add a state */
  addState(state: StateDefinition<T>): this {
    this.states.set(state.name, state);
    return this;
  }

  /** Add a transition rule */
  addTransition(from: string, to: string, condition: TransitionCondition<T>, priority = 0): this {
    this.transitions.push({ from, to, condition, priority });
    // Sort by priority (highest first)
    this.transitions.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return this;
  }

  /** Set initial state */
  start(stateName: string): void {
    const state = this.states.get(stateName);
    if (!state) throw new Error(`State "${stateName}" not found`);
    this.currentState = state;
    this.history.push({ state: stateName, time: Date.now() });
    state.onEnter?.(this.context);
  }

  /** Force transition to a specific state */
  transitionTo(stateName: string): void {
    if (this.currentState?.name === stateName) return;

    const state = this.states.get(stateName);
    if (!state) throw new Error(`State "${stateName}" not found`);

    this.previousStateName = this.currentState?.name ?? null;
    this.currentState?.onExit?.(this.context);
    this.currentState = state;
    this.history.push({ state: stateName, time: Date.now() });
    if (this.history.length > this.maxHistory) this.history.shift();
    state.onEnter?.(this.context);
  }

  /** Update — checks transitions then updates current state */
  update(delta: number): void {
    if (!this.currentState) return;

    // Check transition conditions
    for (const t of this.transitions) {
      if (t.from === this.currentState.name || t.from === '*') {
        if (t.condition(this.context)) {
          this.transitionTo(t.to);
          return; // Don't update — we just transitioned
        }
      }
    }

    // Update current state
    this.currentState.onUpdate?.(this.context, delta);
  }

  get current(): string | null {
    return this.currentState?.name ?? null;
  }

  get previous(): string | null {
    return this.previousStateName;
  }

  isInState(name: string): boolean {
    return this.currentState?.name === name;
  }

  getHistory(): { state: string; time: number }[] {
    return [...this.history];
  }
}

// ─── Animation State Machine ──────────────────────────────────────
// Specialized FSM for character animations with blend transitions.

export interface AnimationStateConfig {
  name: string;
  clipName: string;
  loop?: boolean;
  speed?: number;
  blendDuration?: number;
}

export class AnimationStateMachine {
  private states = new Map<string, AnimationStateConfig>();
  private transitions: TransitionDefinition<any>[] = [];
  private currentState: AnimationStateConfig | null = null;
  private context: any;
  private onPlayCallback: ((clipName: string, blendDuration: number) => void) | null = null;

  constructor(context: any) {
    this.context = context;
  }

  /** Register callback that actually plays animations on the AnimationComponent */
  onPlay(callback: (clipName: string, blendDuration: number) => void): this {
    this.onPlayCallback = callback;
    return this;
  }

  addState(config: AnimationStateConfig): this {
    this.states.set(config.name, config);
    return this;
  }

  addTransition(from: string, to: string, condition: TransitionCondition, priority = 0): this {
    this.transitions.push({ from, to, condition, priority });
    this.transitions.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return this;
  }

  start(stateName: string): void {
    const state = this.states.get(stateName);
    if (!state) return;
    this.currentState = state;
    this.onPlayCallback?.(state.clipName, 0);
  }

  update(_delta: number): void {
    if (!this.currentState) return;

    for (const t of this.transitions) {
      if (t.from === this.currentState.name || t.from === '*') {
        if (t.condition(this.context)) {
          const nextState = this.states.get(t.to);
          if (nextState && nextState.name !== this.currentState.name) {
            this.currentState = nextState;
            this.onPlayCallback?.(nextState.clipName, nextState.blendDuration ?? 0.2);
          }
          return;
        }
      }
    }
  }

  get current(): string | null {
    return this.currentState?.name ?? null;
  }
}
