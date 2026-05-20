import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientPrediction, type SimulateFn } from '../client/src/network/ClientPrediction';
import type { Vec3 } from '../shared/types';

/** Simple flat-plane simulate: applies velocity + acceleration from keys. */
const simulate: SimulateFn = (delta, keys, pos, vel) => {
  const speed = 5;
  let vx = vel.x;
  let vz = vel.z;
  if (keys.forward) vz -= speed * delta;
  if (keys.back)    vz += speed * delta;
  if (keys.left)    vx -= speed * delta;
  if (keys.right)   vx += speed * delta;
  return {
    position: { x: pos.x + vx * delta, y: pos.y, z: pos.z + vz * delta },
    velocity: { x: vx, y: vel.y, z: vz },
  };
};

function noKeys() {
  return { forward: false, back: false, left: false, right: false, jump: false };
}

describe('ClientPrediction', () => {
  let pred: ClientPrediction;

  beforeEach(() => {
    pred = new ClientPrediction(simulate);
  });

  it('starts at sequence 0 with no pending frames', () => {
    expect(pred.currentSequence).toBe(0);
    expect(pred.pendingFrames).toBe(0);
  });

  it('predict() increments sequence and stores a frame', () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const vel: Vec3 = { x: 0, y: 0, z: 0 };
    const seq = pred.predict(0.016, noKeys(), pos, vel);
    expect(seq).toBe(1);
    expect(pred.pendingFrames).toBe(1);
  });

  it('predict() updates position via simulate', () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const vel: Vec3 = { x: 0, y: 0, z: 0 };
    pred.predict(1.0, { forward: true, back: false, left: false, right: false, jump: false }, pos, vel);
    // forward means vz decreases by 5*1 = 5, then z += -5*1 = -5
    expect(pred.position.z).toBeCloseTo(-5, 3);
  });

  it('reconcile() prunes frames up to ackSeq without correction when within threshold', () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const vel: Vec3 = { x: 0, y: 0, z: 0 };
    pred.predict(0.016, noKeys(), pos, vel); // seq 1
    pred.predict(0.016, noKeys(), pos, vel); // seq 2

    // Server agrees — same position → no reconciliation triggered
    pred.reconcile(1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

    expect(pred.reconciliations).toBe(0);
    expect(pred.pendingFrames).toBe(1); // seq 2 remains
  });

  it('reconcile() triggers replay when error exceeds threshold', () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const vel: Vec3 = { x: 0, y: 0, z: 0 };
    pred.predict(0.5, noKeys(), pos, vel); // seq 1 → position stays near 0

    // Server says we're actually at x=10 (large discrepancy)
    pred.reconcile(1, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

    expect(pred.reconciliations).toBe(1);
    // After reconcile with no pending frames, position snaps to server
    expect(pred.position.x).toBeCloseTo(10, 3);
  });

  it('reconcile() replays pending frames on top of server state', () => {
    const startPos: Vec3 = { x: 0, y: 0, z: 0 };
    const startVel: Vec3 = { x: 0, y: 0, z: 0 };

    pred.predict(1.0, noKeys(), startPos, startVel); // seq 1 — no movement
    // seq 2: move right
    pred.predict(1.0, { forward: false, back: false, left: false, right: true, jump: false }, pred.position, pred.velocity);

    // Server acks seq 1 but with a corrected x=5
    pred.reconcile(1, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

    // Seq 2 replay: right key for 1s → vx += 5, x += 5 → x should be ~10
    expect(pred.position.x).toBeGreaterThan(5);
  });

  it('reset() clears all state', () => {
    const pos: Vec3 = { x: 5, y: 0, z: 0 };
    const vel: Vec3 = { x: 0, y: 0, z: 0 };
    pred.predict(0.016, noKeys(), pos, vel);
    pred.reset({ x: 1, y: 2, z: 3 });

    expect(pred.currentSequence).toBe(0);
    expect(pred.pendingFrames).toBe(0);
    expect(pred.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(pred.reconciliations).toBe(0);
  });

  it('buffer is pruned beyond PREDICTION_BUFFER_SIZE', () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const vel: Vec3 = { x: 0, y: 0, z: 0 };
    // Fill more than the max buffer (64)
    for (let i = 0; i < 70; i++) {
      pred.predict(0.016, noKeys(), pos, vel);
    }
    expect(pred.pendingFrames).toBeLessThanOrEqual(64);
  });
});
