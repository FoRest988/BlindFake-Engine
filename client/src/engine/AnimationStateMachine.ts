/**
 * AnimationStateMachine — Visual state machine for animation blending.
 * - States with animation clips
 * - Transitions with conditions (parameter-based)
 * - Blend trees (1D/2D)
 * - Layers with masks and weights
 * - Runtime parameter system (float, int, bool, trigger)
 */

import * as THREE from 'three';

// ─── Parameter Types ─────────────────────────────────────────────
export type AnimParamType = 'float' | 'int' | 'bool' | 'trigger';

export interface AnimParam {
  name: string;
  type: AnimParamType;
  value: number | boolean;
}

// ─── Condition ───────────────────────────────────────────────────
export type ConditionOp = 'greater' | 'less' | 'equals' | 'notEquals' | 'isTrue' | 'isFalse';

export interface TransitionCondition {
  paramName: string;
  op: ConditionOp;
  threshold?: number;
}

// ─── State ───────────────────────────────────────────────────────
export interface AnimState {
  id: string;
  name: string;
  clipName: string;
  speed: number;
  loop: boolean;
  /** Position in the visual editor (for graph UI) */
  editorX: number;
  editorY: number;
}

// ─── Transition ──────────────────────────────────────────────────
export interface AnimTransition {
  id: string;
  fromState: string;    // state id, or 'any' for any-state transition
  toState: string;
  conditions: TransitionCondition[];
  duration: number;     // crossfade time in seconds
  exitTime: number;     // 0-1 normalized time in clip before transition can fire (-1 = immediate)
  hasExitTime: boolean;
}

// ─── Blend Tree Types ────────────────────────────────────────────
export interface BlendTreeChild {
  clipName: string;
  threshold: number;      // for 1D: position along the axis
  position?: [number, number]; // for 2D
  weight?: number;
}

export interface BlendTree {
  type: '1D' | '2D';
  paramName: string;     // parameter controlling the blend
  paramNameY?: string;   // second param for 2D
  children: BlendTreeChild[];
}

// ─── Layer ───────────────────────────────────────────────────────
export interface AnimLayer {
  name: string;
  weight: number;
  blendMode: 'override' | 'additive';
  mask?: string[];  // bone names to affect (empty = all)
  states: AnimState[];
  transitions: AnimTransition[];
  defaultState: string;
  blendTrees: Map<string, BlendTree>; // state id → blend tree
}

// ─── State Machine Definition ────────────────────────────────────
export interface AnimStateMachineDef {
  name: string;
  parameters: AnimParam[];
  layers: AnimLayer[];
}

// ─── Runtime State Machine ───────────────────────────────────────
export class AnimationStateMachine {
  private def: AnimStateMachineDef;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private actions = new Map<string, THREE.AnimationAction>();
  private params = new Map<string, AnimParam>();

  // Per-layer runtime state
  private layerStates: Map<string, {
    currentState: string;
    currentAction: THREE.AnimationAction | null;
    stateTime: number;
    transitioning: boolean;
    transitionAction: THREE.AnimationAction | null;
    transitionTime: number;
    transitionDuration: number;
  }> = new Map();

  constructor(def: AnimStateMachineDef) {
    this.def = def;
    for (const p of def.parameters) {
      this.params.set(p.name, { ...p });
    }
  }

  /** Bind to a Three.js AnimationMixer and load known clips */
  bind(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): void {
    this.mixer = mixer;
    this.clips.clear();
    this.actions.clear();

    for (const clip of clips) {
      this.clips.set(clip.name, clip);
    }

    // Initialize each layer
    for (const layer of this.def.layers) {
      const defaultState = layer.states.find(s => s.id === layer.defaultState);
      if (!defaultState) continue;

      const action = this.getOrCreateAction(defaultState.clipName);
      if (action) {
        action.reset().play();
        action.setEffectiveWeight(layer.weight);
        action.setLoop(defaultState.loop ? THREE.LoopRepeat : THREE.LoopOnce, defaultState.loop ? Infinity : 1);
        action.timeScale = defaultState.speed;
      }

      this.layerStates.set(layer.name, {
        currentState: layer.defaultState,
        currentAction: action,
        stateTime: 0,
        transitioning: false,
        transitionAction: null,
        transitionTime: 0,
        transitionDuration: 0,
      });
    }
  }

  /** Set a parameter value */
  setParam(name: string, value: number | boolean): void {
    const p = this.params.get(name);
    if (p) p.value = value;
  }

  /** Get a parameter value */
  getParam(name: string): number | boolean | undefined {
    return this.params.get(name)?.value;
  }

  /** Set trigger (auto-resets after transition fires) */
  setTrigger(name: string): void {
    const p = this.params.get(name);
    if (p && p.type === 'trigger') p.value = true;
  }

