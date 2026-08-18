<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type {
  AdminAuthResponse,
  AdminStatusResponse,
  ChallengeDefinition,
  ChallengeStateResponse,
  CodeRange,
  JoinRoomResponse,
  ResolvedBugDiff,
  ResolvedBugEvent,
  RoomActivityEvent,
  RoomActivityItem,
  RoomActivityResponse,
  RoomSummary,
  SessionProgress,
  SubmitBugResponse
} from "@ts-bug-hunt/core";
import CodeViewer from "./components/CodeViewer.vue";
import SubmissionModal from "./components/SubmissionModal.vue";
import { BrowserBannerResolvedBugNotifier, type NotificationBanner } from "./lib/browserNotifier";
import { getOrCreateSessionId } from "./lib/session";

type ViewMode = "challenge" | "admin" | "join" | "observer";

type RouteState = {
  view: ViewMode;
  roomCode?: string;
  search: string;
};

const defaultApiBaseUrl = import.meta.env.DEV ? "http://localhost:3001" : "";
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl).replace(/\/$/, "");
const challengeId = "checkout-ts-bug-hunt";
const adminTokenStorageKey = "ts-bug-hunt.admin-token";

const route = ref<RouteState>(readRoute());

const challenge = ref<ChallengeDefinition | null>(null);
const loading = ref(true);
const submitting = ref(false);
const loadError = ref("");
const submissionError = ref("");
const feedback = ref<SubmitBugResponse | null>(null);
const challengeDisplayState = reactive({
  baseSource: "",
  displayedSource: "",
  resolvedBugOrder: [] as string[],
  resolvedBugDiffs: {} as Record<string, ResolvedBugDiff>
});

const sessionProgress = ref<SessionProgress | null>(null);
const selectedRange = ref<CodeRange | null>(null);
const selectedText = ref("");
const modalOpen = ref(false);
const notification = ref<NotificationBanner | null>(null);

const form = reactive({
  proposedFix: ""
});

const adminState = reactive({
  loading: false,
  error: "",
  requiresBootstrap: true,
  token: typeof window !== "undefined" ? window.localStorage.getItem(adminTokenStorageKey) ?? "" : "",
  password: "",
  roomName: "",
  roomPassword: "",
  rooms: [] as RoomSummary[]
});

const joinState = reactive({
  joining: false,
  error: "",
  roomCode: "",
  displayName: ""
});

const observerState = reactive({
  loading: false,
  error: "",
  activity: [] as RoomActivityItem[]
});

const progress = computed(() => {
  const solved = sessionProgress.value?.solvedBugIds.length ?? 0;
  const total = challenge.value?.bugs.length ?? 0;

  return { solved, total };
});

const recentAttempts = computed(() => [...(sessionProgress.value?.attempts ?? [])].reverse().slice(0, 5));

const displayedSource = computed(() => challengeDisplayState.displayedSource || challenge.value?.source || "");


const solvedBugs = computed(() => {
  if (!challenge.value || !sessionProgress.value) {
    return [];
  }

  const solvedIds = new Set(sessionProgress.value.solvedBugIds);
  return challenge.value.bugs.filter((bug) => solvedIds.has(bug.id));
});

const selectedRangeLabel = computed(() => {
  if (!selectedRange.value) {
    return "Nenhum trecho selecionado";
  }

  const { startLine, startColumn, endLine, endColumn } = selectedRange.value;
  return `L${startLine}:C${startColumn} ate L${endLine}:C${endColumn}`;
});

const roomContext = computed(() => {
  const params = new URLSearchParams(route.value.search);
  const roomCode = params.get("roomCode")?.trim().toUpperCase() ?? "";
  const participantId = params.get("participantId")?.trim() ?? params.get("participantSessionId")?.trim() ?? "";
  const participantName = params.get("participantName")?.trim() ?? "";
  const roomName = params.get("roomName")?.trim() ?? "";

  return {
    roomCode,
    roomName,
    participantId,
    participantName,
    sessionId: participantId || getOrCreateSessionId()
  };
});

const notifier = new BrowserBannerResolvedBugNotifier((banner) => {
  notification.value = banner;
});

