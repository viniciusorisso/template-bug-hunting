import test from "node:test";
import assert from "node:assert/strict";
import { checkoutChallenge } from "../dist/challenges/checkout.js";
import { projectResolvedSource } from "../dist/index.js";

test("projectResolvedSource aplica patches em ordem e retorna diffs por bug", () => {
  const projection = projectResolvedSource(checkoutChallenge, ["B002", "B007", "B010"]);

  assert.match(projection.displayedSource, /i < input\.items\.length/);
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
