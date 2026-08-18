import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
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

    const resolvedLine = wrapper.findAll(".code-line")[1];
    await resolvedLine.trigger("mouseenter");

    expect(resolvedLine.classes()).toContain("code-line-resolved");
    expect(resolvedLine.attributes("data-resolved-bugs")).toBe("B002");
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

    const resolvedLine = wrapper.findAll(".code-line")[1];
    await resolvedLine.trigger("mouseenter");

    expect(wrapper.find(".resolved-popover").text()).toContain("B002");
    expect(wrapper.find(".resolved-popover").text()).toContain("1/2");
    expect(wrapper.find(".resolved-popover").text()).toContain("betaFix");

    await wrapper.get(".popover-nav-button:last-of-type").trigger("click");

    expect(wrapper.find(".resolved-popover").text()).toContain("B003");
    expect(wrapper.find(".resolved-popover").text()).toContain("2/2");
    expect(wrapper.find(".resolved-popover").text()).toContain("betaFinal");
  });

  it("applies a temporary highlight when a resolved bug is targeted", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });

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

    await wrapper.setProps({ highlightedBugId: "B002" });

    const resolvedLine = wrapper.findAll(".code-line")[1];

    expect(resolvedLine.classes()).toContain("code-line-highlighted");
  });
});
