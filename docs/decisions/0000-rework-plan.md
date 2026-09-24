# Plano: Rework total da BlindFake Engine

## Contexto

**O que existe hoje.** `BlindFake: Phantom v0.2.0` é uma engine de jogos web (TypeScript, Three.js, Rapier, Vite) com ~73k linhas em 158 arquivos, editor estilo Unity, ECS próprio, scripting Lua/Blueprint, exportadores e servidor multiplayer. Foi gerada rapidamente por um modelo pequeno (Haiku 4.5) em 3 commits.

**Por que mudar.** Três auditorias independentes (núcleo, editor, rede/testes/build) mostraram que a base tem partes reais e razoáveis (integração Three.js/Rapier, ECS básico, alguns serviços do editor recém-extraídos e testados) mas:
- muitas features anunciadas são fachada, código morto ou estão desconectadas do app (scripts nunca executam, exportadores não exportam o jogo, WebGPU/PWA/physics worker não existem de fato);
- há bugs estruturais que quebram em runtime (dois loops de render na mesma cena, culler que sobrescreve visibilidade, autosave global que duplica cena, servidor derrubado por uma mensagem malformada);
- há duplicação massiva (5 implementações de áudio, 6 de input, 2 serializers com o mesmo nome, 3 editores de grafo em canvas, 4 runtimes de export);
- não há gates de qualidade (sem CI, lint, typecheck de testes, cobertura real ~10-15%).

**Visão do dono (resposta literal, resumida).** "Rework total. Uma engine boa, tipo Unity/Unreal da web, ou Godot: qualquer pessoa consiga fazer jogos; carregar modelos de vários tipos; criar e carregar animações; criar e carregar texturas; modelagem, modificar modelos, rig e weights; scripts; blueprints; project tree tipo Roblox/Unreal; jogos 3D ou 2D; nós fornecemos sistemas e código para ajudar; exportar um pack completo (HTML, talvez EXE), não só um HTML com tudo dentro."

**Decisões já tomadas pelo dono.**
1. Estratégia: refatorar por fases, com cortes agressivos (não reescrever do zero).
2. Fachadas: cortar do código e do README até serem reais.
3. Prioridade: não definiu uma única; quer o conjunto acima. O plano ordena por dependência técnica: primeiro um núcleo confiável (loop, ECS, física, persistência, scripting real), depois o pipeline de conteúdo (modelos, texturas, animação, modelagem/rig), depois export de pacote completo, depois multiplayer.
4. Scripting: **Lua real via fengari + fengari-interop, com sandbox e orçamento de instruções** (host JS fica como opção futura).
5. EXE: **Electron**, reaproveitando os geradores de `package.json`/`main.js`/`preload.js` que já existem em `ElectronExporter.ts`.
6. Prefabs / cenas aninhadas: **sim**; campo reservado no formato de projeto na F4 e implementação real na F6.
7. Física 2D: **Rapier 3D com eixos travados + câmera ortográfica** (sem dependência nova).

**Como este plano foi produzido.** Três auditorias independentes (núcleo, editor, rede/testes/build); 46 alegações verificadas adversarialmente por dois leitores cada (43 confirmadas, 3 parciais, 0 refutadas); painel de três arquitetos com ângulos distintos (núcleo, produto, risco), três juízes, síntese, crítico de completude (18 faltas, 11 contradições, 9 problemas de sequência, 13 itens não verificáveis) e revisão final. O plano abaixo é a versão condensada da revisão final; o texto completo (~12k palavras) está em `docs/decisions/0000-rework-plan-full.md` .

**Convenções.** Plano e README em português; código, comentários e mensagens de commit em inglês. Branch de trabalho: `claude/lucid-gauss-a1vpbn`.

---

## Base de evidências (auditoria, pré-verificação)

Status: as alegações abaixo estão em verificação adversarial por dois leitores independentes cada (workflows `wf_681c4455-a1f` e `wf_b1503ae6-45d`). Vereditos serão anotados na seção "Vereditos".

### A. Núcleo da engine (`client/src/engine`, `ecs`, `cinematics`, `gameplay`, `ai`, `2d`, `workers`)

1. **Dois loops de render e dois contextos WebGL no editor.** `main.ts:89` chama `engine.start()` e `EditorApp.loop` (`editor/EditorApp.ts:685`) roda o seu próprio; ambos operam na mesma `THREE.Scene`. O engine renderiza no canvas oculto, o editor renderiza de novo com um segundo `WebGLRenderer` (`EditorApp.ts:184`). Em play mode, `particles`, `cameraEffects` e `weather` são atualizados duas vezes (`Engine.ts:394-405` e `EditorApp.ts:714,748-749`).
2. **Culler quebra visibilidade.** `OcclusionCullingManager.cull` roda a cada frame (`Engine.ts:434`) e escreve `mesh.visible = true/false` em todo mesh (`OcclusionCulling.ts:431-447`) com a câmera do JOGO. Sobrescreve LOD (todos os níveis ficam visíveis), objetos ocultos manualmente e faz objetos sumirem no viewport do editor. Testa `geometry.boundingSphere` para `InstancedMesh`/`SkinnedMesh` (errado).
3. **Scripting é fake ou inseguro.** `LuaScriptRunner.loadFengari()` é privado e nunca chamado (~417); `execute()` sempre usa interpretador regex (~428). Scripts de jogo passam por transpiler regex Lua→JS e `new Function` (~725), sem sandbox, corrompendo strings (`"#ff0000"`→`"ff0000.length"`) e tabelas. APIs `input.*` retornam sempre false/0 (~605), `audio.*` só loga, `physics.*` não chega ao Rapier, `event.off` é no-op (~654). `ScriptingSystem.ts:257` diz "sandboxed" mas usa `new Function`; o strip de tipos por regex (~275) quebra JS comum (`{ speed: mySpeed }`, ternários).
4. **Exportadores não exportam o jogo.** `GameExporter.ts`, `ElectronExporter.ts`, `BuildExportSystem.ts` embutem cada um um viewer Three.js de ~200 linhas via CDN, sem ECS/física/scripts. Geometria serializada só por `type` (tudo vira caixa 1x1x1); `collectTextureBlobs` retorna antes dos callbacks (~637); `SCENE_DATA = ${sceneJSON}` sem escape (~181, XSS); Electron serializa em um formato e o HTML lê outro. Dois `SceneSerializer` com formatos incompatíveis (`SceneSerialization.ts:97`, `BuildExportSystem.ts:102`); ZIP/CRC32 duplicados.
5. **`Engine.ts` é god object.** ~57 subsistemas públicos construídos ansiosamente no construtor (76-275); ~20 nunca usados fora do Engine; importa `NetworkManager` com URL hard-coded.
6. **Física.** Sem timestep fixo (`RapierPhysics.ts:523` usa `min(dt, 1/30)`); contatos com terreno nunca emitidos (IDs negativos em `PhysicsSystem.ts:15` vs filtro `>= 0` em `RapierPhysics.ts:531`); `workers/PhysicsWorker.ts` é cópia morta nunca instanciada; `initRapier()` sem catch (`Engine.ts:270`).
7. **Sistemas de render quebrados ou no-op.** Budget de sombras desliga `castShadow` permanentemente (`Engine.ts:495-499`); `PerformanceManager.setQuality` nunca aplica o preset padrão (~237); light probes gravam `mat._probeSH` que nenhum shader lê (`LightProbeSystem.ts:312`); `SkySystem.generatePMREM` captura a cena inteira (~293); `WeatherSystem` zera `scene.fog` a cada frame (~459); `initWebGPU()` nunca chamado e não pode funcionar num canvas já WebGL.
8. **Post-processing.** 1687 linhas reinventando `EffectComposer`; SSAO aloca `ShaderMaterial` por frame sem dispose (~1255); DOF/SSAO/SSR re-renderizam a cena; `logarithmicDepthBuffer` quebra linearização de profundidade.
9. **Duplicação e código morto.** Sem importadores: `2d/Physics2D`, `2d/Sprite2D`, `ai/Pathfinding`, `ai/StateMachine`, `CameraController`, `EditorEventBus`, `LightingManager`, `PerformanceMonitor`, `ProceduralGeneration`, `RaycastUtils`, `VegetationSystem`, `gameplay/InventorySystem`, `workers/PhysicsWorker`. Só testes importam: `AdaptiveMusicSystem`, `AssetManifest`, `AudioMixer`, `Benchmark`, `SpatialAudioManager`, `TouchInputManager`, `UISystem`, `VirtualJoystick`. Paralelos: áudio (5), input (6), UI (`UIManager` DOM vs `UISystem` canvas), perf (6), AI (`ai/BehaviorTree` vs `gameplay/BehaviorTree`), splines (2), LOD (2), lighting (5), hot reload (3).
10. **Alocações em hot path e algoritmos quadráticos.** Cloth ~58k `Vector3`/frame (`ClothSimulation.ts:339-356`); NavMesh adjacência O(n²) (`NavMeshSystem.ts:202`) e `find` linear no A* (~300); IK ~54 alocações por solve; `AISystem` triggers O(n·m) com `new Set` por trigger (~63-71); 3 `scene.traverse` por frame em `Engine.ts:468-501`; pools declarados sem consumidores.
11. **ECS promete o que não faz.** `tickBudgetMs` nunca aplicado; `systemFrameMs` zerado no fim do frame (`World.ts:224`) então `getSystemTimings()` sempre vazio; pools de componentes nunca usados; cache de arquétipo por `type.name` com `includes` (substring; quebra minificado); remover entidade não remove `object3D` da cena (meshes fantasmas); `TransformComponent` guarda Euler e quaternion e só o quaternion é usado.
12. **AssetManager.** KTX2/DRACO só via CDN (`AssetManager.ts:581`, ~60); toda textura forçada a sRGB (~101,121, corrompe normal/roughness); `cloneModel` com `scene.clone(true)` quebra `SkinnedMesh`; duas filas de streaming, uma nunca atualizada.
13. **Codificação corrompida** (mojibake/BOM) em `LuaScriptRunner.ts`, `PluginSystem.ts`, `ElectronExporter.ts`.

