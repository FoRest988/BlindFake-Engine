import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture guard: the engine owns the one WebGL renderer the editor draws
 * with. Remaining constructors belong to per-tab preview renderers that the
 * rework retires phase by phase (F5: disposed properly, F7: gone).
 * Limit history: 7 after F1 -> 6 in F2 -> 2 in F7.
 */
const LIMIT = 6;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts')) yield full;
  }
}

describe('architecture: single renderer', () => {
  it(`constructs at most ${LIMIT} THREE.WebGLRenderer instances in client/src`, () => {
    const hits: string[] = [];
    for (const file of walk(join(process.cwd(), 'client/src'))) {
      const count = (readFileSync(file, 'utf8').match(/new\s+THREE\.WebGLRenderer\(/g) ?? []).length;
      if (count) hits.push(`${file.replace(process.cwd() + '/', '')} x${count}`);
    }
    const total = hits.reduce((n, h) => n + Number(h.split(' x')[1]), 0);
    expect(total, hits.join('\n')).toBeLessThanOrEqual(LIMIT);
    expect(hits.some((h) => h.startsWith('client/src/editor/EditorApp.ts'))).toBe(false);
  });
});
