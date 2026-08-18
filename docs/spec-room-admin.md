# Technical Specification: Room Administration and Guided Room Access

## Document Control

- Status: Rascunho v0.1
- Authors: Codex
- Reviewers: Risso
- Last updated: 2026-08-18
- Source requirements: [PRD](prd.md), [Technical Specification MVP](spec.md), pedido do usuario em 2026-08-18 sobre painel administrativo, salas socket, entrada em sala e acompanhamento de atividade

## Summary

Esta evolucao introduz um modelo de salas para o TS Bug Hunt com tres frentes principais:

1. Um painel administrativo para criar e deletar salas de atividade em tempo real.
2. Uma pagina publica de entrada em sala em que o usuario informa um nome livre e um codigo de sala.
3. Uma pagina de acompanhamento de sala com o fluxo de bugs encontrados, incluindo nome do usuario, horario e resposta enviada.

O painel administrativo deve usar um fluxo de bootstrap simples: no primeiro acesso, o operador define a senha do usuario fixo `admin`; nos acessos seguintes, autentica com `admin` e a senha previamente configurada.

## Context and Current State

- O projeto atual opera apenas com `sessionId` tecnico e um desafio compartilhado, sem conceito de sala.
- A infraestrutura de notificacao em tempo real existe no nivel de desafio, sem segregacao por turma, grupo ou codigo de acesso.
- Nao ha autenticacao, persistencia nem painel administrativo no MVP atual.
- O pedido atual adiciona estado e fluxos operacionais novos que nao devem ser confundidos com autenticacao de alunos ou sistema multi-perfil completo.

## Goals and Non-Goals

### Goals

- Permitir criar uma sala com nome, senha e codigo de acesso unico.
- Permitir deletar uma sala pelo painel administrativo.
- Permitir que um participante entre em uma sala informando um nome qualquer e o codigo da sala.
- Segregar eventos em tempo real e estado por sala.
- Exibir uma pagina de acompanhamento da sala com feed de resolucoes/submissoes.
- Permitir bootstrap e login do operador `admin` sem exigir sistema completo de usuarios.

### Non-Goals

- Cadastro de multiplos administradores nesta fase.
- Recuperacao de senha por email ou fluxo de identidade externo.
- Controle fino de permissoes por papel para alem de `admin` e participante.
- Historico analitico completo entre varias aulas nesta fase.
- Chat, ranking ou presenca detalhada em tempo real nesta fase.

## Requirements Traceability

| Requirement | Technical Design | Verification |
|---|---|---|
| R-001 | O sistema deve permitir criar sala com `name`, `password` e `roomCode` gerado. | Teste de API valida criacao e unicidade do codigo. |
| R-002 | O painel deve listar salas existentes e permitir deletar uma sala. | Teste de componente e API validam listagem e remocao. |
| R-003 | O primeiro acesso admin deve exigir definicao da senha inicial. | Teste de API e fluxo E2E validam bootstrap. |
| R-004 | A autenticacao admin deve usar usuario fixo `admin` e senha configurada. | Teste de API valida login correto e incorreto. |
| R-005 | O participante deve entrar em sala com nome livre e codigo da sala. | Teste de componente e API validam entrada e erros de codigo invalido. |
| R-006 | Cada socket/SSE deve ser segregado por sala. | Teste de integracao valida que eventos nao vazam entre salas. |
| R-007 | A pagina de acompanhamento da sala deve mostrar bug, usuario, horario e resposta enviada. | Teste de componente valida render do feed. |
| R-008 | A exclusao de sala deve encerrar novas entradas e conexoes futuras para aquela sala. | Teste de API valida comportamento apos delete. |

## Proposed Design

### Architecture

Adicionar um dominio de salas acima do desafio atual:

- `packages/core`
  - tipos de sala, participante e eventos de sala;
  - contratos de autenticacao admin e agregacao de atividade.
