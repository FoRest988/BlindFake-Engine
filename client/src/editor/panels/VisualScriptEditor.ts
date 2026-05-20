/**
 * VisualScripting — Node-based visual programming system.
 *
 * Features:
 * - Drag-and-drop node graph editor
 * - Node types: Events, Actions, Conditions, Variables, Math, Flow Control
 * - Socket-based connections (data & execution flow)
 * - Compile graph → runnable script
 * - Runtime execution engine
 * - Undo/redo for node operations
 * - Copy/paste nodes
 * - Mini-map navigation
 * - Search/add node palette
 */

export type SocketType = 'exec' | 'number' | 'string' | 'boolean' | 'vec3' | 'object' | 'any';
export type SocketDirection = 'input' | 'output';

export interface SocketDef {
  name: string;
  type: SocketType;
  direction: SocketDirection;
  defaultValue?: unknown;
}

export interface NodeDef {
  type: string;
  category: string;
  label: string;
  color: string;
  inputs: SocketDef[];
  outputs: SocketDef[];
  /** Execution function — receives input values, returns output values */
  execute?: (inputs: Record<string, unknown>, context: ScriptContext) => Record<string, unknown> | void;
}

export interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Runtime values for input sockets (overrides from connections) */
  inputValues: Record<string, unknown>;
  /** Custom display data */
  data?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  fromNode: string;
  fromSocket: string;
  toNode: string;
  toSocket: string;
}

export interface VisualGraph {
  nodes: GraphNode[];
  connections: Connection[];
  variables: GraphVariable[];
  comments: CommentBox[];
  /** Subgraph definitions owned by this graph (Phase 12) */
  subgraphs?: SubgraphDef[];
}

export interface CommentBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

export interface GraphVariable {
  name: string;
  type: SocketType;
  defaultValue: unknown;
}

export interface ScriptContext {
  delta: number;
  time: number;
  entity?: unknown;
  scene?: { getObjectByName(name: string): unknown; traverse(callback: (obj: any) => void): void };
  variables: Record<string, unknown>;
  /** Trigger next exec output */
  execOutput: (name: string) => void;
  /** Log to console */
  log: (...args: unknown[]) => void;
}

/* ─── Socket Colors ─────────────────────────────────── */

const SOCKET_COLORS: Record<SocketType, string> = {
  exec: '#ffffff',
  number: '#4fc3f7',
  string: '#e91e63',
  boolean: '#f44336',
  vec3: '#ab47bc',
  object: '#ff9800',
  any: '#9e9e9e',
};

/* ─── Built-in Node Definitions ─────────────────────── */

