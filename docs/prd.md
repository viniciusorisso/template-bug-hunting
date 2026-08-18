# PRD: TS Bug Hunt

## Document Control

- Status: Rascunho v0.1
- Owner: Risso
- Stakeholders: instrutor, alunos do cursinho, monitores
- Last updated: 2026-08-18

## Executive Summary

TS Bug Hunt e uma plataforma de treino rapido de TypeScript em formato de bug hunting. O aluno recebe um trecho de codigo com aproximadamente 10 bugs intencionais de categorias e dificuldades variadas, seleciona a regiao que considera incorreta, descreve a correcao e recebe feedback automatico.

O produto deve servir tanto para iniciantes identificarem problemas claros quanto para pessoas mais experientes encontrarem bugs sutis de TypeScript, logica de negocio, imutabilidade, edge cases e validacao.

## Problem Statement

Cursos rapidos de TypeScript frequentemente ficam entre teoria abstrata e exercicios pequenos demais. O instrutor precisa de uma experiencia pratica que force leitura de codigo, raciocinio sobre tipos, comportamento em runtime e qualidade de correcao, com feedback rapido e embasamento tecnico para discussao em aula.

## Target Users

- Alunos iniciantes em TypeScript que precisam reconhecer problemas comuns de nullability, loops, comparacoes e validacao.
- Alunos intermediarios ou experientes que precisam identificar bugs menos obvios de modelagem, efeitos colaterais, dinheiro, datas e edge cases.
- Instrutor ou monitor que precisa acompanhar quais bugs ja foram resolvidos e usar cada bug como ponto de discussao tecnica.

## Goals

- G-001: Disponibilizar um desafio inicial com cerca de 10 bugs intencionais, cada um com categoria, dificuldade, resposta esperada e embasamento tecnico.
- G-002: Permitir que o aluno selecione um trecho de codigo e submeta uma explicacao ou correcao.
- G-003: Validar cada submissao por uma camada deterministica de testes/validadores.
- G-004: Exibir feedback claro para respostas corretas, parciais, duplicadas e incorretas.
- G-005: Preparar a arquitetura para notificacoes em tempo real quando um bug for resolvido.
- G-006: Manter o MVP simples o suficiente para ser usado em aula sem configuracao pesada.
- G-007: Entregar a primeira UI em Vue sem acoplar regras de negocio ao framework, permitindo evolucao futura para React, Angular ou outro frontend.

## Non-Goals

- Construir uma IDE completa ou permitir edicao livre de varios arquivos no MVP.
- Executar codigo arbitrario enviado pelo aluno no servidor durante o MVP.
- Ter ranking, autenticacao, turmas, permissoes ou historico multi-aula na primeira entrega.
- Gerar bugs dinamicamente por IA.
- Suportar multiplas linguagens alem de TypeScript no primeiro desafio.
- Implementar React, Angular ou multiplas UIs no MVP.

## User Journeys

1. O aluno abre o desafio, le o codigo em uma interface estilo editor e seleciona um trecho suspeito.
2. A plataforma abre um popup com a selecao, um campo para a correcao proposta e um botao de envio.
3. Ao submeter, a plataforma roda a switch de teste correspondente aos validadores do desafio.
4. Se a resposta estiver correta, o bug e marcado como resolvido, o aluno recebe feedback tecnico e a sala recebe uma notificacao.
5. Se a resposta estiver parcial ou incorreta, o aluno recebe uma orientacao curta sem revelar completamente a solucao.
6. O instrutor usa o catalogo de bugs e os feedbacks como base para explicar o comportamento correto.

## Scope

### In Scope

- Tela unica do desafio com codigo TypeScript em editor read-only.
- Selecao de range de codigo por linha/coluna.
- Modal de submissao com proposta de correcao.
- API de submissao com validacao deterministica.
- Estado local ou em memoria para bugs resolvidos no MVP.
- Notificacao simples quando um bug for resolvido.
- Catalogo inicial com 10 bugs e embasamento tecnico.
- Testes unitarios para validadores e testes de componente para fluxo principal.

