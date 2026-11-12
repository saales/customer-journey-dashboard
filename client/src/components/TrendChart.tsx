
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthPoint } from "../api";
import {
  formatMonth,
  formatNumber,
  formatPercent,
} from "../format";
import { ExportButton } from "./ExportButton";

export function TrendChart({
  data,
  suffix,
}: {
  data: MonthPoint[];
  suffix: string;
}) {
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div className="chart-heading">
          <h2>Andamento mensile</h2>
          <span className="chart-caption">
            Risultati e conversioni nel tempo
          </span>
        </div>

        <ExportButton
          filename={`andamento_${suffix}.csv`}
          title="Analisi dell'andamento mensile"
          description="Andamento mensile delle visite, dei clienti acquisiti e del tasso di conversione nel percorso cliente."
          headers={[
            "Mese",
            "Visite",
            "Clienti",
            "Conversione (%)",
          ]}
          rows={data.map((m) => [
            m.month,
            m.visits,
            m.customers,
            m.conversion,
          ])}
        />
      </div>

      <p className="hint">
        Numero di visite e tasso di conversione in clienti,
        analizzati per mese di ingresso nel percorso.
      </p>

      <div
        className="chart-container trend-chart-container"
        role="img"
        aria-label="Grafico dell'andamento mensile di visite e conversione"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 8, left: 0, bottom: 5 }}
          >
            <CartesianGrid
              stroke="var(--chart-grid)"
              strokeDasharray="4 4"
              vertical={false}
            />

            <XAxis
              dataKey="month"
              tickFormatter={formatMonth}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-color)" }}
              minTickGap={18}
            />

            <YAxis
              yAxisId="left"
              tickFormatter={formatNumber}
              width={48}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />

            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => `${v}%`}
              width={45}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />

            <Tooltip
              labelFormatter={(label) => formatMonth(String(label))}
              formatter={(value: number, name) =>
                name === "Conversione"
                  ? formatPercent(value)
                  : formatNumber(value)
              }
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                color: "var(--text-primary)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
              }}
              labelStyle={{
                color: "var(--text-primary)",
                fontWeight: 700,
              }}
            />

            <Legend
              wrapperStyle={{
                color: "var(--text-secondary)",
                fontSize: "12px",
                paddingTop: "8px",
              }}
            />

            <Bar
              yAxisId="left"
              dataKey="visits"
              name="Visite"
              fill="var(--chart-light-blue)"
              radius={[6, 6, 0, 0]}
              maxBarSize={42}
              animationDuration={900}
            />

            <Line
              yAxisId="right"
              type="monotone"
              dataKey="conversion"
              name="Conversione"
              stroke="var(--chart-teal)"
              strokeWidth={3}
              dot={{
                r: 3,
                fill: "var(--surface)",
                stroke: "var(--chart-teal)",
                strokeWidth: 2,
              }}
              activeDot={{ r: 6 }}
              animationDuration={1100}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
