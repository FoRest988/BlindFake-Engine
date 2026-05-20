/**
 * RoomManager — High-level room state and lobby management.
 *
 * Wraps NetworkManager's raw messaging with a typed, event-driven interface
 * for creating/joining/leaving rooms and tracking connected players.
 *
 * Usage:
 *   const rooms = new RoomManager(networkManager);
 *   rooms.onRoomUpdate = (payload) => { ... };
 *   await rooms.createRoom({ name: 'My Game', maxPlayers: 4, level: 'level1', mode: 'pvp' });
 */

import {
  MessageType,
  type RoomInfo,
  type RoomUpdatePayload,
  type RoomListPayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type LeaveRoomPayload,
} from '@shared/types';
import { NetworkManager } from './NetworkManager';

export interface RoomPlayer {
  id: string;
  name: string;
  ready: boolean;
}

export class RoomManager {
  private net: NetworkManager;

  /** Currently joined room, or null if in lobby. */
  public currentRoom: RoomInfo | null = null;
  /** Players in the current room (including self). */
  public currentPlayers: RoomPlayer[] = [];
  /** Last fetched room list from the server. */
  public roomList: RoomInfo[] = [];

  public onRoomUpdate: ((payload: RoomUpdatePayload) => void) | null = null;
  public onRoomList: ((rooms: RoomInfo[]) => void) | null = null;
  public onGameStart: (() => void) | null = null;

  constructor(networkManager: NetworkManager) {
    this.net = networkManager;

    this.net.on(MessageType.ROOM_UPDATE, (msg) => {
      const payload = msg.payload as RoomUpdatePayload;
      this.currentRoom = payload.room;
      this.currentPlayers = payload.players;

      if (payload.event === 'game_started') {
        this.onGameStart?.();
      }

      if (payload.event === 'room_closed') {
        this.currentRoom = null;
        this.currentPlayers = [];
      }

      this.onRoomUpdate?.(payload);
    });

    this.net.on(MessageType.ROOM_LIST, (msg) => {
      const payload = msg.payload as RoomListPayload;
      this.roomList = payload.rooms;
      this.onRoomList?.(payload.rooms);
    });
  }

  /** Ask the server to create a new room and become its host. */
  createRoom(options: CreateRoomPayload): void {
    this.net.send(MessageType.CREATE_ROOM, options satisfies CreateRoomPayload);
  }

  /** Join an existing room by ID. */
  joinRoom(roomId: string, password?: string): void {
    this.net.send(MessageType.JOIN_ROOM, { roomId, password } satisfies JoinRoomPayload);
  }

  /** Leave the current room. */
  leaveRoom(): void {
    if (!this.currentRoom) return;
    this.net.send(MessageType.LEAVE_ROOM, { roomId: this.currentRoom.id } satisfies LeaveRoomPayload);
    this.currentRoom = null;
    this.currentPlayers = [];
  }

  /** Request an up-to-date room list from the server. */
  requestRoomList(): void {
    this.net.send(MessageType.ROOM_LIST, {});
  }

  /** True if the local player is the host of the current room. */
  get isHost(): boolean {
    if (!this.currentRoom) return false;
    return this.currentRoom.hostId === this.net.playerId;
  }

  /** True if currently inside a room. */
  get inRoom(): boolean {
    return this.currentRoom !== null;
  }
}