let eventSource: EventSource | null = null;

onMounted(async () => {
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener("popstate", handlePopState);
  await initializeCurrentView();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener("popstate", handlePopState);
  closeEventSource();
});

function handlePopState(): void {
  route.value = readRoute();
  void initializeCurrentView();
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }

  if (modalOpen.value) {
    closeSubmissionModal();
    return;
  }

  clearSelection();
}

async function initializeCurrentView(): Promise<void> {
  closeEventSource();

  if (route.value.view === "challenge") {
    await loadChallengeState();
    connectChallengeStream();
    return;
  }

  if (route.value.view === "admin") {
    await loadAdminState();
    return;
  }

  if (route.value.view === "observer" && route.value.roomCode) {
    await loadObserverState(route.value.roomCode);

    if (!observerState.error) {
      connectObserverStream(route.value.roomCode);
    }
  }
}

function readRoute(): RouteState {
  const pathname = window.location.pathname;

  if (pathname === "/admin") {
    return { view: "admin", search: window.location.search };
  }

  if (pathname === "/join") {
    return { view: "join", search: window.location.search };
  }

  if (pathname.startsWith("/room/")) {
    return {
      view: "observer",
      roomCode: decodeURIComponent(pathname.slice("/room/".length)).trim().toUpperCase(),
      search: window.location.search
    };
  }

  return { view: "challenge", search: window.location.search };
}

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  route.value = readRoute();
  void initializeCurrentView();
}

function dismissNotification(): void {
  notification.value = null;
}

function handleRangeSelected(payload: { range: CodeRange; text: string }): void {
  selectedRange.value = payload.range;
  selectedText.value = payload.text;
  submissionError.value = "";
}

function clearSelection(): void {
  selectedRange.value = null;
  selectedText.value = "";
  window.getSelection()?.removeAllRanges();
}

function openSubmissionModal(): void {
  if (!selectedRange.value) {
    return;
  }

  submissionError.value = "";
  form.proposedFix = selectedText.value;
  modalOpen.value = true;
}

function closeSubmissionModal(): void {
  modalOpen.value = false;
  submissionError.value = "";
}

async function submit(): Promise<void> {
  if (!challenge.value || !selectedRange.value) {
    return;
  }

  submitting.value = true;
  submissionError.value = "";

  try {
    feedback.value = await requestJson<SubmitBugResponse>("/api/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        challengeId: challenge.value.id,
        sessionId: roomContext.value.sessionId,
        selection: selectedRange.value,
        proposedFix: form.proposedFix,
        roomCode: roomContext.value.roomCode || undefined,
        participantName: roomContext.value.participantName || undefined
      })
    });
    sessionProgress.value = await fetchSessionProgress();

    if (feedback.value.status === "solved") {
      await refreshChallengeProjection();
      clearSelection();
      publishResolvedBug(feedback.value);
    }

    modalOpen.value = false;
    form.proposedFix = "";
  } catch (error) {
    submissionError.value = getErrorMessage(error, "Nao foi possivel enviar a submissao.");
  } finally {
    submitting.value = false;
  }
}

async function fetchSessionProgress(): Promise<SessionProgress> {
  return requestJson<SessionProgress>(`/api/session-progress/${roomContext.value.sessionId}/${challengeId}`);
}

function formatAttemptRange(selection: CodeRange): string {
  return `L${selection.startLine}:C${selection.startColumn} - L${selection.endLine}:C${selection.endColumn}`;
}

async function loadChallengeState(): Promise<void> {
  loading.value = true;
  loadError.value = "";

  try {
    const [challengeResponse, progressResponse, challengeStateResponse] = await Promise.all([
      requestJson<ChallengeDefinition>(`/api/challenges/${challengeId}`),
      fetchSessionProgress(),
      requestJson<ChallengeStateResponse>(`/api/challenge-state/${challengeId}`)
    ]);

    challenge.value = challengeResponse;
    sessionProgress.value = progressResponse;
    applyChallengeState(challengeStateResponse);
  } catch (error) {
    loadError.value = getErrorMessage(error, "Nao foi possivel carregar o desafio.");
  } finally {
    loading.value = false;
  }
}

