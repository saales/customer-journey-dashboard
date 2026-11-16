
import { AppLayout } from "./components/AppLayout";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { ChannelTable } from "./components/ChannelTable";
import { Filters, type Preset } from "./components/Filters";
import { FunnelChart } from "./components/FunnelChart";
import { KpiCards } from "./components/KpiCards";
import { TrendChart } from "./components/TrendChart";
import { startOfPeriod } from "./format";
import { useAsync } from "./useAsync";
// Le sezioni meno frequenti vengono caricate alla prima apertura.
const CustomerManagement = lazy(() =>
  import("./components/CustomerManagement").then((module) => ({ default: module.CustomerManagement })),
);
const DataImport = lazy(() =>
  import("./components/DataImport").then((module) => ({ default: module.DataImport })),
);
const FunnelSettings = lazy(() =>
  import("./components/FunnelSettings").then((module) => ({ default: module.FunnelSettings })),
);
const Segmentation = lazy(() =>
  import("./components/Segmentation").then((module) => ({ default: module.Segmentation })),
);
const Comparisons = lazy(() =>
  import("./components/Comparisons").then((module) => ({ default: module.Comparisons })),
);
const MemberManagement = lazy(() =>
  import("./components/MemberManagement").then((module) => ({ default: module.MemberManagement })),
);
const AuditLog = lazy(() =>
  import("./components/AuditLog").then((module) => ({ default: module.AuditLog })),
);
const OrganizationSettings = lazy(() =>
  import("./components/OrganizationSettings").then((module) => ({ default: module.OrganizationSettings })),
);
const AccountSettings = lazy(() =>
  import("./components/AccountSettings").then((module) => ({ default: module.AccountSettings })),
);

function DeferredSection({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="section-loading" role="status" aria-live="polite">
          Caricamento della sezione in corso…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

interface AppProps { onLogout?: () => Promise<void>; organizationRole?: "admin" | "editor" | "analyst" | "viewer" | null; }

export default function App({ onLogout, organizationRole = null }: AppProps = {}) {
  const [preset, setPreset] = useState<Preset>(12);
  const [channel, setChannel] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const canWrite = organizationRole === "admin" || organizationRole === "editor";
  const canExport = organizationRole === "admin" || organizationRole === "editor" || organizationRole === "analyst";
  const visibleSections = organizationRole === "admin"
    ? ["dashboard", "customers", "import", "analytics", "segmentation", "comparisons", "settings", "audit"] as const
    : canWrite
      ? ["dashboard", "customers", "import", "analytics", "segmentation", "comparisons", "settings"] as const
      : ["dashboard", "customers", "analytics", "segmentation", "comparisons", "settings"] as const;

  const meta = useAsync((s) => api.meta(s), []);
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const maxDate = meta.data?.maxDate ?? fallbackDate;
  const minDate = meta.data?.minDate ?? maxDate;

  function handlePreset(next: Preset) {
    if (next === "custom" && meta.data && !customFrom && !customTo) {
      const months = preset === "custom" ? 12 : preset;
      setCustomFrom(startOfPeriod(maxDate, months));
      setCustomTo(maxDate);
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

    const to = maxDate;

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
      minDate={minDate}
      maxDate={maxDate}
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
    <CustomerManagement onDataChange={refreshDashboard} serverExportEnabled={canExport} readOnly={!canWrite} />
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

  const auditSection = organizationRole === "admin" ? <AuditLog /> : null;

  const settingsSection = (
    <div>
      <AccountSettings />
      <FunnelSettings onDataChange={refreshDashboard} readOnly={!canWrite} />
      {organizationRole === "admin" && <><OrganizationSettings /><MemberManagement /></>}

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
      onLogout={onLogout}
      visibleSections={[...visibleSections]}
      sections={{
        dashboard: dashboardSection,
        customers: <DeferredSection>{customersSection}</DeferredSection>,
        analytics: analyticsSection,
        segmentation: <DeferredSection>{segmentationSection}</DeferredSection>,
        comparisons: <DeferredSection>{comparisonsSection}</DeferredSection>,
        settings: <DeferredSection>{settingsSection}</DeferredSection>,
        import: <DeferredSection>{importSection}</DeferredSection>,
        audit: <DeferredSection>{auditSection}</DeferredSection>,
      }}
    >
      {dashboardSection}
    </AppLayout>
  );
}
