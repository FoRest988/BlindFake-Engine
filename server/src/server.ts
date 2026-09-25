import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import {
  MessageType,
  GAME_CONFIG,
  type ErrorCode,
  type NetworkMessage,
  type RoomInfo,
  type RoomListPayload,
  type RoomUpdatePayload,
} from '../../shared/types.js';
import {
  LIMITS,
  isChatPayload,
  isCreateRoomPayload,
  isHandshakePayload,
  isJoinRoomPayload,
  isPingPayload,
  isRecord,
  parseNetworkMessage,
  sanitizeText,
} from '../../shared/protocol.js';

export interface GameServerOptions {
  /** TCP port; 0 picks a free one (tests). Default 4000 or $PORT. */
  port?: number;
  /** Largest accepted WebSocket frame; bigger ones close the socket (1009). */
  maxPayloadBytes?: number;
  /** Sockets that never complete a handshake are closed after this delay. */
  handshakeTimeoutMs?: number;
  /** Players silent for longer than this are kicked. */
  inactivityTimeoutMs?: number;
  /** Accept POST /api/dev-errors and append to error-logs/ (development only). */
  devErrors?: boolean;
  /** Protocol version clients must present. */
  version?: string;
  /** Silence console output (tests). */
  quiet?: boolean;
}

export interface GameServer {
  app: express.Express;
  httpServer: HttpServer;
  wss: WebSocketServer;
  listen(): Promise<number>;
  close(): Promise<void>;
  /** Port after listen(). */
  readonly port: number;
  readonly playerCount: number;
  readonly roomCount: number;
}

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  roomId: string | null;
  state: unknown;
  lastActivity: number;
}

interface Room {
  id: string;
  name: string;
  hostId: string;
  players: Map<string, Player>;
  maxPlayers: number;
  level: string;
  mode: RoomInfo['mode'];
}

/**
 * Room/lobby relay server. Every incoming frame is validated before use and
 * every handler runs inside a try/catch, so a malformed message can only ever
 * cost the sender its connection, never the process.
 */