### B. Editor (`client/src/editor`, `ProjectTemplates.ts`, `LandingPage.ts`, `styles`)

1. **Scripts e blueprints nunca rodam.** `userData.__luaScript` é escrito por templates e editado por inspector/ScriptEditorPanel, mas nada fora de `client/src/editor` lê. `__blueprint` idem; `GraphRuntime` só nasce ao clicar "Simulate" (`VisualScriptEditor.ts:2160`). 79 de 154 nós sem `execute` (todos de Physics/Audio/Input/UI/AI, `flow_for`, `flow_while`, `action_spawn`...). Breakpoints não pausam (~1685).
2. **Persistência quebrada.** Autosave em chave global `blindfake_autosave` (`EditorAutosaveService.ts:26`), não por projeto; `offerRestore` desserializa por cima da cena existente (duplica); `LandingPage.saveProjectScene()` nunca chamado; `main.ts:81-87` só faz `console.info`. Fora de qualquer save: scripts, layouts de UI, state machines, cinematics, timeline, assets.
3. **~4.000 linhas mortas ou nunca montadas.** `AssetBrowser`, `MaterialEditor`, `MultiSelect` construídos (`EditorApp.ts:361-365`) mas `render()` nunca chamado; menu "Asset Browser" chama `switchTab('scene')`. Nunca importados: `EditorManager` + `CinematicEditorPanel`/`ParticleEditorPanel`/`ModelInspectorPanel`, `LayoutPresets`, `PanelPersistenceService`, `SceneVersioning`; `KeybindEditor` só como tipo. Elemento timeline passado a `buildEditorLayout` e descartado.
4. **Sem contrato de ciclo de vida de painel.** 607 `addEventListener` vs 46 `remove`; `VisualScriptEditor.ts:2194` keydown global nunca removido e ativo na aba Scene (Delete/Ctrl+Z agem no grafo oculto); `EngineSystemsPanel.ts:1545` usa `DOMNodeRemoved` (deprecado); `ModelingRiggingPanel.render()` adiciona grid/eixos/3 luzes a cada render; Animation/Cinematic adicionam `TransformControls` a cada render; cada aba 3D cria novo `WebGLRenderer` sem `forceContextLoss` (limite de 16 contextos no Chrome); 11 loops RAF separados; `EditorConsole` monkey-patcha `console.*`.
5. **God object sem event bus.** 335 `this.editor.*`; `engine.events` emitido 1 vez no editor; `EditorState` mutável sem notificação; inspector reconstrói todo o DOM por frame durante drag de gizmo.
6. **Atalhos globais ignoram a aba ativa**; três pilhas de undo desconexas (cena, grafo, e nenhuma em Modeling/UI/Material/Animation/Cinematic/Texture/StateMachine/Timeline).
7. **UI por strings.** 215 `innerHTML`, 499 `cssText`, ~1.635 cores hex hard-coded enquanto `editor.css` define tokens `--ed-*` nunca usados no TS; 7 painéis injetam `<style>`; 14 `alert`, 15 `prompt`, 3 `confirm` como UI; 12 context menus artesanais; 5 cópias de `escapeHtml`; XSS por nomes em `innerHTML` (`AssetBrowser.ts:272-344`, `EditorViewport.ts:295`, `EditorInspector.ts:701,789`...).
8. **Arquivos gigantes misturando responsabilidades.** `ProjectTemplates.ts` (4012) = 9 funções imperativas de 220-700 linhas com cena + gameplay + HUD DOM; `VisualScriptEditor.ts` (3857) = 154 nós inline + runtime + editor canvas; três editores de grafo em canvas, cinco mini-viewports 3D, três timelines, três editores de script, duas UIs de state machine.
9. **UI fake ou meio ligada.** Pivot nunca lido; atalhos nos menus sem binding (Ctrl+N, Ctrl+O, Ctrl+E, F9 na verdade é play); "Exit to Game" vira página em branco; HUDs dos templates invisíveis (`editor.css:44` esconde `#ui-overlay` em `.editor-mode`); `case 'river': break;`; rename folder sem handler; luzes direcionais duplicadas (`main.ts:47` + `ProjectTemplates` `addDefaultLighting`); só 3 de 9 templates com `resetState`; inspector identifica componentes por `constructor.name` (`EditorInspector.ts:789,830,909`, quebra minificado); mojibake em labels de menu (`EditorMenuBar.ts:127-189`).
10. **Modeling edita o mesh vivo da cena** via `clone(true)` (geometria compartilhada), sem undo; `subdivideMesh` descarta UV/normais/skin weights.

### C. Rede, servidor, testes, build, docs

1. **Uma mensagem malformada derruba o servidor** (`server/src/index.ts`): `null` → `msg.type` lança (~136); `{"type":"ping"}` sem payload → `msg.payload.time` (~170); `playerName` não-string → `sanitize()` (~152,359). Sem try/catch no switch, sem `uncaughtException`.
2. **Protocolo divergente.** Servidor manda `ROOM_UPDATE` como `RoomInfo` puro; `RoomManager.ts:48-50` espera `{room, players, event}`. `ROOM_LIST` puro vs `{rooms}`. `PLAYER_INPUT` sem handler no servidor; `WORLD_STATE`/`ENTITY_*` nunca enviados; sem ack de input; `NetworkMessage.payload: any` (`shared/types.ts:54`).
3. **Sem autoridade, validação, rate limit, `maxPayload`, origin check**; `maxPlayers` aceita string→NaN (sala sem limite); senha de sala ignorada; handshake repetido cria jogadores fantasma; `/api/dev-errors` sempre ligado e grava em disco.
4. **Nada de rede é usado pelo app.** `connect()` nunca chamado; `ClientPrediction`, `EntityReplicator`, `RoomManager` só importados por testes; sem UI de lobby; URL hard-coded ignora o proxy `/ws` do Vite. `NetworkManager`: `connect()` nunca rejeita, reconnect duplo, `disconnect()` zera `maxReconnectAttempts` para sempre.
5. **README/ROADMAP inflados.** "345 testes" (são 331), WebGPU, PWA (sem manifest/SW/ícones), physics worker, delta compression, interest management, chat, Shader Graph, `website/` — falsos ou dormentes.
6. **Testes fracos onde importa.** ~58 asserções `toBeDefined`/`not.toThrow`; `RoomManager.test` codifica o contrato errado; `NetworkManager.test` lê campos privados; zero testes para `Engine`, `EditorApp`, `VisualScriptEditor`, `LuaScriptRunner`, servidor. Cobertura honesta ~10-15%. `tests/` fora do `include` do tsconfig (nunca type-checados).
7. **Sem gates.** Sem `.github`, ESLint/Prettier/Biome, `.editorconfig`, husky, scripts `typecheck`/`lint`/`coverage`.
8. **Drift de config.** `@types/express@5` com `express@4`; lockfile em `0.1.0`; docs dizem Node 18 mas vitest 4/jsdom 28 exigem 20+; `noEmit` + `declaration`; alias `@game/*` aponta para pasta inexistente; `.gitignore` sem `.vite/`, `error-logs/`, `coverage/`; sem script `start` de produção; `build:server` emite `dist/server/server/src/index.js`.
9. **Docs inventadas.** `docs/API.md` documenta `sendState`, `sendAction`, `sendChat`, `getRooms`, `EntityReplicator.register/snapshot/apply`, `ClientPrediction.applyInput/getState`, `ObjectPool.get()` — nenhum existe. `GETTING_STARTED.md` idem. 56 caracteres corrompidos em API.md.
10. **Bug de build.** `TerrainEditorPanel.ts:1075-1077` guarda `new URL(...)` em variável antes de `new Worker` (Vite não detecta; quebra em produção).

### Vereditos da verificação adversarial

**Editor / rede / testes / build (25 alegações, 2 leitores independentes cada + desempate): 23 confirmadas, 2 parciais, 0 refutadas.** Correções que alteram o texto acima:
- **A.3 / C (Lua):** `LuaScriptRunner.execute()` (cinematics) é apenas um extrator regex que monta um `CinematicTrack`, sem avaliar código. O transpiler regex + `new Function` (~725) fica no caminho `executeGameScript()` → `_runGameScript()`. A substância se mantém: fengari nunca é carregado e scripts de jogo rodam sem sandbox.
- **B.4 (EditorConsole):** `restoreConsole()` existe (`EditorConsole.ts:191`) e é chamado por `dispose()`; o que nunca é removido são os listeners `error`/`unhandledrejection` da `window`, e `main.ts` nunca chama `EditorApp.close()`.
- **A.9 (caminho):** o worker morto fica em `client/src/workers/PhysicsWorker.ts`; `client/src/engine/workers/` só tem `erosionWorker.ts` (vivo).
- **C.5 (testes):** 331 `it()` estáticos geram 345 casos em runtime (3 loops `for` criam 17); o README está correto nesse número.
- **C.8 (Node):** o README não cita versão de Node; só `docs/GETTING_STARTED.md:10` diz 18+. jsdom 28 exige `^20.19 || ^22.12 || >=24`.
- **C.1 (servidor):** a exposição é maior do que descrita: `HANDSHAKE` sem payload quebra em `:141`; `CREATE_ROOM`, `JOIN_ROOM`, `CHAT_MESSAGE` também desreferenciam `msg.payload.*` sem guarda; `null` e `ping` sem payload não exigem handshake.
- **B.1 (blueprint):** há 4 sítios de `new GraphRuntime` (subgraph, Simulate, debug run, debug step), todos só no editor e só disparando `event_start`. O nó é `flow_whileLoop`; 2 dos 5 nós de AI têm `execute` stub (retornam constante).
- **B.3:** `MultiSelect` não tem `render()`; o correto é "instanciado e nenhum método é chamado".
- **B.9 (HUD):** o mecanismo real é `main.ts:74` (`display:none` inline em `#game-container`, nunca limpo), além da classe `.editor-mode`.
- **B.7 (contagens):** ~104 atribuições `innerHTML` com template string (não 215; o resto são limpezas/strings fixas); 9 painéis injetam `<style>` (7 via `createElement`, 2 inline).
- **A.13/B.9 (mojibake):** em `LuaScriptRunner.ts` é mojibake GBK lossy (`鈫?` para →), não U+FFFD; precisa reconstruir pelo contexto.
- **C.2:** o desalinhamento de protocolo é latente (RoomManager nunca é instanciado no app), mas quebra no instante em que for ligado.

