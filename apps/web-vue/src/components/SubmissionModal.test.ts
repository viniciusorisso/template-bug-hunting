import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubmissionModal from "./SubmissionModal.vue";

describe("SubmissionModal", () => {
  it("emits update:value when the textarea changes", async () => {
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

    const textarea = document.body.querySelector("textarea");

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Textarea nao encontrada.");
    }

    textarea.value = "Nova correcao";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(wrapper.emitted("update:value")?.[0]).toEqual(["Nova correcao"]);
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

    const textarea = document.body.querySelector("textarea");

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Textarea nao encontrada.");
    }

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));

    expect(wrapper.emitted("submit")?.length).toBe(1);
  });
});
