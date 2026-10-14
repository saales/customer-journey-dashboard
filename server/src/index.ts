import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";

const db = openDb();
if (seedIfEmpty(db)) {
  console.log("Database popolato con dati sintetici.");
}

const port = Number(process.env.PORT ?? 3001);
const server = createApp(db).listen(port, () => {
  console.log(`API in ascolto su http://localhost:${port}`);
});

// Chiusura ordinata: smette di accettare richieste e chiude il database
function shutdown(signal: string) {
  console.log(`${signal} ricevuto: chiusura in corso...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
