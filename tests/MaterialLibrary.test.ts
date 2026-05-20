import { describe, it, expect, vi } from 'vitest';
import { MaterialLibrary } from '../client/src/engine/MaterialLibrary';
import type { MaterialDefinition } from '../client/src/engine/MaterialLibrary';

// Patch THREE.MeshStandardMaterial (and variants) with a testable stub so that
// the library can run in a node/non-WebGL environment.
vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>();
  class Stub {
    uuid = Math.random().toString(36).slice(2);
    type = 'MeshStandardMaterial';
    name = '';
    disposed = false;
    color = { set: vi.fn(), getHex: () => 0xffffff };
    dispose() { this.disposed = true; }
    clone() { return new Stub(); }
  }
  return {
    ...THREE,
    MeshStandardMaterial: Stub,
    MeshPhysicalMaterial: Stub,
    MeshBasicMaterial: Stub,
    MeshLambertMaterial: Stub,
    TextureLoader: class { load(_: string, cb: (t: unknown) => void) { cb({}); } },
  };
});

function makeDef(id: string, overrides: Partial<MaterialDefinition> = {}): MaterialDefinition {
  return {
    id,
    name: id,
    type: 'standard',
    tags: [],
    properties: { color: '#ffffff' },
    texturePaths: {},
    ...overrides,
  };
}

describe('MaterialLibrary', () => {
  it('saveMaterial stores and retrieves a material definition', () => {
    const lib = new MaterialLibrary();
    lib.saveMaterial(makeDef('mat1', { name: 'Test' }));
    expect(lib.getMaterialDef('mat1')).toBeDefined();
    expect(lib.getMaterialDef('mat1')!.name).toBe('Test');
  });

  it('buildMaterial creates a live THREE material and caches it', () => {
    const lib = new MaterialLibrary();
    const def = makeDef('mat1');
    lib.saveMaterial(def);
    const m1 = lib.buildMaterial(def);
    const m2 = lib.buildMaterial(def);
    expect(m1).toBeDefined();
    expect(m1).toBe(m2); // same cached instance
  });

  it('removeMaterial disposes the cached THREE material', () => {
    const lib = new MaterialLibrary();
    const def = makeDef('mat1');
    lib.saveMaterial(def);
    const mat = lib.buildMaterial(def);
    lib.removeMaterial('mat1');
    expect((mat as any).disposed).toBe(true);
    expect(lib.getMaterialDef('mat1')).toBeUndefined();
  });

  it('removeMaterial is a no-op when material was never built into cache', () => {
    const lib = new MaterialLibrary();
    lib.saveMaterial(makeDef('mat1'));
    // Never call buildMaterial — cache is empty
    expect(() => lib.removeMaterial('mat1')).not.toThrow();
    expect(lib.getMaterialDef('mat1')).toBeUndefined();
  });

  it('clearCache disposes all cached materials', () => {
    const lib = new MaterialLibrary();
    const defA = makeDef('a');
    const defB = makeDef('b');
    lib.saveMaterial(defA);
    lib.saveMaterial(defB);
    const matA = lib.buildMaterial(defA);
    const matB = lib.buildMaterial(defB);
    lib.clearCache();
    expect((matA as any).disposed).toBe(true);
    expect((matB as any).disposed).toBe(true);
  });

  it('clearCache only clears live cache — definitions remain, new material can be rebuilt', () => {
    const lib = new MaterialLibrary();
    const def = makeDef('mat1');
    lib.saveMaterial(def);
    const original = lib.buildMaterial(def);
    lib.clearCache();
    // Definition should still exist
    expect(lib.getMaterialDef('mat1')).toBeDefined();
    // A new live material can be built on demand
    const rebuilt = lib.buildMaterial(def);
    expect(rebuilt).toBeDefined();
    expect(rebuilt).not.toBe(original); // fresh instance
  });
});
