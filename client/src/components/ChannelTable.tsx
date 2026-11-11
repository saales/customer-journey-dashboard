
import type { ChannelRow } from "../api";
import { formatNumber, formatPercent } from "../format";
import { ExportButton } from "./ExportButton";

export function ChannelTable({
  rows,
  selected,
  suffix,
}: {
  rows: ChannelRow[];
  selected: string;
  suffix: string;
}) {
  const max = Math.max(...rows.map((r) => r.visitToCustomer), 1);

  return (
    <div className="card channel-card">
      <div className="card-head">
        <h2>Confronto tra canali</h2>

        <ExportButton
          filename={`canali_${suffix}.csv`}
          headers={[
            "Canale",
            "Visite",
            "Contatti acquisiti",
            "Clienti",
            "Visita → contatto (%)",
            "Visita → cliente (%)",
          ]}
          rows={rows.map((r) => [
            r.channel,
            r.visits,
            r.leads,
            r.customers,
            r.visitToLead,
            r.visitToCustomer,
          ])}
        />
      </div>

      <p className="hint">
  Confronto dei canali in base al tasso di conversione in cliente.
  I filtri non modificano questo confronto.
</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Canale</th>
              <th className="num">Visite</th>
              <th className="num">Contatti acquisiti</th>
              <th className="num">Clienti</th>
              <th className="num">Visita → contatto</th>
              <th>Visita → cliente</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr
                key={r.channel}
                className={r.channel === selected ? "selected" : ""}
              >
                <td>{r.channel}</td>
                <td className="num">{formatNumber(r.visits)}</td>
                <td className="num">{formatNumber(r.leads)}</td>
                <td className="num">{formatNumber(r.customers)}</td>
                <td className="num">
                  {formatPercent(r.visitToLead)}
                </td>
                <td>
              <div className="bar-cell">
  <div className="bar-track">
    <div
      className="bar"
      style={{
        width: `${(r.visitToCustomer / max) * 100}%`,
      }}
    />
  </div>
  <span>{formatPercent(r.visitToCustomer)}</span>
</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
