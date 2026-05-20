/**
 * WorkerManager — Manages web workers for offloading heavy tasks
 * (pathfinding, physics, procedural generation, asset processing).
 * Provides a simple promise-based API and worker pooling.
 */

export interface WorkerTask<T = unknown> {
  id: number;
  type: string;
  data: unknown;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  startTime: number;
}

export interface WorkerMessage {
  id: number;
  type: string;
  data: unknown;
}

export interface WorkerResponse {
  id: number;
  data?: unknown;
  error?: string;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private busy: boolean[] = [];
  private queued: WorkerTask[] = [];
  private activeTasks = new Map<number, WorkerTask>();
  private taskIdCounter = 0;

  constructor(private scriptUrl: string | URL, poolSize: number = navigator.hardwareConcurrency || 4) {
    const size = Math.max(1, Math.min(poolSize, 16));
    for (let i = 0; i < size; i++) {
      const worker = new Worker(scriptUrl, { type: 'module' });
      worker.onmessage = (e) => this.onMessage(i, e.data);
      worker.onerror = (err) => this.onError(i, err);
      this.workers.push(worker);
      this.busy.push(false);
    }
  }

  /** Post a task to the pool, returns a promise */
  post<T = unknown>(type: string, data: unknown, transfer?: Transferable[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: WorkerTask<T> = {
        id: ++this.taskIdCounter,
        type,
        data,
        resolve,
        reject,
        startTime: performance.now(),
      };

      // Find a free worker
      const freeIdx = this.busy.indexOf(false);
      if (freeIdx >= 0) {
        this.dispatch(freeIdx, task as WorkerTask, transfer);
      } else {
        this.queued.push(task as WorkerTask);
      }
    });
  }

  private dispatch(workerIdx: number, task: WorkerTask, transfer?: Transferable[]): void {
    this.busy[workerIdx] = true;
    this.activeTasks.set(task.id, task);
    const msg: WorkerMessage = { id: task.id, type: task.type, data: task.data };
    if (transfer && transfer.length > 0) {
      this.workers[workerIdx].postMessage(msg, transfer);
    } else {
      this.workers[workerIdx].postMessage(msg);
    }
  }

  private onMessage(workerIdx: number, response: WorkerResponse): void {
    const task = this.activeTasks.get(response.id);
    if (task) {
      this.activeTasks.delete(response.id);
      if (response.error) {
        task.reject(new Error(response.error));
      } else {
        task.resolve(response.data);
      }
    }

    this.busy[workerIdx] = false;

    // Check for queued work
    if (this.queued.length > 0) {
      const next = this.queued.shift()!;
      this.dispatch(workerIdx, next);
    }
  }

  private onError(workerIdx: number, err: ErrorEvent): void {
    console.error(`[WorkerPool] Worker ${workerIdx} error:`, err.message);
    this.busy[workerIdx] = false;

    // Process next in queue
    if (this.queued.length > 0) {
      const next = this.queued.shift()!;
      this.dispatch(workerIdx, next);
    }
  }

  /** Kill all workers */
  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.busy.length = 0;
    for (const task of this.activeTasks.values()) {
      task.reject(new Error('WorkerPool terminated'));
    }
    this.activeTasks.clear();
    for (const task of this.queued) {
      task.reject(new Error('WorkerPool terminated'));
    }
    this.queued.length = 0;
  }

  get pendingCount(): number {
    return this.activeTasks.size + this.queued.length;
  }

  get poolSize(): number {
    return this.workers.length;
  }
}

/**
 * WorkerManager — High-level API that manages named worker pools
 * and provides inline-worker creation from functions.
 */
export class WorkerManager {
  private pools = new Map<string, WorkerPool>();

  /** Register a worker pool from a script URL */
  register(name: string, scriptUrl: string | URL, poolSize?: number): WorkerPool {
    if (this.pools.has(name)) {
      console.warn(`[WorkerManager] Pool '${name}' already exists, returning existing`);
      return this.pools.get(name)!;
    }
    const pool = new WorkerPool(scriptUrl, poolSize);
    this.pools.set(name, pool);
    return pool;
  }

  /** Create a worker pool from an inline function (wraps in a Blob URL) */
  registerInline(name: string, handler: string, poolSize?: number): WorkerPool {
    // handler should be a string of JS code that sets up self.onmessage
    const workerCode = `
      self.onmessage = function(e) {
        const { id, type, data } = e.data;
        try {
          const handler = (${handler});
          const result = handler(type, data);
          if (result instanceof Promise) {
            result.then(r => self.postMessage({ id, data: r }))
                  .catch(err => self.postMessage({ id, error: err.message }));
          } else {
            self.postMessage({ id, data: result });
          }
        } catch (err) {
          self.postMessage({ id, error: err.message });
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const pool = this.register(name, url, poolSize);
    return pool;
  }

  /** Get a pool by name */
  get(name: string): WorkerPool | undefined {
    return this.pools.get(name);
  }

  /** Post a task to a named pool */
  async post<T = unknown>(poolName: string, type: string, data: unknown): Promise<T> {
    const pool = this.pools.get(poolName);
    if (!pool) throw new Error(`[WorkerManager] Pool '${poolName}' not found`);
    return pool.post<T>(type, data);
  }

  /** Terminate a specific pool */
  terminatePool(name: string): void {
    const pool = this.pools.get(name);
    if (pool) {
      pool.terminate();
      this.pools.delete(name);
    }
  }

  /** Terminate all pools */
  dispose(): void {
    for (const [, pool] of this.pools) {
      pool.terminate();
    }
    this.pools.clear();
  }

  /** Get stats */
  getStats(): { name: string; pending: number; size: number }[] {
    const stats: { name: string; pending: number; size: number }[] = [];
    for (const [name, pool] of this.pools) {
      stats.push({ name, pending: pool.pendingCount, size: pool.poolSize });
    }
    return stats;
  }
}
