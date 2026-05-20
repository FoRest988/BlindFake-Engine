/**
 * StatusEffectSystem — Buffs, debuffs, and status effects.
 * Features:
 * - Timed effects (burn, poison, slow, stun, regen, shield, etc.)
 * - Stackable effects (with max stacks)
 * - Effect stacking modes (intensity, duration, independent)
 * - Stat modifiers (flat, percent, override)
 * - Immunity system
 * - Visual FX hooks
 * - Tick damage/heal
 * - Cleanse/purge/dispel
 */

// ─── Types ───────────────────────────────────────────

export type StackMode = 'intensity' | 'duration' | 'independent' | 'refresh';

export interface StatModifier {
  stat: string;
  /** Flat addition */
  flat?: number;
  /** Percent multiplier (0.1 = +10%) */
  percent?: number;
}

export interface StatusEffectDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Duration in seconds (0 = permanent until removed) */
  duration: number;
  /** Max stacks */
  maxStacks: number;
  /** How stacking works */
  stackMode: StackMode;
  /** Is this a buff (positive) or debuff (negative)? */
  isBuff: boolean;
  /** Stat modifiers applied while active */
  modifiers: StatModifier[];
  /** Tick interval in seconds (0 = no ticking) */
  tickInterval: number;
  /** Damage or heal per tick (negative = damage, positive = heal) */
  tickValue: number;
  /** Tags (fire, ice, poison, magic, physical, etc.) */
  tags: string[];
  /** Can this effect be cleansed? */
  cleansable: boolean;
}

export interface StatusEffectInstance {
  def: StatusEffectDef;
  remainingDuration: number;
  stacks: number;
  tickTimer: number;
  source?: string; // Who applied this effect
}

export type EffectEvent =
  | { type: 'applied'; targetId: string; effectId: string; stacks: number }
  | { type: 'removed'; targetId: string; effectId: string }
  | { type: 'stacked'; targetId: string; effectId: string; stacks: number }
  | { type: 'tick'; targetId: string; effectId: string; value: number }
  | { type: 'expired'; targetId: string; effectId: string }
  | { type: 'cleansed'; targetId: string; effectId: string };

// ─── Status Effect System ────────────────────────────

export class StatusEffectSystem {
  private definitions = new Map<string, StatusEffectDef>();
  /** entityId → active effects */
  private entityEffects = new Map<string, StatusEffectInstance[]>();
  /** entityId → immunity tags */
  private immunities = new Map<string, Set<string>>();
  private listeners: ((e: EffectEvent) => void)[] = [];

  on(cb: (e: EffectEvent) => void): void { this.listeners.push(cb); }
  off(cb: (e: EffectEvent) => void): void { this.listeners = this.listeners.filter(l => l !== cb); }
  private emit(e: EffectEvent): void { for (const l of this.listeners) l(e); }

  // ─── Definitions ───────────────────────────────

  registerEffect(def: StatusEffectDef): void {
    this.definitions.set(def.id, def);
  }

  getDef(id: string): StatusEffectDef | undefined {
    return this.definitions.get(id);
  }

  // ─── Apply / Remove ───────────────────────────

  /** Apply a status effect to an entity */
  apply(targetId: string, effectId: string, source?: string): boolean {
    const def = this.definitions.get(effectId);
    if (!def) return false;

    // Check immunity
    const immunes = this.immunities.get(targetId);
    if (immunes) {
      for (const tag of def.tags) {
        if (immunes.has(tag)) return false;
      }
    }

    const effects = this.getEffects(targetId);
    const existing = effects.find(e => e.def.id === effectId);

    if (existing) {
      switch (def.stackMode) {
        case 'intensity':
          existing.stacks = Math.min(existing.stacks + 1, def.maxStacks);
          this.emit({ type: 'stacked', targetId, effectId, stacks: existing.stacks });
          break;
        case 'duration':
          existing.remainingDuration += def.duration;
          this.emit({ type: 'stacked', targetId, effectId, stacks: existing.stacks });
          break;
        case 'refresh':
          existing.remainingDuration = def.duration;
          existing.stacks = Math.min(existing.stacks + 1, def.maxStacks);
          this.emit({ type: 'stacked', targetId, effectId, stacks: existing.stacks });
          break;
        case 'independent':
          // Add another instance
          effects.push({
            def, remainingDuration: def.duration,
            stacks: 1, tickTimer: 0, source,
          });
          this.emit({ type: 'applied', targetId, effectId, stacks: 1 });
          break;
      }
    } else {
      effects.push({
        def, remainingDuration: def.duration,
        stacks: 1, tickTimer: 0, source,
      });
      this.emit({ type: 'applied', targetId, effectId, stacks: 1 });
    }

    return true;
  }