async function refreshChallengeProjection(): Promise<void> {
  const challengeStateResponse = await requestJson<ChallengeStateResponse>(`/api/challenge-state/${challengeId}`);
  applyChallengeState(challengeStateResponse);
}

function applyChallengeState(challengeStateResponse: ChallengeStateResponse): void {
  challengeDisplayState.baseSource = challengeStateResponse.baseSource;
  challengeDisplayState.displayedSource = challengeStateResponse.displayedSource;
  challengeDisplayState.resolvedBugOrder = challengeStateResponse.resolvedBugOrder;
  challengeDisplayState.resolvedBugDiffs = challengeStateResponse.resolvedBugDiffs;
}

async function loadAdminState(): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    const status = await requestJson<AdminStatusResponse>("/api/admin/status");
    adminState.requiresBootstrap = status.requiresBootstrap;

    if (adminState.token && !status.requiresBootstrap) {
      adminState.rooms = await requestJson<RoomSummary[]>("/api/admin/rooms", {
        headers: {
          Authorization: `Bearer ${adminState.token}`
        }
      });
    }
  } catch (error) {
    adminState.error = getErrorMessage(error, "Nao foi possivel carregar o painel admin.");
  } finally {
    adminState.loading = false;
  }
}

async function submitAdminAuth(): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    const path = adminState.requiresBootstrap ? "/api/admin/bootstrap" : "/api/admin/login";
    const payload = adminState.requiresBootstrap
      ? { password: adminState.password }
      : { username: "admin", password: adminState.password };
    const response = await requestJson<AdminAuthResponse>(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    adminState.token = response.token;
    window.localStorage.setItem(adminTokenStorageKey, response.token);
    adminState.password = "";
    await loadAdminState();
  } catch (error) {
    adminState.error = getErrorMessage(error, "Nao foi possivel autenticar o admin.");
  } finally {
    adminState.loading = false;
  }
}

async function createRoom(): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    await requestJson<RoomSummary>("/api/admin/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminState.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: adminState.roomName,
        password: adminState.roomPassword
      })
    });

    adminState.roomName = "";
    adminState.roomPassword = "";
    await loadAdminState();
  } catch (error) {
    adminState.error = getErrorMessage(error, "Nao foi possivel criar a sala.");
  } finally {
    adminState.loading = false;
  }
}

async function deleteRoom(roomCode: string): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    await requestJson(`/api/admin/rooms/${roomCode}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${adminState.token}`
      }
    });
    await loadAdminState();
  } catch (error) {
    adminState.error = getErrorMessage(error, "Nao foi possivel deletar a sala.");
  } finally {
    adminState.loading = false;
  }
}

async function joinRoom(): Promise<void> {
  joinState.joining = true;
  joinState.error = "";

  try {
    const response = await requestJson<JoinRoomResponse>("/api/rooms/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        roomCode: joinState.roomCode,
        displayName: joinState.displayName
      })
    });

    const params = new URLSearchParams({
      roomCode: response.roomCode,
      roomName: response.roomName,
      participantSessionId: response.participantSessionId,
      participantName: response.displayName
    });
    navigate(`/?${params.toString()}`);
  } catch (error) {
    joinState.error = getErrorMessage(error, "Nao foi possivel entrar na sala.");
  } finally {
    joinState.joining = false;
  }
}

async function loadObserverState(roomCode: string): Promise<void> {
  observerState.loading = true;
  observerState.error = "";

  if (!adminState.token) {
    observerState.activity = [];
    observerState.error = "Autenticacao admin obrigatoria para observar a sala.";
    observerState.loading = false;
    return;
  }

  try {
    const response = await requestJson<RoomActivityResponse>(`/api/admin/rooms/${roomCode}/activity`, {
      headers: {
        Authorization: `Bearer ${adminState.token}`
      }
    });
    observerState.activity = response.items;
  } catch (error) {
    observerState.activity = [];
    observerState.error = getErrorMessage(error, "Nao foi possivel carregar a atividade da sala.");
  } finally {
    observerState.loading = false;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new Error(
      typeof payload?.message === "string" ? payload.message : `Request falhou com status ${response.status}.`
    );
  }

  return payload as T;
}