  /** Update the state machine (call every frame) */
  update(delta: number): void {
    if (!this.mixer) return;

    for (const layer of this.def.layers) {
      const runtime = this.layerStates.get(layer.name);
      if (!runtime) continue;

      runtime.stateTime += delta;

      // Handle ongoing transition
      if (runtime.transitioning) {
        runtime.transitionTime += delta;
        if (runtime.transitionTime >= runtime.transitionDuration) {
          // Transition complete
          if (runtime.currentAction) {
            runtime.currentAction.stop();
          }
          runtime.currentAction = runtime.transitionAction;
          runtime.transitionAction = null;
          runtime.transitioning = false;
          runtime.stateTime = 0;
        }
        continue;
      }

      // Check transitions from current state
      const currentState = layer.states.find(s => s.id === runtime.currentState);
      if (!currentState) continue;

      // Get clip duration for exit time calculations
      const clip = this.clips.get(currentState.clipName);
      const clipDuration = clip?.duration ?? 1;
      const normalizedTime = clipDuration > 0 ? (runtime.stateTime % clipDuration) / clipDuration : 0;

      // Check applicable transitions (from current state + any-state)
      const applicableTransitions = layer.transitions.filter(
        t => t.fromState === runtime.currentState || t.fromState === 'any'
      );

      for (const transition of applicableTransitions) {
        // Skip self-transitions for any-state
        if (transition.fromState === 'any' && transition.toState === runtime.currentState) continue;

        // Check exit time
        if (transition.hasExitTime && normalizedTime < transition.exitTime) continue;

        // Check conditions
        if (this.evaluateConditions(transition.conditions)) {
          this.performTransition(layer, runtime, transition);
          // Reset triggers
          for (const cond of transition.conditions) {
            const p = this.params.get(cond.paramName);
            if (p && p.type === 'trigger') p.value = false;
          }
          break;
        }
      }

      // Update blend trees
      const blendTree = layer.blendTrees.get(runtime.currentState);
      if (blendTree) {
        this.updateBlendTree(blendTree, layer.weight);
      }
    }
  }

  private evaluateConditions(conditions: TransitionCondition[]): boolean {
    for (const cond of conditions) {
      const param = this.params.get(cond.paramName);
      if (!param) return false;

      const val = param.value;
      switch (cond.op) {
        case 'greater': if (typeof val !== 'number' || val <= (cond.threshold ?? 0)) return false; break;
        case 'less': if (typeof val !== 'number' || val >= (cond.threshold ?? 0)) return false; break;
        case 'equals': if (val !== (cond.threshold ?? 0)) return false; break;
        case 'notEquals': if (val === (cond.threshold ?? 0)) return false; break;
        case 'isTrue': if (val !== true) return false; break;
        case 'isFalse': if (val !== false) return false; break;
      }
    }
    return true;
  }

  private performTransition(
    layer: AnimLayer,
    runtime: ReturnType<typeof this.layerStates.get> & object,
    transition: AnimTransition
  ): void {
    const targetState = layer.states.find(s => s.id === transition.toState);
    if (!targetState) return;

    const action = this.getOrCreateAction(targetState.clipName);
    if (!action) return;

    action.reset();
    action.setLoop(targetState.loop ? THREE.LoopRepeat : THREE.LoopOnce, targetState.loop ? Infinity : 1);
    action.timeScale = targetState.speed;
    action.setEffectiveWeight(layer.weight);

    if (transition.duration > 0 && runtime.currentAction) {
      // Crossfade
      action.play();
      runtime.currentAction.crossFadeTo(action, transition.duration, true);
      runtime.transitioning = true;
      runtime.transitionAction = action;
      runtime.transitionTime = 0;
      runtime.transitionDuration = transition.duration;
    } else {
      // Instant switch
      if (runtime.currentAction) runtime.currentAction.stop();
      action.play();
      runtime.currentAction = action;
      runtime.stateTime = 0;
    }

    runtime.currentState = transition.toState;
  }

