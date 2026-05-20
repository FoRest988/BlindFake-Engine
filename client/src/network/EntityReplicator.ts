/**
 * EntityReplicator — Interpolated remote-entity state management.
 *
 * Stores a rolling buffer of server snapshots for each remote entity and
 * produces smoothly interpolated positions/rotations for rendering, using a
 * configurable delay (default = NETWORK_INTERPOLATION_DELAY).
 *
 * Usage:
 *   const replicator = new EntityReplicator();
 *   // Each time a WorldState message arrives:
 *   replicator.applySnapshot(snapshot);
 *   // Each render frame:
 *   const state = replicator.getInterpolated(entityId, renderTime);
 */

import { GAME_CONFIG, type EntitySnapshotPayload, type Vec3, type Quat } from '@shared/types';

export interface ReplicatedState {
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  type: string;
  data?: Record<string, unknown>;
}

interface SnapshotEntry {
  serverTime: number;
  snapshot: EntitySnapshotPayload;
}

const BUFFER_MAX = 32;
const INTERP_DELAY = GAME_CONFIG.NETWORK_INTERPOLATION_DELAY;

/** Linearly interpolate a Vec3 */
function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Spherically interpolate a Quat (simple nlerp approximation) */
function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  // Ensure shortest path
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const bx = dot < 0 ? -b.x : b.x;
  const by = dot < 0 ? -b.y : b.y;
  const bz = dot < 0 ? -b.z : b.z;
  const bw = dot < 0 ? -b.w : b.w;
  const rx = a.x + (bx - a.x) * t;
  const ry = a.y + (by - a.y) * t;
  const rz = a.z + (bz - a.z) * t;
  const rw = a.w + (bw - a.w) * t;
  const len = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1;
  return { x: rx / len, y: ry / len, z: rz / len, w: rw / len };
}

export class EntityReplicator {
  /** Per-entity snapshot ring buffer (oldest first) */
  private buffers = new Map<string, SnapshotEntry[]>();
  /** Monotonically increasing render timestamp (seconds) */
  private renderTime = 0;

  /**
   * Call once per frame with the real elapsed time so the replicator can
   * advance its internal render clock.
   */
  tick(delta: number): void {
    this.renderTime += delta;
  }

  /**
   * Ingest a batch of snapshots received from a WorldState message.
   * serverTime must be the server's authoritative timestamp for this batch.
   */
  applySnapshot(snapshot: EntitySnapshotPayload, serverTime: number): void {
    if (!this.buffers.has(snapshot.entityId)) {
      this.buffers.set(snapshot.entityId, []);
    }
    const buf = this.buffers.get(snapshot.entityId)!;
    buf.push({ serverTime, snapshot });
    if (buf.length > BUFFER_MAX) buf.shift();
  }

  /**
   * Returns the interpolated state for an entity at the current render time
   * (offset back by INTERP_DELAY).  Returns undefined if no data exists yet.
   */
  getInterpolated(entityId: string): ReplicatedState | undefined {
    const buf = this.buffers.get(entityId);
    if (!buf || buf.length === 0) return undefined;

    const targetTime = this.renderTime - INTERP_DELAY;

    // Find the two entries that bracket targetTime
    let before = buf[0];
    let after = buf[buf.length - 1];

    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].serverTime <= targetTime && buf[i + 1].serverTime >= targetTime) {
        before = buf[i];
        after = buf[i + 1];
        break;
      }
    }

    const span = after.serverTime - before.serverTime;
    const t = span > 0 ? Math.max(0, Math.min(1, (targetTime - before.serverTime) / span)) : 1;

    return {
      position: lerpVec3(before.snapshot.position, after.snapshot.position, t),
      rotation: nlerpQuat(before.snapshot.rotation, after.snapshot.rotation, t),
      velocity: lerpVec3(before.snapshot.velocity, after.snapshot.velocity, t),
      type: after.snapshot.type,
      data: after.snapshot.data,
    };
  }

  /** Returns IDs of all currently tracked remote entities. */
  getTrackedIds(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Remove an entity that has been destroyed on the server (ENTITY_DESTROY).
   */
  removeEntity(entityId: string): void {
    this.buffers.delete(entityId);
  }

  /** Remove all tracked entities (e.g., on room change). */
  clear(): void {
    this.buffers.clear();
    this.renderTime = 0;
  }

  /** Exposed for tests / debugging. */
  get currentRenderTime(): number {
    return this.renderTime;
  }
}
