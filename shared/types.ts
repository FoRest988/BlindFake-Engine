// === Shared Types between Client & Server ===

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

// --- Network Message Types ---

export enum MessageType {
  // Connection
  HANDSHAKE = 'handshake',
  HANDSHAKE_ACK = 'handshake_ack',
  PING = 'ping',
  PONG = 'pong',

  // Lobby
  CREATE_ROOM = 'create_room',
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  ROOM_UPDATE = 'room_update',
  ROOM_LIST = 'room_list',

  // Game State
  PLAYER_JOIN = 'player_join',
  PLAYER_LEAVE = 'player_leave',
  PLAYER_STATE = 'player_state',
  ENTITY_SPAWN = 'entity_spawn',
  ENTITY_DESTROY = 'entity_destroy',
  ENTITY_UPDATE = 'entity_update',

  // Actions
  PLAYER_ACTION = 'player_action',
  PLAYER_INPUT = 'player_input',
  CHAT_MESSAGE = 'chat_message',

  // World
  WORLD_STATE = 'world_state',
  LEVEL_LOAD = 'level_load',

  // Errors (server -> client)
  ERROR = 'error',
}

export interface NetworkMessage {
  type: MessageType;
  timestamp: number;
  payload: any;
}

export interface HandshakePayload {
  playerName: string;
  version: string;
}

export interface HandshakeAckPayload {
  playerId: string;
  serverTime: number;
}

export interface PlayerStatePayload {
  playerId: string;
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  animation: string;
  health: number;
}

export interface EntitySpawnPayload {
  entityId: string;
  type: string;
  position: Vec3;
  rotation: Quat;
  data?: Record<string, unknown>;
}

export interface EntityUpdatePayload {
  entityId: string;
  position?: Vec3;
  rotation?: Quat;
  data?: Record<string, unknown>;
}

export interface RoomInfo {
  id: string;
  name: string;
  hostId: string;
  playerCount: number;
  maxPlayers: number;
  level: string;
  mode: 'story_coop' | 'pvp' | 'explore';
}

export interface ChatMessagePayload {
  senderId: string;
  senderName: string;
  message: string;
  channel: 'global' | 'room' | 'whisper';
}

export interface CreateRoomPayload {
  name: string;
  maxPlayers: number;
  level: string;
  mode: RoomInfo['mode'];
  password?: string;
}

export interface JoinRoomPayload {
  roomId: string;
  password?: string;
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface RoomUpdatePayload {
  room: RoomInfo;
  players: Array<{ id: string; name: string; ready: boolean }>;
  event: 'player_joined' | 'player_left' | 'room_closed' | 'game_started' | 'updated';
}

export interface RoomListPayload {
  rooms: RoomInfo[];
}

export type ErrorCode =
  | 'version_mismatch'
  | 'bad_payload'
  | 'already_handshaken'
  | 'not_handshaken'
  | 'room_not_found'
  | 'room_full'
  | 'rate_limited';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

export interface PingPayload {
  time: number;
}

export interface WorldStatePayload {
  tick: number;
  serverTime: number;
  entities: EntitySnapshotPayload[];
}

export interface EntitySnapshotPayload {
  entityId: string;
  type: string;
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  data?: Record<string, unknown>;
  tick: number;
}

/** A locally-applied input frame used for client-side prediction & reconciliation. */
export interface PredictedInput {
  sequence: number;
  delta: number;
  keys: { forward: boolean; back: boolean; left: boolean; right: boolean; jump: boolean };
  resultPosition: Vec3;
  resultVelocity: Vec3;
}

/** Sent to server each tick to allow server-side authoritative simulation. */
export interface PlayerInputPayload {
  sequence: number;
  delta: number;
  keys: PredictedInput['keys'];
}

// --- Game Config ---

export const GAME_CONFIG = {
  VERSION: '0.2.0',
  TICK_RATE: 20,            // Server updates per second
  MAX_PLAYERS_PER_ROOM: 8,
  PLAYER_MOVE_SPEED: 8,
  PLAYER_JUMP_FORCE: 12,
  PLAYER_MAX_HEALTH: 100,
  NETWORK_INTERPOLATION_DELAY: 0.1, // 100ms interpolation buffer
  PREDICTION_BUFFER_SIZE: 64,       // Max unacknowledged input frames stored
  RECONCILE_THRESHOLD: 0.05,        // Metres; snap if mismatch exceeds this
} as const;
