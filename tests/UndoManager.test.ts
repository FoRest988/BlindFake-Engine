import { describe, it, expect } from 'vitest';
import { UndoManager, GroupCommand, type UndoCommand } from '../client/src/editor/UndoManager';

// Simple test command
function makeCommand(state: { value: number }, newVal: number): UndoCommand {
  const oldVal = state.value;
  return {
    label: `Set ${newVal}`,
    execute: () => { state.value = newVal; },
    undo: () => { state.value = oldVal; },
  };
}

describe('UndoManager', () => {
  it('executes a command', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 10));
    expect(state.value).toBe(10);
  });

  it('undoes a command', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 10));
    um.undo();
    expect(state.value).toBe(0);
  });

  it('redoes a command', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 10));
    um.undo();
    um.redo();
    expect(state.value).toBe(10);
  });

  it('clears redo stack on new command', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 10));
    um.undo();
    expect(um.canRedo).toBe(true);
    um.execute(makeCommand(state, 20));
    expect(um.canRedo).toBe(false);
  });

  it('canUndo / canRedo reflect state', () => {
    const um = new UndoManager();
    expect(um.canUndo).toBe(false);
    expect(um.canRedo).toBe(false);
    um.execute(makeCommand({ value: 0 }, 1));
    expect(um.canUndo).toBe(true);
    um.undo();
    expect(um.canRedo).toBe(true);
    expect(um.canUndo).toBe(false);
  });

  it('undoLabel / redoLabel return correct labels', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 5));
    expect(um.undoLabel).toBe('Set 5');
    um.undo();
    expect(um.redoLabel).toBe('Set 5');
  });

  it('getHistory returns labels most recent first', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 1));
    um.execute(makeCommand(state, 2));
    um.execute(makeCommand(state, 3));
    expect(um.getHistory()).toEqual(['Set 3', 'Set 2', 'Set 1']);
  });

  it('respects maxHistory', () => {
    const um = new UndoManager(3);
    const state = { value: 0 };
    for (let i = 1; i <= 5; i++) {
      um.execute(makeCommand(state, i));
    }
    expect(um.getHistory()).toHaveLength(3);
  });

  it('clear empties all stacks', () => {
    const um = new UndoManager();
    um.execute(makeCommand({ value: 0 }, 1));
    um.clear();
    expect(um.canUndo).toBe(false);
    expect(um.canRedo).toBe(false);
  });

  it('multiple undo/redo in sequence', () => {
    const um = new UndoManager();
    const state = { value: 0 };
    um.execute(makeCommand(state, 10));
    um.execute(makeCommand(state, 20));
    um.execute(makeCommand(state, 30));
    expect(state.value).toBe(30);

    um.undo();
    expect(state.value).toBe(20);
    um.undo();
    expect(state.value).toBe(10);
    um.undo();
    expect(state.value).toBe(0);

    um.redo();
    expect(state.value).toBe(10);
    um.redo();
    expect(state.value).toBe(20);
  });
});

describe('GroupCommand', () => {
  it('executes all sub-commands', () => {
    const s1 = { value: 0 };
    const s2 = { value: 0 };
    const group = new GroupCommand('Batch', [
      makeCommand(s1, 10),
      makeCommand(s2, 20),
    ]);
    group.execute();
    expect(s1.value).toBe(10);
    expect(s2.value).toBe(20);
  });

  it('undoes all sub-commands in reverse', () => {
    const log: string[] = [];
    const group = new GroupCommand('Batch', [
      { label: 'A', execute: () => log.push('execA'), undo: () => log.push('undoA') },
      { label: 'B', execute: () => log.push('execB'), undo: () => log.push('undoB') },
      { label: 'C', execute: () => log.push('execC'), undo: () => log.push('undoC') },
    ]);
    group.execute();
    log.length = 0;
    group.undo();
    expect(log).toEqual(['undoC', 'undoB', 'undoA']);
  });

  it('works with UndoManager', () => {
    const um = new UndoManager();
    const s1 = { value: 0 };
    const s2 = { value: 0 };
    um.execute(new GroupCommand('Batch', [
      makeCommand(s1, 5),
      makeCommand(s2, 15),
    ]));
    expect(s1.value).toBe(5);
    expect(s2.value).toBe(15);
    um.undo();
    expect(s1.value).toBe(0);
    expect(s2.value).toBe(0);
  });
});
