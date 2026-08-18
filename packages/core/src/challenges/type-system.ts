import type { ChallengeDefinition } from "../types";

const source = `type Role = "admin" | "editor" | "viewer";
type Theme = "light" | "dark";

type Notification =
  | { type: "email"; address: string }
  | { type: "sms"; phone: string }
  | { type: "push"; token: string };

type ApiUser = {
  id: string;
  email: string;
  roles: readonly Role[];
  preferences?: {
    theme: Theme;
    shortcuts?: readonly string[];
  };
  metadata?: Record<string, string>;
};

type UserPatch = Partial<ApiUser> & {
  id?: string | null;
  email?: string | null;
};

type UserSummary = {
  id: string;
  email: string;
  primaryRole: Role;
  shortcuts: string[];
  theme: Theme;
  analyticsId: string;
};

const defaultShortcuts = ["cmd+k"];

function cloneShortcuts(shortcuts: readonly string[] | undefined) {
  return shortcuts as string[];
}

export function buildUserSummary(patch: UserPatch, fallbackRole: Role = "viewer"): UserSummary {
  const id = patch.id!.trim();
  const email = patch.email!.toLowerCase();

  const roles = (patch.roles as Role[]) ?? [fallbackRole];
  roles.sort();

  const shortcuts = cloneShortcuts(patch.preferences?.shortcuts) || defaultShortcuts;
  shortcuts.push("cmd+/");

  const theme = (patch.preferences as Required<ApiUser>["preferences"]).theme || "light";
  const metadata = patch.metadata as Record<string, string>;
  const analyticsId = metadata.analyticsId.trim();

  return {
    id,
    email,
    primaryRole: roles[0] || fallbackRole,
    shortcuts,
    theme,
    analyticsId,
  };
}

export function getNotificationTarget(notification: Notification) {
  switch (notification.type) {
    case "email":
      return notification.address.trim().toLowerCase();
    case "sms":
      return notification.phone.replace(/\s+/g, "");
    default:
      return notification.address;
  }
}
`;

