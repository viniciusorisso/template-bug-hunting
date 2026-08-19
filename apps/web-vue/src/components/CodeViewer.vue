<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type * as Monaco from "monaco-editor";
import { normalizeRange, type CodeRange, type ResolvedBugDiff } from "@ts-bug-hunt/core";
import { ensureMonacoSetup, resolveMonacoTheme } from "@/lib/monaco";

type SelectionPayload = {
  range: CodeRange;
  text: string;
};

type ActivePopoverState = {
  lineNumber: number;
  diff: ResolvedBugDiff;
  style: {
    top: string;
    left: string;
  };
};

const props = defineProps<{
  source: string;
  theme?: string;
  selectedRange: CodeRange | null;
  resolvedBugDiffs?: Record<string, ResolvedBugDiff>;
  highlightedBugId?: string | null;
}>();

const emit = defineEmits<{
  "clear-selection": [];
  "range-selected": [payload: SelectionPayload];
}>();

const viewerRef = ref<HTMLElement | null>(null);
const editorHostRef = ref<HTMLElement | null>(null);
const hoveredLineNumber = ref<number | null>(null);
const activePopoverDiffIndex = ref(0);
const viewportRevision = ref(0);
const editorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const modelRef = shallowRef<Monaco.editor.ITextModel | null>(null);
const decorationsRef = shallowRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
const monacoRef = shallowRef<typeof Monaco | null>(null);
const suppressSelectionEvents = ref(false);

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

const activePopoverState = computed<ActivePopoverState | null>(() => {
  viewportRevision.value;

  const lineNumber = hoveredLineNumber.value;
  const editor = editorRef.value;

  if (!lineNumber || !editor) {
    return null;
  }

  const diff = getActiveResolvedDiff(lineNumber);

  if (!diff) {
    return null;
  }

  const position = editor.getScrolledVisiblePosition({ lineNumber, column: 1 });

  if (!position) {
    return null;
  }

  return {
    lineNumber,
    diff,
    style: {
      top: `${position.top + position.height + 8}px`,
      left: "72px"
    }
  };
});

onMounted(() => {
  initializeEditor();
});

onBeforeUnmount(() => {
  disposeEditor();
});

watch(
  () => props.source,
  (source) => {
    const model = modelRef.value;

    if (!model || model.getValue() === source) {
      return;
    }

    model.setValue(source);
    viewportRevision.value += 1;
  }
);

watch(
  () => props.theme,
  (theme) => {
    const monaco = monacoRef.value;

    if (!monaco) {
      return;
    }

    monaco.editor.setTheme(resolveMonacoTheme(theme));
  },
  { immediate: true }
);

watch(
  () => props.selectedRange,
  (range) => {
    syncSelection(range);
    applyDecorations();
  },
  { immediate: true }
);

watch(
  () => props.resolvedBugDiffs,
  () => {
    applyDecorations();
  },
  { deep: true }
);

watch(
  () => props.highlightedBugId,
  async (bugId) => {
    applyDecorations();

    if (!bugId) {
      return;
    }

    const diff = props.resolvedBugDiffs?.[bugId];

    if (!diff) {
      return;
    }

    hoveredLineNumber.value = diff.appliedRange.startLine;
    activePopoverDiffIndex.value = 0;
    editorRef.value?.revealLineInCenter(diff.appliedRange.startLine);
    await nextTick();
    viewportRevision.value += 1;
  }
);

