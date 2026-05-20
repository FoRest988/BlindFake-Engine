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
  getPreferences: () => EditorAutosavePrefs;
  getActiveScene: () => THREE.Scene | null | undefined;
  serializeScene: (scene: THREE.Scene) => SerializedScene;
  deserializeScene: (data: SerializedScene, targetScene: THREE.Scene) => THREE.Scene;
  rebuildHierarchy: () => void;
  setStatusMessage: (message: string) => void;
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
  private readonly deserializeScene: (data: SerializedScene, targetScene: THREE.Scene) => THREE.Scene;
  private readonly rebuildHierarchy: () => void;
  private readonly setStatusMessage: (message: string) => void;
  private readonly storage?: StorageLike;
  private readonly confirmRestore: (message: string) => boolean;
  private readonly now: () => number;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastAutosave = 0;

  constructor(deps: EditorAutosaveServiceDeps) {
    this.getPreferences = deps.getPreferences;
    this.getActiveScene = deps.getActiveScene;
    this.serializeScene = deps.serializeScene;
    this.deserializeScene = deps.deserializeScene;
    this.rebuildHierarchy = deps.rebuildHierarchy;
    this.setStatusMessage = deps.setStatusMessage;
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
      this.storage.setItem(AUTOSAVE_KEY, json);
      this.storage.setItem(AUTOSAVE_TIME_KEY, String(now));
      this.lastAutosave = now;
      this.setStatusMessage('Autosaved');
    } catch {
      // Ignore full or unavailable storage.
    }
  }

  offerRestore(): void {
    if (!this.storage) return;
    const saved = this.storage.getItem(AUTOSAVE_KEY);
    const timeStr = this.storage.getItem(AUTOSAVE_TIME_KEY);
    if (!saved || !timeStr) return;

    const age = this.now() - Number(timeStr);
    if (age > 86400000) return;

    const mins = Math.floor(age / 60000);
    const label = mins < 1 ? 'less than a minute' : `${mins} minute${mins === 1 ? '' : 's'}`;
    if (!this.confirmRestore(`Autosave found from ${label} ago. Restore it?`)) return;

    try {
      const activeScene = this.getActiveScene();
      if (!activeScene) return;
      this.deserializeScene(JSON.parse(saved) as SerializedScene, activeScene);
      this.rebuildHierarchy();
      this.setStatusMessage('Autosave restored');
    } catch {
      this.setStatusMessage('Failed to restore autosave');
    }
  }

  getLastAutosave(): number {
    return this.lastAutosave;
  }
}