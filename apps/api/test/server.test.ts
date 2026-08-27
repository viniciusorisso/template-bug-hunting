import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { hashSource } from "@ts-bug-hunt/core";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { createServer } from "../dist/apps/api/src/server.js";

let server: http.Server;
let baseUrl: string;
let adminToken = "";
let roomCode = "";
const originalAdminUsername = process.env.TS_BUG_HUNT_ADMIN_USERNAME;
const originalAdminPassword = process.env.TS_BUG_HUNT_ADMIN_PASSWORD;

test.before(async () => {
  process.env.TS_BUG_HUNT_ADMIN_USERNAME = "admin";
  process.env.TS_BUG_HUNT_ADMIN_PASSWORD = "secret-123";
  server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Nao foi possivel obter a porta do servidor de teste.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await closeServer(server);

  if (originalAdminUsername === undefined) {
    delete process.env.TS_BUG_HUNT_ADMIN_USERNAME;
  } else {
    process.env.TS_BUG_HUNT_ADMIN_USERNAME = originalAdminUsername;
  }

  if (originalAdminPassword === undefined) {
    delete process.env.TS_BUG_HUNT_ADMIN_PASSWORD;
  } else {
    process.env.TS_BUG_HUNT_ADMIN_PASSWORD = originalAdminPassword;
  }
});

test("GET /api/admin/status informa que o login admin esta configurado", async () => {
  const response = await fetch(`${baseUrl}/api/admin/status`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.configured, true);
  assert.equal(payload.username, "admin");
});

test("POST /api/admin/login autentica o admin configurado", async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: "admin", password: "secret-123" })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.token, "admin-session-token");
  assert.equal(payload.username, "admin");

  adminToken = payload.token;
});


test("POST /api/admin/login permite autenticar novamente sem bloquear a sessao", async () => {
  const firstResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: "admin", password: "secret-123" })
  });
  const secondResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: "admin", password: "secret-123" })
  });

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
});


