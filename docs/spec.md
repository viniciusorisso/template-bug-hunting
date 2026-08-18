# Technical Specification: TS Bug Hunt MVP

## Document Control

- Status: Rascunho v0.1
- Authors: Codex
- Reviewers: Risso
- Last updated: 2026-08-18
- Source requirements: [PRD](prd.md), pedido inicial do usuario em 2026-08-18

## Summary

O MVP sera uma aplicacao web em Vue 3 + TypeScript para um desafio unico de bug hunting. A tela principal exibe codigo TypeScript em editor read-only. O aluno seleciona um range, abre um modal, escreve a correcao proposta e envia para uma API. A API identifica o bug candidato pelo range, executa uma switch de validadores por `testId` e retorna feedback deterministico. Quando uma resposta e aceita, a UI marca o bug como resolvido e dispara uma notificacao via adaptador, inicialmente implementado com `alert` ou banner.

A UI inicial sera Vue, mas catalogo, validadores, contratos de API, store de sessao e notificacoes devem ficar em modulos TypeScript sem dependencia de Vue. Isso permite criar UIs futuras em React, Angular ou outro framework reaproveitando o mesmo dominio.

## Context and Current State

- O workspace esta vazio.
- O diretorio ainda nao e um repositorio Git.
- Nao ha framework, dependencias, testes ou CI configurados.
- A primeira etapa implementavel sera criar o scaffold Vue 3 + TypeScript e versionar os documentos atuais.

## Goals and Non-Goals

### Goals

- Implementar uma experiencia de bug hunting de TypeScript com aproximadamente 10 bugs.
- Validar submissoes por switch de testes server-side.
- Registrar embasamento tecnico por bug.
- Preparar notificacao de bug resolvido para socket futuro.
- Manter o MVP facil de rodar localmente em aula.
- Manter dominio e contratos desacoplados de Vue para permitir UIs futuras em React, Angular ou outro framework.

### Non-Goals

- Editor completo, patch automatico ou execucao arbitraria de codigo submetido.
- Autenticacao, ranking, turmas e persistencia obrigatoria no MVP.
- Multiplos desafios antes do primeiro fluxo completo estar validado.
- Implementar React, Angular ou camada multi-framework no MVP.

## Requirements Traceability

| Requirement | Technical Design | Verification |
|---|---|---|
| FR-001 | `ChallengeView.vue` renderiza `CodeSelectionEditor.vue` read-only com syntax highlight e linhas. | Teste de componente verifica render do codigo e linhas. |
| FR-002 | Editor emite `CodeRange` normalizado ao alterar selecao. | Teste unitario de normalizacao e teste de componente de selecao. |
| FR-003 | `SubmissionModal` envia payload tipado para `POST /api/submissions`. | Teste de componente cobre abertura, preenchimento e envio. |
| FR-004 | API chama `validateSubmission`, que usa `switch (testId)`. | Testes unitarios cobrem cada `case`. |
| FR-005 | Resultado usa `SubmissionStatus`. | Testes de API cobrem `solved`, `partial`, `duplicate`, `incorrect`. |
| FR-006 | `ProgressStore` registra bugs resolvidos por sessao. | Teste unitario cobre duplicidade. |
| FR-007 | `NotificationAdapter` dispara evento no sucesso. | Teste com adapter fake verifica chamada em bug aceito. |
| FR-008 | `BugDefinition` possui `technicalBasis` e `expectedFix`. | Teste de integridade do catalogo garante campos obrigatorios. |
| FR-009 | Catalogo inicial contem 10 bugs com distribuicao de dificuldade. | Teste de integridade valida contagem e dificuldades. |
| FR-010 | Desafio fica em modulo estruturado `challenges/checkout.ts`. | Teste de schema valida challenge carregavel. |
| FR-011 | Interface `ResolvedBugNotifier` abstrai `alert`, socket ou SSE. | Teste unitario cobre implementacao `AlertNotifier`/fake. |
| FR-012 | Aplicacao principal usa Vue 3 + TypeScript. | Teste de build/typecheck cobre componentes `.vue` e integracao com dominio. |
| NFR-007 | Dominio e validadores ficam independentes de Vue. | Teste de import garante que modulos de dominio nao importam `vue` nem componentes `.vue`. |

## Proposed Design

### Architecture

Stack recomendada para o MVP:

