#!/usr/bin/env node
/**
 * Fails when any source or doc file is not valid UTF-8, starts with a BOM,
 * contains U+FFFD replacement characters, or contains CJK characters
 * (which in this repository are always the result of GBK mojibake).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['client', 'server', 'shared', 'tests', 'e2e', 'scripts', 'docs', '.github'];
const ROOT_FILES = ['README.md', 'ROADMAP.md', 'package.json', 'tsconfig.json', 'tsconfig.test.json', 'tsconfig.server.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js', 'knip.json'];
const EXTS = new Set(['.ts', '.mts', '.js', '.mjs', '.md', '.css', '.html', '.json', '.yml', '.yaml', '.lua']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'public', 'decisions']); // docs/decisions quotes historical mojibake on purpose
// Built from char codes so this file never contains the characters it hunts for.
const CJK_RE = new RegExp(`[${String.fromCharCode(0x3000)}-${String.fromCharCode(0x9fff)}]`, 'g');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(name))) yield full;
  }
}

const files = [];
for (const r of ROOTS) {
  try { if (statSync(r).isDirectory()) files.push(...walk(r)); } catch { /* missing root */ }
}
for (const f of ROOT_FILES) {
  try { statSync(f); files.push(f); } catch { /* optional */ }
}

const strict = new TextDecoder('utf-8', { fatal: true });
const problems = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push(`${file}: starts with a UTF-8 BOM`);
  }
  let text;
  try {
    text = strict.decode(bytes);
  } catch {
    problems.push(`${file}: not valid UTF-8`);
    text = new TextDecoder('utf-8').decode(bytes);
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('�')) problems.push(`${file}:${i + 1}: contains U+FFFD replacement character`);
    const cjk = line.match(CJK_RE);
    if (cjk) problems.push(`${file}:${i + 1}: contains CJK characters (${cjk.length}), likely mojibake`);
  });
}

if (problems.length) {
  console.error(`check-encoding: ${problems.length} problem(s) in ${new Set(problems.map(p => p.split(':')[0])).size} file(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-encoding: ${files.length} files OK`);