- `apps/api`
  - armazenamento de salas e participantes ativos;
  - bootstrap do admin;
  - autenticacao admin baseada em senha hasheada;
  - endpoints para CRUD minimo de salas e entrada de participantes;
  - canais SSE/socket isolados por `roomCode`.
- `apps/web-vue`
  - pagina de login/bootstrap admin;
  - painel administrativo de salas;
  - pagina publica de entrada em sala;
  - pagina de acompanhamento da sala.

### Design Choice

Abordagem selecionada: modelo simples com um unico usuario administrativo fixo e salas com codigo curto unico.

Motivos:

- Atende ao objetivo operacional sem introduzir identidade completa.
- Reduz superficie de UX e backend nesta fase.
- Mantem o foco no uso em aula, nao em produto SaaS multi-tenant completo.

Tradeoffs:

- Um unico admin vira gargalo operacional se o sistema crescer.
- O codigo da sala precisa ter entropia suficiente para nao ser facilmente adivinhado.

### Components and Responsibilities

| Component | Responsibility |
|---|---|
| `AdminBootstrapPage.vue` | Detecta ausencia de senha admin e coleta a senha inicial. |
| `AdminLoginPage.vue` | Autentica o usuario fixo `admin`. |
| `AdminRoomsPage.vue` | Lista, cria e deleta salas. |
| `RoomJoinPage.vue` | Coleta nome livre do participante e codigo da sala. |
| `RoomObserverPage.vue` | Mostra feed da sala com bugs encontrados e respostas. |
| `RoomStore` | Mantem salas, codigo, senha hasheada e status ativo/inativo. |
| `ParticipantSessionStore` | Mantem participantes conectados por sala. |
| `RoomActivityProjector` | Converte tentativas e resolucoes em feed observavel da sala. |
| `AdminAuthService` | Faz bootstrap, hash, verificacao e emissao de sessao admin. |

### Data Flow

#### Bootstrap admin

1. Operador acessa rota admin em `2026-08-18` ou depois, sem senha configurada.
2. Frontend chama endpoint de status do admin.
3. Backend responde `requiresBootstrap: true`.
4. Operador define a senha inicial.
5. Backend salva hash e marca bootstrap como concluido.
6. Operador e autenticado como `admin`.

#### Criacao de sala

1. Admin autenticado abre o painel.
2. Informa nome da sala e senha da sala.
3. Backend gera `roomCode` unico.
4. Backend persiste a sala ativa.
5. Painel mostra a sala criada, inclusive o codigo gerado.

#### Entrada de participante

1. Usuario abre a pagina de entrada.
2. Informa nome livre e codigo da sala.
3. Backend valida que a sala existe e esta ativa.
4. Backend cria uma sessao de participante associada a sala.
5. Cliente passa a enviar e receber eventos escopados pela sala.

#### Acompanhamento de sala

1. Admin abre a pagina de acompanhamento de uma sala.
2. Frontend carrega o snapshot atual de atividade da sala.
3. Frontend abre stream SSE/socket da sala.
4. Cada tentativa ou bug resolvido entra no feed com nome, horario e resposta enviada.

### State and Lifecycle

Estado minimo proposto:

```ts
type Room = {
  id: string;
  name: string;
  roomCode: string;
  passwordHash: string;
  status: "active" | "deleted";
  createdAt: string;
  deletedAt?: string;
};

type ParticipantSession = {
  id: string;
  roomCode: string;
  displayName: string;
  joinedAt: string;
};

type RoomActivityItem = {
  id: string;
  roomCode: string;
  challengeId: string;
  bugId?: string;
  status: "solved" | "partial" | "duplicate" | "incorrect";
  submittedBy: string;
  submittedAt: string;
  proposedFix: string;
};

type AdminBootstrapState = {
  isConfigured: boolean;
};
```

Regras:

- Sala deletada nao aceita novas entradas.
- Historico de atividade pode continuar visivel para observacao admin, mesmo apos delete, se o delete for logico.
- Nome do participante e livre, mas precisa ter tamanho minimo e maximo.
- `roomCode` deve ser unico, curto e compartilhavel.

## Interfaces and Contracts

### APIs

#### `GET /api/admin/status`

```ts
type AdminStatusResponse = {
  requiresBootstrap: boolean;
};
```

#### `POST /api/admin/bootstrap`

Request:

```ts
type AdminBootstrapRequest = {
  password: string;
};
```

Response:

```ts
type AdminAuthResponse = {
  token: string;
  username: "admin";
};
```

Rules:

- So funciona se ainda nao houver senha configurada.
- Depois de configurado, retorna erro de conflito.

#### `POST /api/admin/login`

Request:

```ts
type AdminLoginRequest = {
  username: "admin";
  password: string;
};
```

Response:

```ts
type AdminAuthResponse = {
  token: string;
  username: "admin";
};
```

#### `GET /api/admin/rooms`

Lista salas ativas e opcionalmente deletadas.

#### `POST /api/admin/rooms`

Request:

```ts
type CreateRoomRequest = {
  name: string;
  password: string;
};
```

Response:

```ts
type RoomResponse = {
  id: string;
  name: string;
  roomCode: string;
  status: "active" | "deleted";
  createdAt: string;
};
```

#### `DELETE /api/admin/rooms/:roomId`

Soft delete recomendado.

#### `POST /api/rooms/join`

Request:

```ts
type JoinRoomRequest = {
  roomCode: string;
  displayName: string;
};
```

Response:

```ts
type JoinRoomResponse = {
  participantSessionId: string;
  roomCode: string;
  roomName: string;
};
```

#### `GET /api/admin/rooms/:roomCode/activity`

Response:

```ts
type RoomActivityResponse = {
  roomCode: string;
  items: RoomActivityItem[];
};
```

### Events and Messages

#### Evento de atividade da sala

```ts
type RoomActivityEvent = {
  type: "room.activity";
  roomCode: string;
  item: RoomActivityItem;
};
```

#### Canal SSE/socket de sala

- Admin observador: assina `/api/admin/rooms/:roomCode/events`.
- Participante: assina `/api/rooms/:roomCode/events`.
- Ambos recebem apenas eventos daquela sala.

### Internal Interfaces

```ts
type AdminCredentials = {
  username: "admin";
  passwordHash: string;
  configuredAt: string;
};

type RoomCodeGenerator = () => string;

type RoomJoinValidationResult = {
  ok: boolean;
  reason?: "room_not_found" | "room_deleted" | "invalid_name";
};
```

## Data Model and Persistence

Persistencia minima recomendada para esta etapa:

- arquivo local ou SQLite leve para:
  - credenciais admin;
  - salas;
  - historico de atividade da sala.
- memoria pode continuar sendo usada para conexoes vivas e sessoes temporarias.

Motivo:

- bootstrap de senha admin nao pode se perder a cada reinicio.
- salas e codigos precisam sobreviver ao processo para uso operacional minimamente confiavel.

Modelo inicial:

```ts
type StoredRoomRecord = Room;
type StoredAdminRecord = AdminCredentials;
type StoredRoomActivityRecord = RoomActivityItem;
```

## Validation and Business Rules

- `name` da sala deve ser obrigatorio e limitado em tamanho.
- `password` da sala deve ser obrigatoria e armazenada como hash se for usada para acesso futuro de observadores ou participantes.
- `roomCode` deve ser gerado pelo sistema, nao pelo admin.
- `displayName` do participante nao precisa ser unico globalmente, mas pode ser normalizado por sala.
- Cada submissao do participante deve ser registrada com:
  - nome exibido;
  - horario do servidor;
  - texto enviado;
  - status e `bugId` quando aplicavel.
- Ao deletar uma sala:
  - novas entradas devem falhar;
  - streams futuros da sala devem ser recusados;
  - o feed historico pode permanecer acessivel para admins se o delete for logico.
