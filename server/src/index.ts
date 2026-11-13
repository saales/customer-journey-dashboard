import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { assertRuntimeCanStart } from "./runtime-safety.js";

// Fail closed: non esporre in produzione il prototipo SQLite privo di auth
// e isolamento tenant. La guardia va rimossa solo con runtime SaaS verificato.
assertRuntimeCanStart();

const db = openDb();

// I dati sintetici non devono mai comparire automaticamente in un ambiente
// di produzione. Per una demo locale occorre abilitarli esplicitamente.
if (process.env.ALLOW_DEMO_SEED === "true") {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ALLOW_DEMO_SEED non può essere usato in produzione. " +
      "I dati dimostrativi devono essere caricati in un ambiente demo isolato.",
    );
  }

  if (seedIfEmpty(db)) {
    console.log("Database locale popolato con dati sintetici dimostrativi.");
  }
}

const port = Number(process.env.PORT ?? 3001);
const server = createApp(db).listen(port, () => {
  console.log(`API in ascolto su http://localhost:${port}`);
});

// Chiusura ordinata: smette di accettare richieste e chiude il database.
function shutdown(signal: string) {
  console.log(`${signal} ricevuto: chiusura in corso...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