export const NODE_LIBRARY: NodeDef[] = [
  // ─── Events ───
  {
    type: 'event_start', category: 'Events', label: 'On Start', color: '#c62828',
    inputs: [],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'event_update', category: 'Events', label: 'On Update', color: '#c62828',
    inputs: [],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'delta', type: 'number', direction: 'output' },
    ],
  },
  {
    type: 'event_key', category: 'Events', label: 'On Key Press', color: '#c62828',
    inputs: [{ name: 'key', type: 'string', direction: 'input', defaultValue: 'Space' }],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'event_collision', category: 'Events', label: 'On Collision', color: '#c62828',
    inputs: [],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'other', type: 'object', direction: 'output' },
    ],
  },
  {
    type: 'event_custom', category: 'Events', label: 'On Custom Event', color: '#c62828',
    inputs: [{ name: 'eventName', type: 'string', direction: 'input', defaultValue: 'myEvent' }],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'data', type: 'any', direction: 'output' },
    ],
  },

  // ─── Flow Control ───
  {
    type: 'flow_branch', category: 'Flow', label: 'Branch (If)', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'condition', type: 'boolean', direction: 'input' },
    ],
    outputs: [
      { name: 'true', type: 'exec', direction: 'output' },
      { name: 'false', type: 'exec', direction: 'output' },
    ],
    execute: (inputs, ctx) => {
      ctx.execOutput(inputs.condition ? 'true' : 'false');
    },
  },
  {
    type: 'flow_sequence', category: 'Flow', label: 'Sequence', color: '#1565c0',
    inputs: [{ name: 'exec', type: 'exec', direction: 'input' }],
    outputs: [
      { name: 'then_0', type: 'exec', direction: 'output' },
      { name: 'then_1', type: 'exec', direction: 'output' },
      { name: 'then_2', type: 'exec', direction: 'output' },
    ],
    execute: (_inputs, ctx) => {
      ctx.execOutput('then_0');
      ctx.execOutput('then_1');
      ctx.execOutput('then_2');
    },
  },
  {
    type: 'flow_for', category: 'Flow', label: 'For Loop', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'count', type: 'number', direction: 'input', defaultValue: 10 },
    ],
    outputs: [
      { name: 'body', type: 'exec', direction: 'output' },
      { name: 'index', type: 'number', direction: 'output' },
      { name: 'done', type: 'exec', direction: 'output' },
    ],
  },
  {
    type: 'flow_delay', category: 'Flow', label: 'Delay', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'seconds', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
    ],
  },

  // ─── Math ───
  {
    type: 'math_add', category: 'Math', label: 'Add', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) + (inputs.B as number) }),
  },
  {
    type: 'math_subtract', category: 'Math', label: 'Subtract', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) - (inputs.B as number) }),
  },
  {
    type: 'math_multiply', category: 'Math', label: 'Multiply', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) * (inputs.B as number) }),
  },
  {
    type: 'math_divide', category: 'Math', label: 'Divide', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.B as number) !== 0 ? (inputs.A as number) / (inputs.B as number) : 0 }),
  },
  {
    type: 'math_clamp', category: 'Math', label: 'Clamp', color: '#2e7d32',
    inputs: [
      { name: 'value', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'min', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'max', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.max(inputs.min as number, Math.min(inputs.max as number, inputs.value as number)) }),
  },
  {
    type: 'math_random', category: 'Math', label: 'Random', color: '#2e7d32',
    inputs: [
      { name: 'min', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'max', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.min as number) + Math.random() * ((inputs.max as number) - (inputs.min as number)) }),
  },
  {
    type: 'math_lerp', category: 'Math', label: 'Lerp', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 1 },
      { name: 't', type: 'number', direction: 'input', defaultValue: 0.5 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => {
      const a = inputs.A as number, b = inputs.B as number, t = inputs.t as number;
      return { result: a + (b - a) * t };
    },
  },

  // ─── Comparison ───
  {
    type: 'compare_equal', category: 'Comparison', label: 'Equal', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'any', direction: 'input' },
      { name: 'B', type: 'any', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: inputs.A === inputs.B }),
  },
  {
    type: 'compare_greater', category: 'Comparison', label: 'Greater Than', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) > (inputs.B as number) }),
  },
  {
    type: 'compare_less', category: 'Comparison', label: 'Less Than', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) < (inputs.B as number) }),
  },
  {
    type: 'logic_and', category: 'Comparison', label: 'AND', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'boolean', direction: 'input', defaultValue: false },
      { name: 'B', type: 'boolean', direction: 'input', defaultValue: false },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: !!(inputs.A && inputs.B) }),
  },
  {
    type: 'logic_or', category: 'Comparison', label: 'OR', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'boolean', direction: 'input', defaultValue: false },
      { name: 'B', type: 'boolean', direction: 'input', defaultValue: false },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: !!(inputs.A || inputs.B) }),
  },
  {
    type: 'logic_not', category: 'Comparison', label: 'NOT', color: '#6a1b9a',
    inputs: [{ name: 'value', type: 'boolean', direction: 'input', defaultValue: false }],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: !inputs.value }),
  },

  // ─── Actions ───
  {
    type: 'action_log', category: 'Actions', label: 'Print', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'message', type: 'any', direction: 'input', defaultValue: 'Hello!' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
    execute: (inputs, ctx) => { ctx.log(inputs.message); ctx.execOutput('exec'); },
  },
  {
    type: 'action_setPosition', category: 'Actions', label: 'Set Position', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'position', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'action_translate', category: 'Actions', label: 'Translate', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'offset', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'action_rotate', category: 'Actions', label: 'Rotate', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'euler', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'action_spawn', category: 'Actions', label: 'Spawn Prefab', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'prefabName', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'position', type: 'vec3', direction: 'input' },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'spawned', type: 'object', direction: 'output' },
    ],
  },
  {
    type: 'action_destroy', category: 'Actions', label: 'Destroy', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'action_playSound', category: 'Actions', label: 'Play Sound', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'sound', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'volume', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Variables ───
  {
    type: 'var_get', category: 'Variables', label: 'Get Variable', color: '#00695c',
    inputs: [{ name: 'name', type: 'string', direction: 'input', defaultValue: 'myVar' }],
    outputs: [{ name: 'value', type: 'any', direction: 'output' }],
    execute: (inputs, ctx) => ({ value: ctx.variables[inputs.name as string] }),
  },
  {
    type: 'var_set', category: 'Variables', label: 'Set Variable', color: '#00695c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'name', type: 'string', direction: 'input', defaultValue: 'myVar' },
      { name: 'value', type: 'any', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
    execute: (inputs, ctx) => { ctx.variables[inputs.name as string] = inputs.value; ctx.execOutput('exec'); },
  },

  // ─── Utility ───
  {
    type: 'util_makeVec3', category: 'Utility', label: 'Make Vector3', color: '#37474f',
    inputs: [
      { name: 'x', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'y', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'z', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'vector', type: 'vec3', direction: 'output' }],
    execute: (inputs) => ({ vector: { x: inputs.x, y: inputs.y, z: inputs.z } }),
  },
  {
    type: 'util_breakVec3', category: 'Utility', label: 'Break Vector3', color: '#37474f',
    inputs: [{ name: 'vector', type: 'vec3', direction: 'input' }],
    outputs: [
      { name: 'x', type: 'number', direction: 'output' },
      { name: 'y', type: 'number', direction: 'output' },
      { name: 'z', type: 'number', direction: 'output' },
    ],
    execute: (inputs) => {
      const v = inputs.vector as { x: number; y: number; z: number } | undefined;
      return { x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0 };
    },
  },
  {
    type: 'util_toString', category: 'Utility', label: 'To String', color: '#37474f',
    inputs: [{ name: 'value', type: 'any', direction: 'input' }],
    outputs: [{ name: 'string', type: 'string', direction: 'output' }],
    execute: (inputs) => ({ string: String(inputs.value) }),
  },
  {
    type: 'util_toNumber', category: 'Utility', label: 'To Number', color: '#37474f',
    inputs: [{ name: 'value', type: 'any', direction: 'input' }],
    outputs: [{ name: 'number', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ number: Number(inputs.value) || 0 }),
  },

  // ─── Math (Extended) ───
  {
    type: 'math_abs', category: 'Math', label: 'Abs', color: '#2e7d32',
    inputs: [{ name: 'value', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.abs(inputs.value as number) }),
  },
  {
    type: 'math_negate', category: 'Math', label: 'Negate', color: '#2e7d32',
    inputs: [{ name: 'value', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: -(inputs.value as number) }),
  },
  {
    type: 'math_modulo', category: 'Math', label: 'Modulo', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.B as number) !== 0 ? (inputs.A as number) % (inputs.B as number) : 0 }),
  },
  {
    type: 'math_power', category: 'Math', label: 'Power', color: '#2e7d32',
    inputs: [
      { name: 'base', type: 'number', direction: 'input', defaultValue: 2 },
      { name: 'exp', type: 'number', direction: 'input', defaultValue: 2 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.pow(inputs.base as number, inputs.exp as number) }),
  },
  {
    type: 'math_sqrt', category: 'Math', label: 'Square Root', color: '#2e7d32',
    inputs: [{ name: 'value', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.sqrt(Math.max(0, inputs.value as number)) }),
  },
  {
    type: 'math_sin', category: 'Math', label: 'Sin', color: '#2e7d32',
    inputs: [{ name: 'radians', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.sin(inputs.radians as number) }),
  },
  {
    type: 'math_cos', category: 'Math', label: 'Cos', color: '#2e7d32',
    inputs: [{ name: 'radians', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.cos(inputs.radians as number) }),
  },
  {
    type: 'math_atan2', category: 'Math', label: 'Atan2', color: '#2e7d32',
    inputs: [
      { name: 'Y', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'X', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.atan2(inputs.Y as number, inputs.X as number) }),
  },
  {
    type: 'math_floor', category: 'Math', label: 'Floor', color: '#2e7d32',
    inputs: [{ name: 'value', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.floor(inputs.value as number) }),
  },
  {
    type: 'math_ceil', category: 'Math', label: 'Ceil', color: '#2e7d32',
    inputs: [{ name: 'value', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.ceil(inputs.value as number) }),
  },
  {
    type: 'math_round', category: 'Math', label: 'Round', color: '#2e7d32',
    inputs: [{ name: 'value', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.round(inputs.value as number) }),
  },
  {
    type: 'math_min', category: 'Math', label: 'Min', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.min(inputs.A as number, inputs.B as number) }),
  },
  {
    type: 'math_max', category: 'Math', label: 'Max', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ result: Math.max(inputs.A as number, inputs.B as number) }),
  },
  {
    type: 'math_distance', category: 'Math', label: 'Distance', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'vec3', direction: 'input' },
      { name: 'B', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => {
      const a = inputs.A as { x: number; y: number; z: number } | undefined;
      const b = inputs.B as { x: number; y: number; z: number } | undefined;
      if (!a || !b) return { result: 0 };
      return { result: Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) };
    },
  },
  {
    type: 'math_dot', category: 'Math', label: 'Dot Product', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'vec3', direction: 'input' },
      { name: 'B', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'number', direction: 'output' }],
    execute: (inputs) => {
      const a = inputs.A as { x: number; y: number; z: number } | undefined;
      const b = inputs.B as { x: number; y: number; z: number } | undefined;
      if (!a || !b) return { result: 0 };
      return { result: a.x * b.x + a.y * b.y + a.z * b.z };
    },
  },
  {
    type: 'math_cross', category: 'Math', label: 'Cross Product', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'vec3', direction: 'input' },
      { name: 'B', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'vec3', direction: 'output' }],
    execute: (inputs) => {
      const a = inputs.A as { x: number; y: number; z: number } | undefined;
      const b = inputs.B as { x: number; y: number; z: number } | undefined;
      if (!a || !b) return { result: { x: 0, y: 0, z: 0 } };
      return { result: { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } };
    },
  },
  {
    type: 'math_normalize', category: 'Math', label: 'Normalize', color: '#2e7d32',
    inputs: [{ name: 'vector', type: 'vec3', direction: 'input' }],
    outputs: [{ name: 'result', type: 'vec3', direction: 'output' }],
    execute: (inputs) => {
      const v = inputs.vector as { x: number; y: number; z: number } | undefined;
      if (!v) return { result: { x: 0, y: 0, z: 0 } };
      const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
      return { result: { x: v.x / len, y: v.y / len, z: v.z / len } };
    },
  },
  {
    type: 'math_degToRad', category: 'Math', label: 'Deg → Rad', color: '#2e7d32',
    inputs: [{ name: 'degrees', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'radians', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ radians: (inputs.degrees as number) * Math.PI / 180 }),
  },
  {
    type: 'math_radToDeg', category: 'Math', label: 'Rad → Deg', color: '#2e7d32',
    inputs: [{ name: 'radians', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'degrees', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ degrees: (inputs.radians as number) * 180 / Math.PI }),
  },
  {
    type: 'math_vecAdd', category: 'Math', label: 'Add Vectors', color: '#2e7d32',
    inputs: [
      { name: 'A', type: 'vec3', direction: 'input' },
      { name: 'B', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'vec3', direction: 'output' }],
    execute: (inputs) => {
      const a = inputs.A as { x: number; y: number; z: number } | undefined;
      const b = inputs.B as { x: number; y: number; z: number } | undefined;
      return { result: { x: (a?.x ?? 0) + (b?.x ?? 0), y: (a?.y ?? 0) + (b?.y ?? 0), z: (a?.z ?? 0) + (b?.z ?? 0) } };
    },
  },
  {
    type: 'math_vecScale', category: 'Math', label: 'Scale Vector', color: '#2e7d32',
    inputs: [
      { name: 'vector', type: 'vec3', direction: 'input' },
      { name: 'scalar', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'result', type: 'vec3', direction: 'output' }],
    execute: (inputs) => {
      const v = inputs.vector as { x: number; y: number; z: number } | undefined;
      const s = inputs.scalar as number;
      return { result: { x: (v?.x ?? 0) * s, y: (v?.y ?? 0) * s, z: (v?.z ?? 0) * s } };
    },
  },

  // ─── Comparison (Extended) ───
  {
    type: 'compare_greaterEqual', category: 'Comparison', label: 'Greater / Equal', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) >= (inputs.B as number) }),
  },
  {
    type: 'compare_lessEqual', category: 'Comparison', label: 'Less / Equal', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'B', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: (inputs.A as number) <= (inputs.B as number) }),
  },
  {
    type: 'compare_notEqual', category: 'Comparison', label: 'Not Equal', color: '#6a1b9a',
    inputs: [
      { name: 'A', type: 'any', direction: 'input' },
      { name: 'B', type: 'any', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: inputs.A !== inputs.B }),
  },
  {
    type: 'flow_select', category: 'Comparison', label: 'Select', color: '#6a1b9a',
    inputs: [
      { name: 'condition', type: 'boolean', direction: 'input', defaultValue: true },
      { name: 'A', type: 'any', direction: 'input' },
      { name: 'B', type: 'any', direction: 'input' },
    ],
    outputs: [{ name: 'result', type: 'any', direction: 'output' }],
    execute: (inputs) => ({ result: inputs.condition ? inputs.A : inputs.B }),
  },

  // ─── Flow Control (Extended) ───
  {
    type: 'flow_whileLoop', category: 'Flow', label: 'While Loop', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'condition', type: 'boolean', direction: 'input', defaultValue: true },
    ],
    outputs: [
      { name: 'body', type: 'exec', direction: 'output' },
      { name: 'done', type: 'exec', direction: 'output' },
    ],
  },
  {
    type: 'flow_doOnce', category: 'Flow', label: 'Do Once', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'reset', type: 'exec', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'flow_flipFlop', category: 'Flow', label: 'Flip Flop', color: '#1565c0',
    inputs: [{ name: 'exec', type: 'exec', direction: 'input' }],
    outputs: [
      { name: 'A', type: 'exec', direction: 'output' },
      { name: 'B', type: 'exec', direction: 'output' },
      { name: 'isA', type: 'boolean', direction: 'output' },
    ],
  },
  {
    type: 'flow_gate', category: 'Flow', label: 'Gate', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'open', type: 'exec', direction: 'input' },
      { name: 'close', type: 'exec', direction: 'input' },
      { name: 'toggle', type: 'exec', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'flow_forEach', category: 'Flow', label: 'ForEach Loop', color: '#1565c0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'array', type: 'any', direction: 'input' },
    ],
    outputs: [
      { name: 'body', type: 'exec', direction: 'output' },
      { name: 'element', type: 'any', direction: 'output' },
      { name: 'index', type: 'number', direction: 'output' },
      { name: 'done', type: 'exec', direction: 'output' },
    ],
  },

  // ─── String ───
  {
    type: 'string_concat', category: 'String', label: 'Concat', color: '#ad1457',
    inputs: [
      { name: 'A', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'B', type: 'string', direction: 'input', defaultValue: '' },
    ],
    outputs: [{ name: 'result', type: 'string', direction: 'output' }],
    execute: (inputs) => ({ result: String(inputs.A ?? '') + String(inputs.B ?? '') }),
  },
  {
    type: 'string_length', category: 'String', label: 'String Length', color: '#ad1457',
    inputs: [{ name: 'string', type: 'string', direction: 'input', defaultValue: '' }],
    outputs: [{ name: 'length', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ length: String(inputs.string ?? '').length }),
  },
  {
    type: 'string_contains', category: 'String', label: 'Contains', color: '#ad1457',
    inputs: [
      { name: 'string', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'search', type: 'string', direction: 'input', defaultValue: '' },
    ],
    outputs: [{ name: 'result', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ result: String(inputs.string ?? '').includes(String(inputs.search ?? '')) }),
  },
  {
    type: 'string_replace', category: 'String', label: 'Replace', color: '#ad1457',
    inputs: [
      { name: 'string', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'search', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'replace', type: 'string', direction: 'input', defaultValue: '' },
    ],
    outputs: [{ name: 'result', type: 'string', direction: 'output' }],
    execute: (inputs) => ({ result: String(inputs.string ?? '').replaceAll(String(inputs.search ?? ''), String(inputs.replace ?? '')) }),
  },
  {
    type: 'string_substring', category: 'String', label: 'Substring', color: '#ad1457',
    inputs: [
      { name: 'string', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'start', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'end', type: 'number', direction: 'input', defaultValue: 5 },
    ],
    outputs: [{ name: 'result', type: 'string', direction: 'output' }],
    execute: (inputs) => ({ result: String(inputs.string ?? '').substring(inputs.start as number, inputs.end as number) }),
  },
  {
    type: 'string_split', category: 'String', label: 'Split', color: '#ad1457',
    inputs: [
      { name: 'string', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'delimiter', type: 'string', direction: 'input', defaultValue: ',' },
    ],
    outputs: [{ name: 'array', type: 'any', direction: 'output' }],
    execute: (inputs) => ({ array: String(inputs.string ?? '').split(String(inputs.delimiter ?? ',')) }),
  },
  {
    type: 'string_format', category: 'String', label: 'Format String', color: '#ad1457',
    inputs: [
      { name: 'template', type: 'string', direction: 'input', defaultValue: 'Hello {0}!' },
      { name: 'arg0', type: 'any', direction: 'input', defaultValue: 'World' },
      { name: 'arg1', type: 'any', direction: 'input', defaultValue: '' },
      { name: 'arg2', type: 'any', direction: 'input', defaultValue: '' },
    ],
    outputs: [{ name: 'result', type: 'string', direction: 'output' }],
    execute: (inputs) => {
      let s = String(inputs.template ?? '');
      s = s.replace('{0}', String(inputs.arg0 ?? ''));
      s = s.replace('{1}', String(inputs.arg1 ?? ''));
      s = s.replace('{2}', String(inputs.arg2 ?? ''));
      return { result: s };
    },
  },
  {
    type: 'string_toUpper', category: 'String', label: 'To Uppercase', color: '#ad1457',
    inputs: [{ name: 'string', type: 'string', direction: 'input', defaultValue: '' }],
    outputs: [{ name: 'result', type: 'string', direction: 'output' }],
    execute: (inputs) => ({ result: String(inputs.string ?? '').toUpperCase() }),
  },
  {
    type: 'string_toLower', category: 'String', label: 'To Lowercase', color: '#ad1457',
    inputs: [{ name: 'string', type: 'string', direction: 'input', defaultValue: '' }],
    outputs: [{ name: 'result', type: 'string', direction: 'output' }],
    execute: (inputs) => ({ result: String(inputs.string ?? '').toLowerCase() }),
  },

  // ─── Scene / Object ───
  {
    type: 'scene_getSelf', category: 'Scene', label: 'Get Self', color: '#00838f',
    inputs: [],
    outputs: [{ name: 'self', type: 'object', direction: 'output' }],
    execute: (_inputs, ctx) => ({ self: ctx.entity }),
  },
  {
    type: 'scene_getByName', category: 'Scene', label: 'Get Object by Name', color: '#00838f',
    inputs: [{ name: 'name', type: 'string', direction: 'input', defaultValue: '' }],
    outputs: [{ name: 'object', type: 'object', direction: 'output' }],
    execute: (inputs, ctx) => ({ object: ctx.scene?.getObjectByName(String(inputs.name ?? '')) ?? null }),
  },
  {
    type: 'scene_getPosition', category: 'Scene', label: 'Get Position', color: '#00838f',
    inputs: [{ name: 'target', type: 'object', direction: 'input' }],
    outputs: [{ name: 'position', type: 'vec3', direction: 'output' }],
    execute: (inputs) => {
      const obj = inputs.target as any;
      return { position: obj?.position ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : { x: 0, y: 0, z: 0 } };
    },
  },
  {
    type: 'scene_getRotation', category: 'Scene', label: 'Get Rotation', color: '#00838f',
    inputs: [{ name: 'target', type: 'object', direction: 'input' }],
    outputs: [{ name: 'rotation', type: 'vec3', direction: 'output' }],
    execute: (inputs) => {
      const obj = inputs.target as any;
      return { rotation: obj?.rotation ? { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z } : { x: 0, y: 0, z: 0 } };
    },
  },
  {
    type: 'scene_setScale', category: 'Scene', label: 'Set Scale', color: '#00838f',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'scale', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'scene_setVisible', category: 'Scene', label: 'Set Visible', color: '#00838f',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'visible', type: 'boolean', direction: 'input', defaultValue: true },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'scene_getChildren', category: 'Scene', label: 'Get Children', color: '#00838f',
    inputs: [{ name: 'target', type: 'object', direction: 'input' }],
    outputs: [
      { name: 'children', type: 'any', direction: 'output' },
      { name: 'count', type: 'number', direction: 'output' },
    ],
    execute: (inputs) => {
      const obj = inputs.target as any;
      const children = obj?.children ?? [];
      return { children, count: children.length };
    },
  },
  {
    type: 'scene_findByTag', category: 'Scene', label: 'Find by Tag', color: '#00838f',
    inputs: [{ name: 'tag', type: 'string', direction: 'input', defaultValue: '' }],
    outputs: [{ name: 'objects', type: 'any', direction: 'output' }],
    execute: (inputs, ctx) => {
      const results: any[] = [];
      ctx.scene?.traverse((obj: any) => { if (obj.userData?.tag === inputs.tag) results.push(obj); });
      return { objects: results };
    },
  },
  {
    type: 'scene_setMaterialColor', category: 'Scene', label: 'Set Material Color', color: '#00838f',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'color', type: 'string', direction: 'input', defaultValue: '#ff0000' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'scene_lookAt', category: 'Scene', label: 'Look At', color: '#00838f',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'point', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Physics ───
  {
    type: 'physics_applyForce', category: 'Physics', label: 'Apply Force', color: '#4527a0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'force', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'physics_applyImpulse', category: 'Physics', label: 'Apply Impulse', color: '#4527a0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'impulse', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'physics_setVelocity', category: 'Physics', label: 'Set Velocity', color: '#4527a0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'velocity', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'physics_getVelocity', category: 'Physics', label: 'Get Velocity', color: '#4527a0',
    inputs: [{ name: 'target', type: 'object', direction: 'input' }],
    outputs: [{ name: 'velocity', type: 'vec3', direction: 'output' }],
  },
  {
    type: 'physics_raycast', category: 'Physics', label: 'Raycast', color: '#4527a0',
    inputs: [
      { name: 'origin', type: 'vec3', direction: 'input' },
      { name: 'direction', type: 'vec3', direction: 'input' },
      { name: 'maxDist', type: 'number', direction: 'input', defaultValue: 100 },
    ],
    outputs: [
      { name: 'hit', type: 'boolean', direction: 'output' },
      { name: 'point', type: 'vec3', direction: 'output' },
      { name: 'normal', type: 'vec3', direction: 'output' },
      { name: 'object', type: 'object', direction: 'output' },
      { name: 'distance', type: 'number', direction: 'output' },
    ],
  },
  {
    type: 'physics_setGravity', category: 'Physics', label: 'Set Gravity', color: '#4527a0',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'gravity', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Animation ───
  {
    type: 'anim_play', category: 'Animation', label: 'Play Animation', color: '#ef6c00',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'clipName', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'loop', type: 'boolean', direction: 'input', defaultValue: true },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'anim_stop', category: 'Animation', label: 'Stop Animation', color: '#ef6c00',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'anim_crossFade', category: 'Animation', label: 'Cross Fade', color: '#ef6c00',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'clipName', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'duration', type: 'number', direction: 'input', defaultValue: 0.3 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'anim_setSpeed', category: 'Animation', label: 'Set Anim Speed', color: '#ef6c00',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'speed', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Input ───
  {
    type: 'input_isKeyHeld', category: 'Input', label: 'Is Key Held', color: '#558b2f',
    inputs: [{ name: 'key', type: 'string', direction: 'input', defaultValue: 'KeyW' }],
    outputs: [{ name: 'held', type: 'boolean', direction: 'output' }],
  },
  {
    type: 'input_getAxis', category: 'Input', label: 'Get Axis', color: '#558b2f',
    inputs: [{ name: 'axis', type: 'string', direction: 'input', defaultValue: 'Horizontal' }],
    outputs: [{ name: 'value', type: 'number', direction: 'output' }],
  },
  {
    type: 'input_mousePosition', category: 'Input', label: 'Mouse Position', color: '#558b2f',
    inputs: [],
    outputs: [
      { name: 'x', type: 'number', direction: 'output' },
      { name: 'y', type: 'number', direction: 'output' },
    ],
  },
  {
    type: 'input_mouseButton', category: 'Input', label: 'Mouse Button', color: '#558b2f',
    inputs: [{ name: 'button', type: 'number', direction: 'input', defaultValue: 0 }],
    outputs: [{ name: 'pressed', type: 'boolean', direction: 'output' }],
  },
  {
    type: 'input_getGamepadAxis', category: 'Input', label: 'Gamepad Axis', color: '#558b2f',
    inputs: [
      { name: 'padIndex', type: 'number', direction: 'input', defaultValue: 0 },
      { name: 'axisIndex', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'value', type: 'number', direction: 'output' }],
  },

  // ─── Time ───
  {
    type: 'time_getTime', category: 'Time', label: 'Get Time', color: '#00695c',
    inputs: [],
    outputs: [{ name: 'time', type: 'number', direction: 'output' }],
    execute: (_inputs, ctx) => ({ time: ctx.time }),
  },
  {
    type: 'time_deltaTime', category: 'Time', label: 'Delta Time', color: '#00695c',
    inputs: [],
    outputs: [{ name: 'delta', type: 'number', direction: 'output' }],
    execute: (_inputs, ctx) => ({ delta: ctx.delta }),
  },
  {
    type: 'time_timer', category: 'Time', label: 'Set Timer', color: '#00695c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'seconds', type: 'number', direction: 'input', defaultValue: 1 },
      { name: 'looping', type: 'boolean', direction: 'input', defaultValue: false },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
    ],
  },

  // ─── Events (Extended) ───
  {
    type: 'event_mouseClick', category: 'Events', label: 'On Mouse Click', color: '#c62828',
    inputs: [],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'position', type: 'vec3', direction: 'output' },
      { name: 'button', type: 'number', direction: 'output' },
    ],
  },
  {
    type: 'event_overlap', category: 'Events', label: 'On Overlap', color: '#c62828',
    inputs: [],
    outputs: [
      { name: 'beginExec', type: 'exec', direction: 'output' },
      { name: 'endExec', type: 'exec', direction: 'output' },
      { name: 'other', type: 'object', direction: 'output' },
    ],
  },
  {
    type: 'event_fire', category: 'Events', label: 'Fire Custom Event', color: '#c62828',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'eventName', type: 'string', direction: 'input', defaultValue: 'myEvent' },
      { name: 'data', type: 'any', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'event_keyRelease', category: 'Events', label: 'On Key Release', color: '#c62828',
    inputs: [{ name: 'key', type: 'string', direction: 'input', defaultValue: 'Space' }],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Actions (Extended) ───
  {
    type: 'action_setRotation', category: 'Actions', label: 'Set Rotation', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'euler', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'action_addForce', category: 'Actions', label: 'Move Towards', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'destination', type: 'vec3', direction: 'input' },
      { name: 'speed', type: 'number', direction: 'input', defaultValue: 5 },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'reached', type: 'boolean', direction: 'output' },
    ],
  },
  {
    type: 'action_emitParticles', category: 'Actions', label: 'Emit Particles', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'position', type: 'vec3', direction: 'input' },
      { name: 'count', type: 'number', direction: 'input', defaultValue: 10 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'action_cameraShake', category: 'Actions', label: 'Camera Shake', color: '#e65100',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'intensity', type: 'number', direction: 'input', defaultValue: 0.5 },
      { name: 'duration', type: 'number', direction: 'input', defaultValue: 0.3 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Utility (Extended) ───
  {
    type: 'util_arrayGet', category: 'Utility', label: 'Array Get', color: '#37474f',
    inputs: [
      { name: 'array', type: 'any', direction: 'input' },
      { name: 'index', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'element', type: 'any', direction: 'output' }],
    execute: (inputs) => {
      const arr = inputs.array as any[];
      return { element: Array.isArray(arr) ? arr[inputs.index as number] : null };
    },
  },
  {
    type: 'util_arrayLength', category: 'Utility', label: 'Array Length', color: '#37474f',
    inputs: [{ name: 'array', type: 'any', direction: 'input' }],
    outputs: [{ name: 'length', type: 'number', direction: 'output' }],
    execute: (inputs) => ({ length: Array.isArray(inputs.array) ? (inputs.array as any[]).length : 0 }),
  },
  {
    type: 'util_isValid', category: 'Utility', label: 'Is Valid', color: '#37474f',
    inputs: [{ name: 'object', type: 'any', direction: 'input' }],
    outputs: [{ name: 'valid', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ valid: inputs.object != null }),
  },
  {
    type: 'util_comment', category: 'Utility', label: 'Reroute', color: '#37474f',
    inputs: [{ name: 'in', type: 'any', direction: 'input' }],
    outputs: [{ name: 'out', type: 'any', direction: 'output' }],
    execute: (inputs) => ({ out: inputs.in }),
  },
  {
    type: 'util_toBool', category: 'Utility', label: 'To Boolean', color: '#37474f',
    inputs: [{ name: 'value', type: 'any', direction: 'input' }],
    outputs: [{ name: 'bool', type: 'boolean', direction: 'output' }],
    execute: (inputs) => ({ bool: !!inputs.value }),
  },

  // ─── Weather ───
  {
    type: 'weather_set', category: 'Weather', label: 'Set Weather', color: '#0277bd',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'type', type: 'string', direction: 'input', defaultValue: 'rain' },
      { name: 'transition', type: 'number', direction: 'input', defaultValue: 2 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'weather_setImmediate', category: 'Weather', label: 'Set Weather Immediate', color: '#0277bd',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'type', type: 'string', direction: 'input', defaultValue: 'clear' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'weather_getType', category: 'Weather', label: 'Get Weather Type', color: '#0277bd',
    inputs: [],
    outputs: [{ name: 'type', type: 'string', direction: 'output' }],
  },
  {
    type: 'weather_setTimeOfDay', category: 'Weather', label: 'Set Time of Day', color: '#0277bd',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'hour', type: 'number', direction: 'input', defaultValue: 12 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'weather_getTimeOfDay', category: 'Weather', label: 'Get Time of Day', color: '#0277bd',
    inputs: [],
    outputs: [{ name: 'hour', type: 'number', direction: 'output' }],
  },
  {
    type: 'weather_setWind', category: 'Weather', label: 'Set Wind', color: '#0277bd',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'direction', type: 'vec3', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'weather_enableDayNight', category: 'Weather', label: 'Enable Day/Night', color: '#0277bd',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'enabled', type: 'boolean', direction: 'input', defaultValue: true },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'weather_addZone', category: 'Weather', label: 'Add Weather Zone', color: '#0277bd',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'name', type: 'string', direction: 'input', defaultValue: 'Zone1' },
      { name: 'type', type: 'string', direction: 'input', defaultValue: 'rain' },
      { name: 'position', type: 'vec3', direction: 'input' },
      { name: 'size', type: 'vec3', direction: 'input' },
      { name: 'priority', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'zoneId', type: 'string', direction: 'output' },
    ],
  },

  // ─── Audio ───
  {
    type: 'audio_playMusic', category: 'Audio', label: 'Play Music', color: '#7b1fa2',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'url', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'fadeIn', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'audio_stopMusic', category: 'Audio', label: 'Stop Music', color: '#7b1fa2',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'fadeOut', type: 'number', direction: 'input', defaultValue: 0.5 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'audio_playSpatial', category: 'Audio', label: 'Play 3D Sound', color: '#7b1fa2',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'url', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'position', type: 'vec3', direction: 'input' },
      { name: 'volume', type: 'number', direction: 'input', defaultValue: 1 },
      { name: 'loop', type: 'boolean', direction: 'input', defaultValue: false },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'audio_setVolume', category: 'Audio', label: 'Set Group Volume', color: '#7b1fa2',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'group', type: 'string', direction: 'input', defaultValue: 'sfx' },
      { name: 'volume', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'audio_stopAll', category: 'Audio', label: 'Stop All Sounds', color: '#7b1fa2',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'fadeOut', type: 'number', direction: 'input', defaultValue: 0.5 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },

  // ─── Spline / Path ───
  {
    type: 'spline_getPoint', category: 'Spline', label: 'Get Spline Point', color: '#00838f',
    inputs: [
      { name: 'splineName', type: 'string', direction: 'input', defaultValue: 'Path1' },
      { name: 't', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'position', type: 'vec3', direction: 'output' }],
  },
  {
    type: 'spline_getTangent', category: 'Spline', label: 'Get Spline Tangent', color: '#00838f',
    inputs: [
      { name: 'splineName', type: 'string', direction: 'input', defaultValue: 'Path1' },
      { name: 't', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'tangent', type: 'vec3', direction: 'output' }],
  },
  {
    type: 'spline_getLength', category: 'Spline', label: 'Get Spline Length', color: '#00838f',
    inputs: [
      { name: 'splineName', type: 'string', direction: 'input', defaultValue: 'Path1' },
    ],
    outputs: [{ name: 'length', type: 'number', direction: 'output' }],
  },
  {
    type: 'spline_follow', category: 'Spline', label: 'Follow Spline', color: '#00838f',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
      { name: 'splineName', type: 'string', direction: 'input', defaultValue: 'Path1' },
      { name: 'speed', type: 'number', direction: 'input', defaultValue: 2 },
      { name: 'loop', type: 'boolean', direction: 'input', defaultValue: true },
      { name: 'lookAhead', type: 'boolean', direction: 'input', defaultValue: true },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'done', type: 'exec', direction: 'output' },
    ],
  },
  {
    type: 'spline_sample', category: 'Spline', label: 'Sample Spline At Distance', color: '#00838f',
    inputs: [
      { name: 'splineName', type: 'string', direction: 'input', defaultValue: 'Path1' },
      { name: 'distance', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [
      { name: 'position', type: 'vec3', direction: 'output' },
      { name: 'tangent', type: 'vec3', direction: 'output' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // PHASE 12 — Expanded Node Library
  // ──────────────────────────────────────────────────────────────────

  // ─── AI / Navigation ───
  {
    type: 'ai_moveTo', category: 'AI', label: 'Move To (NavMesh)', color: '#1a6b3c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'agent', type: 'object', direction: 'input' },
      { name: 'destination', type: 'vec3', direction: 'input' },
      { name: 'speed', type: 'number', direction: 'input', defaultValue: 5 },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'arrived', type: 'exec', direction: 'output' },
    ],
  },
  {
    type: 'ai_setTarget', category: 'AI', label: 'Set Chase Target', color: '#1a6b3c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'agent', type: 'object', direction: 'input' },
      { name: 'target', type: 'object', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'ai_stopAgent', category: 'AI', label: 'Stop Agent', color: '#1a6b3c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'agent', type: 'object', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'ai_sightCheck', category: 'AI', label: 'Line of Sight', color: '#1a6b3c',
    inputs: [
      { name: 'from', type: 'object', direction: 'input' },
      { name: 'to', type: 'object', direction: 'input' },
      { name: 'maxDist', type: 'number', direction: 'input', defaultValue: 30 },
    ],
    outputs: [
      { name: 'visible', type: 'boolean', direction: 'output' },
      { name: 'distance', type: 'number', direction: 'output' },
    ],
    execute: () => ({ visible: false, distance: 0 }),
  },
  {
    type: 'ai_findNearestEnemy', category: 'AI', label: 'Find Nearest by Tag', color: '#1a6b3c',
    inputs: [
      { name: 'origin', type: 'vec3', direction: 'input' },
      { name: 'tag', type: 'string', direction: 'input', defaultValue: 'enemy' },
      { name: 'maxDist', type: 'number', direction: 'input', defaultValue: 20 },
    ],
    outputs: [
      { name: 'found', type: 'object', direction: 'output' },
      { name: 'distance', type: 'number', direction: 'output' },
      { name: 'valid', type: 'boolean', direction: 'output' },
    ],
    execute: () => ({ found: null, distance: 0, valid: false }),
  },

  // ─── UI / HUD ───
  {
    type: 'ui_showText', category: 'UI', label: 'Show HUD Text', color: '#b71c1c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'id', type: 'string', direction: 'input', defaultValue: 'hud_label' },
      { name: 'text', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'x', type: 'number', direction: 'input', defaultValue: 50 },
      { name: 'y', type: 'number', direction: 'input', defaultValue: 50 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'ui_hideElement', category: 'UI', label: 'Hide HUD Element', color: '#b71c1c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'id', type: 'string', direction: 'input', defaultValue: 'hud_label' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'ui_showImage', category: 'UI', label: 'Show HUD Image', color: '#b71c1c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'id', type: 'string', direction: 'input', defaultValue: 'hud_icon' },
      { name: 'url', type: 'string', direction: 'input', defaultValue: '' },
      { name: 'x', type: 'number', direction: 'input', defaultValue: 10 },
      { name: 'y', type: 'number', direction: 'input', defaultValue: 10 },
      { name: 'width', type: 'number', direction: 'input', defaultValue: 64 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'ui_setProgress', category: 'UI', label: 'Set Progress Bar', color: '#b71c1c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'id', type: 'string', direction: 'input', defaultValue: 'healthbar' },
      { name: 'value', type: 'number', direction: 'input', defaultValue: 0.75 },
      { name: 'color', type: 'string', direction: 'input', defaultValue: '#00cc44' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'ui_showModal', category: 'UI', label: 'Show Modal Dialog', color: '#b71c1c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'title', type: 'string', direction: 'input', defaultValue: 'Confirm' },
      { name: 'message', type: 'string', direction: 'input', defaultValue: 'Continue?' },
    ],
    outputs: [
      { name: 'confirmed', type: 'exec', direction: 'output' },
      { name: 'cancelled', type: 'exec', direction: 'output' },
    ],
  },

  // ─── Game Management ───
  {
    type: 'game_loadScene', category: 'Game', label: 'Load Scene', color: '#4a148c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'sceneName', type: 'string', direction: 'input', defaultValue: 'Level_01' },
      { name: 'additive', type: 'boolean', direction: 'input', defaultValue: false },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'game_quitGame', category: 'Game', label: 'Quit Game', color: '#4a148c',
    inputs: [{ name: 'exec', type: 'exec', direction: 'input' }],
    outputs: [],
  },
  {
    type: 'game_setScore', category: 'Game', label: 'Set Score', color: '#4a148c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'score', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'game_getScore', category: 'Game', label: 'Get Score', color: '#4a148c',
    inputs: [],
    outputs: [{ name: 'score', type: 'number', direction: 'output' }],
    execute: () => ({ score: 0 }),
  },
  {
    type: 'game_pauseGame', category: 'Game', label: 'Pause / Resume', color: '#4a148c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'paused', type: 'boolean', direction: 'input', defaultValue: true },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'game_setTimeScale', category: 'Game', label: 'Set Time Scale', color: '#4a148c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'scale', type: 'number', direction: 'input', defaultValue: 1 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'game_saveCheckpoint', category: 'Game', label: 'Save Checkpoint', color: '#4a148c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'slot', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
  },
  {
    type: 'game_loadCheckpoint', category: 'Game', label: 'Load Checkpoint', color: '#4a148c',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'slot', type: 'number', direction: 'input', defaultValue: 0 },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
      { name: 'loaded', type: 'boolean', direction: 'output' },
    ],
  },

  // ─── Subgraph ───
  {
    type: 'subgraph_call', category: 'Subgraph', label: 'Call Subgraph', color: '#5d4037',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: '_subgraphId', type: 'string', direction: 'input', defaultValue: '' },
    ],
    outputs: [
      { name: 'exec', type: 'exec', direction: 'output' },
    ],
    execute: (_inputs, ctx) => { ctx.execOutput('exec'); },
  },
  {
    type: 'subgraph_input', category: 'Subgraph', label: 'Graph Input', color: '#5d4037',
    inputs: [{ name: 'portName', type: 'string', direction: 'input', defaultValue: 'input' }],
    outputs: [{ name: 'value', type: 'any', direction: 'output' }],
    execute: (inputs, ctx) => ({ value: (ctx.variables as any)['__input_' + (inputs.portName ?? 'input')] }),
  },
  {
    type: 'subgraph_output', category: 'Subgraph', label: 'Graph Output', color: '#5d4037',
    inputs: [
      { name: 'exec', type: 'exec', direction: 'input' },
      { name: 'portName', type: 'string', direction: 'input', defaultValue: 'output' },
      { name: 'value', type: 'any', direction: 'input' },
    ],
    outputs: [{ name: 'exec', type: 'exec', direction: 'output' }],
    execute: (inputs, ctx) => {
      (ctx.variables as any)['__output_' + (inputs.portName ?? 'output')] = inputs.value;
      ctx.execOutput('exec');
    },
  },
];

/* ──────────────────────────────────────────────────────────────────────
   PHASE 12 — Subgraph types and interfaces
   ────────────────────────────────────────────────────────────────────── */

/** A named, reusable subgraph definition stored in the parent graph. */
export interface SubgraphDef {
  id: string;
  name: string;
  graph: VisualGraph;
  /** Port declarations inferred from subgraph_input / subgraph_output nodes */
  inputPorts: string[];
  outputPorts: string[];
}

/** Breakpoint on a specific node */
export interface Breakpoint {
  nodeId: string;
  enabled: boolean;
}

/** Entry in the debug watch panel */
export interface WatchEntry {
  nodeId: string;
  socketName: string;
  label: string;
  lastValue: unknown;
}

/* ─── Graph Runtime (Execution Engine) ──────────────── */

export class GraphRuntime {
  private graph: VisualGraph;
  private nodeMap = new Map<string, GraphNode>();
  private defMap = new Map<string, NodeDef>();
  private outputCache = new Map<string, Record<string, unknown>>();
  private variables: Record<string, unknown> = {};
  private pendingDelays: Array<{ timeout: ReturnType<typeof setTimeout> }> = [];

  // Phase 12 — Debugger support
  private _breakpoints = new Set<string>();            // nodeIds with breakpoints
  private _stepMode = false;                           // when true, pause before each exec node
  private _stepResolve: (() => void) | null = null;    // resolve fn for the current step-pause
  private _paused = false;
  private _watchValues = new Map<string, unknown>();   // `nodeId:socket` → last resolved value
  /** Called when a breakpoint / step-pause is hit. Arg is the node about to execute. */
  onBreakpoint?: (nodeId: string, outputValues: Record<string, unknown>) => void;
  /** Called after every node execution with the outputs. Useful for watch panels. */
  onNodeExecuted?: (nodeId: string, outputs: Record<string, unknown>) => void;

  constructor(graph: VisualGraph) {
    this.graph = graph;
    if (!this.graph.comments) this.graph.comments = [];
    if (!this.graph.variables) this.graph.variables = [];
    if (!this.graph.subgraphs) this.graph.subgraphs = [];

    // Index nodes
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, node);
    }

    // Index defs
    for (const def of NODE_LIBRARY) {
      this.defMap.set(def.type, def);
    }

    // Init variables
    for (const v of graph.variables) {
      this.variables[v.name] = v.defaultValue;
    }
  }

  /** Register custom node definitions */
  registerNodeDef(def: NodeDef): void {
    this.defMap.set(def.type, def);
    NODE_LIBRARY.push(def);
  }

  /** Trigger an event node (e.g., 'event_start', 'event_update') */
  trigger(eventType: string, context: Partial<ScriptContext> = {}): void {
    const ctx: ScriptContext = {
      delta: context.delta ?? 0,
      time: context.time ?? 0,
      entity: context.entity,
      scene: context.scene,
      variables: this.variables,
      execOutput: () => {},
      log: (...args) => console.log('[VisualScript]', ...args),
      ...context,
    };

    // Find event nodes of this type
    for (const node of this.graph.nodes) {
      if (node.type === eventType) {
        this.executeNode(node.id, ctx);
      }
    }
  }

  /** Execute a node and follow exec connections */
  private executeNode(nodeId: string, ctx: ScriptContext): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const def = this.defMap.get(node.type);
    if (!def) return;

    // Resolve input values
    const inputs: Record<string, unknown> = { ...node.inputValues };
    for (const inputDef of def.inputs) {
      if (inputDef.type === 'exec') continue;

      // Check if there's a connection providing this value
      const conn = this.graph.connections.find(c => c.toNode === nodeId && c.toSocket === inputDef.name);
      if (conn) {
        const value = this.resolveOutput(conn.fromNode, conn.fromSocket, ctx);
        if (value !== undefined) inputs[inputDef.name] = value;
      }

      // Use default if still undefined
      if (inputs[inputDef.name] === undefined) {
        inputs[inputDef.name] = inputDef.defaultValue;
      }
    }

    // Execute
    const execOutputs: string[] = [];
    ctx.execOutput = (name: string) => execOutputs.push(name);

    let outputs: Record<string, unknown> = {};
    if (def.execute) {
      const result = def.execute(inputs, ctx);
      if (result) outputs = result;
    }

    // Cache outputs and notify watchers
    this.outputCache.set(nodeId, outputs);
    for (const [k, v] of Object.entries(outputs)) {
      this._watchValues.set(`${nodeId}:${k}`, v);
    }
    this.onNodeExecuted?.(nodeId, outputs);

    // Phase 12: Fire breakpoint/step pause
    const isExecNode = def.inputs.some(s => s.type === 'exec') || def.outputs.some(s => s.type === 'exec');
    if (isExecNode && (this._breakpoints.has(nodeId) || this._stepMode)) {
      this._paused = true;
      this.onBreakpoint?.(nodeId, outputs);
      // Non-blocking: the caller must call resume() to continue
      // (In async contexts you'd await a Promise here; we keep it sync for simplicity)
    }

    // Follow exec connections
    if (execOutputs.length === 0) {
      // Auto-follow 'exec' output if the node didn't explicitly call execOutput
      execOutputs.push('exec');
    }

    for (const execOut of execOutputs) {
      const execConns = this.graph.connections.filter(c => c.fromNode === nodeId && c.fromSocket === execOut);
      for (const conn of execConns) {
        // Handle delay nodes
        if (node.type === 'flow_delay') {
          const seconds = (inputs.seconds as number) ?? 1;
          const t = setTimeout(() => {
            this.executeNode(conn.toNode, ctx);
          }, seconds * 1000);
          this.pendingDelays.push({ timeout: t });
        } else {
          this.executeNode(conn.toNode, ctx);
        }
      }
    }
  }

  /** Resolve a data output from a node (recursive, with cache) */
  private resolveOutput(nodeId: string, socketName: string, ctx: ScriptContext): unknown {
    // Check cache
    const cached = this.outputCache.get(nodeId);
    if (cached && socketName in cached) return cached[socketName];

    // Execute node to get its outputs
    const node = this.nodeMap.get(nodeId);
    if (!node) return undefined;

    const def = this.defMap.get(node.type);
    if (!def || !def.execute) return undefined;

    // Resolve its inputs first
    const inputs: Record<string, unknown> = { ...node.inputValues };
    for (const inputDef of def.inputs) {
      if (inputDef.type === 'exec') continue;
      const conn = this.graph.connections.find(c => c.toNode === nodeId && c.toSocket === inputDef.name);
      if (conn) {
        const value = this.resolveOutput(conn.fromNode, conn.fromSocket, ctx);
        if (value !== undefined) inputs[inputDef.name] = value;
      }
      if (inputs[inputDef.name] === undefined) inputs[inputDef.name] = inputDef.defaultValue;
    }

    const dummyExecOutputs: string[] = [];
    const localCtx = { ...ctx, execOutput: (name: string) => dummyExecOutputs.push(name) };
    const result = def.execute(inputs, localCtx) ?? {};
    this.outputCache.set(nodeId, result);
    return result[socketName];
  }

  /** Clear output cache (call at start of each frame) */
  clearCache(): void {
    this.outputCache.clear();
  }

  /** Stop all pending delays */
  stop(): void {
    for (const d of this.pendingDelays) clearTimeout(d.timeout);
    this.pendingDelays = [];
    this.outputCache.clear();
  }

  getVariables(): Record<string, unknown> {
    return this.variables;
  }

  // ─── Phase 12: Debugger API ──────────────────────────────────────

  /** Set / clear a breakpoint on a node by its id. */
  setBreakpoint(nodeId: string, enabled: boolean): void {
    if (enabled) this._breakpoints.add(nodeId);
    else this._breakpoints.delete(nodeId);
  }

  hasBreakpoint(nodeId: string): boolean {
    return this._breakpoints.has(nodeId);
  }

  /** Enter step-mode: pause before each exec node and wait for `step()`. */
  setStepMode(enabled: boolean): void {
    this._stepMode = enabled;
    if (!enabled) this.resume();
  }

  /** Resume execution after a breakpoint or step pause. */
  resume(): void {
    this._paused = false;
    const res = this._stepResolve;
    this._stepResolve = null;
    res?.();
  }

  get isPaused(): boolean { return this._paused; }

  /** Get all collected watch values (nodeId:socket → last value). */
  getWatchValues(): Map<string, unknown> {
    return this._watchValues;
  }

  /** Execute a subgraph by its id, passing input values through context variables. */
  executeSubgraph(subgraphId: string, inputValues: Record<string, unknown> = {}): Record<string, unknown> {
    const subDef = this.graph.subgraphs?.find(s => s.id === subgraphId);
    if (!subDef) return {};

    // Inject input values
    for (const [k, v] of Object.entries(inputValues)) {
      this.variables[`__input_${k}`] = v;
    }

    const subRuntime = new GraphRuntime(subDef.graph);
    // Share parent variables
    Object.assign(subRuntime.getVariables(), this.variables);
    subRuntime.trigger('event_start');

    // Collect outputs
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(subRuntime.getVariables())) {
      if (k.startsWith('__output_')) {
        out[k.replace('__output_', '')] = subRuntime.getVariables()[k];
      }
    }
    return out;
  }
}

