# BlindFake Engine

Engine de jogos 3D/2D para navegador, com editor estilo Unity/Godot, escrita em TypeScript sobre Three.js e Rapier.

> **Estado: em rework.** O código está sendo reestruturado por fases (veja `ROADMAP.md` e `docs/decisions/0000-rework-plan.md`). Este README descreve o que **existe e funciona hoje**, não o que está planejado. A tabela de status abaixo é verificada no CI por `scripts/check-readme-claims.mjs`.

## Rodando

Requisitos: Node.js 20.19+ ou 22.12+ (há um `.nvmrc`).

```bash
npm ci
npm run dev          # editor em http://localhost:3000
npm run dev:server   # servidor de salas (opcional; porta 4000)
npm run dev:all      # os dois
```

Outros comandos:

```bash
npm run check        # typecheck (client, testes, servidor), lint, claims do README, testes com cobertura, builds
npm run test:e2e     # smoke do editor no Chromium (Playwright)
npm run metrics      # métricas de saúde do código (docs/METRICS.md)
npm run knip         # arquivos e dependências sem uso
npm run check-encoding
```

## Status das features

Legenda: **Funciona** = usado pelo app e coberto por teste ou pelo smoke e2e; **Parcial** = existe e roda, mas com lacunas conhecidas; **Beta** = roda, sem garantia de desempenho ou de dados; **Removido** = fachada apagada na F1 do rework; **Planejado** = fase do rework em que volta de verdade.

### Editor

| Feature | Status | Notas |
|---|---|---|
| Landing page com projetos (localStorage) e 3 templates (3D vazio, 2D vazio, Platformer 3D) | Funciona | reabrir um projeto reaplica o template; a cena editada não é restaurada (Planejado: F4) |
| Aba Scene: hierarquia, inspector, gizmos de mover/rotacionar/escalar, seleção múltipla, undo/redo, snapping, grid | Funciona | |
| Importar modelos GLTF/GLB/FBX/OBJ por menu ou arrastar | Funciona | texturas são forçadas a sRGB, o que corrompe normal/roughness maps (Planejado: F3) |
| Play mode (F9) com física e restauração das transformações | Funciona | um único loop e um único renderer (F2); os scripts dos objetos ainda não executam |
| Salvar/carregar projeto (`.bfproject`, download/upload) e cena (JSON) | Parcial | scripts, layouts de UI, state machines e cinematics ficam fora do arquivo (Planejado: F4) |
| Autosave | Funciona | por projeto; restaurar substitui a cena em vez de duplicar (F2) |
| Aba Terrain: esculpir, pintar, erosão em worker, água | Parcial | erosão em worker funciona também no build de produção (F2); terreno ainda usa trimesh (Planejado: F3, heightfield) |
| Aba Animation: clips, posar ossos, keyframes, timeline | Beta | não persiste no projeto |
| Aba Cinematic: trilhas de câmera, letterbox, legendas | Beta | não persiste no projeto e não é tocada pelo runtime |
| Aba State Machine | Beta | edita uma máquina isolada, não ligada a objetos |
| Aba Scripting (Monaco) | Parcial | os scripts Lua são editados e salvos nos objetos, mas **não executam em play** (Planejado: F4) |
| Aba Blueprints (grafo visual) | Parcial | 75 dos 154 nós têm implementação; só roda pelo botão Simulate, não em play (Planejado: F4); atalhos do grafo já não vazam para as outras abas (F2) |
| Aba UI Editor | Beta | layouts salvos só no localStorage |
| Aba Modeling (vértice/aresta/face, extrude, sculpt, ossos, pesos) | Beta | edita o mesh da cena sem undo; subdivide descarta UV e pesos (Planejado: F7) |
| Aba Textures (paint, canais, ajustes) | Beta | |
| Console, preferências, atalhos, painel Engine Systems | Funciona | |

### Engine