### Out of Scope

- Banco de dados persistente obrigatorio.
- Login e controle de usuarios.
- Editor colaborativo.
- Execucao de patches reais enviados pelo aluno.
- Painel administrativo completo.
- Analise semantica profunda de codigo TypeScript na primeira versao.

## Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-001 | A plataforma deve exibir um desafio de codigo TypeScript em uma interface semelhante a um editor. | Must | O aluno consegue visualizar o codigo com numeracao de linhas, realce de sintaxe e sem edicao direta no MVP. |
| FR-002 | O aluno deve conseguir selecionar um trecho de codigo para denunciar como bug. | Must | A selecao captura `startLine`, `startColumn`, `endLine` e `endColumn` de forma consistente. |
| FR-003 | O aluno deve conseguir submeter uma correcao ou explicacao para a selecao. | Must | O modal envia `challengeId`, range selecionado e texto da solucao para a API. |
| FR-004 | A submissao deve ser validada por uma switch de testes server-side. | Must | Cada submissao passa por um `testId` conhecido e retorna status deterministico. |
| FR-005 | A plataforma deve reconhecer respostas corretas, parciais, duplicadas e incorretas. | Must | A resposta da API inclui `status`, `feedback` e, quando aplicavel, `bugId`. |
| FR-006 | Bugs resolvidos devem ficar marcados no progresso da sessao. | Must | Um bug aceito nao pode contar duas vezes na mesma sessao. |
| FR-007 | Ao resolver um bug, a plataforma deve disparar uma notificacao. | Must | No MVP, um `alert` ou banner e exibido; a arquitetura deve permitir trocar por socket depois. |
| FR-008 | Cada bug deve ter embasamento tecnico acessivel ao instrutor e exibivel apos resolucao. | Must | O catalogo inclui categoria, dificuldade, causa raiz, impacto, correcao esperada e referencia ao validador. |
| FR-009 | O desafio inicial deve conter bugs de dificuldade variada. | Must | O catalogo tem pelo menos 3 bugs faceis, 4 medios e 3 dificeis. |
| FR-010 | O instrutor deve conseguir alterar o desafio inicial via definicao estruturada. | Should | O desafio fica definido em objeto TypeScript ou JSON versionado, sem depender de alteracao espalhada pela UI. |
| FR-011 | A plataforma deve estar preparada para notificacao em tempo real via socket. | Should | Existe uma interface de notificacao desacoplada do `alert` usado no MVP. |
| FR-012 | O MVP deve usar Vue como framework de interface. | Must | A aplicacao principal e implementada com Vue 3 + TypeScript. |

## Non-Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| NFR-001 | A validacao deve ser deterministica. | Must | A mesma submissao no mesmo estado retorna o mesmo resultado. |
| NFR-002 | O MVP nao deve executar codigo arbitrario enviado pelo aluno. | Must | O texto da correcao e tratado como dado; validadores fazem matching estrutural/textual controlado. |
| NFR-003 | A UI deve funcionar em notebook comum usado em aula. | Must | A tela principal e utilizavel em viewport desktop padrao e nao depende de monitor grande. |
| NFR-004 | A experiencia deve ser acessivel por teclado no fluxo principal. | Should | E possivel abrir, preencher e enviar o modal sem mouse depois de selecionar ou focar o trecho. |
| NFR-005 | A base deve ser facil de testar. | Must | Validadores sao funcoes puras ou quase puras, cobertas por testes unitarios. |
| NFR-006 | A arquitetura deve permitir evoluir para persistencia e turmas. | Should | Contratos incluem `sessionId`/`userId` opcionais sem obrigar autenticacao no MVP. |
| NFR-007 | Regras de negocio e validadores nao devem depender de Vue. | Must | Catalogo, engine de validacao, tipos de submissao e notificacoes ficam em modulos TypeScript reutilizaveis fora de componentes `.vue`. |

## UX and Content Requirements