function initializeEditor(): void {
  if (!editorHostRef.value || editorRef.value) {
    return;
  }

  const monaco = ensureMonacoSetup();
  monacoRef.value = monaco;
  monaco.editor.setTheme(resolveMonacoTheme(props.theme));

  const model = monaco.editor.createModel(
    props.source,
    "typescript",
    monaco.Uri.parse(`inmemory://ts-bug-hunt/${crypto.randomUUID()}.ts`)
  );
  modelRef.value = model;

  const editor = monaco.editor.create(editorHostRef.value, {
    model,
    readOnly: true,
    automaticLayout: true,
    contextmenu: false,
    fontFamily: "Operator Mono, Dank Mono, Cascadia Code, Fira Code, monospace",
    fontLigatures: true,
    fontSize: 14,
    lineHeight: 24,
    lineNumbers: "on",
    lineDecorationsWidth: 12,
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: "all",
    renderWhitespace: "selection",
    scrollBeyondLastLine: false,
    selectionHighlight: false,
    occurrencesHighlight: "off",
    wordWrap: "off",
    folding: false,
    guides: {
      indentation: true,
      bracketPairs: false,
      highlightActiveIndentation: true
    },
    padding: {
      top: 14,
      bottom: 14
    }
  });

  editorRef.value = editor;
  decorationsRef.value = editor.createDecorationsCollection();

  editor.onDidChangeCursorSelection((event) => {
    if (suppressSelectionEvents.value) {
      return;
    }

    if (event.selection.isEmpty()) {
      emit("clear-selection");
      return;
    }

    emitSelection(event.selection);
  });

  editor.onMouseMove((event: Monaco.editor.IEditorMouseEvent) => {
    setHoveredBug(event.target.position?.lineNumber ?? null);
  });

  editor.onMouseLeave(() => {
    clearHoveredBug();
  });

  editor.onDidScrollChange(() => {
    viewportRevision.value += 1;
  });

  editor.onDidLayoutChange(() => {
    viewportRevision.value += 1;
  });

  editor.addCommand(monaco.KeyCode.Enter, () => {
    selectFocusedLine();
  });

  editor.addCommand(monaco.KeyCode.Space, () => {
    selectFocusedLine();
  });

  syncSelection(props.selectedRange);
  applyDecorations();
}

function disposeEditor(): void {
  decorationsRef.value?.clear();
  decorationsRef.value = null;
  editorRef.value?.dispose();
  editorRef.value = null;
  modelRef.value?.dispose();
  modelRef.value = null;
}

function syncSelection(range: CodeRange | null): void {
  const editor = editorRef.value;
  const monaco = monacoRef.value;

  if (!editor || !monaco) {
    return;
  }

  if (!range) {
    const position = editor.getPosition() ?? { lineNumber: 1, column: 1 };
    const selection = new monaco.Selection(position.lineNumber, position.column, position.lineNumber, position.column);

    if (editor.getSelection()?.equalsSelection(selection)) {
      return;
    }

    withSuppressedSelection(() => {
      editor.setSelection(selection);
    });
    return;
  }

  const normalizedRange = normalizeRange(range);
  const selection = new monaco.Selection(
    normalizedRange.startLine,
    normalizedRange.startColumn,
    normalizedRange.endLine,
    normalizedRange.endColumn
  );

  const currentSelection = editor.getSelection();

  if (
    currentSelection &&
    rangesEqual(normalizeRange(selectionToRange(currentSelection)), normalizedRange)
  ) {
    return;
  }

  withSuppressedSelection(() => {
    editor.setSelection(selection);
    editor.revealRangeInCenter(selection);
  });
}

function withSuppressedSelection(callback: () => void): void {
  suppressSelectionEvents.value = true;
  callback();
  queueMicrotask(() => {
    suppressSelectionEvents.value = false;
  });
}

function emitSelection(selection: Monaco.Selection): void {
  const model = modelRef.value;

  if (!model) {
    return;
  }

  const range = normalizeRange({
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn
  });

  emit("range-selected", {
    range,
    text: model.getValueInRange({
      startLineNumber: range.startLine,
      startColumn: range.startColumn,
      endLineNumber: range.endLine,
      endColumn: range.endColumn
    })
  });
}

function selectionToRange(selection: Monaco.Selection): CodeRange {
  return {
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn
  };
}

function rangesEqual(left: CodeRange, right: CodeRange): boolean {
  return left.startLine === right.startLine
    && left.startColumn === right.startColumn
    && left.endLine === right.endLine
    && left.endColumn === right.endColumn;
}

