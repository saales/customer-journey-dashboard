import { openDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { assertDemoSeedAllowed } from "./runtime-safety.js";

// Controllare l'autorizzazione prima ancora di aprire/creare il database.
assertDemoSeedAllowed();

const db = openDb();
try {
  const created = seedIfEmpty(db);
  console.log(
    created
      ? "Database popolato con dati sintetici."
      : "Il database contiene già dei dati: nessuna modifica.",
  );
} finally {
  db.close();
}
