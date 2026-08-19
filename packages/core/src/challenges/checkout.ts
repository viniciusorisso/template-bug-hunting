import type { ChallengeDefinition } from "../types";

const source = `type Plan = "free" | "pro" | "enterprise";
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
`;

export const checkoutChallenge: ChallengeDefinition = {
  id: "checkout-ts-bug-hunt",
  title: "Checkout TypeScript Challenge",
  description: "Template default com bugs de checkout misturando runtime safety, regras de negocio e efeitos colaterais.",
  language: "typescript",
  source,
  bugs: [
    {
      id: "B001",
      title: "userId opcional tratado como obrigatorio",
      category: "Nullability / runtime safety",
      difficulty: "easy",
      expectedRange: { startLine: 32, startColumn: 18, endLine: 32, endColumn: 39 },
      testId: "CHECKOUT_001_USER_ID_GUARD",
      expectedFix: "Validar input.userId antes de usar trim ou tornar o tipo obrigatorio.",
      technicalBasis: "Non-null assertion nao protege runtime; o valor pode ser undefined.",
      patch: {
        range: { startLine: 32, startColumn: 18, endLine: 32, endColumn: 39 },
        replacement: 'input.userId?.trim() ?? ""'
      },
      hints: [
        { level: 1, message: "Ha uma suposicao otimista demais sobre um campo do usuario logo no inicio da funcao." },
        { level: 2, message: "Revise o primeiro acesso a dados do usuario e pense no que acontece quando esse valor nao chega preenchido em runtime." }
      ]
    },
    {
      id: "B002",
      title: "Loop acessa indice fora do array",
      category: "Boundary / off-by-one",
      difficulty: "easy",
      expectedRange: { startLine: 35, startColumn: 23, endLine: 35, endColumn: 46 },
      testId: "CHECKOUT_002_ITEM_LOOP_BOUNDARY",
      expectedFix: "Trocar <= por < no limite do loop.",
      technicalBasis: "Array vai de 0 ate length - 1.",
      patch: {
        range: { startLine: 35, startColumn: 19, endLine: 35, endColumn: 42 },
        replacement: "i < input.items.length"
      },
      hints: [
        { level: 1, message: "Existe um problema de limite na iteracao que monta o subtotal do carrinho." },
        { level: 2, message: "Compare a condicao de parada do loop com o intervalo valido de indices de um array em JavaScript." }
      ]
    },
    {
      id: "B003",
      title: "Cupom falha com couponCode ausente ou sem normalizacao completa",
      category: "String normalization / optional input",
      difficulty: "medium",
      expectedRange: { startLine: 41, startColumn: 20, endLine: 41, endColumn: 61 },
      testId: "CHECKOUT_003_COUPON_CODE_NORMALIZATION",
      expectedFix: "Normalizar couponCode e candidate.code com trim e uppercase, sem usar !.",
      technicalBasis: "couponCode pode ser null ou undefined e comparacao parcial falha com caixa e espacos.",
      patch: {
        range: { startLine: 41, startColumn: 20, endLine: 41, endColumn: 61 },
        replacement: "candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()"
      },
      hints: [
        { level: 1, message: "A busca do cupom mistura um valor opcional com comparacao textual sensivel ao formato dos dados." },
        { level: 2, message: "Olhe para a expressao que localiza o cupom e revise tanto a ausencia do valor informado quanto a consistencia do formato comparado." }
      ]
    },
    {
      id: "B004",
      title: "Regra de expiracao aplica cupom expirado",
      category: "Date logic / business rule",
      difficulty: "medium",
      expectedRange: { startLine: 45, startColumn: 17, endLine: 45, endColumn: 78 },
      testId: "CHECKOUT_004_EXPIRATION_DIRECTION",
      expectedFix: "Aplicar apenas quando expiresAt nao existir ou for maior/igual a now.",
      technicalBasis: "A comparacao atual aceita cupom vencido.",
      patch: {
        range: { startLine: 45, startColumn: 17, endLine: 45, endColumn: 78 },
        replacement: "!coupon.expiresAt || new Date(coupon.expiresAt) >= input.now"
      },
      hints: [
        { level: 1, message: "A regra temporal do cupom esta invertendo o sentido do que significa estar valido agora." },
        { level: 2, message: "Revise a comparacao entre a data de expiracao e o instante atual: o ramo verdadeiro hoje aceita um estado que deveria bloquear o desconto." }
      ]
    },
    {
      id: "B005",
      title: "Cupom sem restricao de plano e rejeitado",
      category: "Optional chaining / business rule",
      difficulty: "medium",
      expectedRange: { startLine: 46, startColumn: 9, endLine: 46, endColumn: 46 },
      testId: "CHECKOUT_005_OPTIONAL_PLAN_RULE",
      expectedFix: "Negar apenas quando plans existir e nao incluir o plano.",
      technicalBasis: "plans undefined deveria significar cupom valido para todos os planos.",
      patch: {
        range: { startLine: 46, startColumn: 9, endLine: 46, endColumn: 46 },
        replacement: "coupon.plans && !coupon.plans.includes(input.plan)"
      },
      hints: [
        { level: 1, message: "Uma regra opcional do cupom esta sendo tratada como se sempre existisse antes da validacao do plano." },
        { level: 2, message: "Observe a condicao que rejeita o plano: quando a lista de planos nao vem informada, o comportamento atual nao representa uma regra global." }
      ]
    },
    {
      id: "B006",
      title: "Limite de uso permite uma utilizacao alem do maximo",
      category: "Boundary / truthiness",
      difficulty: "medium",
      expectedRange: { startLine: 50, startColumn: 9, endLine: 50, endColumn: 57 },
      testId: "CHECKOUT_006_MAX_USES_BOUNDARY",
      expectedFix: "Usar >= e checagem explicita de undefined.",
      technicalBasis: "A comparacao atual permite used === maxUses e ignora maxUses 0.",
      patch: {
        range: { startLine: 50, startColumn: 9, endLine: 50, endColumn: 57 },
        replacement: "coupon.maxUses !== undefined && coupon.used >= coupon.maxUses"
      },
      hints: [
        { level: 1, message: "A protecao contra excesso de uso falha em um caso de fronteira e tambem depende demais de truthiness." },
        { level: 2, message: "Reveja a validacao do limite maximo pensando em dois cenarios: quando o total permitido ja foi atingido e quando o limite configurado pode ser zero." }
      ]
    },
    {
      id: "B007",
      title: "Atribuicao usada dentro do if",
      category: "Operator misuse / mutation",
      difficulty: "easy",
      expectedRange: { startLine: 54, startColumn: 9, endLine: 54, endColumn: 35 },
      testId: "CHECKOUT_007_ASSIGNMENT_IN_CONDITION",
      expectedFix: "Usar comparacao estrita em vez de atribuicao.",
      technicalBasis: "Atribuicao retorna valor truthy e ainda muta o cupom.",
      patch: {
        range: { startLine: 54, startColumn: 9, endLine: 54, endColumn: 35 },
        replacement: 'coupon.type === "percent"'
      },
      hints: [
        { level: 1, message: "A decisao entre desconto percentual e fixo esta alterando estado quando deveria apenas verificar uma condicao." },
        { level: 2, message: "Inspecione o operador usado no if que escolhe o tipo de desconto: hoje ele faz mais do que comparar." }
      ]
    },
    {
      id: "B008",
      title: "Desconto percentual produz centavos fracionarios",
      category: "Money arithmetic / rounding",
      difficulty: "hard",
      expectedRange: { startLine: 55, startColumn: 18, endLine: 55, endColumn: 53 },
      testId: "CHECKOUT_008_MONEY_ROUNDING",
      expectedFix: "Aplicar politica explicita de arredondamento, idealmente Math.round.",
      technicalBasis: "Dinheiro em centavos nao deve manter fracao.",
      patch: {
        range: { startLine: 55, startColumn: 18, endLine: 55, endColumn: 53 },
        replacement: "Math.round(subtotal * (coupon.amount / 100))"
      },
      hints: [
        { level: 1, message: "O calculo percentual do desconto ignora que o dominio usa centavos inteiros, nao valores fracionarios." },
        { level: 2, message: "Revise a operacao que converte porcentagem em desconto monetario e defina uma politica numerica explicita para o resultado." }
      ]
    },
    {
      id: "B009",
      title: "Funcao de calculo muta o cupom de entrada",
      category: "Immutability / side effect",
      difficulty: "hard",
      expectedRange: { startLine: 60, startColumn: 5, endLine: 60, endColumn: 18 },
      testId: "CHECKOUT_009_INPUT_MUTATION",
      expectedFix: "Nao mutar coupon.used; retornar uma intencao de consumo para outra camada.",
      technicalBasis: "Funcao de calculo pura nao deveria persistir side effects no input.",
      patch: {
        range: { startLine: 60, startColumn: 5, endLine: 60, endColumn: 18 },
        replacement: "// coupon usage should be persisted outside this calculation"
      },
      hints: [
        { level: 1, message: "A rotina de calculo esta assumindo uma responsabilidade de persistencia que cria efeito colateral sobre a entrada." },
        { level: 2, message: "Procure a linha que altera o proprio cupom durante o calculo: esse passo deveria ser tratado fora da funcao pura de checkout." }
      ]
    },
    {
      id: "B010",
      title: "Imposto e truncado com parseInt",
      category: "Money arithmetic / rounding",
      difficulty: "hard",
      expectedRange: { startLine: 64, startColumn: 15, endLine: 64, endColumn: 62 },
      testId: "CHECKOUT_010_TAX_ROUNDING",
      expectedFix: "Arredondar imposto numericamente, idealmente com Math.round.",
      technicalBasis: "parseInt trunca e nao expressa politica monetaria.",
      patch: {
        range: { startLine: 64, startColumn: 15, endLine: 64, endColumn: 62 },
        replacement: "Math.round(totalBeforeTax * 0.08875)"
      },
      hints: [
        { level: 1, message: "A conversao final do imposto esta descartando informacao numerica de um jeito mais textual do que financeiro." },
        { level: 2, message: "Reveja a etapa que transforma o imposto em inteiro: a operacao atual corta casas decimais sem declarar a politica monetaria desejada." }
      ]
    }
  ]
};
