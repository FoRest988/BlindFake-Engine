// @vitest-environment jsdom

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptEditorPanel } from '../client/src/editor/panels/ScriptEditorPanel';

describe('ScriptEditorPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('monaco', {
      editor: {
        create: (_container: HTMLElement, options: { value?: string }) => {
          let value = options.value ?? '';
          return {
            getValue: () => value,
            setValue: (next: string) => { value = next; },
            onDidChangeModelContent: vi.fn(),
            layout: vi.fn(),
            dispose: vi.fn(),
            addCommand: vi.fn(),
          };
        },
        defineTheme: vi.fn(),
        setTheme: vi.fn(),
      },
      KeyMod: { CtrlCmd: 1, Shift: 2 },
      KeyCode: { KeyS: 49 },
    });
  });

  it('loads and saves scripts attached to scene objects', () => {
    const scene = new THREE.Scene();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    crate.name = 'Crate';
    crate.userData.__luaScript = 'print("crate")';
    scene.add(crate);

    const select = vi.fn();
    const panel = new ScriptEditorPanel({
      scene,
      state: { selectedObject: null },
      select,
    } as any);

    const root = panel.render();
    document.body.appendChild(root);

    const scriptListEl = (panel as any).scriptListEl as HTMLElement;
    const attachedItem = Array.from(scriptListEl.children).find((el) => el.textContent?.includes('Crate')) as HTMLElement;
    attachedItem.click();

    expect(select).toHaveBeenCalledWith(crate);
    expect((panel as any).getEditorValue()).toBe('print("crate")');

    (panel as any).setEditorValue('print("updated")');
    (panel as any).saveScript();

    expect(crate.userData.__luaScript).toBe('print("updated")');
  });

  it('attaches project scripts to the selected object and switches to attached mode', () => {
    const scene = new THREE.Scene();
    const player = new THREE.Object3D();
    player.name = 'Player';
    scene.add(player);

    const editor = {
      scene,
      state: { selectedObject: player },
      select: vi.fn((obj: THREE.Object3D) => {
        editor.state.selectedObject = obj;
      }),
    };
    const panel = new ScriptEditorPanel(editor as any);

    const root = panel.render();
    document.body.appendChild(root);

    (panel as any).createScript('Mover', 'Empty');
    (panel as any).setEditorValue('print("move")');
    (panel as any).saveScript();
    (panel as any).attachToSelected();

    expect(player.userData.__luaScript).toBe('print("move")');
    expect((panel as any).activeSceneScriptObject).toBe(player);
    expect(root.textContent).toContain('Player');
  });
});