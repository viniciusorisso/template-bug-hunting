import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CodeViewer from "./CodeViewer.vue";

describe("CodeViewer", () => {
  it("emits a multi-line selection from keyboard navigation", async () => {
    const wrapper = mount(CodeViewer, {
      props: {
        source: "first\nsecond\nthird",
        selectedRange: null
      },
      attachTo: document.body
    });

    const viewer = wrapper.get(".code-viewer");
    await viewer.trigger("keydown", { key: "ArrowDown" });
    await viewer.trigger("keydown", { key: "ArrowDown", shiftKey: true });

    const events = wrapper.emitted("range-selected");

    expect(events).toBeTruthy();
    expect(events?.[0]?.[0]).toEqual({
      range: {
        startLine: 2,
        startColumn: 1,
        endLine: 3,
        endColumn: 6
      },
      text: "second\nthird"
    });
  });

  it("selects the focused line when Enter is pressed", async () => {
    const wrapper = mount(CodeViewer, {
      props: {
        source: "alpha\nbeta",
        selectedRange: null
      }
    });

    const viewer = wrapper.get(".code-viewer");
    await viewer.trigger("keydown", { key: "ArrowDown" });
    await viewer.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("range-selected")?.[0]?.[0]).toEqual({
      range: {
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 5
      },
      text: "beta"
    });
  });

  it("highlights resolved lines and exposes before/after tooltip", () => {
    const wrapper = mount(CodeViewer, {
      props: {
        source: "alpha\nbetaFixed",
        selectedRange: null,
        resolvedBugDiffs: {
          B002: {
            bugId: "B002",
            originalRange: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 5 },
            appliedRange: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 10 },
            beforeText: "beta",
            afterText: "betaFixed",
            resolvedLineIds: ["2"]
          }
        }
      }
    });

    const resolvedLine = wrapper.findAll(".code-line")[1];

    expect(resolvedLine.classes()).toContain("code-line-resolved");
    expect(resolvedLine.attributes("data-resolved-bugs")).toBe("B002");
    expect(resolvedLine.attributes("title")).toContain("Antes: beta");
    expect(resolvedLine.attributes("title")).toContain("Depois: betaFixed");
  });
});
