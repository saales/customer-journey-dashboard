/** Errore client-side di validazione; viene tradotto in HTTP 4xx. */
export class PostgresValidationError extends Error {
  constructor(message: string, public readonly status: 400 | 409 = 400) {
    super(message);
    this.name = "PostgresValidationError";
  }
}
