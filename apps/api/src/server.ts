import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  appendAttempt,
  getChallengeById,
  InMemoryAdminStore,
  InMemoryRoomStore,
  InMemorySessionStore,
  listChallenges,
  projectResolvedSource,
  validateSubmission,
  type AdminAuthRequest,
  type ChallengeStateResponse,
  type AdminStatusResponse,
  type CodeRange,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type JoinRoomResponse,
  type ResolvedBugEvent,
  type RoomActivityEvent,
  type RoomActivityResponse,
  type SubmitBugRequest
} from "@ts-bug-hunt/core";

type StreamClient = {
  challengeId?: string;
  roomCode?: string;
  response: http.ServerResponse;
};


const ADMIN_TOKEN = "admin-session-token";
const DEFAULT_CHALLENGE_ID = "checkout-ts-bug-hunt";

export function createServer(
  store = new InMemorySessionStore(),
  adminStore = new InMemoryAdminStore(),
  roomStore = new InMemoryRoomStore()
): http.Server {
  const streamClients = new Set<StreamClient>();
  const challengeResolvedBugOrder = new Map<string, string[]>();

  return http.createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/events")) {
      const url = new URL(request.url, "http://localhost");
      const challengeId = url.searchParams.get("challengeId")?.trim() || undefined;
      const roomCode = url.searchParams.get("roomCode")?.trim().toUpperCase() || undefined;
      registerStreamClient(streamClients, request, response, { challengeId, roomCode });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/rooms/") && request.url.endsWith("/events")) {
      const roomCode = decodeURIComponent(request.url.slice("/api/rooms/".length, -"/events".length)).trim().toUpperCase();
      const room = roomStore.getRoom(roomCode);

      if (!room || room.status !== "active") {
        return sendJson(response, 404, { message: "Sala nao encontrada ou inativa." });
      }

      registerStreamClient(streamClients, request, response, { roomCode });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/admin/rooms/") && request.url.endsWith("/events")) {
      if (!isAuthorized(request)) {
        return sendJson(response, 401, { message: "Nao autorizado." });
      }

      const roomCode = decodeURIComponent(request.url.slice("/api/admin/rooms/".length, -"/events".length)).trim().toUpperCase();
      const room = roomStore.getRoom(roomCode);

      if (!room) {
        return sendJson(response, 404, { message: "Sala nao encontrada." });
      }

      registerStreamClient(streamClients, request, response, { roomCode });
      return;
    }

    if (request.method === "GET" && request.url === "/api/admin/status") {
      const payload: AdminStatusResponse = {
        requiresBootstrap: !adminStore.isConfigured()
      };

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }

    if (request.method === "POST" && request.url === "/api/admin/bootstrap") {
      const payload = await readJson<AdminAuthRequest>(request);

      if (!payload?.password?.trim()) {
        return sendJson(response, 400, { message: "password e obrigatoria." });
      }

      const configured = adminStore.configure(hashSecret(payload.password.trim()));

      if (!configured) {
        return sendJson(response, 409, { message: "Bootstrap do admin ja foi concluido." });
      }

      return sendJson(response, 200, { token: ADMIN_TOKEN, username: "admin" });
    }

    if (request.method === "POST" && request.url === "/api/admin/login") {
      const payload = await readJson<AdminAuthRequest>(request);

      if (payload?.username !== "admin" || !payload.password?.trim()) {
        return sendJson(response, 400, { message: "username e password sao obrigatorios." });
      }

      if (!adminStore.authenticate(hashSecret(payload.password.trim()))) {
        return sendJson(response, 401, { message: "Credenciais invalidas." });
      }

      return sendJson(response, 200, { token: ADMIN_TOKEN, username: "admin" });
    }

    if (request.method === "GET" && request.url === "/api/admin/rooms") {
      if (!isAuthorized(request)) {
        return sendJson(response, 401, { message: "Nao autorizado." });
      }

      return sendJson(response, 200, roomStore.listRooms());
    }

    if (request.method === "POST" && request.url === "/api/admin/rooms") {
      if (!isAuthorized(request)) {
        return sendJson(response, 401, { message: "Nao autorizado." });
      }

      const payload = await readJson<CreateRoomRequest>(request);

      if (!payload?.name?.trim()) {
        return sendJson(response, 400, { message: "name e obrigatorio." });
      }

      if (!payload.password?.trim()) {
        return sendJson(response, 400, { message: "password e obrigatoria." });
      }

      const room = roomStore.createRoom({
        id: randomUUID(),
        name: payload.name.trim(),
        passwordHash: hashSecret(payload.password.trim()),
        roomCode: createRoomCode(roomStore),
        createdAt: new Date().toISOString()
      });

      return sendJson(response, 201, roomStore.getRoomSummary(room.roomCode));
    }

    if (request.method === "DELETE" && request.url?.startsWith("/api/admin/rooms/")) {
      if (!isAuthorized(request)) {
        return sendJson(response, 401, { message: "Nao autorizado." });
      }

      const roomCode = decodeURIComponent(request.url.replace("/api/admin/rooms/", "")).trim().toUpperCase();
      const deleted = roomStore.deleteRoom(roomCode, new Date().toISOString());

      if (!deleted) {
        return sendJson(response, 404, { message: "Sala nao encontrada." });
      }

      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "POST" && request.url === "/api/rooms/join") {
      const payload = await readJson<JoinRoomRequest>(request);

      if (!payload?.roomCode?.trim()) {
        return sendJson(response, 400, { message: "roomCode e obrigatorio." });
      }

      const displayName = payload.displayName?.trim();

      if (!displayName) {
        return sendJson(response, 400, { message: "displayName e obrigatorio." });
      }

      if (displayName.length < 2 || displayName.length > 40) {
        return sendJson(response, 400, { message: "displayName deve ter entre 2 e 40 caracteres." });
      }

      const normalizedRoomCode = payload.roomCode.trim().toUpperCase();
      const room = roomStore.getRoomSummary(normalizedRoomCode);

      if (!room || room.status !== "active") {
        return sendJson(response, 404, { message: "Sala nao encontrada ou inativa." });
      }

      const participant = roomStore.joinRoom(normalizedRoomCode, {
        id: randomUUID(),
        roomCode: normalizedRoomCode,
        displayName,
        joinedAt: new Date().toISOString()
      });

      if (!participant) {
        return sendJson(response, 404, { message: "Sala nao encontrada ou inativa." });
      }

      const joinResponse: JoinRoomResponse = {
        participantSessionId: participant.id,
        roomCode: participant.roomCode,
        roomName: room.name,
        displayName: participant.displayName,
        challengeId: DEFAULT_CHALLENGE_ID
      };

      return sendJson(response, 200, joinResponse);
    }

    if (request.method === "GET" && request.url?.startsWith("/api/admin/rooms/") && request.url.endsWith("/activity")) {
      if (!isAuthorized(request)) {
        return sendJson(response, 401, { message: "Nao autorizado." });
      }

      const roomCode = decodeURIComponent(request.url.slice("/api/admin/rooms/".length, -"/activity".length))
        .trim()
        .toUpperCase();
      const room = roomStore.getRoomSummary(roomCode);

      if (!room) {
        return sendJson(response, 404, { message: "Sala nao encontrada." });
      }

      const payload: RoomActivityResponse = {
        roomCode,
        items: roomStore.listActivity(roomCode)
      };

      return sendJson(response, 200, payload);
    }

    if (request.method === "GET" && request.url?.startsWith("/api/challenge-state/")) {
      const challengeId = decodeURIComponent(request.url.replace("/api/challenge-state/", ""));
      const challenge = getChallengeById(challengeId);

      if (!challenge) {
        return sendJson(response, 404, { message: "Challenge nao encontrado." });
      }

      return sendJson(response, 200, buildChallengeStateResponse(challenge.id, challengeResolvedBugOrder));
    }

    if (request.method === "GET" && request.url === "/api/challenges") {
      return sendJson(response, 200, listChallenges());
    }

    if (request.method === "GET" && request.url?.startsWith("/api/challenges/")) {
      const challengeId = request.url.replace("/api/challenges/", "");
      const challenge = getChallengeById(challengeId);

      if (!challenge) {
        return sendJson(response, 404, { message: "Challenge nao encontrado." });
      }

      return sendJson(response, 200, challenge);
    }

    if (request.method === "GET" && request.url?.startsWith("/api/session-progress/")) {
      const prefix = "/api/session-progress/";
      const requestPath = request.url.slice(prefix.length);
      const segments = requestPath.split("/");
      const sessionId = decodeURIComponent(segments.shift() ?? "");
      const challengeId = decodeURIComponent(segments.join("/"));

      if (!sessionId || !challengeId) {
        return sendJson(response, 400, { message: "sessionId e challengeId sao obrigatorios." });
      }

      return sendJson(response, 200, store.getOrCreate(sessionId, challengeId));
    }

    if (request.method === "DELETE" && request.url?.startsWith("/api/session-progress/")) {
      const prefix = "/api/session-progress/";
      const requestPath = request.url.slice(prefix.length);
      const segments = requestPath.split("/");
      const sessionId = decodeURIComponent(segments.shift() ?? "");
      const challengeId = decodeURIComponent(segments.join("/"));

      if (!sessionId || !challengeId) {
        return sendJson(response, 400, { message: "sessionId e challengeId sao obrigatorios." });
      }

      store.delete(sessionId, challengeId);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "POST" && request.url === "/api/submissions") {
      const payload = await readJson<SubmitBugRequest>(request);

      if (!payload) {
        return sendJson(response, 400, { message: "Payload JSON invalido." });
      }

      const error = validateRequest(payload, roomStore);

      if (error) {
        return sendJson(response, 400, { message: error });
      }

      const currentProgress = store.getOrCreate(payload.sessionId, payload.challengeId);
      const baseResult = validateSubmission(payload, currentProgress);
      const resolvedBugOrder = syncChallengeResolvedBugOrder(challengeResolvedBugOrder, payload.challengeId, baseResult.bugId, baseResult.status);
      const challengeState = buildChallengeStateResponse(payload.challengeId, challengeResolvedBugOrder);
      const enrichedResult = {
        ...baseResult,
        resolvedBugDiff: baseResult.bugId ? challengeState.resolvedBugDiffs[baseResult.bugId] : undefined
      };
      const nextProgress = appendAttempt(currentProgress, payload, enrichedResult);
      store.save(nextProgress);

      if (payload.roomCode && payload.participantName) {
        const activity = roomStore.recordActivity({
          roomCode: payload.roomCode,
          challengeId: payload.challengeId,
          bugId: enrichedResult.bugId,
          status: enrichedResult.status,
          submittedBy: payload.participantName,
          submittedAt: new Date().toISOString(),
          proposedFix: payload.proposedFix
        });

        broadcastRoomActivity(streamClients, {
          type: "room.activity",
          roomCode: payload.roomCode,
          item: activity
        });
      }

      if (enrichedResult.status === "solved") {
        const event = buildResolvedBugEvent(payload, enrichedResult, challengeState);

        if (event) {
          broadcastResolvedBug(streamClients, event, payload.roomCode);
        }
      }

      return sendJson(response, 200, enrichedResult);
    }

    return sendJson(response, 404, { message: "Rota nao encontrada." });
  });
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const port = Number(process.env.PORT ?? 3001);
  const server = createServer();

  server.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

