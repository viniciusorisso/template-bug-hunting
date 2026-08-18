import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
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
  assert.match(payload.displayedSource, /i < input\.items\.length/);
});

test("POST /api/submissions registra atividade de sala e GET /api/admin/rooms/:roomCode/activity expoe o feed", async () => {
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
  assert.match(payload.shortDescription, /Trocar <= por </);

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

  const challengeStateResponse = await fetch(`${persistentBaseUrl}/api/challenge-state/checkout-ts-bug-hunt`);
  const challengeStatePayload = await challengeStateResponse.json();
  assert.deepEqual(challengeStatePayload.resolvedBugOrder, ["B002"]);

  const activityResponse = await fetch(`${persistentBaseUrl}/api/admin/rooms/${createdRoom.roomCode}/activity`, {
    headers: {
      Authorization: `Bearer ${loginPayload.token}`
    }
  });
  const activityPayload = await activityResponse.json();
  assert.equal(activityPayload.items.length, 1);
  assert.equal(activityPayload.items[0].submittedBy, "Persist User");
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
