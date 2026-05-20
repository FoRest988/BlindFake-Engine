/**
 * SpawnSystem — Enemy/entity spawning, wave management, and respawn.
 * Features:
 * - Spawn points with configurable properties
 * - Wave system (sequential waves with delays, conditions)
 * - Spawn pools (reuse entities for performance)
 * - Trigger-based spawning (area, event, timer)
 * - Max alive count limiting
 * - Random variation (position jitter, prefab pools)
 * - Spawn/death callbacks
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export interface SpawnPointConfig {
  id: string;
  position: THREE.Vector3;
  /** Spawn radius (entities spawn randomly within this radius) */
  radius: number;
  /** Rotation applied to spawned entities */
  rotation?: THREE.Euler;
  /** Prefab IDs this point can spawn (picks random if multiple) */
  prefabIds: string[];
  /** Max entities this point can have alive at once */
  maxAlive: number;
  /** Respawn delay in seconds (0 = no respawn) */
  respawnDelay: number;
  /** Tags for filtering/grouping */
  tags: string[];
  enabled: boolean;
}

export interface WaveEntry {
  /** Spawn point IDs to use */
  spawnPointIds: string[];
  /** Prefab ID to spawn (overrides spawn point default) */
  prefabId?: string;
  /** Number of entities to spawn */
  count: number;
  /** Delay between individual spawns within this entry (seconds) */
  spawnInterval: number;
}

export interface WaveConfig {
  id: string;
  entries: WaveEntry[];
  /** Delay before this wave starts (seconds) */
  startDelay: number;
  /** Condition to advance to next wave: 'allDead' | 'timer' | 'manual' */
  advanceCondition: 'allDead' | 'timer' | 'manual';
  /** If timer-based, how long before next wave */
  advanceTime?: number;
}

export interface WaveSystemConfig {
  waves: WaveConfig[];
  /** Loop waves from beginning after all complete */
  loop: boolean;
  /** Difficulty scale per loop (multiplies count) */
  loopScale: number;
}

export type SpawnCallback = (entityId: string, prefabId: string, position: THREE.Vector3) => void;
export type DeathCallback = (entityId: string, spawnPointId: string) => void;

// ─── Spawn Point ─────────────────────────────────────

interface SpawnedEntity {
  entityId: string;
  spawnPointId: string;
  alive: boolean;
  respawnTimer: number;
}

export class SpawnManager {
  private spawnPoints = new Map<string, SpawnPointConfig>();
  private spawned: SpawnedEntity[] = [];
  private nextEntityId = 0;

  // Callbacks
  onSpawn: SpawnCallback | null = null;
  onDeath: DeathCallback | null = null;

  addSpawnPoint(config: SpawnPointConfig): void {
    this.spawnPoints.set(config.id, config);
  }

  removeSpawnPoint(id: string): void {
    this.spawnPoints.delete(id);
  }

  getSpawnPoint(id: string): SpawnPointConfig | undefined {
    return this.spawnPoints.get(id);
  }

  getAllSpawnPoints(): SpawnPointConfig[] {
    return [...this.spawnPoints.values()];
  }

  /** Spawn one entity from a specific spawn point */
  spawnOne(spawnPointId: string, prefabOverride?: string): string | null {
    const sp = this.spawnPoints.get(spawnPointId);
    if (!sp || !sp.enabled) return null;

    // Check max alive
    const aliveCount = this.spawned.filter(s => s.spawnPointId === spawnPointId && s.alive).length;
    if (aliveCount >= sp.maxAlive) return null;

    // Pick prefab
    const prefabId = prefabOverride ?? sp.prefabIds[Math.floor(Math.random() * sp.prefabIds.length)];
    if (!prefabId) return null;

    // Random position within radius
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * sp.radius;
    const pos = sp.position.clone().add(
      new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist),
    );

    const entityId = `spawn_${this.nextEntityId++}`;
    this.spawned.push({ entityId, spawnPointId, alive: true, respawnTimer: 0 });

