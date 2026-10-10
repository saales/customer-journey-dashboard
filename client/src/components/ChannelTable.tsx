import type { ChannelRow } from "../api";
import { formatNumber, formatPercent } from "../format";

export function ChannelTable({ rows, selected }: { rows: ChannelRow[]; selected: string }) {
  const max = Math.max(...rows.map((r) => r.visitToCustomer), 1);
  return (
    <div className="card">
      <h2>Confronto tra canali</h2>
      <p className="hint">Ordinati per conversione da visita a cliente. Il filtro per canale non si applica a questa tabella.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Canale</th>
              <th className="num">Visite</th>
              <th className="num">Lead</th>
              <th className="num">Clienti</th>
              <th className="num">Visita → lead</th>
              <th>Visita → cliente</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel} className={r.channel === selected ? "selected" : ""}>
                <td>{r.channel}</td>
                <td className="num">{formatNumber(r.visits)}</td>
                <td className="num">{formatNumber(r.leads)}</td>
                <td className="num">{formatNumber(r.customers)}</td>
                <td className="num">{formatPercent(r.visitToLead)}</td>
                <td>
                  <div className="bar-cell">
                    <div className="bar" style={{ width: `${(r.visitToCustomer / max) * 100}%` }} />
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
