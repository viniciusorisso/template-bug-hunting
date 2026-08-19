import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubmissionModal from "./SubmissionModal.vue";
import { getLastMockEditor } from "../test/monacoMock";

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
    getLastMockEditor().triggerContent("Nova correcao");

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

    await flushPromises();
    getLastMockEditor().triggerCommand(2051);

    expect(wrapper.emitted("submit")?.length).toBe(1);
  });
});
