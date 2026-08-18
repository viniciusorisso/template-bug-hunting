# Bug Catalog: Checkout TypeScript Challenge

## Objetivo do desafio

O primeiro desafio simula uma funcao de checkout escrita em TypeScript. Ela calcula subtotal, aplica cupom, calcula imposto e retorna totais em centavos. O codigo contem 10 bugs intencionais com dificuldade gradual.

Na versao exibida aos alunos, o codigo deve aparecer sem marcadores de bug. Este documento e material do instrutor e base para os validadores.

## Codigo inicial com bugs

```ts
type Plan = "free" | "pro" | "enterprise";
type CouponType = "percent" | "fixed";

type Coupon = {
  code: string;
  type: CouponType;
  amount: number;
  expiresAt?: string;
  plans?: Plan[];
  maxUses?: number;
  used: number;
};

type CartItem = {
  id: string;
  name: string;
  priceInCents: number;
  quantity: number;
  tags?: string[];
};

type CheckoutInput = {
  userId?: string;
  plan: Plan;
  items: CartItem[];
  couponCode?: string | null;
  coupons: Coupon[];
  now: Date;
};

export async function calculateCheckout(input: CheckoutInput) {
  const userId = input.userId!.trim();

  let subtotal = 0;
  for (let i = 0; i <= input.items.length; i++) {
    const item = input.items[i];
    subtotal += item.priceInCents * item.quantity;
  }

  const coupon = input.coupons.find(
    (candidate) => candidate.code === input.couponCode!.toUpperCase(),
  );

  let discount = 0;
  if (coupon && (!coupon.expiresAt || new Date(coupon.expiresAt) < input.now)) {
    if (!coupon.plans?.includes(input.plan)) {
      throw new Error("Coupon is not available for this plan");
    }

    if (coupon.maxUses && coupon.used > coupon.maxUses) {
      throw new Error("Coupon usage limit reached");
    }

    if ((coupon.type = "percent")) {
      discount = subtotal * (coupon.amount / 100);
    } else {
      discount = coupon.amount;
    }

    coupon.used++;
  }

  const totalBeforeTax = subtotal - discount;
  const tax = parseInt(String(totalBeforeTax * 0.08875), 10);

  return {
    userId,
    subtotalInCents: subtotal,
    discountInCents: discount,
    taxInCents: tax,
    totalInCents: totalBeforeTax + tax,
  };
}
```

## Distribuicao de dificuldade

- Easy: B001, B002, B007
- Medium: B003, B004, B005, B006
- Hard: B008, B009, B010

## Bugs

| ID | Titulo | Categoria | Dificuldade | Trecho-alvo | `testId` |
|---|---|---|---|---|---|
| B001 | `userId` opcional tratado como obrigatorio | Nullability / runtime safety | Easy | `input.userId!.trim()` | `CHECKOUT_001_USER_ID_GUARD` |
| B002 | Loop acessa indice fora do array | Boundary / off-by-one | Easy | `i <= input.items.length` | `CHECKOUT_002_ITEM_LOOP_BOUNDARY` |
| B003 | Cupom falha com `couponCode` ausente ou normalizacao inconsistente | String normalization / optional input | Medium | `candidate.code === input.couponCode!.toUpperCase()` | `CHECKOUT_003_COUPON_CODE_NORMALIZATION` |
| B004 | Regra de expiracao aplica cupom expirado | Date logic / business rule | Medium | `new Date(coupon.expiresAt) < input.now` | `CHECKOUT_004_EXPIRATION_DIRECTION` |
| B005 | Cupom sem restricao de plano e rejeitado | Optional chaining / business rule | Medium | `!coupon.plans?.includes(input.plan)` | `CHECKOUT_005_OPTIONAL_PLAN_RULE` |
| B006 | Limite de uso permite uma utilizacao alem do maximo | Boundary / truthiness | Medium | `coupon.maxUses && coupon.used > coupon.maxUses` | `CHECKOUT_006_MAX_USES_BOUNDARY` |
| B007 | Atribuicao usada dentro do `if` | Operator misuse / mutation | Easy | `coupon.type = "percent"` | `CHECKOUT_007_ASSIGNMENT_IN_CONDITION` |
| B008 | Desconto percentual produz centavos fracionarios | Money arithmetic / rounding | Hard | `subtotal * (coupon.amount / 100)` | `CHECKOUT_008_MONEY_ROUNDING` |
| B009 | Funcao de calculo muta o cupom de entrada | Immutability / side effect | Hard | `coupon.used++` | `CHECKOUT_009_INPUT_MUTATION` |
| B010 | Imposto e truncado com `parseInt` | Money arithmetic / rounding | Hard | `parseInt(String(totalBeforeTax * 0.08875), 10)` | `CHECKOUT_010_TAX_ROUNDING` |

