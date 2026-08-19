<script setup lang="ts">
import { computed, ref } from "vue";
import { getTokenClass, tokenizeTsLine } from "../lib/tokenizeTs";

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

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const highlightedLines = computed(() => props.value.split("\n"));

function handleSubmit(): void {
  if (!props.value.trim() || props.submitting) {
    return;
  }

  emit("submit");
}

function handleInput(event: Event): void {
  emit("update:value", (event.target as HTMLTextAreaElement).value);
}

function handleTextareaKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleSubmit();
  }
}

function syncScroll(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  const highlight = target.parentElement?.querySelector<HTMLElement>("[data-highlight-layer]");

  if (!highlight) {
    return;
  }

  highlight.scrollTop = target.scrollTop;
  highlight.scrollLeft = target.scrollLeft;
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
            <div class="highlight-input" :data-editor-theme="theme ?? 'operator-mono-dark-modern'">
              <pre aria-hidden="true" class="highlight-layer" data-highlight-layer><code class="code-content modal-code-content"><template v-for="(line, lineIndex) in highlightedLines" :key="lineIndex"><span
                    v-for="(token, tokenIndex) in tokenizeTsLine(line)"
                    :key="`${lineIndex}-${tokenIndex}`"
                    :class="getTokenClass(token.kind)"
                  >{{ token.value }}</span><span v-if="lineIndex < highlightedLines.length - 1">{{ "\n" }}</span></template></code></pre>
              <textarea
                ref="textareaRef"
                :value="value"
                autofocus
                class="highlight-textarea"
                rows="8"
                placeholder="Explique a causa do bug e a correcao esperada"
                spellcheck="false"
                @input="handleInput"
                @keydown="handleTextareaKeydown"
                @scroll="syncScroll"
              />
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
