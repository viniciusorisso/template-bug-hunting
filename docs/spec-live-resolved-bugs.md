# Technical Specification: Live Resolved Bugs and Guided Celebration UX

## Document Control

- Status: Rascunho v0.1
- Authors: Codex
- Reviewers: Risso
- Last updated: 2026-08-18
- Source requirements: [PRD](prd.md), [Technical Specification MVP](spec.md), pedido do usuario em 2026-08-18 sobre atualizacao visual do arquivo, comparacao antes/depois, balao animado e navegacao ate o bug resolvido

## Summary

Esta evolucao adiciona duas capacidades principais ao TS Bug Hunt:

1. Quando um bug for resolvido, o arquivo exibido no editor deve refletir a correcao para todos os participantes conectados ao mesmo desafio, preservando o codigo original e o historico de resolucoes. O trecho corrigido deve ganhar destaque visual e affordance de hover para inspecionar antes/depois e o codigo associado ao bug.
2. Ao resolver um bug, a UI deve exibir um balao animado subindo da base da tela ao topo durante 4 segundos com o codigo do bug. Ao clicar no balao, o usuario abre um modal com resumo do bug e pode fechar ou navegar ate o trecho resolvido no editor.

O objetivo nao e transformar o produto em editor colaborativo livre. O arquivo continua derivado de um catalogo versionado e so muda por aplicacao de correcoes predefinidas por bug aceito.

## Context and Current State

- O MVP atual renderiza o codigo-fonte do desafio a partir de um `source` fixo do catalogo.
- A API valida submissoes e ja emite eventos em tempo real quando um bug e resolvido.
- A UI atual mostra feedback, progresso e notificacao simples, mas nao altera o codigo exibido apos uma resolucao.
- O catalogo atual conhece `expectedRange`, `expectedFix` e `technicalBasis`, mas nao possui patch estruturado para reconstruir o arquivo corrigido.
- Existe requisito implicito de manter tres visoes coerentes ao mesmo tempo:
  - codigo original do desafio para auditoria e historico;
  - log de bugs resolvidos em ordem cronologica;
  - codigo efetivo visivel no editor, com os patches aplicados sobre o original.

## Goals and Non-Goals

### Goals

- Atualizar o codigo exibido no editor principal quando bugs forem resolvidos.
- Sincronizar essa atualizacao em tempo real para todos os clientes conectados ao desafio.
- Preservar o estado original do arquivo e o log de resolucoes separadamente do display derivado.
- Destacar visualmente linhas corrigidas e permitir inspecao de antes/depois por hover.
- Exibir uma animacao temporaria de balao por bug resolvido.
- Permitir abrir um modal a partir do balao e navegar ate o bug resolvido no editor.
- Fazer o highlight dos bugs resolvidos seguir a linguagem visual do tema VS Code Dark Modern.

### Non-Goals

- Permitir edicao livre do codigo pelos usuarios.
- Executar merge semantico arbitrario de patches enviados pelo aluno.
- Versionar multiplos arquivos no mesmo desafio nesta etapa.
- Substituir o catalogo textual atual por AST transforms genericos.
- Persistencia obrigatoria em banco nesta etapa.

## Requirements Traceability

| Requirement | Technical Design | Verification |
|---|---|---|
| R-001 | Cada `BugDefinition` passa a incluir patch estruturado da correcao e metadados de diff. | Teste de integridade do catalogo valida patch de todos os bugs. |
| R-002 | O estado do desafio mantem `baseSource`, `resolvedBugLog` e `derivedSource` separados. | Teste unitario valida que recomputar o display nao muta o original. |
| R-003 | Ao resolver bug, a API publica evento com patch aplicado e linhas afetadas. | Teste de API/SSE valida payload do evento. |
| R-004 | O frontend recompõe o arquivo exibido a partir do original mais bugs resolvidos. | Teste de componente valida atualizacao do editor apos evento remoto e local. |
| R-005 | Linhas resolvidas ganham destaque visual persistente e hover com antes/depois. | Teste de componente e teste visual validam estado destacado e tooltip/popover. |
| R-006 | Ao resolver bug, aparece balao animado por 4 segundos com o codigo do bug. | Teste de componente valida criacao, ciclo de vida e dismiss automatico. |
| R-007 | Clique no balao abre modal com codigo e descricao breve do bug. | Teste de componente valida abertura do modal e conteudo. |
| R-008 | Acao “ver o bug resolvido” leva o usuario ao trecho corrigido no editor. | Teste de componente valida scroll/foco para a linha correta. |
| R-009 | O highlight de bugs resolvidos deve seguir o visual do tema VS Code Dark Modern. | Revisao visual e teste de regressao CSS validam tokens, contraste e consistencia com o tema. |

