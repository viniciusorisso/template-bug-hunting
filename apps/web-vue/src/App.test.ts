import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { getChallengeById } from "@ts-bug-hunt/core";
import type {
  ChallengeStateResponse,
  ResolvedBugDiff,
  ResolvedBugEvent,
  RoomActivityItem,
  SessionProgress,
  SubmitBugResponse
} from "@ts-bug-hunt/core";

const challenge = getChallengeById("checkout-ts-bug-hunt");

if (!challenge) {
  throw new Error("Challenge fixture nao encontrado.");
}

const initialProgress: SessionProgress = {
  sessionId: "session-1",
  challengeId: challenge.id,
  solvedBugIds: [],
  attempts: []
};

const resolvedLoopDiff: ResolvedBugDiff = {
  bugId: "B002",
  originalRange: { startLine: 35, startColumn: 23, endLine: 35, endColumn: 46 },
  appliedRange: { startLine: 35, startColumn: 23, endLine: 35, endColumn: 45 },
  beforeText: "i <= input.items.length",
  afterText: "i < input.items.length",
  resolvedLineIds: ["35"]
};

const resolvedCouponDiff: ResolvedBugDiff = {
  bugId: "B003",
  originalRange: { startLine: 41, startColumn: 20, endLine: 41, endColumn: 61 },
  appliedRange: { startLine: 41, startColumn: 20, endLine: 41, endColumn: 95 },
  beforeText: "candidate.code === input.couponCode!.toUpperCase()",
  afterText: "candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()",
  resolvedLineIds: ["41"]
};

const emptyChallengeState: ChallengeStateResponse = {
  challengeId: challenge.id,
  baseSource: challenge.source,
  resolvedBugOrder: [],
  resolvedBugDiffs: {},
  displayedSource: challenge.source
};

const resolvedLoopState: ChallengeStateResponse = {
  challengeId: challenge.id,
  baseSource: challenge.source,
  resolvedBugOrder: ["B002"],
  resolvedBugDiffs: {
    B002: resolvedLoopDiff
  },
  displayedSource: challenge.source.replace("i <= input.items.length", "i < input.items.length")
};

const resolvedCouponState: ChallengeStateResponse = {
  challengeId: challenge.id,
  baseSource: challenge.source,
  resolvedBugOrder: ["B003"],
  resolvedBugDiffs: {
    B003: resolvedCouponDiff
  },
  displayedSource: challenge.source.replace(
    "candidate.code === input.couponCode!.toUpperCase()",
    "candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()"
  )
};

const resolvedCombinedState: ChallengeStateResponse = {
  challengeId: challenge.id,
  baseSource: challenge.source,
  resolvedBugOrder: ["B003", "B002"],
  resolvedBugDiffs: {
    B003: resolvedCouponDiff,
    B002: resolvedLoopDiff
  },
  displayedSource: challenge.source
    .replace(
      "candidate.code === input.couponCode!.toUpperCase()",
      "candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()"
    )
    .replace("i <= input.items.length", "i < input.items.length")
};

const challengeRoute = `/?roomCode=ROOM01&roomName=Turma%201&participantSessionId=session-1&participantName=Risso&challengeId=${challenge.id}`;

