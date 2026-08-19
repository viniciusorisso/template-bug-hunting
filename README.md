# TS Bug Hunt

Plataforma para um cursinho rapido de TypeScript baseado em bug hunting.

O MVP planejado sera uma aplicacao Vue 3 + TypeScript que mostra um desafio de codigo em uma interface parecida com um VSCode simplificado. O aluno seleciona um trecho suspeito, descreve a correcao em um popup e submete. A aplicacao valida a resposta por uma switch de testes deterministica e, quando um bug e resolvido, dispara uma notificacao. No MVP a notificacao pode ser um `alert`; depois entra um canal via socket.

A camada de UI inicial sera Vue, mas o dominio do desafio, validadores, contratos de API e notificacoes devem ficar isolados para permitir futuras interfaces em React, Angular ou outro framework.

## Documentos

- [PRD](docs/prd.md): objetivos, escopo, requisitos e metricas do produto.
- [Technical Specification](docs/spec.md): arquitetura, contratos, validacao, entregaveis e estrategia de testes.
- [Bug Catalog](docs/bug-catalog.md): desafio inicial com 10 bugs, categorias, dificuldade, embasamento tecnico e validadores esperados.
- [Bug Fixes](docs/bug-fixes.md): bugs conhecidos do produto que precisam de ajuste, com impacto, evidencias e criterios de aceite.

## Rodando localmente

### Sem Docker

- API: `pnpm dev:api`
- Frontend: `pnpm dev:web`

O frontend usa `http://localhost:3001` por padrao em desenvolvimento.

### Com Docker em producao

Suba os dois servicos com:

```bash
docker compose up --build
```

Se sua maquina usa a versao legada do Compose:

```bash
docker-compose up --build
```

Atalhos via `pnpm`:

```bash
pnpm docker:up
pnpm docker:down
pnpm docker:build
```

A aplicacao web fica em `http://localhost:8080`.
A API fica exposta em `http://localhost:3001`.

No ambiente containerizado de producao, o frontend e servido por Nginx e chama a API diretamente em `http://localhost:3001`.
O `web` espera a API ficar saudavel antes de subir.

### Com Docker em desenvolvimento com watch

Use o compose de desenvolvimento para hot reload no frontend e watch no backend:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Se sua maquina usa a versao legada do Compose:

```bash
docker-compose -f docker-compose.dev.yml up --build
```

Atalhos via `pnpm`:

```bash
pnpm docker:dev
pnpm docker:dev:down
```

Nesse modo:

- frontend: `http://localhost:3000`
- API: `http://localhost:3001`
- alteracoes em `apps/web-vue` recarregam via Vite
- alteracoes em `apps/api` e `packages/core` reiniciam a API via `node --watch`

O compose de desenvolvimento usa bind mounts e volumes separados para `node_modules`, entao o codigo local fica sincronizado com os containers sem sobrescrever dependencias instaladas dentro deles.

## Estado atual

Planejamento inicial criado em 2026-08-18. Existe implementacao inicial do desafio, API em memoria e interface Vue conectada ao backend.
