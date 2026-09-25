/**
 * Runtime validation of network messages.
 *
 * `shared/types.ts` only describes the wire format at compile time. Anything a
 * peer sends must be checked here before a field is touched: a malformed
 * message used to crash the whole server process.
 */
import {
  MessageType,
  type ChatMessagePayload,
  type CreateRoomPayload,
  type HandshakePayload,
  type JoinRoomPayload,
  type NetworkMessage,
  type PingPayload,
  type RoomInfo,
} from './types.js';

export const LIMITS = {
  PLAYER_NAME: 32,
  ROOM_NAME: 64,
  LEVEL_NAME: 64,
  CHAT_MESSAGE: 500,
  PASSWORD: 64,
} as const;

const MESSAGE_TYPES = new Set<string>(Object.values(MessageType));
const ROOM_MODES = new Set<string>(['story_coop', 'pvp', 'explore']);
const CHAT_CHANNELS = new Set<string>(['global', 'room', 'whisper']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isOptionalString(value: unknown, max: number): value is string | undefined {
  return value === undefined || isString(value, max, 0);
}

/** Parse a raw frame into a NetworkMessage, or null when it is not one. */
export function parseNetworkMessage(raw: string): NetworkMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.type !== 'string' || !MESSAGE_TYPES.has(value.type)) return null;
  const timestamp = typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : Date.now();
  return { type: value.type as MessageType, timestamp, payload: value.payload };
}

export function isHandshakePayload(p: unknown): p is HandshakePayload {
  return isRecord(p) && isString(p.playerName, LIMITS.PLAYER_NAME) && isString(p.version, 32);
}

export function isPingPayload(p: unknown): p is PingPayload {
  return isRecord(p) && typeof p.time === 'number' && Number.isFinite(p.time);
}

/** CreateRoom fields are all optional on the wire; present ones must be well formed. */
export function isCreateRoomPayload(p: unknown): p is Partial<CreateRoomPayload> {
  if (p === undefined) return true;
  if (!isRecord(p)) return false;
  if (!isOptionalString(p.name, LIMITS.ROOM_NAME)) return false;
  if (p.maxPlayers !== undefined && !(Number.isInteger(p.maxPlayers) && (p.maxPlayers as number) >= 1)) return false;
  if (!isOptionalString(p.level, LIMITS.LEVEL_NAME)) return false;
  if (p.mode !== undefined && !(typeof p.mode === 'string' && ROOM_MODES.has(p.mode))) return false;
  if (!isOptionalString(p.password, LIMITS.PASSWORD)) return false;
  return true;
}

export function isJoinRoomPayload(p: unknown): p is JoinRoomPayload {
  return isRecord(p) && isString(p.roomId, 64) && isOptionalString(p.password, LIMITS.PASSWORD);
}

export function isChatPayload(p: unknown): p is Pick<ChatMessagePayload, 'message'> & { channel?: ChatMessagePayload['channel'] } {
  if (!isRecord(p) || !isString(p.message, LIMITS.CHAT_MESSAGE)) return false;
  return p.channel === undefined || (typeof p.channel === 'string' && CHAT_CHANNELS.has(p.channel));
}

export function isRoomMode(value: unknown): value is RoomInfo['mode'] {
  return typeof value === 'string' && ROOM_MODES.has(value);
}

/** Strip characters that would break HTML/JSON contexts and trim; never throws on non-strings. */
export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || ch === '<' || ch === '>' || ch === '&' || ch === '"' || ch === "'") continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}
