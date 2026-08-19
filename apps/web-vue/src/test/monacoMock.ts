import { vi } from "vitest";

type Listener<T> = (event: T) => void;

type MockSelectionLike = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  isEmpty(): boolean;
  equalsSelection(other: MockSelectionLike): boolean;
};

class MockRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;

  constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
    this.startLineNumber = startLineNumber;
    this.startColumn = startColumn;
    this.endLineNumber = endLineNumber;
    this.endColumn = endColumn;
  }
}

class MockSelection extends MockRange {
  isEmpty(): boolean {
    return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn;
  }

  equalsSelection(other: MockSelectionLike): boolean {
    return this.startLineNumber === other.startLineNumber
      && this.startColumn === other.startColumn
      && this.endLineNumber === other.endLineNumber
      && this.endColumn === other.endColumn;
  }
}

class MockModel {
  private value: string;
  private listeners = new Set<(value: string) => void>();

  constructor(initialValue: string) {
    this.value = initialValue;
  }

  getValue(): string {
    return this.value;
  }

  setValue(nextValue: string): void {
    this.value = nextValue;
    this.listeners.forEach((listener) => listener(nextValue));
  }

  getValueInRange(range: MockSelectionLike): string {
    const lines = this.value.split("\n");
    const startLine = Math.max(range.startLineNumber - 1, 0);
    const endLine = Math.max(range.endLineNumber - 1, 0);

    if (startLine === endLine) {
      return (lines[startLine] ?? "").slice(range.startColumn - 1, range.endColumn - 1);
    }

    return lines
      .slice(startLine, endLine + 1)
      .map((line, index, selectedLines) => {
        if (index === 0) {
          return line.slice(range.startColumn - 1);
        }

        if (index === selectedLines.length - 1) {
          return line.slice(0, range.endColumn - 1);
        }

        return line;
      })
      .join("\n");
  }

  getLineMaxColumn(lineNumber: number): number {
    return (this.value.split("\n")[lineNumber - 1]?.length ?? 0) + 1;
  }

  onDidChangeContent(listener: (value: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }

  dispose(): void {
    this.listeners.clear();
  }
}

class MockDecorationsCollection {
  set = vi.fn();
  clear = vi.fn();
}

class MockEditor {
  host: HTMLElement;
  root: HTMLElement;
  model: MockModel;
  selection: MockSelection;
  position = { lineNumber: 1, column: 1 };
  decorations = new MockDecorationsCollection();
  revealRangeInCenter = vi.fn();
  revealLineInCenter = vi.fn();
  layout = vi.fn();
  focus = vi.fn(() => {
    this.focusListeners.forEach((listener) => listener());
  });
  updateOptions = vi.fn();
  private selectionListeners: Array<Listener<{ selection: MockSelection }>> = [];
  private mouseMoveListeners: Array<Listener<{ target: { position: { lineNumber: number; column: number } | null } }>> = [];
  private mouseLeaveListeners: Array<Listener<void>> = [];
  private scrollListeners: Array<Listener<void>> = [];
  private layoutListeners: Array<Listener<void>> = [];
  private focusListeners: Array<Listener<void>> = [];
  private blurListeners: Array<Listener<void>> = [];
  private contentListeners: Array<Listener<void>> = [];
  private commands = new Map<number, () => void>();
  private modelSubscription: { dispose(): void } | null = null;

  constructor(host: HTMLElement, model: MockModel) {
    this.host = host;
    this.model = model;
    this.selection = new MockSelection(1, 1, 1, 1);
    this.root = document.createElement("div");
    this.root.className = "monaco-editor";
    this.root.textContent = model.getValue();
    this.host.append(this.root);
    this.modelSubscription = model.onDidChangeContent((value) => {
      this.root.textContent = value;
      this.contentListeners.forEach((listener) => listener());
    });
  }

  getModel(): MockModel {
    return this.model;
  }

  setSelection(selection: MockSelection): void {
    this.selection = selection;
    this.position = { lineNumber: selection.endLineNumber, column: selection.endColumn };
    this.selectionListeners.forEach((listener) => listener({ selection }));
  }

  getSelection(): MockSelection {
    return this.selection;
  }

  setPosition(position: { lineNumber: number; column: number }): void {
    this.position = position;
  }

  getPosition(): { lineNumber: number; column: number } {
    return this.position;
  }

  getScrolledVisiblePosition(position: { lineNumber: number; column: number }): { top: number; left: number; height: number } {
    return {
      top: (position.lineNumber - 1) * 24,
      left: 56,
      height: 24
    };
  }

  createDecorationsCollection(): MockDecorationsCollection {
    return this.decorations;
  }