async function readJson<T>(request: http.IncomingMessage): Promise<T> {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return null as T;
  }
}

function validateRequest(payload: SubmitBugRequest | null, roomStore: InMemoryRoomStore): string | null {
  if (!payload || typeof payload !== "object") {
    return "Payload JSON invalido.";
  }

  if (!payload.challengeId?.trim()) {
    return "challengeId e obrigatorio.";
  }

  if (!payload.sessionId?.trim()) {
    return "sessionId e obrigatorio.";
  }

  if (!payload.proposedFix?.trim()) {
    return "proposedFix e obrigatorio.";
  }

  if (!isValidRange(payload.selection)) {
    return "selection invalido.";
  }

  if (payload.roomCode) {
    const room = roomStore.getRoom(payload.roomCode.trim().toUpperCase());

    if (!room || room.status !== "active") {
      return "roomCode invalido.";
    }

    if (!payload.participantName?.trim()) {
      return "participantName e obrigatorio quando roomCode for informado.";
    }
  }

  return null;
}

function buildResolvedBugEvent(
  payload: SubmitBugRequest,
  result: { bugId?: string },
  challengeState: ChallengeStateResponse
): ResolvedBugEvent | null {
  if (!result.bugId) {
    return null;
  }

  const challenge = getChallengeById(payload.challengeId);
  const bug = challenge?.bugs.find((candidate) => candidate.id === result.bugId);

  if (!challenge || !bug) {
    return null;
  }

  const diff = challengeState.resolvedBugDiffs[bug.id];

  if (!diff) {
    return null;
  }

  return {
    type: "bug.resolved",
    challengeId: challenge.id,
    sessionId: payload.sessionId,
    bugId: bug.id,
    title: bug.title,
    resolvedAt: new Date().toISOString(),
    diff,
    shortDescription: bug.expectedFix
  };
}