function connectChallengeStream(): void {
  if (typeof EventSource === "undefined") {
    return;
  }

  if (roomContext.value.roomCode) {
    eventSource = new EventSource(`${apiBaseUrl}/api/rooms/${encodeURIComponent(roomContext.value.roomCode)}/events`);
  } else {
    const params = new URLSearchParams({ challengeId });
    eventSource = new EventSource(`${apiBaseUrl}/api/events?${params.toString()}`);
  }
  eventSource.onmessage = (message) => {
    const event = parseMessage<ResolvedBugEvent>(message.data);

    if (!event || event.type !== "bug.resolved") {
      return;
    }

    if (event.challengeId !== challengeId) {
      return;
    }

    if (event.sessionId !== roomContext.value.sessionId) {
      void refreshChallengeProjection();
      notifier.notify(event);
    }
  };
  eventSource.onerror = closeEventSource;
}

function connectObserverStream(roomCode: string): void {
  if (typeof EventSource === "undefined") {
    return;
  }

  eventSource = new EventSource(`${apiBaseUrl}/api/admin/rooms/${encodeURIComponent(roomCode)}/events`);
  eventSource.onmessage = (message) => {
    const event = parseMessage<RoomActivityEvent>(message.data);

    if (!event || event.type !== "room.activity" || event.roomCode !== roomCode) {
      return;
    }

    observerState.activity = [...observerState.activity, event.item];
  };
  eventSource.onerror = closeEventSource;
}

