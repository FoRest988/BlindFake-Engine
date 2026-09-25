import {
  MessageType,
  type NetworkMessage,
  type HandshakePayload,
  type PlayerStatePayload,
  type PlayerInputPayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type ErrorPayload,
  GAME_CONFIG,
} from '@shared/types';

type MessageHandler = (message: NetworkMessage) => void;

export interface NetworkManagerOptions {
  /** WebSocket URL. Defaults to `/ws` on the current origin (goes through the Vite proxy in dev). */
  serverUrl?: string;
  pingIntervalMs?: number;
  /** Seconds without a PONG before the connection is considered dead. */
  pongTimeoutS?: number;
  maxReconnectAttempts?: number;
  /** First reconnect delay; doubles on every attempt up to 10x. */
  reconnectBaseDelayMs?: number;
  /** Give up on connect() after this long without a HANDSHAKE_ACK. */
  connectTimeoutMs?: number;
}

export class NetworkManagerError extends Error {
  constructor(message: string, public readonly code: ErrorPayload['code'] | 'closed' | 'timeout') {
    super(message);
    this.name = 'NetworkManagerError';
  }
}

export function defaultServerUrl(): string {
  if (typeof location !== 'undefined' && location.host) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }
  return 'ws://localhost:4000/ws';
}

/**
 * WebSocket client for the room server.
 *
 * Lifecycle: connect() resolves with the player id once the server ACKs the
 * handshake and rejects on error, close or timeout. Unexpected closes trigger
 * exponential-backoff reconnects (a single path: the socket's close handler),
 * up to maxReconnectAttempts; disconnect() suppresses them.
 */
export class NetworkManager {
  private ws: WebSocket | null = null;
  private readonly serverUrl: string;
  private readonly handlers = new Map<MessageType, MessageHandler[]>();
  private connected = false;
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private timeSinceLastPong = 0;
  private lastPlayerName = '';

  private readonly pingIntervalMs: number;
  private readonly pongTimeoutS: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly connectTimeoutMs: number;

  public playerId: string | null = null;
  public latency = 0;

  /** Invoked when a reconnect attempt is scheduled (attempt number, delay in ms). */
  public onReconnectScheduled: ((attempt: number, delayMs: number) => void) | null = null;
  /** Invoked when reconnecting has been given up. */
  public onReconnectFailed: (() => void) | null = null;

