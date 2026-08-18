import type { ChallengeDefinition, CodeRange, ResolvedBugDiff } from "../types.js";

export type ResolvedSourceProjection = {
  displayedSource: string;
  resolvedBugDiffs: Record<string, ResolvedBugDiff>;
};

export function projectResolvedSource(
  challenge: ChallengeDefinition,
  resolvedBugOrder: string[]
): ResolvedSourceProjection {
  let displayedSource = challenge.source;
  const resolvedBugDiffs: Record<string, ResolvedBugDiff> = {};
  let offsetDelta = 0;

  for (const bugId of resolvedBugOrder) {
    const bug = challenge.bugs.find((candidate) => candidate.id === bugId);

    if (!bug) {
      continue;
    }

    const originalStartOffset = getOffsetFromRange(challenge.source, bug.patch.range, "start");
    const originalEndOffset = getOffsetFromRange(challenge.source, bug.patch.range, "end");
    const appliedStartOffset = originalStartOffset + offsetDelta;
    const appliedEndOffset = originalEndOffset + offsetDelta;
    const beforeText = displayedSource.slice(appliedStartOffset, appliedEndOffset);
    const afterText = bug.patch.replacement;

    displayedSource =
      displayedSource.slice(0, appliedStartOffset) + afterText + displayedSource.slice(appliedEndOffset);

    const appliedRange = getRangeFromOffsets(displayedSource, appliedStartOffset, appliedStartOffset + afterText.length);
    const resolvedLineIds = [] as string[];

    for (let line = appliedRange.startLine; line <= appliedRange.endLine; line += 1) {
      resolvedLineIds.push(String(line));
    }

    resolvedBugDiffs[bug.id] = {
      bugId: bug.id,
      originalRange: bug.patch.range,
      appliedRange,
      beforeText,
      afterText,
      resolvedLineIds
    };

    offsetDelta += afterText.length - (originalEndOffset - originalStartOffset);
  }

  return {
    displayedSource,
    resolvedBugDiffs
  };
}

function getOffsetFromRange(source: string, range: CodeRange, edge: "start" | "end"): number {
  const line = edge === "start" ? range.startLine : range.endLine;
  const column = edge === "start" ? range.startColumn : range.endColumn;
  const lines = source.split("\n");
  let offset = 0;

  for (let index = 0; index < line - 1; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + column - 1;
}

function getRangeFromOffsets(source: string, startOffset: number, endOffset: number): CodeRange {
  const start = getLineColumnFromOffset(source, startOffset);
  const end = getLineColumnFromOffset(source, Math.max(startOffset, endOffset));

  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column
  };
}

function getLineColumnFromOffset(source: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let column = 1;

  for (let index = 0; index < safeOffset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { line, column };
}
