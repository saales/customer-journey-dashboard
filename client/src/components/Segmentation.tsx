
import { useState } from "react";
import {
  Users,
  Target,
  PieChart,
  CalendarDays,
  Layers3,
  X,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import {
  api,
  type Query,
  type SegmentAnalysis,
  type SegmentCustomer,
  type SegmentDimension,
  type SegmentRow,
} from "../api";

import { useAsync } from "../useAsync";
import { formatNumber, formatPercent } from "../format";

interface SegmentationProps {
  query: Query | null;
  channels: string[];
}

interface SelectedSegment {
  dimension: SegmentDimension;
  id: string;
  label: string;
}

const sections: {
  dimension: SegmentDimension;
  title: string;
  description: string;
  icon: typeof Users;
  getRows: (data: SegmentAnalysis) => SegmentRow[];
}[] = [
  {
    dimension: "channel",
    title: "Segmenti per canale",
    description: "Distribuzione dei clienti in base al canale di acquisizione.",
    icon: Users,
    getRows: (data) => data.channels,
  },
  {
    dimension: "stage",
    title: "Segmenti per fase funnel",
    description: "Ogni cliente viene assegnato alla fase più avanzata raggiunta.",
    icon: Target,
    getRows: (data) => data.stages,
  },
  {
    dimension: "period",
    title: "Segmenti per periodo",
    description: "Distribuzione dei clienti in base al periodo di acquisizione.",
    icon: CalendarDays,
    getRows: (data) => data.periods,
  },
  {
    dimension: "combination",
    title: "Segmenti combinati",
    description: "Analisi dei clienti attraverso combinazioni di criteri.",
    icon: Layers3,
    getRows: (data) => data.combinations,
  },
];

function SegmentTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: SegmentRow[];
  selectedId: string | null;
  onSelect: (row: SegmentRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        Nessun segmento disponibile per i filtri selezionati.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Segmento</th>
            <th className="num">Clienti</th>
            <th className="num">Quota</th>
            <th>Conversione</th>
            <th>Dettaglio</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={selectedId === row.id ? "selected" : ""}
            >
              <td>
                <strong>{row.label}</strong>
              </td>

              <td className="num">
                {formatNumber(row.customers)}
              </td>

              <td className="num">
                {formatPercent(row.share)}
              </td>

              <td>
                <div className="bar-cell">
                  <div className="bar-track">
                    <div
                      className="bar"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, row.conversionRate),
                        )}%`,
                      }}
                    />
                  </div>
                  <span>{formatPercent(row.conversionRate)}</span>
                </div>
              </td>

              <td>
                <button
                  type="button"
                  className="segment-open-button"
                  onClick={() => onSelect(row)}
                  aria-label={`Visualizza i clienti del segmento ${row.label}`}
                  aria-pressed={selectedId === row.id}
                >
                  Visualizza clienti
                  <ChevronRight size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SegmentDetail({
  selected,
  customers,
  loading,
  error,
  onClose,
}: {
  selected: SelectedSegment;
  customers: SegmentCustomer[] | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="segment-detail">
      <div className="card-head">
        <div>
          <h3>Clienti del segmento</h3>
          <p className="subtitle">{selected.label}</p>
        </div>

        <button
          type="button"
          className="segment-close-button"
          onClick={onClose}
        >
          <X size={16} />
          Chiudi
        </button>
      </div>

      {loading && (
        <p className="loading">Caricamento dei clienti…</p>
      )}

      {error && (
        <div className="error">
          Impossibile caricare i clienti: {error}
        </div>
      )}

      {!loading && !error && customers?.length === 0 && (
        <div className="empty">
          Nessun cliente presente in questo segmento.
        </div>
      )}

      {!loading && !error && customers && customers.length > 0 && (
        <>
          <p className="hint">
            {formatNumber(customers.length)} clienti appartenenti al segmento.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Canale</th>
                  <th>Data acquisizione</th>
                  <th>Fase raggiunta</th>
                </tr>
              </thead>

              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.id}</strong>
                    </td>
                    <td>{customer.channel}</td>
                    <td>
                      {customer.createdAt
                        ? new Date(
                            `${customer.createdAt.slice(0, 10)}T00:00:00`,
                          ).toLocaleDateString("it-IT")
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={
                          customer.stageActive
                            ? "stage-badge"
                            : "stage-badge inactive"
                        }
                      >
                        {customer.stageLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function Segmentation({
  query,
  channels,
}: SegmentationProps) {
  const [selected, setSelected] = useState<SelectedSegment | null>(null);
  const [stageFilter, setStageFilter] = useState("");

  const analysis = useAsync(
    (signal) =>
      query
        ? api.segments(query, signal)
        : Promise.resolve(null),
    [query?.from, query?.to, query?.channel],
  );

  const detailQuery =
    query && selected
      ? {
          ...query,
          dimension: selected.dimension,
          id: selected.id,
        }
      : null;

  const detail = useAsync(
    (signal) =>
      detailQuery
        ? api.segmentCustomers(detailQuery, signal)
        : Promise.resolve([] as SegmentCustomer[]),
    [
      detailQuery?.from,
      detailQuery?.to,
      detailQuery?.channel,
      detailQuery?.dimension,
      detailQuery?.id,
    ],
  );

  function selectSegment(
    dimension: SegmentDimension,
    row: SegmentRow,
  ) {
    setSelected({
      dimension,
      id: row.id,
      label: row.label,
    });
  }

  if (!query) {
    return (
      <div className="card empty">
        Seleziona un intervallo temporale valido per visualizzare la
        segmentazione.
      </div>
    );
  }

  if (analysis.loading && !analysis.data) {
    return (
      <p className="loading">
        Caricamento dell'analisi dei segmenti…
      </p>
    );
  }

  if (analysis.error) {
    return (
      <div className="error">
        Impossibile caricare la segmentazione: {analysis.error}
      </div>
    );
  }

  if (!analysis.data) {
    return (
      <div className="card empty">
        Nessun dato disponibile per la segmentazione.
      </div>
    );
  }

  const data = analysis.data;

  return (
    <div className="segmentation-page">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Customer Segmentation</h2>
            <p className="subtitle">
              Analisi dinamica della base clienti per canale, fase funnel,
              periodo e combinazione di criteri.
            </p>
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => {
              analysis.refresh();
              if (selected) detail.refresh();
            }}
            aria-label="Aggiorna segmentazione"
          >
            <RefreshCw size={17} />
            <span>Aggiorna</span>
          </button>
        </div>

        <div className="segmentation-summary">
          <div className="segmentation-summary-item">
            <Users size={20} />
            <div>
              <span>Clienti analizzati</span>
              <strong>{formatNumber(data.totalCustomers)}</strong>
            </div>
          </div>

          <div className="segmentation-summary-item">
            <PieChart size={20} />
            <div>
              <span>Segmentazioni disponibili</span>
              <strong>4</strong>
            </div>
          </div>
        </div>

        <p className="hint">
          I segmenti vengono ricalcolati automaticamente in base ai dati
          disponibili e alla configurazione attiva del funnel. La quota
          indica il peso del segmento sul totale dei clienti filtrati.
        </p>
      </div>

      <div className="dashboard-toolbar">
        <label htmlFor="segment-channel-filter">
          Canale di acquisizione
        </label>

        <select
          id="segment-channel-filter"
          value={query.channel ?? ""}
          disabled
          aria-label="Canale ereditato dai filtri globali"
        >
          <option value="">Tutti i canali</option>
          {channels.map((channel) => (
            <option key={channel} value={channel}>
              {channel}
            </option>
          ))}
        </select>

        <label htmlFor="segment-stage-filter">
          Visualizzazione fasi
        </label>

        <select
          id="segment-stage-filter"
          value={stageFilter}
          onChange={(event) => setStageFilter(event.target.value)}
        >
          <option value="">Tutte le fasi</option>
          <option value="active">Solo fasi attive</option>
        </select>
      </div>

      {sections.map((section) => {
        const Icon = section.icon;
        const rows = section.getRows(data);

        const filteredRows =
          section.dimension === "stage" && stageFilter === "active"
            ? rows.filter((row) => row.id !== "inactive")
            : rows;

        const selectedInSection =
          selected?.dimension === section.dimension;

        return (
          <div className="card" key={section.dimension}>
            <div className="card-head">
              <div>
                <h2>
                  <Icon
                    size={19}
                    style={{
                      verticalAlign: "middle",
                      marginRight: 8,
                    }}
                  />
                  {section.title}
                </h2>

                <p className="subtitle">
                  {section.description}
                </p>
              </div>
            </div>

            <SegmentTable
              rows={filteredRows}
              selectedId={
                selectedInSection ? selected.id : null
              }
              onSelect={(row) =>
                selectSegment(section.dimension, row)
              }
            />

            {selectedInSection && (
              <SegmentDetail
                selected={selected}
                customers={detail.data}
                loading={detail.loading}
                error={detail.error}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
