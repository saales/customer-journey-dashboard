import type { FunnelStep } from "../api";
import { formatNumber, formatPercent } from "../format";

const WIDTH = 1000;
const HEIGHT = 200;
const NODE = 12;

/** Fase con la perdita maggiore rispetto alla precedente (solo se c'è una perdita reale). */
export function biggestLoss(funnel: FunnelStep[]): { from: string; to: string; loss: number } | null {
  let best: { from: string; to: string; loss: number } | null = null;
  for (let i = 1; i < funnel.length; i += 1) {
    const previous = funnel[i - 1]!;
    const current = funnel[i]!;
    if (previous.count <= 0) continue;
    const loss = Math.round((100 - current.conversionFromPrevious) * 10) / 10;
    if (loss > 0 && (!best || loss > best.loss)) best = { from: previous.label, to: current.label, loss };
  }
  return best;
}

/**
 * Il percorso cliente come flusso che si restringe: l'altezza di ogni fase è proporzionale
 * ai clienti che la raggiungono e tra due fasi compare la perdita percentuale.
 */
export function FunnelFlow({ funnel }: { funnel: FunnelStep[] }) {
  if (funnel.length < 2) return null;
  const max = Math.max(...funnel.map((step) => step.count), 1);
  const column = WIDTH / funnel.length;
  const centerY = HEIGHT / 2;
  const nodes = funnel.map((step, index) => {
    const height = step.count <= 0 ? 2 : Math.max(5, (step.count / max) * (HEIGHT - 16));
    const x = column * index + column / 2 - NODE / 2;
    return { step, x, height, y: centerY - height / 2 };
  });
  const bands = nodes.slice(0, -1).map((from, index) => {
    const to = nodes[index + 1]!;
    const x1 = from.x + NODE;
    const x2 = to.x;
    const mid = (x1 + x2) / 2;
    return `M${x1},${from.y} C${mid},${from.y} ${mid},${to.y} ${x2},${to.y} L${x2},${to.y + to.height} C${mid},${to.y + to.height} ${mid},${from.y + from.height} ${x1},${from.y + from.height} Z`;
  });
  const worst = biggestLoss(funnel);
  const summary = funnel.map((step) => `${step.label}: ${formatNumber(step.count)}`).join(", ");

  return (
    <section className="flow" aria-labelledby="flow-title">
      <h2 id="flow-title" className="flow-insight">
        {worst
          ? `Il punto in cui si perdono più clienti è il passaggio da ${worst.from} a ${worst.to}: ${formatPercent(worst.loss)} in meno.`
          : "Nessuna perdita tra le fasi nel periodo selezionato."}
      </h2>
      <p className="flow-note">Altezza proporzionale ai clienti che raggiungono ogni fase. Tra le fasi, la quota persa.</p>

      <div className="flow-figure" role="img" aria-label={`Percorso di conversione. ${summary}`}>
        <svg className="flow-shape" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {bands.map((d, index) => <path key={index} className="flow-band" d={d} />)}
          {nodes.map(({ step, x, y, height }, index) => (
            <rect
              key={step.stage}
              className={index === nodes.length - 1 ? "flow-node flow-node-final" : "flow-node"}
              x={x} y={y} width={NODE} height={height} rx={3}
            />
          ))}
        </svg>
        {nodes.slice(1).map(({ step }, index) => {
          const loss = Math.round((100 - step.conversionFromPrevious) * 10) / 10;
          if (loss <= 0 || funnel[index]!.count <= 0) return null;
          const isWorst = worst?.to === step.label && worst.from === funnel[index]!.label;
          return (
            <span
              key={step.stage}
              className={isWorst ? "flow-loss flow-loss-worst" : "flow-loss"}
              style={{ left: `${((index + 1) / funnel.length) * 100}%` }}
            >
              −{formatPercent(loss)}
            </span>
          );
        })}
      </div>

      <ol className="flow-stages" style={{ gridTemplateColumns: `repeat(${funnel.length}, 1fr)` }}>
        {funnel.map((step) => (
          <li key={step.stage}>
            <strong>{formatNumber(step.count)}</strong>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
