import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";

const db = openDb();
if (seedIfEmpty(db)) {
  console.log("Database popolato con dati sintetici.");
}

const port = Number(process.env.PORT ?? 3001);
createApp(db).listen(port, () => {
  console.log(`API in ascolto su http://localhost:${port}`);
});
