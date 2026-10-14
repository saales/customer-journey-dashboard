import { useMemo, useState } from "react";
import { api } from "./api";
import { ChannelTable } from "./components/ChannelTable";
import { Filters, type Preset } from "./components/Filters";
import { FunnelChart } from "./components/FunnelChart";
import { KpiCards } from "./components/KpiCards";
import { TrendChart } from "./components/TrendChart";
import { startOfPeriod } from "./format";
import { useAsync } from "./useAsync";

export default function App() {
  const [preset, setPreset] = useState<Preset>(12);
  const [channel, setChannel] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const meta = useAsync((s) => api.meta(s), []);

  function handlePreset(next: Preset) {
    // Passando a "Personalizzato" si parte dall'intervallo attualmente mostrato
    if (next === "custom" && meta.data && !customFrom && !customTo) {
      const months = preset === "custom" ? 12 : preset;
      setCustomFrom(startOfPeriod(meta.data.maxDate, months));
      setCustomTo(meta.data.maxDate);
    }
    setPreset(next);
  }

  const rangeError = preset === "custom" && customFrom !== "" && customTo !== "" && customFrom > customTo;

  const query = useMemo(() => {
    if (!meta.data) return null;
    const ch = channel || undefined;
    if (preset === "custom") {
      if (!customFrom || !customTo || customFrom > customTo) return null;
      return { from: customFrom, to: customTo, channel: ch };
    }
    const to = meta.data.maxDate;
    return { from: startOfPeriod(to, preset), to, channel: ch };
  }, [meta.data, preset, channel, customFrom, customTo]);

  const summary = useAsync((s) => (query ? api.summary(query, s) : Promise.resolve(null)), [query]);
  const channels = useAsync((s) => (query ? api.channels(query, s) : Promise.resolve(null)), [query?.from, query?.to]);
  const trend = useAsync((s) => (query ? api.timeseries(query, s) : Promise.resolve(null)), [query]);

  const error = meta.error ?? summary.error ?? channels.error ?? trend.error;
  const noData = summary.data !== null && summary.data.kpis.visits === 0;
  const suffix = query ? `${query.from}_${query.to}${query.channel ? `_${query.channel}` : ""}` : "";

  return (
    <div className="page">
      <header>
        <div>
          <h1>Customer Journey Dashboard</h1>
          <p className="subtitle">Dal primo contatto all'acquisto: dove si perdono i clienti e quali canali convertono meglio.</p>
        </div>
        {meta.data && (
          <Filters
            channels={meta.data.channels}
            preset={preset}
            channel={channel}
            from={customFrom}
            to={customTo}
            minDate={meta.data.minDate}
            maxDate={meta.data.maxDate}
            onPreset={handlePreset}
            onChannel={setChannel}
            onFrom={setCustomFrom}
            onTo={setCustomTo}
          />
        )}
      </header>

      <p className="notice">Dati sintetici generati a scopo dimostrativo: nessun dato reale di clienti o aziende.</p>

      {rangeError && <div className="error">La data di inizio deve precedere la data di fine.</div>}
      {error && <div className="error">Impossibile caricare i dati: {error}</div>}

      {noData && <div className="card empty">Nessun dato per il periodo e il canale selezionati.</div>}

      {summary.data && !noData && <KpiCards kpis={summary.data.kpis} />}

      {!noData && (
        <div className="grid">
          {summary.data && <FunnelChart funnel={summary.data.funnel} suffix={suffix} />}
          {trend.data && <TrendChart data={trend.data} suffix={suffix} />}
        </div>
      )}

      {channels.data && !noData && <ChannelTable rows={channels.data} selected={channel} suffix={suffix} />}

      {!error && !rangeError && (meta.loading || summary.loading) && <p className="loading">Caricamento…</p>}
    </div>
  );
}
