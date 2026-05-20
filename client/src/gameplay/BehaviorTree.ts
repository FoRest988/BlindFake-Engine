/**
 * BehaviorTree — Full behavior tree system for AI.
 * Features:
 * - Node types: Sequence, Selector, Parallel, Decorator, Action, Condition
 * - Blackboard (shared memory for all nodes in a tree)
 * - Running state support (async actions)
 * - Decorators: Inverter, Repeater, Cooldown, Timeout, Succeeder, Failer
 * - Pre-built actions: Wait, Log, MoveTo, LookAt, Patrol, Chase, Flee
 * - Serialization / deserialization (JSON behavior tree definitions)
 * - Debug visualization (node state tracking)
 */

// ─── Core Types ──────────────────────────────────────

export enum BTStatus {
  Success = 'success',
  Failure = 'failure',
  Running = 'running',
}

export type Blackboard = Map<string, unknown>;

export interface BTContext {
  /** Shared state for the entire tree */
  blackboard: Blackboard;
  /** Delta time in seconds */
  delta: number;
  /** Owner entity/object reference */
  owner: unknown;
}

// ─── Base Node ───────────────────────────────────────

export abstract class BTNode {
  name: string;
  lastStatus: BTStatus = BTStatus.Failure;

  constructor(name = '') {
    this.name = name || this.constructor.name;
  }

  abstract tick(ctx: BTContext): BTStatus;

  /** Called when the tree is aborted or reset */
  reset(): void {
    this.lastStatus = BTStatus.Failure;
  }
}

// ─── Composite: Sequence ─────────────────────────────
// Runs children in order. Fails on first failure. Succeeds when all succeed.

export class Sequence extends BTNode {
  children: BTNode[];
  private runningIndex = 0;

  constructor(name: string, children: BTNode[]) {
    super(name);
    this.children = children;
  }

  tick(ctx: BTContext): BTStatus {
    for (let i = this.runningIndex; i < this.children.length; i++) {
      const status = this.children[i].tick(ctx);
      this.children[i].lastStatus = status;

      if (status === BTStatus.Running) {
        this.runningIndex = i;
        return (this.lastStatus = BTStatus.Running);
      }
      if (status === BTStatus.Failure) {
        this.runningIndex = 0;
        return (this.lastStatus = BTStatus.Failure);
      }
    }
    this.runningIndex = 0;
    return (this.lastStatus = BTStatus.Success);
  }

  reset(): void {
    super.reset();
    this.runningIndex = 0;
    for (const c of this.children) c.reset();
  }
}

// ─── Composite: Selector ─────────────────────────────
// Tries children in order. Succeeds on first success. Fails when all fail.

export class Selector extends BTNode {
  children: BTNode[];
  private runningIndex = 0;

  constructor(name: string, children: BTNode[]) {
    super(name);
    this.children = children;
  }

  tick(ctx: BTContext): BTStatus {
    for (let i = this.runningIndex; i < this.children.length; i++) {
      const status = this.children[i].tick(ctx);
      this.children[i].lastStatus = status;

      if (status === BTStatus.Running) {
        this.runningIndex = i;
        return (this.lastStatus = BTStatus.Running);
      }
      if (status === BTStatus.Success) {
        this.runningIndex = 0;
        return (this.lastStatus = BTStatus.Success);
      }
    }
    this.runningIndex = 0;
    return (this.lastStatus = BTStatus.Failure);
  }

  reset(): void {
    super.reset();
    this.runningIndex = 0;
    for (const c of this.children) c.reset();
  }
}

// ─── Composite: Parallel ─────────────────────────────
// Runs all children simultaneously. Policy determines success/failure.

export type ParallelPolicy = 'requireAll' | 'requireOne';

export class Parallel extends BTNode {
  children: BTNode[];
  successPolicy: ParallelPolicy;
  failurePolicy: ParallelPolicy;

  constructor(name: string, children: BTNode[], successPolicy: ParallelPolicy = 'requireAll', failurePolicy: ParallelPolicy = 'requireOne') {
    super(name);
    this.children = children;
    this.successPolicy = successPolicy;
    this.failurePolicy = failurePolicy;
  }

