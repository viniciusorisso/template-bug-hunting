import type { ResolvedBugEvent } from "../types.js";

export interface ResolvedBugNotifier {
  notify(event: ResolvedBugEvent): void | Promise<void>;
}

export class NoopResolvedBugNotifier implements ResolvedBugNotifier {
  notify(): void {
    return;
  }
}