function selectFocusedLine(): void {
  const editor = editorRef.value;
  const model = modelRef.value;
  const monaco = monacoRef.value;
  const position = editor?.getPosition();

  if (!editor || !model || !monaco || !position) {
    return;
  }

  const selection = new monaco.Selection(
    position.lineNumber,
    1,
    position.lineNumber,
    model.getLineMaxColumn(position.lineNumber)
  );

  withSuppressedSelection(() => {
    editor.setSelection(selection);
  });
  emitSelection(selection);
}

function applyDecorations(): void {
  const decorations = decorationsRef.value;
  const monaco = monacoRef.value;

  if (!decorations || !monaco) {
    return;
  }

  const nextDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

  for (const diff of Object.values(props.resolvedBugDiffs ?? {})) {
    for (const lineId of diff.resolvedLineIds) {
      const lineNumber = Number(lineId);

      if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
        continue;
      }

      nextDecorations.push({
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "monaco-line-resolved",
          linesDecorationsClassName: "monaco-line-resolved-gutter"
        }
      });
    }
  }

  if (props.highlightedBugId && props.resolvedBugDiffs?.[props.highlightedBugId]) {
    const highlightedDiff = props.resolvedBugDiffs[props.highlightedBugId];

    for (const lineId of highlightedDiff.resolvedLineIds) {
      const lineNumber = Number(lineId);

      if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
        continue;
      }

      nextDecorations.push({
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "monaco-line-highlighted",
          linesDecorationsClassName: "monaco-line-highlighted-gutter"
        }
      });
    }
  }

  decorations.set(nextDecorations);
}

function getResolvedDiffsForLine(lineNumber: number): ResolvedBugDiff[] {
  return lineDiffMap.value.get(lineNumber) ?? [];
}

function getActiveResolvedDiff(lineNumber: number): ResolvedBugDiff | null {
  const diffs = getResolvedDiffsForLine(lineNumber);

  if (diffs.length === 0) {
    return null;
  }

  return diffs[activePopoverDiffIndex.value] ?? diffs[0] ?? null;
}

function setHoveredBug(lineNumber: number | null): void {
  if (!lineNumber || getResolvedDiffsForLine(lineNumber).length === 0) {
    clearHoveredBug();
    return;
  }

  if (hoveredLineNumber.value !== lineNumber) {
    activePopoverDiffIndex.value = 0;
  }

  hoveredLineNumber.value = lineNumber;
}

function clearHoveredBug(): void {
  hoveredLineNumber.value = null;
  activePopoverDiffIndex.value = 0;
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
    :data-editor-theme="theme ?? 'operator-mono-dark-modern'"
    role="region"
    aria-label="Editor somente leitura do desafio"
    aria-describedby="code-viewer-help"
  >
    <p id="code-viewer-help" class="sr-only">
      Use selecao nativa do editor Monaco para marcar trechos do desafio e revisar bugs resolvidos.
    </p>

    <div ref="editorHostRef" class="monaco-host" />

    <div
      v-if="activePopoverState"
      class="resolved-popover"
      :style="activePopoverState.style"
      role="note"
      aria-live="polite"
    >
      <div class="resolved-popover-header">
        <strong>{{ activePopoverState.diff.bugId }}</strong>
        <span class="metric-label">Trecho resolvido</span>
      </div>
      <div v-if="getResolvedDiffsForLine(activePopoverState.lineNumber).length > 1" class="resolved-popover-nav">
        <button type="button" class="popover-nav-button" @click="showPreviousResolvedDiff(activePopoverState.lineNumber)">Anterior</button>
        <span class="metric-label">
          {{ activePopoverDiffIndex + 1 }}/{{ getResolvedDiffsForLine(activePopoverState.lineNumber).length }}
        </span>
        <button type="button" class="popover-nav-button" @click="showNextResolvedDiff(activePopoverState.lineNumber)">Proximo</button>
      </div>
      <div class="resolved-popover-grid">
        <div>
          <span class="metric-label">Antes</span>
          <pre class="resolved-popover-code"><code>{{ activePopoverState.diff.beforeText }}</code></pre>
        </div>
        <div>
          <span class="metric-label">Depois</span>
          <pre class="resolved-popover-code"><code>{{ activePopoverState.diff.afterText }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>
