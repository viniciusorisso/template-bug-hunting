<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type {
  AdminAuthResponse,
  AdminStatusResponse,
  ChallengeDefinition,
  ChallengeStateResponse,
  CodeRange,
  JoinRoomResponse,
  RequestHintResponse,
  ResolvedBugDiff,
  ResolvedBugEvent,
  RoomActivityEvent,
  RoomActivityItem,
  RoomActivityResponse,
  RoomExecutionSettings,
  RoomRunResponse,
  RoomSummary,
  RoomTypecheckResponse,
  SessionProgress,
  SubmitBugResponse
} from "@ts-bug-hunt/core";
import CodeViewer from "./components/CodeViewer.vue";
import SubmissionModal from "./components/SubmissionModal.vue";
import { BrowserBannerResolvedBugNotifier, type NotificationBanner } from "./lib/browserNotifier";
import { getOrCreateSessionId } from "./lib/session";

type ViewMode = "home" | "challenge" | "admin" | "join" | "observer";

type RouteState = {
  view: ViewMode;
  roomCode?: string;
  search: string;
};

type ParsedRoomContext = {
  roomCode: string;
  roomName: string;
  participantId: string;
  participantName: string;
  challengeId: string;
  sessionId: string;
  executionSettings: Required<RoomExecutionSettings>;
};

type CelebrationBalloonState = {
  id: string;
  bugId: string;
  title: string;
  shortDescription: string;
  diff: ResolvedBugDiff;
  createdAt: string;
  expiresAt: string;
};

type EditorThemeId = "classic-dark" | "operator-mono-dark-modern";

const defaultApiBaseUrl = import.meta.env.DEV ? "http://localhost:3001" : "";
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl).replace(/\/$/, "");
const adminTokenStorageKey = "ts-bug-hunt.admin-token";
const editorThemeStorageKey = "ts-bug-hunt.editor-theme";
const celebrationDurationMs = 4000;
const editorThemes: Array<{ id: EditorThemeId; label: string }> = [
  { id: "operator-mono-dark-modern", label: "Operator Mono Dark Modern" },
  { id: "classic-dark", label: "Classic Dark" }
];

const route = ref<RouteState>(readRoute());
const availableChallenges = ref<ChallengeDefinition[]>([]);

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
const activeBalloons = ref<CelebrationBalloonState[]>([]);
const selectedResolvedBug = ref<CelebrationBalloonState | null>(null);
const highlightedBugId = ref<string | null>(null);
const latestResolvedBug = ref<ResolvedBugEvent | null>(null);
const resolvedBugHistory = ref<ResolvedBugEvent[]>([]);
const selectedResolvedHistoryBugId = ref<string | null>(null);
const editorTheme = ref<EditorThemeId>(readStoredEditorTheme());

const form = reactive({
  proposedFix: ""
});

