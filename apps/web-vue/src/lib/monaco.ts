import * as monaco from "monaco-editor";
import "../../node_modules/monaco-editor/min/vs/editor/editor.main.css";
import editorWorker from "../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import jsonWorker from "../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker";
import cssWorker from "../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import htmlWorker from "../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import tsWorker from "../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

export type EditorThemeId = "classic-dark" | "operator-mono-dark-modern";

const THEME_NAMES = {
  classicDark: "ts-bug-hunt-classic-dark",
  operatorMonoDarkModern: "ts-bug-hunt-operator-mono-dark-modern"
} as const;

let configured = false;

export function ensureMonacoSetup(): typeof monaco {
  if (configured) {
    return monaco;
  }

  const monacoEnvironment = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker?: (_workerId: string, label: string) => Worker;
    };
  };

  monacoEnvironment.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === "json") {
        return new jsonWorker();
      }

      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }

      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }

      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }

      return new editorWorker();
    }
  };

  defineThemes();
  configured = true;
  return monaco;
}

export function resolveMonacoTheme(theme?: string): string {
  return theme === "classic-dark"
    ? THEME_NAMES.classicDark
    : THEME_NAMES.operatorMonoDarkModern;
}

function defineThemes(): void {
  monaco.editor.defineTheme(THEME_NAMES.classicDark, {
    base: "vs-dark",
    inherit: true,
    colors: {
      "editor.background": "#0F1319",
      "editor.foreground": "#D7DEE7",
      "editorLineNumber.foreground": "#697586",
      "editorLineNumber.activeForeground": "#D7DEE7",
      "editorCursor.foreground": "#F2F4F8",
      "editor.selectionBackground": "#3F7CFF24",
      "editor.inactiveSelectionBackground": "#3F7CFF1A",
      "editor.lineHighlightBackground": "#161D28",
      "editorIndentGuide.background1": "#242C37",
      "editorIndentGuide.activeBackground1": "#384252"
    },
    rules: [
      { token: "comment", foreground: "5C6B7A" },
      { token: "keyword", foreground: "C792EA" },
      { token: "keyword.operator", foreground: "89DDFF" },
      { token: "string", foreground: "C3E88D" },
      { token: "number", foreground: "F78C6C" },
      { token: "type.identifier", foreground: "82AAFF" },
      { token: "delimiter", foreground: "A6ACCD" },
      { token: "identifier", foreground: "D7DEE7" }
    ]
  });

  monaco.editor.defineTheme(THEME_NAMES.operatorMonoDarkModern, {
    base: "vs-dark",
    inherit: true,
    colors: {
      "editor.background": "#231F32",
      "editor.foreground": "#F7F3ED",
      "editorCursor.foreground": "#FFB86C",
      "editor.lineHighlightBackground": "#2B2640",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#FF8F6B26",
      "editor.inactiveSelectionBackground": "#FF8F6B14",
      "editor.selectionHighlightBackground": "#FF8F6B14",
      "editor.wordHighlightBackground": "#FF8F6B10",
      "editor.wordHighlightStrongBackground": "#FF8F6B18",
      "editorLineNumber.foreground": "#7F7896",
      "editorLineNumber.activeForeground": "#F7F3ED",
      "editorIndentGuide.background1": "#342E49",
      "editorIndentGuide.activeBackground1": "#4B4365",
      "editorWhitespace.foreground": "#3B3550",
      "editor.findMatchBackground": "#FFB86C55",
      "editor.findMatchHighlightBackground": "#FFB86C22",
      "editorBracketMatch.background": "#00000000",
      "editorBracketMatch.border": "#FF9D7A66"
    },
    rules: [
      { token: "", foreground: "F7F3ED", background: "231F32" },
      { token: "comment", foreground: "8B849D", fontStyle: "italic" },
      { token: "keyword", foreground: "C792EA" },
      { token: "keyword.operator", foreground: "FF9E64" },
      { token: "operator", foreground: "FF9E64" },
      { token: "string", foreground: "FFD866" },
      { token: "string.escape", foreground: "FFB86C" },
      { token: "number", foreground: "FF6188" },
      { token: "regexp", foreground: "FFD866" },
      { token: "type", foreground: "78DCE8" },
      { token: "type.identifier", foreground: "78DCE8" },
      { token: "typeParameter", foreground: "FC9867" },
      { token: "identifier", foreground: "F7F3ED" },
      { token: "variable", foreground: "FC9867" },
      { token: "variable.parameter", foreground: "FC9867" },
      { token: "delimiter", foreground: "F7F3ED" },
      { token: "delimiter.bracket", foreground: "F7F3ED" },
      { token: "delimiter.array", foreground: "F7F3ED" },
      { token: "tag", foreground: "FF6188" },
      { token: "attribute.name", foreground: "A9DC76" },
      { token: "function", foreground: "A9DC76" },
      { token: "function.call", foreground: "A9DC76" },
      { token: "function.declaration", foreground: "A9DC76" },
      { token: "namespace", foreground: "78DCE8" },
      { token: "predefined", foreground: "AB9DF2" }
    ]
  });
}
