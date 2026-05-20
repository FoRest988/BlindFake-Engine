import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkManager } from '../client/src/network/NetworkManager';

// NetworkManager uses browser WebSocket + window.setInterval.
// Stub them out so tests run in node without a DOM.

const mockSend = vi.fn();
const mockClose = vi.fn();

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send = mockSend;
  close = mockClose;
}

vi.stubGlobal('WebSocket', MockWebSocket);
vi.stubGlobal('window', {
  setInterval: vi.fn(() => 99),
  clearInterval: vi.fn(),
});

function makeManager(): { manager: NetworkManager; ws: MockWebSocket } {
  const manager = new NetworkManager('ws://localhost:3001');
  // Start the connect flow so ws is created, then capture it
  manager.connect('TestPlayer').catch(() => {});
  const ws = (manager as any).ws as MockWebSocket;

  // Simulate successful open + handshake ACK
  ws.onopen?.();
  ws.onmessage?.({
    data: JSON.stringify({
      type: 'handshake_ack',
      timestamp: Date.now(),
      payload: { playerId: 'player-1' },
    }),
  });

  return { manager, ws };
}

describe('NetworkManager', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockClose.mockClear();
  });

  it('stores player name for reconnection', () => {
    const { manager } = makeManager();
    expect((manager as any).lastPlayerName).toBe('TestPlayer');
  });

  it('resets timeSinceLastPong to 0 on connect', () => {
    const { manager } = makeManager();
    expect((manager as any).timeSinceLastPong).toBe(0);
  });

  it('resets timeSinceLastPong on PONG message', () => {
    const { manager, ws } = makeManager();

    // Simulate time passing
    (manager as any).timeSinceLastPong = 5;

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'pong',
        timestamp: Date.now(),
        payload: { time: Date.now() - 50 },
      }),
    });

    expect((manager as any).timeSinceLastPong).toBe(0);
  });

  it('accumulates timeSinceLastPong in update()', () => {
    const { manager } = makeManager();

    manager.update(1);
    manager.update(2.5);

    expect((manager as any).timeSinceLastPong).toBeCloseTo(3.5);
  });

  it('does not accumulate when not connected', () => {
    const manager = new NetworkManager('ws://localhost:3001');
    // Never called connect(), so connected = false
    manager.update(5);
    expect((manager as any).timeSinceLastPong).toBe(0);
  });

  it('triggers reconnect after PONG_TIMEOUT_S seconds of silence', () => {
    const { manager, ws } = makeManager();

    const tryReconnect = vi.spyOn(manager as any, 'tryReconnect');

    // Advance past the 10 s threshold in one big delta
    manager.update(11);

    expect(manager.isConnected).toBe(false);
    expect(tryReconnect).toHaveBeenCalledWith('TestPlayer');
  });

  it('does not trigger reconnect before timeout', () => {
    const { manager } = makeManager();
    const tryReconnect = vi.spyOn(manager as any, 'tryReconnect');

    manager.update(9.9);

    expect(manager.isConnected).toBe(true);
    expect(tryReconnect).not.toHaveBeenCalled();
  });

  it('disconnect() prevents further reconnect attempts', () => {
    const { manager } = makeManager();
    manager.disconnect();
    expect(manager.isConnected).toBe(false);
    expect(mockClose).toHaveBeenCalled();
  });

  it('off() removes a specific handler', () => {
    const { manager, ws } = makeManager();
    const handler = vi.fn();
    manager.on('player_state' as any, handler);
    manager.off('player_state' as any, handler);

    ws.onmessage?.({
      data: JSON.stringify({ type: 'player_state', timestamp: Date.now(), payload: {} }),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('createRoom() sends CREATE_ROOM message', () => {
    const { manager } = makeManager();
    mockSend.mockClear();
    manager.createRoom({ name: 'Arena', maxPlayers: 4, level: 'level1', mode: 'pvp' });
    const sent = JSON.parse(mockSend.mock.calls[0][0]);
    expect(sent.type).toBe('create_room');
    expect(sent.payload.name).toBe('Arena');
  });

  it('joinRoom() sends JOIN_ROOM message with roomId', () => {
    const { manager } = makeManager();
    mockSend.mockClear();
    manager.joinRoom('room-42', 'secret');
    const sent = JSON.parse(mockSend.mock.calls[0][0]);
    expect(sent.type).toBe('join_room');
    expect(sent.payload.roomId).toBe('room-42');
    expect(sent.payload.password).toBe('secret');
  });

  it('leaveRoom() sends LEAVE_ROOM message', () => {
    const { manager } = makeManager();
    mockSend.mockClear();
    manager.leaveRoom('room-42');
    const sent = JSON.parse(mockSend.mock.calls[0][0]);
    expect(sent.type).toBe('leave_room');
    expect(sent.payload.roomId).toBe('room-42');
  });

  it('requestRoomList() sends ROOM_LIST message', () => {
    const { manager } = makeManager();
    mockSend.mockClear();
    manager.requestRoomList();
    const sent = JSON.parse(mockSend.mock.calls[0][0]);
    expect(sent.type).toBe('room_list');
  });

  it('sendPlayerInput() sends PLAYER_INPUT message with sequence and keys', () => {
    const { manager } = makeManager();
    mockSend.mockClear();
    manager.sendPlayerInput({
      sequence: 7,
      delta: 0.016,
      keys: { forward: true, back: false, left: false, right: false, jump: false },
    });
    const sent = JSON.parse(mockSend.mock.calls[0][0]);
    expect(sent.type).toBe('player_input');
    expect(sent.payload.sequence).toBe(7);
    expect(sent.payload.keys.forward).toBe(true);
  });
});
