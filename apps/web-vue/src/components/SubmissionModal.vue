<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type * as Monaco from "monaco-editor";
import { ensureMonacoSetup, resolveMonacoTheme } from "@/lib/monaco";

const props = defineProps<{
  open: boolean;
  theme?: string;
  rangeLabel: string;
  submitting: boolean;
  value: string;
  errorMessage: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  "update:value": [value: string];
}>();

const editorHostRef = ref<HTMLElement | null>(null);
const editorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const modelRef = shallowRef<Monaco.editor.ITextModel | null>(null);
const monacoRef = shallowRef<typeof Monaco | null>(null);
const isFocused = ref(false);
const suppressModelSync = ref(false);

const showPlaceholder = computed(() => props.value.trim().length === 0 && !isFocused.value);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      disposeEditor();
      return;
    }

    await nextTick();
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
});

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

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    handleSubmit();
  });
}

function disposeEditor(): void {
  editorRef.value?.dispose();
  editorRef.value = null;
  modelRef.value?.dispose();
  modelRef.value = null;
  isFocused.value = false;
}

function handleSubmit(): void {
  if (!props.value.trim() || props.submitting) {
    return;
  }

  emit("submit");
}
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="submission-modal-title">
        <header class="modal-header">
          <div>
            <p class="eyebrow">Submissao</p>
            <h2 id="submission-modal-title">Reportar correcao</h2>
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

          <label class="textarea-field">
            <span>Correcao proposta</span>
            <div class="highlight-input monaco-submission-shell" :data-editor-theme="theme ?? 'operator-mono-dark-modern'">
              <span v-if="showPlaceholder" class="monaco-placeholder">Explique a causa do bug e a correcao esperada</span>
              <div ref="editorHostRef" class="monaco-submission-editor" />
            </div>
          </label>
        </div>

        <footer class="modal-actions">
          <button class="secondary-button" type="button" @click="emit('close')">Cancelar</button>
          <button :disabled="submitting || !value.trim()" type="button" @click="handleSubmit">
            {{ submitting ? "Enviando..." : "Enviar resposta" }}
          </button>
        </footer>
      </div>
    </div>
  </teleport>
</template>
