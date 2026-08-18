export type TokenKind =
  | "plain"
  | "keyword"
  | "type"
  | "string"
  | "number"
  | "comment"
  | "literal"
  | "operator"
  | "punctuation"
  | "function";

export type Token = {
  value: string;
  kind: TokenKind;
};

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "return",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "while"
]);

const TYPES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Math",
  "Number",
  "Promise",
  "Record",
  "Readonly",
  "String"
]);

const LITERALS = new Set(["false", "null", "true", "undefined"]);
const FUNCTIONS = new Set(["find", "includes", "parseInt", "trim"]);
const OPERATORS = /^(===|!==|==|!=|<=|>=|=>|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|%=|\?|:|=|<|>|\+|-|\*|\/|%|!)/;
const PUNCTUATION = /^[()[\]{}.,;]/;

export function tokenizeTsLine(line: string): Token[] {
  if (!line) {
    return [{ value: " ", kind: "plain" }];
  }

  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    const slice = line.slice(cursor);

    const whitespaceMatch = slice.match(/^\s+/);

    if (whitespaceMatch) {
      tokens.push({ value: whitespaceMatch[0], kind: "plain" });
      cursor += whitespaceMatch[0].length;
      continue;
    }

    const commentMatch = slice.match(/^\/\/.*$/);

    if (commentMatch) {
      tokens.push({ value: commentMatch[0], kind: "comment" });
      break;
    }

    const stringMatch = slice.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);

    if (stringMatch) {
      tokens.push({ value: stringMatch[0], kind: "string" });
      cursor += stringMatch[0].length;
      continue;
    }

    const numberMatch = slice.match(/^\d+(?:\.\d+)?/);

    if (numberMatch) {
      tokens.push({ value: numberMatch[0], kind: "number" });
      cursor += numberMatch[0].length;
      continue;
    }

    const operatorMatch = slice.match(OPERATORS);

    if (operatorMatch) {
      tokens.push({ value: operatorMatch[0], kind: "operator" });
      cursor += operatorMatch[0].length;
      continue;
    }

    const punctuationMatch = slice.match(PUNCTUATION);

    if (punctuationMatch) {
      tokens.push({ value: punctuationMatch[0], kind: "punctuation" });
      cursor += punctuationMatch[0].length;
      continue;
    }

    const identifierMatch = slice.match(/^[A-Za-z_$][\w$]*/);

    if (identifierMatch) {
      const value = identifierMatch[0];
      const kind = KEYWORDS.has(value)
        ? "keyword"
        : TYPES.has(value)
          ? "type"
          : LITERALS.has(value)
            ? "literal"
            : FUNCTIONS.has(value)
              ? "function"
              : "plain";

      tokens.push({ value, kind });
      cursor += value.length;
      continue;
    }

    tokens.push({ value: slice[0], kind: "plain" });
    cursor += 1;
  }

  return tokens;
}

export function getTokenClass(kind: TokenKind): string {
  return `token-${kind}`;
}
