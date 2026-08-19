import type { ChallengeDefinition, Difficulty, HintLevel, RequestHintResponse } from "./types.js";

type ConsumedHintsByBug = Record<string, HintLevel[]>;

const difficultyOrder: Difficulty[] = ["easy", "medium", "hard"];

export function listHintCatalogViolations(challenge: ChallengeDefinition): string[] {
  const issues: string[] = [];

  for (const bug of challenge.bugs) {
    if (bug.hints.length === 0) {
      issues.push(`${challenge.id}:${bug.id}:missing-hints`);
      continue;
    }

    const sortedLevels = [...bug.hints].map((hint) => hint.level).sort((left, right) => left - right);

    for (let index = 0; index < sortedLevels.length; index += 1) {
      if (sortedLevels[index] !== index + 1) {
        issues.push(`${challenge.id}:${bug.id}:non-sequential-levels`);
        break;
      }
    }

    for (const hint of bug.hints) {
      const message = hint.message.trim();
      const expectedFix = bug.expectedFix.trim();
      const replacement = bug.patch.replacement.trim();

      if (!message) {
        issues.push(`${challenge.id}:${bug.id}:empty-hint-level-${hint.level}`);
      }

      if (message === expectedFix || message.includes(expectedFix)) {
        issues.push(`${challenge.id}:${bug.id}:expected-fix-leak-level-${hint.level}`);
      }

      if (message === replacement || message.includes(replacement)) {
        issues.push(`${challenge.id}:${bug.id}:patch-leak-level-${hint.level}`);
      }
    }
  }

  return issues;
}

export function selectNextHint(
  challenge: ChallengeDefinition,
  resolvedBugIds: string[],
  consumedHintsByBug: ConsumedHintsByBug,
  roomCode?: string
): RequestHintResponse | null {
  const resolved = new Set(resolvedBugIds);

  for (const difficulty of difficultyOrder) {
    for (const bug of challenge.bugs) {
      if (bug.difficulty !== difficulty || resolved.has(bug.id)) {
        continue;
      }

      const consumedLevels = new Set(consumedHintsByBug[bug.id] ?? []);
      const nextHint = [...bug.hints]
        .sort((left, right) => left.level - right.level)
        .find((hint) => !consumedLevels.has(hint.level));

      if (!nextHint) {
        continue;
      }

      return {
        challengeId: challenge.id,
        roomCode,
        bugId: bug.id,
        difficulty: bug.difficulty,
        hintLevel: nextHint.level,
        message: nextHint.message,
        category: bug.category
      };
    }
  }

  return null;
}
