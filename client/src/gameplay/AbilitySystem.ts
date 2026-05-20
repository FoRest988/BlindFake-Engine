/**
 * AbilitySystem — Combo inputs, abilities with cooldowns, and active effects.
 * Features:
 * - Ability definitions with cooldown, cast time, resource cost
 * - Input combo detection (e.g., ↓↘→ + attack)
 * - Ability slots (hotbar binding)
 * - Channeled abilities
 * - Passive abilities
 * - Resource management (mana, stamina, energy)
 * - Ability events (onCast, onHit, onEnd)
 */

// ─── Types ───────────────────────────────────────────

export type AbilityPhase = 'ready' | 'casting' | 'active' | 'cooldown';

export interface AbilityDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Cooldown in seconds */
  cooldown: number;
  /** Cast time in seconds (0 = instant) */
  castTime: number;
  /** Active duration in seconds (0 = instant) */
  duration: number;
  /** Resource cost */
  cost: { resource: string; amount: number };
  /** Tags (fire, melee, ranged, aoe, heal, buff) */
  tags: string[];
  /** Max charges (1 = normal cooldown, >1 = charge-based) */
  maxCharges: number;
  /** Is this a channeled ability? */
  channeled: boolean;
}

export interface AbilityInstance {
  def: AbilityDef;
  phase: AbilityPhase;
  cooldownRemaining: number;
  castProgress: number;
  activeTimer: number;
  charges: number;
  enabled: boolean;
}

export interface ComboStep {
  input: string;   // e.g., 'attack', 'special', 'up', 'down', 'forward'
  /** Max time window for this input (seconds) */
  window: number;
}

export interface ComboDef {
  id: string;
  name: string;
  steps: ComboStep[];
  /** Ability to activate when combo completes */
  abilityId: string;
}

export type AbilityEvent =
  | { type: 'cast_start'; abilityId: string }
  | { type: 'cast_complete'; abilityId: string }
  | { type: 'cast_cancel'; abilityId: string }
  | { type: 'activate'; abilityId: string }
  | { type: 'deactivate'; abilityId: string }
  | { type: 'cooldown_end'; abilityId: string }
  | { type: 'combo_complete'; comboId: string; abilityId: string };

// ─── Resource Pool ───────────────────────────────────

export class ResourcePool {
  current: number;
  max: number;
  regenRate: number;

  constructor(max: number, regenRate = 0) {
    this.current = max;
    this.max = max;
    this.regenRate = regenRate;
  }

  spend(amount: number): boolean {
    if (this.current < amount) return false;
    this.current -= amount;
    return true;
  }

  restore(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
  }

  update(delta: number): void {
    if (this.regenRate > 0) {
      this.restore(this.regenRate * delta);
    }
  }

  get ratio(): number { return this.current / this.max; }
}

// ─── Ability System ──────────────────────────────────

export class AbilitySystem {
  private abilities = new Map<string, AbilityInstance>();
  private combos: ComboDef[] = [];
  private resources = new Map<string, ResourcePool>();
  private listeners: ((e: AbilityEvent) => void)[] = [];

  // Combo tracking
  private comboInputBuffer: { input: string; time: number }[] = [];
  private comboBufferTimeout = 2; // seconds

  on(cb: (e: AbilityEvent) => void): void { this.listeners.push(cb); }
  off(cb: (e: AbilityEvent) => void): void { this.listeners = this.listeners.filter(l => l !== cb); }
  private emit(e: AbilityEvent): void { for (const l of this.listeners) l(e); }

  // ─── Resources ─────────────────────────────────

  addResource(name: string, max: number, regenRate = 0): ResourcePool {
    const pool = new ResourcePool(max, regenRate);
    this.resources.set(name, pool);
    return pool;
  }

  getResource(name: string): ResourcePool | undefined {
    return this.resources.get(name);
  }

  // ─── Abilities ─────────────────────────────────

  registerAbility(def: AbilityDef): void {
    this.abilities.set(def.id, {
      def,
      phase: 'ready',
      cooldownRemaining: 0,
      castProgress: 0,
      activeTimer: 0,
      charges: def.maxCharges,
      enabled: true,
    });
  }

  getAbility(id: string): AbilityInstance | undefined {
    return this.abilities.get(id);
  }

  getAllAbilities(): AbilityInstance[] {
    return [...this.abilities.values()];
  }

