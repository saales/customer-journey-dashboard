import type { Summary } from "../api";
import { formatNumber, formatPercent } from "../format";

export function KpiCards({ kpis }: { kpis: Summary["kpis"] }) {
  const items = [
    { label: "Visite iniziali", value: formatNumber(kpis.visits), description: "Clienti entrati nel percorso nel periodo selezionato" },
    { label: "Contatti acquisiti", value: formatNumber(kpis.leads), description: "Contatti acquisiti" },
    { label: "Clienti", value: formatNumber(kpis.customers), description: "Clienti convertiti" },
    { label: "Conversione", value: formatPercent(kpis.conversionRate), description: "Da visita iniziale ad acquisto" },
    {
      label: "Giorni medi all'acquisto",
      value: kpis.avgDaysToCustomer === null ? "—" : String(kpis.avgDaysToCustomer).replace(".", ","),
      description: "Tempo medio di conversione",
    },
  ];

  return (
    <dl className="key-figures">
      {items.map((item) => (
        <div className="key-figure" key={item.label}>
          <dt>{item.label}</dt>
          <dd className="key-value">{item.value}</dd>
          <dd className="key-note">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