test("POST /api/admin/login bloqueia brute force por IP por alguns minutos", async () => {
  let currentTime = 0;
  const rateLimitedServer = createServer({ now: () => currentTime });
  await new Promise<void>((resolve) => {
    rateLimitedServer.listen(0, () => resolve());
  });

  const address = rateLimitedServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Nao foi possivel obter a porta do servidor limitado.");
  }

  const rateLimitedBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${rateLimitedBaseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username: "admin", password: "errada" })
      });

      assert.equal(response.status, 401);
    }

    const blockedResponse = await fetch(`${rateLimitedBaseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: "admin", password: "errada" })
    });
    const blockedPayload = await blockedResponse.json();

    assert.equal(blockedResponse.status, 429);
    assert.match(String(blockedPayload.message), /Muitas tentativas de login/);
    assert.equal(blockedResponse.headers.get("retry-after"), "300");

    const blockedValidLoginResponse = await fetch(`${rateLimitedBaseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: "admin", password: "secret-123" })
    });

    assert.equal(blockedValidLoginResponse.status, 429);

    currentTime += 5 * 60 * 1000 + 1;

    const recoveredResponse = await fetch(`${rateLimitedBaseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: "admin", password: "secret-123" })
    });

    assert.equal(recoveredResponse.status, 200);
  } finally {
    await closeServer(rateLimitedServer);
  }
});

test("POST /api/admin/rooms cria sala autenticada e GET /api/admin/rooms lista a sala", async () => {
  const createResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma 1", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const createdRoom = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(createdRoom.name, "Turma 1");
  assert.equal(createdRoom.status, "active");
  assert.ok(typeof createdRoom.roomCode === "string");
  assert.equal(createdRoom.password, undefined);

  roomCode = createdRoom.roomCode;

  const listResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });
  const rooms = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.equal(Array.isArray(rooms), true);
  assert.equal(rooms.some((room: { roomCode: string }) => room.roomCode === roomCode), true);
});

test("POST /api/rooms/join permite entrada em sala ativa", async () => {
  const response = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomCode, displayName: "Risso" })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.roomCode, roomCode);
  assert.equal(payload.roomName, "Turma 1");
  assert.equal(payload.displayName, "Risso");
  assert.equal(payload.challengeId, "checkout-ts-bug-hunt");
  assert.equal(payload.challengeTitle, "Checkout TypeScript Challenge");
  assert.ok(typeof payload.participantSessionId === "string");
});

test("POST /api/admin/rooms cria sala com execucao desabilitada por default e PATCH atualiza as flags", async () => {
  const createResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma Exec", password: "room-secret", challengeId: "ts-type-system-bug-hunt" })
  });
  const createdRoom = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.deepEqual(createdRoom.executionSettings, { allowTypecheck: false, allowRuntimeExecution: false });

  const patchResponse = await fetch(`${baseUrl}/api/admin/rooms/${createdRoom.roomCode}/execution-settings`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ allowTypecheck: true, allowRuntimeExecution: true })
  });
  const patchPayload = await patchResponse.json();

  assert.equal(patchResponse.status, 200);
  assert.deepEqual(patchPayload.executionSettings, { allowTypecheck: true, allowRuntimeExecution: true });

  const listResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });
  const rooms = await listResponse.json();
  const updatedRoom = rooms.find((room) => room.roomCode === createdRoom.roomCode);

  assert.deepEqual(updatedRoom.executionSettings, { allowTypecheck: true, allowRuntimeExecution: true });
});

test("POST /api/rooms/:roomCode/typecheck bloqueia salas sem permissao", async () => {
  const joinResponse = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomCode, displayName: "Exec Block" })
  });
  const joinPayload = await joinResponse.json();

  const response = await fetch(`${baseUrl}/api/rooms/${roomCode}/typecheck`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      participantSessionId: joinPayload.participantSessionId,
      challengeId: "checkout-ts-bug-hunt",
      source: "export const value = 1;"
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.match(String(payload.message), /Typecheck nao habilitado/);
});

test("POST /api/rooms/:roomCode/typecheck e /run funcionam quando a sala libera execucao", async () => {
  const createResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma Runtime", password: "room-secret", challengeId: "ts-type-system-bug-hunt" })
  });
  const createdRoom = await createResponse.json();

  await fetch(`${baseUrl}/api/admin/rooms/${createdRoom.roomCode}/execution-settings`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ allowTypecheck: true, allowRuntimeExecution: true })
  });

  const joinResponse = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomCode: createdRoom.roomCode, displayName: "Exec User" })
  });
  const joinPayload = await joinResponse.json();

  assert.deepEqual(joinPayload.executionSettings, { allowTypecheck: true, allowRuntimeExecution: true });

  const typecheckResponse = await fetch(`${baseUrl}/api/rooms/${createdRoom.roomCode}/typecheck`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      participantSessionId: joinPayload.participantSessionId,
      challengeId: "ts-type-system-bug-hunt",
      source: "const value: string = 123; export {};"
    })
  });
  const typecheckPayload = await typecheckResponse.json();

  assert.equal(typecheckResponse.status, 200);
  assert.equal(typecheckPayload.ok, false);
  assert.match(String(typecheckPayload.rawOutput), /TS2322/);

  const runtimeSource = [
    'type Role = "viewer";',
    'type Theme = "light" | "dark";',
    'type Notification = { type: "email"; address: string };',
    'type UserPatch = { id?: string | null; email?: string | null; roles?: readonly Role[]; preferences?: { theme: Theme; shortcuts?: readonly string[] }; metadata?: Record<string, string> };',
    'type UserSummary = { id: string; email: string; primaryRole: Role; shortcuts: string[]; theme: Theme; analyticsId: string };',
    'export function buildUserSummary(patch: UserPatch, fallbackRole: Role = "viewer"): UserSummary {',
    '  return {',
    '    id: patch.id?.trim() ?? "",',
    '    email: patch.email?.toLowerCase() ?? "",',
    '    primaryRole: patch.roles?.[0] ?? fallbackRole,',
    '    shortcuts: [...(patch.preferences?.shortcuts ?? ["cmd+k"]), "cmd+/"],',
    '    theme: patch.preferences?.theme ?? "light",',
    '    analyticsId: patch.metadata?.analyticsId ?? ""',
    '  };',
    '}',
    'export function getNotificationTarget(notification: Notification) {',
    '  return notification.address.trim().toLowerCase();',
    '}'
  ].join("\n");

  const runResponse = await fetch(`${baseUrl}/api/rooms/${createdRoom.roomCode}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      participantSessionId: joinPayload.participantSessionId,
      challengeId: "ts-type-system-bug-hunt",
      source: runtimeSource
    })
  });
  const runPayload = await runResponse.json();

  assert.equal(runResponse.status, 200);
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.exitCode, 0);
  assert.match(String(runPayload.stdout), /primaryRole/);
  assert.match(String(runPayload.stdout), /user@example.com/);
});