/* ─── Visual Graph Editor (UI) ──────────────────────── */

export class VisualScriptEditor {
  private container!: HTMLElement;
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  public graph: VisualGraph;
  private nodeDefMap = new Map<string, NodeDef>();

  // View
  private offsetX = 0;
  private offsetY = 0;
  private zoom = 1;

  // Interaction state
  private dragNode: GraphNode | null = null;
  private dragOffset = { x: 0, y: 0 };
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private connectingFrom: { nodeId: string; socket: string; type: SocketType; dir: SocketDirection } | null = null;
  private connectingMouse = { x: 0, y: 0 };
  private selectedNodes = new Set<string>();
  private selectedConnection: string | null = null;
  private hoveredNode: string | null = null;
  private animFrameId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastContextMenuPos = { x: 0, y: 0 };

  // Comment interaction
  private selectedComment: CommentBox | null = null;
  private dragComment: CommentBox | null = null;
  private dragCommentOffset = { x: 0, y: 0 };
  private resizingComment: CommentBox | null = null;
  private resizeEdge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null = null;
  private resizeStart = { x: 0, y: 0, cx: 0, cy: 0, cw: 0, ch: 0 };

  // Simulation flow visualization
  private simulationActive = false;
  private simTime = 0;

  // Marquee (area drag) selection for nodes
  private isMarquee = false;
  private marqueeStartGraph = { x: 0, y: 0 };
  private marqueeEndGraph = { x: 0, y: 0 };