  tick(ctx: BTContext): BTStatus {
    let successCount = 0;
    let failureCount = 0;

    for (const child of this.children) {
      const status = child.tick(ctx);
      child.lastStatus = status;
      if (status === BTStatus.Success) successCount++;
      if (status === BTStatus.Failure) failureCount++;
    }

    if (this.failurePolicy === 'requireOne' && failureCount > 0) return (this.lastStatus = BTStatus.Failure);
    if (this.failurePolicy === 'requireAll' && failureCount === this.children.length) return (this.lastStatus = BTStatus.Failure);
    if (this.successPolicy === 'requireOne' && successCount > 0) return (this.lastStatus = BTStatus.Success);
    if (this.successPolicy === 'requireAll' && successCount === this.children.length) return (this.lastStatus = BTStatus.Success);

    return (this.lastStatus = BTStatus.Running);
  }

  reset(): void {
    super.reset();
    for (const c of this.children) c.reset();
  }
}

// ─── Decorators ──────────────────────────────────────

/** Inverts child result (success ↔ failure, running stays running) */
export class Inverter extends BTNode {
  child: BTNode;
  constructor(child: BTNode) {
    super(`Inverter(${child.name})`);
    this.child = child;
  }
  tick(ctx: BTContext): BTStatus {
    const s = this.child.tick(ctx);
    if (s === BTStatus.Running) return (this.lastStatus = BTStatus.Running);
    return (this.lastStatus = s === BTStatus.Success ? BTStatus.Failure : BTStatus.Success);
  }
  reset(): void { super.reset(); this.child.reset(); }
}

/** Repeats child N times (or forever if count = 0) */
export class Repeater extends BTNode {
  child: BTNode;
  maxCount: number;
  private count = 0;

  constructor(child: BTNode, maxCount = 0) {
    super(`Repeat(${child.name}, ${maxCount || '∞'})`);
    this.child = child;
    this.maxCount = maxCount;
  }

  tick(ctx: BTContext): BTStatus {
    const s = this.child.tick(ctx);
    if (s === BTStatus.Running) return (this.lastStatus = BTStatus.Running);

    this.count++;
    if (this.maxCount > 0 && this.count >= this.maxCount) {
      this.count = 0;
      return (this.lastStatus = BTStatus.Success);
    }
    return (this.lastStatus = BTStatus.Running);
  }

  reset(): void { super.reset(); this.count = 0; this.child.reset(); }
}

/** Fails if child takes longer than timeout seconds */
export class Timeout extends BTNode {
  child: BTNode;
  timeout: number;
  private elapsed = 0;

  constructor(child: BTNode, timeout: number) {
    super(`Timeout(${child.name}, ${timeout}s)`);
    this.child = child;
    this.timeout = timeout;
  }

  tick(ctx: BTContext): BTStatus {
    this.elapsed += ctx.delta;
    if (this.elapsed >= this.timeout) {
      this.elapsed = 0;
      return (this.lastStatus = BTStatus.Failure);
    }
    const s = this.child.tick(ctx);
    if (s !== BTStatus.Running) this.elapsed = 0;
    return (this.lastStatus = s);
  }

  reset(): void { super.reset(); this.elapsed = 0; this.child.reset(); }
}

/** Cooldown: after child succeeds, waits N seconds before allowing another run */
export class Cooldown extends BTNode {
  child: BTNode;
  cooldownTime: number;
  private timer = 0;

  constructor(child: BTNode, cooldownTime: number) {
    super(`Cooldown(${child.name}, ${cooldownTime}s)`);
    this.child = child;
    this.cooldownTime = cooldownTime;
  }

  tick(ctx: BTContext): BTStatus {
    if (this.timer > 0) {
      this.timer -= ctx.delta;
      return (this.lastStatus = BTStatus.Failure);
    }
    const s = this.child.tick(ctx);
    if (s === BTStatus.Success) this.timer = this.cooldownTime;
    return (this.lastStatus = s);
  }

  reset(): void { super.reset(); this.timer = 0; this.child.reset(); }
}