**Núcleo da engine (21 alegações, mesmo método): 20 confirmadas, 1 parcial, 0 refutadas.** Correções que alteram o texto acima:
- **A.5 (god object):** são 60 campos públicos; 50 construídos no construtor, 10 lazy/opcionais (`ragdoll` e `navMeshDebug` nunca são atribuídos em lugar nenhum). **39 dos 60 campos não têm nenhuma referência fora de `Engine.ts`**; só 18 são consumidos por código externo. 8 dos 17 listados são atualizados por frame apenas com `editorActive=false`. A URL `ws://localhost:4000/ws` é default de `EngineConfig.serverUrl`, mas nenhum chamador passa outra.
- **A.7 (fog):** `FogSystem` NÃO escreve `scene.fog`; é um pass fullscreen com uniforms próprios cujo `render()` nunca é chamado. Os escritores reais de `scene.fog` são `WeatherSystem`, `ProjectTemplates` (5 templates), os dois serializers e os exportadores. `SkySystem` usa só `MeshBasicMaterial` (sem GLSL custom); materiais incompatíveis com WebGPU: post-processing, terrain, water, fog, `MaterialLibrary`, `TrailRenderer`, `VegetationSystem`, `MaterialEditor`.
- **A.7 (ultra):** o preset "ultra" nunca é aplicado na inicialização (early return); pode ser aplicado depois se o nível sair e voltar.
- **A.8 (SSAO):** o vazamento é de heap JS (material + uniforms retidos pelo `WebGLShaderCache` sem `dispose`), não recompilação de programa GL; motion blur aloca 2 `Matrix4` por frame.
- **A.11 (pools):** `Entity.remove(type)` explícito devolve ao pool; o que pula o pool é `World.removeEntity()`/`clear()`. Nenhum pool é registrado fora dos testes.
- **A.9 (mortos):** `AssetManifest.ts` é totalmente morto (o teste importa a classe homônima de `BuildExportSystem.ts`). Total: 14 módulos sem importador, 7 só em testes. `InputActions` é camada sobre `InputManager` (não paralelo); o duplicado real de teclado é `ScriptingSystem.ScriptInputManager`.
- **A.4 (export):** "tudo vira caixa 1x1x1" vale literalmente para o Electron; no `BuildExportSystem` primitivos Box/Sphere/Cylinder/Plane mantêm o tipo com parâmetros default (perdem dimensões); `GameExporter` usa `SceneSerialization` e preserva geometria, mas seus runtimes dependem do CDN `jsdelivr` via importmap, sem DRACO/KTX2.
- **A.12 (CDN):** os exportadores não incluem `AssetManager`, então o CDN do KTX2/DRACO afeta o editor, não os exports (que quebram offline por outro motivo: `three` via importmap CDN).
- **A.3 (stripper TS):** pior do que descrito: quebra os próprios templates `Spawner` e shooter embutidos em `ScriptingSystem.ts` (~374, ~459) com `ReferenceError`; `case 1: break;` vira erro de sintaxe.
- **A.6:** nada assina `physics:collision` hoje; o bug dos contatos de terreno é latente.
- **A.10:** `Engine.ts` tem 2 `traverse` por frame + 1 no culler = 3 no total; `RenderStatsOverlay` só roda quando visível (oculto por padrão); IK ~51 alocações no FABRIK de 3 ossos/10 iterações, ~131 no CCD.
- **A.13:** os bytes inválidos de `PluginSystem.ts` estão em comentário e não chegam ao export; os de `ElectronExporter.ts` (~164, ~192) viram `�?` no `main.js` gerado.

---

## Arquitetura alvo (fim da F9)

```
client/src/
  core/        Engine (fachada ~200 linhas), loop/GameLoop, loop/ModuleRegistry, EventBus, InputManager,
               AssetManager (+assets/assignTexture, assets/loaders/*), SceneManager
  ecs/         World, Entity, Component (static typeId, dispose?), ComponentRegistry, CollisionEvents,
               System (phase 'fixed'|'update'), components/*, systems/*
  modules/     physics/ (PhysicsBackend, RapierPhysics), postfx/, audio/, particles/, environment/ (Sky+Weather),
               animation/, navigation/, gameplay/ (starter kit + Dialogue/Quest/…), ui/ (UIManager + Lobby),
               render-extras/ (LOD, Instanced, Decal, Trail, Water, Terrain), network/  — cada um é um EngineModule
  scripting/   ScriptHost, LuaHost (fengari), api/{scene,input,physics,audio,timer,event,tween,ui,animation,network,debug},
               ScriptSystem, templates.ts, blueprint/{types,NodeLibrary,nodes/*,GraphRuntime}, BlueprintSystem
  project/     ProjectFile v2, SceneSerializer (único), ProjectStorage (Idb/Fsa), AssetDatabase (GUID), AssetImporter,
               formats/{Material,UILayout,Clip,Sequence,Terrain,Prefab}, migrations/, zip (fflate), templates/*.json
  runtime/     GameRuntime (headless-capable; bootGame) — usado pelo Play, pelos testes e pelo export
  export/      PackExporter, ExportManifest, ElectronExporter, templates/*
  editor/      EditorApp (composition root com dispose real), core/{EditorPanel,PanelHost,CommandRegistry,ShortcutService,
               ViewportSurface,ViewportModeController,EditorBus,EditorStore}, ui/{dom,html,tokens,dialogs,ContextMenu,GraphCanvas,Timeline},
               panels/*, modes/{Viewport3DMode,Viewport2DMode,MeshEditMode,RigMode,TerrainMode}, commands/*
  workers/     erosionWorker
server/src/    server.ts (createGameServer), rooms/, index.ts        shared/  types.ts, protocol.ts (type guards)
scripts/       metrics.mjs, check-encoding.mjs, check-readme-claims.mjs, copy-decoders.mjs, make-fixtures.mjs, export-smoke.mjs
tests/ (unit, arch, bench, fixtures)   e2e/ (Playwright)
```

**Princípios.**
- **Um loop, um renderer.** `core/loop/GameLoop`: acumulador de passo fixo (1/60, máx. 5 substeps, clamp 0,25 s, alpha para interpolação). O `Engine` é o único dono do `requestAnimationFrame`; o editor registra `frameHooks` e renderiza com o mesmo `WebGLRenderer`. `engine.setMode('edit'|'play')` substitui `editorActive` + `physics.enabled` espalhados.
- **Núcleo pequeno, módulos opt-in.** `EngineModule { id; init(ctx); fixedUpdate?; update?; dispose() }` via `engine.use()`; nada de 60 campos ansiosos.
- **ECS honesto.** `static typeId` por componente, `ComponentRegistry` com serialize/deserialize, `Component.dispose?()` (remover entidade tira o `Object3D` da cena), fases `fixed`/`update`, sem `constructor.name`.
- **Scripting real.** `LuaHost` sobre fengari com `load(chunk, name, 't', env)` allowlist + `lua_sethook` com orçamento de instruções; blueprints e Lua usam a mesma `ScriptAPI` ligada aos subsistemas reais.
- **Um formato de projeto, um serializer.** `ProjectFile v2` (cenas, entidades, scripts, blueprints, UI, animações, assets por GUID, prefabs) com round-trip testado; migração do v1.
- **Play = GameRuntime.** O botão Play instancia o mesmo `GameRuntime` que o export empacota e que os testes rodam headless.
- **Export é a engine empacotada** (Vite lib → `blindfake-runtime.js`) + dados do projeto, sem CDN, sem JSON interpolado em JS; Electron por cima do mesmo pacote.
- **Editor com contrato.** `EditorPanel { mount; unmount; dispose }`, listeners e RAF rastreados por `PanelHost`, `CommandRegistry` alimentando menus/toolbar/atalhos por escopo, UI por helpers `dom/html` (escape automático) e tokens CSS, um `UndoManager` com comandos por documento, modos do viewport em vez de renderers por aba.
- **Fachada morre.** Nada entra no README sem teste; cada feature tem status Funciona / Parcial / Beta / Planejado / Removido.

### Peça → base atual → o que morre

