
import type { Summary } from "../api";
import { formatNumber, formatPercent } from "../format";
import {
  Eye,
  UserPlus,
  Users,
  TrendingUp,
  Clock,
} from "lucide-react";

export function KpiCards({ kpis }: { kpis: Summary["kpis"] }) {
  const items = [
    {
      label: "Visite iniziali",
      value: formatNumber(kpis.visits),
      description: "Clienti entrati nel funnel nel periodo selezionato",
      icon: Eye,
      color: "blue",
    },
    {
      label: "Contatti acquisiti",
      value: formatNumber(kpis.leads),
      description: "Contatti acquisiti",
      icon: UserPlus,
      color: "purple",
    },
    {
      label: "Clienti",
      value: formatNumber(kpis.customers),
      description: "Clienti convertiti",
      icon: Users,
      color: "teal",
    },
    {
      label: "Conversione",
      value: formatPercent(kpis.conversionRate),
      description: "Da visita iniziale ad acquisto",
      icon: TrendingUp,
      color: "green",
    },
    {
      label: "Giorni medi all'acquisto",
      value:
        kpis.avgDaysToCustomer === null
          ? "—"
          : String(kpis.avgDaysToCustomer).replace(".", ","),
      description: "Tempo medio di conversione",
      icon: Clock,
      color: "orange",
    },
  ];

  return (
    <div className="kpis">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div className={`card kpi kpi-${item.color}`} key={item.label}>
            <div className="kpi-top">
              <span className="kpi-label">{item.label}</span>
              <div className="kpi-icon">
                <Icon size={21} strokeWidth={2} />
              </div>
            </div>

            <span className="kpi-value">{item.value}</span>

            <span className="kpi-description">
              {item.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}
