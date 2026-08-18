import type { SessionProgress } from "../types.js";

export class InMemorySessionStore {
  private sessions = new Map<string, SessionProgress>();

  constructor(initial: SessionProgress[] = []) {
    for (const progress of initial) {
      this.save(progress);
    }
  }

  get(sessionId: string, challengeId: string): SessionProgress | undefined {
    return this.sessions.get(this.getKey(sessionId, challengeId));
  }

  getOrCreate(sessionId: string, challengeId: string): SessionProgress {
    const key = this.getKey(sessionId, challengeId);
    const existing = this.sessions.get(key);

    if (existing) {
      return existing;
    }

    const initial: SessionProgress = {
      sessionId,
      challengeId,
      solvedBugIds: [],
      attempts: []
    };

    this.sessions.set(key, initial);
    return initial;
  }

  save(progress: SessionProgress): void {
    this.sessions.set(this.getKey(progress.sessionId, progress.challengeId), progress);
  }

  list(): SessionProgress[] {
    return [...this.sessions.values()];
  }

  delete(sessionId: string, challengeId: string): boolean {
    return this.sessions.delete(this.getKey(sessionId, challengeId));
  }

  private getKey(sessionId: string, challengeId: string): string {
    return `${sessionId}:${challengeId}`;
  }
}
