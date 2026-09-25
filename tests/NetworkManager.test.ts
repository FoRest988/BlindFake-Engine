import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGameServer, type GameServer } from '../server/src/server';
import { NetworkManager, NetworkManagerError, defaultServerUrl } from '../client/src/network/NetworkManager';
import { MessageType } from '../shared/types';
import WebSocketImpl from 'ws';

// Node 22+ ships a global WebSocket; Node 20 (also in CI) does not, so fall back to the `ws` package.
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketImpl;
}

/** The client under test talks to a real server on an ephemeral port over a real WebSocket. */
let server: GameServer;
let url: string;
const managers: NetworkManager[] = [];

const fastOptions = { pingIntervalMs: 20, pongTimeoutS: 0.2, reconnectBaseDelayMs: 5, connectTimeoutMs: 1000, maxReconnectAttempts: 5 };

function make(extra: Partial<typeof fastOptions> & { serverUrl?: string } = {}): NetworkManager {
  const m = new NetworkManager({ serverUrl: url, ...fastOptions, ...extra });
  managers.push(m);
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = createGameServer({ port: 0, devErrors: false, quiet: true });
  url = `ws://127.0.0.1:${await server.listen()}/ws`;
});

afterEach(() => {
  for (const m of managers.splice(0)) m.disconnect();
});

afterAll(async () => {
  await server.close();
});

describe('NetworkManager', () => {
  it('connect() resolves with the player id and keeps latency updated through pings', async () => {
    const manager = make();
    const playerId = await manager.connect('Alice');
    expect(playerId).toMatch(/[0-9a-f-]{36}/);
    expect(manager.isConnected).toBe(true);
    await sleep(80);
    expect(manager.latency).toBeGreaterThanOrEqual(0);
    manager.update(0.1); // well under the pong timeout: still connected
    expect(manager.isConnected).toBe(true);
  });

  it('connect() rejects when nothing listens on the port', async () => {
    const manager = make({ serverUrl: 'ws://127.0.0.1:1/ws', maxReconnectAttempts: 0 });
    await expect(manager.connect('Bob')).rejects.toBeInstanceOf(NetworkManagerError);
    expect(manager.isConnected).toBe(false);
  });

  it('connect() rejects on a version mismatch and does not retry', async () => {
    const strict = createGameServer({ port: 0, devErrors: false, quiet: true, version: '9.9.9' });
    const strictUrl = `ws://127.0.0.1:${await strict.listen()}/ws`;
    try {
      const manager = make({ serverUrl: strictUrl });
      const scheduled = vi.fn();
      manager.onReconnectScheduled = scheduled;
      await expect(manager.connect('Carol')).rejects.toMatchObject({ code: 'version_mismatch' });
      await sleep(50);
      expect(scheduled).not.toHaveBeenCalled();
    } finally {
      await strict.close();
    }
  });

  it('a pong timeout closes the socket and schedules exactly one reconnect', async () => {
    const manager = make({ pingIntervalMs: 10_000 }); // no pings, so no pongs arrive
    const scheduled = vi.fn();
    manager.onReconnectScheduled = scheduled;
    await manager.connect('Dave');

    manager.update(1); // > pongTimeoutS
    await sleep(30);

    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledWith(1, 5);
  });

  it('retries with backoff up to maxReconnectAttempts when the server goes away, then gives up', async () => {
    const own = createGameServer({ port: 0, devErrors: false, quiet: true });
    const ownUrl = `ws://127.0.0.1:${await own.listen()}/ws`;
    const manager = make({ serverUrl: ownUrl, maxReconnectAttempts: 3, reconnectBaseDelayMs: 5 });
    const scheduled = vi.fn();
    const failed = vi.fn();
    manager.onReconnectScheduled = scheduled;
    manager.onReconnectFailed = failed;
    await manager.connect('Eve');

    await own.close(); // drops the connection

    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(scheduled.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(scheduled.mock.calls.map((c) => c[1])).toEqual([5, 10, 20]);
    expect(manager.reconnectAttemptCount).toBe(3);
    expect(manager.isConnected).toBe(false);
    await sleep(50);
    expect(scheduled).toHaveBeenCalledTimes(3); // no further attempts
  });

  it('disconnect() stops reconnecting and a later connect() works again', async () => {
    const manager = make();
    const scheduled = vi.fn();
    manager.onReconnectScheduled = scheduled;
    await manager.connect('Frank');

    manager.disconnect();
    await sleep(30);
    expect(scheduled).not.toHaveBeenCalled();
    expect(manager.isConnected).toBe(false);

    await manager.connect('Frank');
    expect(manager.isConnected).toBe(true);
  });

  it('one throwing handler does not stop the others and ROOM_UPDATE arrives with the shared shape', async () => {
    const manager = make();
    await manager.connect('Grace');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const received = vi.fn();
    manager.on(MessageType.ROOM_UPDATE, () => { throw new Error('boom'); });
    manager.on(MessageType.ROOM_UPDATE, received);

    manager.createRoom({ name: 'Test' });

    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    const msg = received.mock.calls[0][0];
    expect(msg.payload.event).toBe('updated');
    expect(msg.payload.room.name).toBe('Test');
    expect(msg.payload.players).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('send() reports whether the socket was open', () => {
    const manager = make();
    expect(manager.send(MessageType.PING, { time: 1 })).toBe(false);
  });

  it('defaults to /ws on the current origin when a location exists', () => {
    expect(defaultServerUrl()).toBe('ws://localhost:4000/ws');
    vi.stubGlobal('location', { protocol: 'https:', host: 'game.example' });
    expect(defaultServerUrl()).toBe('wss://game.example/ws');
    vi.unstubAllGlobals();
  });
});