const adminState = reactive({
  loading: false,
  error: "",
  configured: true,
  token: typeof window !== "undefined" ? window.localStorage.getItem(adminTokenStorageKey) ?? "" : "",
  username: "",
  password: "",
  roomName: "",
  roomPassword: "",
  challengeId: "",
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

const hintState = reactive({
  requesting: false,
  error: "",
  currentHint: null as RequestHintResponse | null
});

const executionState = reactive({
  typechecking: false,
  running: false,
  error: "",
  typecheckResult: null as RoomTypecheckResponse | null,
  runResult: null as RoomRunResponse | null
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

const selectedResolvedHistoryEntry = computed(() => {
  if (resolvedBugHistory.value.length == 0) {
    return null;
  }

  if (!selectedResolvedHistoryBugId.value) {
    return resolvedBugHistory.value[0] ?? null;
  }

  return resolvedBugHistory.value.find((event) => event.bugId === selectedResolvedHistoryBugId.value) ?? resolvedBugHistory.value[0] ?? null;
});

const selectedRangeLabel = computed(() => {
  if (!selectedRange.value) {
    return "Nenhum trecho selecionado";
  }

  const { startLine, startColumn, endLine, endColumn } = selectedRange.value;
  return `L${startLine}:C${startColumn} ate L${endLine}:C${endColumn}`;
});

function normalizeExecutionSettings(settings?: RoomExecutionSettings): Required<RoomExecutionSettings> {
  return {
    allowTypecheck: settings?.allowTypecheck ?? false,
    allowRuntimeExecution: settings?.allowRuntimeExecution ?? false
  };
}

function parseRoomContext(search: string): ParsedRoomContext {
  const params = new URLSearchParams(search);
  const roomCode = params.get("roomCode")?.trim().toUpperCase() ?? "";
  const participantId = params.get("participantId")?.trim() ?? params.get("participantSessionId")?.trim() ?? "";
  const participantName = params.get("participantName")?.trim() ?? "";
  const roomName = params.get("roomName")?.trim() ?? "";
  const challengeId = params.get("challengeId")?.trim() ?? "";

  return {
    roomCode,
    roomName,
    participantId,
    participantName,
    challengeId,
    sessionId: participantId || getOrCreateSessionId(),
    executionSettings: normalizeExecutionSettings({
      allowTypecheck: params.get("allowTypecheck") === "1",
      allowRuntimeExecution: params.get("allowRuntimeExecution") === "1"
    })
  };
}

const roomContext = computed(() => parseRoomContext(route.value.search));
const currentChallengeId = computed(() => roomContext.value.challengeId);
const hasRoomAccess = computed(() => Boolean(roomContext.value.roomCode && roomContext.value.participantId && currentChallengeId.value));
const currentChallengeSummary = computed(() => availableChallenges.value.find((item) => item.id === currentChallengeId.value) ?? challenge.value);
const roomExecutionSettings = computed(() => normalizeExecutionSettings(roomContext.value.executionSettings));

const notifier = new BrowserBannerResolvedBugNotifier((banner) => {
  notification.value = banner;
});

let eventSource: EventSource | null = null;
const balloonTimeouts = new Map<string, number>();
let highlightedBugTimeoutId: number | null = null;
const resolvedBugModalRef = ref<HTMLElement | null>(null);
const activeChallengeScopeKey = ref("");
let previousResolvedBugTrigger: HTMLElement | null = null;

onMounted(async () => {
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener("popstate", handlePopState);
  await initializeCurrentView();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener("popstate", handlePopState);
  closeEventSource();
  clearCelebrationTimers();
});

function handlePopState(): void {
  route.value = readRoute();
  void initializeCurrentView();
}

function readStoredEditorTheme(): EditorThemeId {
  if (typeof window === "undefined") {
    return "operator-mono-dark-modern";
  }

  const storedTheme = window.localStorage.getItem(editorThemeStorageKey);

  return editorThemes.some((theme) => theme.id === storedTheme)
    ? (storedTheme as EditorThemeId)
    : "operator-mono-dark-modern";
}

function handleEditorThemeChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;

  if (!editorThemes.some((theme) => theme.id === value)) {
    return;
  }

  editorTheme.value = value as EditorThemeId;
  window.localStorage.setItem(editorThemeStorageKey, editorTheme.value);
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }

  if (selectedResolvedBug.value) {
    closeResolvedBugModal();
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

  if (route.value.view !== "challenge") {
    activeChallengeScopeKey.value = "";
    resetChallengeUiState();
  }

  if (route.value.view === "home") {
    await loadChallengeCatalog();
    return;
  }

  if (route.value.view === "challenge") {
    if (!hasRoomAccess.value) {
      return;
    }

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

  const roomContext = parseRoomContext(window.location.search);

  if (roomContext.roomCode && roomContext.participantId && roomContext.challengeId) {
    return { view: "challenge", search: window.location.search };
  }

  return { view: "home", search: window.location.search };
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

function dismissBalloon(balloonId: string): void {
  const timeoutId = balloonTimeouts.get(balloonId);

  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    balloonTimeouts.delete(balloonId);
  }

  activeBalloons.value = activeBalloons.value.filter((balloon) => balloon.id !== balloonId);
}

function scheduleBalloonDismiss(balloonId: string, delayMs = celebrationDurationMs): void {
  const existingTimeoutId = balloonTimeouts.get(balloonId);

  if (existingTimeoutId !== undefined) {
    window.clearTimeout(existingTimeoutId);
  }

  balloonTimeouts.set(
    balloonId,
    window.setTimeout(() => {
      dismissBalloon(balloonId);
    }, delayMs)
  );
}

function queueResolvedBugCelebration(event: ResolvedBugEvent): void {
  const balloonId = `${event.bugId}:${event.resolvedAt}`;
  const nextBalloon: CelebrationBalloonState = {
    id: balloonId,
    bugId: event.bugId,
    title: event.title,
    shortDescription: event.shortDescription,
    diff: event.diff,
    createdAt: event.resolvedAt,
    expiresAt: new Date(new Date(event.resolvedAt).getTime() + celebrationDurationMs).toISOString()
  };

  dismissBalloon(balloonId);
  activeBalloons.value = [...activeBalloons.value.filter((balloon) => balloon.bugId !== event.bugId), nextBalloon];
  scheduleBalloonDismiss(balloonId);
}

async function openResolvedBugModal(balloonId: string): Promise<void> {
  const balloon = activeBalloons.value.find((candidate) => candidate.id === balloonId);

  if (!balloon) {
    return;
  }

  previousResolvedBugTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const timeoutId = balloonTimeouts.get(balloonId);

  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    balloonTimeouts.delete(balloonId);
  }

  selectedResolvedBug.value = balloon;
  await nextTick();
  focusResolvedBugModal();
}

function closeResolvedBugModal(): void {
  const balloonId = selectedResolvedBug.value?.id;
  selectedResolvedBug.value = null;

  if (balloonId && activeBalloons.value.some((balloon) => balloon.id === balloonId)) {
    scheduleBalloonDismiss(balloonId);
  }

  const trigger = previousResolvedBugTrigger;
  previousResolvedBugTrigger = null;

  if (trigger) {
    window.setTimeout(() => {
      trigger.focus();
    }, 0);
  }
}

function getResolvedBugModalFocusableElements(): HTMLElement[] {
  return [...(resolvedBugModalRef.value?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter(
    (element) => !element.hasAttribute("disabled")
  );
}

function focusResolvedBugModal(): void {
  const [firstFocusable] = getResolvedBugModalFocusableElements();
  firstFocusable?.focus();
}

function handleResolvedBugModalKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab") {
    return;
  }

  const focusableElements = getResolvedBugModalFocusableElements();

  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && (activeElement === firstFocusable || activeElement === resolvedBugModalRef.value)) {
    event.preventDefault();
    lastFocusable?.focus();
    return;
  }

  if (!event.shiftKey && activeElement === lastFocusable) {
    event.preventDefault();
    firstFocusable?.focus();
  }
}

function focusResolvedBug(bugId: string): void {
  highlightedBugId.value = bugId;

  if (highlightedBugTimeoutId !== null) {
    window.clearTimeout(highlightedBugTimeoutId);
  }

  highlightedBugTimeoutId = window.setTimeout(() => {
    if (highlightedBugId.value === bugId) {
      highlightedBugId.value = null;
    }

    highlightedBugTimeoutId = null;
  }, celebrationDurationMs);
}

function viewSelectedResolvedBug(): void {
  if (!selectedResolvedBug.value) {
    return;
  }

  focusResolvedBug(selectedResolvedBug.value.bugId);
  closeResolvedBugModal();
}

function clearCelebrationTimers(): void {
  for (const timeoutId of balloonTimeouts.values()) {
    window.clearTimeout(timeoutId);
  }

  balloonTimeouts.clear();

  if (highlightedBugTimeoutId !== null) {
    window.clearTimeout(highlightedBugTimeoutId);
    highlightedBugTimeoutId = null;
  }
}

function announceResolvedBug(event: ResolvedBugEvent): void {
  latestResolvedBug.value = event;
  resolvedBugHistory.value = [event, ...resolvedBugHistory.value.filter((entry) => entry.bugId !== event.bugId)];
  selectedResolvedHistoryBugId.value = event.bugId;
  notifier.notify(event);
  queueResolvedBugCelebration(event);
}

function selectResolvedHistory(bugId: string): void {
  selectedResolvedHistoryBugId.value = bugId;
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

      const resolvedEvent = buildResolvedBugEvent(feedback.value);

      if (resolvedEvent) {
        announceResolvedBug(resolvedEvent);
      }
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
  if (!currentChallengeId.value) {
    throw new Error("Challenge da sala nao encontrado.");
  }

  return requestJson<SessionProgress>(`/api/session-progress/${roomContext.value.sessionId}/${currentChallengeId.value}`);
}

function formatAttemptRange(selection: CodeRange): string {
  return `L${selection.startLine}:C${selection.startColumn} - L${selection.endLine}:C${selection.endColumn}`;
}

function formatDifficultyLabel(difficulty: string): string {
  if (difficulty === "easy") {
    return "facil";
  }

  if (difficulty === "medium") {
    return "medio";
  }

  return "dificil";
}

async function loadChallengeState(): Promise<void> {
  ensureChallengeScope();

  if (!currentChallengeId.value) {
    loadError.value = "Nenhum template foi associado a esta sala.";
    loading.value = false;
    return;
  }

  loading.value = true;
  loadError.value = "";

  try {
    const [challengeList, challengeResponse, progressResponse, challengeStateResponse] = await Promise.all([
      requestJson<ChallengeDefinition[]>("/api/challenges"),
      requestJson<ChallengeDefinition>(`/api/challenges/${currentChallengeId.value}`),
      fetchSessionProgress(),
      requestJson<ChallengeStateResponse>(getChallengeStatePath(currentChallengeId.value))
    ]);

    availableChallenges.value = challengeList;
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
  if (!currentChallengeId.value) {
    return;
  }

  const challengeStateResponse = await requestJson<ChallengeStateResponse>(getChallengeStatePath(currentChallengeId.value));
  applyChallengeState(challengeStateResponse);
}

function applyChallengeState(challengeStateResponse: ChallengeStateResponse): void {
  challengeDisplayState.baseSource = challengeStateResponse.baseSource;
  challengeDisplayState.displayedSource = challengeStateResponse.displayedSource;
  challengeDisplayState.resolvedBugOrder = challengeStateResponse.resolvedBugOrder;
  challengeDisplayState.resolvedBugDiffs = challengeStateResponse.resolvedBugDiffs;

  if (hintState.currentHint && challengeStateResponse.resolvedBugOrder.includes(hintState.currentHint.bugId)) {
    hintState.currentHint = null;
  }

  syncResolvedBugHistoryFromState(challengeStateResponse);
}

async function loadChallengeCatalog(): Promise<void> {
  availableChallenges.value = await requestJson<ChallengeDefinition[]>("/api/challenges");

  if (!adminState.challengeId && availableChallenges.value[0]) {
    adminState.challengeId = availableChallenges.value[0].id;
  }
}

function getChallengeLabel(challengeId: string): string {
  return availableChallenges.value.find((item) => item.id === challengeId)?.title ?? challengeId;
}

async function loadAdminState(): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    const [status] = await Promise.all([requestJson<AdminStatusResponse>("/api/admin/status"), loadChallengeCatalog()]);
    adminState.configured = status.configured;
    adminState.username = status.username ?? adminState.username;

    if (adminState.token && status.configured) {
      adminState.rooms = await requestJson<RoomSummary[]>("/api/admin/rooms", {
        headers: {
          Authorization: `Bearer ${adminState.token}`
        }
      });
    }
  } catch (error) {
    adminState.error = handleAdminError(error, "Nao foi possivel carregar o painel admin.");
  } finally {
    adminState.loading = false;
  }
}

async function submitAdminAuth(): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    const response = await requestJson<AdminAuthResponse>("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: adminState.username,
        password: adminState.password
      })
    });

    adminState.token = response.token;
    adminState.username = response.username;
    window.localStorage.setItem(adminTokenStorageKey, response.token);
    adminState.password = "";
    await loadAdminState();
  } catch (error) {
    adminState.error = getErrorMessage(error, "Nao foi possivel autenticar o admin.");
  } finally {
    adminState.loading = false;
  }
}