  constructor(options: NetworkManagerOptions | string = {}) {
    const opts = typeof options === 'string' ? { serverUrl: options } : options;
    this.serverUrl = opts.serverUrl ?? defaultServerUrl();
    this.pingIntervalMs = opts.pingIntervalMs ?? 2000;
    this.pongTimeoutS = opts.pongTimeoutS ?? 10;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 5;
    this.reconnectBaseDelayMs = opts.reconnectBaseDelayMs ?? 1000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get reconnectAttemptCount(): number {
    return this.reconnectAttempts;
  }

  connect(playerName: string): Promise<string> {
    this.lastPlayerName = playerName;
    this.intentionalClose = false;
    this.timeSinceLastPong = 0;
    this.cleanupSocket();

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timeout); fn(); } };
      const timeout = setTimeout(() => {
        settle(() => reject(new NetworkManagerError('Timed out waiting for the server handshake', 'timeout')));
        this.ws?.close();
      }, this.connectTimeoutMs);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.serverUrl);
      } catch (err) {
        settle(() => reject(err));
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.send(MessageType.HANDSHAKE, { playerName, version: GAME_CONFIG.VERSION } satisfies HandshakePayload);
      };

      ws.onmessage = (event) => {
        let msg: NetworkMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === MessageType.HANDSHAKE_ACK) {
          this.playerId = String(msg.payload?.playerId ?? '');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.startPing();
          settle(() => resolve(this.playerId!));
        } else if (msg.type === MessageType.ERROR && !settled) {
          const err = msg.payload as ErrorPayload;
          settle(() => reject(new NetworkManagerError(err?.message ?? 'Server rejected the connection', err?.code ?? 'bad_payload')));
          this.intentionalClose = true; // a rejected handshake is final, do not retry
          ws.close();
          return;
        } else if (msg.type === MessageType.PONG) {
          this.timeSinceLastPong = 0;
          const sent = Number(msg.payload?.time);
          if (Number.isFinite(sent)) this.latency = Date.now() - sent;
        }

        this.dispatch(msg);
      };

      let closeHandled = false;
      const handleClose = () => {
        if (closeHandled) return;
        closeHandled = true;
        // Detach first: closing a CONNECTING socket re-fires 'error' synchronously in some runtimes.
        ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
        if (ws.readyState !== WebSocket.CLOSED) { try { ws.close(); } catch { /* already closing */ } }
        this.connected = false;
        this.stopPing();
        if (this.ws === ws) this.ws = null;
        settle(() => reject(new NetworkManagerError('Connection closed before the handshake completed', 'closed')));
        if (!this.intentionalClose) this.scheduleReconnect();
      };

      ws.onclose = handleClose;
      // Browsers fire 'close' right after 'error'; Node's WebSocket fires only 'error' on a refused
      // connection (readyState stays CONNECTING), so treat an error as a close (handleClose is idempotent).
      ws.onerror = handleClose;
    });
  }

  on(type: MessageType, handler: MessageHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  off(type: MessageType, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  /** Send a message; returns false (and drops it) when the socket is not open. */
  send(type: MessageType, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const message: NetworkMessage = { type, timestamp: Date.now(), payload };
    this.ws.send(JSON.stringify(message));
    return true;
  }

  sendPlayerState(state: PlayerStatePayload): void {
    this.send(MessageType.PLAYER_STATE, state);
  }

  /** Send a client-prediction input frame (consumed by the authoritative server from rework F9). */
  sendPlayerInput(input: PlayerInputPayload): void {
    this.send(MessageType.PLAYER_INPUT, input);
  }

  // ── Room Management ─────────────────────────────────────────────

  createRoom(options: Partial<CreateRoomPayload> = {}): void {
    this.send(MessageType.CREATE_ROOM, options);
  }

  joinRoom(roomId: string, password?: string): void {
    this.send(MessageType.JOIN_ROOM, { roomId, password } satisfies JoinRoomPayload);
  }

  leaveRoom(): void {
    this.send(MessageType.LEAVE_ROOM, {});
  }

  requestRoomList(): void {
    this.send(MessageType.ROOM_LIST, {});
  }

  sendChat(message: string, channel: 'room' = 'room'): void {
    this.send(MessageType.CHAT_MESSAGE, { message, channel });
  }

  /** Close the connection and stop reconnecting. A later connect() starts fresh. */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.reconnectAttempts = 0;
    this.cleanupSocket();
  }

  /** Call once per frame with the elapsed seconds; detects a dead server via missing PONGs. */
  update(delta: number): void {
    if (!this.connected) return;
    this.timeSinceLastPong += delta;
    if (this.timeSinceLastPong > this.pongTimeoutS) {
      // Closing the socket is enough: the close handler owns the reconnect.
      this.timeSinceLastPong = 0;
      this.ws?.close();
    }
  }

  private dispatch(msg: NetworkMessage): void {
    const handlers = this.handlers.get(msg.type);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[NetworkManager] handler error:', err);
      }
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      this.send(MessageType.PING, { time: Date.now() });
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private cleanupSocket(): void {
    this.stopPing();
    this.connected = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.lastPlayerName) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onReconnectFailed?.();
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1), this.reconnectBaseDelayMs * 10);
    this.onReconnectScheduled?.(this.reconnectAttempts, delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.lastPlayerName).catch(() => { /* close handler schedules the next attempt */ });
    }, delay);
  }
}
