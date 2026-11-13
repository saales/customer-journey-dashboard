import type { Db } from "./db.js";
import { CHANNELS, STAGES, type Channel, type Stage } from "./types.js";

/** Generatore pseudo-casuale deterministico (mulberry32): stessi dati a ogni avvio. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Probabilità di passare allo stadio successivo, per canale (dati inventati, solo a scopo dimostrativo). */
const TRANSITION: Record<Channel, number[]> = {
  //            visita→lead, lead→qual, qual→opp, opp→cliente
  Organico: [0.16, 0.55, 0.5, 0.35],
  Social: [0.1, 0.4, 0.4, 0.25],
  Email: [0.22, 0.6, 0.55, 0.4],
  Advertising: [0.12, 0.45, 0.45, 0.3],
  Referral: [0.28, 0.7, 0.6, 0.5],
};

/** Peso del canale sul traffico totale. */
const CHANNEL_WEIGHT: Record<Channel, number> = {
  Organico: 0.32,
  Social: 0.24,
  Email: 0.14,
  Advertising: 0.22,
  Referral: 0.08,
};

/** Giorni medi di attesa prima di ogni stadio successivo. */
const DELAY_DAYS = [2, 6, 9, 14];

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pickChannel(r: number): Channel {
  let acc = 0;
  for (const ch of CHANNELS) {
    acc += CHANNEL_WEIGHT[ch];
    if (r <= acc) return ch;
  }
  return CHANNELS[CHANNELS.length - 1];
}

export interface SeedOptions {
  customers?: number;
  /** Prima data possibile (YYYY-MM-DD) */
  startDate?: string;
  /** Numero di giorni su cui distribuire le prime visite */
  spanDays?: number;
  seed?: number;
}

/** Popola il database con dati sintetici. Non fa nulla se ci sono già dati. */
export function seedIfEmpty(db: Db, opts: SeedOptions = {}): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number };
  if (n > 0) return false;

  const total = opts.customers ?? 6000;
  const start = opts.startDate ?? "2025-10-01";
  const span = opts.spanDays ?? 365;
  const rand = rng(opts.seed ?? 42);

  const insCustomer = db.prepare("INSERT INTO customers (id, channel, created_at) VALUES (?, ?, ?)");
  const insEvent = db.prepare("INSERT INTO events (customer_id, stage, occurred_at) VALUES (?, ?, ?)");

  const run = db.transaction(() => {
    for (let id = 1; id <= total; id++) {
      const channel = pickChannel(rand());
      // leggera stagionalità: più traffico verso la fine dell'anno
      const offset = Math.floor(Math.pow(rand(), 0.85) * span);
      const created = addDays(start, offset);
      insCustomer.run(id, channel, created);
      insEvent.run(id, "visit", created);

      let current = created;
      for (let i = 0; i < STAGES.length - 1; i++) {
        if (rand() > TRANSITION[channel][i]) break;
        current = addDays(current, 1 + Math.floor(rand() * DELAY_DAYS[i] * 2));
        insEvent.run(id, STAGES[i + 1] as Stage, current);
      }
    }
  });
  run();
  return true;
}
