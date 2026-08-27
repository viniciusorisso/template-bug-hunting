import test from "node:test";
import assert from "node:assert/strict";
import { calculateServerDiff, hashSource } from "../src/editor-diff.ts";

test("calcula uma operacao server-side sem confiar no diff do cliente", () => {
    const result = calculateServerDiff("const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;");
    assert.deepEqual(result, { operations: [{ type: "replace", originalStartLine: 2, originalEndLine: 2, replacementText: "const b = 3;" }], addedLines: 1, removedLines: 1 });
});

test("gera versao deterministica para a fonte canonica", () => {
    assert.equal(hashSource("abc"), hashSource("abc"));
    assert.notEqual(hashSource("abc"), hashSource("abd"));
});
