/**
 * AchievementSystem — Achievement/trophy definitions, progress tracking, unlocks.
 *
 * Features:
 *  - Define achievements with conditions, tiers, icons
 *  - Track numeric progress (e.g. "Kill 100 enemies")
 *  - Boolean achievements (e.g. "Find the hidden room")
 *  - Achievement categories / groups
 *  - Hidden achievements (revealed on unlock)
 *  - Timed achievements (complete within X seconds)
 *  - Chain achievements (unlock A to reveal B)
 *  - Notification callback for UI popups
 *  - Serialize / deserialize for save games
 *  - Statistics tracking (play time, kills, etc.)
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'secret';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon?: string;           // URL or emoji
  category: string;
  tier: AchievementTier;
  /** For progress-based: target count */
  targetValue: number;
  /** Hidden until unlocked */
  hidden: boolean;
  /** Must unlock prerequisite first */
  prerequisite?: string;
  /** Time limit in seconds (0 = no limit) */
  timeLimit: number;
  /** Points / XP reward */
  points: number;
  /** Tags for filtering */
  tags: string[];
}

export interface AchievementState {
  id: string;
  progress: number;
  unlocked: boolean;
  unlockedAt: number;     // timestamp ms
  /** For timed achievements: when tracking started */
  startedAt: number;
  notified: boolean;
}

export interface StatDef {
  id: string;
  name: string;
  value: number;
  /** "max" keeps highest value, "sum" accumulates, "last" overwrites */
  mode: 'max' | 'sum' | 'last';
}

export type AchievementEvent =
  | { type: 'unlocked'; achievement: AchievementDef; state: AchievementState }
  | { type: 'progress'; achievement: AchievementDef; state: AchievementState }
  | { type: 'stat_changed'; stat: StatDef };

export type AchievementListener = (event: AchievementEvent) => void;

// ── Tier Colors ─────────────────────────────────────────────────────────────

export const TIER_COLORS: Record<AchievementTier, string> = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#ffd700',
  platinum: '#e5e4e2',
  secret: '#8b00ff',
};

// ── AchievementSystem ───────────────────────────────────────────────────────

export class AchievementSystem {
  private definitions: Map<string, AchievementDef> = new Map();
  private states: Map<string, AchievementState> = new Map();
  private stats: Map<string, StatDef> = new Map();
  private listeners: AchievementListener[] = [];

  // ── Definitions ──────────────────────────────────────────────────────────

  define(cfg: Partial<AchievementDef> & { id: string; name: string }): void {
    const def: AchievementDef = {
      id: cfg.id,
      name: cfg.name,
      description: cfg.description ?? '',
      icon: cfg.icon,
      category: cfg.category ?? 'General',
      tier: cfg.tier ?? 'bronze',
      targetValue: cfg.targetValue ?? 1,
      hidden: cfg.hidden ?? false,
      prerequisite: cfg.prerequisite,
      timeLimit: cfg.timeLimit ?? 0,
      points: cfg.points ?? 10,
      tags: cfg.tags ?? [],
    };
    this.definitions.set(def.id, def);
    if (!this.states.has(def.id)) {
      this.states.set(def.id, {
        id: def.id,
        progress: 0,
        unlocked: false,
        unlockedAt: 0,
        startedAt: 0,
        notified: false,
      });
    }
  }

  getDef(id: string): AchievementDef | undefined { return this.definitions.get(id); }

  // ── Progress ─────────────────────────────────────────────────────────────

  /** Add progress to an achievement. Returns true if this call triggered the unlock. */
  addProgress(id: string, amount = 1): boolean {
    const def = this.definitions.get(id);
    const state = this.states.get(id);
    if (!def || !state || state.unlocked) return false;

    // Check prerequisite
    if (def.prerequisite) {
      const preState = this.states.get(def.prerequisite);
      if (!preState?.unlocked) return false;
    }

    // Start timer on first progress
    if (state.progress === 0 && def.timeLimit > 0) {
      state.startedAt = Date.now();
    }

    state.progress = Math.min(state.progress + amount, def.targetValue);

    this.emit({ type: 'progress', achievement: def, state });

    if (state.progress >= def.targetValue) {
      return this.unlock(id);
    }
    return false;
  }

  /** Set exact progress value */
  setProgress(id: string, value: number): boolean {
    const def = this.definitions.get(id);
    const state = this.states.get(id);
    if (!def || !state || state.unlocked) return false;

    if (def.prerequisite) {
      const preState = this.states.get(def.prerequisite);
      if (!preState?.unlocked) return false;
    }

    if (state.progress === 0 && def.timeLimit > 0) {
      state.startedAt = Date.now();
    }

    state.progress = Math.min(value, def.targetValue);
    this.emit({ type: 'progress', achievement: def, state });

    if (state.progress >= def.targetValue) {
      return this.unlock(id);
    }
    return false;
  }

  /** Force-unlock an achievement */
  unlock(id: string): boolean {
    const def = this.definitions.get(id);
    const state = this.states.get(id);
    if (!def || !state || state.unlocked) return false;

    // Check time limit
    if (def.timeLimit > 0 && state.startedAt > 0) {
      const elapsed = (Date.now() - state.startedAt) / 1000;
      if (elapsed > def.timeLimit) {
        // Failed time limit, reset
        state.progress = 0;
        state.startedAt = 0;
        return false;
      }
    }

    state.unlocked = true;
    state.unlockedAt = Date.now();
    state.progress = def.targetValue;
    this.emit({ type: 'unlocked', achievement: def, state });
    return true;
  }