function logoutAdmin(): void {
  clearAdminSession();
  adminState.error = "";
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
        password: adminState.roomPassword,
        challengeId: adminState.challengeId
      })
    });

    adminState.roomName = "";
    adminState.roomPassword = "";
    await loadAdminState();
  } catch (error) {
    adminState.error = handleAdminError(error, "Nao foi possivel criar a sala.");
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
    adminState.error = handleAdminError(error, "Nao foi possivel deletar a sala.");
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
      participantName: response.displayName,
      challengeId: response.challengeId,
      allowTypecheck: response.executionSettings?.allowTypecheck ? "1" : "0",
      allowRuntimeExecution: response.executionSettings?.allowRuntimeExecution ? "1" : "0"
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
    observerState.error = handleAdminError(error, "Nao foi possivel carregar a atividade da sala.");
  } finally {
    observerState.loading = false;
  }
}

async function requestHint(): Promise<void> {
  if (!currentChallengeId.value) {
    return;
  }

  hintState.requesting = true;
  hintState.error = "";

  try {
    hintState.currentHint = await requestJson<RequestHintResponse>("/api/hints/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        challengeId: currentChallengeId.value,
        sessionId: roomContext.value.sessionId,
        roomCode: roomContext.value.roomCode || undefined
      })
    });
  } catch (error) {
    hintState.error = getErrorMessage(error, "Nao foi possivel carregar a dica.");
  } finally {
    hintState.requesting = false;
  }
}

