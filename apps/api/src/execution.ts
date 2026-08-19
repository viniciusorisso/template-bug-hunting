import vm from "node:vm";
import ts from "typescript";
import type {
  RoomRunResponse,
  RoomTypecheckResponse,
  TypecheckDiagnostic
} from "@ts-bug-hunt/core";

const SOURCE_FILENAME = "challenge.ts";
const MAX_SOURCE_LENGTH = 50_000;
const EXECUTION_TIMEOUT_MS = 1_000;

const compilerOptions: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true
};

type TranspileResult = {
  diagnostics: TypecheckDiagnostic[];
  outputText: string;
};

export function validateExecutionSourceSize(source: string): string | null {
  if (source.length > MAX_SOURCE_LENGTH) {
    return `source excede o limite de ${MAX_SOURCE_LENGTH} caracteres.`;
  }

  return null;
}

export function runTypecheck(source: string): RoomTypecheckResponse {
  const startedAt = Date.now();
  const diagnostics = collectDiagnostics(source);

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.category === "error"),
    diagnostics,
    rawOutput: formatDiagnostics(diagnostics),
    durationMs: Date.now() - startedAt
  };
}

export async function runRuntimeSimulation(challengeId: string, source: string): Promise<RoomRunResponse> {
  const startedAt = Date.now();
  const diagnostics = collectDiagnostics(source);

  if (diagnostics.some((diagnostic) => diagnostic.category === "error")) {
    return {
      ok: false,
      stdout: "",
      stderr: formatDiagnostics(diagnostics),
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      terminationReason: "runtime_error"
    };
  }

  const transpiled = transpileSource(source);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const moduleRef: { exports: Record<string, unknown> } = { exports: {} };
  const context = vm.createContext({
    module: moduleRef,
    exports: moduleRef.exports,
    console: buildConsole(stdout, stderr)
  });

  try {
    const script = new vm.Script(transpiled.outputText, { filename: `${challengeId}.js` });
    script.runInContext(context, { timeout: EXECUTION_TIMEOUT_MS });
    await executeHarness(challengeId, moduleRef.exports, stdout, stderr);

    return {
      ok: stderr.length === 0,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      exitCode: stderr.length === 0 ? 0 : 1,
      durationMs: Date.now() - startedAt,
      terminationReason: "completed"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida ao executar o codigo.";
    const timedOut = message.includes("Script execution timed out");

    stderr.push(message);

    return {
      ok: false,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      exitCode: timedOut ? null : 1,
      durationMs: Date.now() - startedAt,
      terminationReason: timedOut ? "timeout" : "runtime_error"
    };
  }
}

function collectDiagnostics(source: string): TypecheckDiagnostic[] {
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === SOURCE_FILENAME) {
      return ts.createSourceFile(fileName, source, languageVersion, true);
    }

    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  host.readFile = (fileName) => {
    if (fileName === SOURCE_FILENAME) {
      return source;
    }

    return originalReadFile(fileName);
  };

  host.fileExists = (fileName) => {
    if (fileName === SOURCE_FILENAME) {
      return true;
    }

    return originalFileExists(fileName);
  };

  const program = ts.createProgram([SOURCE_FILENAME], compilerOptions, host);
  return ts.getPreEmitDiagnostics(program).map(mapDiagnostic);
}

function transpileSource(source: string): TranspileResult {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      ...compilerOptions,
      noEmit: false
    },
    fileName: SOURCE_FILENAME,
    reportDiagnostics: false
  });

  return {
    diagnostics: [],
    outputText: result.outputText
  };
}

function mapDiagnostic(diagnostic: ts.Diagnostic): TypecheckDiagnostic {
  const lineAndCharacter = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);

  return {
    code: diagnostic.code ? `TS${diagnostic.code}` : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    file: diagnostic.file?.fileName ?? SOURCE_FILENAME,
    line: (lineAndCharacter?.line ?? 0) + 1,
    column: (lineAndCharacter?.character ?? 0) + 1,
    category: diagnostic.category === ts.DiagnosticCategory.Error
      ? "error"
      : diagnostic.category === ts.DiagnosticCategory.Warning
        ? "warning"
        : "message"
  };
}

function formatDiagnostics(diagnostics: TypecheckDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "Nenhum diagnostico encontrado.";
  }

  return diagnostics
    .map((diagnostic) => {
      const code = diagnostic.code ? ` ${diagnostic.code}` : "";
      return `${diagnostic.category.toUpperCase()}${code} ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;
    })
    .join("\n");
}

function buildConsole(stdout: string[], stderr: string[]) {
  return {
    log: (...args: unknown[]) => {
      stdout.push(args.map(formatConsoleValue).join(" "));
    },
    info: (...args: unknown[]) => {
      stdout.push(args.map(formatConsoleValue).join(" "));
    },
    warn: (...args: unknown[]) => {
      stderr.push(args.map(formatConsoleValue).join(" "));
    },
    error: (...args: unknown[]) => {
      stderr.push(args.map(formatConsoleValue).join(" "));
    }
  };
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function executeHarness(
  challengeId: string,
  exportsObject: Record<string, unknown>,
  stdout: string[],
  stderr: string[]
): Promise<void> {
  if (challengeId === "checkout-ts-bug-hunt") {
    const calculateCheckout = exportsObject.calculateCheckout;

    if (typeof calculateCheckout !== "function") {
      stderr.push("Funcao calculateCheckout nao foi encontrada para execucao.");
      return;
    }

    const result = await calculateCheckout({
      userId: "demo-user",
      plan: "pro",
      items: [
        { id: "item-1", name: "Curso", priceInCents: 1000, quantity: 2 }
      ],
      couponCode: "SAVE10",
      coupons: [
        { code: "SAVE10", type: "percent", amount: 10, used: 0 }
      ],
      now: new Date("2026-08-19T00:00:00.000Z")
    });

    stdout.push(JSON.stringify(result, null, 2));
    return;
  }

  if (challengeId === "ts-type-system-bug-hunt") {
    const buildUserSummary = exportsObject.buildUserSummary;
    const getNotificationTarget = exportsObject.getNotificationTarget;

    if (typeof buildUserSummary !== "function" || typeof getNotificationTarget !== "function") {
      stderr.push("Funcoes esperadas do template de tipos nao foram encontradas para execucao.");
      return;
    }

    const summary = buildUserSummary({
      id: "demo-user",
      email: "user@example.com",
      roles: ["viewer"],
      preferences: {
        theme: "dark",
        shortcuts: ["cmd+k"]
      },
      metadata: {
        analyticsId: "analytics-demo"
      }
    });

    const notificationTarget = getNotificationTarget({ type: "email", address: "user@example.com" });
    stdout.push(JSON.stringify(summary, null, 2));
    stdout.push(String(notificationTarget));
    return;
  }

  stdout.push("Execucao concluida sem harness especifica para este challenge.");
}