  /** Try to cast an ability */
  cast(abilityId: string): boolean {
    const inst = this.abilities.get(abilityId);
    if (!inst || !inst.enabled) return false;
    if (inst.phase !== 'ready' && inst.charges <= 0) return false;

    // Check resource cost
    const res = this.resources.get(inst.def.cost.resource);
    if (res && !res.spend(inst.def.cost.amount)) return false;

    // Use a charge
    inst.charges = Math.max(0, inst.charges - 1);

    if (inst.def.castTime > 0) {
      inst.phase = 'casting';
      inst.castProgress = 0;
      this.emit({ type: 'cast_start', abilityId });
    } else {
      this.activateAbility(inst);
    }

    return true;
  }

  /** Cancel a casting ability */
  cancelCast(abilityId: string): void {
    const inst = this.abilities.get(abilityId);
    if (!inst || inst.phase !== 'casting') return;
    inst.phase = inst.charges > 0 ? 'ready' : 'cooldown';
    inst.castProgress = 0;
    this.emit({ type: 'cast_cancel', abilityId });
  }

  private activateAbility(inst: AbilityInstance): void {
    this.emit({ type: 'cast_complete', abilityId: inst.def.id });

    if (inst.def.duration > 0) {
      inst.phase = 'active';
      inst.activeTimer = inst.def.duration;
      this.emit({ type: 'activate', abilityId: inst.def.id });
    } else {
      // Instant ability
      this.emit({ type: 'activate', abilityId: inst.def.id });
      this.emit({ type: 'deactivate', abilityId: inst.def.id });
      inst.cooldownRemaining = inst.def.cooldown;
      inst.phase = inst.def.cooldown > 0 ? 'cooldown' : 'ready';
    }
  }

  // ─── Combos ────────────────────────────────────

  registerCombo(combo: ComboDef): void {
    this.combos.push(combo);
  }

  /** Feed an input to the combo system */
  inputCombo(input: string): string | null {
    const now = performance.now() / 1000;
    this.comboInputBuffer.push({ input, time: now });

    // Trim old inputs
    this.comboInputBuffer = this.comboInputBuffer.filter(
      i => now - i.time < this.comboBufferTimeout,
    );

    // Check combos
    for (const combo of this.combos) {
      if (this.matchCombo(combo, now)) {
        this.comboInputBuffer = []; // Clear buffer on match
        this.cast(combo.abilityId);
        this.emit({ type: 'combo_complete', comboId: combo.id, abilityId: combo.abilityId });
        return combo.id;
      }
    }

    return null;
  }

  private matchCombo(combo: ComboDef, now: number): boolean {
    const steps = combo.steps;
    const buffer = this.comboInputBuffer;
    if (buffer.length < steps.length) return false;

    // Check from end of buffer backwards
    let bufIdx = buffer.length - 1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (bufIdx < 0) return false;
      const step = steps[i];
      const entry = buffer[bufIdx];

      if (entry.input !== step.input) return false;
      if (i < steps.length - 1) {
        const prevEntry = buffer[bufIdx + 1];
        if (prevEntry.time - entry.time > step.window) return false;
      }
      bufIdx--;
    }

    return true;
  }

  // ─── Update ────────────────────────────────────

  update(delta: number): void {
    // Update resources
    for (const res of this.resources.values()) res.update(delta);

    // Update abilities
    for (const inst of this.abilities.values()) {
      switch (inst.phase) {
        case 'casting':
          inst.castProgress += delta;
          if (inst.castProgress >= inst.def.castTime) {
            this.activateAbility(inst);
          }
          // Channeled: can be interrupted
          break;

        case 'active':
          inst.activeTimer -= delta;
          if (inst.activeTimer <= 0) {
            inst.phase = inst.def.cooldown > 0 ? 'cooldown' : 'ready';
            inst.cooldownRemaining = inst.def.cooldown;
            this.emit({ type: 'deactivate', abilityId: inst.def.id });
          }
          break;

        case 'cooldown':
          inst.cooldownRemaining -= delta;
          // Recharge charges
          if (inst.cooldownRemaining <= 0) {
            inst.charges = Math.min(inst.charges + 1, inst.def.maxCharges);
            if (inst.charges >= inst.def.maxCharges) {
              inst.phase = 'ready';
              this.emit({ type: 'cooldown_end', abilityId: inst.def.id });
            } else {
              // Start another charge cooldown
              inst.cooldownRemaining = inst.def.cooldown;
            }
          }
          break;
      }
    }
  }

  dispose(): void {
    this.abilities.clear();
    this.combos = [];
    this.resources.clear();
    this.listeners = [];
  }
}
