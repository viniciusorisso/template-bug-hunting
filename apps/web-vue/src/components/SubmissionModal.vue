<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type * as Monaco from "monaco-editor";
import { ensureMonacoSetup, resolveMonacoTheme } from "@/lib/monaco";
import type { CodeRange } from "@ts-bug-hunt/core";

const props = defineProps<{
  open: boolean;
  theme?: string;
  rangeLabel: string;
  submitting: boolean;
  value: string;
  errorMessage: string;
  originalText?: string;
  filePath?: string;
  selectedRange?: CodeRange | null;
  previewOnly?: boolean;
  attemptStatus?: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  "update:value": [value: string];
}>();

const editorHostRef = ref<HTMLElement | null>(null);
const diffEditorHostRef = ref<HTMLElement | null>(null);
const editorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const modelRef = shallowRef<Monaco.editor.ITextModel | null>(null);
const diffEditorRef = shallowRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
const beforeDiffModelRef = shallowRef<Monaco.editor.ITextModel | null>(null);
const afterDiffModelRef = shallowRef<Monaco.editor.ITextModel | null>(null);

const monacoRef = shallowRef<typeof Monaco | null>(null);
const isFocused = ref(false);
const suppressModelSync = ref(false);
let previousBodyOverflow = "";

const reviewing = ref(props.previewOnly ?? false);

watch(() => props.open, (open) => { if (open) reviewing.value = props.previewOnly ?? false; });

watch(reviewing, async (isReviewing) => {
  disposeEditor();

  if (!isReviewing) {
    await nextTick();
    initializeEditor();
    editorRef.value?.focus();
    return;
  }

  await nextTick();
  initializeDiffEditors();
});
const hasChanges = computed(() => props.originalText !== undefined && props.value !== props.originalText);
const diffLines = computed(() => {
  if (props.originalText === undefined) return [];
  const before = props.originalText.split("\n");
  const after = props.value.split("\n");
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({ number: index + 1, before: before[index] ?? "", after: after[index] ?? "", changed: before[index] !== after[index] }));
});

const showPlaceholder = computed(() => props.value.trim().length === 0 && !isFocused.value);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      disposeEditor();
      unlockBodyScroll();
      return;
    }

    lockBodyScroll();
    await nextTick();

    if (props.previewOnly) {
      initializeDiffEditors();
      return;
    }

    initializeEditor();
    await nextTick();
    editorRef.value?.focus();
  },
  { immediate: true }
);

watch(
  () => props.value,
  (value) => {
    const model = modelRef.value;

    if (!model || suppressModelSync.value || model.getValue() === value) {
      return;
    }

    model.setValue(value);
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

onBeforeUnmount(() => {
  disposeEditor();
  unlockBodyScroll();
});

function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll(): void {
  if (typeof document === "undefined") return;
  document.body.style.overflow = previousBodyOverflow;
}

function initializeEditor(): void {
  if (!editorHostRef.value || editorRef.value) {
    return;
  }

  const monaco = ensureMonacoSetup();
  monacoRef.value = monaco;
  monaco.editor.setTheme(resolveMonacoTheme(props.theme));

  const model = monaco.editor.createModel(
    props.value,
    "typescript",
    monaco.Uri.parse(`inmemory://ts-bug-hunt/submission-${crypto.randomUUID()}.ts`)
  );
  modelRef.value = model;

  const editor = monaco.editor.create(editorHostRef.value, {
    model,
    automaticLayout: true,
    contextmenu: true,
    fontFamily: "Operator Mono, Dank Mono, Cascadia Code, Fira Code, monospace",
    fontLigatures: true,
    fontSize: 14,
    lineHeight: 24,
    lineNumbers: "off",
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: "none",
    scrollBeyondLastLine: false,
    trimAutoWhitespace: false,
    autoIndent: "full",
    insertSpaces: true,
    tabSize: 2,
    detectIndentation: false,
    formatOnType: false,
    formatOnPaste: false,
    wordWrap: "on",
    wrappingIndent: "indent",
    folding: false,
    guides: {
      indentation: false,
      bracketPairs: false,
      highlightActiveIndentation: false
    },
    padding: {
      top: 12,
      bottom: 12
    }
  });

  editorRef.value = editor;

  if (props.selectedRange) {
    const range = props.selectedRange;
    editor.setSelection(new monaco.Selection(range.startLine, range.startColumn, range.endLine, range.endColumn));
    editor.revealLineInCenter(range.startLine);
  }

  editor.onDidChangeModelContent(() => {
    const nextValue = model.getValue();

    if (nextValue === props.value) {
      return;
    }

    suppressModelSync.value = true;
    emit("update:value", nextValue);
    queueMicrotask(() => {
      suppressModelSync.value = false;
    });
  });

  editor.onDidFocusEditorText(() => {
    isFocused.value = true;
  });

  editor.onDidBlurEditorText(() => {
    isFocused.value = false;
  });

  editor.addCommand(monaco.KeyCode.Space, () => {
    editor.trigger("submission", "type", { text: " " });
  });

  editor.addCommand(monaco.KeyCode.Enter, () => {
    editor.trigger("submission", "type", { text: "\n" });
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    handleSubmit();
  });
}

function disposeEditor(): void {
  editorRef.value?.dispose();
  editorRef.value = null;
  modelRef.value?.dispose();
  modelRef.value = null;
  disposeDiffEditors();
  isFocused.value = false;
}

function initializeDiffEditors(): void {
  if (!diffEditorHostRef.value || diffEditorRef.value || props.originalText === undefined) return;
  const monaco = monacoRef.value ?? ensureMonacoSetup();
  monacoRef.value = monaco;
  const originalModel = monaco.editor.createModel(props.originalText, "typescript", monaco.Uri.parse(`inmemory://ts-bug-hunt/diff-original-${crypto.randomUUID()}.ts`));
  const modifiedModel = monaco.editor.createModel(props.value, "typescript", monaco.Uri.parse(`inmemory://ts-bug-hunt/diff-modified-${crypto.randomUUID()}.ts`));
  beforeDiffModelRef.value = originalModel;
  afterDiffModelRef.value = modifiedModel;
  const diffEditor = monaco.editor.createDiffEditor(diffEditorHostRef.value, {
    automaticLayout: true,
    contextmenu: false,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    enableSplitViewResizing: true,
    renderIndicators: true,
    renderMarginRevertIcon: false,
    diffWordWrap: "off",
    fontFamily: "Operator Mono, Dank Mono, Cascadia Code, Fira Code, monospace",
    fontLigatures: true,
    fontSize: 13,
    lineHeight: 21,
    lineNumbers: "on",
    minimap: { enabled: false },
    folding: false,
    renderLineHighlight: "none",
    renderWhitespace: "all",
    scrollBeyondLastLine: false,
    scrollbar: { vertical: "visible", horizontal: "auto", alwaysConsumeMouseWheel: true },
    originalAriaLabel: "Codigo antes da alteracao",
    modifiedAriaLabel: "Codigo depois da alteracao",
    padding: { top: 8, bottom: 8 }
  });
  diffEditorRef.value = diffEditor;
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });

  if (props.selectedRange) {
    diffEditor.getOriginalEditor().revealLineInCenter(props.selectedRange.startLine);
    diffEditor.getModifiedEditor().revealLineInCenter(props.selectedRange.startLine);
  }

  monaco.editor.setTheme(resolveMonacoTheme(props.theme));
}

