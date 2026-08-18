# Deploy na Vercel + Railway

Este projeto funciona bem com:

- `frontend` na Vercel
- `api` no Railway

Data de validacao deste guia: `2026-08-18`.

## Resumo de custos atuais

- Vercel Hobby: `US$ 0/mês` para projeto pessoal. Referência oficial: https://vercel.com/pricing
- Railway Free: `US$ 0/mês`, com trial inicial de `US$ 5` por 30 dias e depois `US$ 1/mês` em crédito. Referências oficiais: https://railway.com/pricing e https://docs.railway.com/pricing/free-trial

## Arquitetura recomendada

- Vercel hospeda `apps/web-vue`
- Railway hospeda a API Node de `apps/api`
- Railway também guarda o arquivo de estado persistido em um volume

## Pré-requisitos

- Repositório no GitHub
- Conta na Vercel
- Conta no Railway
- `pnpm` funcionando localmente

## 1. Preparar as credenciais do admin

O login do admin agora depende de variáveis de ambiente no backend. Não existe mais bootstrap pela interface.

Variáveis suportadas:

- `TS_BUG_HUNT_ADMIN_USERNAME`
- `TS_BUG_HUNT_ADMIN_PASSWORD`
- `TS_BUG_HUNT_ADMIN_PASSWORD_HASH`

Use preferencialmente o hash.

### Gerar hash SHA-256 localmente

```bash
node -e "console.log(require('node:crypto').createHash('sha256').update('SUA_SENHA_AQUI').digest('hex'))"
```

Depois guarde:

- usuário em `TS_BUG_HUNT_ADMIN_USERNAME`
- hash em `TS_BUG_HUNT_ADMIN_PASSWORD_HASH`

## 2. Subir a API no Railway

Como este repositório é um monorepo com `workspace`, a forma mais simples no Railway é manter o serviço apontando para a raiz do repositório e configurar `Build Command` e `Start Command` manualmente.

Referências oficiais úteis:

- Services: https://docs.railway.com/services
- Variáveis: https://docs.railway.com/variables
- Monorepo: https://docs.railway.com/deployments/monorepo

### 2.1 Criar o projeto

1. Entre no Railway.
2. Clique em `New Project`.
3. Escolha `Deploy from GitHub Repo`.
4. Selecione este repositório.
5. Crie um serviço para a API.

### 2.2 Configurar o serviço

No serviço da API, deixe o source na raiz do repositório e configure:

- `Build Command`:

```bash
corepack enable && pnpm install --frozen-lockfile && pnpm --filter @ts-bug-hunt/api build
```

- `Start Command`:

```bash
node apps/api/dist/apps/api/src/server.js
```

- `Watch Paths` ou equivalente, se quiser otimizar deploys: pode limitar a `apps/api`, `packages/core`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`

### 2.3 Variáveis da API

Adicione estas variáveis no serviço:

- `NODE_ENV=production`
- `TS_BUG_HUNT_ADMIN_USERNAME=<seu_usuario>`
- `TS_BUG_HUNT_ADMIN_PASSWORD_HASH=<hash_sha256_da_senha>`
- `TS_BUG_HUNT_STATE_FILE=/data/ts-bug-hunt-state.json`

Observações:

- O Railway já injeta `PORT` automaticamente.
- Você pode usar `TS_BUG_HUNT_ADMIN_PASSWORD` em vez do hash, mas o hash é melhor.

### 2.4 Persistência de salas e progresso

O projeto grava estado em arquivo. Sem volume, esse estado pode sumir em redeploy/restart.

Na prática, configure um volume e monte em `/data`.

Depois mantenha:

- `TS_BUG_HUNT_STATE_FILE=/data/ts-bug-hunt-state.json`

Na documentação de preços do Railway, o plano Free informa `0.5 GB of volume storage`: https://railway.com/pricing

### 2.5 Deploy e URL pública

1. Clique em `Deploy`.
2. Espere o build finalizar.
3. Gere um domínio público do serviço.
4. Copie a URL final, por exemplo:

```text
https://ts-bug-hunt-api.up.railway.app
```

## 3. Subir o frontend na Vercel

Referências oficiais úteis:

- Monorepo: https://vercel.com/docs/monorepos
- Environment Variables: https://vercel.com/docs/environment-variables
- Hobby plan: https://vercel.com/docs/plans/hobby

### 3.1 Criar o projeto

1. Entre na Vercel.
2. Clique em `Add New...` -> `Project`.
3. Importe o mesmo repositório GitHub.
4. Na configuração do projeto, selecione `Root Directory = apps/web-vue`.

### 3.2 Build settings

Use estas configurações:

- `Framework Preset`: `Vite`
- `Install Command`:

```bash
corepack enable && pnpm install --frozen-lockfile
```

- `Build Command`:

```bash
pnpm --filter @ts-bug-hunt/web-vue build
```

- `Output Directory`:

```text
dist
```

### 3.3 Variáveis de ambiente do frontend

Adicione:

- `VITE_API_BASE_URL=https://SUA_API_NO_RAILWAY`

Exemplo:

```text
VITE_API_BASE_URL=https://ts-bug-hunt-api.up.railway.app
```

### 3.4 Deploy

1. Clique em `Deploy`.
2. Espere a build terminar.
3. Abra a URL gerada pela Vercel.

## 4. Checklist final

### API no Railway

Teste:

```text
GET https://SUA_API/api/challenges
```

Você deve receber JSON com os templates.

### Frontend na Vercel

Teste:

- abrir a home
- verificar se os templates aparecem
- entrar em `/admin`
- logar com o usuário/senha configurados no Railway
- criar uma sala
- entrar na sala pelo fluxo `/join`
- confirmar que o desafio só abre após entrar em sala

## 5. Configuração mínima recomendada para gastar zero ou quase zero

### Vercel

- plano `Hobby`
- um projeto só para `apps/web-vue`

### Railway

- começar no `Free`
- usar apenas `1` serviço da API
- habilitar `1` volume pequeno para o arquivo de estado
- monitorar consumo depois do trial inicial

## 6. Problemas comuns

### O admin não consegue logar

Cheque no Railway:

- `TS_BUG_HUNT_ADMIN_USERNAME`
- `TS_BUG_HUNT_ADMIN_PASSWORD_HASH` ou `TS_BUG_HUNT_ADMIN_PASSWORD`

Se alterar variável, faça redeploy.

### O frontend sobe, mas não fala com a API

Cheque na Vercel:

- `VITE_API_BASE_URL`

Ela precisa apontar para a URL pública do Railway, com `https`.

### Salas somem depois de redeploy

Falta volume ou `TS_BUG_HUNT_STATE_FILE` está apontando para caminho efêmero.

Use:

- volume montado em `/data`
- `TS_BUG_HUNT_STATE_FILE=/data/ts-bug-hunt-state.json`

## 7. Comandos locais úteis antes do deploy

```bash
pnpm typecheck
pnpm test
```