| Feature | Status | Notas |
|---|---|---|
| Renderização Three.js 0.170 (WebGL 2), sombras, tone mapping ACES | Funciona | |
| ECS (World, Entity, Component, System) | Funciona | `Component.dispose`, timings reais por sistema e modo edit/play (F2); `typeId` e registro chegam na F3 |
| Física Rapier 3D: corpos, colisores, character controller, raycast, joints | Parcial | passo fixo de 1/60 com acumulador e contatos com terreno (F2); terreno via heightfield e interpolação chegam na F3 |
| Áudio: grupos, zonas, música, listener 3D | Funciona | |
| Partículas, tweens, timers, event bus | Funciona | |
| Post-processing (bloom, SSAO, DOF, motion blur, cor) | Parcial | pipeline própria com vazamento de memória no SSAO (Planejado: F3, troca por EffectComposer) |
| Céu, clima e névoa | Parcial | o clima limpo apaga a névoa da cena a cada frame (Planejado: F3) |
| LOD, instancing, decals, trails, billboards, minimapa | Beta | |
| NavMesh, IK, ragdoll, cloth | Beta | algoritmos O(n²) e alocações por frame (Planejado: F3) |
| Gameplay: diálogo, quests, spawns/ondas, habilidades, status, conquistas, behavior trees | Beta | sem editor e sem persistência |
| UI de jogo (DOM) com layouts | Parcial | layouts não entram no projeto exportável |
| Scripts TypeScript em runtime (`ScriptingSystem`) | Parcial | transpilação por regex e `new Function`, sem sandbox (Planejado: F4, substituído por Lua real) |
| Lua | Parcial | interpretador por regex para cinematics; scripts de jogo não rodam em play (Planejado: F4, fengari com sandbox) |

### Multiplayer, export e outros

| Feature | Status | Notas |
|---|---|---|
| Servidor de salas (Express + ws) | Parcial | valida toda mensagem, limita frames a 64 KB, fecha sockets sem handshake, sobrevive a entrada hostil (F2); sem autoridade de simulação (Planejado: F9) |
| Cliente de rede (`NetworkManager`) | Parcial | conecta, rejeita erros e reconecta com backoff (F2), mas não é usado pelo editor nem pelos templates (Planejado: F9) |
| Export de jogo (HTML/ZIP) | Removido | os exportadores geravam um visualizador via CDN sem engine, física ou scripts (Planejado: F8) |
| Export para desktop | Removido | Planejado: F8 (Electron sobre o mesmo pacote) |
| Renderer WebGPU | Removido | nunca foi chamado e não podia funcionar num canvas WebGL |
| PWA / mobile / touch / joystick virtual | Removido | não havia manifest nem service worker; touch e joystick voltam com o modo 2D (Planejado: F6) |
| Physics worker, hot reload, plugins, light probes, culling de oclusão, pipeline de streaming de assets | Removido | fachadas sem efeito real |
| Mixer de áudio, música adaptativa, áudio espacial com HRTF | Removido | só existiam em testes |
| Predição de cliente e replicação de entidades | Removido | nunca ligados ao app; voltam com o servidor autoritativo (Planejado: F9) |

## Estrutura

```
client/src/
  main.ts            bootstrap: landing → engine → editor
  LandingPage.ts     hub de projetos
  ProjectTemplates.ts  3 templates (cena + gameplay + HUD)
  engine/            Engine, renderização, física (RapierPhysics), assets, áudio, partículas, terreno, UI, ...
  ecs/               World, Entity, Component, System, componentes e sistemas
  editor/            EditorApp, painéis (panels/), serviços e controladores
  cinematics/        CinematicEngine, LuaScriptRunner
  gameplay/          diálogo, quests, spawns, habilidades, status, conquistas, behavior trees
  network/           NetworkManager
server/src/index.ts  servidor de salas
shared/types.ts      tipos de mensagens compartilhados
tests/               testes unitários (Vitest)
e2e/                 smoke do editor (Playwright)
scripts/             métricas, checagem de codificação e de claims do README
docs/                METRICS.md, GETTING_STARTED.md, decisions/ (plano do rework e referências)
```

## Contribuindo

Cada mudança precisa passar em `npm run check` e em `npm run test:e2e`. O plano de fases, os gates de qualidade e as métricas alvo estão em `docs/decisions/0000-rework-plan.md`; o estado medido está em `docs/METRICS.md`.

## Licença

MIT. Veja `LICENSE`.
