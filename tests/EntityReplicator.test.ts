import { describe, it, expect, beforeEach } from 'vitest';
import { EntityReplicator } from '../client/src/network/EntityReplicator';
import type { EntitySnapshotPayload } from '../shared/types';

function makeSnapshot(
  entityId: string,
  x: number,
  tick: number,
): EntitySnapshotPayload {
  return {
    entityId,
    type: 'player',
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    tick,
  };
}

describe('EntityReplicator', () => {
  let replicator: EntityReplicator;

  beforeEach(() => {
    replicator = new EntityReplicator();
  });

  it('returns undefined for an entity with no snapshots', () => {
    replicator.tick(0.1);
    expect(replicator.getInterpolated('ent-1')).toBeUndefined();
  });

  it('returns the last snapshot when only one exists', () => {
    replicator.applySnapshot(makeSnapshot('ent-1', 5, 1), 0.0);
    replicator.tick(0.2);
    const state = replicator.getInterpolated('ent-1');
    expect(state).toBeDefined();
    expect(state!.position.x).toBeCloseTo(5, 3);
  });

  it('interpolates between two snapshots', () => {
    replicator.applySnapshot(makeSnapshot('ent-1', 0, 1), 0.0);
    replicator.applySnapshot(makeSnapshot('ent-1', 10, 2), 0.5);
    // Advance renderTime so targetTime falls exactly between 0.0 and 0.5
    replicator.tick(0.35); // renderTime = 0.35, targetTime = 0.35 - 0.1 = 0.25
    const state = replicator.getInterpolated('ent-1');
    expect(state).toBeDefined();
    // 0.25 is halfway between 0.0 and 0.5 → x should be ~5
    expect(state!.position.x).toBeGreaterThan(0);
    expect(state!.position.x).toBeLessThan(10);
  });

  it('tracks multiple entities independently', () => {
    replicator.applySnapshot(makeSnapshot('ent-A', 1, 1), 0.0);
    replicator.applySnapshot(makeSnapshot('ent-B', 99, 1), 0.0);
    replicator.tick(0.2);
    expect(replicator.getInterpolated('ent-A')?.position.x).toBeCloseTo(1, 3);
    expect(replicator.getInterpolated('ent-B')?.position.x).toBeCloseTo(99, 3);
  });

  it('getTrackedIds() returns all tracked entity IDs', () => {
    replicator.applySnapshot(makeSnapshot('alpha', 0, 1), 0.0);
    replicator.applySnapshot(makeSnapshot('beta', 0, 1), 0.0);
    const ids = replicator.getTrackedIds();
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
  });

  it('removeEntity() stops tracking that entity', () => {
    replicator.applySnapshot(makeSnapshot('ent-1', 5, 1), 0.0);
    replicator.removeEntity('ent-1');
    replicator.tick(0.2);
    expect(replicator.getInterpolated('ent-1')).toBeUndefined();
    expect(replicator.getTrackedIds()).not.toContain('ent-1');
  });

  it('clear() removes all entities and resets render time', () => {
    replicator.applySnapshot(makeSnapshot('ent-1', 5, 1), 0.0);
    replicator.tick(1.0);
    replicator.clear();
    expect(replicator.getTrackedIds()).toHaveLength(0);
    expect(replicator.currentRenderTime).toBe(0);
  });

  it('tick() accumulates render time', () => {
    replicator.tick(0.5);
    replicator.tick(0.3);
    expect(replicator.currentRenderTime).toBeCloseTo(0.8);
  });
});