  // Node dimensions (Unreal-style wider nodes)
  private readonly NODE_WIDTH = 220;
  private readonly HEADER_H = 32;
  private readonly SOCKET_H = 24;
  private readonly SOCKET_RADIUS = 6;

  // Clipboard for copy/paste
  private clipboard: { nodes: GraphNode[]; connections: Connection[] } | null = null;

  // Undo/Redo stack
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private undoMaxHistory = 50;
  private undoLocked = false;

  // Minimap
  private showMinimap = true;
  private readonly MINIMAP_W = 180;
  private readonly MINIMAP_H = 120;
  private readonly MINIMAP_MARGIN = 10;

  // Callbacks
  onGraphChanged?: () => void;

  // Phase 12 — Subgraph navigation stack
  private _subgraphStack: Array<{ graph: VisualGraph; label: string }> = [];

  // Phase 12 — Graph Debugger
  private _debugRuntime: GraphRuntime | null = null;
  private _debugBreakpoints = new Map<string, boolean>(); // nodeId → enabled
  private _debugHighlight: string | null = null;          // nodeId currently "lit"
  private _debugWatches: WatchEntry[] = [];
  private _debugLog: string[] = [];
  private _debugPanel: HTMLElement | null = null;

  constructor(graph?: VisualGraph) {
    this.graph = graph ?? { nodes: [], connections: [], variables: [], comments: [] };
    if (!this.graph.comments) this.graph.comments = [];
    for (const def of NODE_LIBRARY) {
      this.nodeDefMap.set(def.type, def);
    }
  }

  /* ─── Undo / Redo ────────────────────────────────────── */

