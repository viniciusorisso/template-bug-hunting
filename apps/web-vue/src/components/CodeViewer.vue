<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { CodeRange, ResolvedBugDiff } from "@ts-bug-hunt/core";
import { getTokenClass, tokenizeTsLine } from "../lib/tokenizeTs";

type SelectionPayload = {
  range: CodeRange;
  text: string;
};

const props = defineProps<{
  source: string;
  selectedRange: CodeRange | null;
  resolvedBugDiffs?: Record<string, ResolvedBugDiff>;
  highlightedBugId?: string | null;
}>();

const emit = defineEmits<{
  "clear-selection": [];
  "range-selected": [payload: SelectionPayload];
}>();

const lines = computed(() => props.source.split("\n"));
const focusedLine = ref(props.selectedRange?.startLine ?? 1);
const keyboardAnchorLine = ref<number | null>(null);
const viewerRef = ref<HTMLElement | null>(null);
const hoveredLineNumber = ref<number | null>(null);
const activePopoverDiffIndex = ref(0);
const lineDiffMap = computed(() => {
  const map = new Map<number, ResolvedBugDiff[]>();

  for (const diff of Object.values(props.resolvedBugDiffs ?? {})) {
    for (const lineId of diff.resolvedLineIds) {
      const line = Number(lineId);

      if (!Number.isInteger(line) || line <= 0) {
        continue;
      }

      const current = map.get(line) ?? [];
      map.set(line, [...current, diff]);
    }
  }

  return map;
});

watch(
  () => props.selectedRange,
  (range) => {
    focusedLine.value = range?.startLine ?? 1;

    if (!range) {
      keyboardAnchorLine.value = null;
    }
  },
  { immediate: true }
);

