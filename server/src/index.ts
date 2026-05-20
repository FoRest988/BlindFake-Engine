import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import {
  MessageType,
  GAME_CONFIG,
  type NetworkMessage,
  type HandshakePayload,
  type RoomInfo,
} from '../../shared/types.js';

// --- Player ---
interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  roomId: string | null;
  state: any;
  lastActivity: number;
}

// --- Room ---
interface Room {
  id: string;
  name: string;
  hostId: string;
  players: Map<string, Player>;
  maxPlayers: number;
  level: string;
  mode: 'story_coop' | 'pvp' | 'explore';
}

// --- Server State ---
const players = new Map<string, Player>();
const rooms = new Map<string, Room>();

// --- Express + WebSocket ---
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const workspaceRoot = path.basename(process.cwd()).toLowerCase() === 'server'
  ? path.resolve(process.cwd(), '..')
  : process.cwd();
const errorLogDir = path.join(workspaceRoot, 'error-logs');

app.use(express.json());

// Cross-Origin isolation headers — required for SharedArrayBuffer (Web Workers physics)
// credentialless is safer than require-corp for engines loading assets from CDNs
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    players: players.size,
    rooms: rooms.size,
    uptime: process.uptime(),
  });
});

// Room list API
app.get('/api/rooms', (_req, res) => {
  const roomList: RoomInfo[] = [];
  for (const room of rooms.values()) {
    roomList.push({
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      level: room.level,
      mode: room.mode,
    });
  }
  res.json(roomList);
});

// Local dev error tracker ingestion
app.post('/api/dev-errors', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const level = typeof body.level === 'string' ? body.level : 'error';
    const message = typeof body.message === 'string' ? body.message : 'Unknown client error';
    const stack = typeof body.stack === 'string' ? body.stack : undefined;
    const source = typeof body.source === 'string' ? body.source : undefined;
    const timestamp = typeof body.timestamp === 'number' && Number.isFinite(body.timestamp)
      ? body.timestamp
      : Date.now();
    const context = (typeof body.context === 'object' && body.context) ? body.context : undefined;

    const entry = {
      level: sanitize(level).substring(0, 16),
      message: message.substring(0, 4000),
      stack: stack?.substring(0, 12000),
      source: source?.substring(0, 512),
      timestamp,
      context,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').toString().substring(0, 512),
      receivedAt: new Date().toISOString(),
    };

    await fs.mkdir(errorLogDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(errorLogDir, `${date}.ndjson`);
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');

    res.status(202).json({ ok: true });
  } catch (err) {
    console.error('[DevErrorTracker] Failed to persist error:', err);
    res.status(500).json({ ok: false });
  }
});