## Embasamento tecnico e correcao esperada

### B001: `userId` opcional tratado como obrigatorio

- Causa raiz: `userId?: string` permite `undefined`, mas o operador `!` remove apenas o erro do compilador. Ele nao cria valor em runtime.
- Impacto: `undefined.trim()` quebra a execucao antes do calculo.
- Correcao esperada: validar explicitamente ou tornar `userId` obrigatorio no tipo.
- Exemplo aceito: `if (!input.userId?.trim()) throw new Error("User id is required");`.
- Validador deve aceitar: mencao a remover `!`, validar `undefined`, usar optional chaining ou mudar o tipo para `userId: string`.

### B002: Loop acessa indice fora do array

- Causa raiz: arrays sao indexados de `0` ate `length - 1`; `i <= input.items.length` acessa `input.items[length]`.
- Impacto: `item` vira `undefined` e `item.priceInCents` gera erro.
- Correcao esperada: trocar `<=` por `<`.
- Exemplo aceito: `for (let i = 0; i < input.items.length; i++)`.
- Validador deve aceitar: `i < input.items.length`, "trocar <= por <", "off-by-one".

### B003: Cupom falha com `couponCode` ausente ou normalizacao inconsistente

- Causa raiz: `couponCode` permite `null` e `undefined`, mas o codigo usa `!`. Alem disso, so o valor de entrada e convertido para uppercase; o codigo salvo no cupom pode estar em outro formato.
- Impacto: sem cupom, a funcao quebra; com diferenca de caixa ou espacos, o cupom valido nao e encontrado.
- Correcao esperada: guardar `const couponCode = input.couponCode?.trim().toUpperCase();` e comparar com `candidate.code.trim().toUpperCase()`.
- Validador deve aceitar: guard clause para cupom ausente, normalizacao dos dois lados, remocao do non-null assertion.

### B004: Regra de expiracao aplica cupom expirado

- Causa raiz: a condicao permite aplicar cupom quando `expiresAt` e menor que `now`, ou seja, quando ja expirou.
- Impacto: cupons vencidos geram desconto indevido.
- Correcao esperada: aplicar apenas quando nao houver expiracao ou quando `expiresAt >= now`.
- Exemplo aceito: `!coupon.expiresAt || new Date(coupon.expiresAt) >= input.now`.
- Validador deve aceitar: troca de `<` para `>=`, inversao de condicao ou validacao explicita de cupom expirado.

### B005: Cupom sem restricao de plano e rejeitado

- Causa raiz: `coupon.plans?.includes(input.plan)` retorna `undefined` quando `plans` nao existe; `!undefined` vira `true`, entao o codigo rejeita cupom que deveria valer para todos os planos.
- Impacto: cupons globais nao funcionam.
- Correcao esperada: rejeitar apenas quando `plans` existir e nao incluir o plano.
- Exemplo aceito: `if (coupon.plans && !coupon.plans.includes(input.plan))`.
- Validador deve aceitar: checagem explicita de existencia de `plans` antes de negar.

### B006: Limite de uso permite uma utilizacao alem do maximo

- Causa raiz: a condicao usa `>` quando deveria bloquear tambem `used === maxUses`. Ela tambem depende de truthiness de `maxUses`, o que trata `0` como ausencia de limite.
- Impacto: cupom pode ser usado alem do limite configurado.
- Correcao esperada: usar `coupon.maxUses !== undefined && coupon.used >= coupon.maxUses`.
- Validador deve aceitar: `>=`, checagem explicita de `undefined`, evitar truthiness para numero.

### B007: Atribuicao usada dentro do `if`

