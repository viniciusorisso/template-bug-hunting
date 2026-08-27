import type { EditorChangeOperation, ServerDiff } from "./types.js";

export function hashSource(source: string): string {
  let hash = 2166136261;
  for (const char of source) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function calculateServerDiff(original: string, edited: string): ServerDiff {
  const before = original.split("\n");
  const after = edited.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  if (prefix === before.length && prefix === after.length) return { operations: [], addedLines: 0, removedLines: 0 };
  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  const operation: EditorChangeOperation = { type: removed.length && added.length ? "replace" : added.length ? "insert" : "delete", originalStartLine: prefix + 1, originalEndLine: Math.max(prefix + removed.length, prefix + 1), replacementText: added.join("\n") };
  return { operations: [operation], addedLines: added.length, removedLines: removed.length };
}
