// jsdom non implementa ResizeObserver, richiesto da ResponsiveContainer di Recharts.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