function broadcastResolvedBug(clients: Set<StreamClient>, event: ResolvedBugEvent, roomCode?: string): void {
  const payload = `event: bug.resolved\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    if (client.challengeId && client.challengeId !== event.challengeId) {
      continue;
    }

    if (client.roomCode && client.roomCode !== roomCode) {
      continue;
    }

    client.response.write(payload);
  }
}

function broadcastRoomActivity(clients: Set<StreamClient>, event: RoomActivityEvent): void {
  const payload = `event: room.activity\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    if (client.roomCode && client.roomCode !== event.roomCode) {
      continue;
    }

    client.response.write(payload);
  }
}

function isValidRange(range: CodeRange): boolean {
  return [range.startLine, range.startColumn, range.endLine, range.endColumn].every(
    (value) => Number.isInteger(value) && value > 0
  );
}

function setCorsHeaders(response: http.ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request: http.IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

function registerStreamClient(
  clients: Set<StreamClient>,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  scope: Pick<StreamClient, "challengeId" | "roomCode">
): void {
  const client: StreamClient = { ...scope, response };

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  response.write("retry: 1000\n\n");
  clients.add(client);

  request.on("close", () => {
    clients.delete(client);
  });
}

function syncChallengeResolvedBugOrder(
  state: Map<string, string[]>,
  challengeId: string,
  bugId: string | undefined,
  status: string
): string[] {
  const current = state.get(challengeId) ?? [];

  if (status !== "solved" || !bugId) {
    return current;
  }

  if (current.includes(bugId)) {
    return current;
  }

  const next = [...current, bugId];
  state.set(challengeId, next);
  return next;
}

function buildChallengeStateResponse(
  challengeId: string,
  state: Map<string, string[]>
): ChallengeStateResponse {
  const challenge = getChallengeById(challengeId);

  if (!challenge) {
    throw new Error(`Challenge ${challengeId} nao encontrado.`);
  }

  const resolvedBugOrder = state.get(challengeId) ?? [];
  const projection = projectResolvedSource(challenge, resolvedBugOrder);

  return {
    challengeId,
    baseSource: challenge.source,
    resolvedBugOrder,
    resolvedBugDiffs: projection.resolvedBugDiffs,
    displayedSource: projection.displayedSource
  };
}

function createRoomCode(roomStore: InMemoryRoomStore): string {
  for (;;) {
    const roomCode = randomUUID().slice(0, 6).toUpperCase();

    if (!roomStore.getRoom(roomCode)) {
      return roomCode;
    }
  }
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