## Proposed Design

### Architecture

Adicionar uma camada de projecao de codigo resolvido entre o catalogo e o editor:

- `packages/core`
  - estende o catalogo com patches estruturados por bug;
  - expoe um projetor puro `projectResolvedSource` que recebe o source original e a lista ordenada de bugs resolvidos;
  - expoe metadados de diff por bug para hover, highlight e navegacao.
- `apps/api`
  - mantem em memoria o log ordenado de bugs resolvidos por sessao/desafio;
  - enriquece o evento `bug.resolved` com patch aplicado e snapshot derivado opcional;
  - oferece endpoint para obter o estado agregado atual do desafio, inclusive bugs resolvidos globalmente.
- `apps/web-vue`
  - substitui o uso direto de `challenge.source` por `displayedSource` derivado;
  - destaca linhas corrigidas;
  - mostra popover antes/depois no hover;
  - coordena a fila de baloes animados e o modal de celebracao/detalhe.

### Design Choice

Abordagem selecionada: patch declarativo por substituicao de range em texto, aplicado em ordem deterministica de linha.

Motivos:

- O desafio atual e um unico arquivo TypeScript conhecido e versionado.
- Cada bug ja possui `expectedRange`, o que reduz o custo de definir um patch explicito.
- O patch declarativo e mais simples e auditavel do que AST transform nesta fase.
- Mantem a derivacao pura e facil de testar.

Tradeoff:

- Se dois bugs modificarem linhas sobrepostas, o catalogo precisara definir ordem e compatibilidade explicitamente.

### Visual Direction

O destaque visual dos bugs resolvidos deve seguir a referencia do tema VS Code Dark Modern, em vez de usar um verde generico sem contexto. Isso vale para:

- fundo do highlight persistente;
- borda ou gutter accent da linha resolvida;
- hover/focus state do trecho resolvido;
- tooltip/popover de before/after;
- highlight temporario quando o usuario clicar em “ver o bug resolvido”.

Diretriz:

- a implementacao deve derivar tokens locais inspirados no Dark Modern, preservando legibilidade sobre o fundo escuro atual do editor;
- o trecho resolvido deve parecer parte natural do ecossistema visual do VS Code, nao um overlay arbitrario;
- se houver diferenca entre fidelidade visual e contraste minimo aceitavel, contraste e legibilidade vencem.

### Components and Responsibilities

| Component | Responsibility |
|---|---|
| `ResolvedSourceProjector` | Aplica os patches dos bugs resolvidos sobre o source original e produz `derivedSource` e metadados de diff. |
| `ResolvedBugRegistry` | Mapeia `bugId` para patch, descricao curta, resumo visual e linhas afetadas. |
| `ChallengeAggregateStore` | Mantem estado agregado do desafio visivel para todos: bugs resolvidos globais, `derivedSource`, highlights e fila de animacoes. |
| `CodeViewer.vue` | Renderiza `displayedSource`, destaques persistentes, hover cards e navegacao ate o bug. |
| `ResolvedDiffPopover.vue` | Mostra antes/depois e o codigo do bug ao passar o mouse sobre um trecho resolvido. |
| `CelebrationBalloonLayer.vue` | Renderiza e anima os baloes temporarios. |
| `ResolvedBugModal.vue` | Exibe `bugId`, descricao breve, acoes de fechar e ver bug resolvido. |
| `ResolvedBugEventSubscriber` | Escuta eventos SSE/socket e atualiza o estado agregado. |

### Data Flow

#### Fluxo de resolucao local

1. Usuario submete uma correcao.
2. API valida e aceita o bug.
3. API atualiza o estado agregado global do desafio.
4. API emite `bug.resolved` com metadados do diff.
5. Cliente local atualiza o progresso da sessao.
6. Cliente local e clientes remotos atualizam `derivedSource` a partir do original e da lista global de bugs resolvidos.
7. UI destaca linhas modificadas.
8. UI cria um balao animado por 4 segundos.
9. Ao hover no trecho resolvido, usuario ve antes/depois.
10. Ao clicar no balao, modal e aberto.
11. Ao clicar em “ver o bug resolvido”, a UI faz scroll ate o trecho e destaca temporariamente o alvo.

#### Fluxo de bootstrap de pagina

1. Cliente carrega o `ChallengeDefinition` original.
2. Cliente carrega o estado agregado do desafio: bugs resolvidos globais e ordem de aplicacao.
3. `ResolvedSourceProjector` recompoe `displayedSource` localmente.
4. Cliente abre stream SSE/socket para receber novas resolucoes.

