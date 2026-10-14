export type Preset = 3 | 6 | 12 | "custom";

export const PRESETS: { label: string; value: Preset }[] = [
  { label: "Ultimi 3 mesi", value: 3 },
  { label: "Ultimi 6 mesi", value: 6 },
  { label: "Ultimi 12 mesi", value: 12 },
  { label: "Personalizzato", value: "custom" },
];

interface Props {
  channels: string[];
  preset: Preset;
  channel: string;
  from: string;
  to: string;
  minDate: string;
  maxDate: string;
  onPreset: (p: Preset) => void;
  onChannel: (c: string) => void;
  onFrom: (d: string) => void;
  onTo: (d: string) => void;
}

export function Filters(p: Props) {
  return (
    <div className="filters">
      <label>
        Periodo
        <select value={String(p.preset)} onChange={(e) => p.onPreset(e.target.value === "custom" ? "custom" : (Number(e.target.value) as Preset))}>
          {PRESETS.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {p.preset === "custom" && (
        <>
          <label>
            Dal
            <input type="date" value={p.from} min={p.minDate} max={p.maxDate} onChange={(e) => p.onFrom(e.target.value)} />
          </label>
          <label>
            Al
            <input type="date" value={p.to} min={p.minDate} max={p.maxDate} onChange={(e) => p.onTo(e.target.value)} />
          </label>
        </>
      )}

      <label>
        Canale
        <select value={p.channel} onChange={(e) => p.onChannel(e.target.value)}>
          <option value="">Tutti i canali</option>
          {p.channels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
