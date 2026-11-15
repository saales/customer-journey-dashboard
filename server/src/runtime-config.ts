/**
 * Legge un intero opzionale da una variabile d'ambiente, con intervallo e valore predefinito.
 * Un valore presente ma non valido è un errore di configurazione: l'avvio fallisce invece di ignorarlo.
 */
export function readIntegerEnvironment(
  env: Record<string, string | undefined>, name: string, defaultValue: number, min: number, max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} deve essere un intero tra ${min} e ${max}.`);
  }
  return value;
}
