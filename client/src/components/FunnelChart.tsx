import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FunnelStep } from "../api";
import { formatNumber, formatPercent } from "../format";

const COLORS = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#16a34a"];

export function FunnelChart({ funnel }: { funnel: FunnelStep[] }) {
  return (
    <div className="card">
      <h2>Funnel di conversione</h2>
      <p className="hint">Quanti clienti raggiungono ogni stadio. La percentuale indica il passaggio dallo stadio precedente.</p>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 90 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={95} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(value: number, _name, item) => [
                `${formatNumber(value)} (${formatPercent(item.payload.conversionFromVisit)} delle visite)`,
                "Clienti",
              ]}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]}>
              {funnel.map((_, i) => (
                <Cell key={i} fill={COLORS[i]} />
              ))}
              <LabelList
                content={(props) => {
                  const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                  const step = funnel[index];
                  return (
                    <text x={Number(x) + Number(width) + 8} y={Number(y) + Number(height) / 2} dominantBaseline="middle" fontSize={13} fill="#374151">
                      {formatNumber(step.count)}
                      {index > 0 ? `  (${formatPercent(step.conversionFromPrevious)})` : ""}
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