test("GET /api/session-progress retorna estado inicial da sessao", async () => {
  const response = await fetch(`${baseUrl}/api/session-progress/session-a/checkout-ts-bug-hunt`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.sessionId, "session-a");
  assert.deepEqual(payload.solvedBugIds, []);
  assert.deepEqual(payload.attempts, []);
});

test("POST /api/submissions registra bug resolvido e progresso fica disponivel", async () => {
  const submissionResponse = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "session-b",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  const submissionPayload = await submissionResponse.json();
  const progressResponse = await fetch(`${baseUrl}/api/session-progress/session-b/checkout-ts-bug-hunt`);
  const progressPayload = await progressResponse.json();

  assert.equal(submissionResponse.status, 200);
  assert.equal(submissionPayload.status, "solved");
  assert.equal(submissionPayload.resolvedBugDiff?.bugId, "B002");
  assert.deepEqual(progressPayload.solvedBugIds, ["B002"]);
  assert.equal(progressPayload.attempts.length, 1);
});

test("GET /api/challenges nao expoe respostas ou regras privadas dos bugs", async () => {
  const listResponse = await fetch(`${baseUrl}/api/challenges`);
  const listPayload = await listResponse.json();
  const detailResponse = await fetch(`${baseUrl}/api/challenges/checkout-ts-bug-hunt`);
  const detailPayload = await detailResponse.json();

  assert.equal(listResponse.status, 200);
  assert.equal(detailResponse.status, 200);

  for (const challenge of [...listPayload, detailPayload]) {
    for (const bug of challenge.bugs) {
      assert.deepEqual(Object.keys(bug).sort(), ["category", "difficulty", "id", "title"]);
    }

    assert.equal(JSON.stringify(challenge).includes("expectedFix"), false);
    assert.equal(JSON.stringify(challenge).includes("technicalBasis"), false);
    assert.equal(JSON.stringify(challenge).includes("expectedRange"), false);
    assert.equal(JSON.stringify(challenge).includes("replacement"), false);
    assert.equal(JSON.stringify(challenge).includes("testId"), false);
  }
});

test("GET /api/challenge-state/:challengeId retorna source derivado e diffs resolvidos", async () => {
  await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "session-challenge-state",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  const response = await fetch(`${baseUrl}/api/challenge-state/checkout-ts-bug-hunt`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.resolvedBugOrder, ["B002"]);
  assert.equal(payload.resolvedBugDiffs.B002.bugId, "B002");
  assert.equal(payload.resolvedBugTechnicalBases.B002, "Array vai de 0 ate length - 1.");
  assert.match(payload.displayedSource, /i < input\.items\.length/);
});