function disposeDiffEditors(): void {
  diffEditorRef.value?.setModel(null);
  diffEditorRef.value?.dispose();
  diffEditorRef.value = null;
  beforeDiffModelRef.value?.dispose();
  afterDiffModelRef.value?.dispose();
  beforeDiffModelRef.value = null;
  afterDiffModelRef.value = null;
}

function handleSubmit(): void {
  if (props.originalText !== undefined && !reviewing.value) {
    if (!hasChanges.value) return;
    reviewing.value = true;
    return;
  }
  if (!props.value.trim() || props.submitting) return;
  emit("submit");
}

function backToEdit(): void { reviewing.value = false; }
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="submission-modal-title">
        <header class="modal-header">
          <div>
            <p class="eyebrow">Submissao</p>
            <h2 id="submission-modal-title">{{ previewOnly ? 'Visualizar tentativa' : (reviewing ? 'Revisar alteracoes' : 'Editar correcao') }}</h2>
          </div>
          <button class="icon-button" type="button" @click="emit('close')">Fechar</button>
        </header>

        <div class="modal-body">
          <section class="range-chip">
            <span class="metric-label">Trecho selecionado</span>
            <strong>{{ rangeLabel }}</strong>
          </section>

          <p v-if="errorMessage" class="inline-message inline-message-error" role="alert">
            {{ errorMessage }}
          </p>

          <p v-if="previewOnly" class="muted-text">Resultado: {{ attemptStatus ?? "tentativa" }} · somente visualizacao</p>
          <p v-if="originalText !== undefined" class="muted-text">Arquivo: {{ filePath ?? 'challenge.ts' }} · {{ hasChanges ? 'alteracoes prontas para revisao' : 'sem alteracoes' }}</p>
          <section v-if="reviewing" class="diff-review" aria-label="Revisao das alteracoes">
            <p class="metric-label">Diff local · {{ diffLines.filter((line) => line.changed).length }} linhas alteradas</p>
            <div class="diff-columns">
              <header class="diff-pane-header"><span class="diff-removed-mark">−</span> Antes <span class="diff-added-mark diff-header-after">+</span> Depois</header>
              <div ref="diffEditorHostRef" class="diff-monaco-diff-editor" aria-label="Comparacao antes e depois" />
            </div>
          </section>
          <label v-else class="textarea-field">
            <span>{{ originalText !== undefined ? 'Arquivo completo' : 'Correcao proposta' }}</span>
            <div class="highlight-input monaco-submission-shell" :data-editor-theme="theme ?? 'operator-mono-dark-modern'">
              <span v-if="showPlaceholder" class="monaco-placeholder">{{ originalText !== undefined ? 'Edite o arquivo para propor a correcao' : 'Explique a causa do bug e a correcao esperada' }}</span>
              <div ref="editorHostRef" class="monaco-submission-editor" />
            </div>
          </label>
        </div>

        <footer class="modal-actions">
          <button class="secondary-button" type="button" @click="emit('close')">{{ previewOnly ? "Fechar" : "Cancelar" }}</button>
          <template v-if="!previewOnly">
            <button v-if="reviewing" class="secondary-button" type="button" @click="backToEdit">Voltar para edicao</button>
            <button :disabled="submitting || !value.trim() || (originalText !== undefined && !hasChanges)" type="button" @click="handleSubmit">
              {{ submitting ? "Enviando..." : (originalText !== undefined && !reviewing ? "Revisar alteracoes" : "Enviar correcao") }}
            </button>
          </template>
        </footer>
      </div>
    </div>
  </teleport>
</template>
