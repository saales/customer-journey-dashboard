import type { ImportRow } from "./api";

const CHANNELS = ["Organico", "Social", "Email", "Advertising", "Referral"] as const;
const STAGES = ["lead", "qualified", "opportunity", "customer"] as const;
/** Probabilità di passare alla fase successiva: il funnel si restringe in modo realistico. */
const PASS_RATE = [0.62, 0.55, 0.5, 0.45];
const DAY = 86_400_000;

function isoDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Dati di esempio deterministici per provare l'applicazione senza un file.
 * Le date sono relative a `today` e non superano mai `today`.
 */
export function buildDemoRows(today: Date = new Date(), customers = 240): ImportRow[] {
  let seed = 11;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4_294_967_296;
    return seed / 4_294_967_296;
  };
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const rows: ImportRow[] = [];

  for (let i = 1; i <= customers; i += 1) {
    const externalId = `demo-${String(i).padStart(4, "0")}`;
    const channel = CHANNELS[Math.floor(random() * CHANNELS.length)]!;
    let moment = end - (20 + Math.floor(random() * 160)) * DAY;
    const createdAt = isoDay(moment);
    rows.push({ externalId, channel, createdAt, stage: "visit", occurredAt: createdAt });

    for (const [index, stage] of STAGES.entries()) {
      if (random() > PASS_RATE[index]!) break;
      moment += (1 + Math.floor(random() * 8)) * DAY;
      if (moment > end) break;
      rows.push({ externalId, channel, createdAt, stage, occurredAt: isoDay(moment) });
    }
  }
  return rows;
}
