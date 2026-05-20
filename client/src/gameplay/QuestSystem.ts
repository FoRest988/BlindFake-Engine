// ─── Quest System ───────────────────────────────────────────────────
// Quest tracking with objectives, progress, rewards, chains,
// and journal UI integration.

export enum QuestStatus {
  Unavailable = 'unavailable',
  Available = 'available',
  Active = 'active',
  Completed = 'completed',
  Failed = 'failed',
}

export enum ObjectiveType {
  Collect = 'collect',
  Kill = 'kill',
  TalkTo = 'talkTo',
  GoTo = 'goTo',
  Interact = 'interact',
  Custom = 'custom',
}

export interface QuestObjective {
  id: string;
  type: ObjectiveType;
  description: string;
  /** Target ID (item, enemy, NPC, location, etc.) */
  targetId: string;
  /** Required count */
  required: number;
  /** Current progress */
  current: number;
  /** Hidden objectives not shown until revealed */
  hidden?: boolean;
  /** Optional: mark as optional (not needed for completion) */
  optional?: boolean;
}

export interface QuestReward {
  type: 'item' | 'xp' | 'gold' | 'custom';
  id?: string;
  amount: number;
  description?: string;
}

export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  category?: string;
  /** Minimum player level or condition */
  level?: number;
  /** Quest giver NPC */
  giverNpcId?: string;
  objectives: Omit<QuestObjective, 'current'>[];
  rewards: QuestReward[];
  /** Quest that must be completed first */
  prerequisiteQuestId?: string;
  /** Next quest in chain (auto-unlock) */
  nextQuestId?: string;
  /** Time limit in seconds (0 = no limit) */
  timeLimit?: number;
  /** Is this a main story quest? */
  isMainQuest?: boolean;
  /** Custom condition for availability */
  availableCondition?: (tracker: QuestTracker) => boolean;
  /** On complete callback */
  onComplete?: (tracker: QuestTracker) => void;
  /** On fail callback */
  onFail?: (tracker: QuestTracker) => void;
}

// ── Active Quest Instance ───────────────────────────────────────────

export interface ActiveQuest {
  definition: QuestDefinition;
  status: QuestStatus;
  objectives: QuestObjective[];
  startTime: number;
  completionTime?: number;
}

// ── Quest Tracker ───────────────────────────────────────────────────

export class QuestTracker {
  private definitions = new Map<string, QuestDefinition>();
  private activeQuests = new Map<string, ActiveQuest>();
  private completedQuestIds = new Set<string>();
  private failedQuestIds = new Set<string>();

  // Callbacks
  public onQuestStarted: ((quest: ActiveQuest) => void) | null = null;
  public onQuestCompleted: ((quest: ActiveQuest) => void) | null = null;
  public onQuestFailed: ((quest: ActiveQuest) => void) | null = null;
  public onObjectiveProgress: ((quest: ActiveQuest, objective: QuestObjective) => void) | null = null;
  public onObjectiveCompleted: ((quest: ActiveQuest, objective: QuestObjective) => void) | null = null;
  public onQuestAvailable: ((questId: string) => void) | null = null;

  /** Register quest definitions */
  registerQuest(def: QuestDefinition): void {
    this.definitions.set(def.id, def);
  }

  registerMany(defs: QuestDefinition[]): void {
    defs.forEach(d => this.registerQuest(d));
  }

  /** Start a quest */
  startQuest(questId: string): boolean {
    const def = this.definitions.get(questId);
    if (!def) return false;
    if (this.activeQuests.has(questId)) return false;
    if (this.completedQuestIds.has(questId)) return false;

    // Check prerequisites
    if (def.prerequisiteQuestId && !this.completedQuestIds.has(def.prerequisiteQuestId)) return false;
    if (def.availableCondition && !def.availableCondition(this)) return false;

    const active: ActiveQuest = {
      definition: def,
      status: QuestStatus.Active,
      objectives: def.objectives.map(o => ({ ...o, current: 0 })),
      startTime: Date.now(),
    };

    this.activeQuests.set(questId, active);
    this.onQuestStarted?.(active);
    return true;
  }

  /** Report progress on an objective type + target */
  reportProgress(objectiveType: ObjectiveType, targetId: string, amount: number = 1): void {
    for (const [_, quest] of this.activeQuests) {
      if (quest.status !== QuestStatus.Active) continue;

      for (const obj of quest.objectives) {
        if (obj.type === objectiveType && obj.targetId === targetId && obj.current < obj.required) {
          obj.current = Math.min(obj.current + amount, obj.required);
          this.onObjectiveProgress?.(quest, obj);

          if (obj.current >= obj.required) {
            this.onObjectiveCompleted?.(quest, obj);
          }

          // Check if all required objectives complete
          this.checkQuestCompletion(quest);
        }
      }
    }
  }

  /** Force complete an objective by ID */
  completeObjective(questId: string, objectiveId: string): void {
    const quest = this.activeQuests.get(questId);
    if (!quest) return;

    const obj = quest.objectives.find(o => o.id === objectiveId);
    if (obj && obj.current < obj.required) {
      obj.current = obj.required;
      this.onObjectiveCompleted?.(quest, obj);
      this.checkQuestCompletion(quest);
    }
  }

