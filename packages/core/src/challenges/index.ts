import type { ChallengeDefinition, PublicChallengeDefinition } from "../types.js";
import { checkoutChallenge } from "./checkout.js";
import { typeSystemChallenge } from "./type-system.js";

const challenges = [checkoutChallenge, typeSystemChallenge] satisfies ChallengeDefinition[];

export function listChallenges(): ChallengeDefinition[] {
  return challenges;
}

export function getChallengeById(challengeId: string): ChallengeDefinition | undefined {
  return challenges.find((challenge) => challenge.id === challengeId);
}

export function toPublicChallenge(challenge: ChallengeDefinition): PublicChallengeDefinition {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    language: challenge.language,
    source: challenge.source,
    bugs: challenge.bugs.map(({ id, title, category, difficulty }) => ({ id, title, category, difficulty }))
  };
}

export function listPublicChallenges(): PublicChallengeDefinition[] {
  return challenges.map(toPublicChallenge);
}