- Frontend: Vue 3 + TypeScript.
- Build/app: Vite para a UI Vue.
- API: servidor Node TypeScript separado da UI, por exemplo Fastify, Hono ou Express. A recomendacao inicial e Hono pela superficie pequena e facilidade de teste, mas a decisao final pode ser feita no scaffold.
- Editor: Monaco em modo read-only para aproximar do VSCode. Se o bundle ficar pesado, CodeMirror 6 substitui sem mudar os contratos de selecao.
- Testes: Vitest para validadores e componentes Vue; Vue Testing Library ou Vue Test Utils para componentes; Playwright quando houver fluxo visual completo.
- Estado inicial: memoria no servidor ou estado local por sessao; persistencia entra depois.

Organizacao recomendada:

```text
apps/
  web-vue/        # Vue 3 + Vite
  api/            # API HTTP e socket futuro
packages/
  core/           # catalogo, tipos, validadores, regras de negocio
  notifications/  # contratos/adapters de notificacao
```

### Components and Responsibilities

| Component | Responsibility |
|---|---|
| `ChallengeView.vue` | Orquestra carregamento do desafio, progresso, selecao, modal e feedback na UI Vue. |
| `CodeSelectionEditor.vue` | Renderiza codigo read-only e publica range selecionado. |
| `SubmissionModal.vue` | Coleta proposta de correcao e chama API. |
| `ProgressPanel.vue` | Mostra bugs resolvidos, pendentes e tentativas. |
| `FeedbackPanel.vue` | Mostra feedback da ultima submissao e embasamento liberado. |
| `useChallengeSession` | Composable Vue que conecta API, progresso e estado de UI sem conter regras de validacao. |
| `NotificationAdapter` | Abstrai notificacao de bug resolvido. |
| `SubmissionController` | Recebe payload, valida schema, chama engine e atualiza progresso. |
| `ValidationEngine` | Localiza bug candidato e executa switch de teste. |
| `ChallengeCatalog` | Define codigo, bugs, ranges, categorias e embasamento tecnico. |

### Data Flow

1. `ChallengeView.vue` carrega `ChallengeDefinition`.
2. Aluno seleciona trecho no `CodeSelectionEditor.vue`.
3. `CodeSelectionEditor.vue` emite `CodeRange`.
4. `SubmissionModal.vue` recebe range e texto livre.
5. UI envia `POST /api/submissions`.
6. API valida schema do payload.
7. API identifica bugs cujo range esperado tem intersecao com o range selecionado.
8. Para cada candidato, API executa a switch de teste associada.
9. API retorna `SubmissionResult`.
10. UI atualiza progresso, mostra feedback e chama `NotificationAdapter` se status for `solved`.

### State and Lifecycle

Estados da submissao:

- `idle`: nenhum envio em andamento.
- `editing`: modal aberto com range selecionado.
- `submitting`: request em andamento.
- `solved`: bug aceito e marcado.
- `partial`: selecao parece correta, mas correcao incompleta.
- `duplicate`: bug ja resolvido na sessao.
- `incorrect`: range ou correcao nao correspondem a bug conhecido.

Estado minimo por sessao:

```ts
type SessionProgress = {
  sessionId: string;
  challengeId: string;
  solvedBugIds: string[];
  attempts: SubmissionAttempt[];
};
```

## Interfaces and Contracts

### APIs

`POST /api/submissions`

Request:

```ts
type SubmitBugRequest = {
  challengeId: string;
  sessionId: string;
  selection: CodeRange;
  proposedFix: string;
};

type CodeRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};
```

Response:

```ts
type SubmitBugResponse = {
  accepted: boolean;
  status: "solved" | "partial" | "duplicate" | "incorrect";
  bugId?: string;
  feedback: string;
  technicalBasis?: string;
  resolvedBugIds: string[];
};
```

Validation rules:

- `challengeId` precisa existir no catalogo.
- `sessionId` precisa ser uma string nao vazia.
- `selection` precisa ter linhas e colunas positivas e range ordenavel.
- `proposedFix` precisa ter conteudo minimo.
- O servidor nao executa `proposedFix` como codigo.

Errors:

| Status | Case | Response |
|---|---|---|
| `400` | Payload invalido | Lista de campos invalidos |
| `404` | `challengeId` desconhecido | Mensagem generica |
| `200` | Resposta incorreta | `status: "incorrect"` |
| `200` | Resposta correta | `status: "solved"` |

### Events and Messages

Evento futuro de socket:

```ts
type BugResolvedEvent = {
  type: "bug.resolved";
  challengeId: string;
  sessionId: string;
  bugId: string;
  title: string;
  resolvedAt: string;
};
```

No MVP, o mesmo contrato pode alimentar `alert`, banner local ou adapter fake em teste.

### Internal Interfaces

