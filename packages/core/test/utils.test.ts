import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRange, normalizeText, rangeIntersects } from "../dist/index.js";

test("normalizeRange reordena ranges invertidos", () => {
  assert.deepEqual(
    normalizeRange({ startLine: 5, startColumn: 12, endLine: 3, endColumn: 2 }),
    { startLine: 3, startColumn: 2, endLine: 5, endColumn: 12 }
  );
});

test("rangeIntersects detecta intersecao entre ranges", () => {
  assert.equal(
    rangeIntersects(
      { startLine: 10, startColumn: 1, endLine: 10, endColumn: 20 },
      { startLine: 10, startColumn: 18, endLine: 11, endColumn: 8 }
    ),
    true
  );
});

test("normalizeText remove acentos e normaliza espacos", () => {
  assert.equal(normalizeText("  CORRECAO   inválida "), "correcao invalida");
});