function parseMessage<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function closeEventSource(): void {
  eventSource?.close();
  eventSource = null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function publishResolvedBug(result: SubmitBugResponse): void {
  if (!challenge.value || !result.bugId) {
    return;
  }

  const bug = challenge.value.bugs.find((candidate) => candidate.id === result.bugId);

  if (!bug) {
    return;
  }

  if (!result.resolvedBugDiff) {
    return;
  }

  const event: ResolvedBugEvent = {
    type: "bug.resolved",
    challengeId: challenge.value.id,
    sessionId: roomContext.value.sessionId,
    bugId: bug.id,
    title: bug.title,
    resolvedAt: new Date().toISOString(),
    diff: result.resolvedBugDiff,
    shortDescription: bug.expectedFix
  };

  notifier.notify(event);
}
</script>

<template>
  <main class="page">
    <section v-if="route.view === 'admin'" class="workspace admin-workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>Painel admin</h1>
        </div>
        <div class="toolbar-actions">
          <button class="secondary-button" type="button" @click="navigate('/')">Desafio</button>
          <button class="secondary-button" type="button" @click="navigate('/join')">Entrada em sala</button>
        </div>
      </header>

      <section class="panel panel-stack">
        <h2>{{ adminState.requiresBootstrap ? 'Bootstrap admin' : 'Login admin' }}</h2>
        <p class="muted-text">
          {{ adminState.requiresBootstrap ? 'Defina a senha inicial do admin.' : 'Entre com o usuario fixo admin.' }}
        </p>
        <label>
          <span>Senha</span>
          <input v-model="adminState.password" type="password" />
        </label>
        <button :disabled="adminState.loading" type="button" @click="submitAdminAuth">
          {{ adminState.requiresBootstrap ? 'Configurar admin' : 'Entrar' }}
        </button>
        <p v-if="adminState.error" class="error-text">{{ adminState.error }}</p>
      </section>

      <section v-if="adminState.token" class="panel panel-stack">
        <h2>Criar sala</h2>
        <label>
          <span>Nome da sala</span>
          <input v-model="adminState.roomName" type="text" />
        </label>
        <label>
          <span>Senha da sala</span>
          <input v-model="adminState.roomPassword" type="password" />
        </label>
        <button :disabled="adminState.loading" type="button" @click="createRoom">Criar sala</button>
      </section>

      <section v-if="adminState.token" class="panel panel-stack">
        <h2>Salas</h2>
        <p v-if="adminState.rooms.length === 0" class="muted-text">Nenhuma sala criada ainda.</p>
        <ul v-else class="list-panel">
          <li v-for="room in adminState.rooms" :key="room.roomCode" class="list-item room-item">
            <div>
              <strong>{{ room.name }}</strong>
              <p class="muted-text">Codigo: {{ room.roomCode }} | Status: {{ room.status }}</p>
            </div>
            <div class="toolbar-actions">
              <button class="secondary-button" type="button" @click="navigate(`/room/${room.roomCode}`)">Ver sala</button>
              <button type="button" @click="deleteRoom(room.roomCode)">Deletar</button>
            </div>
          </li>
        </ul>
      </section>
    </section>

    <section v-else-if="route.view === 'join'" class="workspace form-workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>Entrar em sala</h1>
        </div>
        <div class="toolbar-actions">
          <button class="secondary-button" type="button" @click="navigate('/')">Desafio</button>
          <button class="secondary-button" type="button" @click="navigate('/admin')">Admin</button>
        </div>
      </header>

      <section class="panel panel-stack form-panel">
        <label>
          <span>Seu nome</span>
          <input v-model="joinState.displayName" type="text" />
        </label>
        <label>
          <span>Codigo da sala</span>
          <input v-model="joinState.roomCode" type="text" />
        </label>
        <button :disabled="joinState.joining" type="button" @click="joinRoom">Entrar</button>
        <p v-if="joinState.error" class="error-text">{{ joinState.error }}</p>
      </section>
    </section>

    <section v-else-if="route.view === 'observer'" class="workspace observer-workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>Sala {{ route.roomCode }}</h1>
        </div>
        <div class="toolbar-actions">
          <button class="secondary-button" type="button" @click="navigate('/admin')">Admin</button>
          <button class="secondary-button" type="button" @click="navigate('/join')">Entrada em sala</button>
          <button v-if="adminState.token" class="secondary-button" type="button" @click="navigate('/')">Voltar ao desafio</button>
        </div>
      </header>

      <section v-if="observerState.loading" class="panel">Carregando atividade...</section>
      <section v-else-if="observerState.error" class="panel panel-stack">
        <h2>Falha ao carregar</h2>
        <p>{{ observerState.error }}</p>
      </section>
      <section v-else class="panel panel-stack">
        <h2>Feed da sala</h2>
        <p v-if="observerState.activity.length === 0" class="muted-text">Nenhuma atividade registrada ainda.</p>
        <ul v-else class="list-panel">
          <li v-for="activity in observerState.activity.slice().reverse()" :key="activity.id" class="list-item">
            <div class="attempt-head">
              <strong>{{ activity.submittedBy }}</strong>
              <span class="metric-label">{{ activity.status }}</span>
            </div>
            <p class="muted-text">{{ activity.submittedAt }}</p>
            <p>{{ activity.proposedFix }}</p>
            <p v-if="activity.bugId" class="muted-text">Bug: {{ activity.bugId }}</p>
          </li>
        </ul>
      </section>
    </section>

    <section v-else class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>{{ challenge?.title ?? 'Carregando desafio' }}</h1>
          <p v-if="roomContext.roomCode" class="muted-text room-banner">
            Sala {{ roomContext.roomName || roomContext.roomCode }} | Participante {{ roomContext.participantName }}
          </p>
        </div>
        <div class="progress">
          <strong>{{ progress.solved }}/{{ progress.total }}</strong>
          <span>bugs resolvidos</span>
        </div>
      </header>

      <div class="toolbar-actions top-links">
        <button class="secondary-button" type="button" @click="navigate('/join')">Entrada em sala</button>
        <button class="secondary-button" type="button" @click="navigate('/admin')">Admin</button>
        <button
          v-if="roomContext.roomCode && adminState.token"
          class="secondary-button"
          type="button"
          @click="navigate(`/room/${roomContext.roomCode}`)"
        >
          Ver feed da sala
        </button>
      </div>

      <section v-if="notification" class="inline-message inline-message-success" role="status">
        <div>
          <strong>{{ notification.title }}</strong>
          <p>{{ notification.message }}</p>
        </div>
        <button class="secondary-button dismiss-button" type="button" @click="dismissNotification">Fechar</button>
      </section>

      <div v-if="loading" class="panel">Carregando desafio...</div>

      <section v-else-if="loadError" class="panel panel-stack">
        <h2>Falha ao carregar</h2>
        <p>{{ loadError }}</p>
        <button class="toolbar-button" type="button" @click="loadChallengeState">Tentar novamente</button>
      </section>

      <template v-else-if="challenge">
        <div class="layout">
          <section class="panel editor-panel">
            <div class="editor-toolbar">
              <div class="selection-summary">
                <span class="selection-label">Selecao</span>
                <strong>{{ selectedRangeLabel }}</strong>
              </div>
              <div class="toolbar-actions">
                <button
                  :disabled="!selectedRange"
                  class="secondary-button toolbar-button"
                  type="button"
                  @click="clearSelection"
                >
                  Limpar selecao
                </button>
                <button :disabled="!selectedRange" class="toolbar-button" type="button" @click="openSubmissionModal">
                  Reportar bug
                </button>
              </div>
            </div>

            <CodeViewer
              :selected-range="selectedRange"
              :resolved-bug-diffs="challengeDisplayState.resolvedBugDiffs"
              :source="displayedSource"
              @clear-selection="clearSelection"
              @range-selected="handleRangeSelected"
            />
          </section>

          <section class="sidebar">
            <section class="panel status-panel">
              <h2>Estado da sessao</h2>
              <div class="session-stats">
                <div>
                  <span class="metric-label">Resolvidos</span>
                  <strong>{{ progress.solved }}</strong>
                </div>
                <div>
                  <span class="metric-label">Pendentes</span>
                  <strong>{{ Math.max(progress.total - progress.solved, 0) }}</strong>
                </div>
              </div>
              <p class="muted-text">
                Selecione um trecho no editor e abra a submissao para explicar a correcao.
              </p>
              <p class="muted-text">
                Teclado: foque o editor, use setas para navegar, Shift + setas para selecionar e Enter para marcar a linha atual.
              </p>
            </section>

            <section class="panel feedback-panel">
              <h2>Feedback</h2>
              <p v-if="!feedback">Nenhuma submissao ainda.</p>
              <template v-else>
                <p><strong>Status:</strong> {{ feedback.status }}</p>
                <p>{{ feedback.feedback }}</p>
                <p v-if="feedback.technicalBasis">
                  <strong>Base tecnica:</strong> {{ feedback.technicalBasis }}
                </p>
              </template>
            </section>

            <section class="panel resolved-panel">
              <h2>Bugs resolvidos</h2>
              <p v-if="solvedBugs.length === 0" class="muted-text">Nenhum bug resolvido ainda.</p>
              <ul v-else class="list-panel">
                <li v-for="bug in solvedBugs" :key="bug.id" class="list-item">
                  <strong>{{ bug.id }}</strong>
                  <span>{{ bug.title }}</span>
                </li>
              </ul>
            </section>

            <section class="panel attempts-panel">
              <h2>Tentativas recentes</h2>
              <p v-if="recentAttempts.length === 0" class="muted-text">Nenhuma tentativa registrada ainda.</p>
              <ul v-else class="list-panel">
                <li v-for="attempt in recentAttempts" :key="attempt.createdAt" class="list-item">
                  <div class="attempt-head">
                    <strong>{{ attempt.status }}</strong>
                    <span class="metric-label">{{ formatAttemptRange(attempt.selection) }}</span>
                  </div>
                  <span class="attempt-text">{{ attempt.proposedFix }}</span>
                </li>
              </ul>
            </section>
          </section>
        </div>
      </template>
    </section>

    <SubmissionModal
      :error-message="submissionError"
      :open="modalOpen"
      :range-label="selectedRangeLabel"
      :submitting="submitting"
      :value="form.proposedFix"
      @close="closeSubmissionModal"
      @submit="submit"
      @update:value="form.proposedFix = $event"
    />
  </main>
</template>
