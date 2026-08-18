import type { ChallengeDefinition } from "../types.js";
import { checkoutChallenge } from "./checkout.js";
import { typeSystemChallenge } from "./type-system.js";

const challenges = [checkoutChallenge, typeSystemChallenge] satisfies ChallengeDefinition[];

export function listChallenges(): ChallengeDefinition[] {
  return challenges;
}

export function getChallengeById(challengeId: string): ChallengeDefinition | undefined {
  return challenges.find((challenge) => challenge.id === challengeId);
}

