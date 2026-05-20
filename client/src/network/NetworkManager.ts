import {
  MessageType,
  type NetworkMessage,
  type HandshakePayload,
  type PlayerStatePayload,
  type PlayerInputPayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  GAME_CONFIG,
} from '@shared/types';

type MessageHandler = (message: NetworkMessage) => void;

export class NetworkManager {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private handlers = new Map<MessageType, MessageHandler[]>();
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: number | null = null;
  private lastPongTime = 0;
  /** Accumulated time (seconds) since the last PONG was received. */
  private timeSinceLastPong = 0;
  /** Stored so update() can trigger reconnects without needing external input. */
  private lastPlayerName = '';

  private static readonly PONG_TIMEOUT_S = 10;

  public playerId: string | null = null;
  public latency = 0;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  connect(playerName: string): Promise<string> {
    this.lastPlayerName = playerName;
    this.timeSinceLastPong = 0;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.send(MessageType.HANDSHAKE, {
          playerName,
          version: GAME_CONFIG.VERSION,
        } satisfies HandshakePayload);

        // Start ping
        this.pingInterval = window.setInterval(() => {
          this.send(MessageType.PING, { time: Date.now() });
        }, 2000);
      };

      this.ws.onmessage = (event) => {
        let msg: NetworkMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        if (msg.type === MessageType.HANDSHAKE_ACK) {
          this.playerId = msg.payload.playerId;
          resolve(this.playerId!);
        }

        if (msg.type === MessageType.PONG) {
          this.lastPongTime = Date.now();
          this.timeSinceLastPong = 0;
          this.latency = Date.now() - msg.payload.time;
        }

        // Dispatch to handlers
        const handlers = this.handlers.get(msg.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(msg);
          }
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        if (this.pingInterval !== null) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.tryReconnect(playerName);
      };

      this.ws.onerror = () => {
        // onclose will fire after this
      };
    });
  }

  on(type: MessageType, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  off(type: MessageType, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  }

  send(type: MessageType, payload: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message: NetworkMessage = {
      type,
      timestamp: Date.now(),
      payload,
    };

    this.ws.send(JSON.stringify(message));
  }

  sendPlayerState(state: PlayerStatePayload): void {
    this.send(MessageType.PLAYER_STATE, state);
  }

  /**
   * Send a client-prediction input frame to the server for authoritative
   * simulation and reconciliation ACK.
   */
  sendPlayerInput(input: PlayerInputPayload): void {
    this.send(MessageType.PLAYER_INPUT, input);
  }

  // ── Room Management ─────────────────────────────────────────────

  /** Ask the server to create a new room. Response arrives as ROOM_UPDATE. */
  createRoom(options: CreateRoomPayload): void {
    this.send(MessageType.CREATE_ROOM, options satisfies CreateRoomPayload);
  }

  /** Join an existing room. Response arrives as ROOM_UPDATE. */
  joinRoom(roomId: string, password?: string): void {
    this.send(MessageType.JOIN_ROOM, { roomId, password } satisfies JoinRoomPayload);
  }

  /** Leave the current room. */
  leaveRoom(roomId: string): void {
    this.send(MessageType.LEAVE_ROOM, { roomId });
  }

  /** Request the current public room list from the server. */
  requestRoomList(): void {
    this.send(MessageType.ROOM_LIST, {});
  }

  get isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0; // Don't reconnect
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  update(delta: number): void {
    if (!this.connected) return;

    this.timeSinceLastPong += delta;
    if (this.timeSinceLastPong > NetworkManager.PONG_TIMEOUT_S) {
      // Server appears unreachable — close and attempt reconnect
      this.connected = false;
      this.timeSinceLastPong = 0;
      this.ws?.close();
      if (this.lastPlayerName) {
        this.tryReconnect(this.lastPlayerName);
      }
    }
  }

  private tryReconnect(playerName: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    setTimeout(() => {
      this.connect(playerName).catch(() => {});
    }, delay);
  }
}