export const typeSystemChallenge: ChallengeDefinition = {
  id: "ts-type-system-bug-hunt",
  title: "Type System Bug Hunt",
  description:
    "Template focado em problemas mais especificos de TypeScript, como assertions inseguras, perda de readonly, discriminated unions e side effects mascarados por tipos.",
  language: "typescript",
  source,
  bugs: [
    {
      id: "T001",
      title: "id opcional tratado com non-null assertion",
      category: "Type narrowing / nullability",
      difficulty: "easy",
      expectedRange: { startLine: 41, startColumn: 14, endLine: 41, endColumn: 30 },
      testId: "PROFILE_001_ID_NON_NULL_ASSERTION",
      expectedFix: "Validar patch.id antes de usar trim ou aplicar fallback explicito.",
      technicalBasis: "O operador ! so silencia o compilador; em runtime patch.id ainda pode ser null ou undefined.",
      patch: {
        range: { startLine: 41, startColumn: 14, endLine: 41, endColumn: 30 },
        replacement: 'patch.id?.trim() ?? ""'
      }
    },
    {
      id: "T002",
      title: "email opcional forzado via non-null assertion",
      category: "Type narrowing / nullability",
      difficulty: "easy",
      expectedRange: { startLine: 42, startColumn: 17, endLine: 42, endColumn: 40 },
      testId: "PROFILE_002_EMAIL_NON_NULL_ASSERTION",
      expectedFix: "Tratar patch.email como opcional em runtime antes de usar toLowerCase.",
      technicalBasis: "A assercao nao evita quebra quando email nao existir no patch recebido.",
      patch: {
        range: { startLine: 42, startColumn: 17, endLine: 42, endColumn: 40 },
        replacement: 'patch.email?.toLowerCase() ?? ""'
      }
    },
    {
      id: "T003",
      title: "cloneShortcuts remove readonly sem clonar",
      category: "Type assertion / aliasing",
      difficulty: "medium",
      expectedRange: { startLine: 37, startColumn: 10, endLine: 37, endColumn: 38 },
      testId: "PROFILE_003_READONLY_ASSERTION_ALIAS",
      expectedFix: "Clonar o array em vez de usar assertion para trocar readonly por mutavel.",
      technicalBasis: "as string[] reaproveita a mesma referencia e permite mutacao acidental de dados readonly.",
      patch: {
        range: { startLine: 37, startColumn: 10, endLine: 37, endColumn: 38 },
        replacement: "shortcuts ? [...shortcuts] : []"
      }
    },
    {
      id: "T004",
      title: "roles readonly sao mutadas apos assertion",
      category: "Readonly / side effect",
      difficulty: "medium",
      expectedRange: { startLine: 44, startColumn: 17, endLine: 44, endColumn: 57 },
      testId: "PROFILE_004_READONLY_ROLE_MUTATION",
      expectedFix: "Criar uma copia mutavel das roles antes de ordenar, sem assertion insegura.",
      technicalBasis: "Fazer cast de readonly para mutavel esconde um side effect sobre a colecao de entrada.",
      patch: {
        range: { startLine: 44, startColumn: 17, endLine: 44, endColumn: 57 },
        replacement: "[...(patch.roles ?? [fallbackRole])]"
      }
    },
    {
      id: "T005",
      title: "defaultShortcuts compartilhado sofre mutacao",
      category: "Shared state / side effect",
      difficulty: "medium",
      expectedRange: { startLine: 47, startColumn: 21, endLine: 47, endColumn: 83 },
      testId: "PROFILE_005_SHARED_DEFAULT_SHORTCUTS",
      expectedFix: "Clonar a lista final antes de aplicar push para nao reutilizar o array default compartilhado.",
      technicalBasis: "Quando shortcuts nao existir, o codigo muta defaultShortcuts e vaza estado entre chamadas.",
      patch: {
        range: { startLine: 47, startColumn: 21, endLine: 47, endColumn: 83 },
        replacement: "[...(cloneShortcuts(patch.preferences?.shortcuts) ?? defaultShortcuts)]"
      }
    },
    {
      id: "T006",
      title: "preferences forcado via Required e assertion",
      category: "Assertion / optional object",
      difficulty: "medium",
      expectedRange: { startLine: 50, startColumn: 17, endLine: 50, endColumn: 81 },
      testId: "PROFILE_006_PREFERENCES_ASSERTION",
      expectedFix: "Usar optional chaining e fallback em vez de forcar o objeto preferences.",
      technicalBasis: "Converter para Required com assertion nao materializa o objeto; preferences ainda pode estar ausente.",
      patch: {
        range: { startLine: 50, startColumn: 17, endLine: 50, endColumn: 81 },
        replacement: 'patch.preferences?.theme ?? "light"'
      }
    },
    {
      id: "T007",
      title: "metadata acessado como se sempre existisse",
      category: "Assertion / indexed access",
      difficulty: "medium",
      expectedRange: { startLine: 52, startColumn: 22, endLine: 52, endColumn: 47 },
      testId: "PROFILE_007_METADATA_ASSERTION",
      expectedFix: "Ler analyticsId com optional chaining e fallback seguro.",
      technicalBasis: "A assertion anterior remove a protecao do tipo, mas metadata.analyticsId continua podendo nao existir em runtime.",
      patch: {
        range: { startLine: 52, startColumn: 22, endLine: 52, endColumn: 47 },
        replacement: '(patch.metadata?.analyticsId ?? "").trim()'
      }
    },
    {
      id: "T008",
      title: "union discriminada perde o caso push",
      category: "Discriminated union / exhaustiveness",
      difficulty: "hard",
      expectedRange: { startLine: 70, startColumn: 5, endLine: 71, endColumn: 33 },
      testId: "PROFILE_008_NOTIFICATION_EXHAUSTIVENESS",
      expectedFix: "Tratar explicitamente o caso push ou tornar o switch exaustivo sem acessar campos errados.",
      technicalBasis: "No ramo default o tipo restante e push, que nao possui address; o bug foi mascarado por um switch nao exaustivo.",
      patch: {
        range: { startLine: 70, startColumn: 5, endLine: 71, endColumn: 33 },
        replacement: "case \"push\":\n      return notification.token;"
      }
    }
  ]
};