  private pushUndo(): void {
    if (this.undoLocked) return;
    this.undoStack.push(JSON.stringify(this.graph));
    if (this.undoStack.length > this.undoMaxHistory) this.undoStack.shift();
    this.redoStack.length = 0; // clear redo on new action
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.graph));
    const prev = this.undoStack.pop()!;
    this.undoLocked = true;
    const parsed = JSON.parse(prev);
    this.graph.nodes = parsed.nodes;
    this.graph.connections = parsed.connections;
    this.graph.variables = parsed.variables || [];
    this.graph.comments = parsed.comments || [];
    this.selectedNodes.clear();
    this.undoLocked = false;
    this.onGraphChanged?.();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(this.graph));
    const next = this.redoStack.pop()!;
    this.undoLocked = true;
    const parsed = JSON.parse(next);
    this.graph.nodes = parsed.nodes;
    this.graph.connections = parsed.connections;
    this.graph.variables = parsed.variables || [];
    this.graph.comments = parsed.comments || [];
    this.selectedNodes.clear();
    this.undoLocked = false;
    this.onGraphChanged?.();
  }

  /* ─── Copy / Paste ───────────────────────────────────── */

  copySelected(): void {
    if (this.selectedNodes.size === 0) return;
    const ids = this.selectedNodes;
    const nodes = this.graph.nodes.filter(n => ids.has(n.id)).map(n => ({ ...n, inputValues: { ...n.inputValues } }));
    const connections = this.graph.connections.filter(c => ids.has(c.fromNode) && ids.has(c.toNode));
    this.clipboard = { nodes, connections };
  }

  pasteClipboard(): void {
    if (!this.clipboard || this.clipboard.nodes.length === 0) return;
    this.pushUndo();
    const idMap = new Map<string, string>();
    const offset = 40;
    const newNodes: GraphNode[] = [];
    for (const orig of this.clipboard.nodes) {
      const newId = this.generateId();
      idMap.set(orig.id, newId);
      newNodes.push({ ...orig, id: newId, x: orig.x + offset, y: orig.y + offset, inputValues: { ...orig.inputValues } });
    }
    const newConns: Connection[] = [];
    for (const orig of this.clipboard.connections) {
      const fromId = idMap.get(orig.fromNode);
      const toId = idMap.get(orig.toNode);
      if (fromId && toId) {
        newConns.push({ id: this.generateId(), fromNode: fromId, fromSocket: orig.fromSocket, toNode: toId, toSocket: orig.toSocket });
      }
    }
    this.graph.nodes.push(...newNodes);
    this.graph.connections.push(...newConns);
    this.selectedNodes.clear();
    for (const n of newNodes) this.selectedNodes.add(n.id);
    this.onGraphChanged?.();
  }

  cutSelected(): void {
    this.copySelected();
    this.pushUndo();
    this.deleteSelected();
  }

  duplicateSelected(): void {
    this.copySelected();
    this.pasteClipboard();
  }

  render(): HTMLElement {
    // Cancel any previous render loop to avoid leaked RAF loops
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }

    // Reuse existing container if already built (avoids recreating DOM on every tab switch)
    if (this.container && this.canvasEl) {
      this.startRenderLoop();
      return this.container;
    }

    this.container = document.createElement('div');
    this.container.className = 'visual-script-editor';
    this.container.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:#1a1a2e;';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = '<span>🔗 VISUAL SCRIPTING</span>';
    this.container.appendChild(header);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:4px;padding:4px 8px;background:#222;border-bottom:1px solid #333;align-items:center;';
    toolbar.innerHTML = `
      <button class="vs-btn" data-action="add">+ Add Node</button>
      <button class="vs-btn" data-action="comment">💬 Comment</button>
      <button class="vs-btn" data-action="delete">Delete</button>
      <button class="vs-btn" data-action="break">Break Links</button>
      <button class="vs-btn" data-action="fit">Fit View</button>
      <button class="vs-btn" data-action="clear">Clear All</button>
      <button class="vs-btn" data-action="collapse-subgraph" style="background:#3e2723;border-color:#5d4037;">⬛ Subgraph</button>
      <span style="flex:1;"></span>
      <button class="vs-btn" data-action="debug-toggle" style="background:#1a3a1a;border-color:#2a5a2a;">🐛 Debug</button>
      <button class="vs-btn" data-action="simulate" style="background:#1a3a5a;border-color:#2a5a8a;">⚡ Simulate</button>
      <button class="vs-btn" data-action="toggle-vars" style="background:#1a4a1a;border-color:#2a6a2a;">📋 Variables</button>
      <span class="vs-info" style="color:#555;font-size:10px;">Nodes: 0 | Connections: 0</span>
    `;
    toolbar.querySelectorAll('.vs-btn').forEach(el => {
      (el as HTMLElement).style.cssText = 'background:#333;border:1px solid #444;color:#aaa;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px;';
    });
    this.container.appendChild(toolbar);

    // Canvas area (with optional vars panel)
    const canvasArea = document.createElement('div');
    canvasArea.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden;';

    // Canvas wrapper (flex:1 on canvas itself is unreliable)
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0;overflow:hidden;';

    // Canvas
    this.canvasEl = document.createElement('canvas');
    this.canvasEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:default;';
    canvasWrap.appendChild(this.canvasEl);
    canvasArea.appendChild(canvasWrap);
    this.ctx = this.canvasEl.getContext('2d')!;

    // Variables side panel (hidden by default)
    const varsPanel = document.createElement('div');
    varsPanel.className = 'vs-vars-panel';
    varsPanel.style.cssText = 'display:none;width:220px;min-width:220px;background:#222;border-left:1px solid #333;overflow-y:auto;flex-direction:column;';
    canvasArea.appendChild(varsPanel);

    this.container.appendChild(canvasArea);

    // Search palette (hidden by default)
    const palette = document.createElement('div');
    palette.id = 'vs-palette';
    palette.style.cssText = 'display:none;position:absolute;background:#2a2a2a;border:1px solid #444;border-radius:4px;width:240px;max-height:300px;overflow-y:auto;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
    this.container.appendChild(palette);
    this.container.style.position = 'relative';

    this.bindEvents(toolbar, palette);
    this.startRenderLoop();
    this.updateInfo(toolbar);

    // Force canvas sizing after DOM layout via ResizeObserver
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      const w = canvasWrap.clientWidth;
      const h = canvasWrap.clientHeight;
      if (w > 0 && h > 0 && this.canvasEl) {
        const dpr = Math.min(window.devicePixelRatio, 2);
        if (this.canvasEl.width !== w * dpr || this.canvasEl.height !== h * dpr) {
          this.canvasEl.width = w * dpr;
          this.canvasEl.height = h * dpr;
        }
      }
    });
    this.resizeObserver.observe(canvasWrap);

    return this.container;
  }

  /* ─── Event Binding ──────────────────────────────────── */

  private bindEvents(toolbar: HTMLElement, palette: HTMLElement): void {
    // Toolbar actions
    toolbar.querySelector('[data-action="add"]')?.addEventListener('click', (e) => {
      this.showPalette(palette, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    });
    toolbar.querySelector('[data-action="comment"]')?.addEventListener('click', () => {
      this.addCommentBox();
    });
    toolbar.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      this.deleteSelected();
      this.updateInfo(toolbar);
    });
    toolbar.querySelector('[data-action="break"]')?.addEventListener('click', () => {
      this.breakSelectedConnections();
      this.updateInfo(toolbar);
    });
    toolbar.querySelector('[data-action="fit"]')?.addEventListener('click', () => this.fitView());
    toolbar.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
      this.graph.nodes = [];
      this.graph.connections = [];
      this.graph.comments = [];
      this.selectedNodes.clear();
      this.updateInfo(toolbar);
    });

    // Phase 12 — Collapse selected nodes to subgraph
    toolbar.querySelector('[data-action="collapse-subgraph"]')?.addEventListener('click', () => {
      if (this.selectedNodes.size < 2) { return; }
      this._collapseToSubgraph(toolbar);
    });

    // Phase 12 — Debug panel toggle
    toolbar.querySelector('[data-action="debug-toggle"]')?.addEventListener('click', () => {
      if (this._debugPanel) {
        this._debugPanel.remove();
        this._debugPanel = null;
        const btn = toolbar.querySelector('[data-action="debug-toggle"]') as HTMLElement | null;
        if (btn) { btn.style.background = '#1a3a1a'; btn.textContent = '🐛 Debug'; }
      } else {
        this._debugPanel = this._buildDebugPanel();
        this.container.appendChild(this._debugPanel);
        const btn = toolbar.querySelector('[data-action="debug-toggle"]') as HTMLElement | null;
        if (btn) { btn.style.background = '#1f6f1f'; btn.textContent = '🐛 Hide Debug'; }
      }
    });

    // Variables panel toggle
    const varsPanel = this.container.querySelector('.vs-vars-panel') as HTMLElement;
    toolbar.querySelector('[data-action="toggle-vars"]')?.addEventListener('click', () => {
      const isVisible = varsPanel.style.display !== 'none';
      varsPanel.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) this.rebuildVarsPanel(varsPanel);
    });

    // Simulate flow toggle
    toolbar.querySelector('[data-action="simulate"]')?.addEventListener('click', () => {
      this.simulationActive = !this.simulationActive;
      this.simTime = 0;
      const btn = toolbar.querySelector('[data-action="simulate"]') as HTMLElement;
      if (btn) {
        btn.style.background = this.simulationActive ? '#1f6feb' : '#1a3a5a';
        btn.textContent = this.simulationActive ? '⚡ Stop Sim' : '⚡ Simulate';
      }
      // Actually execute the graph when simulation starts
      if (this.simulationActive) {
        const runtime = new GraphRuntime(this.graph);
        runtime.trigger('event_start');
      }
    });

    // Canvas mouse events
    this.canvasEl.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvasEl.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvasEl.addEventListener('mouseup', (e) => this.onMouseUp(e, toolbar, palette));
    this.canvasEl.addEventListener('wheel', (e) => this.onWheel(e));
    this.canvasEl.addEventListener('dblclick', (e) => {
      const { x, y } = this.canvasToGraph(e.offsetX, e.offsetY);
      // If double-click landed on a comment, open text editor
      const commentHit = this.hitTestComment(x, y);
      if (commentHit) { this.editCommentText(commentHit); return; }
      // Check if double-click is on an unconnected input socket → edit value inline
      const editTarget = this.hitTestInputValue(x, y);
      if (editTarget) {
        this.showInlineEditor(editTarget.node, editTarget.inputDef, e.clientX, e.clientY);
        return;
      }
      this.showPalette(palette, e.clientX, e.clientY);
    });

    // Right-click for palette
    this.canvasEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.lastContextMenuPos = { x: e.clientX, y: e.clientY };
      this.showPalette(palette, e.clientX, e.clientY);
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (!this.container.contains(document.activeElement) && document.activeElement !== document.body) return;
      const isInput = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (isInput) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedConnection) {
          this.pushUndo();
          this.graph.connections = this.graph.connections.filter(c => c.id !== this.selectedConnection);
          this.selectedConnection = null;
          this.onGraphChanged?.();
        }
        this.pushUndo();
        this.deleteSelected();
        this.updateInfo(toolbar);
      }

      // Copy / Paste / Cut / Duplicate / Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); this.copySelected(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); this.pasteClipboard(); this.updateInfo(toolbar); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); this.cutSelected(); this.updateInfo(toolbar); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); this.duplicateSelected(); this.updateInfo(toolbar); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); this.updateInfo(toolbar); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); this.updateInfo(toolbar); }
      if (e.key === 'm' || e.key === 'M') { this.showMinimap = !this.showMinimap; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); for (const n of this.graph.nodes) this.selectedNodes.add(n.id); }
    });
  }

  /* ─── Mouse Handlers ─────────────────────────────────── */

  private onMouseDown(e: MouseEvent): void {
    const { x, y } = this.canvasToGraph(e.offsetX, e.offsetY);

    // Double-click on comment → edit text
    if (e.detail === 2) {
      const comment = this.hitTestComment(x, y);
      if (comment) {
        this.editCommentText(comment);
        return;
      }
    }

    // Check socket click
    const socket = this.hitTestSocket(x, y);
    if (socket) {
      this.connectingFrom = socket;
      this.connectingMouse = { x, y };
      return;
    }

    // Check node click
    const node = this.hitTestNode(x, y);
    if (node) {
      this.selectedConnection = null;
      this.selectedComment = null;
      if (!e.shiftKey) {
        if (!this.selectedNodes.has(node.id)) {
          this.selectedNodes.clear();
        }
      }
      this.selectedNodes.add(node.id);
      this.dragNode = node;
      this.dragOffset = { x: x - node.x, y: y - node.y };
      this.pushUndo(); // snapshot before drag
      return;
    }

    // Check connection click
    const conn = this.hitTestConnection(x, y);
    if (conn) {
      this.selectedNodes.clear();
      this.selectedComment = null;
      this.selectedConnection = conn;
      return;
    }

    // Check comment resize edges (check before comment body)
    const resizeInfo = this.hitTestCommentResize(x, y);
    if (resizeInfo) {
      this.resizingComment = resizeInfo.comment;
      this.resizeEdge = resizeInfo.edge;
      this.resizeStart = { x, y, cx: resizeInfo.comment.x, cy: resizeInfo.comment.y, cw: resizeInfo.comment.width, ch: resizeInfo.comment.height };
      this.selectedComment = resizeInfo.comment;
      this.selectedNodes.clear();
      this.selectedConnection = null;
      return;
    }

    // Check comment click (move)
    const comment = this.hitTestComment(x, y);
    if (comment) {
      this.selectedComment = comment;
      this.dragComment = comment;
      this.dragCommentOffset = { x: x - comment.x, y: y - comment.y };
      this.selectedNodes.clear();
      this.selectedConnection = null;
      return;
    }

    // Empty space: marquee select (left-click) or pan (middle-click / Alt+left)
    this.selectedConnection = null;
    this.selectedComment = null;
    if (!e.shiftKey) this.selectedNodes.clear();
    if (e.button === 1 || e.altKey) {
      this.isPanning = true;
      this.panStart = { x: e.clientX, y: e.clientY };
    } else {
      this.isMarquee = true;
      this.marqueeStartGraph = { x, y };
      this.marqueeEndGraph = { x, y };
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const { x, y } = this.canvasToGraph(e.offsetX, e.offsetY);

    if (this.resizingComment && this.resizeEdge) {
      const dx = x - this.resizeStart.x;
      const dy = y - this.resizeStart.y;
      const c = this.resizingComment;
      const minW = 100;
      const minH = 60;

      if (this.resizeEdge.includes('e')) c.width = Math.max(minW, this.resizeStart.cw + dx);
      if (this.resizeEdge.includes('w')) {
        const newW = Math.max(minW, this.resizeStart.cw - dx);
        c.x = this.resizeStart.cx + (this.resizeStart.cw - newW);
        c.width = newW;
      }
      if (this.resizeEdge.includes('s')) c.height = Math.max(minH, this.resizeStart.ch + dy);
      if (this.resizeEdge.includes('n')) {
        const newH = Math.max(minH, this.resizeStart.ch - dy);
        c.y = this.resizeStart.cy + (this.resizeStart.ch - newH);
        c.height = newH;
      }
    } else if (this.dragComment) {
      this.dragComment.x = x - this.dragCommentOffset.x;
      this.dragComment.y = y - this.dragCommentOffset.y;
    } else if (this.dragNode) {
      const newX = x - this.dragOffset.x;
      const newY = y - this.dragOffset.y;
      const dx = newX - this.dragNode.x;
      const dy = newY - this.dragNode.y;
      this.dragNode.x = newX;
      this.dragNode.y = newY;
      // Move all selected nodes together
      if (this.selectedNodes.size > 1 && this.selectedNodes.has(this.dragNode.id)) {
        for (const node of this.graph.nodes) {
          if (node.id !== this.dragNode.id && this.selectedNodes.has(node.id)) {
            node.x += dx;
            node.y += dy;
          }
        }
      }
    } else if (this.isPanning) {
      this.offsetX += e.clientX - this.panStart.x;
      this.offsetY += e.clientY - this.panStart.y;
      this.panStart = { x: e.clientX, y: e.clientY };
    } else if (this.isMarquee) {
      this.marqueeEndGraph = { x, y };
    } else if (this.connectingFrom) {
      this.connectingMouse = { x, y };
    }

    // Hover
    const hover = this.hitTestNode(x, y);
    this.hoveredNode = hover?.id ?? null;

    // Update cursor for comment resize
    if (!this.dragNode && !this.dragComment && !this.resizingComment && !this.isPanning) {
      const ri = this.hitTestCommentResize(x, y);
      if (ri) {
        const cursors: Record<string, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', sw: 'nesw-resize' };
        this.canvasEl.style.cursor = cursors[ri.edge] || 'default';
      } else {
        this.canvasEl.style.cursor = 'default';
      }
    }
  }

  private onMouseUp(e: MouseEvent, toolbar: HTMLElement, palette: HTMLElement): void {
    if (this.connectingFrom) {
      const { x, y } = this.canvasToGraph(e.offsetX, e.offsetY);
      const socket = this.hitTestSocket(x, y);

      if (socket && socket.nodeId !== this.connectingFrom.nodeId && socket.dir !== this.connectingFrom.dir) {
        // Validate type compatibility
        if (this.canConnect(this.connectingFrom.type, socket.type)) {
          this.pushUndo();
          const from = this.connectingFrom.dir === 'output' ? this.connectingFrom : socket;
          const to = this.connectingFrom.dir === 'input' ? this.connectingFrom : socket;

          // Remove existing connection to this input (unless exec type)
          if (to.type !== 'exec') {
            this.graph.connections = this.graph.connections.filter(
              c => !(c.toNode === to.nodeId && c.toSocket === to.socket)
            );
          }

          this.graph.connections.push({
            id: this.generateId(),
            fromNode: from.nodeId,
            fromSocket: from.socket,
            toNode: to.nodeId,
            toSocket: to.socket,
          });
          this.onGraphChanged?.();
        }
        this.connectingFrom = null;
      } else if (!socket) {
        // Dropped on empty canvas – show filtered palette for compatible nodes
        const filter = { type: this.connectingFrom.type, dir: this.connectingFrom.dir, nodeId: this.connectingFrom.nodeId, socket: this.connectingFrom.socket };
        this.connectingFrom = null;
        this.showPalette(palette, e.clientX, e.clientY, filter);
      } else {
        this.connectingFrom = null;
      }
    }

    // Finalize marquee selection
    if (this.isMarquee) {
      this.isMarquee = false;
      const x1 = Math.min(this.marqueeStartGraph.x, this.marqueeEndGraph.x);
      const y1 = Math.min(this.marqueeStartGraph.y, this.marqueeEndGraph.y);
      const x2 = Math.max(this.marqueeStartGraph.x, this.marqueeEndGraph.x);
      const y2 = Math.max(this.marqueeStartGraph.y, this.marqueeEndGraph.y);
      // Only select if drag area is meaningful
      if (x2 - x1 > 5 || y2 - y1 > 5) {
        for (const node of this.graph.nodes) {
          const def = this.nodeDefMap.get(node.type);
          if (!def) continue;
          const nh = this.getNodeHeight(def);
          // Node overlaps marquee rect
          if (node.x + this.NODE_WIDTH >= x1 && node.x <= x2 && node.y + nh >= y1 && node.y <= y2) {
            this.selectedNodes.add(node.id);
          }
        }
      }
    }

    this.dragNode = null;
    this.dragComment = null;
    this.resizingComment = null;
    this.resizeEdge = null;
    this.isPanning = false;
    this.canvasEl.style.cursor = 'default';
    this.updateInfo(toolbar);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(3, this.zoom * factor));

    // Zoom towards cursor
    const { x: gx, y: gy } = this.canvasToGraph(e.offsetX, e.offsetY);
    this.zoom = newZoom;
    const after = this.canvasToGraph(e.offsetX, e.offsetY);
    this.offsetX += (after.x - gx) * this.zoom;
    this.offsetY += (after.y - gy) * this.zoom;
  }

  /* ─── Hit Testing ────────────────────────────────────── */

  private hitTestNode(gx: number, gy: number): GraphNode | null {
    // Reverse order to pick top-most
    for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
      const node = this.graph.nodes[i];
      const def = this.nodeDefMap.get(node.type);
      if (!def) continue;

      const h = this.getNodeHeight(def);
      if (gx >= node.x && gx <= node.x + this.NODE_WIDTH && gy >= node.y && gy <= node.y + h) {
        return node;
      }
    }
    return null;
  }

  private hitTestSocket(gx: number, gy: number): { nodeId: string; socket: string; type: SocketType; dir: SocketDirection } | null {
    for (const node of this.graph.nodes) {
      const def = this.nodeDefMap.get(node.type);
      if (!def) continue;

      const sockets = this.getSocketPositions(node, def);
      for (const s of sockets) {
        const dx = gx - s.x;
        const dy = gy - s.y;
        if (dx * dx + dy * dy < 100) { // ~10px radius
          return { nodeId: node.id, socket: s.name, type: s.type, dir: s.dir };
        }
      }
    }
    return null;
  }

  private hitTestConnection(gx: number, gy: number): string | null {
    for (const conn of this.graph.connections) {
      const fromNode = this.graph.nodes.find(n => n.id === conn.fromNode);
      const toNode = this.graph.nodes.find(n => n.id === conn.toNode);
      if (!fromNode || !toNode) continue;

      const fromDef = this.nodeDefMap.get(fromNode.type);
      const toDef = this.nodeDefMap.get(toNode.type);
      if (!fromDef || !toDef) continue;

      const fromSockets = this.getSocketPositions(fromNode, fromDef);
      const toSockets = this.getSocketPositions(toNode, toDef);
      const from = fromSockets.find(s => s.name === conn.fromSocket && s.dir === 'output');
      const to = toSockets.find(s => s.name === conn.toSocket && s.dir === 'input');
      if (!from || !to) continue;

      // Sample bezier and check distance
      const dx = Math.abs(to.x - from.x) * 0.5;
      for (let t = 0; t <= 1; t += 0.05) {
        const it = 1 - t;
        const px = it * it * it * from.x + 3 * it * it * t * (from.x + dx) + 3 * it * t * t * (to.x - dx) + t * t * t * to.x;
        const py = it * it * it * from.y + 3 * it * it * t * from.y + 3 * it * t * t * to.y + t * t * t * to.y;
        const ddx = gx - px;
        const ddy = gy - py;
        if (ddx * ddx + ddy * ddy < 64) return conn.id; // ~8px threshold
      }
    }
    return null;
  }

  /* ─── Comment Hit Testing ────────────────────────────── */

  private hitTestComment(gx: number, gy: number): CommentBox | null {
    // Reverse order to pick top-most
    for (let i = this.graph.comments.length - 1; i >= 0; i--) {
      const c = this.graph.comments[i];
      if (gx >= c.x && gx <= c.x + c.width && gy >= c.y && gy <= c.y + c.height) {
        return c;
      }
    }
    return null;
  }

  private hitTestCommentResize(gx: number, gy: number): { comment: CommentBox; edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' } | null {
    const margin = 8;
    for (let i = this.graph.comments.length - 1; i >= 0; i--) {
      const c = this.graph.comments[i];
      const inBounds = gx >= c.x - margin && gx <= c.x + c.width + margin &&
                        gy >= c.y - margin && gy <= c.y + c.height + margin;
      if (!inBounds) continue;

      const nearLeft = gx < c.x + margin;
      const nearRight = gx > c.x + c.width - margin;
      const nearTop = gy < c.y + margin;
      const nearBottom = gy > c.y + c.height - margin;

      if (nearTop && nearLeft) return { comment: c, edge: 'nw' };
      if (nearTop && nearRight) return { comment: c, edge: 'ne' };
      if (nearBottom && nearLeft) return { comment: c, edge: 'sw' };
      if (nearBottom && nearRight) return { comment: c, edge: 'se' };
      if (nearTop) return { comment: c, edge: 'n' };
      if (nearBottom) return { comment: c, edge: 's' };
      if (nearLeft) return { comment: c, edge: 'w' };
      if (nearRight) return { comment: c, edge: 'e' };
    }
    return null;
  }

  private editCommentText(comment: CommentBox): void {
    const input = document.createElement('textarea');
    input.value = comment.text;
    input.style.cssText = `
      position:fixed;z-index:10000;background:#1a1a2e;color:#fff;border:2px solid #0078d4;
      padding:8px;font-size:13px;font-family:Arial;resize:none;border-radius:4px;
      min-width:200px;min-height:60px;outline:none;
    `;

    // Position near the comment in screen space
    const canvasRect = this.canvasEl.getBoundingClientRect();
    const sx = comment.x * this.zoom + this.offsetX + canvasRect.left;
    const sy = comment.y * this.zoom + this.offsetY + canvasRect.top;
    input.style.left = sx + 'px';
    input.style.top = sy + 'px';
    input.style.width = Math.max(200, comment.width * this.zoom) + 'px';
    input.style.height = Math.max(60, Math.min(300, comment.height * this.zoom)) + 'px';

    document.body.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      comment.text = input.value || 'Comment';
      if (input.parentNode) input.remove();
      this.onGraphChanged?.();
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.blur();
      }
      e.stopPropagation();
    });
  }

  /* ─── Rendering ──────────────────────────────────────── */

  private startRenderLoop(): void {
    let lastT = performance.now();
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      const now = performance.now();
      if (this.simulationActive) this.simTime += (now - lastT) / 1000;
      lastT = now;
      this.renderCanvas();
    };
    loop();
  }

  private renderCanvas(): void {
    const canvas = this.canvasEl;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (w === 0 || h === 0) return;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      this.ctx = this.canvasEl.getContext('2d')!;
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background (Unreal-style dark slate)
    ctx.fillStyle = '#141420';
    ctx.fillRect(0, 0, w, h);

    // Grid
    this.renderGrid(ctx, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.zoom, this.zoom);

    // Comment boxes (behind everything)
    this.renderComments(ctx);

    // Connections
    this.renderConnections(ctx);

    // Active connection preview
    if (this.connectingFrom) {
      const node = this.graph.nodes.find(n => n.id === this.connectingFrom!.nodeId);
      const def = node ? this.nodeDefMap.get(node.type) : null;
      if (node && def) {
        const sockets = this.getSocketPositions(node, def);
        const s = sockets.find(s => s.name === this.connectingFrom!.socket && s.dir === this.connectingFrom!.dir);
        if (s) {
          this.drawBezier(ctx, s.x, s.y, this.connectingMouse.x, this.connectingMouse.y, '#ffffff88');
        }
      }
    }

    // Nodes
    for (const node of this.graph.nodes) {
      this.renderNode(ctx, node);
    }

    // Marquee selection overlay (drawn in graph space)
    if (this.isMarquee) {
      const mx = Math.min(this.marqueeStartGraph.x, this.marqueeEndGraph.x);
      const my = Math.min(this.marqueeStartGraph.y, this.marqueeEndGraph.y);
      const mw = Math.abs(this.marqueeEndGraph.x - this.marqueeStartGraph.x);
      const mh = Math.abs(this.marqueeEndGraph.y - this.marqueeStartGraph.y);
      ctx.fillStyle = 'rgba(88, 166, 255, 0.12)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = 'rgba(88, 166, 255, 0.5)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.setLineDash([6 / this.zoom, 3 / this.zoom]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Minimap (drawn in screen space after ctx.restore)
    if (this.showMinimap && this.graph.nodes.length > 0) {
      this.renderMinimap(ctx, w, h);
    }
  }

  private renderMinimap(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number): void {
    const mw = this.MINIMAP_W;
    const mh = this.MINIMAP_H;
    const mx = canvasW - mw - this.MINIMAP_MARGIN;
    const my = canvasH - mh - this.MINIMAP_MARGIN;

    // Background
    ctx.fillStyle = 'rgba(20, 20, 32, 0.85)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mw, mh);

    // Compute graph bounds
    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const node of this.graph.nodes) {
      const def = this.nodeDefMap.get(node.type);
      gMinX = Math.min(gMinX, node.x);
      gMinY = Math.min(gMinY, node.y);
      gMaxX = Math.max(gMaxX, node.x + this.NODE_WIDTH);
      gMaxY = Math.max(gMaxY, node.y + (def ? this.getNodeHeight(def) : 60));
    }
    const pad = 60;
    gMinX -= pad; gMinY -= pad; gMaxX += pad; gMaxY += pad;
    const gw = gMaxX - gMinX || 1;
    const gh = gMaxY - gMinY || 1;
    const scale = Math.min(mw / gw, mh / gh);
    const ox = mx + (mw - gw * scale) / 2;
    const oy = my + (mh - gh * scale) / 2;

    // Draw nodes as small rectangles
    for (const node of this.graph.nodes) {
      const def = this.nodeDefMap.get(node.type);
      const nh = def ? this.getNodeHeight(def) : 60;
      const rx = ox + (node.x - gMinX) * scale;
      const ry = oy + (node.y - gMinY) * scale;
      const rw = this.NODE_WIDTH * scale;
      const rh = nh * scale;
      ctx.fillStyle = this.selectedNodes.has(node.id) ? '#58a6ff' : (def ? def.color : '#555');
      ctx.globalAlpha = 0.7;
      ctx.fillRect(rx, ry, Math.max(rw, 2), Math.max(rh, 2));
    }
    ctx.globalAlpha = 1;

    // Draw viewport rectangle
    const vx1 = (0 - this.offsetX) / this.zoom;
    const vy1 = (0 - this.offsetY) / this.zoom;
    const vx2 = (canvasW - this.offsetX) / this.zoom;
    const vy2 = (canvasH - this.offsetY) / this.zoom;
    const vrx = ox + (vx1 - gMinX) * scale;
    const vry = oy + (vy1 - gMinY) * scale;
    const vrw = (vx2 - vx1) * scale;
    const vrh = (vy2 - vy1) * scale;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vrx, vry, vrw, vrh);

    // Label
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.fillText('MINIMAP (M)', mx + 4, my + mh - 4);
  }

  private renderGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const gridSize = 30 * this.zoom;

    const startX = this.offsetX % gridSize;
    const startY = this.offsetY % gridSize;

    // Small grid
    ctx.strokeStyle = '#ffffff06';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x < w; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = startY; y < h; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Large grid (every 5 cells, Unreal-style)
    const bigGrid = gridSize * 5;
    const bigStartX = this.offsetX % bigGrid;
    const bigStartY = this.offsetY % bigGrid;
    ctx.strokeStyle = '#ffffff0f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = bigStartX; x < w; x += bigGrid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = bigStartY; y < h; y += bigGrid) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  private renderNode(ctx: CanvasRenderingContext2D, node: GraphNode): void {
    const def = this.nodeDefMap.get(node.type);
    if (!def) return;

    const w = this.NODE_WIDTH;
    const h = this.getNodeHeight(def);
    const x = node.x;
    const y = node.y;
    const isSelected = this.selectedNodes.has(node.id);
    const isHovered = this.hoveredNode === node.id;

    // Phase 12: breakpoint / debug-highlight markers
    const hasBP = this._debugBreakpoints.get(node.id) ?? false;
    const isDebugHit = this._debugHighlight === node.id;

    // Shadow (Unreal-style deeper shadow)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;

    // Body — dark translucent with subtle border
    ctx.fillStyle = '#1a1a2eee';
    ctx.beginPath();
    this.roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.restore();

    // Body border
    ctx.strokeStyle = isDebugHit ? '#f39c12' : isSelected ? '#f5a623' : isHovered ? '#ffffff44' : (hasBP ? '#e74c3c' : '#333344');
    ctx.lineWidth = (isSelected || isDebugHit || hasBP) ? 2 : 1;
    ctx.beginPath();
    this.roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    // Breakpoint indicator — red dot in top-left corner
    if (hasBP) {
      ctx.save();
      ctx.fillStyle = '#e74c3c';
      ctx.shadowColor = '#e74c3c';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x + 6, y + 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Debug-hit highlight — orange glow
    if (isDebugHit) {
      ctx.save();
      ctx.shadowColor = '#f39c12';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#f39c12cc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 10);
      ctx.stroke();
      ctx.restore();
    }

    // Selection glow (Unreal orange glow)
    if (isSelected) {
      ctx.save();
      ctx.shadowColor = '#f5a623';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#f5a62388';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.roundRect(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.restore();
    }

    // Header bar — desaturated version of node color
    const headerGrad = ctx.createLinearGradient(x, y, x + w, y);
    headerGrad.addColorStop(0, def.color);
    headerGrad.addColorStop(1, def.color + '88');
    ctx.fillStyle = headerGrad;
    ctx.beginPath();
    this.roundRect(ctx, x, y, w, this.HEADER_H, 8, true);
    ctx.fill();

    // Header separator line
    ctx.strokeStyle = '#00000044';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + this.HEADER_H);
    ctx.lineTo(x + w, y + this.HEADER_H);
    ctx.stroke();

    // Header text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px "Segoe UI", Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.label, x + 10, y + 12);

    // Category sub-text (Unreal-style)
    ctx.fillStyle = '#ffffff88';
    ctx.font = '9px "Segoe UI", Arial';
    ctx.fillText(def.category, x + 10, y + 24);

    // Sockets
    const sockets = this.getSocketPositions(node, def);
    for (const s of sockets) {
      const isConnected = this.graph.connections.some(c =>
        (s.dir === 'output' && c.fromNode === node.id && c.fromSocket === s.name) ||
        (s.dir === 'input' && c.toNode === node.id && c.toSocket === s.name)
      );

      const color = SOCKET_COLORS[s.type];

      if (s.type === 'exec') {
        // Exec pins — arrow/triangle shape (Unreal style)
        ctx.beginPath();
        const tx = s.x, ty = s.y;
        ctx.moveTo(tx - 5, ty - 6);
        ctx.lineTo(tx + 5, ty);
        ctx.lineTo(tx - 5, ty + 6);
        ctx.closePath();
        ctx.fillStyle = isConnected ? '#fff' : '#555';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Data pins — filled or hollow circle
        ctx.beginPath();
        ctx.arc(s.x, s.y, this.SOCKET_RADIUS, 0, Math.PI * 2);
        if (isConnected) {
          ctx.fillStyle = color;
          ctx.fill();
        } else {
          ctx.fillStyle = '#1a1a2e';
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Socket label
      ctx.fillStyle = '#bbb';
      ctx.font = '10px "Segoe UI", Arial';
      ctx.textAlign = s.dir === 'input' ? 'left' : 'right';
      const labelX = s.dir === 'input' ? s.x + this.SOCKET_RADIUS + 6 : s.x - this.SOCKET_RADIUS - 6;
      ctx.fillText(s.name, labelX, s.y + 3);

      // Inline value widget for unconnected inputs (not exec)
      if (s.dir === 'input' && s.type !== 'exec' && !isConnected) {
        const val = node.inputValues[s.name];
        if (val !== undefined && val !== null && String(val) !== '') {
          const valStr = String(val).length > 14 ? String(val).substring(0, 14) + '…' : String(val);
          // Draw a subtle input-field background (Unreal style)
          const valW = ctx.measureText(valStr).width + 12;
          const valX = x + w - 10 - valW;
          const valY = s.y - 8;
          ctx.fillStyle = '#0a0a1a';
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;
          ctx.beginPath();
          this.roundRect(ctx, valX, valY, valW, 16, 3);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#8888bb';
          ctx.font = '9px "Segoe UI", Arial';
          ctx.textAlign = 'right';
          ctx.fillText(valStr, x + w - 14, s.y + 3);
        }
      }
    }
  }

  private renderConnections(ctx: CanvasRenderingContext2D): void {
    for (const conn of this.graph.connections) {
      const fromNode = this.graph.nodes.find(n => n.id === conn.fromNode);
      const toNode = this.graph.nodes.find(n => n.id === conn.toNode);
      if (!fromNode || !toNode) continue;

      const fromDef = this.nodeDefMap.get(fromNode.type);
      const toDef = this.nodeDefMap.get(toNode.type);
      if (!fromDef || !toDef) continue;

      const fromSockets = this.getSocketPositions(fromNode, fromDef);
      const toSockets = this.getSocketPositions(toNode, toDef);

      const from = fromSockets.find(s => s.name === conn.fromSocket && s.dir === 'output');
      const to = toSockets.find(s => s.name === conn.toSocket && s.dir === 'input');

      if (from && to) {
        const isSelected = this.selectedConnection === conn.id;
        const color = isSelected ? '#f5a623' : SOCKET_COLORS[from.type];
        const width = isSelected ? 3.5 : 2.5;
        // Glow pass for selected connections
        if (isSelected) {
          this.drawBezier(ctx, from.x, from.y, to.x, to.y, '#f5a62344', 8);
        }
        this.drawBezier(ctx, from.x, from.y, to.x, to.y, color, width);

        // Animated flow dots when simulation is active
        if (this.simulationActive) {
          this.drawFlowDots(ctx, from.x, from.y, to.x, to.y, color);
        }
      }
    }
  }

  /** Draw animated dots flowing along a bezier connection (UE5-style sim visualization) */
  private drawFlowDots(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
    const dx = Math.abs(x2 - x1) * 0.5;
    const dotCount = 4;
    const speed = 0.8; // cycles per second
    const dotRadius = 3 / this.zoom;

    for (let i = 0; i < dotCount; i++) {
      const baseT = (i / dotCount + this.simTime * speed) % 1;
      // Evaluate bezier at t
      const t = baseT;
      const mt = 1 - t;
      const cp1x = x1 + dx, cp1y = y1, cp2x = x2 - dx, cp2y = y2;
      const px = mt * mt * mt * x1 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x2;
      const py = mt * mt * mt * y1 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y2;

      // Fade at ends
      const alpha = Math.min(t * 4, (1 - t) * 4, 1);
      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = color.length >= 7 ? color + Math.round(alpha * 200).toString(16).padStart(2, '0') : color;
      ctx.fill();
    }
  }

  private drawBezier(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number = 2): void {
    const dx = Math.abs(x2 - x1) * 0.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  /* ─── Node helpers ───────────────────────────────────── */

  private getNodeHeight(def: NodeDef): number {
    const maxSockets = Math.max(def.inputs.length, def.outputs.length);
    return this.HEADER_H + maxSockets * this.SOCKET_H + 8;
  }

  private getSocketPositions(node: GraphNode, def: NodeDef): Array<{ x: number; y: number; name: string; type: SocketType; dir: SocketDirection }> {
    const sockets: Array<{ x: number; y: number; name: string; type: SocketType; dir: SocketDirection }> = [];

    for (let i = 0; i < def.inputs.length; i++) {
      sockets.push({
        x: node.x,
        y: node.y + this.HEADER_H + 12 + i * this.SOCKET_H,
        name: def.inputs[i].name,
        type: def.inputs[i].type,
        dir: 'input',
      });
    }

    for (let i = 0; i < def.outputs.length; i++) {
      sockets.push({
        x: node.x + this.NODE_WIDTH,
        y: node.y + this.HEADER_H + 12 + i * this.SOCKET_H,
        name: def.outputs[i].name,
        type: def.outputs[i].type,
        dir: 'output',
      });
    }

    return sockets;
  }

  /* ─── Comment Boxes ───────────────────────────────────── */

  private addCommentBox(): void {
    // Place comment box at the center of the current view
    const cx = (-this.offsetX + (this.canvasEl.clientWidth / 2)) / this.zoom;
    const cy = (-this.offsetY + (this.canvasEl.clientHeight / 2)) / this.zoom;

    const comment: CommentBox = {
      id: 'comment_' + Date.now(),
      x: cx - 150,
      y: cy - 60,
      width: 300,
      height: 120,
      text: 'Comment',
      color: '#335533',
    };
    this.graph.comments.push(comment);
    this.onGraphChanged?.();
  }

  private renderComments(ctx: CanvasRenderingContext2D): void {
    if (!Array.isArray(this.graph.comments)) this.graph.comments = [];
    for (const comment of this.graph.comments) {
      const isSelected = this.selectedComment === comment;

      // Background — semi-transparent fill
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = comment.color;
      ctx.beginPath();
      this.roundRect(ctx, comment.x, comment.y, comment.width, comment.height, 6);
      ctx.fill();
      ctx.restore();

      // Border
      ctx.strokeStyle = isSelected ? '#0078d4' : comment.color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath();
      this.roundRect(ctx, comment.x, comment.y, comment.width, comment.height, 6);
      ctx.stroke();

      // Title bar (top strip)
      ctx.fillStyle = comment.color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      this.roundRect(ctx, comment.x, comment.y, comment.width, 28, 6, true);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Title text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(comment.text, comment.x + 10, comment.y + 14, comment.width - 20);

      // "Double-click to edit" hint
      if (isSelected) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px Arial';
        ctx.fillText('Double-click to edit', comment.x + 10, comment.y + comment.height - 10);

        // Resize handles (4 corners)
        const sz = 6;
        ctx.fillStyle = '#0078d4';
        const corners = [
          [comment.x, comment.y],
          [comment.x + comment.width, comment.y],
          [comment.x, comment.y + comment.height],
          [comment.x + comment.width, comment.y + comment.height],
        ];
        for (const [cx, cy] of corners) {
          ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
        }
      }

      // Body text (if multi-line comment has more than the title)
      const lines = comment.text.split('\n');
      if (lines.length > 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '11px Arial';
        for (let i = 1; i < lines.length && i < 10; i++) {
          ctx.fillText(lines[i], comment.x + 10, comment.y + 28 + i * 14, comment.width - 20);
        }
      }
    }
  }

  /* ─── Variables Panel ────────────────────────────────── */

  private rebuildVarsPanel(panel: HTMLElement): void {
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 12px;background:#2a2a2a;border-bottom:1px solid #333;font-size:11px;font-weight:600;color:#ddd;display:flex;align-items:center;justify-content:space-between;';
    header.innerHTML = `<span>📋 My Variables</span><button class="vs-btn" style="background:#333;border:1px solid #444;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;" id="vs-add-var">+ Add</button>`;
    panel.appendChild(header);

    header.querySelector('#vs-add-var')?.addEventListener('click', () => {
      this.graph.variables.push({
        name: `NewVar_${this.graph.variables.length}`,
        type: 'number',
        defaultValue: 0,
      });
      this.rebuildVarsPanel(panel);
      this.onGraphChanged?.();
    });

    // Variable list
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow-y:auto;';
    panel.appendChild(list);

    for (let i = 0; i < this.graph.variables.length; i++) {
      const v = this.graph.variables[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;border-bottom:1px solid #333;';

      // Color dot for type
      const typeColors: Record<string, string> = {
        number: '#3498db', string: '#e91e63', boolean: '#e74c3c',
        vec3: '#9b59b6', object: '#e67e22', any: '#888',
      };

      row.innerHTML = `
        <span style="width:8px;height:8px;border-radius:50%;background:${typeColors[v.type] || '#888'};flex-shrink:0;"></span>
        <input type="text" value="${v.name}" style="flex:1;background:#1e1e1e;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;min-width:0;" data-var-name="${i}" />
        <select style="background:#1e1e1e;border:1px solid #444;color:#ccc;font-size:9px;padding:1px 2px;border-radius:2px;" data-var-type="${i}">
          <option value="number" ${v.type === 'number' ? 'selected' : ''}>Num</option>
          <option value="string" ${v.type === 'string' ? 'selected' : ''}>Str</option>
          <option value="boolean" ${v.type === 'boolean' ? 'selected' : ''}>Bool</option>
          <option value="vec3" ${v.type === 'vec3' ? 'selected' : ''}>Vec3</option>
          <option value="object" ${v.type === 'object' ? 'selected' : ''}>Obj</option>
        </select>
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:12px;" data-var-del="${i}">✕</button>
      `;

      // Name change
      row.querySelector(`[data-var-name="${i}"]`)?.addEventListener('change', (e) => {
        v.name = (e.target as HTMLInputElement).value;
        this.onGraphChanged?.();
      });

      // Type change
      row.querySelector(`[data-var-type="${i}"]`)?.addEventListener('change', (e) => {
        v.type = (e.target as HTMLSelectElement).value as SocketType;
        this.rebuildVarsPanel(panel);
        this.onGraphChanged?.();
      });

      // Delete
      row.querySelector(`[data-var-del="${i}"]`)?.addEventListener('click', () => {
        this.graph.variables.splice(i, 1);
        this.rebuildVarsPanel(panel);
        this.onGraphChanged?.();
      });

      list.appendChild(row);
    }

    if (this.graph.variables.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:20px;text-align:center;color:#555;font-size:10px;';
      empty.textContent = 'No variables yet. Click "+ Add" to create one.';
      list.appendChild(empty);
    }
  }

  /* ─── Node Palette ───────────────────────────────────── */

  private showPalette(palette: HTMLElement, clientX: number, clientY: number, connectFilter?: { type: SocketType; dir: SocketDirection; nodeId: string; socket: string }): void {
    palette.innerHTML = '';
    palette.style.display = 'block';

    const rect = this.container.getBoundingClientRect();
    palette.style.left = (clientX - rect.left) + 'px';
    palette.style.top = (clientY - rect.top) + 'px';

    // Search input
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = connectFilter ? 'Compatible nodes...' : 'Search nodes...';
    search.style.cssText = 'width:100%;padding:6px 10px;background:#1e1e1e;border:none;border-bottom:1px solid #444;color:#fff;font-size:11px;box-sizing:border-box;outline:none;';
    palette.appendChild(search);

    const listEl = document.createElement('div');
    palette.appendChild(listEl);

    const isCompatible = (def: NodeDef): boolean => {
      if (!connectFilter) return true;
      // If we dragged from output, look for nodes with compatible input
      // If we dragged from input, look for nodes with compatible output
      const targetDir = connectFilter.dir === 'output' ? 'input' : 'output';
      const sockets = targetDir === 'input' ? def.inputs : def.outputs;
      return sockets.some(s => s.direction === targetDir && this.canConnect(connectFilter.type, s.type));
    };

    const renderList = (filter: string) => {
      listEl.innerHTML = '';
      const categories = new Map<string, NodeDef[]>();
      for (const def of NODE_LIBRARY) {
        if (!isCompatible(def)) continue;
        if (filter && !def.label.toLowerCase().includes(filter) && !def.category.toLowerCase().includes(filter)) continue;
        if (!categories.has(def.category)) categories.set(def.category, []);
        categories.get(def.category)!.push(def);
      }

      if (categories.size === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:12px;font-size:11px;color:#666;text-align:center;';
        empty.textContent = 'No compatible nodes found';
        listEl.appendChild(empty);
        return;
      }

      for (const [cat, defs] of categories) {
        const catEl = document.createElement('div');
        catEl.style.cssText = 'padding:4px 10px;font-size:9px;color:#666;font-weight:600;border-bottom:1px solid #333;';
        catEl.textContent = cat.toUpperCase();
        listEl.appendChild(catEl);

        for (const def of defs) {
          const item = document.createElement('div');
          item.style.cssText = 'padding:4px 14px;font-size:11px;color:#bbb;cursor:pointer;display:flex;align-items:center;gap:6px;';
          item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${def.color};display:inline-block;"></span> ${def.label}`;
          item.addEventListener('mouseenter', () => { item.style.background = '#333'; });
          item.addEventListener('mouseleave', () => { item.style.background = ''; });
          item.addEventListener('click', () => {
            const graphPos = this.canvasToGraph(clientX - rect.left, clientY - rect.top);
            const newNode = this.addNode(def.type, graphPos.x, graphPos.y);

            // Auto-connect to the dragged port
            if (connectFilter) {
              const targetDir = connectFilter.dir === 'output' ? 'input' : 'output';
              const sockets = targetDir === 'input' ? def.inputs : def.outputs;
              const compatible = sockets.find(s => s.direction === targetDir && this.canConnect(connectFilter.type, s.type));
              if (compatible) {
                const from = connectFilter.dir === 'output'
                  ? { nodeId: connectFilter.nodeId, socket: connectFilter.socket }
                  : { nodeId: newNode.id, socket: compatible.name };
                const to = connectFilter.dir === 'output'
                  ? { nodeId: newNode.id, socket: compatible.name }
                  : { nodeId: connectFilter.nodeId, socket: connectFilter.socket };

                this.graph.connections.push({
                  id: this.generateId(),
                  fromNode: from.nodeId,
                  fromSocket: from.socket,
                  toNode: to.nodeId,
                  toSocket: to.socket,
                });
                this.onGraphChanged?.();
              }
            }

            palette.style.display = 'none';
          });
          listEl.appendChild(item);
        }
      }
    };

    renderList('');
    search.addEventListener('input', () => renderList(search.value.toLowerCase()));
    search.focus();

    // Close on click outside
    const close = (e: MouseEvent) => {
      if (!palette.contains(e.target as Node)) {
        palette.style.display = 'none';
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  /* ─── Graph Operations ───────────────────────────────── */

  addNode(type: string, x: number = 0, y: number = 0): GraphNode {
    this.pushUndo();
    const def = this.nodeDefMap.get(type);
    const node: GraphNode = {
      id: this.generateId(),
      type,
      x, y,
      inputValues: {},
    };

    // Set default input values
    if (def) {
      for (const input of def.inputs) {
        if (input.defaultValue !== undefined) {
          node.inputValues[input.name] = input.defaultValue;
        }
      }
    }

    this.graph.nodes.push(node);
    this.onGraphChanged?.();
    return node;
  }

  deleteSelected(): void {
    // Delete selected comment
    if (this.selectedComment) {
      this.graph.comments = this.graph.comments.filter(c => c.id !== this.selectedComment!.id);
      this.selectedComment = null;
      this.onGraphChanged?.();
      return;
    }

    const ids = new Set(this.selectedNodes);
    if (ids.size === 0 && !this.selectedConnection) return;
    this.graph.nodes = this.graph.nodes.filter(n => !ids.has(n.id));
    this.graph.connections = this.graph.connections.filter(
      c => !ids.has(c.fromNode) && !ids.has(c.toNode)
    );
    if (this.selectedConnection) {
      this.graph.connections = this.graph.connections.filter(c => c.id !== this.selectedConnection);
      this.selectedConnection = null;
    }
    this.selectedNodes.clear();
    this.onGraphChanged?.();
  }

  breakSelectedConnections(): void {
    if (this.selectedNodes.size === 0) return;
    const ids = this.selectedNodes;
    this.graph.connections = this.graph.connections.filter(
      c => !ids.has(c.fromNode) && !ids.has(c.toNode)
    );
    this.onGraphChanged?.();
  }

  fitView(): void {
    if (this.graph.nodes.length === 0) {
      this.offsetX = this.canvasEl.clientWidth / 2;
      this.offsetY = this.canvasEl.clientHeight / 2;
      this.zoom = 1;
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of this.graph.nodes) {
      const def = this.nodeDefMap.get(node.type);
      if (!def) continue;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + this.NODE_WIDTH);
      maxY = Math.max(maxY, node.y + this.getNodeHeight(def));
    }

    const gw = maxX - minX + 60;
    const gh = maxY - minY + 60;
    const w = this.canvasEl.clientWidth;
    const h = this.canvasEl.clientHeight;

    this.zoom = Math.min(w / gw, h / gh, 1.5);
    this.offsetX = -minX * this.zoom + (w - gw * this.zoom) / 2 + 30 * this.zoom;
    this.offsetY = -minY * this.zoom + (h - gh * this.zoom) / 2 + 30 * this.zoom;
  }

  /* ─── Serialization ──────────────────────────────────── */

  getGraph(): VisualGraph {
    return this.graph;
  }

  setGraph(graph: VisualGraph): void {
    this.graph = graph;
    if (!this.graph.comments) this.graph.comments = [];
    if (!this.graph.variables) this.graph.variables = [];
    this.selectedNodes.clear();
    this.fitView();
  }

  toJSON(): string {
    return JSON.stringify(this.graph, null, 2);
  }

  fromJSON(json: string): void {
    this.setGraph(JSON.parse(json));
  }

  /* ─── Utilities ──────────────────────────────────────── */

  /** Hit-test an unconnected input socket value area for inline editing */
  private hitTestInputValue(gx: number, gy: number): { node: GraphNode; inputDef: SocketDef } | null {
    for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
      const node = this.graph.nodes[i];
      const def = this.nodeDefMap.get(node.type);
      if (!def) continue;

      for (let j = 0; j < def.inputs.length; j++) {
        const inputDef = def.inputs[j];
        if (inputDef.type === 'exec') continue;

        // Check if connected
        const isConnected = this.graph.connections.some(c => c.toNode === node.id && c.toSocket === inputDef.name);
        if (isConnected) continue;

        // Hit area is the right side of the node at this socket's Y
        const sy = node.y + this.HEADER_H + 12 + j * this.SOCKET_H;
        if (gx >= node.x + 20 && gx <= node.x + this.NODE_WIDTH && gy >= sy - 10 && gy <= sy + 10) {
          return { node, inputDef };
        }
      }
    }
    return null;
  }

  /** Show an inline HTML input to edit a node's input value */
  private showInlineEditor(node: GraphNode, inputDef: SocketDef, clientX: number, clientY: number): void {
    // Remove any existing inline editor
    this.container.querySelector('.vs-inline-editor')?.remove();

    const currentVal = node.inputValues[inputDef.name] ?? inputDef.defaultValue ?? '';

    const wrapper = document.createElement('div');
    wrapper.className = 'vs-inline-editor';
    wrapper.style.cssText = `position:absolute;left:${clientX - this.container.getBoundingClientRect().left}px;top:${clientY - this.container.getBoundingClientRect().top - 12}px;z-index:200;`;

    const input = document.createElement('input');
    input.type = inputDef.type === 'boolean' ? 'checkbox' : 'text';
    input.style.cssText = 'background:#1e1e1e;border:1px solid #0078d4;color:#fff;padding:2px 6px;font-size:11px;width:120px;border-radius:3px;outline:none;';

    if (inputDef.type === 'boolean') {
      (input as HTMLInputElement).checked = !!currentVal;
      input.style.width = 'auto';
    } else if (inputDef.type === 'vec3') {
      const v = currentVal as { x?: number; y?: number; z?: number } | undefined;
      input.value = v ? `${v.x ?? 0}, ${v.y ?? 0}, ${v.z ?? 0}` : '0, 0, 0';
      input.style.width = '140px';
    } else {
      input.value = String(currentVal);
    }

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      let value: unknown;
      if (inputDef.type === 'boolean') {
        value = (input as HTMLInputElement).checked;
      } else if (inputDef.type === 'number') {
        value = parseFloat(input.value) || 0;
      } else if (inputDef.type === 'vec3') {
        const parts = input.value.split(',').map(s => parseFloat(s.trim()) || 0);
        value = { x: parts[0] ?? 0, y: parts[1] ?? 0, z: parts[2] ?? 0 };
      } else {
        value = input.value;
      }
      node.inputValues[inputDef.name] = value;
      if (wrapper.parentNode) wrapper.remove();
      this.onGraphChanged?.();
    };

    const dismiss = () => {
      if (committed) return;
      committed = true;
      if (wrapper.parentNode) wrapper.remove();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); e.stopPropagation(); }
      if (e.key === 'Escape') { dismiss(); e.stopPropagation(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);

    wrapper.appendChild(input);
    this.container.appendChild(wrapper);
    input.focus();
    input.select();
  }

  private canvasToGraph(cx: number, cy: number): { x: number; y: number } {
    return {
      x: (cx - this.offsetX) / this.zoom,
      y: (cy - this.offsetY) / this.zoom,
    };
  }

  private canConnect(fromType: SocketType, toType: SocketType): boolean {
    if (fromType === toType) return true;
    if (fromType === 'any' || toType === 'any') return true;
    // Allow implicit conversions between common types
    const convertible = new Set(['number', 'string', 'boolean']);
    if (convertible.has(fromType) && convertible.has(toType)) return true;
    return false;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, topOnly?: boolean): void {
    const br = topOnly ? 0 : r;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + br, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - br);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private generateId(): string {
    return 'n_' + Math.random().toString(36).substring(2, 10);
  }

  private updateInfo(toolbar: HTMLElement): void {
    const info = toolbar.querySelector('.vs-info');
    if (info) {
      info.textContent = `Nodes: ${this.graph.nodes.length} | Connections: ${this.graph.connections.length}`;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this._debugRuntime?.stop();
    this._debugRuntime = null;
    this._debugPanel?.remove();
    this._debugPanel = null;
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 12 — Subgraph Collapse / Expand
  // ══════════════════════════════════════════════════════════════

  /**
   * Collapse all currently-selected nodes into a new Subgraph node.
   * The original nodes are removed and replaced with a single `subgraph_call` node.
   * The sub-graph is stored in `this.graph.subgraphs`.
   */
  private _collapseToSubgraph(toolbar: HTMLElement): void {
    if (this.selectedNodes.size < 1) return;
    this.pushUndo();

    const ids = new Set(this.selectedNodes);
    const nodes = this.graph.nodes.filter(n => ids.has(n.id));
    const innerConns = this.graph.connections.filter(c => ids.has(c.fromNode) && ids.has(c.toNode));

    // Compute centroid for placement
    const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;

    // Build inner graph
    const innerGraph: VisualGraph = {
      nodes: nodes.map(n => ({ ...n })),
      connections: innerConns.map(c => ({ ...c })),
      variables: [],
      comments: [],
      subgraphs: [],
    };

    if (!this.graph.subgraphs) this.graph.subgraphs = [];
    const subId = 'sg_' + Math.random().toString(36).substring(2, 10);
    const subName = `Subgraph_${this.graph.subgraphs.length + 1}`;

    const subDef: SubgraphDef = {
      id: subId,
      name: subName,
      graph: innerGraph,
      inputPorts: [],
      outputPorts: [],
    };
    this.graph.subgraphs.push(subDef);

    // Remove original nodes and their connections
    this.graph.nodes = this.graph.nodes.filter(n => !ids.has(n.id));
    this.graph.connections = this.graph.connections.filter(c => !ids.has(c.fromNode) && !ids.has(c.toNode));

    // Add a subgraph_call node at centroid
    const callNode = this.addNode('subgraph_call', cx, cy);
    callNode.inputValues['_subgraphId'] = subId;
    callNode.data = { subgraphId: subId, subgraphName: subName };

    this.selectedNodes.clear();
    this.selectedNodes.add(callNode.id);
    this.onGraphChanged?.();
    this.updateInfo(toolbar);
  }

  /**
   * Open the inner graph of a subgraph_call node for editing.
   * Pushes the parent graph onto the navigation stack.
   */
  enterSubgraph(callNodeId: string): void {
    const node = this.graph.nodes.find(n => n.id === callNodeId);
    if (!node || node.type !== 'subgraph_call') return;
    const subId = (node.data?.subgraphId ?? node.inputValues['_subgraphId']) as string;
    const subDef = this.graph.subgraphs?.find(s => s.id === subId);
    if (!subDef) return;

    this._subgraphStack.push({ graph: this.graph, label: 'Root' });
    this.setGraph(subDef.graph);
  }

  /** Navigate back to the parent graph. */
  exitSubgraph(): void {
    const parent = this._subgraphStack.pop();
    if (!parent) return;
    this.setGraph(parent.graph);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 12 — Graph Debugger
  // ══════════════════════════════════════════════════════════════

  private _buildDebugPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 220px; background: #111; border-top: 2px solid #2a6a2a;
      display: flex; flex-direction: column; z-index: 50; font-size: 11px;
    `;

    // ── Toolbar ──
    const dbToolbar = document.createElement('div');
    dbToolbar.style.cssText = 'display:flex;gap:4px;padding:4px 8px;background:#1a1a1a;border-bottom:1px solid #333;align-items:center;';
    dbToolbar.innerHTML = `
      <span style="color:#2ecc71;font-weight:600;margin-right:6px;">🐛 Debugger</span>
      <button class="vs-btn" data-dbg="run"    style="background:#1a3a1a;border:1px solid #2e7d32;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">▶ Run</button>
      <button class="vs-btn" data-dbg="step"   style="background:#1a2a3a;border:1px solid #1565c0;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">⏭ Step</button>
      <button class="vs-btn" data-dbg="resume" style="background:#2a2a1a;border:1px solid #5d4037;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">⏩ Resume</button>
      <button class="vs-btn" data-dbg="stop"   style="background:#3a1a1a;border:1px solid #c62828;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">⏹ Stop</button>
      <span style="flex:1;"></span>
      <span class="dbg-status" style="color:#666;font-size:10px;">Idle</span>
      <button class="vs-btn" data-dbg="clear-bp" style="background:#2a1a1a;border:1px solid #555;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">Clear BPs</button>
      <button class="vs-btn" data-dbg="watch-add" style="background:#1a1a2a;border:1px solid #555;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">+ Watch</button>
    `;
    dbToolbar.querySelectorAll('.vs-btn').forEach(b => {
      (b as HTMLElement).addEventListener('mouseenter', () => { (b as HTMLElement).style.opacity = '0.8'; });
      (b as HTMLElement).addEventListener('mouseleave', () => { (b as HTMLElement).style.opacity = '1'; });
    });
    panel.appendChild(dbToolbar);

    // ── Body ──
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden;';
    panel.appendChild(body);

    // Log pane
    const logPane = document.createElement('div');
    logPane.style.cssText = 'flex:1;overflow-y:auto;padding:4px 8px;font-family:monospace;font-size:10px;color:#aaa;';
    logPane.innerHTML = '<div style="color:#555;">Graph debugger ready. Press ▶ Run to execute the graph.</div>';
    body.appendChild(logPane);

    // Watch pane
    const watchPane = document.createElement('div');
    watchPane.style.cssText = 'width:220px;border-left:1px solid #333;overflow-y:auto;padding:4px;';
    watchPane.innerHTML = '<div style="color:#555;font-size:10px;padding:4px;">No watch entries</div>';
    body.appendChild(watchPane);

    const statusEl = panel.querySelector('.dbg-status') as HTMLElement;
    const appendLog = (msg: string, color = '#aaa') => {
      const line = document.createElement('div');
      line.style.cssText = `color:${color};padding:1px 0;border-bottom:1px solid #1a1a1a;`;
      line.textContent = msg;
      logPane.appendChild(line);
      logPane.scrollTop = logPane.scrollHeight;
    };

    const refreshWatchPane = () => {
      if (!this._debugRuntime) return;
      const values = this._debugRuntime.getWatchValues();
      if (values.size === 0 && this._debugWatches.length === 0) return;
      watchPane.innerHTML = '';
      // Auto-watches from runtime
      for (const [key, val] of values) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;padding:2px 4px;border-bottom:1px solid #1a1a1a;font-size:10px;align-items:center;';
        const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
        row.innerHTML = `<span style="color:#888;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${key}</span><span style="color:#4fc3f7;font-family:monospace;">${valStr.substring(0, 20)}</span>`;
        watchPane.appendChild(row);
      }
    };

    // Double-click on node in canvas → toggle breakpoint
    this.canvasEl?.addEventListener('dblclick', (e) => {
      if (!this._debugPanel) return;
      const { x, y } = this.canvasToGraph(e.offsetX, e.offsetY);
      const node = this.hitTestNode(x, y);
      if (!node) return;
      const hasBP = this._debugBreakpoints.get(node.id) ?? false;
      this._debugBreakpoints.set(node.id, !hasBP);
      if (this._debugRuntime) {
        this._debugRuntime.setBreakpoint(node.id, !hasBP);
      }
      appendLog(`${!hasBP ? '🔴 Breakpoint set' : '⚪ Breakpoint cleared'} on node ${node.type} (${node.id.substring(0, 8)})`, !hasBP ? '#e74c3c' : '#888');
    });

    // Toolbar button handlers
    dbToolbar.querySelector('[data-dbg="run"]')?.addEventListener('click', () => {
      this._debugRuntime?.stop();
      this._debugRuntime = new GraphRuntime(this.graph);

      // Restore breakpoints
      for (const [nodeId, enabled] of this._debugBreakpoints) {
        this._debugRuntime.setBreakpoint(nodeId, enabled);
      }

      this._debugRuntime.onBreakpoint = (nodeId, outputs) => {
        this._debugHighlight = nodeId;
        statusEl.textContent = `⏸ Paused at: ${nodeId.substring(0, 10)}`;
        statusEl.style.color = '#f39c12';
        appendLog(`⏸ Breakpoint hit: ${nodeId} → ${JSON.stringify(outputs).substring(0, 60)}`, '#f39c12');
        refreshWatchPane();
      };

      this._debugRuntime.onNodeExecuted = (nodeId, outputs) => {
        this._debugHighlight = nodeId;
        appendLog(`  ↳ ${nodeId.substring(0, 10)}: ${JSON.stringify(outputs).substring(0, 50)}`, '#666');
        refreshWatchPane();
      };

      logPane.innerHTML = '';
      appendLog('▶ Executing graph...', '#2ecc71');
      statusEl.textContent = '▶ Running';
      statusEl.style.color = '#2ecc71';
      this._debugHighlight = null;

      try {
        this._debugRuntime.trigger('event_start', {
          log: (...args: unknown[]) => appendLog('  📝 ' + args.map(String).join(' '), '#aef'),
        });
        appendLog('✔ Execution complete.', '#2ecc71');
        statusEl.textContent = 'Done';
        statusEl.style.color = '#555';
      } catch (err) {
        appendLog('✖ Error: ' + String(err), '#e74c3c');
        statusEl.textContent = 'Error';
        statusEl.style.color = '#e74c3c';
      }

      this._debugHighlight = null;
      refreshWatchPane();
    });

    dbToolbar.querySelector('[data-dbg="step"]')?.addEventListener('click', () => {
      if (!this._debugRuntime) {
        this._debugRuntime = new GraphRuntime(this.graph);
        this._debugRuntime.setStepMode(true);
        appendLog('⏭ Step mode: click Step to advance one exec node.', '#4fc3f7');
        statusEl.textContent = '⏭ Step Mode';
        statusEl.style.color = '#4fc3f7';
        this._debugRuntime.onBreakpoint = (nodeId) => {
          this._debugHighlight = nodeId;
          appendLog(`  ▶ At node: ${nodeId}`, '#f0883e');
          refreshWatchPane();
        };
        this._debugRuntime.trigger('event_start', {
          log: (...args: unknown[]) => appendLog('  📝 ' + args.map(String).join(' '), '#aef'),
        });
      } else {
        this._debugRuntime.resume();
      }
    });

    dbToolbar.querySelector('[data-dbg="resume"]')?.addEventListener('click', () => {
      this._debugRuntime?.resume();
      statusEl.textContent = '▶ Running';
      statusEl.style.color = '#2ecc71';
      appendLog('⏩ Resumed.', '#f0883e');
    });

    dbToolbar.querySelector('[data-dbg="stop"]')?.addEventListener('click', () => {
      this._debugRuntime?.stop();
      this._debugRuntime = null;
      this._debugHighlight = null;
      statusEl.textContent = 'Stopped';
      statusEl.style.color = '#e74c3c';
      appendLog('⏹ Stopped.', '#e74c3c');
    });

    dbToolbar.querySelector('[data-dbg="clear-bp"]')?.addEventListener('click', () => {
      this._debugBreakpoints.clear();
      appendLog('⚪ All breakpoints cleared.', '#888');
    });

    dbToolbar.querySelector('[data-dbg="watch-add"]')?.addEventListener('click', () => {
      if (!this._debugRuntime) { appendLog('Run the graph first to collect watch values.', '#e74c3c'); return; }
      refreshWatchPane();
      appendLog('🔍 Watch panel updated.', '#4fc3f7');
    });

    return panel;
  }
}
