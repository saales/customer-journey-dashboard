// jsdom non implementa ResizeObserver, richiesto da ResponsiveContainer di Recharts.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// Test storage is explicit so the suite behaves the same across Node versions.
const storageData = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return storageData.size; },
  clear() { storageData.clear(); },
  getItem(key) { return storageData.get(String(key)) ?? null; },
  key(index) { return [...storageData.keys()][index] ?? null; },
  removeItem(key) { storageData.delete(String(key)); },
  setItem(key, value) { storageData.set(String(key), String(value)); },
};
Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage });
