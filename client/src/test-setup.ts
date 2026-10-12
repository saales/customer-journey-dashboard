// Polyfill per incompatibilità undici/jsdom in Vitest
const globalAny = globalThis as any;

if (typeof globalAny.webidl === 'undefined') {
  globalAny.webidl = { util: {} };
}

if (!globalAny.webidl.util) {
  globalAny.webidl.util = {};
}

if (typeof globalAny.webidl.util.markAsUncloneable !== 'function') {
  globalAny.webidl.util.markAsUncloneable = () => {};
}

// Il tuo stub esistente per ResizeObserver
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
