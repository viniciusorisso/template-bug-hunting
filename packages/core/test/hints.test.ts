import test from "node:test";
import assert from "node:assert/strict";
import { getChallengeById, listChallenges, listHintCatalogViolations, selectNextHint } from "../dist/index.js";

const checkoutChallenge = getChallengeById("checkout-ts-bug-hunt");

if (!checkoutChallenge) {
  throw new Error("Challenge fixture nao encontrado.");
}

test("hint catalog nao vaza expectedFix nem patch replacement", () => {
  const violations = listChallenges().flatMap((challenge) => listHintCatalogViolations(challenge));
  assert.deepEqual(violations, []);
});

test("selectNextHint prioriza bugs easy antes de medium e hard", () => {
  const hint = selectNextHint(checkoutChallenge, [], {});

  assert.equal(hint?.bugId, "B001");
  assert.equal(hint?.difficulty, "easy");
  assert.equal(hint?.hintLevel, 1);
});

test("selectNextHint avanca o nivel da dica antes de trocar de bug dentro da mesma dificuldade", () => {
  const hint = selectNextHint(checkoutChallenge, [], { B001: [1] });

  assert.equal(hint?.bugId, "B001");
  assert.equal(hint?.hintLevel, 2);
});

test("selectNextHint ignora bug resolvido e segue para o proximo candidato elegivel", () => {
  const hint = selectNextHint(checkoutChallenge, ["B001"], {});

  assert.equal(hint?.bugId, "B002");
  assert.equal(hint?.difficulty, "easy");
});

test("selectNextHint cai para medium quando todos os easy acabaram", () => {
  const hint = selectNextHint(checkoutChallenge, [], {
    B001: [1, 2],
    B002: [1, 2],
    B007: [1, 2]
  });

  assert.equal(hint?.bugId, "B003");
  assert.equal(hint?.difficulty, "medium");
});