| Peça | Vira base | Morre |
|---|---|---|
| `core/Engine` | `engine/Engine.ts` (renderer, câmera, clock, dispose) | 60 campos ansiosos, `optimizeFrame/restoreAfterRender` (`:468-508`), `initWebGPU`, `NetworkManager` no construtor, culler, `PerformanceManager`, `PrefabManager` (volta como formato de dados), `SaveManager` |
| ECS | `ecs/World.ts` (índice invertido), `Entity`, `System`, `PhysicsSystem`, `CharacterControllerSystem`, `AnimationSystem` | `tickBudgetMs`, pools, `systemFrameMs.clear`, chave por `type.name`, Euler duplicado em `TransformComponent` |
| Física | `engine/RapierPhysics.ts` (corpos, KCC, raycast, joints) | `timestep = min(dt,1/30)`, filtro `>= 0` de contatos, `TerrainSystem.generateCollisionMesh` (vira heightfield), `workers/PhysicsWorker.ts` |
| Assets | `engine/AssetManager.ts` (`extractModelData` já devolve `animations`, `loadModelFromFiles`, KTX2), `MaterialLibrary`, `MemoryBudget` | CDN de decoders, sRGB incondicional, `scene.clone(true)`, `streamQueue`, `AssetPipeline`, `AssetDependencyGraph` |
| Scripting | forma da API de `LuaScriptRunner` (`LUA_API_REFERENCE`, `EXTENDED_LUA_TEMPLATES`, `trackToLua`), 50 scripts Lua dos templates, backends reais (`EventBus/Timer/TweenManager/AudioManager/InputManager`) | `ScriptingSystem.ts`, transpiler regex + `new Function`, `LuaDebugger/LuaHotReloadManager`, `fengari-web`, `userData.__luaScript/__blueprint`, textarea de script do inspector |
| Blueprint | tipos, `NODE_LIBRARY` e `GraphRuntime` de `VisualScriptEditor.ts` (75 nós com `execute`) | 79 nós sem `execute`, `connections.find` por passo, `setTimeout` no `flow_delay`, breakpoint fake, `pushUndo` próprio, keydown global |
| UI/HUD | `UIManager.ts` (`registerLayout/loadLayout`), `UIEditorPanel.ts` (`UILayoutDef`, 5 templates) | `localStorage['blindfake_ui_layouts']`, HUD DOM imperativo dos templates |
| Projeto/serializer | `SceneSerialization.ts` (+teste), `EditorProjectFileService`, `EditorAutosaveService`, `EditorPlayModeCoordinator` (+testes) | `BuildExportSystem.SceneSerializer`, autosave global, `LandingPage.sceneData`, `PlayModeSystem` snapshot |
| Runtime/export | `GameRuntime` (novo); geradores `generatePackageJson/MainJs/PreloadJs/Readme` de `ElectronExporter.ts` | `GameExporter.ts`, `BuildExportSystem.ts`, viewer CDN do `ElectronExporter.ts` |
| Rede | `NetworkManager.ts`, `server/src/index.ts`, `shared/types.ts` | `ClientPrediction`, `EntityReplicator`, `RoomManager`, `payload: any` |
| Editor | `EditorApp` + serviços testados, `EditorTimeline` (vivo até F7), `TextureEditorPanel` (paint real, fica como Parcial), tokens `--ed-*` | `EditorManager` e órfãos, `AssetBrowser`, `MaterialEditor`, `MultiSelect`, `KeybindEditor` (volta como `ShortcutsPanel`), renderers por aba, `innerHTML`/`cssText`/diálogos nativos |

---

## Plano de fases (F0 → F9, 26-30 semanas)

Regra geral: cada fase termina com `npm run check` verde, o e2e `editor.smoke` passando e o editor utilizável. Branch `claude/lucid-gauss-a1vpbn`, PRs pequenos (um por bloco de cada fase), tag `pre-rework` em `caa28c7`.

### F0 — Baseline, gates e smoke e2e (4-6 dias)

**Objetivo.** Instalar, medir o estado real, colocar CI/lint/typecheck (incluindo `tests/`) e escrever o primeiro Playwright smoke **antes** de qualquer corte.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `package.json` / lockfile | modify | scripts `typecheck`, `typecheck:test`, `typecheck:server`, `lint`, `test:coverage`, `test:e2e`, `start`, `check`, `metrics`; `engines.node >=20.19`; `@types/express@^4`; devDeps `eslint@9`, `typescript-eslint`, `eslint-plugin-no-unsanitized`, `@vitest/coverage-v8`, `@playwright/test`, `knip`; regenerar lockfile |
| `tsconfig.json`, `tsconfig.test.json` (novo), `tsconfig.server.json` | modify/create | remover `declaration*` e alias `@game/*`; tests type-checados; server `outDir: dist`, `rootDir: .` |
| `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` (novo) | modify/create | coverage v8; Playwright com `webServer: vite`, Chromium `--use-gl=angle --use-angle=swiftshader` |
| `eslint.config.js`, `.editorconfig`, `.nvmrc` (22.12), `.gitignore`, `knip.json` | create/modify | `no-new-func`/`no-implied-eval` error; `no-unsanitized`, `alert/prompt/confirm`, strings de CDN como warn; knip com `entry` `main.ts`, `engine/workers/*.ts`, `server/src/index.ts` e `ignore` temporário de `NetworkManager`/`NetworkComponent` até F9 |
| `.github/workflows/ci.yml` | create | matrix Node 20.19/22; typecheck ×3, lint, coverage, build, build:server, check-encoding, knip, e2e, artefato `metrics.json` |
| `scripts/check-encoding.mjs`, `scripts/metrics.mjs` | create | `TextDecoder('utf-8',{fatal:true})`, falha em BOM/U+FFFD/CJK; métricas separadas produto vs tests (ver seção Métricas) |
| `e2e/editor.smoke.spec.ts` v0 | create | conta contextos WebGL via `addInitScript` em `getContext`; para cada template: abrir, zero `pageerror`, abrir as 10 abas, Add→Cube, Ctrl+Z, F9 play/stop |
| `docs/decisions/0000-rework-plan.md` | create | cópia do plano completo do painel |

**Verificação.** `nvm use && npm ci && npm run check` exit 0; `npm run build:server && ls dist/server/src/index.js`; `npm start` responde em `/api/health`; `node scripts/metrics.mjs` reproduz o baseline; `npx playwright test editor.smoke` verde nos 9 templates; `git tag -l pre-rework`.
**Riscos.** Volume de erros de tipo em `tests/` (timebox 1 dia); SwiftShader lento no CI.

### F1 — Corte agressivo (5-7 dias)

**Objetivo.** Remover ≈23k linhas inalcançáveis ou de fachada em 5 PRs ordenados por importador, mantendo o editor abrindo e as 10 abas funcionando.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| 14 módulos sem importador: `2d/{Physics2D,Sprite2D}`, `ai/*`, `engine/{CameraController,EditorEventBus,LightingManager,PerformanceMonitor,ProceduralGeneration,RaycastUtils,VegetationSystem,AssetManifest}`, `gameplay/InventorySystem`, `workers/PhysicsWorker` | delete | `Sprite2D` (`SpriteSheet`, `SpriteAnimationClip`) copiado para `docs/decisions/` antes; recriado como componente na F6 |
| 8 órfãos do editor: `EditorManager`, `CinematicEditorPanel`, `ParticleEditorPanel`, `ModelInspectorPanel`, `LayoutPresets`, `PanelPersistenceService`, `SceneVersioning`, `KeybindEditor` | delete | remover `useKeybindEditor` de `EditorKeyboardShortcuts.ts:106`; rebind volta na F5 |
| 11 módulos só-teste + seus testes: `engine/{UISystem,AudioMixer,AudioEffects,TouchInputManager,VirtualJoystick,Benchmark,SpatialAudioManager,AdaptiveMusicSystem}`, `network/{ClientPrediction,EntityReplicator,RoomManager}`, `tests/BuildSystem.test.ts` | delete | 181 testes que só provavam código morto; `tests/NetworkManager.test.ts` fica (reescrito na F2) |
| Fachadas do Engine: `engine/{WebGPURenderer,GameExporter,ElectronExporter,BuildExportSystem,PluginSystem,HotReload,WorkerManager,AssetPipeline,AssetDependencyGraph,Profiler,LightProbeSystem,OcclusionCulling,SplineSystem}` | delete | antes de apagar `ElectronExporter.ts`, copiar `generatePackageJson/MainJs/PreloadJs/Readme` para `docs/decisions/` (F8 reaproveita); seção Plugins de `EngineSystemsPanel.ts:1375-1425` sai junto |
| `engine/Engine.ts` | modify | remover imports/campos/dispose dos módulos acima, `NetworkManager` (`:13,:84,:202,:395,:532`), `initWebGPU`, bloco do culler |
| `editor/PlayModeSystem.ts`, `panels/EditorMenuBar.ts`, `EditorApp.ts`, `EditorLayoutBuilder.ts`, `EditorTabController.ts` | modify | remover `snapshot` nunca lido; itens de menu Export*/Asset Browser/Exit to Game/Timeline; `assetBrowser/materialEditor/multiSelect` (`EditorApp.ts:361-365`); div `timelinePanel` descartado. **`EditorTimeline.ts` fica** (usado pela aba Animation) |
| `panels/{AssetBrowser,MaterialEditor}.ts`, `editor/MultiSelect.ts` | delete | construídos e nunca renderizados |
| `ProjectTemplates.ts`, `LandingPage.ts`, `tests/ProjectTemplates.test.ts` | modify | apagar `setupFPS/TopDown2D/MainMenu/Fighting/Racing/Puzzle` (≈2,7k linhas); ficam `3d`, `2d`, `platformer3d`; tipo `ProjectTemplate` encolhe; teste perde 7 casos |
| `editor/TerrainEditorPanel.ts:994` | modify | remover opção `'river'` (fachada) |
| `docs/API.md`, `docs/tutorials/` | delete | símbolos inventados + codificação inválida; voltam na F9 via typedoc |
| `README.md`, `ROADMAP.md`, `docs/GETTING_STARTED.md`, `EditorMenuBar.ts:127-128`, `scripts/check-readme-claims.mjs` | modify/create | recodificar; tabela de status por feature; denylist no CI: WebGPU, PWA, Physics Worker, delta compression, interest management, Shader Graph, `website/` |

**Verificação.** Após cada PR: `npm run check && npx knip && npx playwright test editor.smoke`; `grep -rn 'GameExporter\|BuildExportSystem\|OcclusionCulling\|PluginSystem\|MultiSelect\|AssetBrowser' client/src` vazio; `check-encoding` passa em `docs/` e `EditorMenuBar.ts`; manual: aba Animation ainda mostra a timeline e "Insert clip" funciona.
**Riscos.** Perder 6 demos (tag `pre-rework`; 3 voltam como samples na F6).

### F2 — Bugs de runtime (8-11 dias)

