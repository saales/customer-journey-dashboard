export const PERIODS = [
  { label: "Ultimi 3 mesi", months: 3 },
  { label: "Ultimi 6 mesi", months: 6 },
  { label: "Ultimi 12 mesi", months: 12 },
] as const;

interface Props {
  channels: string[];
  months: number;
  channel: string;
  onMonths: (m: number) => void;
  onChannel: (c: string) => void;
}

export function Filters({ channels, months, channel, onMonths, onChannel }: Props) {
  return (
    <div className="filters">
      <label>
        Periodo
        <select value={months} onChange={(e) => onMonths(Number(e.target.value))}>
          {PERIODS.map((p) => (
            <option key={p.months} value={p.months}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Canale
        <select value={channel} onChange={(e) => onChannel(e.target.value)}>
          <option value="">Tutti i canali</option>
          {channels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
