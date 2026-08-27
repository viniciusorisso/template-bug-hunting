import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runRuntimeSimulation, runTypecheck, validateExecutionSourceSize } from "./execution.js";
import {
  appendAttempt,
  calculateServerDiff,
  hashSource,
  getChallengeById,
  InMemoryAdminStore,
  InMemoryRoomStore,
  InMemorySessionStore,
  listPublicChallenges,
  projectResolvedSource,
  selectNextHint,
  toPublicChallenge,
  validateSubmission,
  type AdminAuthRequest,
  type AdminCredentials,
  type AdminStatusResponse,
  type AdminStoreSnapshot,
  type ChallengeStateResponse,
  type CodeRange,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type HintLevel,
  type HintState,
  type JoinRoomResponse,
  type RequestHintPayload,
  type ResolvedBugEvent,
  type RoomActivityEvent,
  type RoomActivityResponse,
  type RoomExecutionSettingsResponse,
  type RoomExecutionSettingsEvent,
  type RoomRunRequest,
  type RoomRunResponse,
  type RoomStoreSnapshot,
  type RoomTypecheckRequest,
  type RoomTypecheckResponse,
  type SessionProgress,
  type SubmitBugEditorRequest,
  type SubmitBugRequest,
  type UpdateRoomExecutionSettingsRequest
} from "@ts-bug-hunt/core";

type StreamClient = {
  challengeId?: string;
  roomCode?: string;
  response: http.ServerResponse;
};

type ChallengeStateScope = {
  challengeId: string;
  roomCode?: string;
};

type PersistedApiState = {
  version: 2;
  admin?: AdminStoreSnapshot;
  rooms: RoomStoreSnapshot;
  sessions: SessionProgress[];
  challengeResolvedBugOrder: Record<string, string[]>;
  hintStates: HintState[];
};

type CreateServerOptions = {
  store?: InMemorySessionStore;
  adminStore?: InMemoryAdminStore;
  roomStore?: InMemoryRoomStore;
  stateFilePath?: string;
  now?: () => number;
};

const ADMIN_TOKEN = "admin-session-token";
const ADMIN_USERNAME_ENV = "TS_BUG_HUNT_ADMIN_USERNAME";
const ADMIN_PASSWORD_ENV = "TS_BUG_HUNT_ADMIN_PASSWORD";
const ADMIN_PASSWORD_HASH_ENV = "TS_BUG_HUNT_ADMIN_PASSWORD_HASH";
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_LOGIN_WINDOW_MS = 5 * 60 * 1000;
const ADMIN_LOGIN_BLOCK_MS = 5 * 60 * 1000;

type AdminLoginAttemptState = {
  attempts: number[];
  blockedUntil?: number;
};