    this.onSpawn?.(entityId, prefabId, pos);
    return entityId;
  }

  /** Spawn N entities from a spawn point */
  spawnMany(spawnPointId: string, count: number, prefabOverride?: string): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = this.spawnOne(spawnPointId, prefabOverride);
      if (id) ids.push(id);
    }
    return ids;
  }

  /** Mark an entity as dead (triggers respawn timer) */
  markDead(entityId: string): void {
    const entry = this.spawned.find(s => s.entityId === entityId);
    if (!entry || !entry.alive) return;
    entry.alive = false;

    const sp = this.spawnPoints.get(entry.spawnPointId);
    if (sp && sp.respawnDelay > 0) {
      entry.respawnTimer = sp.respawnDelay;
    }

    this.onDeath?.(entityId, entry.spawnPointId);
  }

  /** Get alive count for a spawn point */
  getAliveCount(spawnPointId?: string): number {
    if (spawnPointId) {
      return this.spawned.filter(s => s.spawnPointId === spawnPointId && s.alive).length;
    }
    return this.spawned.filter(s => s.alive).length;
  }

  /** Update respawn timers */
  update(delta: number): void {
    for (const entry of this.spawned) {
      if (!entry.alive && entry.respawnTimer > 0) {
        entry.respawnTimer -= delta;
        if (entry.respawnTimer <= 0) {
          // Respawn
          entry.respawnTimer = 0;
          this.spawnOne(entry.spawnPointId);
          // Remove old dead entry
          entry.respawnTimer = -1; // Mark as processed
        }
      }
    }
    // Cleanup processed entries
    this.spawned = this.spawned.filter(s => s.alive || s.respawnTimer >= 0);
  }

  /** Kill all spawned entities */
  killAll(): void {
    for (const entry of this.spawned) {
      if (entry.alive) this.markDead(entry.entityId);
    }
  }

  clear(): void {
    this.spawned = [];
  }
}

// ─── Wave System ─────────────────────────────────────

export class WaveSystem {
  private config: WaveSystemConfig | null = null;
  private spawnManager: SpawnManager;
  private currentWaveIndex = 0;
  private waveTimer = 0;
  private spawnTimer = 0;
  private entryIndex = 0;
  private spawnedInEntry = 0;
  private active = false;
  private loopCount = 0;
  private waveSpawnedIds: string[] = [];

  // Callbacks
  onWaveStart: ((waveIndex: number, loopCount: number) => void) | null = null;
  onWaveEnd: ((waveIndex: number) => void) | null = null;
  onAllWavesComplete: (() => void) | null = null;

  constructor(spawnManager: SpawnManager) {
    this.spawnManager = spawnManager;
  }

  configure(config: WaveSystemConfig): void {
    this.config = config;
  }

  start(): void {
    if (!this.config) return;
    this.active = true;
    this.currentWaveIndex = 0;
    this.loopCount = 0;
    this.startWave(0);
  }

  stop(): void {
    this.active = false;
  }

  get isActive(): boolean { return this.active; }
  get currentWave(): number { return this.currentWaveIndex; }
  get totalWaves(): number { return this.config?.waves.length ?? 0; }

  private startWave(index: number): void {
    if (!this.config || index >= this.config.waves.length) {
      if (this.config?.loop) {
        this.loopCount++;
        this.currentWaveIndex = 0;
        this.startWave(0);
        return;
      }
      this.active = false;
      this.onAllWavesComplete?.();
      return;
    }

    this.currentWaveIndex = index;
    const wave = this.config.waves[index];
    this.waveTimer = wave.startDelay;
    this.entryIndex = 0;
    this.spawnedInEntry = 0;
    this.spawnTimer = 0;
    this.waveSpawnedIds = [];
    this.onWaveStart?.(index, this.loopCount);
  }

  /** Manually advance to next wave */
  advanceWave(): void {
    this.onWaveEnd?.(this.currentWaveIndex);
    this.startWave(this.currentWaveIndex + 1);
  }

  update(delta: number): void {
    if (!this.active || !this.config) return;

    const wave = this.config.waves[this.currentWaveIndex];
    if (!wave) return;

    // Wait for start delay
    if (this.waveTimer > 0) {
      this.waveTimer -= delta;
      return;
    }

    // Spawn entries
    if (this.entryIndex < wave.entries.length) {
      const entry = wave.entries[this.entryIndex];
      const scaledCount = Math.ceil(entry.count * (1 + this.loopCount * (this.config.loopScale - 1)));

      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0 && this.spawnedInEntry < scaledCount) {
        // Spawn one
        const spId = entry.spawnPointIds[this.spawnedInEntry % entry.spawnPointIds.length];
        const id = this.spawnManager.spawnOne(spId, entry.prefabId);
        if (id) this.waveSpawnedIds.push(id);
        this.spawnedInEntry++;
        this.spawnTimer = entry.spawnInterval;

        if (this.spawnedInEntry >= scaledCount) {
          this.entryIndex++;
          this.spawnedInEntry = 0;
        }
      }
      return;
    }

    // All entries spawned, check advance condition
    switch (wave.advanceCondition) {
      case 'allDead':
        if (this.spawnManager.getAliveCount() === 0) {
          this.advanceWave();
        }
        break;
      case 'timer':
        this.waveTimer -= delta;
        if (this.waveTimer <= -(wave.advanceTime ?? 5)) {
          this.advanceWave();
        }
        break;
      case 'manual':
        // Wait for advanceWave() to be called externally
        break;
    }
  }
}
