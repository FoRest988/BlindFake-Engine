// ─── Global Event Bus ──────────────────────────────────────────────
// Decoupled pub/sub communication for the entire engine.
// Use for game events, UI notifications, system-to-system messaging.

type EventCallback = (...args: any[]) => void;

interface EventEntry {
  callback: EventCallback;
  context: any;
  once: boolean;
}

export class EventBus {
  private listeners = new Map<string, EventEntry[]>();
  private history = new Map<string, any[]>(); // last emitted args per event

  /** Subscribe to an event */
  on(event: string, callback: EventCallback, context?: any): () => void {
    const entries = this.listeners.get(event) ?? [];
    const entry: EventEntry = { callback, context, once: false };
    entries.push(entry);
    this.listeners.set(event, entries);

    // Return unsubscribe function
    return () => this.off(event, callback, context);
  }

  /** Subscribe to an event, auto-unsubscribe after first trigger */
  once(event: string, callback: EventCallback, context?: any): () => void {
    const entries = this.listeners.get(event) ?? [];
    const entry: EventEntry = { callback, context, once: true };
    entries.push(entry);
    this.listeners.set(event, entries);
    return () => this.off(event, callback, context);
  }

  /** Unsubscribe from an event */
  off(event: string, callback: EventCallback, context?: any): void {
    const entries = this.listeners.get(event);
    if (!entries) return;
    const filtered = entries.filter(
      (e) => e.callback !== callback || (context !== undefined && e.context !== context)
    );
    if (filtered.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, filtered);
    }
  }

  /** Emit an event with optional arguments */
  emit(event: string, ...args: any[]): void {
    this.history.set(event, args);
    const entries = this.listeners.get(event);
    if (!entries) return;

    // Copy array as callbacks may modify it (once removal)
    const snapshot = [...entries];
    for (const entry of snapshot) {
      entry.callback.apply(entry.context, args);
      if (entry.once) {
        this.off(event, entry.callback, entry.context);
      }
    }
  }

  /** Remove all listeners for an event, or all listeners entirely */
  clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /** Check if event has listeners */
  hasListeners(event: string): boolean {
    return (this.listeners.get(event)?.length ?? 0) > 0;
  }

  /** Get last emitted args for an event (useful for late subscribers) */
  getLastEmit(event: string): any[] | undefined {
    return this.history.get(event);
  }

  /** Count listeners for a specific event */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

// ─── Common Engine Events ─────────────────────────────────────────
// These are string constants for commonly used engine events.
// Use them for type safety and autocomplete.
export const EngineEvents = {
  // Lifecycle
  GAME_START: 'engine:gameStart',
  GAME_STOP: 'engine:gameStop',
  GAME_PAUSE: 'engine:gamePause',
  GAME_RESUME: 'engine:gameResume',
  SCENE_LOADED: 'engine:sceneLoaded',
  SCENE_CHANGED: 'engine:sceneChanged',

  // Entity
  ENTITY_CREATED: 'entity:created',
  ENTITY_DESTROYED: 'entity:destroyed',
  ENTITY_COMPONENT_ADDED: 'entity:componentAdded',
  ENTITY_COMPONENT_REMOVED: 'entity:componentRemoved',

  // Player
  PLAYER_SPAWN: 'player:spawn',
  PLAYER_DEATH: 'player:death',
  PLAYER_DAMAGE: 'player:damage',
  PLAYER_HEAL: 'player:heal',
  PLAYER_LEVEL_UP: 'player:levelUp',

  // Combat
  ATTACK_START: 'combat:attackStart',
  ATTACK_HIT: 'combat:attackHit',
  DAMAGE_DEALT: 'combat:damageDealt',
  ENEMY_KILLED: 'combat:enemyKilled',

  // Items / Inventory
  ITEM_PICKUP: 'item:pickup',
  ITEM_DROP: 'item:drop',
  ITEM_USE: 'item:use',
  ITEM_EQUIP: 'item:equip',
  ITEM_UNEQUIP: 'item:unequip',
  INVENTORY_CHANGED: 'inventory:changed',

  // Quest
  QUEST_START: 'quest:start',
  QUEST_COMPLETE: 'quest:complete',
  QUEST_OBJECTIVE_UPDATE: 'quest:objectiveUpdate',
  QUEST_FAILED: 'quest:failed',

  // Dialogue
  DIALOGUE_START: 'dialogue:start',
  DIALOGUE_END: 'dialogue:end',
  DIALOGUE_CHOICE: 'dialogue:choice',

  // UI
  UI_MENU_OPEN: 'ui:menuOpen',
  UI_MENU_CLOSE: 'ui:menuClose',
  UI_NOTIFICATION: 'ui:notification',

  // Audio
  MUSIC_CHANGED: 'audio:musicChanged',
  SFX_PLAYED: 'audio:sfxPlayed',

  // Network
  NET_CONNECTED: 'net:connected',
  NET_DISCONNECTED: 'net:disconnected',
  NET_PLAYER_JOIN: 'net:playerJoin',
  NET_PLAYER_LEAVE: 'net:playerLeave',

  // Editor
  EDITOR_OPEN: 'editor:open',
  EDITOR_CLOSE: 'editor:close',
  EDITOR_SELECT: 'editor:select',
  EDITOR_DESELECT: 'editor:deselect',
} as const;