test("GET /api/challenge-state/:challengeId isola o historico de resolucoes por sala", async () => {
  const createRoomAResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma A", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const roomA = await createRoomAResponse.json();

  const createRoomBResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma B", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const roomB = await createRoomBResponse.json();

  await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "session-room-a",
      roomCode: roomA.roomCode,
      participantName: "Risso",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  const roomAResponse = await fetch(`${baseUrl}/api/challenge-state/checkout-ts-bug-hunt?roomCode=${roomA.roomCode}`);
  const roomBResponse = await fetch(`${baseUrl}/api/challenge-state/checkout-ts-bug-hunt?roomCode=${roomB.roomCode}`);
  const roomAPayload = await roomAResponse.json();
  const roomBPayload = await roomBResponse.json();

  assert.deepEqual(roomAPayload.resolvedBugOrder, ["B002"]);
  assert.deepEqual(roomBPayload.resolvedBugOrder, []);
  assert.match(roomAPayload.displayedSource, /i < input\.items\.length/);
  assert.match(roomBPayload.displayedSource, /i <= input\.items\.length/);
});

test("POST /api/hints/request prioriza bugs faceis e avanca o nivel da mesma dica", async () => {
  const createRoomResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma Hint", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const createdRoom = await createRoomResponse.json();

  const firstHintResponse = await fetch(`${baseUrl}/api/hints/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "hint-session-1",
      roomCode: createdRoom.roomCode
    })
  });
  const firstHint = await firstHintResponse.json();

  const secondHintResponse = await fetch(`${baseUrl}/api/hints/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "hint-session-1",
      roomCode: createdRoom.roomCode
    })
  });
  const secondHint = await secondHintResponse.json();

  assert.equal(firstHintResponse.status, 200);
  assert.equal(firstHint.bugId, "B001");
  assert.equal(firstHint.difficulty, "easy");
  assert.equal(firstHint.hintLevel, 1);
  assert.equal(secondHintResponse.status, 200);
  assert.equal(secondHint.bugId, "B001");
  assert.equal(secondHint.hintLevel, 2);
});

test("POST /api/hints/request ignora bug ja resolvido no contexto da sala", async () => {
  const createRoomResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma Hint Resolve", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const createdRoom = await createRoomResponse.json();

  await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "hint-solved-session",
      roomCode: createdRoom.roomCode,
      participantName: "Risso",
      selection: { startLine: 32, startColumn: 18, endLine: 32, endColumn: 39 },
      proposedFix: 'if (!input.userId?.trim()) throw new Error("User id is required");' 
    })
  });

  const hintResponse = await fetch(`${baseUrl}/api/hints/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "hint-solved-session",
      roomCode: createdRoom.roomCode
    })
  });
  const hintPayload = await hintResponse.json();

  assert.equal(hintResponse.status, 200);
  assert.equal(hintPayload.bugId, "B002");
});

test("POST /api/submissions registra atividade de sala sem expor a resposta literal no feed", async () => {
  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "room-session-1",
      roomCode,
      participantName: "Risso",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });
  const payload = await response.json();
  const activityResponse = await fetch(`${baseUrl}/api/admin/rooms/${roomCode}/activity`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });
  const activityPayload = await activityResponse.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "solved");
  assert.equal(activityResponse.status, 200);
  assert.equal(activityPayload.roomCode, roomCode);
  assert.equal(activityPayload.items.length, 1);
  assert.equal(activityPayload.items[0].submittedBy, "Risso");
  assert.equal(activityPayload.items[0].bugId, "B002");
  assert.equal("proposedFix" in activityPayload.items[0], false);
  assert.equal(activityPayload.items[0].submittedCode, "Trocar <= por < porque existe um off-by-one no loop.");
});

test("GET /api/admin/rooms/:roomCode/activity exige autenticacao admin", async () => {
  const response = await fetch(`${baseUrl}/api/admin/rooms/${roomCode}/activity`);
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.message, "Nao autorizado.");
});

test("POST /api/rooms/join rejeita displayName curto demais", async () => {
  const response = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomCode, displayName: "A" })
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.message, "displayName deve ter entre 2 e 40 caracteres.");
});

test("DELETE /api/session-progress reseta a sessao", async () => {
  await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "session-reset",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  const deleteResponse = await fetch(`${baseUrl}/api/session-progress/session-reset/checkout-ts-bug-hunt`, {
    method: "DELETE"
  });

  const progressResponse = await fetch(`${baseUrl}/api/session-progress/session-reset/checkout-ts-bug-hunt`);
  const progressPayload = await progressResponse.json();

  assert.equal(deleteResponse.status, 204);
  assert.deepEqual(progressPayload.solvedBugIds, []);
  assert.deepEqual(progressPayload.attempts, []);
});

test("DELETE /api/admin/rooms/:roomCode inativa a sala", async () => {
  const deleteResponse = await fetch(`${baseUrl}/api/admin/rooms/${roomCode}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });

  const joinResponse = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomCode, displayName: "Outro usuario" })
  });
  const joinPayload = await joinResponse.json();

  assert.equal(deleteResponse.status, 204);
  assert.equal(joinResponse.status, 404);
  assert.equal(joinPayload.message, "Sala nao encontrada ou inativa.");
});