  /** Remove a specific effect from an entity */
  remove(targetId: string, effectId: string): void {
    const effects = this.entityEffects.get(targetId);
    if (!effects) return;
    const idx = effects.findIndex(e => e.def.id === effectId);
    if (idx !== -1) {
      effects.splice(idx, 1);
      this.emit({ type: 'removed', targetId, effectId });
    }
  }

  /** Remove all effects from an entity */
  removeAll(targetId: string): void {
    const effects = this.entityEffects.get(targetId);
    if (!effects) return;
    for (const e of [...effects]) {
      this.emit({ type: 'removed', targetId, effectId: e.def.id });
    }
    effects.length = 0;
  }

  /** Cleanse: remove all cleansable debuffs */
  cleanse(targetId: string, tagFilter?: string): number {
    const effects = this.entityEffects.get(targetId);
    if (!effects) return 0;
    let removed = 0;
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      if (!e.def.isBuff && e.def.cleansable) {
        if (tagFilter && !e.def.tags.includes(tagFilter)) continue;
        effects.splice(i, 1);
        removed++;
        this.emit({ type: 'cleansed', targetId, effectId: e.def.id });
      }
    }
    return removed;
  }

  /** Purge: remove all buffs (for enemies) */
  purge(targetId: string): number {
    const effects = this.entityEffects.get(targetId);
    if (!effects) return 0;
    let removed = 0;
    for (let i = effects.length - 1; i >= 0; i--) {
      if (effects[i].def.isBuff && effects[i].def.cleansable) {
        this.emit({ type: 'removed', targetId, effectId: effects[i].def.id });
        effects.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  // ─── Query ─────────────────────────────────────

  getEffects(targetId: string): StatusEffectInstance[] {
    if (!this.entityEffects.has(targetId)) {
      this.entityEffects.set(targetId, []);
    }
    return this.entityEffects.get(targetId)!;
  }

  hasEffect(targetId: string, effectId: string): boolean {
    return this.getEffects(targetId).some(e => e.def.id === effectId);
  }

  hasTag(targetId: string, tag: string): boolean {
    return this.getEffects(targetId).some(e => e.def.tags.includes(tag));
  }

  getStacks(targetId: string, effectId: string): number {
    const e = this.getEffects(targetId).find(e => e.def.id === effectId);
    return e?.stacks ?? 0;
  }

  /** Get total stat modifier value from all active effects */
  getStatModifier(targetId: string, stat: string): { flat: number; percent: number } {
    let flat = 0;
    let percent = 0;
    for (const effect of this.getEffects(targetId)) {
      for (const mod of effect.def.modifiers) {
        if (mod.stat !== stat) continue;
        if (mod.flat) flat += mod.flat * effect.stacks;
        if (mod.percent) percent += mod.percent * effect.stacks;
      }
    }
    return { flat, percent };
  }

  /** Apply stat modifier: baseValue * (1 + percent) + flat */
  applyStatMod(targetId: string, stat: string, baseValue: number): number {
    const mod = this.getStatModifier(targetId, stat);
    return baseValue * (1 + mod.percent) + mod.flat;
  }

  // ─── Immunity ──────────────────────────────────

  addImmunity(targetId: string, tag: string): void {
    if (!this.immunities.has(targetId)) this.immunities.set(targetId, new Set());
    this.immunities.get(targetId)!.add(tag);
  }

  removeImmunity(targetId: string, tag: string): void {
    this.immunities.get(targetId)?.delete(tag);
  }

  // ─── Update ────────────────────────────────────

  update(delta: number): void {
    for (const [targetId, effects] of this.entityEffects) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];

        // Tick damage/heal
        if (e.def.tickInterval > 0) {
          e.tickTimer += delta;
          while (e.tickTimer >= e.def.tickInterval) {
            e.tickTimer -= e.def.tickInterval;
            const value = e.def.tickValue * e.stacks;
            this.emit({ type: 'tick', targetId, effectId: e.def.id, value });
          }
        }

        // Duration
        if (e.def.duration > 0) {
          e.remainingDuration -= delta;
          if (e.remainingDuration <= 0) {
            effects.splice(i, 1);
            this.emit({ type: 'expired', targetId, effectId: e.def.id });
          }
        }
      }
    }
  }

  dispose(): void {
    this.entityEffects.clear();
    this.definitions.clear();
    this.immunities.clear();
    this.listeners = [];
  }
}