- A primeira tela deve ser a experiencia do desafio, nao uma landing page.
- A interface deve lembrar um editor de codigo, mas com controles reduzidos ao necessario: arquivo atual, progresso, selecao e submissao.
- Feedback incorreto nao deve entregar a resposta completa.
- Feedback correto deve liberar o embasamento tecnico do bug.
- O progresso deve ser claro: total de bugs resolvidos, pendentes e tentativas.

## Data, Privacy, and Compliance

- No MVP, nao ha necessidade de coletar dados pessoais.
- Caso exista `userId` ou `sessionId`, eles devem ser identificadores tecnicos de sessao, nao dados sensiveis.
- Submissoes podem ser mantidas em memoria durante a aula ou persistidas posteriormente.

## Dependencies and Constraints

- O projeto ainda nao possui scaffold, Git ou stack instalada.
- Assumimos uma aplicacao web Vue 3 + TypeScript para o MVP.
- A arquitetura deve separar dominio e UI para permitir uma interface futura em React, Angular ou outro framework.
- Para o editor, a escolha recomendada e Monaco em modo read-only ou CodeMirror se o peso do bundle virar problema.
- A notificacao socket sera faseada: primeiro interface/adaptador, depois transporte real.

## Success Metrics

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Bugs encontrados por aluno durante a aula | TBD | TBD | Contagem de `bugId` resolvidos por sessao |
| Tempo ate primeira submissao correta | TBD | TBD | Timestamp de inicio e primeira resposta aceita |
| Cobertura de validadores | 0 | 100% dos bugs do desafio inicial | Testes unitarios por `testId` |
| Taxa de bugs com embasamento tecnico | 0 | 100% | Revisao do catalogo |

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Validacao textual ficar fragil demais. | Alto | Media | Combinar range esperado, palavras-chave, sinonimos e casos de teste por bug. |
| Alunos acharem bugs fora do catalogo. | Medio | Alta | Permitir status `partial` ou `unknown` e registrar para revisao do instrutor. |
| Monaco aumentar complexidade do MVP. | Medio | Media | Manter CodeMirror como alternativa tecnica. |
| Bugs dificeis ficarem obscuros demais para aula curta. | Medio | Media | Organizar dificuldade e liberar dicas graduais no futuro. |
| Socket atrasar entrega principal. | Baixo | Media | Entregar primeiro adaptador com `alert` e trocar implementacao depois. |

## Rollout Considerations

1. Rodar o MVP localmente com o instrutor.
2. Fazer uma sessao piloto com poucos alunos.
3. Ajustar validadores com base nas respostas reais.
4. Depois incluir socket, persistencia e possivel ranking.

## Assumptions

- O primeiro desafio sera um unico arquivo TypeScript.
- A correcao enviada pelo aluno sera texto livre no MVP.
- O objetivo principal e ensinar leitura e raciocinio, nao aplicar patch automatico.
- O instrutor aceita um `alert` ou banner temporario para notificacao de bug resolvido.
- A primeira implementacao sera Vue 3; suporte real a React/Angular fica como evolucao posterior.

## Open Questions

- A aula sera individual, em duplas ou competitiva em grupo?
- O instrutor quer revelar o embasamento tecnico imediatamente apos cada acerto ou somente ao fim?
- O primeiro deploy precisa ser local, em ambiente web publicado ou integrado a alguma plataforma de aula?

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-18 | Planejar MVP com editor read-only e submissao por range. | Reduz complexidade e atende ao formato de bug hunting. |
| 2026-08-18 | Validacao inicial sera deterministica por switch de testes. | Facilita ensino, previsibilidade e cobertura automatizada. |
| 2026-08-18 | Socket fica preparado por interface, mas implementacao real entra apos fluxo principal. | Evita atrasar o MVP por funcionalidade secundaria. |
| 2026-08-18 | MVP sera implementado em Vue 3, mantendo dominio e contratos agnosticos de framework. | Atende a preferencia atual sem bloquear React, Angular ou outras UIs no futuro. |