```ts
type Difficulty = "easy" | "medium" | "hard";

type BugDefinition = {
  id: string;
  title: string;
  category: string;
  difficulty: Difficulty;
  expectedRange: CodeRange;
  testId: BugValidationTestId;
  expectedFix: string;
  technicalBasis: string;
};

type ChallengeDefinition = {
  id: string;
  title: string;
  language: "typescript";
  source: string;
  bugs: BugDefinition[];
};

type ValidationContext = {
  bug: BugDefinition;
  selection: CodeRange;
  proposedFix: string;
  normalizedFix: string;
  sessionProgress: SessionProgress;
};

type ValidationResult = {
  status: "solved" | "partial" | "incorrect";
  feedback: string;
};
```

## Test Switch Design

A switch de teste roda no servidor quando o aluno submete uma solucao. Ela nao precisa executar o patch do aluno. Para o MVP, cada `case` verifica tres coisas:

- O range selecionado intersecta ou cobre o trecho esperado.
- A resposta menciona a correcao tecnica essencial.
- O bug ainda nao foi resolvido na sessao.

Exemplo de contrato:

```ts
export type BugValidationTestId =
  | "CHECKOUT_001_USER_ID_GUARD"
  | "CHECKOUT_002_ITEM_LOOP_BOUNDARY"
  | "CHECKOUT_003_COUPON_CODE_NORMALIZATION"
  | "CHECKOUT_004_EXPIRATION_DIRECTION"
  | "CHECKOUT_005_OPTIONAL_PLAN_RULE"
  | "CHECKOUT_006_MAX_USES_BOUNDARY"
  | "CHECKOUT_007_ASSIGNMENT_IN_CONDITION"
  | "CHECKOUT_008_MONEY_ROUNDING"
  | "CHECKOUT_009_INPUT_MUTATION"
  | "CHECKOUT_010_TAX_ROUNDING";

export function runBugValidation(
  testId: BugValidationTestId,
  context: ValidationContext,
): ValidationResult {
  switch (testId) {
    case "CHECKOUT_001_USER_ID_GUARD":
      return validateUserIdGuard(context);
    case "CHECKOUT_002_ITEM_LOOP_BOUNDARY":
      return validateItemLoopBoundary(context);
    case "CHECKOUT_003_COUPON_CODE_NORMALIZATION":
      return validateCouponCodeNormalization(context);
    case "CHECKOUT_004_EXPIRATION_DIRECTION":
      return validateExpirationDirection(context);
    case "CHECKOUT_005_OPTIONAL_PLAN_RULE":
      return validateOptionalPlanRule(context);
    case "CHECKOUT_006_MAX_USES_BOUNDARY":
      return validateMaxUsesBoundary(context);
    case "CHECKOUT_007_ASSIGNMENT_IN_CONDITION":
      return validateAssignmentInCondition(context);
    case "CHECKOUT_008_MONEY_ROUNDING":
      return validateMoneyRounding(context);
    case "CHECKOUT_009_INPUT_MUTATION":
      return validateInputMutation(context);
    case "CHECKOUT_010_TAX_ROUNDING":
      return validateTaxRounding(context);
    default: {
      const exhaustiveCheck: never = testId;
      return exhaustiveCheck;
    }
  }
}
```

Exemplo de helper para validadores textuais:

```ts
function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function validateItemLoopBoundary(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return {
      status: "incorrect",
      feedback: "A selecao nao aponta para o limite do loop.",
    };
  }

  if (containsAny(context.normalizedFix, ["i < input.items.length", "trocar <= por <"])) {
    return {
      status: "solved",
      feedback: "Correto: o loop nao deve acessar o indice igual ao tamanho do array.",
    };
  }

  return {
    status: "partial",
    feedback: "A regiao esta correta, mas a correcao precisa ajustar o limite do loop.",
  };
}
```

## Data Model and Persistence

No MVP, persistencia pode ser em memoria:

```ts
type InMemorySessionStore = Map<string, SessionProgress>;
```

Evolucao posterior:

- `sessions`: `id`, `createdAt`, `label`.
- `attempts`: `id`, `sessionId`, `challengeId`, `selection`, `proposedFix`, `status`, `bugId`, `createdAt`.
- `resolved_bugs`: `sessionId`, `challengeId`, `bugId`, `resolvedAt`.

Nao ha migracao no MVP enquanto nao houver banco.

## Validation and Business Rules

- Uma submissao correta para bug ja resolvido retorna `duplicate`.
- Uma selecao que cobre varios bugs pode testar candidatos por ordem de maior intersecao.
- O feedback incorreto nao deve revelar o `expectedFix` completo.
- O embasamento tecnico completo so deve ser retornado em `solved` ou na revisao final do instrutor.
- Texto de resposta deve ser normalizado com `trim`, lowercase e remocao simples de acentos apenas se isso melhorar a tolerancia em portugues.
- Validadores podem aceitar sinonimos: por exemplo, "menor que", "`<`", "trocar `<=` por `<`".