### State and Lifecycle

Estado adicional proposto no frontend:

```ts
type ResolvedBugDisplayState = {
  baseSource: string;
  displayedSource: string;
  resolvedBugOrder: string[];
  resolvedBugDiffs: Record<string, ResolvedBugDiff>;
  highlightedBugId?: string;
  activeBalloons: CelebrationBalloonState[];
  selectedResolvedBugId?: string;
};

type CelebrationBalloonState = {
  id: string;
  bugId: string;
  createdAt: string;
  expiresAt: string;
};
```

Regras:

- `baseSource` e imutavel durante a sessao.
- `displayedSource` sempre e derivado, nunca editado manualmente.
- `resolvedBugOrder` determina aplicacao dos patches.
- O highlight persistente do trecho resolvido e diferente do highlight temporario de navegacao.
- O balao expira automaticamente apos 4 segundos, salvo se a interacao do usuario abrir o modal antes disso.

## Interfaces and Contracts

### APIs

#### `GET /api/challenge-state/:challengeId`

Retorna o estado agregado atual do desafio para compor o editor logo ao entrar.

Response:

```ts
type ChallengeStateResponse = {
  challengeId: string;
  baseSource: string;
  resolvedBugOrder: string[];
  resolvedBugDiffs: Record<string, ResolvedBugDiff>;
  displayedSource?: string;
};
```

Observacao:

- `displayedSource` pode ser omitido se a projecao continuar 100% no cliente.
- Recomendacao inicial: retornar tambem `displayedSource` para simplificar bootstrap e facilitar auditoria em testes.

#### `POST /api/submissions`

Mantem o contrato atual e passa a poder incluir no response os dados minimos para atualizacao visual imediata:

```ts
type SubmitBugResponse = {
  accepted: boolean;
  status: "solved" | "partial" | "duplicate" | "incorrect";
  bugId?: string;
  feedback: string;
  technicalBasis?: string;
  resolvedBugIds: string[];
  resolvedBugDiff?: ResolvedBugDiff;
};
```

### Events and Messages

#### Evento `bug.resolved`

```ts
type ResolvedBugEvent = {
  type: "bug.resolved";
  challengeId: string;
  sessionId: string;
  bugId: string;
  title: string;
  resolvedAt: string;
  diff: ResolvedBugDiff;
  shortDescription: string;
};
```

#### Diff estruturado

```ts
type ResolvedBugDiff = {
  bugId: string;
  originalRange: CodeRange;
  appliedRange: CodeRange;
  beforeText: string;
  afterText: string;
  resolvedLineIds: string[];
};
```

### Internal Interfaces

```ts
type BugPatch = {
  bugId: string;
  range: CodeRange;
  replacement: string;
  shortDescription: string;
};

type ProjectResolvedSourceInput = {
  baseSource: string;
  patches: BugPatch[];
};

type ProjectResolvedSourceOutput = {
  displayedSource: string;
  diffs: Record<string, ResolvedBugDiff>;
};
```

## Data Model and Persistence

### Catalogo

Cada bug deve ganhar campos adicionais no catalogo versionado:

```ts
type BugDefinition = {
  id: string;
  title: string;
  technicalBasis: string;
  expectedFix: string;
  patch: {
    replacement: string;
    shortDescription: string;
  };
};
```

Observacao:

- O `range` continua vindo de `expectedRange`.
- O `replacement` representa o texto final correto para aquele trecho.

### Estado agregado em memoria

```ts
type ChallengeAggregateState = {
  challengeId: string;
  resolvedBugOrder: string[];
  resolvedBugIds: Set<string>;
};
```

Nao ha migracao obrigatoria para banco nesta fase. Em reinicio do servidor, o estado agregado pode ser perdido, desde que isso esteja explicito para o uso local.

## Validation and Business Rules

- Um bug resolvido globalmente deve atualizar o editor de todos os clientes daquele desafio.
- O log original de tentativas por sessao continua existindo e nao deve ser sobrescrito.
- O codigo-base original do desafio nunca muda em memoria; a view atualizada sempre deriva de projeção.
- O hover before/after so aparece para bugs resolvidos.
- O highlight persistente e o highlight temporario de navegacao devem usar tokens coerentes com o VS Code Dark Modern.
- O modal de detalhe aberto pelo balao deve refletir o estado atual do bug, mesmo que o balao tenha sido criado por evento remoto.
- Se o usuario clicar em “ver o bug resolvido”, o editor precisa:
  - fazer scroll ate a primeira linha do trecho aplicado;
  - focar o editor se necessario;
  - destacar o bug alvo visualmente por um curto periodo adicional.