- Login admin usa sempre `username = admin`.
- Bootstrap admin so pode acontecer uma vez, salvo reset operacional explicito fora da UI.

## Error Handling and Recovery

- Se o bootstrap admin ja tiver ocorrido, a UI deve redirecionar da tela de bootstrap para login.
- Se o login admin falhar, responder mensagem generica de credenciais invalidas.
- Se o codigo da sala for invalido, a pagina de entrada deve mostrar erro claro sem revelar salas existentes alem do necessario.
- Se a sala for deletada enquanto um observador estiver conectado, o stream deve ser encerrado com evento de sala encerrada ou erro controlado.
- Se o backend reiniciar, sessoes de participante podem expirar e exigir nova entrada na sala.

## Security and Privacy

- Senhas admin e de sala devem ser armazenadas como hash, nunca em texto puro.
- O token admin deve ser assinado pelo servidor e expirar.
- Endpoints administrativos exigem autenticacao admin.
- O feed da sala exibe respostas enviadas, entao o acesso deve ser restrito ao admin observador e, se houver depois, a operadores autorizados.
- Nomes livres de participantes devem ser tratados como texto e escapados na UI.

## Performance and Scalability

- O volume inicial esperado por sala e baixo o bastante para feed incremental simples.
- O feed pode ser paginado se crescer alem de um numero razoavel de eventos.
- O stream por sala evita broadcast global desnecessario.
- O gerador de `roomCode` deve minimizar colisao sem depender de retries excessivos.

## Accessibility and Internationalization

- As telas de login, bootstrap, criacao de sala e entrada em sala devem ser navegaveis por teclado.
- Mensagens de erro e sucesso devem estar associadas semanticamente aos campos.
- O feed da sala deve ter estrutura semantica clara para leitura por tecnologias assistivas.
- O idioma inicial continua em portugues.

## Observability

- Registrar criacao e delecao de sala com timestamp.
- Registrar tentativas de login admin com sucesso ou falha, sem logar senha.
- Registrar total de participantes por sala ativa.
- Registrar total de eventos por sala para diagnostico operacional.

## Compatibility and Migration

- O sistema atual baseado so em `challengeId` precisa passar a aceitar `roomCode` como contexto primario de atividade em tempo real.
- As APIs atuais de submissao podem ganhar `roomCode` opcional ou obrigatorio quando o modo sala for ativado.
- O rollout pode manter um modo local sem sala para desenvolvimento, se isso simplificar a transicao.

## Rollout and Rollback

Rollout sugerido:

1. Persistencia admin e CRUD de salas no backend.
2. Login/bootstrap admin e painel de salas.
3. Entrada publica em sala por nome + codigo.
4. Segregacao de eventos por sala.
5. Pagina de acompanhamento da sala.

Rollback:

- Desativar o modo sala e voltar ao fluxo unico do desafio.
- Manter o codigo de salas isolado atras de flag de recurso, se possivel.

## Testing Strategy

| Layer | Scenarios | Tools or Approach |
|---|---|---|
| Unit | Hash de senha, bootstrap admin, geracao de `roomCode` | Node test |
| API | Criar sala, deletar sala, entrar em sala, login admin, bootstrap admin | Node test |
| Integration | Eventos de uma sala nao vazam para outra | API + SSE/socket tests |
| Component | Painel admin cria/lista/deleta salas | Vitest + Vue Test Utils |
| Component | Pagina de entrada em sala valida nome e codigo | Vitest + Vue Test Utils |
| Component | Pagina de acompanhamento renderiza feed ao vivo | Vitest + Vue Test Utils |
| E2E | Bootstrap admin, login, criacao de sala, entrada de participante e observacao admin | Playwright |

## Implementation Plan