describe("App", () => {
  beforeEach(() => {
    window.history.pushState({}, "", challengeRoute);
    window.localStorage.clear();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("loads the challenge, challenge-state and session progress", async () => {
    vi.stubGlobal("EventSource", createEventSourceStub());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          return createJsonResponse(emptyChallengeState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();

    expect(wrapper.text()).toContain(challenge.title);
    expect(wrapper.find(".code-viewer").text()).toContain("i <= input.items.length");
    expect(wrapper.text()).toContain("0/10");
  });

  it("submits a solved answer, refreshes challenge-state and shows the resolved notification", async () => {
    vi.stubGlobal("EventSource", createEventSourceStub());
    const solvedResponse: SubmitBugResponse = {
      accepted: true,
      status: "solved",
      bugId: "B002",
      feedback: "Correto",
      technicalBasis: "Array vai de 0 ate length - 1.",
      resolvedBugIds: ["B002"],
      resolvedBugDiff: resolvedLoopDiff
    };
    let progressRequestCount = 0;
    let challengeStateRequestCount = 0;
    const updatedProgress: SessionProgress = {
      ...initialProgress,
      solvedBugIds: ["B002"],
      attempts: [
        {
          challengeId: challenge.id,
          bugId: "B002",
          selection: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
          proposedFix: "Trocar <= por < porque existe um off-by-one no loop.",
          status: "solved",
          createdAt: "2026-08-18T00:00:00.000Z"
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          challengeStateRequestCount += 1;
          return createJsonResponse(challengeStateRequestCount > 1 ? resolvedLoopState : emptyChallengeState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          progressRequestCount += 1;
          return createJsonResponse(progressRequestCount > 1 ? updatedProgress : initialProgress);
        }

        if (input.endsWith("/api/submissions") && init?.method === "POST") {
          return createJsonResponse(solvedResponse);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();
    await wrapper.getComponent({ name: "CodeViewer" }).vm.$emit("range-selected", {
      range: { startLine: 35, startColumn: 20, endLine: 35, endColumn: 46 },
      text: "for (let i = 0; i <= input.items.length; i++)"
    });
    await wrapper.findAll("button.toolbar-button")[1]!.trigger("click");
    await flushPromises();

    const textarea = document.body.querySelector("textarea");

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Textarea do modal nao encontrado.");
    }

    textarea.value = "Trocar <= por < porque existe um off-by-one no loop.";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const modalButtons = document.body.querySelectorAll(".modal-actions button");
    (modalButtons[1] as HTMLButtonElement | undefined)?.click();
    await flushPromises();

    expect(wrapper.text()).toContain("Bug resolvido: B002");
    expect(wrapper.find(".code-viewer").text()).toContain("i < input.items.length");
    expect(wrapper.find('[data-resolved-bugs="B002"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("1/10");
    expect(document.body.textContent).toContain("Bug resolvidoB002");
    expect(wrapper.text()).toContain("Historico de resolucoes");
    expect(wrapper.text()).toContain("i <= input.items.length");
    expect(wrapper.text()).toContain("i < input.items.length");
    const resolvedPanelButton = wrapper.find(".resolved-panel .secondary-button");
    await resolvedPanelButton.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-resolved-bugs="B002"]').classes()).toContain("code-line-highlighted");
  });

  it("refreshes challenge-state and shows a realtime notification from another session", async () => {
    const EventSourceStub = createEventSourceStub();
    vi.stubGlobal("EventSource", EventSourceStub);
    let challengeStateRequestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          challengeStateRequestCount += 1;
          return createJsonResponse(challengeStateRequestCount > 1 ? resolvedCouponState : emptyChallengeState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();

    const remoteEvent: ResolvedBugEvent = {
      type: "bug.resolved",
      challengeId: challenge.id,
      sessionId: "session-remote",
      bugId: "B003",
      title: "Cupom falha com couponCode ausente ou sem normalizacao completa",
      resolvedAt: "2026-08-18T00:00:00.000Z",
      diff: resolvedCouponDiff,
      shortDescription: "Normalizar couponCode e candidate.code com trim e uppercase, sem usar !."
    };

    EventSourceStub.instances[0]?.emit(remoteEvent);
    await flushPromises();

    expect(wrapper.text()).toContain("Bug resolvido: B003");
    expect(wrapper.find(".code-viewer").text()).toContain("candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()");
    expect(wrapper.find('[data-resolved-bugs="B003"]').exists()).toBe(true);
    expect(document.body.querySelector(".celebration-balloon")?.textContent).toContain("B003");
  });

  it("opens the celebration modal and highlights the resolved bug on demand", async () => {
    const EventSourceStub = createEventSourceStub();
    vi.stubGlobal("EventSource", EventSourceStub);
    let challengeStateRequestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          challengeStateRequestCount += 1;
          return createJsonResponse(challengeStateRequestCount > 1 ? resolvedCouponState : emptyChallengeState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();

    EventSourceStub.instances[0]?.emit({
      type: "bug.resolved",
      challengeId: challenge.id,
      sessionId: "session-remote",
      bugId: "B003",
      title: "Cupom falha com couponCode ausente ou sem normalizacao completa",
      resolvedAt: "2026-08-18T00:00:00.000Z",
      diff: resolvedCouponDiff,
      shortDescription: "Normalizar couponCode e candidate.code com trim e uppercase, sem usar !."
    } satisfies ResolvedBugEvent);
    await flushPromises();

    const balloonButton = document.body.querySelector(".celebration-balloon") as HTMLButtonElement | null;
    balloonButton?.focus();
    balloonButton?.click();
    await flushPromises();

    expect(document.body.textContent).toContain("B003 resolvido");
    expect(document.body.textContent).toContain("Antes");
    expect(document.body.textContent).toContain("Depois");
    expect(document.activeElement?.textContent).toContain("Fechar");

    const modalButtons = document.body.querySelectorAll(".resolved-modal .modal-actions button");
    (modalButtons[1] as HTMLButtonElement | undefined)?.click();
    await flushPromises();

    expect(wrapper.find('[data-resolved-bugs="B003"]').classes()).toContain("code-line-highlighted");
  });

  it("restores focus to the balloon trigger when the resolved-bug modal closes", async () => {
    const EventSourceStub = createEventSourceStub();
    vi.stubGlobal("EventSource", EventSourceStub);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          return createJsonResponse(resolvedCouponState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    mount(App, {
      attachTo: document.body
    });
    await flushPromises();

    EventSourceStub.instances[0]?.emit({
      type: "bug.resolved",
      challengeId: challenge.id,
      sessionId: "session-remote",
      bugId: "B003",
      title: "Cupom falha com couponCode ausente ou sem normalizacao completa",
      resolvedAt: "2026-08-18T00:00:00.000Z",
      diff: resolvedCouponDiff,
      shortDescription: "Normalizar couponCode e candidate.code com trim e uppercase, sem usar !."
    } satisfies ResolvedBugEvent);
    await flushPromises();

    const balloonButton = document.body.querySelector(".celebration-balloon") as HTMLButtonElement | null;
    balloonButton?.focus();
    balloonButton?.click();
    await flushPromises();

    (document.body.querySelector(".resolved-modal .icon-button") as HTMLButtonElement | null)?.click();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(balloonButton);
  });

  it("lets the user inspect older resolved diffs from history", async () => {
    const EventSourceStub = createEventSourceStub();
    vi.stubGlobal("EventSource", EventSourceStub);
    let challengeStateRequestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          challengeStateRequestCount += 1;

          if (challengeStateRequestCount === 1) {
            return createJsonResponse(emptyChallengeState);
          }

          if (challengeStateRequestCount === 2) {
            return createJsonResponse(resolvedCouponState);
          }

          return createJsonResponse(resolvedCombinedState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();

    EventSourceStub.instances[0]?.emit({
      type: "bug.resolved",
      challengeId: challenge.id,
      sessionId: "session-remote-a",
      bugId: "B003",
      title: "Cupom falha com couponCode ausente ou sem normalizacao completa",
      resolvedAt: "2026-08-18T00:00:00.000Z",
      diff: resolvedCouponDiff,
      shortDescription: "Normalizar couponCode e candidate.code com trim e uppercase, sem usar !."
    } satisfies ResolvedBugEvent);
    await flushPromises();

    EventSourceStub.instances[0]?.emit({
      type: "bug.resolved",
      challengeId: challenge.id,
      sessionId: "session-remote-b",
      bugId: "B002",
      title: "Loop percorre item extra ao usar <=",
      resolvedAt: "2026-08-18T00:01:00.000Z",
      diff: resolvedLoopDiff,
      shortDescription: "Trocar <= por < porque existe um off-by-one no loop."
    } satisfies ResolvedBugEvent);
    await flushPromises();

    expect(wrapper.text()).toContain("2 registradas");
    expect(wrapper.text()).toContain("Loop percorre item extra ao usar <=");
    expect(wrapper.text()).toContain("i <= input.items.length");

    const historyButtons = wrapper.findAll(".history-select-button");
    await historyButtons[1]!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Cupom falha com couponCode ausente ou sem normalizacao completa");
    expect(wrapper.text()).toContain("candidate.code.trim().toUpperCase() === input.couponCode?.trim().toUpperCase()");
  });

  it("dismisses celebration balloons automatically after 4 seconds", async () => {
    vi.useFakeTimers();
    const EventSourceStub = createEventSourceStub();
    vi.stubGlobal("EventSource", EventSourceStub);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          return createJsonResponse(resolvedCouponState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    mount(App, {
      attachTo: document.body
    });
    await flushPromises();

    EventSourceStub.instances[0]?.emit({
      type: "bug.resolved",
      challengeId: challenge.id,
      sessionId: "session-remote",
      bugId: "B003",
      title: "Cupom falha com couponCode ausente ou sem normalizacao completa",
      resolvedAt: "2026-08-18T00:00:00.000Z",
      diff: resolvedCouponDiff,
      shortDescription: "Normalizar couponCode e candidate.code com trim e uppercase, sem usar !."
    } satisfies ResolvedBugEvent);
    await flushPromises();

    expect(document.body.querySelector(".celebration-balloon")).not.toBeNull();

    vi.advanceTimersByTime(4000);
    await flushPromises();

    expect(document.body.querySelector(".celebration-balloon")).toBeNull();
  });

  it("authenticates admin and lists created rooms", async () => {
    vi.stubGlobal("EventSource", createEventSourceStub());

        vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          return createJsonResponse(emptyChallengeState);
        }

        if (input.endsWith(`/api/session-progress/session-1/${challenge.id}`)) {
          return createJsonResponse(initialProgress);
        }

        if (input.endsWith("/api/admin/status")) {
          return createJsonResponse({ configured: true, username: "admin" });
        }

        if (input.endsWith("/api/admin/login") && init?.method === "POST") {
          return createJsonResponse({ token: "admin-token", username: "admin" });
        }

        if (input.endsWith("/api/admin/rooms") && init?.method === undefined) {
          return createJsonResponse([
            { id: "room-1", name: "Turma 1", roomCode: "ROOM01", challengeId: challenge.id, status: "active", createdAt: "2026-08-18" }
          ]);
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );
    window.localStorage.setItem("ts-bug-hunt.session-id", "session-1");

    window.history.pushState({}, "", "/admin");

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();
    await flushPromises();
    const usernameInput = wrapper.find('input[autocomplete="username"]');
    const passwordInput = wrapper.find('input[autocomplete="current-password"]');
    await usernameInput.setValue("admin");
    await passwordInput.setValue("secret-123");
    await wrapper.find(".panel button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Painel admin");
    expect(wrapper.text()).toContain("Turma 1");
    expect(wrapper.text()).toContain("ROOM01");
  });

  it("joins a room and loads the challenge with room context", async () => {
    window.history.pushState({}, "", "/join");
    vi.stubGlobal("EventSource", createEventSourceStub());

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/api/rooms/join") && init?.method === "POST") {
          return createJsonResponse({
            participantSessionId: "participant-1",
            roomCode: "ROOM01",
            roomName: "Turma 1",
            displayName: "Risso",
            challengeId: challenge.id,
            challengeTitle: challenge.title
          });
        }

        if (input.endsWith("/api/challenges")) {
          return createJsonResponse([challenge]);
        }

        if (input.endsWith(`/api/challenges/${challenge.id}`)) {
          return createJsonResponse(challenge);
        }

        if (input.endsWith(`/api/challenge-state/${challenge.id}`)) {
          return createJsonResponse(emptyChallengeState);
        }

        if (input.endsWith(`/api/session-progress/participant-1/${challenge.id}`)) {
          return createJsonResponse({ ...initialProgress, sessionId: "participant-1" });
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();
    await wrapper.findAll("input")[0]!.setValue("Risso");
    await wrapper.findAll("input")[1]!.setValue("ROOM01");
    await wrapper.find(".form-panel button").trigger("click");
    await flushPromises();

    expect(window.location.search).toContain("roomCode=ROOM01");
    expect(wrapper.text()).toContain("Sala Turma 1 | Participante Risso");
  });

  it("renders room observer activity and reacts to SSE updates", async () => {
    window.history.pushState({}, "", "/room/ROOM01");
    window.localStorage.setItem("ts-bug-hunt.admin-token", "admin-token");
    const EventSourceStub = createEventSourceStub();
    vi.stubGlobal("EventSource", EventSourceStub);

    const initialActivity: RoomActivityItem[] = [
      {
        id: "ROOM01:1",
        roomCode: "ROOM01",
        challengeId: challenge.id,
        bugId: "B002",
        status: "solved",
        submittedBy: "Risso",
        submittedAt: "2026-08-18T00:00:00.000Z",
        proposedFix: "Trocar <= por <."
      }
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (
          input.endsWith("/api/admin/rooms/ROOM01/activity") &&
          init?.headers &&
          (init.headers as Record<string, string>).Authorization === "Bearer admin-token"
        ) {
          return createJsonResponse({ roomCode: "ROOM01", items: initialActivity });
        }

        throw new Error(`Unhandled request: ${input}`);
      })
    );

    const wrapper = mount(App, {
      attachTo: document.body
    });

    await flushPromises();
    EventSourceStub.instances[0]?.emit({
      type: "room.activity",
      roomCode: "ROOM01",
      item: {
        id: "ROOM01:2",
        roomCode: "ROOM01",
        challengeId: challenge.id,
        bugId: "B003",
        status: "partial",
        submittedBy: "Ana",
        submittedAt: "2026-08-18T00:01:00.000Z",
        proposedFix: "Normalizar os dois lados."
      }
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Sala ROOM01");
    expect(wrapper.text()).toContain("Risso");
    expect(wrapper.text()).toContain("Ana");
  });
});

function createJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as Response;
}

function createEventSourceStub() {
  class EventSourceStub {
    static instances: EventSourceStub[] = [];

    onerror: (() => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

    constructor(public readonly url: string) {
      EventSourceStub.instances.push(this);
    }

    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
      const current = this.listeners.get(type) ?? [];
      this.listeners.set(type, [...current, listener]);
    }

    close(): void {
      return;
    }

    emit(payload: { type?: string } & Record<string, unknown>): void {
      const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
      const namedListeners = payload.type ? this.listeners.get(payload.type) ?? [] : [];

      for (const listener of namedListeners) {
        listener(event);
      }

      this.onmessage?.(event);
    }
  }

  return EventSourceStub;
}
