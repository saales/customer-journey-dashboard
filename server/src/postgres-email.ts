export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Resend adapter. It is deliberately disabled unless both credentials are configured. */
export async function sendPostgresTransactionalEmail(
  message: TransactionalEmail,
  options: { apiKey?: string; from?: string },
): Promise<boolean> {
  if (!options.apiKey || !options.from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: options.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const status = response.status;
    throw new Error(`Il provider email ha rifiutato il messaggio (HTTP ${status}).`);
  }
  return true;
}