  /** Fail a quest */
  failQuest(questId: string): void {
    const quest = this.activeQuests.get(questId);
    if (!quest) return;

    quest.status = QuestStatus.Failed;
    this.failedQuestIds.add(questId);
    this.activeQuests.delete(questId);
    quest.definition.onFail?.(this);
    this.onQuestFailed?.(quest);
  }

  /** Complete a quest manually */
  completeQuest(questId: string): void {
    const quest = this.activeQuests.get(questId);
    if (!quest) return;

    quest.status = QuestStatus.Completed;
    quest.completionTime = Date.now();
    this.completedQuestIds.add(questId);
    this.activeQuests.delete(questId);
    quest.definition.onComplete?.(this);
    this.onQuestCompleted?.(quest);

    // Auto-start next quest in chain
    if (quest.definition.nextQuestId) {
      this.onQuestAvailable?.(quest.definition.nextQuestId);
    }
  }

  /** Update timed quests */
  update(delta: number): void {
    const now = Date.now();
    for (const [questId, quest] of this.activeQuests) {
      if (quest.definition.timeLimit && quest.definition.timeLimit > 0) {
        const elapsed = (now - quest.startTime) / 1000;
        if (elapsed >= quest.definition.timeLimit) {
          this.failQuest(questId);
        }
      }
    }
  }

  /** Get quest status */
  getQuestStatus(questId: string): QuestStatus {
    if (this.completedQuestIds.has(questId)) return QuestStatus.Completed;
    if (this.failedQuestIds.has(questId)) return QuestStatus.Failed;
    if (this.activeQuests.has(questId)) return QuestStatus.Active;

    const def = this.definitions.get(questId);
    if (!def) return QuestStatus.Unavailable;

    if (def.prerequisiteQuestId && !this.completedQuestIds.has(def.prerequisiteQuestId)) {
      return QuestStatus.Unavailable;
    }
    if (def.availableCondition && !def.availableCondition(this)) {
      return QuestStatus.Unavailable;
    }

    return QuestStatus.Available;
  }

  /** Get all active quests */
  getActiveQuests(): ActiveQuest[] {
    return Array.from(this.activeQuests.values()).filter(q => q.status === QuestStatus.Active);
  }

  /** Get main quests */
  getMainQuests(): ActiveQuest[] {
    return this.getActiveQuests().filter(q => q.definition.isMainQuest);
  }

  /** Get side quests */
  getSideQuests(): ActiveQuest[] {
    return this.getActiveQuests().filter(q => !q.definition.isMainQuest);
  }

  /** Get all available quests (not started yet) */
  getAvailableQuests(): QuestDefinition[] {
    const available: QuestDefinition[] = [];
    for (const [id, def] of this.definitions) {
      if (this.getQuestStatus(id) === QuestStatus.Available) {
        available.push(def);
      }
    }
    return available;
  }

  /** Get completed quest IDs */
  getCompletedQuestIds(): string[] {
    return Array.from(this.completedQuestIds);
  }

  /** Check if a quest is completed */
  isCompleted(questId: string): boolean {
    return this.completedQuestIds.has(questId);
  }

  /** Serialize for save */
  serialize(): object {
    return {
      active: Array.from(this.activeQuests.entries()).map(([id, q]) => ({
        questId: id,
        objectives: q.objectives.map(o => ({ id: o.id, current: o.current })),
        startTime: q.startTime,
      })),
      completed: Array.from(this.completedQuestIds),
      failed: Array.from(this.failedQuestIds),
    };
  }

  /** Deserialize from save (quest definitions must already be registered) */
  deserialize(data: any): void {
    this.activeQuests.clear();
    this.completedQuestIds.clear();
    this.failedQuestIds.clear();

    if (data.completed) {
      for (const id of data.completed) this.completedQuestIds.add(id);
    }
    if (data.failed) {
      for (const id of data.failed) this.failedQuestIds.add(id);
    }
    if (data.active) {
      for (const entry of data.active) {
        const def = this.definitions.get(entry.questId);
        if (!def) continue;

        const active: ActiveQuest = {
          definition: def,
          status: QuestStatus.Active,
          objectives: def.objectives.map(o => ({ ...o, current: 0 })),
          startTime: entry.startTime,
        };

        // Restore progress
        for (const saved of entry.objectives) {
          const obj = active.objectives.find(o => o.id === saved.id);
          if (obj) obj.current = saved.current;
        }

        this.activeQuests.set(entry.questId, active);
      }
    }
  }

  // ── Private ─────────────────────────────────────────────────────

  private checkQuestCompletion(quest: ActiveQuest): void {
    const allRequiredDone = quest.objectives
      .filter(o => !o.optional)
      .every(o => o.current >= o.required);

    if (allRequiredDone) {
      this.completeQuest(quest.definition.id);
    }
  }
}
