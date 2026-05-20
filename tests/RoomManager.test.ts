import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomManager } from '../client/src/network/RoomManager';
import { MessageType } from '../shared/types';
import type { RoomInfo, RoomUpdatePayload } from '../shared/types';

// ── Minimal NetworkManager stub ──────────────────────────────────
function makeNetStub() {
  const handlers = new Map<string, Array<(msg: any) => void>>();
  const sentMessages: any[] = [];

  const net = {
    playerId: 'player-1',
    on: vi.fn((type: string, handler: (msg: any) => void) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type)!.push(handler);
    }),
    send: vi.fn((type: string, payload: any) => {
      sentMessages.push({ type, payload });
    }),
    // Helper to simulate an incoming message
    _emit(type: string, payload: any) {
      const hs = handlers.get(type) ?? [];
      for (const h of hs) h({ type, payload });
    },
    _sent: sentMessages,
  };
  return net;
}

const dummyRoom: RoomInfo = {
  id: 'room-99',
  name: 'Test Arena',
  hostId: 'player-1',
  playerCount: 1,
  maxPlayers: 4,
  level: 'level1',
  mode: 'pvp',
};

describe('RoomManager', () => {
  let net: ReturnType<typeof makeNetStub>;
  let rooms: RoomManager;

  beforeEach(() => {
    net = makeNetStub();
    rooms = new RoomManager(net as any);
  });

  it('registers handlers for ROOM_UPDATE and ROOM_LIST on construction', () => {
    expect(net.on).toHaveBeenCalledWith(MessageType.ROOM_UPDATE, expect.any(Function));
    expect(net.on).toHaveBeenCalledWith(MessageType.ROOM_LIST, expect.any(Function));
  });

  it('createRoom() sends CREATE_ROOM via network', () => {
    rooms.createRoom({ name: 'Arena', maxPlayers: 4, level: 'lvl1', mode: 'pvp' });
    expect(net._sent[0].type).toBe(MessageType.CREATE_ROOM);
    expect(net._sent[0].payload.name).toBe('Arena');
  });

  it('joinRoom() sends JOIN_ROOM with roomId and optional password', () => {
    rooms.joinRoom('room-1', 'pw123');
    expect(net._sent[0].type).toBe(MessageType.JOIN_ROOM);
    expect(net._sent[0].payload.roomId).toBe('room-1');
    expect(net._sent[0].payload.password).toBe('pw123');
  });

  it('leaveRoom() does nothing if not in a room', () => {
    rooms.leaveRoom();
    expect(net._sent).toHaveLength(0);
  });

  it('leaveRoom() sends LEAVE_ROOM and clears current room', () => {
    // Simulate joining a room
    const payload: RoomUpdatePayload = {
      room: dummyRoom,
      players: [{ id: 'player-1', name: 'Alice', ready: false }],
      event: 'player_joined',
    };
    net._emit(MessageType.ROOM_UPDATE, payload);

    rooms.leaveRoom();
    expect(net._sent[0].type).toBe(MessageType.LEAVE_ROOM);
    expect(rooms.currentRoom).toBeNull();
    expect(rooms.currentPlayers).toHaveLength(0);
  });

  it('requestRoomList() sends ROOM_LIST message', () => {
    rooms.requestRoomList();
    expect(net._sent[0].type).toBe(MessageType.ROOM_LIST);
  });

  it('ROOM_UPDATE message updates currentRoom and currentPlayers', () => {
    const payload: RoomUpdatePayload = {
      room: dummyRoom,
      players: [{ id: 'player-1', name: 'Alice', ready: true }],
      event: 'updated',
    };
    net._emit(MessageType.ROOM_UPDATE, payload);
    expect(rooms.currentRoom?.id).toBe('room-99');
    expect(rooms.currentPlayers).toHaveLength(1);
    expect(rooms.inRoom).toBe(true);
  });

  it('ROOM_UPDATE with room_closed clears currentRoom', () => {
    net._emit(MessageType.ROOM_UPDATE, {
      room: dummyRoom,
      players: [],
      event: 'player_joined',
    } as RoomUpdatePayload);

    net._emit(MessageType.ROOM_UPDATE, {
      room: dummyRoom,
      players: [],
      event: 'room_closed',
    } as RoomUpdatePayload);

    expect(rooms.currentRoom).toBeNull();
    expect(rooms.inRoom).toBe(false);
  });

  it('ROOM_UPDATE with game_started fires onGameStart callback', () => {
    const onGameStart = vi.fn();
    rooms.onGameStart = onGameStart;
    net._emit(MessageType.ROOM_UPDATE, {
      room: dummyRoom,
      players: [],
      event: 'game_started',
    } as RoomUpdatePayload);
    expect(onGameStart).toHaveBeenCalledOnce();
  });

  it('ROOM_LIST message updates roomList and fires onRoomList', () => {
    const onRoomList = vi.fn();
    rooms.onRoomList = onRoomList;
    net._emit(MessageType.ROOM_LIST, { rooms: [dummyRoom] });
    expect(rooms.roomList).toHaveLength(1);
    expect(onRoomList).toHaveBeenCalledWith([dummyRoom]);
  });

  it('isHost returns true when playerId matches room hostId', () => {
    net._emit(MessageType.ROOM_UPDATE, {
      room: dummyRoom, // hostId = 'player-1'
      players: [],
      event: 'updated',
    } as RoomUpdatePayload);
    expect(rooms.isHost).toBe(true);
  });

  it('isHost returns false when not the host', () => {
    net._emit(MessageType.ROOM_UPDATE, {
      room: { ...dummyRoom, hostId: 'player-99' },
      players: [],
      event: 'updated',
    } as RoomUpdatePayload);
    expect(rooms.isHost).toBe(false);
  });
});