**Objetivo.** Loop único, `setMode`, `Component.dispose`, autosave por projeto, servidor que não cai, reconnect sem duplicar, worker de erosão em produção, 0 mojibake, timestep fixo, contatos com terreno.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `engine/RapierPhysics.ts` → `modules/physics/RapierPhysics.ts` | move (PR só de `git mv`) | preserva blame; edições no PR seguinte |
| `engine/loop/GameLoop.ts` (novo), `Engine.ts` | create/modify | acumulador 1/60, máx 5 substeps, clamp 0,25 s, alpha; `tick(dt)`, `render(camera)`, `frameHooks`, `activeCamera`, `setViewportSize`, `rendererFactory` (testável em node); `setMode('edit'|'play')`; `initRapier().catch` → `physics:error`; remover `optimizeFrame/restoreAfterRender` e `logarithmicDepthBuffer` |
| `editor/EditorApp.ts`, `EditorPlayModeCoordinator.ts`, `panels/EditorViewport.ts`, `main.ts` | modify | apagar `editorRenderer/editorCanvas` e `loop`; corpo vira `onFrame(dt)`; `engine.renderer.domElement` re-parentado no viewport; coordinator usa `setMode`; `main.ts` sem luz duplicada, sem `_currentProjectId`, sem `display:none` em `#game-container` (HUD visível em play) |
| `ecs/Component.ts`, `components/GameComponents.ts`, `ecs/World.ts` | modify | criar `dispose?()`; `MeshComponent.dispose()` faz `removeFromParent`; `World` chama no flush; timings em double buffer; remover `tickBudgetMs`/pools; chave de arquétipo por id numérico |
| `editor/EditorAutosaveService.ts`, `EditorSceneEditingService.ts`, `LandingPage.ts` | modify | chave `blindfake_autosave:<projectId>`; restore substitui em vez de somar; `saveProjectScene` chamado |
| `server/src/server.ts` (novo), `server/src/index.ts`, `shared/protocol.ts` (novo) | create/modify | `createGameServer({port})`; `maxPayload: 64KB`; try/catch; type guards por mensagem; `maxPlayers` inteiro 1..8; handshake repetido rejeitado; `ROOM_UPDATE/ROOM_LIST` conforme `shared/types.ts`; `/api/dev-errors` só fora de produção |
| `network/NetworkManager.ts`, `tests/NetworkManager.test.ts` | modify/rewrite | URL default de `location` (`/ws`); `connect()` rejeita; `disconnect()` não zera `maxReconnectAttempts`; flag `reconnecting`; teste sem `as any` contra servidor `ws` real em porta 0 + fake timers |
| `editor/TerrainEditorPanel.ts:1075-1077` | modify | `new Worker(new URL(...), { type: 'module' })` inline |
| `cinematics/LuaScriptRunner.ts`, `panels/ModelingRiggingPanel.ts`, `engine/PluginSystem.ts` | modify | recodificar (revisão manual; mojibake GBK é lossy); `check-encoding` vira blocking |
| `modules/physics/RapierPhysics.ts`, `ecs/systems/PhysicsSystem.ts` | modify | `world.timestep = 1/60` fixo; filtro de contatos `!== undefined` (ids de terreno são negativos) |
| `panels/VisualScriptEditor.ts:2194`, `panels/EngineSystemsPanel.ts:1546`, `styles/editor.css:43-44`, `engine/DevErrorTracker.ts` | modify | keydown ignorado se `!container.isConnected` e removido no dispose; `DOMNodeRemoved` → `dispose()`; regras que escondem `#ui-overlay` removidas; tracker só em DEV |
| `tests/{GameLoop,ECS}.test.ts`, `tests/server/protocol.test.ts`, `tests/arch/single-renderer.test.ts`, `e2e/editor.smoke.spec.ts` v1 | create/modify | 3 frames de 50 ms → 9 passos; `setMode('edit')` roda só `TransformSync`; `removeEntity` remove o `Object3D`; servidor real recebendo `null`/`ping`/1 MB/handshake duplo; `new THREE.WebGLRenderer` ≤ 6; smoke: 1 contexto WebGL na aba Scene, 0 `webglcontextlost`, F9 mostra `#ui-overlay` |

**Verificação.** `npm run check && npx playwright test`; manual: play no platformer estável; reabrir projeto não duplica; `npm run build && npm run preview` → erosão termina; `node -e` enviando `null` via `ws` não derruba o servidor; matar o servidor com cliente conectado → 5 tentativas e para.
**Riscos.** Passo fixo muda a sensação do KCC (ajuste na F3); mover o canvas muda `pixelRatio`.

### F3 — Núcleo confiável (2,5-3 semanas)

**Objetivo.** God object → núcleo pequeno + módulos; `typeId`; heightfield + contatos + interpolação; `EffectComposer`; decoders locais; destino definido para cada subsistema.

**Mudanças (padrão: `git mv` por pasta, um PR por pasta).**
| Caminho | Ação | Nota |
|---|---|---|
| `core/{Engine,ModuleRegistry,EventBus,InputManager,AssetManager,SceneManager}.ts` | move/modify | aliases `@core/@modules/@ecs/@editor/@shared`; construtor sem `new *System()`; `use(module)`, `module<T>()`; `createDefaultEngine()` |
| `engine/{PerformanceManager,PrefabManager,SaveManager}.ts` | delete | sem consumidor; `PerformanceManager.setQuality` nunca aplica preset (`:237`); prefabs voltam como dados na F6 |
| `RenderStatsOverlay` → `editor/panels/StatsOverlay.ts`; `LODSystem`, `InstancedRenderer`, `DecalSystem`, `TrailRenderer`, `WaterSystem`, `TerrainSystem` → `modules/render-extras/`; `MemoryBudget` → `core/AssetManager` | move | `EngineSystemsPanel` lê via `engine.module(...)` |
| `ecs/{Component,ComponentRegistry (novo),System,World,CollisionEvents (novo)}.ts` | modify/create | `static readonly typeId`; `register(typeId, ctor, {serialize, deserialize})`; `System.phase`; `World.fixedUpdate/update(dt, alpha)`; `getEntityByObject` via `userData.entityId`; lint proíbe `constructor.name` (7 usos) |
| `components/GameComponents.ts` → `components/{Transform,MeshRef,PhysicsBody,Animation,StateMachine,CameraFollow,Health}.ts`; `GameComponents2D.ts` → `GameplayComponents.ts` | split/move | `TransformComponent` sem Euler (+`setYaw()`); `PhysicsBody` com `prevPosition/prevRotation` |
| `modules/physics/{PhysicsBackend,RapierPhysics}.ts`, `ecs/systems/{PhysicsSystem,TransformSyncSystem}.ts`, `ProjectTemplates.ts:209`, `TerrainEditorPanel.ts:977` | create/modify | `addHeightfieldBody(nrows, ncols, heights, scale)` (Rapier: subdivisões, `(nrows+1)×(ncols+1)` valores column-major); ambos os chamadores de `generateCollisionMesh` trocados nesta fase; interpolação por alpha |
| `modules/postfx/PostFxModule.ts` (novo); `engine/PostProcessing.ts` | create/delete | `EffectComposer` + `RenderPass/UnrealBloomPass/GTAOPass/SMAAPass/OutputPass`; 1.687 linhas morrem |
| `modules/environment/EnvironmentModule.ts` (funde `SkySystem`+`WeatherSystem`); `FogSystem` | merge/delete | dono único de `scene.fog`; PMREM de cena privada só com o domo, regenerado só quando o céu muda |
| `modules/{audio,particles,animation,navigation,gameplay,ui}/` | move | cada um em um `EngineModule` |
| `NavMeshSystem`, `IKSystem`, `ClothSimulation`, `AISystem.ts:71` | modify (mínimo) + backlog | `AISystem` reutiliza `Set` por trigger; `NavMesh.getPolyById` vira `Map`, adjacência por hash de arestas; Cloth/IK ganham benches com orçamento e ficam "Beta" no README |
| `core/AssetManager.ts`, `core/assets/assignTexture.ts`, `scripts/copy-decoders.mjs` | modify/create | `postinstall` copia draco/basis para `assets/public/decoders/`; `map/emissiveMap → SRGB`, `normal/roughness/metalness/ao → NoColorSpace`; `cloneModel` via `SkeletonUtils.clone`; `streamQueue` removida |
| `panels/EditorInspector.ts`, `panels/EngineSystemsPanel.ts` | modify | inspector por `ComponentRegistry.list()`; painel itera `engine.modules` |
| `tests/{ModuleRegistry,Engine.loop,RapierPhysics,PhysicsSystem,PostFxModule,AssetManager,EnvironmentModule}.test.ts`, `tests/bench/{physics,cloth,navmesh,ik}.bench.ts`, `docs/decisions/0001-physics-worker.md` | create | Rapier real em node: cubo cai e para em y≈0,5 em 120 passos, determinismo `toBeCloseTo(…,10)`; heightfield com pico assimétrico acerta raycast; `PostFxModule` com renderer fake; PMREM 1× após 100 updates; benches com regressão > 20% falhando |

**Verificação.** `npm run check` com thresholds (core ≥ 70, ecs ≥ 80, modules/physics ≥ 60, server ≥ 70); `grep -rn 'new .*System()' client/src/core/Engine.ts` = 0; `git grep -n 'constructor.name' client/src` = 0; manual: Bloom liga/desliga; `.glb` DRACO offline; `normalMap.colorSpace === ''`; personagem sobe montanha e `physics:collision` chega; fog não pisca ao trocar clima.
**Riscos.** Muita movimentação de imports; `GTAOPass` exige depth texture (fallback bloom+SMAA).

### F4 — Persistência, scripting Lua com sandbox, blueprints, HUD no projeto, Play = GameRuntime, Starter Kit (4-5 semanas; 4 PRs: project, scripting, runtime/play, starter kit)

**Objetivo.** Formato de projeto v2 com round-trip completo; scripts executando em play com API real e orçamento; blueprints pelo mesmo `ScriptAPI`; `GameRuntime` headless usado pelo Play; biblioteca oficial de componentes/scripts; Lua fake e Monaco por CDN removidos.

