#!/usr/bin/env node
/**
 * Keeps the public docs honest: fails when README.md, ROADMAP.md or
 * docs/GETTING_STARTED.md claim features the code does not have.
 * Add a phrase here when a facade is removed; remove it when the feature
 * ships with tests (see docs/decisions/0000-rework-plan.md).
 */
import { readFileSync, existsSync } from 'node:fs';

const FILES = ['README.md', 'ROADMAP.md', 'docs/GETTING_STARTED.md'];

/** Phrases that must not appear as claims. Matched case-insensitively. */
const DENYLIST = [
  'webgpu',
  'pwa',
  'service worker',
  'physics worker',
  'delta compress',
  'delta-compress',
  'interest management',
  'shader graph',
  'website/',
  '345 tests',
  'client prediction',
  'entity replication',
  'ktx2',
  'light probe',
  'occlusion culling',
  'hot reload',
  'plugin system',
  'electron',
  'export game',
  'virtual joystick',
  'touch gesture',
  'adaptive music',
  'hrtf',
  'benchmarkrunner',
];

let failures = 0;
for (const file of FILES) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    // Lines that explicitly mark something as removed or planned are allowed to name it.
    if (/removido|planejado|removed|planned|não existe|not implemented/.test(lower)) return;
    for (const phrase of DENYLIST) {
      if (lower.includes(phrase)) {
        console.error(`${file}:${i + 1}: claims "${phrase}" -> ${line.trim().slice(0, 100)}`);
        failures++;
      }
    }
  });
}

if (failures) {
  console.error(`check-readme-claims: ${failures} unsupported claim(s)`);
  process.exit(1);
}
console.log('check-readme-claims: OK');
