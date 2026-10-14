import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthPoint } from "../api";
import { formatMonth, formatNumber, formatPercent } from "../format";
import { ExportButton } from "./ExportButton";

export function TrendChart({ data, suffix }: { data: MonthPoint[]; suffix: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Andamento mensile</h2>
        <ExportButton
          filename={`andamento_${suffix}.csv`}
          headers={["Mese", "Visite", "Clienti", "Conversione (%)"]}
          rows={data.map((m) => [m.month, m.visits, m.customers, m.conversion])}
        />
      </div>
      <p className="hint">Visite (barre) e tasso di conversione in clienti (linea), per mese di prima visita.</p>
      <div style={{ height: 300 }} role="img" aria-label="Grafico dell'andamento mensile di visite e conversione">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ left: 0, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonth} />
            <YAxis yAxisId="left" tickFormatter={formatNumber} width={50} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} width={45} />
            <Tooltip
              labelFormatter={(l) => formatMonth(String(l))}
              formatter={(value: number, name) => (name === "Conversione" ? formatPercent(value) : formatNumber(value))}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="visits" name="Visite" fill="#93c5fd" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="conversion" name="Conversione" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
