import test from "node:test";
import assert from "node:assert/strict";
import { checkoutChallenge } from "../dist/challenges/checkout.js";
import { projectResolvedSource } from "../dist/index.js";

test("projectResolvedSource aplica patches em ordem e retorna diffs por bug", () => {
  const projection = projectResolvedSource(checkoutChallenge, ["B002", "B007", "B010"]);

  assert.equal(
    projection.displayedSource.split("\n")[34],
    "  for (let i = 0; i < input.items.length; i++) {",
  );
  assert.match(projection.displayedSource, /coupon\.type === "percent"/);
  assert.match(projection.displayedSource, /Math\.round\(totalBeforeTax \* 0\.08875\)/);
  assert.match(projection.resolvedBugDiffs.B002?.beforeText ?? "", /input\.items\.length/);
  assert.equal(projection.resolvedBugDiffs.B007?.afterText, 'coupon.type === "percent"');
  assert.deepEqual(projection.resolvedBugDiffs.B010?.resolvedLineIds, ["64"]);
});

test("projectResolvedSource preserva source original quando nao ha bugs resolvidos", () => {
  const projection = projectResolvedSource(checkoutChallenge, []);

  assert.equal(projection.displayedSource, checkoutChallenge.source);
  assert.deepEqual(projection.resolvedBugDiffs, {});
});
