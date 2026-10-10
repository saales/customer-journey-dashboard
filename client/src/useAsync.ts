import { useEffect, useState } from "react";

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Esegue una chiamata asincrona e la riesegue (annullando la precedente) quando cambiano le dipendenze. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: e instanceof Error ? e.message : "Errore sconosciuto" });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