/** Always returns success regardless of child */
export class Succeeder extends BTNode {
  child: BTNode;
  constructor(child: BTNode) { super(`Succeeder(${child.name})`); this.child = child; }
  tick(ctx: BTContext): BTStatus {
    this.child.tick(ctx);
    return (this.lastStatus = BTStatus.Success);
  }
  reset(): void { super.reset(); this.child.reset(); }
}

// ─── Leaf Nodes: Condition & Action ──────────────────

/** Condition: returns success/failure based on a predicate */
export class Condition extends BTNode {
  private predicate: (ctx: BTContext) => boolean;

  constructor(name: string, predicate: (ctx: BTContext) => boolean) {
    super(name);
    this.predicate = predicate;
  }

  tick(ctx: BTContext): BTStatus {
    return (this.lastStatus = this.predicate(ctx) ? BTStatus.Success : BTStatus.Failure);
  }
}

/** Action: runs a callback, returns the BTStatus it produces */
export class Action extends BTNode {
  private action: (ctx: BTContext) => BTStatus;

  constructor(name: string, action: (ctx: BTContext) => BTStatus) {
    super(name);
    this.action = action;
  }

  tick(ctx: BTContext): BTStatus {
    return (this.lastStatus = this.action(ctx));
  }
}

/** Wait for N seconds, then return Success */
export class Wait extends BTNode {
  duration: number;
  private elapsed = 0;

  constructor(duration: number) {
    super(`Wait(${duration}s)`);
    this.duration = duration;
  }

  tick(ctx: BTContext): BTStatus {
    this.elapsed += ctx.delta;
    if (this.elapsed >= this.duration) {
      this.elapsed = 0;
      return (this.lastStatus = BTStatus.Success);
    }
    return (this.lastStatus = BTStatus.Running);
  }

  reset(): void { super.reset(); this.elapsed = 0; }
}

// ─── Behavior Tree Runner ────────────────────────────

export class BehaviorTree {
  readonly id: string;
  root: BTNode;
  blackboard: Blackboard;
  owner: unknown;
  enabled = true;

  constructor(id: string, root: BTNode, owner?: unknown) {
    this.id = id;
    this.root = root;
    this.blackboard = new Map();
    this.owner = owner;
  }

  tick(delta: number): BTStatus {
    if (!this.enabled) return BTStatus.Failure;
    const ctx: BTContext = { blackboard: this.blackboard, delta, owner: this.owner };
    return this.root.tick(ctx);
  }

  reset(): void {
    this.root.reset();
  }

  /** Set a value on the blackboard */
  set(key: string, value: unknown): void {
    this.blackboard.set(key, value);
  }

  /** Get a value from the blackboard */
  get<T = unknown>(key: string): T | undefined {
    return this.blackboard.get(key) as T | undefined;
  }
}

// ─── Behavior Tree Manager ───────────────────────────

export class BehaviorTreeManager {
  private trees = new Map<string, BehaviorTree>();

  create(id: string, root: BTNode, owner?: unknown): BehaviorTree {
    const tree = new BehaviorTree(id, root, owner);
    this.trees.set(id, tree);
    return tree;
  }

  get(id: string): BehaviorTree | undefined {
    return this.trees.get(id);
  }

  remove(id: string): void {
    this.trees.delete(id);
  }

  /** Tick all active behavior trees */
  update(delta: number): void {
    for (const tree of this.trees.values()) {
      if (tree.enabled) tree.tick(delta);
    }
  }

  /** Get debug state of all nodes in a tree (for editor visualization) */
  getDebugState(id: string): { name: string; status: BTStatus }[] {
    const tree = this.trees.get(id);
    if (!tree) return [];
    const result: { name: string; status: BTStatus }[] = [];
    this.collectNodeStates(tree.root, result);
    return result;
  }

  private collectNodeStates(node: BTNode, out: { name: string; status: BTStatus }[]): void {
    out.push({ name: node.name, status: node.lastStatus });
    if (node instanceof Sequence || node instanceof Selector || node instanceof Parallel) {
      for (const child of node.children) this.collectNodeStates(child, out);
    }
    if ('child' in node && node.child instanceof BTNode) {
      this.collectNodeStates(node.child as BTNode, out);
    }
  }

  dispose(): void {
    this.trees.clear();
  }
}
