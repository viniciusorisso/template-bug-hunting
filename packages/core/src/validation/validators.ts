import type { ValidationContext, ValidationResult } from "../types.js";
import { containsAny, containsAnyCompact, rangeIntersects } from "../utils.js";

function incorrect(feedback: string): ValidationResult {
  return { status: "incorrect", feedback };
}

function partial(feedback: string): ValidationResult {
  return { status: "partial", feedback };
}

function solved(feedback: string): ValidationResult {
  return { status: "solved", feedback };
}

function matchesTextualOrCode(normalizedFix: string, textualTerms: string[], codeTerms: string[]): boolean {
  return containsAny(normalizedFix, textualTerms) || containsAnyCompact(normalizedFix, codeTerms);
}

function matchesBothGroups(
  normalizedFix: string,
  firstTextualTerms: string[],
  firstCodeTerms: string[],
  secondTextualTerms: string[],
  secondCodeTerms: string[]
): boolean {
  const firstMatches = matchesTextualOrCode(normalizedFix, firstTextualTerms, firstCodeTerms);
  const secondMatches = matchesTextualOrCode(normalizedFix, secondTextualTerms, secondCodeTerms);
  return firstMatches && secondMatches;
}

export function validateUserIdGuard(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao ainda nao aponta para a validacao de userId.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["user id is required", "remover !", "userid obrigatorio", "validar undefined", "optional chaining"],
      ["input.userId?.trim()", "if (!input.userId?.trim())", "userId: string"]
    )
  ) {
    return solved("Correto: o codigo precisa validar userId em runtime.");
  }

  return partial("A regiao esta correta, mas faltou explicar como evitar undefined.trim().");
}

export function validateItemLoopBoundary(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para o limite do loop.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["trocar <= por <", "off-by-one", "indice igual ao tamanho do array"],
      ["i < input.items.length", "for (let i = 0; i < input.items.length; i++)"]
    )
  ) {
    return solved("Correto: o loop nao deve acessar o indice igual a length.");
  }

  return partial("A regiao esta correta, mas faltou ajustar o limite do loop.");
}

export function validateCouponCodeNormalization(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para a busca do cupom.");
  }

  const mentionsGuard = matchesTextualOrCode(
    context.normalizedFix,
    ["couponcode ausente", "sem usar !", "null", "undefined", "guard clause"],
    ["input.couponCode?.trim().toUpperCase()", "const couponCode = input.couponCode?.trim().toUpperCase()"]
  );
  const mentionsNormalization = matchesTextualOrCode(
    context.normalizedFix,
    ["normalizar os dois lados", "candidate.code", "trim", "uppercase"],
    ["candidate.code.trim().toUpperCase()", "candidate.code.trim().toUpperCase() === couponCode"]
  );

  if (mentionsGuard && mentionsNormalization) {
    return solved("Correto: precisa tratar ausencia de cupom e normalizar a comparacao.");
  }

  if (mentionsGuard || mentionsNormalization) {
    return partial("A explicacao esta no caminho certo, mas ainda falta cobrir ausencia e normalizacao.");
  }

  return incorrect("A resposta nao explica o problema principal da busca do cupom.");
}

export function validateExpirationDirection(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para a regra de expiracao.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["trocar < por >=", "cupom expirado", "nao vencido", "inverter a condicao"],
      ["new Date(coupon.expiresAt) >= input.now", "!coupon.expiresAt || new Date(coupon.expiresAt) >= input.now"]
    )
  ) {
    return solved("Correto: a condicao atual aceita cupom expirado.");
  }

  return partial("A regiao esta correta, mas faltou inverter a regra de expiracao.");
}

export function validateOptionalPlanRule(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para a regra de planos.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["plans existir", "plans undefined", "cupom global", "sem restricao de plano"],
      ["coupon.plans && !coupon.plans.includes(input.plan)", "if (coupon.plans && !coupon.plans.includes(input.plan))"]
    )
  ) {
    return solved("Correto: sem plans o cupom deveria valer para todos os planos.");
  }

  return partial("A regiao esta correta, mas faltou tratar plans ausente como cupom global.");
}

