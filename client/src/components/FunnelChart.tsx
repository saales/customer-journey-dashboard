
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FunnelStep } from "../api";
import { formatNumber, formatPercent } from "../format";
import { ExportButton } from "./ExportButton";

const COLORS = [
  "var(--chart-blue)",
  "var(--chart-indigo)",
  "var(--chart-light-blue)",
  "var(--chart-sky)",
  "var(--chart-teal)",
];

export function FunnelChart({
  funnel,
  suffix,
}: {
  funnel: FunnelStep[];
  suffix: string;
}) {
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div className="chart-heading">
          <h2>Percorso di conversione</h2>
          <span className="chart-caption">
  Dalla prima visita alla conversione in cliente
</span>
        </div>

        <ExportButton
          filename={`funnel_${suffix}.csv`}
          headers={[
            "Fase",
            "Clienti",
            "Conversione dalla fase precedente (%)",
            "Conversione dalle visite (%)",
          ]}
          rows={funnel.map((s) => [
            s.label,
            s.count,
            s.conversionFromPrevious,
            s.conversionFromVisit,
          ])}
        />
      </div>

      <p className="hint">
        Il grafico mostra quanti clienti raggiungono ogni fase.
        Le percentuali indicano il passaggio dalla fase precedente.
      </p>

      <div
        className="chart-container funnel-chart-container"
        role="img"
        aria-label="Grafico a barre del funnel di conversione, dalle visite ai clienti"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={funnel}
            layout="vertical"
            margin={{ top: 8, right: 95, bottom: 8, left: 5 }}
            barCategoryGap="22%"
          >
            <XAxis type="number" hide />

            <YAxis
              type="category"
              dataKey="label"
              width={100}
              tickLine={false}
              axisLine={false}
              tick={{
                fill: "var(--text-secondary)",
                fontSize: 12,
                fontWeight: 500,
              }}
            />

            <Tooltip
              cursor={{ fill: "var(--chart-hover)" }}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                color: "var(--text-primary)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
              }}
              formatter={(value: number, _name, item) => [
                `${formatNumber(value)} (${formatPercent(
                  item.payload.conversionFromVisit
                )} delle visite)`,
                "Clienti",
              ]}
            />

            <Bar
              dataKey="count"
              radius={[0, 8, 8, 0]}
              barSize={30}
              animationDuration={900}
            >
              {funnel.map((_, i) => (
                <Cell
                  key={i}
                  fill={COLORS[i % COLORS.length]}
                />
              ))}

              <LabelList
                content={(props) => {
                  const {
                    x,
                    y,
                    width,
                    height,
                    index,
                  } = props as {
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                    index: number;
                  };

                  const step = funnel[index];

                  if (!step) return null;

                  return (
                    <text
                      x={Number(x) + Number(width) + 9}
                      y={Number(y) + Number(height) / 2}
                      dominantBaseline="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--text-primary)"
                    >
                      {formatNumber(step.count)}
                      {index > 0
                        ? ` (${formatPercent(step.conversionFromPrevious)})`
                        : ""}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
