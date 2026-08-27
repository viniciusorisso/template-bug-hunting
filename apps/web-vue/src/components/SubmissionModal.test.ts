import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubmissionModal from "./SubmissionModal.vue";
import { getLastMockEditor, getMockEditors } from "../test/monacoMock";

describe("SubmissionModal", () => {
  it("emits update:value when the Monaco model changes", async () => {
    const wrapper = mount(SubmissionModal, {
      props: {
        open: true,
        rangeLabel: "L1:C1 ate L1:C5",
        submitting: false,
        value: "",
        errorMessage: ""
      },
      attachTo: document.body
    });

    await flushPromises();
    getLastMockEditor().triggerContent("Nova  correcao\n  com indentacao");

    expect(wrapper.emitted("update:value")?.[0]).toEqual(["Nova  correcao\n  com indentacao"]);

    getLastMockEditor().triggerContent("  correcao com espacos  ");
    expect(wrapper.emitted("update:value")?.at(-1)).toEqual(["  correcao com espacos  "]);
  });

  it("inserts whitespace and a line break with Space and Enter", async () => {
    const wrapper = mount(SubmissionModal, {
      props: {
        open: true,
        rangeLabel: "L1:C1 ate L1:C5",
        submitting: false,
        value: "codigo",
        errorMessage: ""
      },
      attachTo: document.body
    });

    await flushPromises();
    const editor = getLastMockEditor();
    editor.triggerCommand(10);
    editor.triggerCommand(3);

    expect(wrapper.emitted("update:value")?.at(-1)).toEqual(["codigo \n"]);
  });

  it("emits submit on Ctrl+Enter when there is content", async () => {
    const wrapper = mount(SubmissionModal, {
      props: {
        open: true,
        rangeLabel: "L1:C1 ate L1:C5",
        submitting: false,
        value: "Corrigir loop",
        errorMessage: ""
      },
      attachTo: document.body
    });

    await flushPromises();
    getLastMockEditor().triggerCommand(2051);

    expect(wrapper.emitted("submit")?.length).toBe(1);
  });

  it("recreates the editable Monaco instance after returning from review", async () => {
    const wrapper = mount(SubmissionModal, {
      props: {
        open: true,
        rangeLabel: "L1:C1 ate L1:C5",
        submitting: false,
        value: "const total = 2;",
        originalText: "const total = 1;",
        errorMessage: ""
      },
      attachTo: document.body
    });

    await flushPromises();
    const modal = [...document.body.querySelectorAll<HTMLElement>(".modal-card")].at(-1);
    expect(modal).toBeDefined();

    const reviewButton = [...modal!.querySelectorAll("button")].find((button) => button.textContent === "Revisar alteracoes");
    expect(reviewButton).toBeDefined();
    reviewButton?.click();
    await flushPromises();

    const backButton = [...modal!.querySelectorAll("button")].find((button) => button.textContent === "Voltar para edicao");
    expect(backButton).toBeDefined();
    backButton?.click();
    await flushPromises();

    expect(getMockEditors()).toHaveLength(2);
    expect(modal!.querySelector(".monaco-submission-editor")).not.toBeNull();
  });

  it("opens a read-only diff when previewing an attempt", async () => {
    mount(SubmissionModal, {
      props: {
        open: true,
        previewOnly: true,
        attemptStatus: "incorrect",
        rangeLabel: "L1:C1 ate L1:C5",
        submitting: false,
        value: "const total = 2;",
        originalText: "const total = 1;",
        errorMessage: ""
      },
      attachTo: document.body
    });

    await flushPromises();
    const modal = [...document.body.querySelectorAll<HTMLElement>(".modal-card")].at(-1);

    expect(modal?.textContent).toContain("Visualizar tentativa");
    expect(modal?.textContent).toContain("somente visualizacao");
    expect(modal?.querySelector(".diff-monaco-diff-editor")).not.toBeNull();
    expect([...modal!.querySelectorAll(".modal-actions button")].map((button) => button.textContent)).toEqual(["Fechar"]);
  });
});
