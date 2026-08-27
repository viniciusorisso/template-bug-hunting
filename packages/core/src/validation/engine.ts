import type {
  BugDefinition,
  BugValidationTestId,
  SessionProgress,
  SubmissionAttempt,
  SubmitBugRequest,
  SubmitBugResponse,
  ValidationContext,
  ValidationResult
} from "../types.js";
import { getChallengeById } from "../challenges/index.js";
import { normalizeRange, normalizeText, rangeIntersects } from "../utils.js";
import {
  validateAssignmentInCondition,
  validateCouponCodeNormalization,
  validateExpirationDirection,
  validateInputMutation,
  validateItemLoopBoundary,
  validateMaxUsesBoundary,
  validateMoneyRounding,
  validateOptionalPlanRule,
  validateTaxRounding,
  validateUserIdGuard,
  validateProfileEmailNonNullAssertion,
  validateProfileIdNonNullAssertion,
  validateProfileMetadataAssertion,
  validateProfileNotificationExhaustiveness,
  validateProfilePreferencesAssertion,
  validateProfileReadonlyAssertionAlias,
  validateProfileReadonlyRoleMutation,
  validateProfileSharedDefaultShortcuts
} from "./validators.js";

export function runBugValidation(
  testId: BugValidationTestId,
  context: ValidationContext
): ValidationResult {
  switch (testId) {
    case "CHECKOUT_001_USER_ID_GUARD":
      return validateUserIdGuard(context);
    case "CHECKOUT_002_ITEM_LOOP_BOUNDARY":
      return validateItemLoopBoundary(context);
    case "CHECKOUT_003_COUPON_CODE_NORMALIZATION":
      return validateCouponCodeNormalization(context);
    case "CHECKOUT_004_EXPIRATION_DIRECTION":
      return validateExpirationDirection(context);
    case "CHECKOUT_005_OPTIONAL_PLAN_RULE":
      return validateOptionalPlanRule(context);
    case "CHECKOUT_006_MAX_USES_BOUNDARY":
      return validateMaxUsesBoundary(context);
    case "CHECKOUT_007_ASSIGNMENT_IN_CONDITION":
      return validateAssignmentInCondition(context);
    case "CHECKOUT_008_MONEY_ROUNDING":
      return validateMoneyRounding(context);
    case "CHECKOUT_009_INPUT_MUTATION":
      return validateInputMutation(context);
    case "CHECKOUT_010_TAX_ROUNDING":
      return validateTaxRounding(context);
    case "PROFILE_001_ID_NON_NULL_ASSERTION":
      return validateProfileIdNonNullAssertion(context);
    case "PROFILE_002_EMAIL_NON_NULL_ASSERTION":
      return validateProfileEmailNonNullAssertion(context);
    case "PROFILE_003_READONLY_ASSERTION_ALIAS":
      return validateProfileReadonlyAssertionAlias(context);
    case "PROFILE_004_READONLY_ROLE_MUTATION":
      return validateProfileReadonlyRoleMutation(context);
    case "PROFILE_005_SHARED_DEFAULT_SHORTCUTS":
      return validateProfileSharedDefaultShortcuts(context);
    case "PROFILE_006_PREFERENCES_ASSERTION":
      return validateProfilePreferencesAssertion(context);
    case "PROFILE_007_METADATA_ASSERTION":
      return validateProfileMetadataAssertion(context);
    case "PROFILE_008_NOTIFICATION_EXHAUSTIVENESS":
      return validateProfileNotificationExhaustiveness(context);
  }
}

export function validateSubmission(
  request: SubmitBugRequest,
  sessionProgress: SessionProgress
): SubmitBugResponse {
  const challenge = getChallengeById(request.challengeId);

  if (!challenge) {
    return {
      accepted: false,
      status: "incorrect",
      feedback: "Challenge nao encontrado.",
      resolvedBugIds: sessionProgress.solvedBugIds
    };
  }

  const normalizedSelection = normalizeRange(request.selection);
  const normalizedFix = normalizeText(request.proposedFix);
  const candidates = challenge.bugs.filter((bug) => rangeIntersects(normalizedSelection, bug.expectedRange));

  if (candidates.length === 0) {
    return {
      accepted: false,
      status: "incorrect",
      feedback: "A selecao nao corresponde a um bug conhecido do desafio.",
      resolvedBugIds: sessionProgress.solvedBugIds
    };
  }

  const candidate = candidates[0];

  if (sessionProgress.solvedBugIds.includes(candidate.id)) {
    return {
      accepted: false,
      status: "duplicate",
      bugId: candidate.id,
      feedback: "Esse bug ja foi resolvido nesta sessao.",
      technicalBasis: candidate.technicalBasis,
      resolvedBugIds: sessionProgress.solvedBugIds
    };
  }

  const result = runBugValidation(candidate.testId, {
    bug: candidate,
    selection: normalizedSelection,
    proposedFix: request.proposedFix,
    normalizedFix,
    sessionProgress
  });

  return buildResponse(candidate, result, sessionProgress);
}

export function appendAttempt(
  sessionProgress: SessionProgress,
  request: SubmitBugRequest,
  response: SubmitBugResponse
): SessionProgress {
  const nextSolvedBugIds =
    response.status === "solved" && response.bugId
      ? [...new Set([...sessionProgress.solvedBugIds, response.bugId])]
      : sessionProgress.solvedBugIds;

  const attempt: SubmissionAttempt = {
    challengeId: request.challengeId,
    bugId: response.bugId,
    selection: normalizeRange(request.selection),
    proposedFix: request.proposedFix,
    originalText: request.originalText,
    editedText: request.editedText,
    serverDiff: request.serverDiff,
    status: response.status,
    createdAt: new Date().toISOString()
  };

  return {
    ...sessionProgress,
    solvedBugIds: nextSolvedBugIds,
    attempts: [...sessionProgress.attempts, attempt]
  };
}

function buildResponse(
  bug: BugDefinition,
  result: ValidationResult,
  sessionProgress: SessionProgress
): SubmitBugResponse {
  const resolvedBugIds =
    result.status === "solved"
      ? [...new Set([...sessionProgress.solvedBugIds, bug.id])]
      : sessionProgress.solvedBugIds;

  return {
    accepted: result.status === "solved",
    status: result.status,
    bugId: result.status === "solved" || result.status === "partial" ? bug.id : undefined,
    feedback: result.feedback,
    technicalBasis: result.status === "solved" ? bug.technicalBasis : undefined,
    resolvedBugIds
  };
}

