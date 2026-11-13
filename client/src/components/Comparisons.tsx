
import { useMemo } from "react";
import { api, type Query, type SegmentRow } from "../api";
import { useAsync } from "../useAsync";

interface ComparisonsProps {
  query: Query | null;
}

function previousPeriod(query: Query): Query {
  const from = new Date(`${query.from}T00:00:00Z`);
  const to = new Date(`${query.to}T00:00:00Z`);

  const duration =
    Math.round((to.getTime() - from.getTime()) / 86400000) + 1;

  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);

  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - duration + 1);

  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
    channel: query.channel,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("it-IT").format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatPercentagePoints(
  current: number,
  previous: number,
): string {
  const difference = current - previous;
  const sign = difference > 0 ? "+" : "";

  return `${sign}${difference.toFixed(2).replace(".", ",")} pp`;
}

function variation(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0 ? "0%" : "Nuovo";
  }

  const change = ((current - previous) / previous) * 100;
  const sign = change > 0 ? "+" : "";

  return `${sign}${change.toFixed(1).replace(".", ",")}%`;
}

function variationClass(current: number, previous: number): string {
  if (current > previous) return "comparison-positive";
  if (current < previous) return "comparison-negative";
  return "comparison-neutral";
}

function KpiComparison({
  label,
  current,
  previous,
  percentage = false,
}: {
  label: string;
  current: number;
  previous: number;
  percentage?: boolean;
}) {
  return (
    <div className="card comparison-kpi">
      <p className="subtitle">{label}</p>

      <h2>
        {percentage ? formatPercent(current) : formatNumber(current)}
      </h2>

      {percentage ? (
        <>
          <div className={variationClass(current, previous)}>
            {formatPercentagePoints(current, previous)}
          </div>
          <p className="subtitle">
            Variazione relativa: {variation(current, previous)}
          </p>
        </>
      ) : (
        <div className={variationClass(current, previous)}>
          {variation(current, previous)} rispetto al periodo precedente
        </div>
      )}

      <p className="subtitle">
        Periodo precedente:{" "}
        {percentage ? formatPercent(previous) : formatNumber(previous)}
      </p>
    </div>
  );
}

