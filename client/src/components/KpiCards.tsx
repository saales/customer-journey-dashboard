import type { Summary } from "../api";
import { formatNumber, formatPercent } from "../format";

export function KpiCards({ kpis }: { kpis: Summary["kpis"] }) {
  const items = [
    { label: "Visite", value: formatNumber(kpis.visits) },
    { label: "Lead", value: formatNumber(kpis.leads) },
    { label: "Clienti", value: formatNumber(kpis.customers) },
    { label: "Conversione visita → cliente", value: formatPercent(kpis.conversionRate) },
    { label: "Giorni medi all'acquisto", value: kpis.avgDaysToCustomer === null ? "—" : String(kpis.avgDaysToCustomer).replace(".", ",") },
  ];
  return (
    <div className="kpis">
      {items.map((k) => (
        <div className="card kpi" key={k.label}>
          <span className="kpi-label">{k.label}</span>
          <span className="kpi-value">{k.value}</span>
        </div>
      ))}
    </div>
  );
}