## Error Handling and Recovery

- Falha de rede: UI mantem modal aberto e permite reenviar.
- Payload invalido: UI destaca o campo problematico.
- `challengeId` desconhecido: UI mostra erro generico e sugere recarregar.
- Notificacao falha: submissao continua aceita; erro de notificacao nao desfaz progresso.
- Estado em memoria perdido ao reiniciar servidor: aceitavel no MVP; documentar para uso em aula.

## Security and Privacy

- Nao executar `proposedFix` como codigo.
- Sanitizar texto antes de renderizar em HTML.
- Limitar tamanho de `proposedFix`.
- Evitar guardar dados pessoais no MVP.
- Quando socket entrar, validar origem/sessao antes de emitir eventos de turma.

## Performance and Scalability

- O catalogo inicial e pequeno; validacao deve ser O(numero de bugs).
- O editor carrega um unico arquivo; lazy-load do editor e aceitavel.
- Socket futuro deve emitir apenas eventos de resolucao, nao streamar cada selecao.

## Accessibility and Internationalization

- Interface em portugues no MVP.
- Modal deve ter foco gerenciado e fechamento por Escape.
- Botoes devem ter labels claros.
- Feedback nao deve depender apenas de cor.

## Observability

Eventos recomendados para log local:

- `challenge.loaded`
- `submission.created`
- `submission.validated`
- `bug.resolved`
- `notification.sent`
- `notification.failed`

Campos minimos: `challengeId`, `sessionId`, `bugId`, `status`, `durationMs`.

## Compatibility and Migration

- Sem compatibilidade retroativa exigida antes do primeiro scaffold.
- Manter contratos tipados para permitir trocar memoria por banco depois.
- Manter `NotificationAdapter` para trocar `alert` por socket sem mexer no fluxo de submissao.

## Rollout and Rollback

- Fase 1: rodar localmente para validacao do instrutor.
- Fase 2: testar com uma turma pequena.
- Fase 3: ajustar validadores e feedbacks.
- Rollback: como MVP local, voltar para commit anterior ou desativar validadores problematicos no catalogo.

## Testing Strategy

| Layer | Scenarios | Tools or Approach |
|---|---|---|
| Unitario | Normalizacao de ranges, matching de texto, cada validator da switch. | Vitest/Jest |
| Integridade de catalogo | 10 bugs, ids unicos, dificuldades, ranges e `testId` validos. | Teste unitario sobre `ChallengeDefinition` |
| API | Payload invalido, bug correto, parcial, duplicado e incorreto. | Teste de route/controller |
| Componentes Vue | Render do editor, abertura do modal, envio, feedback e progresso. | Vitest + Vue Testing Library ou Vue Test Utils |
| E2E | Fluxo completo de resolver um bug e disparar notificacao. | Playwright quando UI existir |

## Implementation Plan

| ID | Work Item | Dependencies | Verification |
|---|---|---|---|
| WI-001 | Inicializar repositorio Git e scaffold Vue 3 + TypeScript. | Nenhuma | `npm/pnpm install`, app roda localmente. |
| WI-002 | Configurar lint, formatacao e testes unitarios. | WI-001 | Comandos de qualidade executam sem falha inicial. |
| WI-003 | Criar `ChallengeDefinition` do desafio de checkout com 10 bugs. | WI-001 | Teste de integridade do catalogo passa. |
| WI-004 | Implementar `ValidationEngine`, `CodeRange` e helpers de matching. | WI-003 | Testes unitarios cobrem range e normalizacao. |
| WI-005 | Implementar switch de validadores para os 10 `testId`. | WI-004 | Um teste positivo e um negativo por bug. |
| WI-006 | Criar API `POST /api/submissions` com store em memoria. | WI-004, WI-005 | Testes de API para todos os status. |
| WI-007 | Implementar tela Vue do desafio com editor read-only e selecao. | WI-001, WI-003 | Teste de componente Vue renderiza codigo e captura range. |
| WI-008 | Implementar modal de submissao, feedback e progresso. | WI-006, WI-007 | Teste de componente cobre fluxo de envio. |
| WI-009 | Implementar `NotificationAdapter` com `alert` ou banner. | WI-008 | Teste com adapter fake verifica evento em `solved`. |
| WI-010 | Preparar adapter de socket sem ativar transporte real. | WI-009 | Interface documentada e coberta por teste de contrato. |
| WI-011 | Rodar revisao tecnica do fluxo e ajustar validadores. | WI-001 a WI-010 | Suite de testes e revisao manual do desafio. |
| WI-012 | Criar commit inicial e preparar push para Git remoto. | WI-001 a WI-011 | `git status` limpo apos commit. |

