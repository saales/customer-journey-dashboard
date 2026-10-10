const nf = new Intl.NumberFormat("it-IT");

export const formatNumber = (n: number) => nf.format(n);
export const formatPercent = (n: number) => `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;

/** "2026-03" → "mar 26" */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("it-IT", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Primo giorno del periodo formato da `months` mesi interi, che termina nel mese della data `to`. */
export function startOfPeriod(to: string, months: number): string {
  const d = new Date(to + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (months - 1), 1)).toISOString().slice(0, 10);
}
