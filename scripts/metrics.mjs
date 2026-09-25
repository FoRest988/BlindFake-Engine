#!/usr/bin/env node
/**
 * Code-health metrics for the rework (see docs/decisions/0000-rework-plan.md, section "Métricas").
 * Prints a markdown table and writes metrics.json. Never fails the build by itself.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';

const PRODUCT_ROOTS = ['client/src', 'server/src', 'shared'];
const TEST_ROOTS = ['tests', 'e2e'];
const ENTRIES = ['client/src/main.ts', 'server/src/index.ts'];
const ALIASES = { '@engine/': 'client/src/engine/', '@editor/': 'client/src/editor/', '@shared/': 'shared/' };

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (['.ts', '.mts'].includes(extname(name)) && !name.endsWith('.d.ts')) yield full.replace(/\\/g, '/');
  }
}

const productFiles = PRODUCT_ROOTS.flatMap(r => [...walk(r)]);
const testFiles = TEST_ROOTS.flatMap(r => [...walk(r)]);
const read = f => readFileSync(f, 'utf8');
const lines = f => read(f).split('\n').length;
const count = (files, re) => files.reduce((n, f) => n + (read(f).match(re) ?? []).length, 0);

// ── import graph ────────────────────────────────────────────────────────────
const SPEC_RE = /(?:from\s*|import\s*\(\s*|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/g;
function resolveSpec(fromFile, spec) {
  let base;
  const alias = Object.keys(ALIASES).find(a => spec.startsWith(a));
  if (alias) base = ALIASES[alias] + spec.slice(alias.length);
  else if (spec.startsWith('.')) base = relative(process.cwd(), resolve(dirname(fromFile), spec)).replace(/\\/g, '/');
  else return null;
  base = base.replace(/\.js$/, '');
  for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) if (existsSync(cand) && statSync(cand).isFile()) return cand;
  return null;
}
const importers = new Map(productFiles.map(f => [f, new Set()]));
for (const f of [...productFiles, ...testFiles]) {
  for (const m of read(f).matchAll(SPEC_RE)) {
    const target = resolveSpec(f, m[1]);
    if (target && importers.has(target) && target !== f) importers.get(target).add(f);
  }
}
const isTest = f => testFiles.includes(f);
const deadModules = productFiles.filter(f => !ENTRIES.includes(f) && importers.get(f).size === 0);
const testOnlyModules = productFiles.filter(f => !ENTRIES.includes(f) && importers.get(f).size > 0 && [...importers.get(f)].every(isTest));

// ── metrics ─────────────────────────────────────────────────────────────────
const clientFiles = productFiles.filter(f => f.startsWith('client/src/'));
const editorFiles = clientFiles.filter(f => f.startsWith('client/src/editor/'));
const engineTs = clientFiles.find(f => f.endsWith('engine/Engine.ts')) ?? clientFiles.find(f => f.endsWith('core/Engine.ts'));
const weakAssertRe = /\.(toBeDefined|toBeTruthy|toBeUndefined|not\.toThrow)\(\)/g;

const metrics = {
  productLines: productFiles.reduce((n, f) => n + lines(f), 0),
  testLines: testFiles.reduce((n, f) => n + lines(f), 0),
  productFiles: productFiles.length,
  deadModules: deadModules.length,
  testOnlyModules: testOnlyModules.length,
  itBlocks: count(testFiles, /^\s*(?:it|test)\(/gm),
  weakAssertions: count(testFiles, weakAssertRe),
  innerHtmlAssignments: count(clientFiles, /\.innerHTML\s*[+]?=/g),
  cssTextAssignments: count(clientFiles, /\.cssText\s*=/g),
  nativeDialogs: count(clientFiles, /\b(?:alert|prompt|confirm)\(/g),
  addEventListener: count(clientFiles, /\baddEventListener\(/g),
  removeEventListener: count(clientFiles, /\bremoveEventListener\(/g),
  constructorName: count(productFiles, /constructor\.name/g),
  styleInjections: count(clientFiles, /createElement\(\s*['"]style['"]\s*\)|<style>/g),
  editorReachIns: count(editorFiles, /this\.editor\./g),
  webglRenderers: count(clientFiles, /new\s+THREE\.WebGLRenderer\(/g),
  cdnReferences: count(productFiles, /cdn\.jsdelivr\.net|gstatic\.com|unpkg\.com|cdnjs\.cloudflare\.com/g),
  newFunction: count(productFiles, /new\s+Function\(/g),
  eagerSystemsInEngineCtor: engineTs ? (read(engineTs).match(/this\.\w+\s*=\s*new\s+\w+(?:System|Manager)\(/g) ?? []).length : 0,
  editorActiveUses: count(productFiles, /\beditorActive\b/g),
  anyCasts: count(productFiles, /\bas any\b/g),
};

const rows = Object.entries(metrics).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
console.log(`| metric | value |\n|---|---|\n${rows}`);
if (deadModules.length) console.log(`\nModules with no importer (${deadModules.length}):\n  ${deadModules.join('\n  ')}`);
if (testOnlyModules.length) console.log(`\nModules imported only by tests (${testOnlyModules.length}):\n  ${testOnlyModules.join('\n  ')}`);
writeFileSync('metrics.json', JSON.stringify({ ...metrics, deadModules, testOnlyModules }, null, 2) + '\n');
