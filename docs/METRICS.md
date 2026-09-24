# Métricas de saúde do código

Geradas por `npm run metrics` (`scripts/metrics.mjs`), que também grava `metrics.json`.
As metas por fase estão em `docs/decisions/0000-rework-plan.md`, seção "Métricas de progresso".

## Baseline (F0, commit `caa28c7` + tooling)

Medido com `node scripts/metrics.mjs` após a instalação das ferramentas da F0. O código de produto ainda não foi tocado.

| métrica | valor | o que mede |
|---|---|---|
| productLines | 73.362 | linhas em `client/src`, `server/src`, `shared` |
| testLines | 5.196 | linhas em `tests/`, `e2e/` |
| productFiles | 157 | arquivos `.ts` de produto |
| deadModules | 19 | módulos de produto sem nenhum importador |
| testOnlyModules | 10 | módulos de produto importados só por testes |
| itBlocks | 332 | `it(`/`test(` estáticos (345 casos em runtime) |
| weakAssertions | 72 | `toBeDefined()`, `toBeTruthy()`, `toBeUndefined()`, `not.toThrow()` |
| innerHtmlAssignments | 225 | atribuições a `innerHTML` no client |
| cssTextAssignments | 567 | atribuições a `style.cssText` no client |
| nativeDialogs | 32 | `alert(`/`prompt(`/`confirm(` |
| addEventListener / removeEventListener | 679 / 72 | listeners registrados vs removidos |
| constructorName | 7 | usos de `constructor.name` (quebram minificado) |
| styleInjections | 13 | `<style>` injetado por TypeScript |
| editorReachIns | 335 | `this.editor.*` dentro de `client/src/editor` |
| webglRenderers | 15 | `new THREE.WebGLRenderer(` |
| cdnReferences | 12 | strings apontando para jsdelivr/gstatic/unpkg/cdnjs |
| newFunction | 2 | `new Function(` |
| eagerSystemsInEngineCtor | 39 | `this.x = new *System/Manager()` no construtor do Engine |
| editorActiveUses | 20 | usos do flag `editorActive` |
| anyCasts | 98 | `as any` |

Outros números da F0 que não saem do script:

| item | valor |
|---|---|
| `npm run typecheck` / `typecheck:server` | verdes já no baseline |
| `npm run typecheck:test` | 9 erros no baseline (corrigidos na F0) |
| `npm run lint` | 18 erros e 365 avisos no baseline (erros corrigidos ou marcados na F0) |
| `npm run check-encoding` | 15 arquivos com BOM, mojibake GBK ou UTF-8 inválido (corrigidos na F2) |
| `npx knip` (arquivos sem uso) | 22 |
| contextos WebGL na aba Scene (e2e) | ≤ 8 (limite provisório do smoke) |

## Metas

| métrica | F1 | F2 | F3 | F4 | F5 | F7 | F9 |
|---|---|---|---|---|---|---|---|
| productLines | ≤ 53k | | | | ≤ 50k | | |
| deadModules + testOnlyModules | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| itBlocks (reais) | ≈ 143 | | ≥ 200 | | ≥ 300 | | ≥ 450 |
| weakAssertions | | | | | | | ≤ 5 |
| cdnReferences / newFunction | | | | 0 / 0 | | | |
| innerHtmlAssignments fora de `editor/ui` | | | | | 0 | | |
| nativeDialogs | | | | | 0 | | |
| editorReachIns | | | | | ≤ 60 | | |
| webglRenderers | | 6 | | | 6 | 2 | |
| contextos WebGL na aba Scene | | 1 | 1 | 1 | 1 | 1 | 1 |
| constructorName | | | 0 | | | | |
| check-encoding | | verde | | | | | |