test("POST /api/submissions retorna 400 para payload invalido", async () => {
  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "",
      selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
      proposedFix: ""
    })
  });

  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.message, "sessionId e obrigatorio.");
});

test("POST /api/submissions retorna 400 para JSON malformado", async () => {
  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{invalid"
  });

  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.message, "Payload JSON invalido.");
});

test("GET /api/events transmite bug resolvido por SSE", async () => {
  const stream = openEventStream(`/api/events?challengeId=checkout-ts-bug-hunt`);
  await stream.ready;

  await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "session-stream",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  const payload = await stream.eventPromise;

  assert.equal(payload.type, "bug.resolved");
  assert.equal(payload.challengeId, "checkout-ts-bug-hunt");
  assert.equal(payload.sessionId, "session-stream");
  assert.equal(payload.bugId, "B002");
  assert.equal(payload.diff.bugId, "B002");
  assert.equal(payload.shortDescription, "Array vai de 0 ate length - 1.");

  stream.close();
});

test("GET /api/rooms/:roomCode/events transmite atividade de sala segregada por roomCode", async () => {
  const createResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Turma SSE", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const createdRoom = await createResponse.json();
  const stream = openEventStream(`/api/rooms/${createdRoom.roomCode}/events`);
  await stream.ready;

  await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "session-room-stream",
      roomCode: createdRoom.roomCode,
      participantName: "Risso",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  const payload = await stream.eventPromise;

  assert.equal(payload.type, "room.activity");
  assert.equal(payload.roomCode, createdRoom.roomCode);
  assert.equal(payload.item.submittedBy, "Risso");
  assert.equal(payload.item.bugId, "B002");
  assert.equal("proposedFix" in payload.item, false);

  stream.close();
});