export function createGameServer(options: GameServerOptions = {}): GameServer {
  const port = options.port ?? parseInt(process.env.PORT ?? '4000', 10);
  const maxPayload = options.maxPayloadBytes ?? 64 * 1024;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000;
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? 60_000;
  const devErrors = options.devErrors ?? process.env.NODE_ENV !== 'production';
  const version = options.version ?? GAME_CONFIG.VERSION;
  const log = options.quiet ? () => {} : console.log;

  const players = new Map<string, Player>();
  const rooms = new Map<string, Room>();

  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload });

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', players: players.size, rooms: rooms.size, uptime: process.uptime() });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json([...rooms.values()].map(getRoomInfo));
  });

  if (devErrors) {
    const workspaceRoot = path.basename(process.cwd()).toLowerCase() === 'server'
      ? path.resolve(process.cwd(), '..')
      : process.cwd();
    const errorLogDir = path.join(workspaceRoot, 'error-logs');

    app.post('/api/dev-errors', async (req, res) => {
      try {
        const body = isRecord(req.body) ? req.body : {};
        const entry = {
          level: sanitizeText(body.level, 16) || 'error',
          message: sanitizeText(body.message, 4000) || 'Unknown client error',
          stack: typeof body.stack === 'string' ? body.stack.substring(0, 12000) : undefined,
          source: typeof body.source === 'string' ? body.source.substring(0, 512) : undefined,
          timestamp: typeof body.timestamp === 'number' && Number.isFinite(body.timestamp) ? body.timestamp : Date.now(),
          context: isRecord(body.context) ? body.context : undefined,
          ip: req.ip,
          userAgent: (req.headers['user-agent'] ?? '').toString().substring(0, 512),
          receivedAt: new Date().toISOString(),
        };
        await fs.mkdir(errorLogDir, { recursive: true });
        const date = new Date().toISOString().slice(0, 10);
        await fs.appendFile(path.join(errorLogDir, `${date}.ndjson`), JSON.stringify(entry) + '\n', 'utf8');
        res.status(202).json({ ok: true });
      } catch (err) {
        console.error('[DevErrorTracker] Failed to persist error:', err);
        res.status(500).json({ ok: false });
      }
    });
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  wss.on('error', (err) => { console.error('[ws] server error:', err); });

  wss.on('connection', (ws: WebSocket) => {
    let player: Player | null = null;
    const handshakeTimer = setTimeout(() => {
      if (!player) ws.close(4000, 'handshake timeout');
    }, handshakeTimeoutMs);

    ws.on('error', () => { /* 'close' follows; nothing else to do */ });

    ws.on('message', (raw) => {
      try {
        const msg = parseNetworkMessage(raw.toString());
        if (!msg) return;
        player = handleMessage(ws, player, msg);
        if (player) clearTimeout(handshakeTimer);
      } catch (err) {
        console.error('[ws] handler error:', err);
        sendError(ws, 'bad_payload', 'Malformed message');
      }
    });

    ws.on('close', () => {
      clearTimeout(handshakeTimer);
      if (player) {
        leaveRoom(player);
        players.delete(player.id);
        log(`[-] Player disconnected: ${player.name} (${player.id})`);
        player = null;
      }
    });
  });

  function handleMessage(ws: WebSocket, player: Player | null, msg: NetworkMessage): Player | null {
    switch (msg.type) {
      case MessageType.HANDSHAKE: {
        if (player) {
          sendError(ws, 'already_handshaken', 'Handshake already completed');
          return player;
        }
        if (!isHandshakePayload(msg.payload)) {
          sendError(ws, 'bad_payload', 'Handshake needs playerName and version');
          return null;
        }
        if (msg.payload.version !== version) {
          sendError(ws, 'version_mismatch', `Server runs protocol ${version}`);
          ws.close(4001, 'version mismatch');
          return null;
        }
        const id = uuid();
        const created: Player = {
          id,
          name: sanitizeText(msg.payload.playerName, LIMITS.PLAYER_NAME) || 'Player',
          ws,
          roomId: null,
          state: {},
          lastActivity: Date.now(),
        };
        players.set(id, created);
        sendTo(ws, MessageType.HANDSHAKE_ACK, { playerId: id, serverTime: Date.now() });
        log(`[+] Player connected: ${created.name} (${id})`);
        return created;
      }

      case MessageType.PING: {
        if (!isPingPayload(msg.payload)) return player;
        sendTo(ws, MessageType.PONG, { time: msg.payload.time });
        if (player) player.lastActivity = Date.now();
        return player;
      }
    }

    // Everything below requires a completed handshake.
    if (!player) {
      sendError(ws, 'not_handshaken', 'Send a handshake first');
      return null;
    }
    player.lastActivity = Date.now();

    switch (msg.type) {
      case MessageType.CREATE_ROOM: {
        if (!isCreateRoomPayload(msg.payload)) { sendError(ws, 'bad_payload', 'Invalid room options'); break; }
        const p = msg.payload ?? {};
        leaveRoom(player);
        const room: Room = {
          id: uuid(),
          name: sanitizeText(p.name, LIMITS.ROOM_NAME) || `${player.name}'s Room`,
          hostId: player.id,
          players: new Map(),
          maxPlayers: Math.min(Math.max(1, p.maxPlayers ?? GAME_CONFIG.MAX_PLAYERS_PER_ROOM), GAME_CONFIG.MAX_PLAYERS_PER_ROOM),
          level: sanitizeText(p.level, LIMITS.LEVEL_NAME) || 'default',
          mode: p.mode ?? 'story_coop',
        };
        room.players.set(player.id, player);
        player.roomId = room.id;
        rooms.set(room.id, room);
        sendTo(ws, MessageType.ROOM_UPDATE, roomUpdate(room, 'updated'));
        log(`[Room] Created: ${room.name} (${room.id})`);
        break;
      }

      case MessageType.JOIN_ROOM: {
        if (!isJoinRoomPayload(msg.payload)) { sendError(ws, 'bad_payload', 'Invalid join request'); break; }
        const room = rooms.get(msg.payload.roomId);
        if (!room) { sendError(ws, 'room_not_found', 'Room not found'); break; }
        if (room.players.has(player.id)) { sendTo(ws, MessageType.ROOM_UPDATE, roomUpdate(room, 'updated')); break; }
        if (room.players.size >= room.maxPlayers) { sendError(ws, 'room_full', 'Room full'); break; }
        leaveRoom(player);
        room.players.set(player.id, player);
        player.roomId = room.id;
        broadcastToRoom(room, MessageType.PLAYER_JOIN, { playerId: player.id, playerName: player.name });
        broadcastToRoom(room, MessageType.ROOM_UPDATE, roomUpdate(room, 'player_joined'));
        break;
      }

      case MessageType.LEAVE_ROOM:
        leaveRoom(player);
        break;

      case MessageType.PLAYER_STATE: {
        if (!player.roomId || !isRecord(msg.payload)) break;
        player.state = msg.payload;
        const room = rooms.get(player.roomId);
        if (room) broadcastToRoomExcept(room, player.id, MessageType.PLAYER_STATE, { ...msg.payload, playerId: player.id });
        break;
      }

      case MessageType.PLAYER_ACTION: {
        if (!player.roomId || !isRecord(msg.payload)) break;
        const room = rooms.get(player.roomId);
        if (room) broadcastToRoomExcept(room, player.id, MessageType.PLAYER_ACTION, { ...msg.payload, playerId: player.id });
        break;
      }

      case MessageType.CHAT_MESSAGE: {
        if (!isChatPayload(msg.payload)) { sendError(ws, 'bad_payload', 'Invalid chat message'); break; }
        const channel = msg.payload.channel ?? 'room';
        if (channel !== 'room' || !player.roomId) break;
        const room = rooms.get(player.roomId);
        if (!room) break;
        broadcastToRoom(room, MessageType.CHAT_MESSAGE, {
          senderId: player.id,
          senderName: player.name,
          message: sanitizeText(msg.payload.message, LIMITS.CHAT_MESSAGE),
          channel,
        });
        break;
      }

      case MessageType.ROOM_LIST: {
        const payload: RoomListPayload = { rooms: [...rooms.values()].map(getRoomInfo) };
        sendTo(ws, MessageType.ROOM_LIST, payload);
        break;
      }

      default:
        // Message types the relay does not handle (ENTITY_*, WORLD_STATE, PLAYER_INPUT...) are ignored.
        break;
    }
    return player;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function sendTo(ws: WebSocket, type: MessageType, payload: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const msg: NetworkMessage = { type, timestamp: Date.now(), payload };
    ws.send(JSON.stringify(msg));
  }

  function sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    sendTo(ws, MessageType.ERROR, { code, message });
  }

  function broadcastToRoom(room: Room, type: MessageType, payload: unknown): void {
    for (const p of room.players.values()) sendTo(p.ws, type, payload);
  }

  function broadcastToRoomExcept(room: Room, excludeId: string, type: MessageType, payload: unknown): void {
    for (const p of room.players.values()) if (p.id !== excludeId) sendTo(p.ws, type, payload);
  }

  function leaveRoom(player: Player): void {
    if (!player.roomId) return;
    const room = rooms.get(player.roomId);
    player.roomId = null;
    if (!room) return;
    room.players.delete(player.id);
    broadcastToRoom(room, MessageType.PLAYER_LEAVE, { playerId: player.id, playerName: player.name });
    if (room.players.size === 0) {
      rooms.delete(room.id);
      log(`[Room] Deleted empty room: ${room.name}`);
      return;
    }
    if (room.hostId === player.id) {
      const newHost = room.players.values().next().value;
      if (newHost) room.hostId = newHost.id;
    }
    broadcastToRoom(room, MessageType.ROOM_UPDATE, roomUpdate(room, 'player_left'));
  }

  function getRoomInfo(room: Room): RoomInfo {
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      level: room.level,
      mode: room.mode,
    };
  }

  function roomUpdate(room: Room, event: RoomUpdatePayload['event']): RoomUpdatePayload {
    return {
      room: getRoomInfo(room),
      players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, ready: false })),
      event,
    };
  }

  // ── Inactive player cleanup ────────────────────────────────────────────────
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, p] of players) {
      if (now - p.lastActivity > inactivityTimeoutMs) {
        log(`[!] Kicking inactive player: ${p.name}`);
        players.delete(id);
        leaveRoom(p);
        p.ws.close(4002, 'inactive');
      }
    }
  }, Math.max(1_000, Math.floor(inactivityTimeoutMs / 2)));
  sweep.unref();

  let boundPort = 0;
  return {
    app,
    httpServer,
    wss,
    get port() { return boundPort; },
    get playerCount() { return players.size; },
    get roomCount() { return rooms.size; },
    listen: () => new Promise<number>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, () => {
        boundPort = (httpServer.address() as AddressInfo).port;
        log(`\n  BlindFake server on http://localhost:${boundPort}  (ws://localhost:${boundPort}/ws)\n`);
        resolve(boundPort);
      });
    }),
    close: () => new Promise<void>((resolve) => {
      clearInterval(sweep);
      for (const client of wss.clients) client.terminate();
      wss.close(() => httpServer.close(() => resolve()));
    }),
  };
}