**Decisões.** `LuaHost` sobre `fengari` + `fengari-interop` (dependências diretas; `fengari-web` sai). Templates viram JSON puro, então os player controllers deixam de ser closures `updateFn` e viram componentes do Starter Kit (`CharacterController` já existe em `GameplayComponents.ts:166`; `CameraFollow` novo absorve a sincronização de câmera de `EditorApp.ts:696-701`).

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `project/{ProjectFile,SceneSerializer,ProjectStorage,IdbProjectStorage,zip,migrations}.ts`, `project/formats/UILayout.ts` | create/move | v2 `{ $type:'bf.project', $version:2, meta, settings:{fixedDt,gravity,shadows,toneMapping,mode:'3d'|'2d'}, scenes, scripts, blueprints, ui, animations, assets }`; `SerializedObject.entity?: {id,name,tags,components:[{typeId,data}]}`; campo `prefab?: {assetId, overrides}` reservado; `.bfproject` = zip (fflate); migração v1 (`userData.__luaScript/__blueprint`, `localStorage['blindfake_ui_layouts']`, `sceneData`); validação por type guards |
| `runtime/{GameRuntime,index}.ts`, `editor/PlayController.ts` (substitui `PlayModeSystem`) | create | `GameRuntime.fromProject(projectFile, {renderer?, canvas?})`, `step(n)`, `start/stop/pause/timeScale`; Play serializa o projeto e cria um runtime com `World` + `THREE.Scene` novos no mesmo canvas; Stop descarta — snapshot/restore morre; `UIManager.registerLayout` alimentado por `ProjectFile.ui` |
| `scripting/{ScriptHost,LuaHost,ScriptSystem,templates}.ts`, `scripting/api/*.ts`, `ecs/components/{Script,Blueprint}.ts` | create | sandbox: `load(chunk, name, 't', env)` allowlist + `lua_sethook` `LUA_MASKCOUNT` → `ScriptBudgetError`; API ligada a `InputManager`, `PhysicsBackend` por `entityId`, `AudioManager`, `TimerManager`, `EventBus` (`off` real), `TweenManager`, `UIManager`; `onFixedUpdate/onUpdate/onCollision`; erro → `script:error` |
| Starter Kit: `modules/gameplay/starter/{CharacterController,CameraFollow,Health,Trigger,Pickup,Door,Checkpoint,Lift,Spawner}.ts`, `scripting/templates.ts`, `docs/STARTER_KIT.md` | create | registrados no `ComponentRegistry`, no "Add Component" do inspector, documentados com exemplo Lua |
| `scripting/blueprint/{types,NodeLibrary,nodes/*,GraphRuntime}.ts`, `ecs/systems/BlueprintSystem.ts`; `panels/VisualScriptEditor.ts` | split/create | extrair linhas 19-105, 107-1548, 1574-1825; `GraphRuntime` com índices por nó, pilha explícita (breakpoint real, `stepOnce`), `flow_delay` via `TimerManager`, limite em loops; 100% dos nós com `execute` ou apagados |
| `panels/ScriptEditorPanel.ts`, `panels/EditorInspector.ts:616-720` | modify | `monaco-editor` via npm (`?worker`, `import()` sob demanda); textarea do inspector morre ("Edit Script" abre a aba Scripting) |
| `engine/ScriptingSystem.ts`, `cinematics/LuaScriptRunner.ts`, `types/fengari-web.d.ts` | delete/modify | sobrevivem `LUA_API_REFERENCE`, `EXTENDED_LUA_TEMPLATES`, `trackToLua`; `CinematicEngine` compila `intro.lua` no `LuaHost` |
| `editor/UIEditorPanel.ts`, `modules/ui/UIManager.ts` | modify | `saveLayout` grava em `ProjectFile.ui`; `UILayoutDef`/`UILayoutData` unificados; HUD dos templates vira layout `hud` |
| `ProjectTemplates.ts` → `project/templates/{empty3d,empty2d,platformer3d}.json` | replace | dados puros; decorativos por Lua; controllers por Starter Kit |
| `EditorProjectFileService.ts`, `EditorAutosaveService.ts`, `LandingPage.ts`, `main.ts` | modify | autosave do `ProjectFile` inteiro por projeto; landing lista `ProjectStorage.list()`; Ctrl+S salva |
| `tests/{LuaHost,ScriptApi,ScriptSystem,GraphRuntime,SceneSerializer.roundtrip,ProjectStorage,templates,GameRuntime,PlayController,StarterKit,UILayout}.test.ts`, `tests/bench/scripts.bench.ts`, `e2e/scripting.play.spec.ts` | create | `while true do end` aborta < 200 ms; `os/io/load` nil; round-trip deep-equal; `GameRuntime.step(300)` determinístico; bench 200 scripts `onUpdate` < 4 ms; e2e: cubo com script gira em play, para no stop, HUD aparece |

**Verificação.** `npm run check` (scripting ≥ 80%, project ≥ 85%, runtime ≥ 70%); `git grep -n 'new Function\|fengari-web\|__luaScript\|jsdelivr\|blindfake_ui_layouts' client/src package.json` = 0 (regra CDN vira error); manual: Add Component → CharacterController + CameraFollow → Play anda com WASD; loop infinito mostra `ScriptBudgetError` sem travar o editor; blueprint roda sem a aba aberta; breakpoint pausa e Step avança; reabrir restaura tudo.
**Riscos.** Custo do `fengari-interop` (expor `self.position` como tabela sincronizada por hook); reentrância Lua↔JS (callbacks enfileirados).

### F5 — Editor sustentável (3-3,5 semanas)

**Objetivo.** Contrato de painel e dispose real, `CommandRegistry` com atalhos por escopo e UI de rebind, `ViewportSurface` + `ViewportModeController`, `GraphCanvas` compartilhado, UI sem strings, um undo para todos os painéis.

**Mudanças (padrão: um PR por painel implementando `EditorPanel`, `innerHTML` → `dom/html`, `cssText` → classes; representativos: `EditorInspector`, `EditorHierarchy`, `VisualScriptEditor`).**
| Caminho | Ação | Nota |
|---|---|---|
| `editor/core/{EditorPanel,PanelHost,CommandRegistry,ShortcutService,ViewportSurface,ViewportModeController,EditorBus,EditorStore}.ts` | create | `EditorPanel { id; mount; unmount; dispose; onActivate? }`; `PanelHost.listen()/raf()` rastreados; comandos `{id,label,shortcut,when,run}` geram menus (Ctrl+N/O/S/Shift+S ganham binding real); escopo por aba; `ViewportSurface` com `dispose/forceContextLoss`; `ViewportModeController` com `Viewport3DMode` default |
| `editor/EditorApp.ts`, `main.ts`, `panels/EditorConsole.ts` | modify | `dispose()` real em `beforeunload` e `import.meta.hot?.dispose`; listeners de `window` via `PanelHost.listen`; `this.editor.*` de 335 para ≤ 60 |
| `editor/ui/{dom,html,tokens,dialogs,ContextMenu,GraphCanvas}.ts`, `styles/editor.css` | create/modify | `html` tagged template com escape; `promptDialog/confirmDialog` em Promise (substituem 32 nativos); `tokens.ts` mapeia `--ed-*`; injeções de `<style>` migram; `GraphCanvas` usado por `VisualScriptEditor` e `AnimStateMachineEditor` |
| `panels/ShortcutsPanel.ts` (novo), `EditorPreferences.ts` | create/modify | rebind com detecção de conflito, persistido |
| `EditorSelectionController.ts`, `EditorToolbar.ts:105` | modify | `pivotMode` passa a ser lido pelo gizmo |
| Painéis 3D (`ModelingRiggingPanel`, `CinematicEditorTab`, `AnimationEditorPanel`, `TerrainEditorPanel`, `SceneGizmos`) | modify (mínimo) | só `dispose()` + `forceContextLoss()` no unmount e RAF via `PanelHost` (migração para modos é na F7) |
| `editor/UndoManager.ts`, `editor/commands/{PropertyCommand,GraphCommand,TextureStrokeCommand,UILayoutCommand}.ts` | create/modify | Scene → `PropertyCommand`; Blueprints/State Machine → `GraphCommand` (`pushUndo` morre); Texture paint → `TextureStrokeCommand`; UI Editor → `UILayoutCommand` |
| `eslint.config.js`, `tests/editor/{ListenerTracker,panels.lifecycle,EditorApp.lifecycle,EditorBus,CommandRegistry,ShortcutService,ViewportSurface,ViewportModeController,GraphCanvas,EditorInspector.updates,commands}.test.ts` | modify/create | `no-unsanitized` e `alert/prompt/confirm` viram error (override para `editor/ui/`); mount→unmount→dispose deixa 0 listeners/RAF; inspector: 100 `object:transformed` → 0 rebuild; Delete no Blueprints não apaga objeto da cena |

**Verificação.** `npm run lint` com regras em error; `grep -rn 'innerHTML' client/src --include=*.ts | grep -v editor/ui/` vazio; e2e: abrir cada aba 3× → contextos criados − perdidos ≤ 6, 0 `pageerror`; manual: gizmo com inspector aberto fluido; Ctrl+Z funciona em grafo, state machine, paint e UI Editor; rebind persiste.
**Riscos.** Migração mecânica longa (224 `innerHTML`, 567 `cssText`) — lint vira error só quando o contador zera.

### F6 — Pipeline de conteúdo: project tree, importação, materiais, textura, prefabs, pasta real, samples, 2D (4,5-5 semanas)

