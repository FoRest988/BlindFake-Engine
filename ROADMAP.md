# Roadmap

O roadmap é o plano de rework em `docs/decisions/0000-rework-plan.md` (versão completa em `0000-rework-plan-full.md`). Este arquivo resume as fases e o estado de cada uma.

| Fase | Objetivo | Estado |
|---|---|---|
| F0 | Baseline, gates de qualidade (typecheck de testes, lint, cobertura, knip, encoding), smoke e2e, CI | Concluída |
| F1 | Corte de código morto, fachadas, painéis nunca montados e templates imperativos; README honesto | Concluída |
| F2 | Bugs de runtime: loop único, `setMode`, timestep fixo, autosave por projeto, servidor blindado, worker de erosão, codificação | Concluída |
| F3 | Núcleo pequeno com módulos opt-in, ECS com `typeId`, heightfield e contatos, `EffectComposer`, decoders locais | Próxima |
| F4 | Formato de projeto v2, Lua real (fengari) com sandbox, blueprints executando em play, HUD no projeto, Play = GameRuntime, Starter Kit | Planejado |
| F5 | Contrato de painel, comandos e atalhos por aba, UI sem `innerHTML`, undo único, dispose real | Planejado |
| F6 | Project tree, importação (modelos, texturas, áudio, clips), materiais, prefabs, pasta real, samples, modo 2D | Planejado |
| F7 | Animação, modelagem, rig e terreno como modos do viewport; timeline única | Planejado |
| F8 | Runtime empacotado, export HTML/ZIP/single-file e desktop | Planejado |
| F9 | Multiplayer mínimo real, docs geradas, fechamento | Planejado |

O que foi removido na F1 e por quê está listado em `README.md` (tabela "Removido") e nas mensagens de commit correspondentes. O commit anterior ao rework está marcado com a tag `pre-rework`.
