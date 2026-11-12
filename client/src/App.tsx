
import { AppLayout } from "./components/AppLayout";
import { useMemo, useState } from "react";
import { api } from "./api";
import { ChannelTable } from "./components/ChannelTable";
import { Filters, type Preset } from "./components/Filters";
import { FunnelChart } from "./components/FunnelChart";
import { KpiCards } from "./components/KpiCards";
import { TrendChart } from "./components/TrendChart";
import { startOfPeriod } from "./format";
import { useAsync } from "./useAsync";
import { CustomerManagement } from "./components/CustomerManagement";
import { DataImport } from "./components/DataImport";
import { FunnelSettings } from "./components/FunnelSettings";
import { Segmentation } from "./components/Segmentation";
import { Comparisons } from "./components/Comparisons";

export default function App() {
  const [preset, setPreset] = useState<Preset>(12);
  const [channel, setChannel] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const meta = useAsync((s) => api.meta(s), []);

  function handlePreset(next: Preset) {
    if (next === "custom" && meta.data && !customFrom && !customTo) {
      const months = preset === "custom" ? 12 : preset;
      setCustomFrom(startOfPeriod(meta.data.maxDate, months));
      setCustomTo(meta.data.maxDate);
    }

    setPreset(next);
  }

  const rangeError =
    preset === "custom" &&
    customFrom !== "" &&
    customTo !== "" &&
    customFrom > customTo;

  const query = useMemo(() => {
    if (!meta.data) return null;

    const ch = channel || undefined;

    if (preset === "custom") {
      if (!customFrom || !customTo || customFrom > customTo) {
        return null;
      }

      return {
        from: customFrom,
        to: customTo,
        channel: ch,
      };
    }

    const to = meta.data.maxDate;

    return {
      from: startOfPeriod(to, preset),
      to,
      channel: ch,
    };
  }, [meta.data, preset, channel, customFrom, customTo]);

  const summary = useAsync(
    (s) => (query ? api.summary(query, s) : Promise.resolve(null)),
    [query],
  );

  const channels = useAsync(
    (s) => (query ? api.channels(query, s) : Promise.resolve(null)),
    [query?.from, query?.to, query?.channel],
  );

  const trend = useAsync(
    (s) => (query ? api.timeseries(query, s) : Promise.resolve(null)),
    [query],
  );

  function refreshDashboard() {
    meta.refresh();
    summary.refresh();
    channels.refresh();
    trend.refresh();
  }

  const error =
    meta.error ??
    summary.error ??
    channels.error ??
    trend.error;

  const noData =
    summary.data !== null &&
    summary.data.kpis.visits === 0;

  const suffix = query
    ? `${query.from}_${query.to}${query.channel ? `_${query.channel}` : ""}`
    : "";

  const filters = meta.data && (
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
  );

  const statusMessages = (
    <>
      {rangeError && (
        <div className="error">
          La data di inizio deve precedere la data di fine.
        </div>
      )}

      {error && (
        <div className="error">
          Impossibile caricare i dati: {error}
        </div>
      )}

      {!error && !rangeError && (meta.loading || summary.loading) && (
        <p className="loading">
          Caricamento dei dati in corso…
        </p>
      )}
    </>
  );

  const dashboardSection = (
    <>
      <p className="notice">
        Dati sintetici generati a scopo dimostrativo: nessun dato reale di
        clienti o aziende.
      </p>

      {statusMessages}

      {noData && (
        <div className="card empty">
          Nessun dato per il periodo e il canale selezionati.
        </div>
      )}

      {summary.data && !noData && (
        <KpiCards kpis={summary.data.kpis} />
      )}
    </>
  );

  const analyticsSection = (
    <>
      <div className="dashboard-toolbar">
        {filters}
      </div>

      {statusMessages}

      {noData && (
        <div className="card empty">
          Nessun dato per il periodo e il canale selezionati.
        </div>
      )}

      {!noData && (
        <div className="grid">
          {summary.data && (
            <FunnelChart
              funnel={summary.data.funnel}
              suffix={suffix}
            />
          )}

          {trend.data && (
            <TrendChart
              data={trend.data}
              suffix={suffix}
            />
          )}
        </div>
      )}

      {channels.data && !noData && (
        <ChannelTable
          rows={channels.data}
          selected={channel}
          suffix={suffix}
        />
      )}
    </>
  );

  const customersSection = (
    <CustomerManagement onDataChange={refreshDashboard} />
  );

  const importSection = (
    <DataImport onDataChange={refreshDashboard} />
  );

  const segmentationSection = (
    <Segmentation
      query={query}
      channels={meta.data?.channels ?? []}
    />
  );

  const comparisonsSection = (
    <div>
      <div className="dashboard-toolbar">
        {filters}
      </div>

      {statusMessages}

      <Comparisons query={query} />
    </div>
  );

  const settingsSection = (
    <div>
      <FunnelSettings onDataChange={refreshDashboard} />

      <div className="card">
        <h2>Preferenze dell'interfaccia</h2>
        <p className="subtitle">
          Puoi cambiare il tema chiaro o scuro utilizzando il pulsante
          nell'intestazione della dashboard.
        </p>
      </div>
    </div>
  );

  return (
    <AppLayout
      sections={{
        dashboard: dashboardSection,
        customers: customersSection,
        analytics: analyticsSection,
        segmentation: segmentationSection,
        comparisons: comparisonsSection,
        settings: settingsSection,
        import: importSection,
      }}
    >
      {dashboardSection}
    </AppLayout>
  );
}