  /** Reset an achievement to locked state */
  reset(id: string): void {
    const state = this.states.get(id);
    if (state) {
      state.progress = 0;
      state.unlocked = false;
      state.unlockedAt = 0;
      state.startedAt = 0;
      state.notified = false;
    }
  }

  resetAll(): void { this.states.forEach((_, id) => this.reset(id)); }

  // ── Queries ──────────────────────────────────────────────────────────────

  isUnlocked(id: string): boolean { return this.states.get(id)?.unlocked ?? false; }

  getProgress(id: string): number { return this.states.get(id)?.progress ?? 0; }

  getProgressPercent(id: string): number {
    const def = this.definitions.get(id);
    const state = this.states.get(id);
    if (!def || !state) return 0;
    return (state.progress / def.targetValue) * 100;
  }

  getUnlockedCount(): number {
    let count = 0;
    this.states.forEach(s => { if (s.unlocked) count++; });
    return count;
  }

  getTotalCount(): number { return this.definitions.size; }

  getTotalPoints(): number {
    let pts = 0;
    this.states.forEach((s, id) => {
      if (s.unlocked) pts += (this.definitions.get(id)?.points ?? 0);
    });
    return pts;
  }

  getByCategory(category: string): AchievementDef[] {
    const out: AchievementDef[] = [];
    this.definitions.forEach(d => {
      if (d.category === category) out.push(d);
    });
    return out;
  }

  getCategories(): string[] {
    const cats = new Set<string>();
    this.definitions.forEach(d => cats.add(d.category));
    return [...cats];
  }

  /** Get all visible achievements (hides hidden ones unless unlocked or showHidden=true) */
  getAll(showHidden = false): { def: AchievementDef; state: AchievementState }[] {
    const out: { def: AchievementDef; state: AchievementState }[] = [];
    this.definitions.forEach((def, id) => {
      const state = this.states.get(id)!;
      if (!def.hidden || state.unlocked || showHidden) {
        out.push({ def, state });
      }
    });
    return out;
  }

  getRecentUnlocks(count = 5): { def: AchievementDef; state: AchievementState }[] {
    return this.getAll(true)
      .filter(a => a.state.unlocked)
      .sort((a, b) => b.state.unlockedAt - a.state.unlockedAt)
      .slice(0, count);
  }

  // ── Statistics ───────────────────────────────────────────────────────────

  defineStat(id: string, name: string, mode: 'max' | 'sum' | 'last' = 'sum'): void {
    if (!this.stats.has(id)) {
      this.stats.set(id, { id, name, value: 0, mode });
    }
  }

  setStat(id: string, value: number): void {
    const stat = this.stats.get(id);
    if (!stat) return;
    switch (stat.mode) {
      case 'sum': stat.value += value; break;
      case 'max': stat.value = Math.max(stat.value, value); break;
      case 'last': stat.value = value; break;
    }
    this.emit({ type: 'stat_changed', stat });
  }

  getStat(id: string): number { return this.stats.get(id)?.value ?? 0; }

  getAllStats(): StatDef[] { return [...this.stats.values()]; }

  // ── Events ───────────────────────────────────────────────────────────────

  on(listener: AchievementListener): void { this.listeners.push(listener); }

  off(listener: AchievementListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private emit(event: AchievementEvent): void {
    for (const l of this.listeners) l(event);
  }

  /** Mark an achievement notification as shown (for UI) */
  markNotified(id: string): void {
    const s = this.states.get(id);
    if (s) s.notified = true;
  }

  getUnnotified(): { def: AchievementDef; state: AchievementState }[] {
    return this.getAll(true).filter(a => a.state.unlocked && !a.state.notified);
  }

  // ── Serialization ────────────────────────────────────────────────────────

  serialize(): { achievements: Record<string, { progress: number; unlocked: boolean; unlockedAt: number }>; stats: Record<string, number> } {
    const achievements: Record<string, { progress: number; unlocked: boolean; unlockedAt: number }> = {};
    this.states.forEach((s, id) => {
      achievements[id] = { progress: s.progress, unlocked: s.unlocked, unlockedAt: s.unlockedAt };
    });
    const stats: Record<string, number> = {};
    this.stats.forEach((s, id) => { stats[id] = s.value; });
    return { achievements, stats };
  }

  deserialize(data: { achievements?: Record<string, { progress: number; unlocked: boolean; unlockedAt: number }>; stats?: Record<string, number> }): void {
    if (data.achievements) {
      for (const [id, saved] of Object.entries(data.achievements)) {
        const state = this.states.get(id);
        if (state) {
          state.progress = saved.progress;
          state.unlocked = saved.unlocked;
          state.unlockedAt = saved.unlockedAt;
        }
      }
    }
    if (data.stats) {
      for (const [id, val] of Object.entries(data.stats)) {
        const stat = this.stats.get(id);
        if (stat) stat.value = val;
      }
    }
  }
}
