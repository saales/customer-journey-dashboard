import { useMemo, useState } from "react";
import { api } from "./api";
import { ChannelTable } from "./components/ChannelTable";
import { Filters } from "./components/Filters";
import { FunnelChart } from "./components/FunnelChart";
import { KpiCards } from "./components/KpiCards";
import { TrendChart } from "./components/TrendChart";
import { startOfPeriod } from "./format";
import { useAsync } from "./useAsync";

export default function App() {
  const [months, setMonths] = useState(12);
  const [channel, setChannel] = useState("");

  const meta = useAsync((s) => api.meta(s), []);

  const query = useMemo(() => {
    if (!meta.data) return null;
    const to = meta.data.maxDate;
    return { from: startOfPeriod(to, months), to, channel: channel || undefined };
  }, [meta.data, months, channel]);

  const summary = useAsync((s) => (query ? api.summary(query, s) : Promise.resolve(null)), [query]);
  const channels = useAsync((s) => (query ? api.channels(query, s) : Promise.resolve(null)), [query?.from, query?.to]);
  const trend = useAsync((s) => (query ? api.timeseries(query, s) : Promise.resolve(null)), [query]);

  const error = meta.error ?? summary.error ?? channels.error ?? trend.error;

  return (
    <div className="page">
      <header>
        <div>
          <h1>Customer Journey Dashboard</h1>
          <p className="subtitle">Dal primo contatto all'acquisto: dove si perdono i clienti e quali canali convertono meglio.</p>
        </div>
        {meta.data && <Filters channels={meta.data.channels} months={months} channel={channel} onMonths={setMonths} onChannel={setChannel} />}
      </header>

      <p className="notice">Dati sintetici generati a scopo dimostrativo: nessun dato reale di clienti o aziende.</p>

      {error && <div className="error">Impossibile caricare i dati: {error}</div>}

      {summary.data && <KpiCards kpis={summary.data.kpis} />}

      <div className="grid">
        {summary.data && <FunnelChart funnel={summary.data.funnel} />}
        {trend.data && <TrendChart data={trend.data} />}
      </div>

      {channels.data && <ChannelTable rows={channels.data} selected={channel} />}

      {!error && (meta.loading || summary.loading) && <p className="loading">Caricamento…</p>}
    </div>
  );
}
