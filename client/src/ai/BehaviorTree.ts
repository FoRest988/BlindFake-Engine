// ─── Behavior Tree ─────────────────────────────────────────────────
// Full behavior tree implementation for AI decision making.
// Supports: Sequence, Selector, Parallel, Inverter, Repeater,
// Condition, Action, Cooldown, Random, Wait nodes.

export type BTStatus = 'running' | 'success' | 'failure';

export interface BTBlackboard {
  [key: string]: any;
}

// ── Base Node ──────────────────────────────────────────────────────
export abstract class BTNode {
  public name: string;

  constructor(name = '') {
    this.name = name;
  }

  abstract tick(blackboard: BTBlackboard, delta: number): BTStatus;
  reset(): void {}
}

// ── Composite Nodes ────────────────────────────────────────────────

/** Run children in order. Succeeds if ALL succeed. Fails on first failure. */
export class Sequence extends BTNode {
  private children: BTNode[];
  private currentIndex = 0;

  constructor(name: string, children: BTNode[]) {
    super(name);
    this.children = children;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    while (this.currentIndex < this.children.length) {
      const status = this.children[this.currentIndex].tick(blackboard, delta);
      if (status === 'running') return 'running';
      if (status === 'failure') {
        this.currentIndex = 0;
        return 'failure';
      }
      this.currentIndex++;
    }
    this.currentIndex = 0;
    return 'success';
  }

  reset(): void {
    this.currentIndex = 0;
    for (const child of this.children) child.reset();
  }
}

/** Run children in order. Succeeds on FIRST success. Fails if ALL fail. */
export class Selector extends BTNode {
  private children: BTNode[];
  private currentIndex = 0;

  constructor(name: string, children: BTNode[]) {
    super(name);
    this.children = children;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    while (this.currentIndex < this.children.length) {
      const status = this.children[this.currentIndex].tick(blackboard, delta);
      if (status === 'running') return 'running';
      if (status === 'success') {
        this.currentIndex = 0;
        return 'success';
      }
      this.currentIndex++;
    }
    this.currentIndex = 0;
    return 'failure';
  }

  reset(): void {
    this.currentIndex = 0;
    for (const child of this.children) child.reset();
  }
}

/** Run ALL children simultaneously. Policy determines success/failure. */
export class Parallel extends BTNode {
  private children: BTNode[];
  private successThreshold: number; // How many must succeed

  constructor(name: string, children: BTNode[], successThreshold?: number) {
    super(name);
    this.children = children;
    this.successThreshold = successThreshold ?? children.length;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    let successCount = 0;
    let failureCount = 0;

    for (const child of this.children) {
      const status = child.tick(blackboard, delta);
      if (status === 'success') successCount++;
      if (status === 'failure') failureCount++;
    }

    if (successCount >= this.successThreshold) return 'success';
    if (failureCount > this.children.length - this.successThreshold) return 'failure';
    return 'running';
  }

  reset(): void {
    for (const child of this.children) child.reset();
  }
}

/** Randomly pick one of the children to run */
export class RandomSelector extends BTNode {
  private children: BTNode[];

  constructor(name: string, children: BTNode[]) {
    super(name);
    this.children = children;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    const idx = Math.floor(Math.random() * this.children.length);
    return this.children[idx].tick(blackboard, delta);
  }

  reset(): void {
    for (const child of this.children) child.reset();
  }
}

// ── Decorator Nodes ────────────────────────────────────────────────

/** Invert child's result (success ↔ failure) */
export class Inverter extends BTNode {
  private child: BTNode;

  constructor(name: string, child: BTNode) {
    super(name);
    this.child = child;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    const status = this.child.tick(blackboard, delta);
    if (status === 'success') return 'failure';
    if (status === 'failure') return 'success';
    return 'running';
  }

  reset(): void { this.child.reset(); }
}

/** Repeat child N times (or infinitely if times = -1) */
export class Repeater extends BTNode {
  private child: BTNode;
  private maxTimes: number;
  private count = 0;

  constructor(name: string, child: BTNode, times = -1) {
    super(name);
    this.child = child;
    this.maxTimes = times;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    const status = this.child.tick(blackboard, delta);
    if (status === 'running') return 'running';

    this.count++;
    this.child.reset();

    if (this.maxTimes > 0 && this.count >= this.maxTimes) {
      this.count = 0;
      return 'success';
    }
    return 'running';
  }

  reset(): void {
    this.count = 0;
    this.child.reset();
  }
}

/** Always return 'success' regardless of child result */
export class AlwaysSucceed extends BTNode {
  private child: BTNode;

  constructor(name: string, child: BTNode) {
    super(name);
    this.child = child;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    this.child.tick(blackboard, delta);
    return 'success';
  }

  reset(): void { this.child.reset(); }
}

/** Prevent child from running more often than cooldown interval */
export class Cooldown extends BTNode {
  private child: BTNode;
  private cooldownTime: number;
  private lastRunTime = -Infinity;

  constructor(name: string, child: BTNode, cooldownSeconds: number) {
    super(name);
    this.child = child;
    this.cooldownTime = cooldownSeconds;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    const now = blackboard._btElapsed ?? 0;
    if (now - this.lastRunTime < this.cooldownTime) return 'failure';
    const status = this.child.tick(blackboard, delta);
    if (status !== 'running') this.lastRunTime = now;
    return status;
  }

  reset(): void {
    this.lastRunTime = -Infinity;
    this.child.reset();
  }
}

// ── Leaf Nodes ─────────────────────────────────────────────────────

/** Check a condition (instant) */
export class Condition extends BTNode {
  private check: (bb: BTBlackboard) => boolean;

  constructor(name: string, check: (bb: BTBlackboard) => boolean) {
    super(name);
    this.check = check;
  }

  tick(blackboard: BTBlackboard): BTStatus {
    return this.check(blackboard) ? 'success' : 'failure';
  }
}

/** Execute an action */
export class Action extends BTNode {
  private execute: (bb: BTBlackboard, delta: number) => BTStatus;

  constructor(name: string, execute: (bb: BTBlackboard, delta: number) => BTStatus) {
    super(name);
    this.execute = execute;
  }

  tick(blackboard: BTBlackboard, delta: number): BTStatus {
    return this.execute(blackboard, delta);
  }
}

/** Wait for a duration, then succeed */
export class Wait extends BTNode {
  private duration: number;
  private elapsed = 0;

  constructor(name: string, seconds: number) {
    super(name);
    this.duration = seconds;
  }

  tick(_blackboard: BTBlackboard, delta: number): BTStatus {
    this.elapsed += delta;
    if (this.elapsed >= this.duration) {
      this.elapsed = 0;
      return 'success';
    }
    return 'running';
  }

  reset(): void { this.elapsed = 0; }
}

// ── Behavior Tree Runner ──────────────────────────────────────────

export class BehaviorTree {
  public root: BTNode;
  public blackboard: BTBlackboard;
  private elapsed = 0;

  constructor(root: BTNode, blackboard?: BTBlackboard) {
    this.root = root;
    this.blackboard = blackboard ?? {};
  }

  update(delta: number): BTStatus {
    this.elapsed += delta;
    this.blackboard._btElapsed = this.elapsed;
    this.blackboard._btDelta = delta;
    return this.root.tick(this.blackboard, delta);
  }

  reset(): void {
    this.elapsed = 0;
    this.root.reset();
  }
}