  onDidChangeCursorSelection(listener: Listener<{ selection: MockSelection }>): { dispose(): void } {
    this.selectionListeners.push(listener);
    return { dispose() {} };
  }

  onMouseMove(listener: Listener<{ target: { position: { lineNumber: number; column: number } | null } }>): { dispose(): void } {
    this.mouseMoveListeners.push(listener);
    return { dispose() {} };
  }

  onMouseLeave(listener: Listener<void>): { dispose(): void } {
    this.mouseLeaveListeners.push(listener);
    return { dispose() {} };
  }

  onDidScrollChange(listener: Listener<void>): { dispose(): void } {
    this.scrollListeners.push(listener);
    return { dispose() {} };
  }

  onDidLayoutChange(listener: Listener<void>): { dispose(): void } {
    this.layoutListeners.push(listener);
    return { dispose() {} };
  }

  onDidFocusEditorText(listener: Listener<void>): { dispose(): void } {
    this.focusListeners.push(listener);
    return { dispose() {} };
  }

  onDidBlurEditorText(listener: Listener<void>): { dispose(): void } {
    this.blurListeners.push(listener);
    return { dispose() {} };
  }

  onDidChangeModelContent(listener: Listener<void>): { dispose(): void } {
    this.contentListeners.push(listener);
    return { dispose() {} };
  }

  addCommand(keybinding: number, handler: () => void): string {
    this.commands.set(keybinding, handler);
    return String(keybinding);
  }

  triggerSelection(selection: MockSelection): void {
    this.setSelection(selection);
  }

  triggerMouseMove(lineNumber: number | null): void {
    this.mouseMoveListeners.forEach((listener) => listener({
      target: {
        position: lineNumber ? { lineNumber, column: 1 } : null
      }
    }));
  }

  triggerMouseLeave(): void {
    this.mouseLeaveListeners.forEach((listener) => listener());
  }

  triggerScroll(): void {
    this.scrollListeners.forEach((listener) => listener());
  }

  triggerLayout(): void {
    this.layoutListeners.forEach((listener) => listener());
  }

  triggerContent(value: string): void {
    this.model.setValue(value);
  }

  triggerFocus(): void {
    this.focusListeners.forEach((listener) => listener());
  }

  triggerBlur(): void {
    this.blurListeners.forEach((listener) => listener());
  }

  triggerCommand(keybinding: number): void {
    this.commands.get(keybinding)?.();
  }

  dispose(): void {
    this.modelSubscription?.dispose();
    this.root.remove();
  }
}

const editorInstances: MockEditor[] = [];
const defineTheme = vi.fn();
const setTheme = vi.fn();
const setEagerModelSync = vi.fn();
const setCompilerOptions = vi.fn();

export function resetMonacoMock(): void {
  editorInstances.splice(0, editorInstances.length);
  defineTheme.mockClear();
  setTheme.mockClear();
  setEagerModelSync.mockClear();
  setCompilerOptions.mockClear();
}

export function getMockEditors(): MockEditor[] {
  return [...editorInstances];
}

export function getLastMockEditor(): MockEditor {
  const editor = editorInstances.at(-1);

  if (!editor) {
    throw new Error("Nenhum editor Monaco mockado foi criado.");
  }

  return editor;
}

export function createMockSelection(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number
): MockSelection {
  return new MockSelection(startLineNumber, startColumn, endLineNumber, endColumn);
}

const mockMonaco = {
  editor: {
    create(host: HTMLElement, options: { model: MockModel }) {
      const editor = new MockEditor(host, options.model);
      editorInstances.push(editor);
      return editor;
    },
    createModel(value: string) {
      return new MockModel(value);
    },
    defineTheme,
    setTheme
  },
  languages: {
    typescript: {
      typescriptDefaults: {
        setEagerModelSync,
        setCompilerOptions
      },
      ScriptTarget: {
        ES2022: 99
      },
      ModuleKind: {
        ESNext: 99
      },
      ModuleResolutionKind: {
        NodeJs: 2
      }
    }
  },
  Uri: {
    parse(value: string) {
      return { toString: () => value };
    }
  },
  Selection: MockSelection,
  Range: MockRange,
  KeyCode: {
    Enter: 3,
    Space: 10
  },
  KeyMod: {
    CtrlCmd: 2048
  }
};

export function ensureMonacoSetup() {
  return mockMonaco as never;
}

export function resolveMonacoTheme(theme?: string): string {
  return theme === "classic-dark"
    ? "ts-bug-hunt-classic-dark"
    : "ts-bug-hunt-operator-mono-dark-modern";
}
