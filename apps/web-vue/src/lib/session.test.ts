import { describe, expect, it, vi } from "vitest";
import { getOrCreateSessionId, SESSION_STORAGE_KEY } from "./session";

describe("getOrCreateSessionId", () => {
  it("reuses an existing session id from storage", () => {
    const storage = new Map<string, string>([[SESSION_STORAGE_KEY, "existing-session"]]);

    const sessionId = getOrCreateSessionId({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      }
    });

    expect(sessionId).toBe("existing-session");
  });

  it("creates and stores a new session id when missing", () => {
    const storage = new Map<string, string>();

    const sessionId = getOrCreateSessionId({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      }
    });

    expect(sessionId).toBeTruthy();
    expect(storage.get(SESSION_STORAGE_KEY)).toBe(sessionId);
  });

  it("falls back when localStorage is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      }
    });

    try {
      const sessionId = getOrCreateSessionId();
      expect(sessionId).toBeTruthy();
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      } else {
        vi.stubGlobal("localStorage", undefined);
      }
    }
  });
});