  private updateBlendTree(blendTree: BlendTree, layerWeight: number): void {
    if (!this.mixer) return;
    const param = this.params.get(blendTree.paramName);
    if (!param || typeof param.value !== 'number') return;

    const val = param.value as number;

    if (blendTree.type === '1D') {
      // 1D blend: interpolate weights between children based on parameter
      for (const child of blendTree.children) {
        const action = this.getOrCreateAction(child.clipName);
        if (!action) continue;

        // Calculate weight based on distance to threshold
        let weight = 0;
        const sorted = [...blendTree.children].sort((a, b) => a.threshold - b.threshold);
        const idx = sorted.indexOf(child);

        if (sorted.length === 1) {
          weight = 1;
        } else if (idx === 0) {
          const d01 = sorted[1].threshold - sorted[0].threshold;
          weight = val <= sorted[0].threshold ? 1 :
                   val >= sorted[1].threshold ? 0 :
                   d01 === 0 ? 1 : 1 - (val - sorted[0].threshold) / d01;
        } else if (idx === sorted.length - 1) {
          const dPrev = sorted[idx].threshold - sorted[idx - 1].threshold;
          weight = val >= sorted[idx].threshold ? 1 :
                   val <= sorted[idx - 1].threshold ? 0 :
                   dPrev === 0 ? 1 : (val - sorted[idx - 1].threshold) / dPrev;
        } else {
          const lo = sorted[idx - 1].threshold;
          const hi = sorted[idx + 1].threshold;
          const dLo = sorted[idx].threshold - lo;
          const dHi = hi - sorted[idx].threshold;
          if (val >= lo && val <= sorted[idx].threshold) {
            weight = dLo === 0 ? 1 : (val - lo) / dLo;
          } else if (val > sorted[idx].threshold && val <= hi) {
            weight = dHi === 0 ? 0 : 1 - (val - sorted[idx].threshold) / dHi;
          }
        }

        action.setEffectiveWeight(weight * layerWeight);
        if (weight > 0 && !action.isRunning()) action.play();
      }
    }
  }

  private getOrCreateAction(clipName: string): THREE.AnimationAction | null {
    if (!this.mixer) return null;

    let action = this.actions.get(clipName);
    if (action) return action;

    const clip = this.clips.get(clipName);
    if (!clip) return null;

    action = this.mixer.clipAction(clip);
    this.actions.set(clipName, action);
    return action;
  }

  /** Get current state name for a layer */
  getCurrentState(layerName?: string): string | undefined {
    const name = layerName ?? this.def.layers[0]?.name;
    return name ? this.layerStates.get(name)?.currentState : undefined;
  }

  /** Get the definition (for serialization/editor) */
  getDefinition(): AnimStateMachineDef {
    return this.def;
  }

  /** Serialize to JSON */
  serialize(): string {
    const serializable = {
      ...this.def,
      layers: this.def.layers.map(l => ({
        ...l,
        blendTrees: Object.fromEntries(l.blendTrees),
      })),
    };
    return JSON.stringify(serializable, null, 2);
  }

  /** Deserialize from JSON */
  static deserialize(json: string): AnimationStateMachine {
    const data = JSON.parse(json);
    const def: AnimStateMachineDef = {
      ...data,
      layers: data.layers.map((l: Record<string, unknown>) => ({
        ...l,
        blendTrees: new Map(Object.entries(l.blendTrees ?? {})),
      })),
    };
    return new AnimationStateMachine(def);
  }

  /** Create an empty default state machine */
  static createDefault(name = 'Default'): AnimationStateMachine {
    return new AnimationStateMachine({
      name,
      parameters: [
        { name: 'speed', type: 'float', value: 0 },
        { name: 'isGrounded', type: 'bool', value: true },
        { name: 'jump', type: 'trigger', value: false },
      ],
      layers: [{
        name: 'Base',
        weight: 1,
        blendMode: 'override',
        states: [
          { id: 'idle', name: 'Idle', clipName: 'idle', speed: 1, loop: true, editorX: 100, editorY: 200 },
          { id: 'walk', name: 'Walk', clipName: 'walk', speed: 1, loop: true, editorX: 300, editorY: 200 },
          { id: 'run', name: 'Run', clipName: 'run', speed: 1, loop: true, editorX: 500, editorY: 200 },
          { id: 'jump', name: 'Jump', clipName: 'jump', speed: 1, loop: false, editorX: 300, editorY: 50 },
        ],
        transitions: [
          { id: 't1', fromState: 'idle', toState: 'walk', conditions: [{ paramName: 'speed', op: 'greater', threshold: 0.1 }], duration: 0.2, exitTime: 0, hasExitTime: false },
          { id: 't2', fromState: 'walk', toState: 'idle', conditions: [{ paramName: 'speed', op: 'less', threshold: 0.1 }], duration: 0.2, exitTime: 0, hasExitTime: false },
          { id: 't3', fromState: 'walk', toState: 'run', conditions: [{ paramName: 'speed', op: 'greater', threshold: 0.6 }], duration: 0.2, exitTime: 0, hasExitTime: false },
          { id: 't4', fromState: 'run', toState: 'walk', conditions: [{ paramName: 'speed', op: 'less', threshold: 0.6 }], duration: 0.2, exitTime: 0, hasExitTime: false },
          { id: 't5', fromState: 'any', toState: 'jump', conditions: [{ paramName: 'jump', op: 'isTrue' }], duration: 0.1, exitTime: 0, hasExitTime: false },
          { id: 't6', fromState: 'jump', toState: 'idle', conditions: [{ paramName: 'isGrounded', op: 'isTrue' }], duration: 0.2, exitTime: 0.8, hasExitTime: true },
        ],
        defaultState: 'idle',
        blendTrees: new Map(),
      }],
    });
  }
}
