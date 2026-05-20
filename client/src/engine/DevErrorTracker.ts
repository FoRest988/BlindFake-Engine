interface DevErrorContext {
  projectId?: string;
  projectName?: string;
  template?: string;
}

interface DevErrorPayload {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
  source?: string;
  timestamp: number;
  context?: DevErrorContext;
}

const STORAGE_KEY = 'blindfake.devErrorQueue';
const MAX_QUEUE = 200;

let context: DevErrorContext = {};
let queue: DevErrorPayload[] = [];
let initialized = false;
let flushTimer: number | null = null;

function loadQueue(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DevErrorPayload[];
    if (Array.isArray(parsed)) queue = parsed.slice(-MAX_QUEUE);
  } catch {
    queue = [];
  }
}

function saveQueue(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    // Ignore storage failures in private mode or quota limits.
  }
}

function enqueue(payload: DevErrorPayload): void {
  queue.push(payload);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  saveQueue();
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, 1000);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;

  const pending = [...queue];
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    try {
      const resp = await fetch('/api/dev-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      });
      if (!resp.ok) break;
      queue.shift();
      saveQueue();
    } catch {
      break;
    }
  }
}

function buildPayload(level: 'error' | 'warn', message: string, stack?: string, source?: string): DevErrorPayload {
  return {
    level,
    message: message.substring(0, 4000),
    stack: stack?.substring(0, 12000),
    source,
    timestamp: Date.now(),
    context,
  };
}

export function setDevErrorTrackerContext(nextContext: DevErrorContext): void {
  context = { ...context, ...nextContext };
}

export function reportDevError(error: unknown, source?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  enqueue(buildPayload('error', message, stack, source));
}

export function initDevErrorTracker(): void {
  if (initialized) return;
  initialized = true;

  loadQueue();

  window.addEventListener('error', (e) => {
    const msg = `${e.message} (${e.filename}:${e.lineno}:${e.colno})`;
    const stack = e.error instanceof Error ? e.error.stack : undefined;
    enqueue(buildPayload('error', msg, stack, 'window.error'));
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
    enqueue(buildPayload('error', `Unhandled Promise: ${reason.message}`, reason.stack, 'window.unhandledrejection'));
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
    enqueue(buildPayload('error', message, undefined, 'console.error'));
  };

  window.addEventListener('online', () => {
    void flushQueue();
  });

  window.addEventListener('beforeunload', () => {
    void flushQueue();
  });

  void flushQueue();
}