function SegmentComparisonTable({
  title,
  current,
  previous,
}: {
  title: string;
  current: SegmentRow[];
  previous: SegmentRow[];
}) {
  const rows = useMemo(() => {
    const currentById = new Map(
      current.map((item) => [item.id, item]),
    );

    const previousById = new Map(
      previous.map((item) => [item.id, item]),
    );

    const allIds = new Set([
      ...currentById.keys(),
      ...previousById.keys(),
    ]);

    return Array.from(allIds).map((id) => {
      const currentItem = currentById.get(id);
      const previousItem = previousById.get(id);

      return {
        id,
        label: currentItem?.label ?? previousItem?.label ?? id,
        currentCustomers: currentItem?.customers ?? 0,
        previousCustomers: previousItem?.customers ?? 0,
        currentConversion: currentItem?.conversionRate ?? 0,
        previousConversion: previousItem?.conversionRate ?? 0,
        existsCurrently: Boolean(currentItem),
        existsPreviously: Boolean(previousItem),
      };
    });
  }, [current, previous]);

  return (
    <div className="card">
      <h2>{title}</h2>

      {rows.length === 0 ? (
        <p className="subtitle">Nessun dato disponibile.</p>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Segmento</th>
                <th>Clienti attuali</th>
                <th>Clienti precedenti</th>
                <th>Variazione</th>
                <th>Conversione attuale</th>
                <th>Conversione precedente</th>
                <th>Differenza conversione</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.label}
                    {!row.existsCurrently && (
                      <span className="subtitle">
                        {" "} (non presente attualmente)
                      </span>
                    )}
                  </td>

                  <td>{formatNumber(row.currentCustomers)}</td>

                  <td>{formatNumber(row.previousCustomers)}</td>

                  <td>
                    <span
                      className={variationClass(
                        row.currentCustomers,
                        row.previousCustomers,
                      )}
                    >
                      {variation(
                        row.currentCustomers,
                        row.previousCustomers,
                      )}
                    </span>
                  </td>

                  <td>
                    {row.existsCurrently
                      ? formatPercent(row.currentConversion)
                      : "—"}
                  </td>

                  <td>
                    {row.existsPreviously
                      ? formatPercent(row.previousConversion)
                      : "—"}
                  </td>

                  <td>
                    {row.existsCurrently && row.existsPreviously
                      ? formatPercentagePoints(
                          row.currentConversion,
                          row.previousConversion,
                        )
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Comparisons({ query }: ComparisonsProps) {
  const previousQuery = useMemo(
    () => (query ? previousPeriod(query) : null),
    [query],
  );

  const currentSummary = useAsync(
    (signal) =>
      query ? api.summary(query, signal) : Promise.resolve(null),
    [query],
  );

  const previousSummary = useAsync(
    (signal) =>
      previousQuery
        ? api.summary(previousQuery, signal)
        : Promise.resolve(null),
    [previousQuery],
  );

  const currentChannels = useAsync(
    (signal) =>
      query ? api.channels(query, signal) : Promise.resolve(null),
    [query],
  );

  const previousChannels = useAsync(
    (signal) =>
      previousQuery
        ? api.channels(previousQuery, signal)
        : Promise.resolve(null),
    [previousQuery],
  );

  const currentSegments = useAsync(
    (signal) =>
      query ? api.segments(query, signal) : Promise.resolve(null),
    [query],
  );

  const previousSegments = useAsync(
    (signal) =>
      previousQuery
        ? api.segments(previousQuery, signal)
        : Promise.resolve(null),
    [previousQuery],
  );

  if (!query || !previousQuery) {
    return (
      <div className="card empty">
        Seleziona un intervallo di date valido per visualizzare i confronti.
      </div>
    );
  }

  const loading =
    currentSummary.loading ||
    previousSummary.loading ||
    currentChannels.loading ||
    previousChannels.loading ||
    currentSegments.loading ||
    previousSegments.loading;

  const error =
    currentSummary.error ||
    previousSummary.error ||
    currentChannels.error ||
    previousChannels.error ||
    currentSegments.error ||
    previousSegments.error;

  if (loading) {
    return <p className="loading">Caricamento dei confronti…</p>;
  }

  if (error) {
    return (
      <div className="error">
        Impossibile caricare i confronti: {error}
      </div>
    );
  }

  const current = currentSummary.data;
  const previous = previousSummary.data;

  if (!current || !previous) {
    return (
      <div className="card empty">
        Non sono disponibili dati sufficienti per il confronto.
      </div>
    );
  }

  const currentKpis = current.kpis;
  const previousKpis = previous.kpis;

  const currentChannelRows = currentChannels.data ?? [];
  const previousChannelRows = previousChannels.data ?? [];

  const channelRows = useMemo(() => {
    const currentByChannel = new Map(
      currentChannelRows.map((row) => [row.channel, row]),
    );

    const previousByChannel = new Map(
      previousChannelRows.map((row) => [row.channel, row]),
    );

    const allChannels = new Set([
      ...currentByChannel.keys(),
      ...previousByChannel.keys(),
    ]);

    return Array.from(allChannels).map((channel) => ({
      channel,
      current: currentByChannel.get(channel),
      previous: previousByChannel.get(channel),
    }));
  }, [currentChannelRows, previousChannelRows]);

  const currentSegmentData = currentSegments.data;
  const previousSegmentData = previousSegments.data;

  return (
    <div className="comparison-page">
      <div className="card">
        <h2>Confronto tra periodi</h2>

        <p className="subtitle">
          Periodo attuale: {query.from} – {query.to}
        </p>

        <p className="subtitle">
          Periodo precedente: {previousQuery.from} – {previousQuery.to}
        </p>

        <p className="subtitle">
          I due intervalli hanno la stessa durata. Le variazioni sono
          calcolate rispetto al periodo precedente.
        </p>
      </div>

      <div className="grid">
        <KpiComparison
          label="Visite"
          current={currentKpis.visits}
          previous={previousKpis.visits}
        />

        <KpiComparison
          label="Lead"
          current={currentKpis.leads}
          previous={previousKpis.leads}
        />

        <KpiComparison
          label="Clienti"
          current={currentKpis.customers}
          previous={previousKpis.customers}
        />

        <KpiComparison
          label="Conversione"
          current={currentKpis.conversionRate}
          previous={previousKpis.conversionRate}
          percentage
        />
      </div>

      <div className="card">
        <h2>Confronto per canale</h2>

        {channelRows.length === 0 ? (
          <p className="subtitle">Nessun canale disponibile.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Canale</th>
                  <th>Visite attuali</th>
                  <th>Visite precedenti</th>
                  <th>Clienti attuali</th>
                  <th>Clienti precedenti</th>
                  <th>Conversione attuale</th>
                  <th>Conversione precedente</th>
                  <th>Differenza conversione</th>
                </tr>
              </thead>

              <tbody>
                {channelRows.map(({ channel, current, previous }) => (
                  <tr key={channel}>
                    <td>
                      {channel}
                      {!current && (
                        <span className="subtitle">
                          {" "} (non presente attualmente)
                        </span>
                      )}
                    </td>

                    <td>{formatNumber(current?.visits ?? 0)}</td>

                    <td>{formatNumber(previous?.visits ?? 0)}</td>

                    <td>{formatNumber(current?.customers ?? 0)}</td>

                    <td>{formatNumber(previous?.customers ?? 0)}</td>

                    <td>
                      {current
                        ? formatPercent(current.visitToCustomer)
                        : "—"}
                    </td>

                    <td>
                      {previous
                        ? formatPercent(previous.visitToCustomer)
                        : "—"}
                    </td>

                    <td>
                      {current && previous
                        ? formatPercentagePoints(
                            current.visitToCustomer,
                            previous.visitToCustomer,
                          )
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {currentSegmentData && previousSegmentData && (
        <>
          <SegmentComparisonTable
            title="Confronto dei segmenti per canale"
            current={currentSegmentData.channels}
            previous={previousSegmentData.channels}
          />

          <SegmentComparisonTable
            title="Confronto dei segmenti per fase del percorso"
            current={currentSegmentData.stages}
            previous={previousSegmentData.stages}
          />

          <SegmentComparisonTable
            title="Confronto dei segmenti per periodo di acquisizione"
            current={currentSegmentData.periods}
            previous={previousSegmentData.periods}
          />

          <SegmentComparisonTable
            title="Confronto dei segmenti combinati"
            current={currentSegmentData.combinations}
            previous={previousSegmentData.combinations}
          />
        </>
      )}
    </div>
  );
}