async function updateRoomExecutionSettings(roomCode: string, settings: Partial<Required<RoomExecutionSettings>>): Promise<void> {
  adminState.loading = true;
  adminState.error = "";

  try {
    await requestJson("/api/admin/rooms/" + roomCode + "/execution-settings", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + adminState.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(settings)
    });
    await loadAdminState();
  } catch (error) {
    adminState.error = handleAdminError(error, "Nao foi possivel atualizar as permissoes de execucao da sala.");
  } finally {
    adminState.loading = false;
  }
}

async function runTypecheckRequest(): Promise<void> {
  if (!currentChallengeId.value || !roomContext.value.roomCode || !roomContext.value.participantId) {
    return;
  }

  executionState.typechecking = true;
  executionState.error = "";

  try {
    executionState.typecheckResult = await requestJson<RoomTypecheckResponse>("/api/rooms/" + roomContext.value.roomCode + "/typecheck", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        participantSessionId: roomContext.value.participantId,
        challengeId: currentChallengeId.value,
        source: displayedSource.value
      })
    });
  } catch (error) {
    executionState.error = getErrorMessage(error, "Nao foi possivel rodar o typecheck.");
  } finally {
    executionState.typechecking = false;
  }
}

async function runRuntimeRequest(): Promise<void> {
  if (!currentChallengeId.value || !roomContext.value.roomCode || !roomContext.value.participantId) {
    return;
  }

  executionState.running = true;
  executionState.error = "";

  try {
    executionState.runResult = await requestJson<RoomRunResponse>("/api/rooms/" + roomContext.value.roomCode + "/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        participantSessionId: roomContext.value.participantId,
        challengeId: currentChallengeId.value,
        source: displayedSource.value
      })
    });
  } catch (error) {
    executionState.error = getErrorMessage(error, "Nao foi possivel executar o codigo.");
  } finally {
    executionState.running = false;
  }
}

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      typeof payload?.message === "string" ? payload.message : `Request falhou com status ${response.status}.`
    );
  }

  return payload as T;
}

