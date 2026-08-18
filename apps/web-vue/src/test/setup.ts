import { afterEach, beforeAll, vi } from "vitest";

const memoryStorage = createMemoryStorage();

beforeAll(() => {
  if (typeof window === "undefined") {
    return;
  }

  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  memoryStorage.clear();
  document.body.innerHTML = "";
});

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}