// --- WebSocket Handling ---
wss.on('connection', (ws: WebSocket) => {
  let player: Player | null = null;

  ws.on('message', (raw) => {
    let msg: NetworkMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case MessageType.HANDSHAKE: {
        const payload = msg.payload as HandshakePayload;

        // Version check
        if (payload.version !== GAME_CONFIG.VERSION) {
          sendTo(ws, MessageType.HANDSHAKE_ACK, {
            error: 'Version mismatch',
          });
          ws.close();
          return;
        }

        const id = uuid();
        player = {
          id,
          name: sanitize(payload.playerName),
          ws,
          roomId: null,
          state: {},
          lastActivity: Date.now(),
        };
        players.set(id, player);

        sendTo(ws, MessageType.HANDSHAKE_ACK, {
          playerId: id,
          serverTime: Date.now(),
        });

        console.log(`[+] Player connected: ${player.name} (${id})`);
        break;
      }

      case MessageType.PING: {
        sendTo(ws, MessageType.PONG, { time: msg.payload.time });
        if (player) player.lastActivity = Date.now();
        break;
      }

      case MessageType.CREATE_ROOM: {
        if (!player) return;
        const roomId = uuid();
        const room: Room = {
          id: roomId,
          name: sanitize(msg.payload.name ?? `${player.name}'s Room`),
          hostId: player.id,
          players: new Map(),
          maxPlayers: Math.min(msg.payload.maxPlayers ?? 8, GAME_CONFIG.MAX_PLAYERS_PER_ROOM),
          level: sanitize(msg.payload.level ?? 'default'),
          mode: msg.payload.mode ?? 'story_coop',
        };
        room.players.set(player.id, player);
        player.roomId = roomId;
        rooms.set(roomId, room);

        sendTo(ws, MessageType.ROOM_UPDATE, getRoomInfo(room));
        console.log(`[Room] Created: ${room.name} (${roomId})`);
        break;
      }

      case MessageType.JOIN_ROOM: {
        if (!player) return;
        const room = rooms.get(msg.payload.roomId);
        if (!room) {
          sendTo(ws, MessageType.ROOM_UPDATE, { error: 'Room not found' });
          return;
        }
        if (room.players.size >= room.maxPlayers) {
          sendTo(ws, MessageType.ROOM_UPDATE, { error: 'Room full' });
          return;
        }

        // Leave current room if any
        leaveRoom(player);

        room.players.set(player.id, player);
        player.roomId = room.id;

        // Notify all in room
        broadcastToRoom(room, MessageType.PLAYER_JOIN, {
          playerId: player.id,
          playerName: player.name,
        });
        sendTo(ws, MessageType.ROOM_UPDATE, getRoomInfo(room));
        break;
      }

      case MessageType.LEAVE_ROOM: {
        if (!player) return;
        leaveRoom(player);
        break;
      }

      case MessageType.PLAYER_STATE: {
        if (!player || !player.roomId) return;
        player.state = msg.payload;
        player.lastActivity = Date.now();

        // Broadcast to other players in room
        const room = rooms.get(player.roomId);
        if (room) {
          broadcastToRoomExcept(room, player.id, MessageType.PLAYER_STATE, {
            ...msg.payload,
            playerId: player.id,
          });
        }
        break;
      }

      case MessageType.PLAYER_ACTION: {
        if (!player || !player.roomId) return;
        const room = rooms.get(player.roomId);
        if (room) {
          broadcastToRoomExcept(room, player.id, MessageType.PLAYER_ACTION, {
            ...msg.payload,
            playerId: player.id,
          });
        }
        break;
      }

      case MessageType.CHAT_MESSAGE: {
        if (!player) return;
        const chatPayload = {
          senderId: player.id,
          senderName: player.name,
          message: sanitize(msg.payload.message ?? '').substring(0, 500),
          channel: msg.payload.channel ?? 'room',
        };

        if (chatPayload.channel === 'room' && player.roomId) {
          const room = rooms.get(player.roomId);
          if (room) {
            broadcastToRoom(room, MessageType.CHAT_MESSAGE, chatPayload);
          }
        }
        break;
      }

      case MessageType.ROOM_LIST: {
        const roomList: RoomInfo[] = [];
        for (const r of rooms.values()) {
          roomList.push(getRoomInfo(r));
        }
        sendTo(ws, MessageType.ROOM_LIST, roomList);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (player) {
      leaveRoom(player);
      players.delete(player.id);
      console.log(`[-] Player disconnected: ${player.name} (${player.id})`);
    }
  });
});

// --- Helpers ---

function sendTo(ws: WebSocket, type: MessageType, payload: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    const msg: NetworkMessage = { type, timestamp: Date.now(), payload };
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(room: Room, type: MessageType, payload: any): void {
  for (const p of room.players.values()) {
    sendTo(p.ws, type, payload);
  }
}

function broadcastToRoomExcept(room: Room, excludeId: string, type: MessageType, payload: any): void {
  for (const p of room.players.values()) {
    if (p.id !== excludeId) {
      sendTo(p.ws, type, payload);
    }
  }
}

function leaveRoom(player: Player): void {
  if (!player.roomId) return;
  const room = rooms.get(player.roomId);
  if (!room) return;

  room.players.delete(player.id);
  player.roomId = null;

  // Notify remaining
  broadcastToRoom(room, MessageType.PLAYER_LEAVE, {
    playerId: player.id,
    playerName: player.name,
  });

  // Delete empty rooms or transfer host
  if (room.players.size === 0) {
    rooms.delete(room.id);
    console.log(`[Room] Deleted empty room: ${room.name}`);
  } else if (room.hostId === player.id) {
    // Transfer host to first remaining player
    const newHost = room.players.values().next().value;
    if (newHost) {
      room.hostId = newHost.id;
      broadcastToRoom(room, MessageType.ROOM_UPDATE, getRoomInfo(room));
    }
  }
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

function sanitize(input: string): string {
  return input.replace(/[<>&"']/g, '').trim();
}

// --- Inactive player cleanup ---
setInterval(() => {
  const timeout = 60000; // 60 seconds
  const now = Date.now();
  for (const [id, player] of players) {
    if (now - player.lastActivity > timeout) {
      console.log(`[!] Kicking inactive player: ${player.name}`);
      player.ws.close();
      leaveRoom(player);
      players.delete(id);
    }
  }
}, 30000);

// --- Start ---
const PORT = parseInt(process.env.PORT ?? '4000', 10);
httpServer.listen(PORT, () => {
  console.log(`\n  🎮 BlindFake Server running on http://localhost:${PORT}`);
  console.log(`  📡 WebSocket on ws://localhost:${PORT}/ws\n`);
});
