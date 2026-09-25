import * as THREE from 'three';
import type { SerializedScene } from '../engine/SceneSerialization';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EditorAutosavePrefs {
  autoSaveEnabled: boolean;
  autoSaveInterval: number;
}

export interface EditorAutosaveServiceDeps {
  /** Autosaves are stored per project; without an id the legacy shared key is used. */
  projectId?: string | null;
  getPreferences: () => EditorAutosavePrefs;
  getActiveScene: () => THREE.Scene | null | undefined;
  serializeScene: (scene: THREE.Scene) => SerializedScene;
  /** Replace the editable content of the active scene with the saved data (must not duplicate objects). */
  restoreScene: (data: SerializedScene) => void;
  setStatusMessage: (message: string) => void;
  /** Called with the serialized JSON after every successful autosave (e.g. to mirror it into the project record). */
  onSaved?: (json: string) => void;
  storage?: StorageLike;
  confirmRestore?: (message: string) => boolean;
  now?: () => number;
}

const AUTOSAVE_KEY = 'blindfake_autosave';
const AUTOSAVE_TIME_KEY = 'blindfake_autosave_time';

export class EditorAutosaveService {
  private readonly getPreferences: () => EditorAutosavePrefs;
  private readonly getActiveScene: () => THREE.Scene | null | undefined;
  private readonly serializeScene: (scene: THREE.Scene) => SerializedScene;
  private readonly restoreScene: (data: SerializedScene) => void;
  private readonly setStatusMessage: (message: string) => void;
  private readonly onSaved?: (json: string) => void;
  private readonly dataKey: string;
  private readonly timeKey: string;
  private readonly storage?: StorageLike;
  private readonly confirmRestore: (message: string) => boolean;
  private readonly now: () => number;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastAutosave = 0;

  constructor(deps: EditorAutosaveServiceDeps) {
    this.getPreferences = deps.getPreferences;
    this.getActiveScene = deps.getActiveScene;
    this.serializeScene = deps.serializeScene;
    this.restoreScene = deps.restoreScene;
    this.setStatusMessage = deps.setStatusMessage;
    this.onSaved = deps.onSaved;
    const suffix = deps.projectId ? `:${deps.projectId}` : '';
    this.dataKey = AUTOSAVE_KEY + suffix;
    this.timeKey = AUTOSAVE_TIME_KEY + suffix;
    this.storage = deps.storage;
    this.confirmRestore = deps.confirmRestore ?? ((message) => confirm(message));
    this.now = deps.now ?? (() => Date.now());
  }

  start(): void {
    this.stop();
    const prefs = this.getPreferences();
    if (!prefs.autoSaveEnabled) return;
    const interval = (prefs.autoSaveInterval ?? 120) * 1000;
    this.autosaveTimer = setInterval(() => this.perform(), interval);
  }

  stop(): void {
    if (!this.autosaveTimer) return;
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  perform(): void {
    const activeScene = this.getActiveScene();
    if (!activeScene || !this.storage) return;
    const json = JSON.stringify(this.serializeScene(activeScene));
    try {
      const now = this.now();
      this.storage.setItem(this.dataKey, json);
      this.storage.setItem(this.timeKey, String(now));
      this.lastAutosave = now;
      this.setStatusMessage('Autosaved');
      this.onSaved?.(json);
    } catch {
      // Ignore full or unavailable storage.
    }
  }

  offerRestore(): void {
    if (!this.storage) return;
    const saved = this.storage.getItem(this.dataKey);
    const timeStr = this.storage.getItem(this.timeKey);
    if (!saved || !timeStr) return;

    const age = this.now() - Number(timeStr);
    if (age > 86400000) return;

    const mins = Math.floor(age / 60000);
    const label = mins < 1 ? 'less than a minute' : `${mins} minute${mins === 1 ? '' : 's'}`;
    if (!this.confirmRestore(`Autosave found from ${label} ago. Restore it?`)) return;

    try {
      if (!this.getActiveScene()) return;
      this.restoreScene(JSON.parse(saved) as SerializedScene);
      this.setStatusMessage('Autosave restored');
    } catch {
      this.setStatusMessage('Failed to restore autosave');
    }
  }

  getLastAutosave(): number {
    return this.lastAutosave;
  }
}