**Objetivo.** Assets por GUID; importação glb/gltf/fbx/obj+mtl, png/jpg/webp/ktx2, mp3/ogg/wav e **extração de AnimationClips como assets**; thumbnails; materiais como assets; edição de textura (paint como Parcial); **prefabs**; pasta real via File System Access; samples rodando no `GameRuntime`; projetos 2D.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `project/{AssetDatabase,AssetImporter,FsaProjectStorage}.ts`, `core/assets/loaders/{Gltf,Fbx,Obj,Texture,Audio}Loader.ts`, `project/formats/Clip.ts` | create | GUID `asset://<guid>`; loaders de `three/addons`; import settings (escala, up-axis, colisores) com Reimport; `gltf.animations` e clips FBX viram assets `clip`; `AnimationComponent` referencia por GUID; FSA grava `MyGame/{project.json,scenes/,scripts/,assets/}`; IndexedDB como fallback |
| `project/formats/Prefab.ts`, `project/SceneSerializer.ts`, `panels/EditorHierarchy.ts`, `panels/EditorInspector.ts` | create/modify | `$type:'bf.prefab'`; instanciar prefab na cena com `overrides` por campo; "Apply to prefab" / "Revert"; cena aninhada = prefab cujo conteúdo é outra cena |
| `panels/ProjectPanel.ts` (novo), `EditorAssetDropService.ts`, `EditorLayoutBuilder.ts` | create/modify | árvore Scenes/Prefabs/Scripts/Blueprints/Models/Clips/Textures/Materials/Audio/UI; DnD do SO e para viewport/inspector; painel inferior Project \| Console |
| `panels/EditorInspector.ts` (MaterialSection), `project/formats/MaterialFile.ts` | modify/create | `.material.json` com slots ligados a assets; `mapSrc`/base64 morrem |
| `panels/TextureEditorPanel.ts` | modify | editor de asset de textura: canais, ajustes, resize/export e paint gravando no asset com `TextureStrokeCommand`; rótulo "Parcial" |
| `editor/modes/Viewport2DMode.ts`, `ecs/components/Sprite.ts`, `modules/physics/RapierPhysics.ts` | create/modify | `OrthographicCamera`, grid XY, gizmo XY+rotZ; `SpriteComponent` com spritesheet; física planar via `enabledTranslations(true,true,false).enabledRotations(false,false,true)` |
| `samples/{platformer-3d,topdown-2d,fps}/`, `LandingPage.ts`, `tests/samples.test.ts` | create/modify | gameplay reescrito com Starter Kit + Lua; teste headless roda cada sample 60 ticks sem `script:error` |
| `tests/fixtures/`, `scripts/make-fixtures.mjs` | create | `rigged-cube.glb` gerado no teste com `GLTFExporter`; `cube-draco.glb` (< 50 KB, commitado); `cube.fbx` CC0 (< 20 KB); `cube.obj+mtl+2x2.png` |
| `tests/{AssetImporter,AssetDatabase,ClipImport,MaterialFile,TextureAsset,Prefab.roundtrip,bfproject.roundtrip}.test.ts`, `tests/physics/planar.test.ts`, `e2e/project.import.spec.ts` | create | importar `rigged-cube.glb` cria 1 `model` + 1 `clip`; DRACO offline; FBX com settings; prefab com override sobrevive round-trip; planar: 600 passos com `z === 0`; e2e: `setInputFiles` de `.glb` aparece em Models e instancia |

**Verificação.** `npm run check` (project ≥ 85%) e `project.import`; manual (Chromium): Novo Projeto em pasta → `ls MyGame`; importar `.fbx` Mixamo, `.obj`, `.glb` DRACO offline; clip aparece no dropdown; criar prefab do player, instanciar 3×, alterar o prefab e ver as 3 mudarem; pintar textura, Ctrl+Z, salvar, reabrir; 2D: sprite de 4 frames com rigidbody cai e anima; Firefox: mesmo fluxo em IndexedDB.
**Riscos.** FSA só em Chromium (landing avisa); FBX com eixos variados; quota de IndexedDB.

### F7 — Animação, modelagem, rig e terreno como modos do viewport (4 semanas)

**Objetivo.** State machine persistida no projeto, gravação de keyframes em clips reais, sequências JSON; modelagem/rig/pesos com undo e preservação de atributos; terreno como modo; timeline única.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `modules/animation/{AnimationModule,AnimationStateMachine}.ts`, `ecs/components/StateMachine.ts`, `scripting/api/animation.ts` | modify/create | `serialize/deserialize` já existem (`:359-381`); falta `StateMachineComponent` serializar `{typeId, stateMachineAssetId, params}` e `ProjectFile.animations`; `animation.setParam/play/crossFade` na `ScriptAPI` |
| `editor/animation/TransformTrackRecorder.ts`, `editor/ui/Timeline.ts`, `editor/commands/KeyframeCommand.ts`, `AnimationEditorPanel.ts`, `CinematicEditorTab.ts`, `AnimStateMachineEditor.ts` | create/modify | keyframes → `THREE.AnimationClip` como asset `clip`; `Timeline.ts` substitui as três timelines (**`EditorTimeline.ts` é apagado aqui**); sequências `.sequence.json` tocadas por `CinematicEngine` |
| `editor/modes/{MeshEditMode,RigMode,TerrainMode}.ts`, `core/geometry/{MeshOps,Topology,Sculpt,Weights}.ts`, `editor/commands/GeometryCommand.ts` | create | funções puras extraídas de `ModelingRiggingPanel.ts` e brushes de `TerrainEditorPanel.ts`; edição sobre `geometry.clone()` com commit por undo; `subdivide` preservando `uv/normal/skinIndex/skinWeight`; pesos k-nearest normalizados; `GLTFExporter` com skin; terreno como componente com heightmap em `assets/terrain`; **os 4 renderers próprios morrem** |
| `project/SceneSerializer.ts` | modify | `SkinnedMesh/Skeleton/Bone` e referências a clips/state machines/terreno |
| `tests/animation/*`, `tests/modeling/*`, `e2e/animation.spec.ts` | create | 2 keyframes → clip interpolado; `Idle→Run` após reload; extrude/inset/subdivide/weld preservam atributos; pesos somam 1; skeleton round-trip |

**Escopo fechado.** Modeling "Parcial" = seleção vértice/aresta/face, mover/rotacionar/escalar, extrude, inset, subdivide, weld, apagar face, inverter normais, salvar asset. Rig "Beta" = cadeia de ossos, bind, auto-pesos k-nearest, pincel de peso. Fora (Planejado): bevel, loop cut, UV editor, IK/retargeting no editor.
**Verificação.** `npm run check` (animation ≥ 70%, geometry ≥ 70%) e e2e; `tests/arch/single-renderer` limite = 2; manual: gravar 3 keyframes, salvar, reabrir, Play reproduz; extrude + Ctrl+Z restaura bytes iguais; cilindro com 2 ossos deforma; terreno esculpido, Play com KCC sobre heightfield.
**Riscos.** Modelagem é poço sem fundo — timebox 2 semanas.

### F8 — Runtime empacotado, export HTML/ZIP/single-file e Electron (2 semanas)

**Objetivo.** `blindfake-runtime.js` gerado da própria engine (Vite lib) sobre o `GameRuntime`; pacote (index.html + runtime + project.json + assets + decoders + scripts + HUD) sem CDN e sem JSON interpolado; pacote Electron pronto para `npm run dist`.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `runtime/{bootGame,dev}.ts`, `client/play.html`, `vite.runtime.config.ts` | create | `bootGame(canvas, projectUrlOrData)`; `build.lib` com `formats: ['es','iife']` (IIFE para `file://`); `build` = `build:runtime && tsc && vite build`; `/play.html?project=<id>` substitui o antigo "Exit to Game"; `no-restricted-imports`: `runtime/`/`core/` não importam `editor/` |
| `export/{PackExporter,ExportManifest,ElectronExporter}.ts`, `export/templates/*` | create | zip com `index.html` (import do runtime), `project.json`, `assets/<hash>`, `scripts/<id>.lua`, `decoders/**`; single-file: IIFE inline + JSON em `<script type="application/json">` com `</` → `<\/`; Electron reaproveita os geradores salvos em `docs/decisions/` (F1), CSP `default-src 'self'`, `contextIsolation/sandbox` |
| `panels/EditorMenuBar.ts`, `editor/dialogs/ExportDialog.ts` | modify/create | comandos `file.export.pack` (Ctrl+E), `.single`, `.electron` |
| `scripts/export-smoke.mjs`, `tests/{PackExporter,ElectronTemplates}.test.ts`, `e2e/{export.pack,first-game}.spec.ts`, `ci.yml`, `docs/EXPORT.md` | create/modify | nome com `</script>` não quebra; zip sem `http`; Electron: teste estático dos templates (CSP, `nodeIntegration:false`); e2e `export.pack`: exporta cubo com script + HUD, serve estático, `rotation.y` cresce, HUD visível, 0 `pageerror`, repete single-file via `file://`; e2e `first-game`: novo projeto → cubo → CharacterController → script → export → roda (≤ 3 min no CI); budget ≤ 4 MB gz |

**Verificação.** `npm run build:runtime` ≤ 4 MB gz; `npx playwright test export.pack first-game`; determinismo por contagem de ticks (`GameRuntime.step(300)` sobre o bundle); manual: exportar platformer → `npx serve` → física, Lua, blueprints, animação e HUD iguais ao Play; Network sem domínios externos; Electron: `npm i && npm run dist` no Windows gera `.exe` (manual, documentado).
**Riscos.** Tamanho (three + rapier wasm + fengari); `electron-builder` exige toolchain do SO alvo.

### F9 — Multiplayer mínimo real, docs geradas e fechamento (3 semanas)

**Objetivo.** Servidor autoritativo simples (salas, tick 20 Hz, `WORLD_STATE`/`PLAYER_INPUT`, ack de sequence) usado por um `NetworkModule` e por um lobby no jogo exportado; docs de API geradas; README/ROADMAP/METRICS finais; `ignore` do knip removido.

**Mudanças.**
| Caminho | Ação | Nota |
|---|---|---|
| `server/src/rooms/Room.ts`, `server/src/server.ts`, `shared/protocol.ts`, `shared/types.ts` | create/modify | tick 20 Hz emitindo snapshots; aplica `PLAYER_INPUT`; rate limit por socket, origin allowlist, senha de sala; `NetworkMessage.payload` vira união discriminada |
| `modules/network/{NetworkModule,ReplicationSystem}.ts`, `scripting/api/network.ts`, `modules/ui/Lobby.ts`, `panels/MultiplayerPanel.ts`, `knip.json` | create/modify | embrulha `NetworkManager`; `ReplicatedTransformComponent` interpolando; `network.isConnected/playerId/send/on`; lobby com chat |
| `docs/api/` (typedoc), `docs/LUA_API.md`, `docs/STARTER_KIT.md`, `docs/tutorials/{01_first_game,02_scripting}.md`, `tests/docs.test.ts`, README/ROADMAP/METRICS | create/modify | CI falha em warnings do typedoc; teste valida que todo símbolo documentado existe; tutoriais só com passos reproduzidos pelos e2e |
| `tests/server/rooms.test.ts`, `tests/modules/ReplicationSystem.test.ts`, `e2e/multiplayer.spec.ts` | create | dois clientes `ws`; spam desconecta o spammer; dois `BrowserContext` no jogo exportado contra servidor real em porta efêmera |

