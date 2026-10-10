import { openDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";

const db = openDb();
const created = seedIfEmpty(db);
console.log(created ? "Database popolato con dati sintetici." : "Il database contiene già dei dati: nessuna modifica.");