function connectChallengeStream(): void {
  if (typeof EventSource === "undefined") {
    return;
  }

  if (!currentChallengeId.value) {
    return;
  }

  if (roomContext.value.roomCode) {
    eventSource = new EventSource(`${apiBaseUrl}/api/rooms/${encodeURIComponent(roomContext.value.roomCode)}/events`);
  } else {
    const params = new URLSearchParams({ challengeId: currentChallengeId.value });
    eventSource = new EventSource(`${apiBaseUrl}/api/events?${params.toString()}`);
  }

  eventSource.addEventListener("bug.resolved", (message) => {
    const event = parseMessage<ResolvedBugEvent>((message as MessageEvent<string>).data);

    if (!event || event.type !== "bug.resolved") {
      return;
    }

    if (event.challengeId !== currentChallengeId.value) {
      return;
    }

    void refreshChallengeProjection();

    if (event.sessionId !== roomContext.value.sessionId) {
      announceResolvedBug(event);
    }
  });
  eventSource.onerror = () => undefined;
}

function connectObserverStream(roomCode: string): void {
  if (typeof EventSource === "undefined") {
    return;
  }

  eventSource = new EventSource(`${apiBaseUrl}/api/admin/rooms/${encodeURIComponent(roomCode)}/events`);
  eventSource.addEventListener("room.activity", (message) => {
    const event = parseMessage<RoomActivityEvent>((message as MessageEvent<string>).data);

    if (!event || event.type !== "room.activity" || event.roomCode !== roomCode) {
      return;
    }

    observerState.activity = [...observerState.activity, event.item];
  });
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

function clearAdminSession(): void {
  adminState.token = "";
  adminState.password = "";
  adminState.rooms = [];
  window.localStorage.removeItem(adminTokenStorageKey);
}

function handleAdminError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.status === 401) {
    clearAdminSession();
    return "Sessao admin invalida ou expirada. Entre novamente.";
  }

  return getErrorMessage(error, fallback);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getChallengeStatePath(challengeId: string): string {
  const params = new URLSearchParams();

  if (roomContext.value.roomCode) {
    params.set("roomCode", roomContext.value.roomCode);
  }

  const query = params.toString();
  return query ? `/api/challenge-state/${challengeId}?${query}` : `/api/challenge-state/${challengeId}`;
}

function ensureChallengeScope(): void {
  const nextScopeKey = `${roomContext.value.roomCode || "global"}:${currentChallengeId.value || ""}`;

  if (activeChallengeScopeKey.value === nextScopeKey) {
    return;
  }

  activeChallengeScopeKey.value = nextScopeKey;
  resetChallengeUiState();
}

function resetChallengeUiState(): void {
  feedback.value = null;
  submissionError.value = "";
  selectedRange.value = null;
  selectedText.value = "";
  modalOpen.value = false;
  latestResolvedBug.value = null;
  resolvedBugHistory.value = [];
  selectedResolvedHistoryBugId.value = null;
  selectedResolvedBug.value = null;
  highlightedBugId.value = null;
  challengeDisplayState.baseSource = "";
  challengeDisplayState.displayedSource = "";
  challengeDisplayState.resolvedBugOrder = [];
  challengeDisplayState.resolvedBugDiffs = {};
  hintState.requesting = false;
  hintState.error = "";
  hintState.currentHint = null;
  executionState.typechecking = false;
  executionState.running = false;
  executionState.error = "";
  executionState.typecheckResult = null;
  executionState.runResult = null;
  clearCelebrationTimers();
  activeBalloons.value = [];
}

function syncResolvedBugHistoryFromState(challengeStateResponse: ChallengeStateResponse): void {
  const activeChallenge = challenge.value;

  if (!activeChallenge) {
    resolvedBugHistory.value = [];
    selectedResolvedHistoryBugId.value = null;
    latestResolvedBug.value = null;
    return;
  }

  const nextHistory = [...challengeStateResponse.resolvedBugOrder]
    .reverse()
    .flatMap((bugId) => {
      const bug = activeChallenge.bugs.find((candidate) => candidate.id === bugId);
      const diff = challengeStateResponse.resolvedBugDiffs[bugId];

      if (!bug || !diff) {
        return [];
      }

      return [{
        type: "bug.resolved" as const,
        challengeId: activeChallenge.id,
        sessionId: "",
        bugId: bug.id,
        title: bug.title,
        resolvedAt: "",
        diff,
        shortDescription: bug.technicalBasis
      }];
    });

  resolvedBugHistory.value = nextHistory;
  latestResolvedBug.value = nextHistory[0] ?? null;

  if (!selectedResolvedHistoryBugId.value || !nextHistory.some((entry) => entry.bugId === selectedResolvedHistoryBugId.value)) {
    selectedResolvedHistoryBugId.value = nextHistory[0]?.bugId ?? null;
  }
}