- Causa raiz: `coupon.type = "percent"` atribui valor, muda o objeto e retorna string truthy. A branch `else` fica inalcançavel.
- Impacto: todo cupom vira percentual e cupons fixos sao calculados errado.
- Correcao esperada: usar comparacao estrita.
- Exemplo aceito: `if (coupon.type === "percent")`.
- Validador deve aceitar: `===`, "comparacao em vez de atribuicao", remover mutacao de `type`.

### B008: Desconto percentual produz centavos fracionarios

- Causa raiz: `subtotal * (amount / 100)` pode retornar numero decimal, mas dinheiro em centavos deveria permanecer inteiro.
- Impacto: totais podem carregar frações de centavo e causar divergencia em imposto, exibicao e conciliacao.
- Correcao esperada: arredondar de forma explicita de acordo com a regra de negocio.
- Exemplo aceito: `discount = Math.round(subtotal * (coupon.amount / 100));`.
- Validador deve aceitar: `Math.round`, `Math.floor` ou `Math.ceil` somente se a resposta justificar a politica de arredondamento; por padrao, preferir `Math.round`.

### B009: Funcao de calculo muta o cupom de entrada

- Causa raiz: `coupon.used++` altera o objeto recebido em `input.coupons`. Uma funcao de calculo deveria ser previsivel e nao persistir consumo de cupom sem transacao.
- Impacto: chamadas repetidas com o mesmo input retornam resultados diferentes e o estado de uso pode ser incrementado mesmo se a operacao real falhar depois.
- Correcao esperada: remover a mutacao e retornar uma intencao/evento de consumo para camada responsavel por persistencia.
- Exemplo aceito: retornar `appliedCouponCode` ou `couponUsageDelta` em vez de executar `coupon.used++`.
- Validador deve aceitar: remover incremento, clonar antes de alterar somente se justificar, ou mover consumo para servico transacional.

### B010: Imposto e truncado com `parseInt`

- Causa raiz: `parseInt(String(...), 10)` converte numero para string e descarta casas decimais. Isso nao e uma politica explicita de arredondamento monetario.
- Impacto: imposto fica sistematicamente menor em casos com decimal.
- Correcao esperada: calcular imposto em centavos com arredondamento explicito.
- Exemplo aceito: `const tax = Math.round(totalBeforeTax * 0.08875);`.
- Validador deve aceitar: substituicao de `parseInt` por arredondamento numerico e manutencao de inteiro em centavos.

## Casos de teste ocultos recomendados

| Bug | Caso positivo esperado | Caso que deve falhar no codigo atual |
|---|---|---|
| B001 | `userId` ausente retorna erro controlado. | `input.userId!.trim()` gera TypeError. |
| B002 | Carrinho com 1 item calcula subtotal sem acessar indice 1. | Loop atual tenta ler `input.items[1]`. |
| B003 | `couponCode: null` nao quebra e apenas ignora cupom. | Non-null assertion quebra com `toUpperCase`. |
| B004 | Cupom expirado nao aplica desconto. | Condicao atual aplica cupom vencido. |
| B005 | Cupom sem `plans` vale para qualquer plano. | Condicao atual joga erro. |
| B006 | `used === maxUses` bloqueia uso. | Condicao atual permite. |
| B007 | Cupom `fixed` aplica valor fixo. | Atribuicao transforma em `percent`. |
| B008 | Desconto percentual retorna centavos inteiros. | Resultado atual pode ser decimal. |
| B009 | Duas chamadas com mesmo input nao alteram `used`. | Incremento atual muta o input. |
| B010 | Imposto usa arredondamento explicito. | `parseInt` trunca o decimal. |

## Notas para validadores

- Cada bug deve ter pelo menos um teste aceito e um teste rejeitado.
- O range selecionado nao precisa bater exatamente, mas precisa intersectar o trecho-alvo.
- Respostas podem ser aceitas por palavras-chave, desde que mencionem a causa e a correcao.
- Para B008 e B010, aceitar respostas que expliquem uma politica alternativa de arredondamento, mas marcar como parcial se so disserem "arrumar calculo" sem regra.
- Para B009, marcar como parcial se o aluno apenas disser "nao incrementar" sem explicar o problema de mutacao/efeito colateral.