export function createServer(options: CreateServerOptions = {}): http.Server {
  const persistedState = options.stateFilePath ? loadPersistedState(options.stateFilePath) : null;
  const store = options.store ?? new InMemorySessionStore(persistedState?.sessions ?? []);
  const adminStore = options.adminStore ?? new InMemoryAdminStore(resolveAdminCredentials());
  const roomStore = options.roomStore ?? new InMemoryRoomStore(persistedState?.rooms ?? {});
  const now = options.now ?? Date.now;
  const streamClients = new Set<StreamClient>();
  const adminLoginAttempts = new Map<string, AdminLoginAttemptState>();
  const challengeResolvedBugOrder = new Map<string, string[]>(
    Object.entries(persistedState?.challengeResolvedBugOrder ?? {})
  );
  const hintStates = new Map<string, HintState>(
    (persistedState?.hintStates ?? []).map((state) => [getHintStateKey(state.sessionId, state.challengeId, state.roomCode), state])
  );
  const persistState = createStatePersister(
    options.stateFilePath,
    store,
    adminStore,
    roomStore,
    challengeResolvedBugOrder,
    hintStates
  );

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
        configured: adminStore.isConfigured(),
        username: adminStore.getUsername()
      };

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }

    if (request.method === "POST" && request.url === "/api/admin/login") {
      if (!adminStore.isConfigured()) {
        return sendJson(response, 503, { message: "Credenciais admin nao configuradas no servidor." });
      }

      const clientKey = getClientAddress(request);
      const retryAfterSeconds = getRemainingAdminLoginBlockSeconds(adminLoginAttempts, clientKey, now());

      if (retryAfterSeconds > 0) {
        return sendRateLimitedAuthResponse(response, retryAfterSeconds);
      }

      const payload = await readJson<AdminAuthRequest>(request);

      if (!payload?.username?.trim() || !payload.password?.trim()) {
        return sendJson(response, 400, { message: "username e password sao obrigatorios." });
      }

      if (!adminStore.authenticate(payload.username.trim(), hashSecret(payload.password.trim()))) {
        const nextRetryAfterSeconds = registerFailedAdminLoginAttempt(adminLoginAttempts, clientKey, now());

        if (nextRetryAfterSeconds > 0) {
          return sendRateLimitedAuthResponse(response, nextRetryAfterSeconds);
        }

        return sendJson(response, 401, { message: "Credenciais invalidas." });
      }

      adminLoginAttempts.delete(clientKey);
      return sendJson(response, 200, { token: ADMIN_TOKEN, username: payload.username.trim() });
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

      const challenge = getChallengeById(payload.challengeId?.trim() ?? "");

      if (!challenge) {
        return sendJson(response, 400, { message: "challengeId invalido." });
      }

      const room = roomStore.createRoom({
        id: randomUUID(),
        name: payload.name.trim(),
        passwordHash: hashSecret(payload.password.trim()),
        roomCode: createRoomCode(roomStore),
        challengeId: challenge.id,
        createdAt: new Date().toISOString()
      });

      persistState();
      return sendJson(response, 201, roomStore.getRoomSummary(room.roomCode));
    }

    if (request.method === "PATCH" && request.url?.startsWith("/api/admin/rooms/") && request.url.endsWith("/execution-settings")) {
      if (!isAuthorized(request)) {
        return sendJson(response, 401, { message: "Nao autorizado." });
      }

      const roomCode = decodeURIComponent(request.url.slice("/api/admin/rooms/".length, -"/execution-settings".length)).trim().toUpperCase();
      const payload = await readJson<UpdateRoomExecutionSettingsRequest>(request);

      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { message: "Payload JSON invalido." });
      }

      if (payload.allowTypecheck === undefined && payload.allowRuntimeExecution === undefined) {
        return sendJson(response, 400, { message: "Nenhuma configuracao de execucao foi informada." });
      }

      if (payload.allowTypecheck !== undefined && typeof payload.allowTypecheck !== "boolean") {
        return sendJson(response, 400, { message: "allowTypecheck deve ser boolean." });
      }

      if (payload.allowRuntimeExecution !== undefined && typeof payload.allowRuntimeExecution !== "boolean") {
        return sendJson(response, 400, { message: "allowRuntimeExecution deve ser boolean." });
      }

      const room = roomStore.updateExecutionSettings(roomCode, payload);

      if (!room) {
        return sendJson(response, 404, { message: "Sala nao encontrada." });
      }

      persistState();

      const roomSettingsResponse: RoomExecutionSettingsResponse = {
        roomCode: room.roomCode,
        challengeId: room.challengeId,
        executionSettings: normalizeRoomExecutionSettings(room.executionSettings)
      };

      const roomSettingsEvent: RoomExecutionSettingsEvent = {
        type: "room.execution-settings",
        ...roomSettingsResponse
      };
      broadcastRoomExecutionSettings(streamClients, roomSettingsEvent);

      return sendJson(response, 200, roomSettingsResponse);
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

      persistState();
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

      const challenge = getChallengeById(room.challengeId);

      if (!challenge) {
        return sendJson(response, 500, { message: "Challenge configurado na sala nao foi encontrado." });
      }

      const joinResponse: JoinRoomResponse = {
        participantSessionId: participant.id,
        roomCode: participant.roomCode,
        roomName: room.name,
        displayName: participant.displayName,
        challengeId: challenge.id,
        challengeTitle: challenge.title,
        executionSettings: normalizeRoomExecutionSettings(room.executionSettings)
      };

      persistState();
      return sendJson(response, 200, joinResponse);
    }

    if (request.method === "POST" && request.url?.startsWith("/api/rooms/") && request.url.endsWith("/typecheck")) {
      const roomCode = decodeURIComponent(request.url.slice("/api/rooms/".length, -"/typecheck".length)).trim().toUpperCase();
      const payload = await readJson<RoomTypecheckRequest>(request);
      const executionError = validateRoomExecutionRequest(payload, roomCode, roomStore, "typecheck");

      if (executionError) {
        return sendJson(response, executionError.status, { message: executionError.message });
      }

      const sizeError = validateExecutionSourceSize(payload.source);

      if (sizeError) {
        return sendJson(response, 413, { message: sizeError });
      }

      const result: RoomTypecheckResponse = runTypecheck(payload.source);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && request.url?.startsWith("/api/rooms/") && request.url.endsWith("/run")) {
      const roomCode = decodeURIComponent(request.url.slice("/api/rooms/".length, -"/run".length)).trim().toUpperCase();
      const payload = await readJson<RoomRunRequest>(request);
      const executionError = validateRoomExecutionRequest(payload, roomCode, roomStore, "run");

      if (executionError) {
        return sendJson(response, executionError.status, { message: executionError.message });
      }

      const sizeError = validateExecutionSourceSize(payload.source);

      if (sizeError) {
        return sendJson(response, 413, { message: sizeError });
      }

      const result: RoomRunResponse = await runRuntimeSimulation(payload.challengeId, payload.source);
      return sendJson(response, 200, result);
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
      const url = new URL(request.url, "http://localhost");
      const challengeId = decodeURIComponent(url.pathname.replace("/api/challenge-state/", "")).trim();
      const roomCode = normalizeRoomCode(url.searchParams.get("roomCode") ?? undefined);
      const challenge = getChallengeById(challengeId);

      if (!challenge) {
        return sendJson(response, 404, { message: "Challenge nao encontrado." });
      }

      if (roomCode) {
        const room = roomStore.getRoom(roomCode);

        if (!room || room.status !== "active") {
          return sendJson(response, 404, { message: "Sala nao encontrada ou inativa." });
        }

        if (room.challengeId !== challengeId) {
          return sendJson(response, 400, { message: "challengeId nao corresponde a sala informada." });
        }
      }

      return sendJson(response, 200, buildChallengeStateResponse({ challengeId: challenge.id, roomCode }, challengeResolvedBugOrder));
    }

    if (request.method === "GET" && request.url === "/api/challenges") {
      return sendJson(response, 200, listPublicChallenges());
    }

    if (request.method === "GET" && request.url?.startsWith("/api/challenges/")) {
      const challengeId = request.url.replace("/api/challenges/", "");
      const challenge = getChallengeById(challengeId);

      if (!challenge) {
        return sendJson(response, 404, { message: "Challenge nao encontrado." });
      }

      return sendJson(response, 200, toPublicChallenge(challenge));
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

      const existing = store.get(sessionId, challengeId);
      const progress = store.getOrCreate(sessionId, challengeId);

      if (!existing) {
        persistState();
      }

      return sendJson(response, 200, progress);
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
      persistState();
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "POST" && request.url === "/api/hints/request") {
      const payload = await readJson<RequestHintPayload>(request);
      const error = validateHintRequest(payload, roomStore);

      if (error) {
        return sendJson(response, 400, { message: error });
      }

      const normalizedRoomCode = normalizeRoomCode(payload.roomCode);
      const challenge = getChallengeById(payload.challengeId.trim());

      if (!challenge) {
        return sendJson(response, 404, { message: "Challenge nao encontrado." });
      }

      const hintState = getOrCreateHintState(hintStates, payload.sessionId.trim(), challenge.id, normalizedRoomCode);
      const resolvedBugIds = getResolvedBugOrder(challengeResolvedBugOrder, challenge.id, normalizedRoomCode);
      const hint = selectNextHint(challenge, resolvedBugIds, hintState.consumedHintsByBug, normalizedRoomCode);

      if (!hint) {
        return sendJson(response, 409, { message: "Nenhuma dica disponivel no momento." });
      }

      hintStates.set(
        getHintStateKey(hintState.sessionId, hintState.challengeId, hintState.roomCode),
        appendConsumedHint(hintState, hint.bugId, hint.hintLevel)
      );
      persistState();
      return sendJson(response, 200, hint);
    }

    if (request.method === "POST" && request.url === "/api/submissions") {
      const payload = await readJson<SubmitBugRequest | SubmitBugEditorRequest>(request);

      if (!payload) {
        return sendJson(response, 400, { message: "Payload JSON invalido." });
      }

      const editorPayload = isEditorSubmission(payload) ? payload : null;
      const normalizedRoomCode = normalizeRoomCode(payload.roomCode);
      const challengeForSubmission = getChallengeById(payload.challengeId?.trim() ?? "");
      if (editorPayload) {
        if (!editorPayload.file || typeof editorPayload.file.path !== "string" || typeof editorPayload.file.language !== "string" || typeof editorPayload.file.sourceVersion !== "string" || typeof editorPayload.file.originalText !== "string" || typeof editorPayload.file.editedText !== "string" || !editorPayload.clientChanges || typeof editorPayload.clientChanges !== "object" || !Array.isArray(editorPayload.clientChanges.operations)) {
          return sendJson(response, 400, { message: "Payload de editor invalido." });
        }
        if (!challengeForSubmission) return sendJson(response, 404, { message: "Challenge nao encontrado." });
        const canonical = buildChallengeStateResponse(
          { challengeId: challengeForSubmission.id, roomCode: normalizedRoomCode },
          challengeResolvedBugOrder
        ).displayedSource;
        if (!editorPayload.file.path.endsWith(".ts") || editorPayload.file.language !== "typescript" || editorPayload.file.originalText !== canonical || editorPayload.file.sourceVersion !== hashSource(canonical)) {
          return sendJson(response, 409, { message: "A versao do arquivo esta desatualizada ou inconsistente.", conflict: true });
        }
        if (editorPayload.file.editedText === canonical) return sendJson(response, 400, { message: "Nenhuma alteracao foi realizada." });
        if (editorPayload.file.editedText.length > 100_000) return sendJson(response, 413, { message: "Arquivo excede o limite permitido." });
      }
      const submissionPayload: SubmitBugRequest = editorPayload ? { ...editorPayload, proposedFix: editorPayload.file.editedText } as SubmitBugRequest : payload as SubmitBugRequest;
      const error = validateRequest(submissionPayload, roomStore);

      if (error) {
        return sendJson(response, 400, { message: error });
      }

      const currentProgress = store.getOrCreate(submissionPayload.sessionId, submissionPayload.challengeId);
      const baseResult = validateSubmission(submissionPayload, currentProgress);
      const serverDiff = editorPayload ? calculateServerDiff(editorPayload.file.originalText, editorPayload.file.editedText) : undefined;
      syncChallengeResolvedBugOrder(
        challengeResolvedBugOrder,
        { challengeId: payload.challengeId, roomCode: normalizedRoomCode },
        baseResult.bugId,
        baseResult.status
      );
      const challengeState = buildChallengeStateResponse(
        { challengeId: payload.challengeId, roomCode: normalizedRoomCode },
        challengeResolvedBugOrder
      );
      const enrichedResult = {
        ...baseResult,
        resolvedBugDiff: baseResult.bugId ? challengeState.resolvedBugDiffs[baseResult.bugId] : undefined,
        serverDiff
      };
      const nextProgress = appendAttempt(currentProgress, { ...submissionPayload, originalText: editorPayload?.file.originalText, editedText: editorPayload?.file.editedText, serverDiff }, enrichedResult);
      store.save(nextProgress);

      if (normalizedRoomCode && payload.participantName) {
        const activity = roomStore.recordActivity({
          roomCode: normalizedRoomCode,
          challengeId: payload.challengeId,
          bugId: enrichedResult.bugId,
          status: enrichedResult.status,
          submittedBy: payload.participantName,
          submittedAt: new Date().toISOString(),
          submittedCode: editorPayload?.file.editedText ?? submissionPayload.proposedFix,
          submittedOriginalCode: editorPayload?.file.originalText,
          submittedServerDiff: serverDiff,
          submittedSelection: submissionPayload.selection
        });

        const { submittedCode: _submittedCode, submittedOriginalCode: _submittedOriginalCode, submittedServerDiff: _submittedServerDiff, submittedSelection: _submittedSelection, ...activitySummary } = activity;
        broadcastRoomActivity(streamClients, {
          type: "room.activity",
          roomCode: normalizedRoomCode,
          item: activitySummary
        });
      }

      persistState();

      if (enrichedResult.status === "solved") {
        const event = buildResolvedBugEvent(submissionPayload, enrichedResult, challengeState);

        if (event) {
          broadcastResolvedBug(streamClients, event, normalizedRoomCode);
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
  const stateFilePath = process.env.TS_BUG_HUNT_STATE_FILE?.trim() || path.resolve(process.cwd(), ".data/ts-bug-hunt-state.json");
  const server = createServer({ stateFilePath });

  server.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
    console.log(`State persistence file: ${stateFilePath}`);
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

function validateHintRequest(payload: RequestHintPayload | null, roomStore: InMemoryRoomStore): string | null {
  if (!payload || typeof payload !== "object") {
    return "Payload JSON invalido.";
  }

  if (!payload.challengeId?.trim()) {
    return "challengeId e obrigatorio.";
  }

  if (!payload.sessionId?.trim()) {
    return "sessionId e obrigatorio.";
  }

  if (payload.roomCode) {
    const room = roomStore.getRoom(payload.roomCode.trim().toUpperCase());

    if (!room || room.status !== "active") {
      return "roomCode invalido.";
    }

    if (room.challengeId !== payload.challengeId.trim()) {
      return "challengeId nao corresponde a sala informada.";
    }
  }

  return null;
}

function isEditorSubmission(payload: SubmitBugRequest | SubmitBugEditorRequest): payload is SubmitBugEditorRequest {
  return typeof payload === "object" && payload !== null && ("file" in payload || "clientChanges" in payload);
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

    if (room.challengeId !== payload.challengeId) {
      return "challengeId nao corresponde a sala informada.";
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
    shortDescription: bug.technicalBasis
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

function broadcastRoomExecutionSettings(clients: Set<StreamClient>, event: RoomExecutionSettingsEvent): void {
  const payload = `event: room.execution-settings\ndata: ${JSON.stringify(event)}\n\n`;

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
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendRateLimitedAuthResponse(response: http.ServerResponse, retryAfterSeconds: number): void {
  response.writeHead(429, {
    "Content-Type": "application/json",
    "Retry-After": String(retryAfterSeconds)
  });
  response.end(
    JSON.stringify({
      message: `Muitas tentativas de login. Aguarde ${retryAfterSeconds}s antes de tentar novamente.`
    })
  );
}

function normalizeRoomCode(roomCode: string | null | undefined): string | undefined {
  const normalized = roomCode?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function normalizeRoomExecutionSettings(settings: { allowTypecheck?: boolean; allowRuntimeExecution?: boolean } | undefined) {
  return {
    allowTypecheck: settings?.allowTypecheck ?? false,
    allowRuntimeExecution: settings?.allowRuntimeExecution ?? false
  };
}

function validateRoomExecutionRequest(
  payload: RoomTypecheckRequest | RoomRunRequest | null,
  roomCode: string,
  roomStore: InMemoryRoomStore,
  mode: "typecheck" | "run"
): { status: number; message: string } | null {
  if (!payload || typeof payload !== "object") {
    return { status: 400, message: "Payload JSON invalido." };
  }

  if (!payload.participantSessionId?.trim()) {
    return { status: 400, message: "participantSessionId e obrigatorio." };
  }

  if (!payload.challengeId?.trim()) {
    return { status: 400, message: "challengeId e obrigatorio." };
  }

  if (!payload.source?.trim()) {
    return { status: 400, message: "source e obrigatorio." };
  }

  const room = roomStore.getRoom(roomCode);

  if (!room || room.status !== "active") {
    return { status: 404, message: "Sala nao encontrada ou inativa." };
  }

  if (room.challengeId !== payload.challengeId.trim()) {
    return { status: 400, message: "challengeId nao corresponde a sala informada." };
  }

  const participant = roomStore.getParticipant(payload.participantSessionId.trim());

  if (!participant || participant.roomCode !== roomCode) {
    return { status: 404, message: "Participante nao encontrado na sala informada." };
  }

  const settings = normalizeRoomExecutionSettings(room.executionSettings);

  if (mode === "typecheck" && !settings.allowTypecheck) {
    return { status: 403, message: "Typecheck nao habilitado para esta sala." };
  }

  if (mode === "run" && !settings.allowRuntimeExecution) {
    return { status: 403, message: "Execucao nao habilitada para esta sala." };
  }

  return null;
}

function getChallengeStateKey(challengeId: string, roomCode?: string): string {
  return roomCode ? `room:${roomCode}:${challengeId}` : `global:${challengeId}`;
}

function getResolvedBugOrder(
  state: Map<string, string[]>,
  challengeId: string,
  roomCode?: string
): string[] {
  const scopedKey = getChallengeStateKey(challengeId, roomCode);
  const scoped = state.get(scopedKey);

  if (scoped) {
    return scoped;
  }

  if (roomCode) {
    return [];
  }

  return state.get(`global:${challengeId}`) ?? state.get(challengeId) ?? [];
}

function isAuthorized(request: http.IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

function getClientAddress(request: http.IncomingMessage): string {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(",")[0]?.trim() || "unknown";
  }

  return request.socket.remoteAddress?.trim() || "unknown";
}

function getRemainingAdminLoginBlockSeconds(
  attemptsByClient: Map<string, AdminLoginAttemptState>,
  clientKey: string,
  currentTime: number
): number {
  const state = attemptsByClient.get(clientKey);

  if (!state) {
    return 0;
  }

  state.attempts = state.attempts.filter((attemptTime) => currentTime - attemptTime <= ADMIN_LOGIN_WINDOW_MS);

  if (!state.blockedUntil || state.blockedUntil <= currentTime) {
    state.blockedUntil = undefined;

    if (state.attempts.length === 0) {
      attemptsByClient.delete(clientKey);
    } else {
      attemptsByClient.set(clientKey, state);
    }

    return 0;
  }

  attemptsByClient.set(clientKey, state);
  return Math.max(1, Math.ceil((state.blockedUntil - currentTime) / 1000));
}

function registerFailedAdminLoginAttempt(
  attemptsByClient: Map<string, AdminLoginAttemptState>,
  clientKey: string,
  currentTime: number
): number {
  const state = attemptsByClient.get(clientKey) ?? { attempts: [] };
  state.attempts = state.attempts.filter((attemptTime) => currentTime - attemptTime <= ADMIN_LOGIN_WINDOW_MS);
  state.attempts.push(currentTime);

  if (state.attempts.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    state.attempts = [];
    state.blockedUntil = currentTime + ADMIN_LOGIN_BLOCK_MS;
  }

  attemptsByClient.set(clientKey, state);
  return state.blockedUntil ? Math.max(1, Math.ceil((state.blockedUntil - currentTime) / 1000)) : 0;
}

function getHintStateKey(sessionId: string, challengeId: string, roomCode?: string): string {
  return roomCode ? `${sessionId}:${roomCode}:${challengeId}` : `${sessionId}:global:${challengeId}`;
}

function getOrCreateHintState(
  state: Map<string, HintState>,
  sessionId: string,
  challengeId: string,
  roomCode?: string
): HintState {
  const key = getHintStateKey(sessionId, challengeId, roomCode);
  const existing = state.get(key);

  if (existing) {
    return existing;
  }

  const next: HintState = {
    sessionId,
    challengeId,
    roomCode,
    consumedHintsByBug: {}
  };
  state.set(key, next);
  return next;
}

function appendConsumedHint(state: HintState, bugId: string, hintLevel: HintLevel): HintState {
  const current = new Set(state.consumedHintsByBug[bugId] ?? []);
  current.add(hintLevel);

  return {
    ...state,
    consumedHintsByBug: {
      ...state.consumedHintsByBug,
      [bugId]: [...current].sort((left, right) => left - right) as HintLevel[]
    }
  };
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
  scope: ChallengeStateScope,
  bugId: string | undefined,
  status: string
): string[] {
  const key = getChallengeStateKey(scope.challengeId, scope.roomCode);
  const current = getResolvedBugOrder(state, scope.challengeId, scope.roomCode);

  if (status !== "solved" || !bugId) {
    return current;
  }

  if (current.includes(bugId)) {
    return current;
  }

  const next = [...current, bugId];
  state.set(key, next);
  return next;
}

function buildChallengeStateResponse(
  scope: ChallengeStateScope,
  state: Map<string, string[]>
): ChallengeStateResponse {
  const challenge = getChallengeById(scope.challengeId);

  if (!challenge) {
    throw new Error(`Challenge ${scope.challengeId} nao encontrado.`);
  }

  const resolvedBugOrder = getResolvedBugOrder(state, scope.challengeId, scope.roomCode);
  const projection = projectResolvedSource(challenge, resolvedBugOrder);
  const resolvedBugTechnicalBases: Record<string, string> = {};

  for (const bugId of resolvedBugOrder) {
    const bug = challenge.bugs.find((candidate) => candidate.id === bugId);

    if (bug) {
      resolvedBugTechnicalBases[bugId] = bug.technicalBasis;
    }
  }

  return {
    challengeId: scope.challengeId,
    baseSource: challenge.source,
    resolvedBugOrder,
    resolvedBugDiffs: projection.resolvedBugDiffs,
    resolvedBugTechnicalBases,
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

function resolveAdminCredentials(): AdminCredentials | null {
  const username = process.env[ADMIN_USERNAME_ENV]?.trim();
  const passwordHash = process.env[ADMIN_PASSWORD_HASH_ENV]?.trim();
  const password = process.env[ADMIN_PASSWORD_ENV]?.trim();

  if (!username) {
    return null;
  }

  if (passwordHash) {
    return { username, passwordHash };
  }

  if (password) {
    return { username, passwordHash: hashSecret(password) };
  }

  return null;
}

function createStatePersister(
  stateFilePath: string | undefined,
  store: InMemorySessionStore,
  _adminStore: InMemoryAdminStore,
  roomStore: InMemoryRoomStore,
  challengeResolvedBugOrder: Map<string, string[]>,
  hintStates: Map<string, HintState>
): () => void {
  if (!stateFilePath) {
    return () => {};
  }

  return () => {
    const payload: PersistedApiState = {
      version: 2,
      rooms: roomStore.snapshot(),
      sessions: store.list(),
      challengeResolvedBugOrder: Object.fromEntries(challengeResolvedBugOrder.entries()),
      hintStates: [...hintStates.values()]
    };

    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(stateFilePath, JSON.stringify(payload, null, 2), "utf8");
  };
}

function loadPersistedState(stateFilePath: string): PersistedApiState | null {
  if (!existsSync(stateFilePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as
      | (Partial<PersistedApiState> & { version?: number; hintStates?: HintState[] })
      | null;

    const parsedVersion = Number(parsed?.version ?? 0);

    if (!parsed || (parsedVersion !== 1 && parsedVersion !== 2)) {
      return null;
    }

    return {
      version: 2,
      rooms: {
        rooms: parsed.rooms?.rooms ?? [],
        participants: parsed.rooms?.participants ?? [],
        activity: parsed.rooms?.activity ?? {}
      },
      sessions: parsed.sessions ?? [],
      challengeResolvedBugOrder: parsed.challengeResolvedBugOrder ?? {},
      hintStates: parsedVersion === 2 ? parsed.hintStates ?? [] : []
    };
  } catch (error) {
    console.warn(
      `Nao foi possivel carregar o estado persistido em ${stateFilePath}. Um novo estado em memoria sera criado.`,
      error
    );
    return null;
  }
}
