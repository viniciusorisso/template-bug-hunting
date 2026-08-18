import type { CodeRange } from "./types.js";

export function normalizeRange(range: CodeRange): CodeRange {
  const startsAfterEnd =
    range.startLine > range.endLine ||
    (range.startLine === range.endLine && range.startColumn > range.endColumn);

  if (!startsAfterEnd) {
    return range;
  }

  return {
    startLine: range.endLine,
    startColumn: range.endColumn,
    endLine: range.startLine,
    endColumn: range.startColumn
  };
}

export function rangeIntersects(left: CodeRange, right: CodeRange): boolean {
  const a = normalizeRange(left);
  const b = normalizeRange(right);
  const leftStarts = toOffset(a.startLine, a.startColumn);
  const leftEnds = toOffset(a.endLine, a.endColumn);
  const rightStarts = toOffset(b.startLine, b.startColumn);
  const rightEnds = toOffset(b.endLine, b.endColumn);

  return leftStarts <= rightEnds && rightStarts <= leftEnds;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(normalizeText(term)));
}

export function containsAnyCompact(value: string, terms: string[]): boolean {
  const compactValue = compactText(value);
  return terms.some((term) => compactValue.includes(compactText(term)));
}

function toOffset(line: number, column: number): number {
  return line * 10000 + column;
}