## Deliverables

| Deliverable | Conteudo | Done When |
|---|---|---|
| D-001 Planejamento | PRD, spec e catalogo de bugs. | Documentos versionados e revisados. |
| D-002 Scaffold | App Vue 3 + TypeScript com scripts de dev, test, lint e build. | App abre localmente. |
| D-003 Catalogo | Desafio inicial com codigo e 10 bugs definidos. | Teste de integridade passa. |
| D-004 Validacao | Switch de testes e validators por bug. | Testes unitarios passam. |
| D-005 Fluxo UI | Editor, selecao, modal, feedback e progresso. | Aluno consegue resolver pelo menos um bug no browser. |
| D-006 Notificacao | Adapter com `alert`/banner e contrato para socket. | Resolver bug dispara notificacao. |
| D-007 Hardening | Testes, acessibilidade basica e revisao de UX. | Quality gates passam. |
| D-008 Git | Commit inicial e orientacao para remoto. | Projeto pronto para push. |

## Alternatives Considered

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| Executar patch do aluno contra testes reais. | Mais proximo de coding challenge real. | Maior risco de seguranca e complexidade de sandbox. | Fora do MVP. |
| Validacao puramente textual sem range. | Simples. | Facil de acertar sem localizar bug no codigo. | Rejeitada. |
| Validacao so por range sem texto. | Boa para bug hunting visual. | Nao confirma entendimento tecnico. | Rejeitada. |
| Socket desde a primeira entrega. | Experiencia mais rica em sala. | Atrasa fluxo central. | Fase posterior. |
| Nuxt como framework full-stack Vue. | Integra UI e rotas server rapidamente. | Acopla mais a arquitetura ao ecossistema Vue e dificulta a meta futura agnostica. | Nao recomendado para o MVP agnostico. |
| Vue + Vite com API separada. | Mantem UI Vue simples e dominio reutilizavel por React/Angular depois. | Exige configurar dois apps ou workspace. | Recomendado. |

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Validadores aceitarem respostas ruins. | Alto | Media | Testes negativos e revisao com respostas simuladas. |
| Validadores rejeitarem respostas boas com linguagem diferente. | Alto | Alta | Aceitar sinonimos e permitir ajuste rapido do catalogo. |
| Editor consumir tempo demais. | Medio | Media | Encapsular editor atras de interface e trocar Monaco por CodeMirror se necessario. |
| Estado em memoria perder progresso durante aula. | Medio | Baixa | Avisar limitacao e evoluir para persistencia se necessario. |

## Assumptions

- O primeiro desafio sera de checkout/carrinho para reunir tipos, dinheiro, datas e regras de negocio.
- O usuario quer primeiro planejamento e depois implementacao.
- O projeto sera escrito em portugues na UI e na documentacao.
- O primeiro canal de notificacao sera temporario.
- O MVP usara Vue 3; React e Angular sao metas de compatibilidade futura, nao entregas imediatas.

## Open Questions

- Preferencia final da API separada: Hono, Fastify ou Express?
- O desafio deve esconder a contagem total de bugs ou mostrar `0/10` desde o inicio?
- A resposta correta deve aceitar apenas texto ou tambem patch/diff em uma fase posterior?

## Technical Decisions

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| TD-001 | Usar editor read-only com selecao de range. | Mantem foco em bug hunting e reduz complexidade. | Aluno descreve a correcao em vez de editar arquivo. |
| TD-002 | Validar por switch de `testId`. | Traz previsibilidade, rastreabilidade e testes simples. | Validadores precisam ser calibrados manualmente. |
| TD-003 | Nao executar codigo do aluno no MVP. | Reduz risco de seguranca. | Validacao depende de heuristicas controladas. |
| TD-004 | Criar adapter de notificacao. | Permite `alert` agora e socket depois. | Pequena camada extra desde o inicio. |
| TD-005 | Definir bugs em catalogo estruturado. | Facilita testes, feedback e material do instrutor. | Requer disciplina para manter ranges sincronizados com codigo. |
| TD-006 | Implementar a primeira UI em Vue 3 + Vite. | Atende ao alvo atual do produto com setup simples. | Componentes iniciais serao `.vue`. |
| TD-007 | Manter dominio, validadores, contratos e notificacoes fora da camada Vue. | Permite React, Angular ou outra UI no futuro. | Requer boundaries claros entre `apps/web-vue` e `packages/core`. |