function buildResolvedBugEvent(result: SubmitBugResponse): ResolvedBugEvent | null {
  if (!challenge.value || !result.bugId || !result.resolvedBugDiff) {
    return null;
  }

  const bug = challenge.value.bugs.find((candidate) => candidate.id === result.bugId);

  if (!bug) {
    return null;
  }

  return {
    type: "bug.resolved",
    challengeId: challenge.value.id,
    sessionId: roomContext.value.sessionId,
    bugId: bug.id,
    title: bug.title,
    resolvedAt: new Date().toISOString(),
    diff: result.resolvedBugDiff,
    shortDescription: bug.technicalBasis
  };
}
</script>

<template>
  <main class="page">
    <section v-if="route.view === 'home'" class="workspace home-workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>Escolha uma sala para jogar</h1>
          <p class="muted-text">O desafio so fica disponivel depois da entrada em uma sala ativa. A aplicacao agora suporta multiplos templates de bug hunting.</p>
        </div>
        <div class="toolbar-actions">
          <button class="secondary-button" type="button" @click="navigate('/join')">Entrar em sala</button>
          <button class="secondary-button" type="button" @click="navigate('/admin')">Admin</button>
        </div>
      </header>

      <section class="panel panel-stack">
        <h2>Templates disponiveis</h2>
        <p class="muted-text">Crie salas com o template default ou com o novo template focado em problemas de TypeScript.</p>
        <ul class="list-panel">
          <li v-for="item in availableChallenges" :key="item.id" class="list-item template-item">
            <div>
              <strong>{{ item.title }}</strong>
              <p class="muted-text">{{ item.description }}</p>
              <p class="muted-text">{{ item.bugs.length }} bugs catalogados</p>
            </div>
          </li>
        </ul>
      </section>
    </section>

    <section v-else-if="route.view === 'admin'" class="workspace admin-workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>Painel admin</h1>
        </div>
        <div class="toolbar-actions">
          <button class="secondary-button" type="button" @click="navigate('/')">Home</button>
          <button class="secondary-button" type="button" @click="navigate('/join')">Entrada em sala</button>
        </div>
      </header>

      <section class="panel panel-stack">
        <h2>Login admin</h2>
        <p class="muted-text">Entre com o usuario e a senha configurados no servidor.</p>
        <p v-if="adminState.token" class="muted-text">Sessao admin ativa. Voce pode entrar novamente ou sair para trocar de conta.</p>
        <p v-if="!adminState.configured" class="error-text">Credenciais admin nao configuradas no servidor.</p>
        <label>
          <span>Usuario</span>
          <input v-model="adminState.username" type="text" autocomplete="username" />
        </label>
        <label>
          <span>Senha</span>
          <input v-model="adminState.password" type="password" autocomplete="current-password" />
        </label>
        <div class="toolbar-actions">
          <button :disabled="adminState.loading || !adminState.configured" type="button" @click="submitAdminAuth">
            {{ adminState.token ? "Entrar novamente" : "Entrar" }}
          </button>
          <button v-if="adminState.token" class="secondary-button" :disabled="adminState.loading" type="button" @click="logoutAdmin">
            Sair
          </button>
        </div>
        <p v-if="adminState.error" class="error-text">{{ adminState.error }}</p>
      </section>

      <section v-if="adminState.token" class="panel panel-stack">
        <h2>Criar sala</h2>
        <label>
          <span>Template do desafio</span>
          <select v-model="adminState.challengeId">
            <option v-for="item in availableChallenges" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
        </label>
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
              <p class="muted-text">Template: {{ getChallengeLabel(room.challengeId) }}</p>
              <p class="muted-text">tsc: {{ normalizeExecutionSettings(room.executionSettings).allowTypecheck ? "liberado" : "bloqueado" }} | execucao: {{ normalizeExecutionSettings(room.executionSettings).allowRuntimeExecution ? "liberada" : "bloqueada" }}</p>
            </div>
            <div class="toolbar-actions">
              <button class="secondary-button" type="button" @click="navigate(`/room/${room.roomCode}`)">Ver sala</button>
              <button class="secondary-button" type="button" @click="updateRoomExecutionSettings(room.roomCode, { allowTypecheck: !normalizeExecutionSettings(room.executionSettings).allowTypecheck })">
                {{ normalizeExecutionSettings(room.executionSettings).allowTypecheck ? "Bloquear tsc" : "Liberar tsc" }}
              </button>
              <button class="secondary-button" type="button" @click="updateRoomExecutionSettings(room.roomCode, { allowRuntimeExecution: !normalizeExecutionSettings(room.executionSettings).allowRuntimeExecution })">
                {{ normalizeExecutionSettings(room.executionSettings).allowRuntimeExecution ? "Bloquear execucao" : "Liberar execucao" }}
              </button>
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
          <button class="secondary-button" type="button" @click="navigate('/')">Home</button>
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
          <button class="secondary-button" type="button" @click="navigate('/')">Home</button>
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
            <p class="muted-text">Resposta protegida para evitar vazamento.</p>
            <p v-if="activity.bugId" class="muted-text">Bug: {{ activity.bugId }}</p>
          </li>
        </ul>
      </section>
    </section>

    <section v-else class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">TS Bug Hunt</p>
          <h1>{{ challenge?.title ?? currentChallengeSummary?.title ?? 'Carregando desafio' }}</h1>
          <p v-if="currentChallengeSummary?.description" class="muted-text">{{ currentChallengeSummary.description }}</p>
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
        <button class="secondary-button" type="button" @click="navigate('/')">Home</button>
        <button class="secondary-button" type="button" @click="navigate('/join')">Trocar de sala</button>
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

      <section v-if="activeBalloons.length > 0" class="celebration-layer" aria-live="polite">
        <button
          v-for="balloon in activeBalloons"
          :key="balloon.id"
          class="celebration-balloon"
          type="button"
          @click="openResolvedBugModal(balloon.id)"
        >
          <span class="celebration-label">Bug resolvido</span>
          <strong>{{ balloon.bugId }}</strong>
        </button>
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
                <label class="theme-select-field">
                  <span class="selection-label">Tema</span>
                  <select :value="editorTheme" aria-label="Tema do editor" @change="handleEditorThemeChange">
                    <option v-for="themeOption in editorThemes" :key="themeOption.id" :value="themeOption.id">
                      {{ themeOption.label }}
                    </option>
                  </select>
                </label>
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
              :theme="editorTheme"
              :selected-range="selectedRange"
              :resolved-bug-diffs="challengeDisplayState.resolvedBugDiffs"
              :highlighted-bug-id="highlightedBugId"
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

            <section class="panel panel-stack">
              <div class="history-header">
                <h2>Dicas</h2>
                <button :disabled="hintState.requesting" class="secondary-button" type="button" @click="requestHint">
                  {{ hintState.requesting ? 'Carregando dica...' : 'Pedir dica' }}
                </button>
              </div>
              <p class="muted-text">As dicas priorizam bugs mais faceis e nao revelam a correcao literal.</p>
              <p v-if="hintState.error" class="error-text">{{ hintState.error }}</p>
              <template v-else-if="hintState.currentHint">
                <p><strong>Dificuldade:</strong> {{ formatDifficultyLabel(hintState.currentHint.difficulty) }}</p>
                <p><strong>Categoria:</strong> {{ hintState.currentHint.category }}</p>
                <p><strong>Nivel:</strong> {{ hintState.currentHint.hintLevel }}</p>
                <p role="status">{{ hintState.currentHint.message }}</p>
              </template>
              <p v-else class="muted-text">Nenhuma dica solicitada ainda.</p>
            </section>

            <section class="panel panel-stack">
              <div class="history-header">
                <h2>Execucao</h2>
                <div class="toolbar-actions">
                  <button
                    :disabled="executionState.typechecking || !roomExecutionSettings.allowTypecheck"
                    class="secondary-button"
                    type="button"
                    @click="runTypecheckRequest"
                  >
                    {{ executionState.typechecking ? 'Rodando tsc...' : 'Rodar tsc' }}
                  </button>
                  <button
                    :disabled="executionState.running || !roomExecutionSettings.allowRuntimeExecution"
                    class="secondary-button"
                    type="button"
                    @click="runRuntimeRequest"
                  >
                    {{ executionState.running ? 'Executando...' : 'Executar codigo' }}
                  </button>
                </div>
              </div>
              <p class="muted-text">Use os controles liberados pelo admin para validar o codigo exibido no desafio.</p>
              <p class="muted-text">tsc: {{ roomExecutionSettings.allowTypecheck ? 'liberado' : 'bloqueado' }} | runtime: {{ roomExecutionSettings.allowRuntimeExecution ? 'liberado' : 'bloqueado' }}</p>
              <p v-if="executionState.error" class="error-text">{{ executionState.error }}</p>
              <template v-if="executionState.typecheckResult">
                <p><strong>Typecheck:</strong> {{ executionState.typecheckResult.ok ? 'sem erros' : 'com diagnosticos' }}</p>
                <pre class="diff-preview"><code>{{ executionState.typecheckResult.rawOutput }}</code></pre>
              </template>
              <template v-if="executionState.runResult">
                <p><strong>Runtime:</strong> {{ executionState.runResult.ok ? 'ok' : executionState.runResult.terminationReason || 'falhou' }}</p>
                <p><strong>Saida padrao</strong></p>
                <pre class="diff-preview"><code>{{ executionState.runResult.stdout || 'Sem stdout.' }}</code></pre>
                <p><strong>Saida de erro</strong></p>
                <pre class="diff-preview"><code>{{ executionState.runResult.stderr || 'Sem stderr.' }}</code></pre>
              </template>
            </section>

            <section v-if="resolvedBugHistory.length > 0" class="panel panel-stack latest-resolved-panel">
              <div class="history-header">
                <h2>Historico de resolucoes</h2>
                <span class="metric-label">{{ resolvedBugHistory.length }} registradas</span>
              </div>
              <ul class="list-panel history-list">
                <li v-for="entry in resolvedBugHistory" :key="entry.bugId" class="list-item history-item">
                  <button
                    :class="['history-select-button', { 'history-select-button-active': selectedResolvedHistoryEntry?.bugId === entry.bugId }]"
                    type="button"
                    @click="selectResolvedHistory(entry.bugId)"
                  >
                    <strong>{{ entry.bugId }}</strong>
                    <span>{{ entry.title }}</span>
                  </button>
                </li>
              </ul>

              <template v-if="selectedResolvedHistoryEntry">
                <p><strong>{{ selectedResolvedHistoryEntry.bugId }}</strong> {{ selectedResolvedHistoryEntry.title }}</p>
                <p>{{ selectedResolvedHistoryEntry.shortDescription }}</p>
                <div class="toolbar-actions">
                  <button class="secondary-button" type="button" @click="focusResolvedBug(selectedResolvedHistoryEntry.bugId)">Ver no editor</button>
                </div>
                <div class="diff-preview-grid">
                  <div>
                    <span class="metric-label">Antes</span>
                    <pre class="diff-preview"><code>{{ selectedResolvedHistoryEntry.diff.beforeText }}</code></pre>
                  </div>
                  <div>
                    <span class="metric-label">Depois</span>
                    <pre class="diff-preview"><code>{{ selectedResolvedHistoryEntry.diff.afterText }}</code></pre>
                  </div>
                </div>
              </template>
            </section>

            <section class="panel resolved-panel">
              <h2>Bugs resolvidos</h2>
              <p v-if="solvedBugs.length === 0" class="muted-text">Nenhum bug resolvido ainda.</p>
              <ul v-else class="list-panel">
                <li v-for="bug in solvedBugs" :key="bug.id" class="list-item room-item">
                  <div>
                    <strong>{{ bug.id }}</strong>
                    <span>{{ bug.title }}</span>
                  </div>
                  <button class="secondary-button" type="button" @click="focusResolvedBug(bug.id)">Ver no editor</button>
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
      :theme="editorTheme"
      :open="modalOpen"
      :range-label="selectedRangeLabel"
      :submitting="submitting"
      :value="form.proposedFix"
      @close="closeSubmissionModal"
      @submit="submit"
      @update:value="form.proposedFix = $event"
    />

    <teleport to="body">
      <div v-if="selectedResolvedBug" class="modal-backdrop" @click.self="closeResolvedBugModal">
        <div ref="resolvedBugModalRef" class="modal-card resolved-modal" role="dialog" aria-modal="true" aria-labelledby="resolved-bug-modal-title" tabindex="-1" @keydown="handleResolvedBugModalKeydown">
          <header class="modal-header">
            <div>
              <p class="eyebrow">Celebracao</p>
              <h2 id="resolved-bug-modal-title">{{ selectedResolvedBug.bugId }} resolvido</h2>
            </div>
            <button class="icon-button" type="button" @click="closeResolvedBugModal">Fechar</button>
          </header>

          <div class="modal-body">
            <p><strong>{{ selectedResolvedBug.title }}</strong></p>
            <p>{{ selectedResolvedBug.shortDescription }}</p>

            <section class="range-chip">
              <span class="metric-label">Trecho corrigido</span>
              <strong>
                L{{ selectedResolvedBug.diff.appliedRange.startLine }}:C{{ selectedResolvedBug.diff.appliedRange.startColumn }} ate
                L{{ selectedResolvedBug.diff.appliedRange.endLine }}:C{{ selectedResolvedBug.diff.appliedRange.endColumn }}
              </strong>
            </section>

            <section class="diff-preview-grid">
              <div>
                <span class="metric-label">Antes</span>
                <pre class="diff-preview"><code>{{ selectedResolvedBug.diff.beforeText }}</code></pre>
              </div>
              <div>
                <span class="metric-label">Depois</span>
                <pre class="diff-preview"><code>{{ selectedResolvedBug.diff.afterText }}</code></pre>
              </div>
            </section>
          </div>

          <footer class="modal-actions">
            <button class="secondary-button" type="button" @click="closeResolvedBugModal">Fechar</button>
            <button type="button" @click="viewSelectedResolvedBug">Ver bug resolvido</button>
          </footer>
        </div>
      </div>
    </teleport>
  </main>
</template>
