import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createGameServer, type GameServer } from '../../server/src/server';
import { GAME_CONFIG, MessageType } from '../../shared/types';

/** Real server on an ephemeral port; every test talks to it over a real socket. */
let server: GameServer;
let url: string;

beforeAll(async () => {
  server = createGameServer({ port: 0, devErrors: false, quiet: true, handshakeTimeoutMs: 500, maxPayloadBytes: 16 * 1024 });
  const port = await server.listen();
  url = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  await server.close();
});

type Frame = { type: string; payload: any };

/** A socket whose incoming frames are queued, so a message can never be missed between awaits. */
interface Client extends WebSocket { inbox: Frame[]; waiters: Array<(f: Frame) => void> }

function open(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url) as Client;
    ws.inbox = [];
    ws.waiters = [];
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      const waiter = ws.waiters.shift();
      if (waiter) waiter(frame); else ws.inbox.push(frame);
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: Client, timeoutMs = 1000): Promise<Frame> {
  const queued = ws.inbox.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message')), timeoutMs);
    ws.waiters.push((frame) => { clearTimeout(timer); resolve(frame); });
  });
}

function closed(ws: WebSocket, timeoutMs = 1500): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
    ws.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
}

async function handshake(ws: Client, playerName = 'Tester'): Promise<string> {
  ws.send(JSON.stringify({ type: MessageType.HANDSHAKE, timestamp: Date.now(), payload: { playerName, version: GAME_CONFIG.VERSION } }));
  const ack = await nextMessage(ws);
  expect(ack.type).toBe(MessageType.HANDSHAKE_ACK);
  return ack.payload.playerId as string;
}

async function healthy(): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
  return res.ok && (await res.json()).status === 'ok';
}

describe('game server: hostile input never kills the process', () => {
  it('survives JSON null, non-object frames and unknown types', async () => {
    const ws = await open();
    ws.send('null');
    ws.send('42');
    ws.send('"string"');
    ws.send('{"type":"nope"}');
    ws.send('{not json');
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(await healthy()).toBe(true);
    ws.close();
  });

  it('survives a ping without payload and a handshake without payload', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: MessageType.PING }));
    ws.send(JSON.stringify({ type: MessageType.HANDSHAKE }));
    const err = await nextMessage(ws);
    expect(err.type).toBe(MessageType.ERROR);
    expect(err.payload.code).toBe('bad_payload');
    expect(await healthy()).toBe(true);
    ws.close();
  });

  it('rejects a non-string playerName and a wrong version without crashing', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: MessageType.HANDSHAKE, payload: { playerName: 42, version: GAME_CONFIG.VERSION } }));
    expect((await nextMessage(ws)).payload.code).toBe('bad_payload');

    ws.send(JSON.stringify({ type: MessageType.HANDSHAKE, payload: { playerName: 'x', version: '0.0.0' } }));
    expect((await nextMessage(ws)).payload.code).toBe('version_mismatch');
    expect(await closed(ws)).toBe(4001);
    expect(await healthy()).toBe(true);
  });

  it('closes sockets that send oversized frames and keeps serving', async () => {
    const ws = await open();
    const closing = closed(ws);
    ws.send('x'.repeat(20 * 1024));
    expect(await closing).toBe(1009);
    expect(await healthy()).toBe(true);
  });

  it('closes sockets that never handshake', async () => {
    const ws = await open();
    expect(await closed(ws)).toBe(4000);
  });

  it('refuses a second handshake on the same socket instead of creating a ghost player', async () => {
    const ws = await open();
    await handshake(ws);
    const before = server.playerCount;
    ws.send(JSON.stringify({ type: MessageType.HANDSHAKE, payload: { playerName: 'again', version: GAME_CONFIG.VERSION } }));
    expect((await nextMessage(ws)).payload.code).toBe('already_handshaken');
    expect(server.playerCount).toBe(before);
    ws.close();
    await closed(ws);
  });

  it('requires a handshake before room commands', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: MessageType.CREATE_ROOM, payload: {} }));
    expect((await nextMessage(ws)).payload.code).toBe('not_handshaken');
    ws.close();
  });
});

describe('game server: rooms use the shared payload shapes', () => {
  it('CREATE_ROOM answers with a RoomUpdatePayload and clamps maxPlayers', async () => {
    const ws = await open();
    const id = await handshake(ws, 'Host');
    ws.send(JSON.stringify({ type: MessageType.CREATE_ROOM, payload: { name: 'Arena <script>', maxPlayers: 999 } }));
    const update = await nextMessage(ws);
    expect(update.type).toBe(MessageType.ROOM_UPDATE);
    expect(update.payload.event).toBe('updated');
    expect(update.payload.room.name).toBe('Arena script');
    expect(update.payload.room.maxPlayers).toBe(GAME_CONFIG.MAX_PLAYERS_PER_ROOM);
    expect(update.payload.room.hostId).toBe(id);
    expect(update.payload.players).toEqual([{ id, name: 'Host', ready: false }]);
    ws.close();
    await closed(ws);
  });

  it('rejects non-integer maxPlayers and invalid modes as bad_payload', async () => {
    const ws = await open();
    await handshake(ws);
    ws.send(JSON.stringify({ type: MessageType.CREATE_ROOM, payload: { maxPlayers: 'lots' } }));
    expect((await nextMessage(ws)).payload.code).toBe('bad_payload');
    ws.send(JSON.stringify({ type: MessageType.CREATE_ROOM, payload: { mode: 'battle-royale' } }));
    expect((await nextMessage(ws)).payload.code).toBe('bad_payload');
    ws.close();
  });

  it('ROOM_LIST answers with { rooms }, JOIN_ROOM broadcasts, room_full and room_not_found are errors', async () => {
    const host = await open();
    await handshake(host, 'Host');
    host.send(JSON.stringify({ type: MessageType.CREATE_ROOM, payload: { name: 'Duo', maxPlayers: 2 } }));
    const created = await nextMessage(host);
    const roomId = created.payload.room.id as string;

    const guest = await open();
    await handshake(guest, 'Guest');
    guest.send(JSON.stringify({ type: MessageType.ROOM_LIST }));
    const list = await nextMessage(guest);
    expect(list.type).toBe(MessageType.ROOM_LIST);
    expect(list.payload.rooms.map((r: { id: string }) => r.id)).toContain(roomId);

    const hostSeesJoin = nextMessage(host);
    guest.send(JSON.stringify({ type: MessageType.JOIN_ROOM, payload: { roomId } }));
    expect((await hostSeesJoin).type).toBe(MessageType.PLAYER_JOIN);
    const guestJoin = await nextMessage(guest);
    expect(guestJoin.type).toBe(MessageType.PLAYER_JOIN);
    const guestUpdate = await nextMessage(guest);
    expect(guestUpdate.type).toBe(MessageType.ROOM_UPDATE);
    expect(guestUpdate.payload.event).toBe('player_joined');
    expect(guestUpdate.payload.room.playerCount).toBe(2);

    const third = await open();
    await handshake(third, 'Third');
    third.send(JSON.stringify({ type: MessageType.JOIN_ROOM, payload: { roomId } }));
    expect((await nextMessage(third)).payload.code).toBe('room_full');
    third.send(JSON.stringify({ type: MessageType.JOIN_ROOM, payload: { roomId: 'nope' } }));
    expect((await nextMessage(third)).payload.code).toBe('room_not_found');

    for (const ws of [host, guest, third]) ws.close();
    await Promise.all([closed(host), closed(guest), closed(third)]);
    expect(server.roomCount).toBe(0);
  });
});
