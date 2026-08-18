const SESSION_STORAGE_KEY = "ts-bug-hunt.session-id";

const fallbackStorage = createMemoryStorage();

export function getOrCreateSessionId(storage: Pick<Storage, "getItem" | "setItem"> = getDefaultStorage()): string {
  const existing = storage.getItem(SESSION_STORAGE_KEY)?.trim();

  if (existing) {
    return existing;
  }

  const sessionId = createSessionId();
  storage.setItem(SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

function getDefaultStorage(): Pick<Storage, "getItem" | "setItem"> {
  if (typeof window === "undefined") {
    return fallbackStorage;
  }

  try {
    return window.localStorage;
  } catch {
    return fallbackStorage;
  }
}

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();

  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}

export { SESSION_STORAGE_KEY };
