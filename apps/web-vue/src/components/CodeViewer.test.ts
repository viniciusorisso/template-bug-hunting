import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import CodeViewer from "./CodeViewer.vue";
import { createMockSelection, getLastMockEditor } from "../test/monacoMock";

describe("CodeViewer", () => {
  it("emits a multi-line selection from Monaco selection changes", async () => {
    const wrapper = mount(CodeViewer, {
      props: {
        source: "first\nsecond\nthird",
        selectedRange: null
      },
      attachTo: document.body
    });

    await flushPromises();
    getLastMockEditor().triggerSelection(createMockSelection(2, 1, 3, 6));

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

    await flushPromises();
    const editor = getLastMockEditor();
    editor.setPosition({ lineNumber: 2, column: 1 });
    editor.triggerCommand(3);

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

  it("shows a resolved popover with before and after on hover", async () => {
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

    await flushPromises();
    getLastMockEditor().triggerMouseMove(2);
    await flushPromises();

    expect(wrapper.find(".resolved-popover").exists()).toBe(true);
    expect(wrapper.find(".resolved-popover").text()).toContain("Antes");
    expect(wrapper.find(".resolved-popover").text()).toContain("betaFixed");
  });

  it("navigates between multiple resolved diffs on the same line", async () => {
    const wrapper = mount(CodeViewer, {
      props: {
        source: "alpha\nbetaFinal",
        selectedRange: null,
        resolvedBugDiffs: {
          B002: {
            bugId: "B002",
            originalRange: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 5 },
            appliedRange: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 },
            beforeText: "beta",
            afterText: "betaFix",
            resolvedLineIds: ["2"]
          },
          B003: {
            bugId: "B003",
            originalRange: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 },
            appliedRange: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 10 },
            beforeText: "betaFix",
            afterText: "betaFinal",
            resolvedLineIds: ["2"]
          }
        }
      }
    });

    await flushPromises();
    getLastMockEditor().triggerMouseMove(2);
    await flushPromises();

    expect(wrapper.find(".resolved-popover").text()).toContain("B002");
    expect(wrapper.find(".resolved-popover").text()).toContain("1/2");
    expect(wrapper.find(".resolved-popover").text()).toContain("betaFix");

    await wrapper.get(".popover-nav-button:last-of-type").trigger("click");

    expect(wrapper.find(".resolved-popover").text()).toContain("B003");
    expect(wrapper.find(".resolved-popover").text()).toContain("2/2");
    expect(wrapper.find(".resolved-popover").text()).toContain("betaFinal");
  });

  it("applies a temporary highlight decoration when a resolved bug is targeted", async () => {
    const wrapper = mount(CodeViewer, {
      props: {
        source: "alpha\nbetaFixed",
        selectedRange: null,
        highlightedBugId: null,
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

    await flushPromises();
    const editor = getLastMockEditor();
    const revealSpy = vi.spyOn(editor, "revealLineInCenter");

    await wrapper.setProps({ highlightedBugId: "B002" });

    const lastDecorationBatch = editor.decorations.set.mock.calls.at(-1)?.[0] ?? [];

    expect(revealSpy).toHaveBeenCalledWith(2);
    expect(lastDecorationBatch.some((entry: { options: { className?: string } }) => entry.options.className === "monaco-line-highlighted")).toBe(true);
  });
});