watch(
  () => props.highlightedBugId,
  async (bugId) => {
    if (!bugId) {
      return;
    }

    const diff = props.resolvedBugDiffs?.[bugId];

    if (!diff) {
      return;
    }

    focusedLine.value = diff.appliedRange.startLine;
    await nextTick();
    viewerRef.value?.focus();
    viewerRef.value
      ?.querySelector<HTMLElement>(`[data-line="${diff.appliedRange.startLine}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
);

function handleMouseUp(): void {
  const selection = window.getSelection();
  const selectedText = selection?.toString() ?? "";

  if (!selection || selection.rangeCount === 0 || selectedText.trim().length === 0) {
    emit("clear-selection");
    return;
  }

  const range = selection.getRangeAt(0);
  const startLineElement = getLineElement(range.startContainer);
  const endLineElement = getLineElement(range.endContainer);

  if (!startLineElement || !endLineElement) {
    emit("clear-selection");
    return;
  }

  const selectionRange: CodeRange = normalizeRange({
    startLine: Number(startLineElement.dataset.line),
    startColumn: getColumn(range.startContainer, range.startOffset, startLineElement),
    endLine: Number(endLineElement.dataset.line),
    endColumn: getColumn(range.endContainer, range.endOffset, endLineElement)
  });

  focusedLine.value = selectionRange.endLine;
  keyboardAnchorLine.value = null;
  emitSelection(selectionRange, selectedText);
}

function handleKeyboardSelection(event: KeyboardEvent): void {
  const maxLine = lines.value.length;

  if (maxLine === 0) {
    return;
  }

  if (event.key === "Escape") {
    keyboardAnchorLine.value = null;
    hoveredLineNumber.value = null;
    activePopoverDiffIndex.value = 0;
    emit("clear-selection");
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    keyboardAnchorLine.value = focusedLine.value;
    emitSelection(buildLineRange(focusedLine.value, focusedLine.value), getSelectedText(focusedLine.value, focusedLine.value));
    return;
  }

  const movement = getNextLine(event, maxLine);

  if (movement === null) {
    return;
  }

  event.preventDefault();
  const previousLine = focusedLine.value;
  focusedLine.value = movement;

  if (getResolvedDiffsForLine(focusedLine.value).length > 0) {
    hoveredLineNumber.value = focusedLine.value;
    activePopoverDiffIndex.value = 0;
  } else {
    hoveredLineNumber.value = null;
    activePopoverDiffIndex.value = 0;
  }

  if (event.shiftKey) {
    keyboardAnchorLine.value ??= previousLine;
    emitSelection(
      buildLineRange(keyboardAnchorLine.value, focusedLine.value),
      getSelectedText(keyboardAnchorLine.value, focusedLine.value)
    );
    return;
  }

  keyboardAnchorLine.value = null;
}

function getNextLine(event: KeyboardEvent, maxLine: number): number | null {
  switch (event.key) {
    case "ArrowDown":
      return Math.min(focusedLine.value + 1, maxLine);
    case "ArrowUp":
      return Math.max(focusedLine.value - 1, 1);
    case "Home":
      return 1;
    case "End":
      return maxLine;
    default:
      return null;
  }
}

function buildLineRange(startLine: number, endLine: number): CodeRange {
  const normalizedStart = Math.min(startLine, endLine);
  const normalizedEnd = Math.max(startLine, endLine);

  return {
    startLine: normalizedStart,
    startColumn: 1,
    endLine: normalizedEnd,
    endColumn: getLineEndColumn(normalizedEnd)
  };
}

function getSelectedText(startLine: number, endLine: number): string {
  const normalizedStart = Math.min(startLine, endLine);
  const normalizedEnd = Math.max(startLine, endLine);
  return lines.value.slice(normalizedStart - 1, normalizedEnd).join("\n");
}

function getLineEndColumn(lineNumber: number): number {
  return (lines.value[lineNumber - 1]?.length ?? 0) + 1;
}

function emitSelection(range: CodeRange, text: string): void {
  emit("range-selected", {
    range,
    text
  });
}

function getLineElement(node: Node): HTMLElement | null {
  let current: Node | null = node;

  while (current) {
    if (current instanceof HTMLElement && current.dataset.line) {
      return current;
    }

    current = current.parentNode;
  }

  return null;
}

function getColumn(node: Node, offset: number, lineElement: HTMLElement): number {
  const content = lineElement.querySelector("[data-code-content]");

  if (!content) {
    return 1;
  }

  let column = 1;

  if (node === content) {
    return offset + 1;
  }

  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (currentNode === node) {
      return column + offset;
    }

    column += currentNode.textContent?.length ?? 0;
    currentNode = walker.nextNode();
  }

  return column;
}

function normalizeRange(range: CodeRange): CodeRange {
  const startsAfterEnd =
    range.startLine > range.endLine ||
    (range.startLine === range.endLine && range.startColumn > range.endColumn);

  if (!startsAfterEnd) {
    return range;
  }

  return {
    startLine: range.endLine,
    startColumn: range.endColumn,
    endLine: range.startLine,
    endColumn: range.startColumn
  };
}

function isLineSelected(lineNumber: number): boolean {
  if (!props.selectedRange) {
    return false;
  }

  return lineNumber >= props.selectedRange.startLine && lineNumber <= props.selectedRange.endLine;
}

function getResolvedDiffsForLine(lineNumber: number): ResolvedBugDiff[] {
  return lineDiffMap.value.get(lineNumber) ?? [];
}

function isLineHighlighted(lineNumber: number): boolean {
  if (!props.highlightedBugId) {
    return false;
  }

  return getResolvedDiffsForLine(lineNumber).some((diff) => diff.bugId === props.highlightedBugId);
}

function isPopoverVisible(lineNumber: number): boolean {
  return hoveredLineNumber.value === lineNumber && getResolvedDiffsForLine(lineNumber).length > 0;
}

function setHoveredBug(lineNumber: number): void {
  if (getResolvedDiffsForLine(lineNumber).length === 0) {
    hoveredLineNumber.value = null;
    activePopoverDiffIndex.value = 0;
    return;
  }

  hoveredLineNumber.value = lineNumber;
  activePopoverDiffIndex.value = 0;
}

function clearHoveredBug(lineNumber: number): void {
  if (hoveredLineNumber.value === lineNumber) {
    hoveredLineNumber.value = null;
    activePopoverDiffIndex.value = 0;
  }
}

function getActiveResolvedDiff(lineNumber: number): ResolvedBugDiff | null {
  const diffs = getResolvedDiffsForLine(lineNumber);

  if (diffs.length === 0) {
    return null;
  }

  return diffs[activePopoverDiffIndex.value] ?? diffs[0] ?? null;
}

function showPreviousResolvedDiff(lineNumber: number): void {
  const diffs = getResolvedDiffsForLine(lineNumber);

  if (diffs.length <= 1) {
    return;
  }

  activePopoverDiffIndex.value = (activePopoverDiffIndex.value - 1 + diffs.length) % diffs.length;
}

function showNextResolvedDiff(lineNumber: number): void {
  const diffs = getResolvedDiffsForLine(lineNumber);

  if (diffs.length <= 1) {
    return;
  }

  activePopoverDiffIndex.value = (activePopoverDiffIndex.value + 1) % diffs.length;
}
</script>

<template>
  <div
    ref="viewerRef"
    class="code-viewer"
    tabindex="0"
    role="region"
    aria-label="Editor somente leitura do desafio"
    aria-describedby="code-viewer-help"
    @keydown="handleKeyboardSelection"
    @mouseup="handleMouseUp"
  >
    <p id="code-viewer-help" class="sr-only">
      Use as setas para navegar entre as linhas. Use Shift com as setas para selecionar varias linhas.
      Pressione Enter ou espaco para selecionar a linha atual.
    </p>

    <div
      v-for="(line, index) in lines"
      :key="index"
      :class="[
        'code-line',
        {
          'code-line-selected': isLineSelected(index + 1),
          'code-line-focused': focusedLine === index + 1,
          'code-line-resolved': getResolvedDiffsForLine(index + 1).length > 0,
          'code-line-highlighted': isLineHighlighted(index + 1)
        }
      ]"
      :data-line="index + 1"
      :data-resolved-bugs="getResolvedDiffsForLine(index + 1).map((diff) => diff.bugId).join(',')"
      @mouseenter="setHoveredBug(index + 1)"
      @mouseleave="clearHoveredBug(index + 1)"
      @focusin="setHoveredBug(index + 1)"
      @focusout="clearHoveredBug(index + 1)"
    >
      <span :class="['line-number', { 'line-number-resolved': getResolvedDiffsForLine(index + 1).length > 0 }]">
        {{ index + 1 }}
      </span>
      <code data-code-content class="code-content">
        <span
          v-for="(token, tokenIndex) in tokenizeTsLine(line)"
          :key="`${index}-${tokenIndex}`"
          :class="getTokenClass(token.kind)"
        >
          {{ token.value }}
        </span>
      </code>
      <div
        v-if="isPopoverVisible(index + 1) && getActiveResolvedDiff(index + 1)"
        class="resolved-popover"
        role="note"
        aria-live="polite"
      >
        <div class="resolved-popover-header">
          <strong>{{ getActiveResolvedDiff(index + 1)?.bugId }}</strong>
          <span class="metric-label">Trecho resolvido</span>
        </div>
        <div v-if="getResolvedDiffsForLine(index + 1).length > 1" class="resolved-popover-nav">
          <button type="button" class="popover-nav-button" @click="showPreviousResolvedDiff(index + 1)">Anterior</button>
          <span class="metric-label">
            {{ activePopoverDiffIndex + 1 }}/{{ getResolvedDiffsForLine(index + 1).length }}
          </span>
          <button type="button" class="popover-nav-button" @click="showNextResolvedDiff(index + 1)">Proximo</button>
        </div>
        <div class="resolved-popover-grid">
          <div>
            <span class="metric-label">Antes</span>
            <pre class="resolved-popover-code"><code>{{ getActiveResolvedDiff(index + 1)?.beforeText }}</code></pre>
          </div>
          <div>
            <span class="metric-label">Depois</span>
            <pre class="resolved-popover-code"><code>{{ getActiveResolvedDiff(index + 1)?.afterText }}</code></pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
