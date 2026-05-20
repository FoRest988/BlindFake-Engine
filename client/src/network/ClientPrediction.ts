/**
 * ClientPrediction — Sequence-based client-side prediction with server reconciliation.
 *
 * How it works:
 * 1. Each frame the game applies local inputs immediately (predict).
 * 2. The resulting position is stored in a ring buffer keyed by sequence number.
 * 3. When the server sends an authoritative state with an acknowledged sequence,
 *    we compare: if the difference exceeds RECONCILE_THRESHOLD we replay all
 *    unacknowledged inputs from the stored buffer on top of the server position.
 *
 * Usage:
 *   const pred = new ClientPrediction(simulateFn);
 *   // In update loop:
 *   const seq = pred.predict(delta, keys, currentPos, currentVel);
 *   network.sendInput({ sequence: seq, delta, keys });
 *   // When server ack arrives:
 *   pred.reconcile(ackSeq, serverPos, serverVel);
 */

import {
  GAME_CONFIG,
  type Vec3,
  type PredictedInput,
} from '@shared/types';

export type SimulateFn = (
  delta: number,
  keys: PredictedInput['keys'],
  pos: Vec3,
  vel: Vec3,
) => { position: Vec3; velocity: Vec3 };

function vec3Dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export class ClientPrediction {
  private simulate: SimulateFn;
  private buffer: Map<number, PredictedInput> = new Map();
  private sequence = 0;
  private readonly maxBuffer = GAME_CONFIG.PREDICTION_BUFFER_SIZE;
  private readonly threshold = GAME_CONFIG.RECONCILE_THRESHOLD;

  /** Latest predicted position (written by predict(), readable by game). */
  public position: Vec3 = { x: 0, y: 0, z: 0 };
  /** Latest predicted velocity. */
  public velocity: Vec3 = { x: 0, y: 0, z: 0 };

  /** Total number of reconciliations triggered (useful for diagnostics). */
  public reconciliations = 0;
  /** How many frames were replayed during the last reconciliation. */
  public lastReplayFrames = 0;

  constructor(simulate: SimulateFn) {
    this.simulate = simulate;
  }

  /**
   * Apply inputs locally, store the result, and return the sequence number to
   * send to the server.
   */
  predict(
    delta: number,
    keys: PredictedInput['keys'],
    position: Vec3,
    velocity: Vec3,
  ): number {
    const seq = ++this.sequence;
    const result = this.simulate(delta, keys, position, velocity);

    const frame: PredictedInput = {
      sequence: seq,
      delta,
      keys,
      resultPosition: cloneVec3(result.position),
      resultVelocity: cloneVec3(result.velocity),
    };

    this.buffer.set(seq, frame);
    this.position = result.position;
    this.velocity = result.velocity;

    // Prune old frames beyond buffer size
    if (this.buffer.size > this.maxBuffer) {
      const oldest = seq - this.maxBuffer;
      this.buffer.delete(oldest);
    }

    return seq;
  }

  /**
   * Called when a server authoritative snapshot arrives with an acknowledged
   * input sequence number.  Reconciles if the error exceeds the threshold.
   */
  reconcile(ackSeq: number, serverPos: Vec3, serverVel: Vec3): void {
    const predicted = this.buffer.get(ackSeq);
    if (!predicted) return; // already pruned or future frame

    const error = vec3Dist(predicted.resultPosition, serverPos);
    if (error <= this.threshold) {
      // Small enough — just clean up the buffer up to ackSeq
      this.pruneUpTo(ackSeq);
      return;
    }

    // Error too large — replay all unacknowledged frames on top of server state
    this.reconciliations++;
    this.pruneUpTo(ackSeq);

    let pos = cloneVec3(serverPos);
    let vel = cloneVec3(serverVel);

    const pending = Array.from(this.buffer.values()).sort((a, b) => a.sequence - b.sequence);
    this.lastReplayFrames = pending.length;

    for (const frame of pending) {
      const result = this.simulate(frame.delta, frame.keys, pos, vel);
      pos = result.position;
      vel = result.velocity;
      // Update stored result so future reconciliations are accurate
      frame.resultPosition = cloneVec3(pos);
      frame.resultVelocity = cloneVec3(vel);
    }

    this.position = pos;
    this.velocity = vel;
  }

  private pruneUpTo(seq: number): void {
    for (const k of this.buffer.keys()) {
      if (k <= seq) this.buffer.delete(k);
    }
  }

  /** Reset state (e.g. on respawn / room change). */
  reset(position: Vec3 = { x: 0, y: 0, z: 0 }): void {
    this.buffer.clear();
    this.sequence = 0;
    this.position = cloneVec3(position);
    this.velocity = { x: 0, y: 0, z: 0 };
    this.reconciliations = 0;
    this.lastReplayFrames = 0;
  }

  /** Current sequence number (last predicted frame). */
  get currentSequence(): number {
    return this.sequence;
  }

  /** Number of unacknowledged frames in the buffer. */
  get pendingFrames(): number {
    return this.buffer.size;
  }
}