test("createServer reidrata estado persistido depois de reiniciar a API", async (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "ts-bug-hunt-state-"));
  const stateFilePath = path.join(tempDir, "api-state.json");
  t.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  let persistentServer = createServer({ stateFilePath });
  await new Promise<void>((resolve) => {
    persistentServer.listen(0, () => resolve());
  });

  let address = persistentServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Nao foi possivel obter a porta do servidor persistente.");
  }

  let persistentBaseUrl = `http://127.0.0.1:${address.port}`;

  const loginResponseBeforeRestart = await fetch(`${persistentBaseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: "admin", password: "secret-123" })
  });
  const loginPayloadBeforeRestart = await loginResponseBeforeRestart.json();
  const persistentToken = loginPayloadBeforeRestart.token;

  const createRoomResponse = await fetch(`${persistentBaseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${persistentToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Persisted Room", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const createdRoom = await createRoomResponse.json();

  await fetch(`${persistentBaseUrl}/api/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomCode: createdRoom.roomCode, displayName: "Persist User" })
  });

  await fetch(`${persistentBaseUrl}/api/hints/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "persisted-session",
      roomCode: createdRoom.roomCode
    })
  });

  await fetch(`${persistentBaseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "persisted-session",
      roomCode: createdRoom.roomCode,
      participantName: "Persist User",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "Trocar <= por < porque existe um off-by-one no loop."
    })
  });

  await closeServer(persistentServer);

  persistentServer = createServer({ stateFilePath });
  await new Promise<void>((resolve) => {
    persistentServer.listen(0, () => resolve());
  });
  t.after(async () => {
    await closeServer(persistentServer);
  });

  address = persistentServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Nao foi possivel obter a porta do servidor persistente reidratado.");
  }

  persistentBaseUrl = `http://127.0.0.1:${address.port}`;

  const statusResponse = await fetch(`${persistentBaseUrl}/api/admin/status`);
  const statusPayload = await statusResponse.json();
  assert.equal(statusPayload.configured, true);
  assert.equal(statusPayload.username, "admin");

  const loginResponse = await fetch(`${persistentBaseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: "admin", password: "secret-123" })
  });
  const loginPayload = await loginResponse.json();
  assert.equal(loginResponse.status, 200);

  const roomsResponse = await fetch(`${persistentBaseUrl}/api/admin/rooms`, {
    headers: {
      Authorization: `Bearer ${loginPayload.token}`
    }
  });
  const roomsPayload = await roomsResponse.json();
  assert.equal(roomsPayload.some((room: { roomCode: string }) => room.roomCode === createdRoom.roomCode), true);

  const progressResponse = await fetch(`${persistentBaseUrl}/api/session-progress/persisted-session/checkout-ts-bug-hunt`);
  const progressPayload = await progressResponse.json();
  assert.deepEqual(progressPayload.solvedBugIds, ["B002"]);

  const challengeStateResponse = await fetch(
    `${persistentBaseUrl}/api/challenge-state/checkout-ts-bug-hunt?roomCode=${createdRoom.roomCode}`
  );
  const challengeStatePayload = await challengeStateResponse.json();
  assert.deepEqual(challengeStatePayload.resolvedBugOrder, ["B002"]);

  const hintResponse = await fetch(`${persistentBaseUrl}/api/hints/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "persisted-session",
      roomCode: createdRoom.roomCode
    })
  });
  const hintPayload = await hintResponse.json();
  assert.equal(hintResponse.status, 200);
  assert.equal(hintPayload.bugId, "B001");
  assert.equal(hintPayload.hintLevel, 2);

  const activityResponse = await fetch(`${persistentBaseUrl}/api/admin/rooms/${createdRoom.roomCode}/activity`, {
    headers: {
      Authorization: `Bearer ${loginPayload.token}`
    }
  });
  const activityPayload = await activityResponse.json();
  assert.equal(activityPayload.items.length, 1);
  assert.equal(activityPayload.items[0].submittedBy, "Persist User");
});

