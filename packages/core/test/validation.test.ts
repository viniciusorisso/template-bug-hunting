import test from "node:test";
import assert from "node:assert/strict";
import { appendAttempt, validateSubmission } from "../dist/index.js";
import { checkoutChallenge } from "../dist/challenges/checkout.js";
import type { SessionProgress, SubmitBugRequest } from "../dist/index.js";

function createSessionProgress(overrides: Partial<SessionProgress> = {}): SessionProgress {
  return {
    sessionId: "session-1",
    challengeId: checkoutChallenge.id,
    solvedBugIds: [],
    attempts: [],
    ...overrides
  };
}

function createRequest(overrides: Partial<SubmitBugRequest> = {}): SubmitBugRequest {
  return {
    challengeId: checkoutChallenge.id,
    sessionId: "session-1",
    selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
    proposedFix: "Trocar <= por < porque existe um off-by-one no loop.",
    ...overrides
  };
}

test("validateSubmission aceita resposta explicativa textual", () => {
  const result = validateSubmission(
    createRequest({ proposedFix: "Trocar <= por < porque existe um off-by-one no loop." }),
    createSessionProgress()
  );

  assert.equal(result.status, "solved");
  assert.equal(result.bugId, "B002");
});

test("validateSubmission aceita resposta textual com codigo", () => {
  const result = validateSubmission(
    createRequest({ proposedFix: "Trocar <= por <, ficando for (let i = 0; i < input.items.length; i++)." }),
    createSessionProgress()
  );

  assert.equal(result.status, "solved");
  assert.equal(result.bugId, "B002");
});

test("validateSubmission aceita resposta apenas com codigo", () => {
  const result = validateSubmission(
    createRequest({ proposedFix: "for (let i = 0; i < input.items.length; i++)" }),
    createSessionProgress()
  );

  assert.equal(result.status, "solved");
  assert.equal(result.bugId, "B002");
});

test("validateSubmission retorna duplicate para bug ja resolvido", () => {
  const result = validateSubmission(
    createRequest(),
    createSessionProgress({ solvedBugIds: ["B002"] })
  );

  assert.equal(result.status, "duplicate");
  assert.equal(result.bugId, "B002");
});

test("validateSubmission retorna partial quando o range esta certo mas a correcao esta vaga", () => {
  const result = validateSubmission(
    createRequest({ proposedFix: "Tem um problema no loop." }),
    createSessionProgress()
  );

  assert.equal(result.status, "partial");
  assert.equal(result.bugId, "B002");
});

test("validateSubmission aceita o exemplo catalogado de B009", () => {
  const result = validateSubmission(
    createRequest({
      selection: { startLine: 60, startColumn: 5, endLine: 60, endColumn: 18 },
      proposedFix: "return { appliedCouponCode: coupon.code, couponUsageDelta: 1 };"
    }),
    createSessionProgress()
  );

  assert.equal(result.status, "solved");
  assert.equal(result.bugId, "B009");
});

test("validateSubmission aceita resposta apenas com codigo para B006", () => {
  const result = validateSubmission(
    createRequest({
      selection: { startLine: 50, startColumn: 9, endLine: 50, endColumn: 57 },
      proposedFix: "coupon.maxUses !== undefined && coupon.used >= coupon.maxUses"
    }),
    createSessionProgress()
  );

  assert.equal(result.status, "solved");
  assert.equal(result.bugId, "B006");
});

test("validateSubmission retorna incorrect para range desconhecido", () => {
  const result = validateSubmission(
    createRequest({ selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 } }),
    createSessionProgress()
  );

  assert.equal(result.status, "incorrect");
  assert.equal(result.accepted, false);
});

test("appendAttempt registra tentativa e adiciona bug resolvido uma vez", () => {
  const request = createRequest();
  const response = validateSubmission(request, createSessionProgress());
  const next = appendAttempt(createSessionProgress(), request, response);

  assert.deepEqual(next.solvedBugIds, ["B002"]);
  assert.equal(next.attempts.length, 1);
  assert.equal(next.attempts[0]?.status, "solved");
});

test("validateSubmission seleciona o bug resolvido em uma selecao multilinha", () => {
  const result = validateSubmission(
    createRequest({
      selection: { startLine: 35, startColumn: 1, endLine: 41, endColumn: 62 },
      proposedFix: "Tratar couponCode ausente sem ! e normalizar candidate.code com trim e uppercase."
    }),
    createSessionProgress()
  );

  assert.equal(result.status, "solved");
  assert.equal(result.bugId, "B003");
});
