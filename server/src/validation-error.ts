/**
 * Errore causato da dati inviati dal client (formato, vincoli di dominio, conflitti).
 * L'API lo traduce in 4xx con il messaggio, invece di un generico 500.
 * Gli errori interni (configurazione, invarianti, database) restano `Error` e rispondono 500.
 */
export class PostgresValidationError extends Error {
  constructor(message: string, public readonly status: 400 | 409 = 400) {
    super(message);
    this.name = "PostgresValidationError";
  }
}
