export const STAGES = ["visit", "lead", "qualified", "opportunity", "customer"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  visit: "Visita",
  lead: "Lead",
  qualified: "Qualificato",
  opportunity: "Opportunità",
  customer: "Cliente",
};

export const CHANNELS = ["Organico", "Social", "Email", "Advertising", "Referral"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Filters {
  /** Data di inizio (inclusa), formato YYYY-MM-DD */
  from: string;
  /** Data di fine (inclusa), formato YYYY-MM-DD */
  to: string;
  /** Se assente, tutti i canali */
  channel?: string;
}