test("POST /api/submissions calcula o diff no servidor para uma submissao pelo editor", async () => {
  const roomResponse = await fetch(`${baseUrl}/api/admin/rooms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Turma do editor", password: "room-secret", challengeId: "checkout-ts-bug-hunt" })
  });
  const editorRoom = await roomResponse.json();
  assert.equal(roomResponse.status, 201);

  const challengeResponse = await fetch(`${baseUrl}/api/challenges/checkout-ts-bug-hunt`);
  const challenge = await challengeResponse.json();
  const editedText = challenge.source.replace("i <= input.items.length", "i < input.items.length");

  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      challengeId: challenge.id,
      sessionId: "editor-diff-session",
      roomCode: editorRoom.roomCode,
      participantName: "Editor Test",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      file: {
        path: `${challenge.id}.ts`,
        language: "typescript",
        sourceVersion: hashSource(challenge.source),
        originalText: challenge.source,
        editedText
      },
      clientChanges: { operations: [] }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "solved");
  assert.equal(payload.serverDiff.operations[0].type, "replace");
  assert.equal(payload.serverDiff.operations[0].originalStartLine, 35);
  assert.equal(payload.serverDiff.operations[0].replacementText, "  for (let i = 0; i < input.items.length; i++) {");
  assert.equal(payload.serverDiff.addedLines, 1);
  assert.equal(payload.serverDiff.removedLines, 1);
  const progressResponse = await fetch(`${baseUrl}/api/session-progress/editor-diff-session/${challenge.id}`);
  const progressPayload = await progressResponse.json();
  assert.equal(progressPayload.attempts[0].originalText, challenge.source);
  assert.equal(progressPayload.attempts[0].editedText, editedText);
  assert.deepEqual(progressPayload.attempts[0].serverDiff, payload.serverDiff);

  const stateResponse = await fetch(`${baseUrl}/api/challenge-state/${challenge.id}?roomCode=${editorRoom.roomCode}`);
  const state = await stateResponse.json();
  const secondOriginalText = state.displayedSource;
  const secondEditedText = secondOriginalText.replace(
    "candidate.code === input.couponCode!.toUpperCase()",
    "candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()"
  );
  const secondResponse = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      challengeId: challenge.id,
      sessionId: "editor-diff-session",
      roomCode: editorRoom.roomCode,
      participantName: "Editor Test",
      selection: { startLine: 41, startColumn: 20, endLine: 41, endColumn: 61 },
      file: {
        path: `${challenge.id}.ts`,
        language: "typescript",
        sourceVersion: hashSource(secondOriginalText),
        originalText: secondOriginalText,
        editedText: secondEditedText
      },
      clientChanges: { operations: [] }
    })
  });
  const secondPayload = await secondResponse.json();

  assert.equal(stateResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(secondPayload.status, "solved");
  assert.equal(secondPayload.serverDiff.operations.length, 1);
  assert.equal(secondPayload.serverDiff.operations[0].originalStartLine, 41);
  assert.equal(secondPayload.serverDiff.operations[0].replacementText.includes("couponCode?.trim()"), true);
});

test("POST /api/submissions rejeita submissao pelo editor com fonte desatualizada", async () => {
  const challengeResponse = await fetch(`${baseUrl}/api/challenges/checkout-ts-bug-hunt`);
  const challenge = await challengeResponse.json();

  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      challengeId: challenge.id,
      sessionId: "stale-editor-session",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      file: {
        path: `${challenge.id}.ts`,
        language: "typescript",
        sourceVersion: "stale000",
        originalText: challenge.source,
        editedText: challenge.source.replace("i <= input.items.length", "i < input.items.length")
      },
      clientChanges: { operations: [] }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.conflict, true);
});

test("POST /api/submissions rejeita payload de editor malformado sem erro interno", async () => {
  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: "checkout-ts-bug-hunt",
      sessionId: "invalid-editor-session",
      selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      proposedFix: "i < input.items.length",
      file: null,
      clientChanges: { operations: [] }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.message, "Payload de editor invalido.");
});

function openEventStream(pathname: string): {
  ready: Promise<void>;
  eventPromise: Promise<Record<string, any>>;
  close: () => void;
} {
  const request = http.get(`${baseUrl}${pathname}`);
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const eventPromise = new Promise<Record<string, any>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      request.destroy();
      reject(new Error("Timeout aguardando evento SSE."));
    }, 2000);

    request.on("response", (response: IncomingMessage) => {
      resolveReady?.();

      response.on("data", (chunk) => {
        const text = chunk.toString();
        const match = text.match(/data: (.+)/);

        if (!match) {
          return;
        }

        clearTimeout(timeout);
        resolve(JSON.parse(match[1]));
      });

      response.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    request.on("error", (error) => {
      rejectReady?.(error);
      clearTimeout(timeout);
      reject(error);
    });
  });

  return {
    ready,
    eventPromise,
    close: () => request.destroy()
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