- Se varios bugs forem resolvidos rapidamente, cada balao entra em uma fila visual e sobe independentemente sem sobreposicao ilegivel.

## Error Handling and Recovery

- Se o cliente perder o stream em tempo real, ele deve conseguir recompor o estado chamando novamente `GET /api/challenge-state/:challengeId`.
- Se houver falha ao projetar o source no cliente, a UI deve manter `baseSource` visivel e registrar erro local, sem quebrar toda a tela.
- Se um bug resolvido nao tiver patch valido no catalogo, o backend nao deve emiti-lo como atualizado no editor; deve responder erro interno ou degradar para notificacao simples, dependendo da fase de rollout.
- Se o usuario clicar em “ver o bug resolvido” e o trecho nao estiver mais navegavel, a UI deve ao menos abrir o editor e mostrar mensagem curta de que a navegacao falhou.

## Security and Privacy

- Nenhuma parte desta evolucao exige dados pessoais novos.
- O evento em tempo real continua divulgando apenas identificadores tecnicos e metadados do bug.
- O `beforeText` e o `afterText` sao derivados do codigo do desafio, nao de input livre do usuario.

## Performance and Scalability

- O desafio atual tem um unico arquivo pequeno, entao recompor o `displayedSource` inteiro a cada evento e aceitavel nesta fase.
- Se o numero de bugs ou de arquivos crescer, a estrategia pode evoluir para projeção incremental por linhas.
- A animacao de balao deve usar `transform` e `opacity` em CSS para reduzir custo de layout.

## Accessibility and Internationalization

- O destaque verde do bug resolvido deve manter contraste suficiente com o fundo do editor.
- A paleta final do highlight deve ser inspirada explicitamente no VS Code Dark Modern.
- O hover card precisa ter alternativa por foco de teclado, nao apenas `:hover`.
- O balao clicavel deve ser um `button` semanticamente navegavel por teclado.
- O modal do balao deve prender foco enquanto aberto e devolver foco ao elemento anterior ao fechar.
- Os textos curtos de before/after e descricao breve devem permanecer em portugues, seguindo a linguagem atual do projeto.

## Observability

- Registrar contagem de bugs resolvidos globais por desafio.
- Registrar quantidade de eventos SSE emitidos por bug.
- Registrar falhas de projecao do source no cliente, quando houver telemetria disponivel.
- Opcional em desenvolvimento: logar `resolvedBugOrder` e `displayedSource` gerado para depuracao.

## Compatibility and Migration

- Mudanca compativel com o MVP atual se os novos campos do catalogo forem adicionados para todos os bugs antes de ativar a UI nova.
- A API pode manter o endpoint atual e adicionar `GET /api/challenge-state/:challengeId` sem quebra.
- O evento `bug.resolved` ganha campos novos; clientes antigos devem ignorar campos extras sem quebrar.

## Rollout and Rollback

Rollout sugerido em tres fases:

1. Entregar apenas a projecao de codigo resolvido e o highlight persistente.
2. Entregar hover before/after e navegacao ate o bug.
3. Entregar baloes animados e modal de detalhe.

Rollback:

- Desativar a nova camada de display e voltar a renderizar `baseSource` puro.
- Manter progresso, validacao e notificacao simples funcionando mesmo sem a nova UX.

## Testing Strategy

| Layer | Scenarios | Tools or Approach |
|---|---|---|
| Core unit | Projecao do source com 1 bug, varios bugs e ranges adjacentes | Node test / Vitest |
| Catalog integrity | Todos os bugs possuem `patch.replacement` e `shortDescription` | Node test |
| API | `GET /api/challenge-state`, `POST /api/submissions` com `resolvedBugDiff`, SSE com diff | Node test |
| Component | Editor renderiza `displayedSource`, highlight persistente e hover card | Vitest + Vue Test Utils |
| Component | Balao aparece, anima, expira e abre modal | Vitest + fake timers |
| Component | “Ver o bug resolvido” faz scroll para o trecho certo | Vitest + DOM spies |
| Visual regression | Highlight persistente, hover e navegacao seguem tokens do Dark Modern com contraste adequado | Snapshot CSS ou revisao visual assistida |
| Regression | Estado original e log continuam intactos apos varias resolucoes | Core + API tests |

## Implementation Plan

