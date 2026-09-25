# Primeiros passos

## Requisitos

- Node.js 20.19+ ou 22.12+ (`nvm use` lê o `.nvmrc`)
- Um navegador com WebGL 2 (Chrome, Edge, Firefox)

## Instalar e rodar

```bash
npm ci
npm run dev
```

Abra `http://localhost:3000`. O servidor de salas (`npm run dev:server`, porta 4000) é opcional: o editor funciona sem ele.

## Criar um projeto

1. Na landing page, clique em **+ New Project**.
2. Dê um nome e escolha um template: **3D Empty**, **2D Empty** ou **Platformer 3D**.
3. O editor abre na aba **Scene**.

Os projetos ficam no `localStorage` do navegador. Ao reabrir um projeto o template é aplicado de novo; a cena editada só volta se você tiver salvo um `.bfproject` (menu File) ou se aceitar a restauração do autosave.

## Editor

- **Abas:** Scene, Terrain, Animation, Cinematic, State Machine, Scripting, Blueprints, UI Editor, Modeling, Textures.
- **Viewport:** botão direito para orbitar, roda para zoom, botão do meio para pan. `F` foca o objeto selecionado.
- **Ferramentas:** `Q` selecionar, `W` mover, `E` rotacionar, `R` escalar. `G` alterna a grade.
- **Edição:** `Ctrl+Z` desfazer, `Ctrl+Y` refazer, `Ctrl+D` duplicar, `Delete` apagar, `Ctrl+A` selecionar tudo, `H` ocultar.
- **Play:** `F9` entra e sai do play mode. Ao sair, as transformações da cena são restauradas.
- **Add:** menu Add para primitivas, luzes, câmeras e caminhos; File > Import Model para GLTF/GLB/FBX/OBJ (ou arraste o arquivo para o viewport).

## Scripts e blueprints

A aba **Scripting** edita scripts Lua anexados aos objetos e a aba **Blueprints** edita grafos visuais. Hoje eles **não executam durante o play**: isso chega na fase F4 do rework (`docs/decisions/0000-rework-plan.md`). O botão Simulate da aba Blueprints roda o grafo uma vez dentro do editor.

## Salvar

- **File > Save Project** baixa um `.bfproject` com a cena, texturas e o grafo de blueprint atual; **Load Project** carrega o arquivo.
- **File > Save Scene** baixa a cena em JSON; **Load Scene** carrega.
- O autosave grava no `localStorage` a cada poucos segundos e oferece restauração ao reabrir.

## Verificar o código

```bash
npm run check      # typecheck, lint, claims do README, testes com cobertura, builds
npm run test:e2e   # abre o editor no Chromium e passa pelas abas de cada template
npm run metrics    # números de saúde do código (docs/METRICS.md)
```

## Onde ler mais

- `README.md`: tabela do que funciona, o que é parcial e o que foi removido.
- `ROADMAP.md`: fases do rework.
- `docs/decisions/0000-rework-plan.md`: o plano completo, com arquitetura alvo, cortes e gates.