export function validateMaxUsesBoundary(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para a validacao de maxUses.");
  }

  const mentionsBoundary = matchesTextualOrCode(
    context.normalizedFix,
    [">=", "used === maxuses", "limite de uso", "bloquear no valor exato"],
    ["coupon.used >= coupon.maxUses"]
  );
  const mentionsUndefined = matchesTextualOrCode(
    context.normalizedFix,
    ["!== undefined", "checar undefined", "evitar truthiness"],
    ["coupon.maxUses !== undefined", "coupon.maxUses!==undefined&&coupon.used>=coupon.maxUses"]
  );

  if (mentionsBoundary && mentionsUndefined) {
    return solved("Correto: o limite precisa bloquear no valor exato e nao depender de truthiness.");
  }

  if (mentionsBoundary || mentionsUndefined) {
    return partial("Faltou cobrir a fronteira e a checagem explicita de undefined.");
  }

  return incorrect("A resposta nao corrige a regra de maxUses.");
}

export function validateAssignmentInCondition(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para a condicao do tipo de cupom.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["comparacao", "atribuicao", "remover mutacao de type"],
      ["coupon.type === \"percent\"", "coupon.type === 'percent'", "if (coupon.type === \"percent\")"]
    )
  ) {
    return solved("Correto: a condicao deve comparar, nao atribuir.");
  }

  return partial("A regiao esta correta, mas faltou explicar a troca de atribuicao por comparacao.");
}

export function validateMoneyRounding(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para o calculo do desconto percentual.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["math.round", "arredondar", "centavos inteiros", "politica de arredondamento"],
      ["Math.round(subtotal * (coupon.amount / 100))", "discount = Math.round(subtotal * (coupon.amount / 100))"]
    )
  ) {
    return solved("Correto: o desconto precisa aplicar uma politica explicita de arredondamento.");
  }

  return partial("A regiao esta correta, mas faltou definir a politica de arredondamento.");
}

export function validateInputMutation(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para a mutacao do cupom.");
  }

  const mentionsMutation = matchesTextualOrCode(
    context.normalizedFix,
    ["coupon.used++", "nao mutar", "efeito colateral", "imutabilidade"],
    ["appliedCouponCode", "couponUsageDelta", "return { appliedCouponCode: coupon.code, couponUsageDelta: 1 }"]
  );
  const mentionsAlternative = matchesTextualOrCode(
    context.normalizedFix,
    ["retornar", "evento", "delta", "camada responsavel", "servico transacional"],
    ["appliedCouponCode", "couponUsageDelta", "return { appliedCouponCode: coupon.code, couponUsageDelta: 1 }"]
  );

  if (mentionsMutation && mentionsAlternative) {
    return solved("Correto: o calculo nao deveria consumir o cupom diretamente.");
  }

  if (mentionsMutation) {
    return partial("Faltou explicar para onde mover o consumo do cupom.");
  }

  return incorrect("A resposta nao descreve o problema de mutacao do input.");
}

export function validateTaxRounding(context: ValidationContext): ValidationResult {
  if (!rangeIntersects(context.selection, context.bug.expectedRange)) {
    return incorrect("A selecao nao aponta para o calculo do imposto.");
  }

  if (
    matchesTextualOrCode(
      context.normalizedFix,
      ["math.round", "parseint", "trunc", "arredondamento"],
      ["Math.round(totalBeforeTax * 0.08875)", "const tax = Math.round(totalBeforeTax * 0.08875)"]
    )
  ) {
    return solved("Correto: imposto precisa de arredondamento numerico explicito.");
  }

  return partial("A regiao esta correta, mas faltou explicar a politica de arredondamento do imposto.");
}