| ID | Work Item | Dependencies | Verification |
|---|---|---|---|
| WI-001 | Definir modelos de dados de admin, sala, participante e atividade | Nenhuma | Typecheck e testes unitarios |
| WI-002 | Implementar persistencia minima para admin e salas | WI-001 | Testes de API |
| WI-003 | Implementar bootstrap e login do `admin` | WI-002 | Testes de API e fluxo |
| WI-004 | Implementar CRUD minimo de salas no backend | WI-002, WI-003 | Testes de API |
| WI-005 | Implementar pagina/painel admin de salas | WI-003, WI-004 | Testes de componente |
| WI-006 | Implementar entrada publica em sala por nome e codigo | WI-004 | Testes de componente e API |
| WI-007 | Escopar submissao e eventos por `roomCode` | WI-004, WI-006 | Testes de integracao |
| WI-008 | Implementar feed de acompanhamento da sala | WI-007 | Testes de componente |
| WI-009 | Adicionar cobertura E2E do fluxo admin + participante | WI-005, WI-006, WI-008 | Playwright |

## Alternatives Considered

### Reutilizar apenas `sessionId` sem criar salas

Vantagem:

- Menor mudanca arquitetural.

Desvantagem:

- Nao atende o requisito operacional de organizar turmas/salas e acompanhar atividade por grupo.

### Permitir varios admins desde o inicio

Vantagem:

- Mais flexivel para crescimento.

Desvantagem:

- Aumenta custo de autenticacao, gestao de usuarios e superficie de permissoes cedo demais.

### Usar senha da sala tambem para entrada do participante nesta fase

Vantagem:

- Mais controle de acesso.

Desvantagem:

- O pedido atual cita pagina de entrada com nome livre e codigo; adicionar senha de sala ao aluno mudaria o UX desejado.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Perda da senha admin por armazenamento inadequado | Alto | Medio | Persistir hash em armazenamento duravel e documentar reset operacional |
| Codigo de sala facil de adivinhar | Medio | Medio | Gerar codigo com tamanho e alfabeto adequados |
| Vazamento de eventos entre salas | Alto | Baixo | Isolar canal por `roomCode` e testar integracao |
| Deletar sala e perder observabilidade historica | Medio | Medio | Preferir delete logico nesta fase |
| Nomes livres ofensivos ou problemáticos no feed | Medio | Medio | Validar comprimento e considerar moderacao futura |

## Assumptions

- O usuario participante nao precisa de conta formal nesta fase.
- O codigo da sala sera criado automaticamente ao criar a sala no painel administrativo.
- O operador aceita trabalhar com um unico usuario administrativo fixo chamado `admin`.
- O primeiro login admin servira como bootstrap de senha e nao como credencial preconfigurada.

## Open Questions

- A senha da sala sera usada apenas no painel admin ou tambem para alguma acao futura de observador/participante?
- O feed da sala deve mostrar todas as tentativas ou apenas bugs efetivamente resolvidos?
- A sala deve estar vinculada a um unico desafio fixo ou permitir selecionar desafio no futuro?
- O delete de sala deve expulsar imediatamente os participantes conectados ou apenas bloquear novas entradas?
- O codigo da sala deve ter formato curto legivel, por exemplo `AB12CD`, ou algo mais longo?

## Technical Decisions

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| TD-001 | Usar um unico usuario administrativo fixo `admin` | Reduz complexidade de autenticacao inicial | Limitado para operacao com varios gestores |
| TD-002 | Fazer bootstrap da senha admin no primeiro acesso | Evita credencial hardcoded inicial | Requer persistencia duravel da configuracao |
| TD-003 | Gerar `roomCode` automaticamente no backend | Garante padrao e reduz erro manual | Exige estrategia de unicidade |
| TD-004 | Tratar exclusao de sala como delete logico inicialmente | Preserva historico de atividade | Requer filtragem por status |
| TD-005 | Segregar streams e atividade por `roomCode` | Atende ao objetivo de salas socket independentes | Obriga adaptar contratos existentes |