| ID | Work Item | Dependencies | Verification |
|---|---|---|---|
| WI-001 | Estender catalogo de bugs com patch declarativo e descricao curta | Nenhuma | Teste de integridade do catalogo |
| WI-002 | Implementar `ResolvedSourceProjector` puro no `core` | WI-001 | Testes unitarios de projecao |
| WI-003 | Adicionar estado agregado global do desafio e endpoint `GET /api/challenge-state/:challengeId` | WI-001, WI-002 | Testes de API |
| WI-004 | Enriquecer `bug.resolved` com diff estruturado | WI-002, WI-003 | Teste de SSE e response de submissao |
| WI-005 | Atualizar frontend para renderizar `displayedSource` e highlights persistentes | WI-002, WI-003 | Testes de componente |
| WI-006 | Definir tokens visuais do highlight seguindo VS Code Dark Modern | WI-005 | Revisao visual e regressao CSS |
| WI-007 | Implementar hover/focus card com before/after | WI-005, WI-006 | Testes de componente e acessibilidade |
| WI-008 | Implementar camada de baloes animados e modal de detalhe | WI-004, WI-005, WI-006 | Testes com fake timers |
| WI-009 | Implementar navegacao “ver o bug resolvido” com scroll e foco | WI-005, WI-006, WI-008 | Teste de scroll/foco |

## Alternatives Considered

### AST transform por bug

Vantagem:

- Mais robusto para cenarios de refatoracao complexa.

Desvantagem:

- Complexidade maior do que o necessario para um unico arquivo conhecido e com 10 bugs catalogados.

### Armazenar apenas `displayedSource` pronto no servidor

Vantagem:

- Simplifica o cliente.

Desvantagem:

- Esconde a regra de derivacao, reduz auditabilidade e dificulta inspecao before/after por bug.

### Tooltip simples sem modal nem navegacao

Vantagem:

- Menor custo de UX.

Desvantagem:

- Nao atende ao fluxo desejado de celebracao interativa e retorno ao trecho resolvido.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Patches de bugs diferentes se sobrepoem | Alto | Medio | Validar ranges no catalogo e definir ordem deterministica |
| Hover so no mouse deixa a feature inacessivel | Medio | Alto | Implementar tambem foco de teclado e modal navegavel |
| Muitos baloes simultaneos poluem a tela | Medio | Medio | Limitar fila visivel e aplicar empilhamento com espacamento |
| Drift entre `displayedSource` local e estado do servidor | Alto | Baixo | Reidratar via `GET /api/challenge-state` ao reconectar |
| Destaque verde reduzir legibilidade | Medio | Medio | Ajustar contraste e testar com tema atual |
| Implementacao visual fugir do Dark Modern e parecer inconsistente | Medio | Medio | Fixar tokens de referencia e revisar visualmente antes do rollout |

## Assumptions

- Cada bug pode ser representado por um patch textual unico sobre o arquivo atual.
- O primeiro desafio continua sendo um unico arquivo TypeScript.
- O balao mostrara apenas o codigo do bug, nao a descricao completa.
- A descricao breve exibida no modal pode ser derivada do proprio catalogo.
- O projeto quer aderencia visual deliberada ao VS Code Dark Modern para os estados de highlight dessa feature.

## Open Questions

- O display atualizado deve refletir resolucoes globais de toda a sala ou apenas da sessao local por padrao?
- O hover de before/after deve aparecer como tooltip pequena, popover fixo ou painel lateral?
- O clique em “ver o bug resolvido” deve centralizar a linha no viewport ou apenas rolar ate ela?
- Quando varios bugs forem resolvidos ao mesmo tempo, o balao deve empilhar, agrupar ou enfileirar?
- O highlight verde dos bugs resolvidos deve permanecer indefinidamente ou enfraquecer apos alguns segundos?
- O quanto a implementacao deve ser fiel ao Dark Modern original versus adaptada ao tema atual da aplicacao?

## Technical Decisions

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| TD-001 | Usar patch declarativo por bug em vez de AST transform | Menor complexidade e alta auditabilidade para desafio fixo | Requer manutencao manual do catalogo |
| TD-002 | Manter `baseSource` imutavel e gerar `displayedSource` por projecao | Preserva original, historico e previsibilidade | Exige camada extra de estado derivado |
| TD-003 | Entregar estado agregado do desafio por endpoint dedicado | Facilita bootstrap e reconexao | Introduz novo contrato HTTP |
| TD-004 | Tratar balao como evento de UI temporario e modal como estado persistente | Separa celebracao de navegacao e detalhe | Requer duas camadas de estado no frontend |
| TD-005 | Guiar o highlight pela linguagem visual do VS Code Dark Modern | Mantem coerencia com a referencia de editor desejada | Exige definicao explicita de tokens e revisao visual dedicada |
