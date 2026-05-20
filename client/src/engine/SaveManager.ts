// ─── Save / Load System ─────────────────────────────────────────────
// Full game-state persistence via localStorage or IndexedDB.
// Saves: player data, inventory, quests, flags, scene, position, custom data.

export interface SaveSlot {
  id: string;
  name: string;
  timestamp: number;
  playtime: number; // seconds
  thumbnail?: string; // base64 data-url
  data: SaveData;
}

export interface SaveData {
  version: string;
  /** Player state */
  player: {
    position: [number, number, number];
    rotation: [number, number, number];
    health: number;
    maxHealth: number;
  };
  /** Active scene name */
  sceneName: string;
  /** Inventory (serialized from Inventory.serialize()) */
  inventory?: object;
  /** Quest tracker (serialized from QuestTracker.serialize()) */
  quests?: object;
  /** Dialogue flags */
  dialogueFlags?: Record<string, any>;
  /** Arbitrary game flags */
  flags: Record<string, any>;
  /** Custom data bucket for game-specific state */
  custom: Record<string, any>;
}

// Default empty state
function defaultSaveData(): SaveData {
  return {
    version: '1.0.0',
    player: { position: [0, 0, 0], rotation: [0, 0, 0], health: 100, maxHealth: 100 },
    sceneName: 'main',
    flags: {},
    custom: {},
  };
}

// ── Save Manager ────────────────────────────────────────────────────

const STORAGE_PREFIX = 'blindfake_save_';
const INDEX_KEY = 'blindfake_save_index';
const MAX_AUTOSAVES = 3;

export class SaveManager {
  private slots = new Map<string, SaveSlot>();
  private playtimeAccum = 0;

  // Callbacks
  public onSave: ((slot: SaveSlot) => void) | null = null;
  public onLoad: ((slot: SaveSlot) => void) | null = null;
  public onDelete: ((slotId: string) => void) | null = null;

  constructor() {
    this.loadIndex();
  }

  /** Get all save slots */
  getSlots(): SaveSlot[] {
    return Array.from(this.slots.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Get a specific slot */
  getSlot(id: string): SaveSlot | undefined {
    return this.slots.get(id);
  }

  /** Save game state to a named slot */
  save(slotId: string, displayName: string, data: Partial<SaveData>, thumbnail?: string): SaveSlot {
    const fullData: SaveData = { ...defaultSaveData(), ...data };

    const slot: SaveSlot = {
      id: slotId,
      name: displayName,
      timestamp: Date.now(),
      playtime: this.playtimeAccum,
      thumbnail,
      data: fullData,
    };

    this.slots.set(slotId, slot);
    this.persist(slot);
    this.saveIndex();
    this.onSave?.(slot);
    return slot;
  }

  /** Quick save to auto slot */
  autoSave(data: Partial<SaveData>, thumbnail?: string): SaveSlot {
    // Rotate autosaves
    const autoSlots = this.getSlots().filter(s => s.id.startsWith('auto_'));
    if (autoSlots.length >= MAX_AUTOSAVES) {
      // Delete oldest
      const oldest = autoSlots[autoSlots.length - 1];
      this.delete(oldest.id);
    }

    const id = `auto_${Date.now()}`;
    return this.save(id, `Autosave`, data, thumbnail);
  }

  /** Load a save slot (returns the data, game code applies it) */
  load(slotId: string): SaveData | null {
    const slot = this.slots.get(slotId);
    if (!slot) return null;

    this.playtimeAccum = slot.playtime;
    this.onLoad?.(slot);
    return slot.data;
  }

  /** Delete a save slot */
  delete(slotId: string): void {
    this.slots.delete(slotId);
    try {
      localStorage.removeItem(STORAGE_PREFIX + slotId);
    } catch { /* storage full or unavailable */ }
    this.saveIndex();
    this.onDelete?.(slotId);
  }

  /** Delete all saves */
  deleteAll(): void {
    for (const id of Array.from(this.slots.keys())) {
      this.delete(id);
    }
  }

  /** Check if any saves exist */
  hasSaves(): boolean {
    return this.slots.size > 0;
  }

  /** Track playtime (call from engine loop) */
  updatePlaytime(delta: number): void {
    this.playtimeAccum += delta;
  }

  get playtime(): number {
    return this.playtimeAccum;
  }

  /** Format playtime as "HH:MM:SS" */
  formatPlaytime(seconds?: number): string {
    const t = seconds ?? this.playtimeAccum;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /** Capture a thumbnail from the renderer */
  captureThumbnail(renderer: THREE.WebGLRenderer, width = 160, height = 90): string {
    const canvas = renderer.domElement;
    // Create smaller canvas for thumbnail
    const thumb = document.createElement('canvas');
    thumb.width = width;
    thumb.height = height;
    const ctx = thumb.getContext('2d');
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, width, height);
      return thumb.toDataURL('image/jpeg', 0.6);
    }
    return '';
  }

  // ── Persistence ─────────────────────────────────────────────────

  private persist(slot: SaveSlot): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + slot.id, JSON.stringify(slot));
    } catch {
      // localStorage full — try to clear oldest autosave
      const autos = this.getSlots().filter(s => s.id.startsWith('auto_'));
      if (autos.length > 0) {
        this.delete(autos[autos.length - 1].id);
        try {
          localStorage.setItem(STORAGE_PREFIX + slot.id, JSON.stringify(slot));
        } catch {
          console.error('[SaveManager] Storage full — save failed for slot:', slot.id);
        }
      } else {
        console.error('[SaveManager] Storage full and no autosaves to clear — save failed for slot:', slot.id);
      }
    }
  }

  private saveIndex(): void {
    const ids = Array.from(this.slots.keys());
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
    } catch {
      console.warn('[SaveManager] Failed to persist save index to localStorage');
    }
  }

  private loadIndex(): void {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (!raw) return;
      const ids: string[] = JSON.parse(raw);
      for (const id of ids) {
        const data = localStorage.getItem(STORAGE_PREFIX + id);
        if (data) {
          this.slots.set(id, JSON.parse(data));
        }
      }
    } catch { /* corrupted storage */ }
  }
}

// We reference THREE only for the renderer type in captureThumbnail
import type * as THREE from 'three';