**Verificação.** `npm run check` (server ≥ 80%, network ≥ 70%) e e2e multiplayer; manual: dois browsers, sala com senha, movimento interpolado; `npm run docs:api` sem warnings; `check-readme-claims` final; `knip` = 0 sem `ignore`.
**Riscos.** Física autoritativa fora de escopo (autoridade de posição por input, documentado); e2e com dois clientes pode ser flaky (retry 1×).

---

## Lista consolidada de cortes

| Motivo | Arquivos | O que morre junto |
|---|---|---|
| Zero importadores (F1) | `2d/{Physics2D,Sprite2D}`, `ai/{Pathfinding,StateMachine,BehaviorTree}`, `engine/{CameraController,EditorEventBus,LightingManager,PerformanceMonitor,ProceduralGeneration,RaycastUtils,VegetationSystem,AssetManifest}`, `gameplay/InventorySystem`, `workers/PhysicsWorker`, `editor/{EditorManager,CinematicEditorPanel,ParticleEditorPanel,ModelInspectorPanel,LayoutPresets,PanelPersistenceService,SceneVersioning,KeybindEditor}` | `useKeybindEditor` |
| Só testes (F1) | `engine/{UISystem,AudioMixer,AudioEffects,TouchInputManager,VirtualJoystick,Benchmark,SpatialAudioManager,AdaptiveMusicSystem}`, `network/{ClientPrediction,EntityReplicator,RoomManager}` | 10 arquivos de teste (171 casos) |
| Fachada/inviável (F1) | `engine/{WebGPURenderer,GameExporter,ElectronExporter,BuildExportSystem,PluginSystem,HotReload,WorkerManager,AssetPipeline,AssetDependencyGraph,Profiler,LightProbeSystem,OcclusionCulling,SplineSystem}`; opção `'river'` | `Engine.ts`, menu de export/Exit to Game, `PlayModeSystem.ts:12`, seção Plugins, `tests/BuildSystem.test.ts` |
| Construído e nunca renderizado (F1) | `panels/{AssetBrowser,MaterialEditor}`, `editor/MultiSelect`; div `timelinePanel` | `EditorApp.ts:361-365`, menu Window→Timeline/Asset Browser (`EditorTimeline.ts` **não**, vivo até F7) |
| Templates imperativos (F1/F4) | 6 de 9 funções de `ProjectTemplates.ts` (F1); arquivo inteiro vira JSON + Starter Kit (F4) | `tests/ProjectTemplates.test.ts` −7 casos; tipo `ProjectTemplate` 9 → 3 |
| Docs inventadas/corrompidas (F1) | `docs/API.md`, `docs/tutorials/*` | — |
| Sem consumidor no núcleo (F3) | `engine/{PerformanceManager,PrefabManager,SaveManager,PostProcessing,FogSystem}`, `TerrainSystem.generateCollisionMesh` | seções do `EngineSystemsPanel`, chamadores em `ProjectTemplates.ts:209` e `TerrainEditorPanel.ts:977` |
| Scripting fake (F4) | `engine/ScriptingSystem.ts`, `cinematics/LuaScriptRunner.ts` (exceto referência/templates/`trackToLua`), `types/fengari-web.d.ts`, dep `fengari-web`, textarea do inspector, `editor/PlayModeSystem.ts` | `ScriptEditorPanel.ts:13-18`, `CinematicEngine.ts`, testes adaptados |
| Persistência fora do projeto (F4) | `localStorage['blindfake_ui_layouts']`, `blindfake_autosave` global, `LandingPage.sceneData`, HUD DOM dos templates | migração v1 → v2 |
| Substituído por implementação real (F5/F7) | 5 `escapeHtml`, 12 context menus, 32 diálogos nativos, canvas do `AnimStateMachineEditor`, `pushUndo` do grafo, renderers de 4 painéis 3D, `EditorTimeline.ts` + 2 timelines, `subdivideMesh` | — |

## Gates de qualidade

- **CI** (Node 20.19 e 22): typecheck ×3, lint, coverage, build, build:server, `check-encoding` (blocking desde F2), `knip` (blocking desde F1), `check-readme-claims` (F1), Playwright (`editor.smoke` desde F0; `scripting.play` F4; `project.import` F6; `animation` F7; `export.pack` + `first-game` + budget F8; `multiplayer` F9), `export-smoke` (F8), `docs:api` (F9). Nenhum gate é removido depois de entrar.
- **Lint:** `no-new-func`/`no-implied-eval` error desde F0; CDN warn → error na F4; `constructor.name` error na F3; `no-unsanitized` e `alert/prompt/confirm` error na F5; `no-restricted-imports` (`runtime/`, `core/` não importam `editor/`) na F8.
- **Cobertura (v8, por pasta):** F3 core ≥ 70, ecs ≥ 80, physics ≥ 60, server ≥ 70; F4 scripting ≥ 80, project ≥ 85, runtime ≥ 70; F7 animation ≥ 70, geometry ≥ 70; F9 server ≥ 80, network ≥ 70; global ≥ 40% ao fim.
- **Benches com orçamento** (regressão > 20% falha): física 2000 corpos, cloth/navmesh/IK (F3), 200 scripts Lua < 4 ms (F4).
- **Segurança:** HTML com dado de usuário só via `html`/`textContent`; scripts só via `LuaHost` com allowlist e orçamento; export sem JSON interpolado em JS e CSP `default-src 'self'` no Electron; servidor com `maxPayload`, type guards, rate limit, origin allowlist; `/api/dev-errors` e `DevErrorTracker` só em DEV.
- **Arquitetura por teste:** `tests/arch/single-renderer` (15 → 7 F1 → 6 F2 → 2 F7); contador de contextos WebGL no e2e; `panels.lifecycle` + `EditorApp.lifecycle` (0 listeners/RAF após dispose); `GraphRuntime` (100% dos nós com `execute`); `EditorInspector.updates` (0 rebuild por transform); `StarterKit` e `docs.test` (tudo documentado existe).

## Métricas de progresso (`scripts/metrics.mjs` → `docs/METRICS.md`)

**Baseline medido:** 73.209 linhas de produto + 5.077 de testes; 156 arquivos TS em `client/src`; 14 módulos sem importador + 8 órfãos do editor + 11 só-teste; 331 `it()` (345 em runtime), 45 asserções fracas; 224 `innerHTML =`, 567 `cssText =`, 32 `alert/prompt/confirm`, 679 `addEventListener` vs 72 `removeEventListener`; 7 `constructor.name`; 32 tokens `--ed-*` / 0 usados em TS; 13 injeções de `<style>`; 335 `this.editor.`; 15 `new THREE.WebGLRenderer`; 9 referências a CDN; 2 `new Function`; 17 `new *System()` no construtor do Engine; 20 usos de `editorActive`; 11 arquivos com codificação corrompida; 0 arquivos de CI/lint.

**Metas:** produto F1 ≤ 53k linhas, F5 ≤ 50k (testes à parte); módulos mortos = 0 desde F1; testes reais F1 ≈ 143, F3 ≥ 200, F5 ≥ 300, F9 ≥ 450 com asserções fracas ≤ 5; `innerHTML` fora de `ui/` = 0 e diálogos nativos = 0 na F5; `this.editor.` ≤ 60; `WebGLRenderer` = 6 na F2 e 2 na F7; contextos WebGL na aba Scene = 1 desde F2; CDN = 0 e `new Function` = 0 na F4; runtime ≤ 4 MB gz; e2e `first-game` ≤ 3 min.

## Perguntas ainda em aberto (não bloqueiam o início)

1. **Armazenamento:** IndexedDB (todos) + pasta real via File System Access (só Chromium) basta, ou Firefox/Safari precisam de paridade além do `.bfproject`? (assumido: basta)
2. **Multiplayer:** autoridade só de posição por input basta, ou quer física autoritativa (Rapier no Node)? (assumido: posição por input)
3. **Samples:** só platformer-3d, topdown-2d e fps na F6, ou recriar também MainMenu/Fighting/Racing/Puzzle? (assumido: 3)
4. **Histórico git:** PRs pequenos na branch com tag `pre-rework`; squash por fase ou histórico granular? (assumido: granular)
5. **Dependências novas:** `fengari`, `fengari-interop`, `fflate`, `monaco-editor`, `@playwright/test`, `knip`, `typedoc`, `fake-indexeddb`, `eslint-plugin-no-unsanitized`. Alguma restrição?

## Verificação de ponta a ponta (ao final)

1. `nvm use && npm ci && npm run check` verde (typecheck ×3, lint, coverage com thresholds, build, build:server, knip, check-encoding, check-readme-claims).
2. `npx playwright test` verde: `editor.smoke`, `scripting.play`, `project.import`, `animation`, `export.pack`, `first-game`, `multiplayer`.
3. Roteiro manual do "primeiro jogo": Novo Projeto em pasta → importar `.glb` rigado → Add Component CharacterController + CameraFollow → script Lua Rotate em um cubo → blueprint em outro → HUD com texto → criar prefab e instanciar 2× → Play (WASD anda, clip toca, HUD aparece) → Export pack → `npx serve` reproduz o mesmo → Electron `npm run dist` gera `.exe`.
4. `docs/METRICS.md` com todas as metas atingidas e README sem nenhuma feature marcada "Funciona" que não tenha teste.

## Primeiro passo ao sair do modo plano

Executar a **F0** integralmente (instalar, `npm run check`, CI, lint, e2e smoke v0, `docs/decisions/0000-rework-plan.md`, tag `pre-rework`), commitar e fazer push na branch `claude/lucid-gauss-a1vpbn`, e só então iniciar a F1.
