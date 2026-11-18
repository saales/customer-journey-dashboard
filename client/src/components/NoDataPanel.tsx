import { useState } from "react";
import { api } from "../api";
import { buildDemoRows } from "../demoData";
import { useNavigate } from "../navigation";

/** Stato vuoto: spiega cosa fare e offre le due azioni possibili. */
export function NoDataPanel({ canWrite, onImported, demoDataEnabled = false }: { canWrite: boolean; onImported: () => void; demoDataEnabled?: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadDemo() {
    setBusy(true);
    setMessage(null);
    try {
      await api.importCsv("dati-di-esempio.csv", buildDemoRows());
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossibile caricare i dati di esempio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="no-data" aria-live="polite">
      <h2>Nessun dato per il periodo e il canale selezionati.</h2>
      <p>
        {canWrite
          ? demoDataEnabled
            ? "Cambia periodo o canale con i filtri. Se l'archivio è vuoto, importa un file oppure prova l'applicazione con dati di esempio."
            : "Cambia periodo o canale con i filtri. Se l'archivio è vuoto, importa un file per iniziare."
          : "Cambia periodo o canale con i filtri. Se l'archivio è vuoto, chiedi a un amministratore di importare i dati."}
      </p>
      {canWrite && (
        <div className="no-data-actions">
          <button type="button" className="button-primary" onClick={() => navigate("import")}>Importa un file</button>
          {demoDataEnabled && (
            <button type="button" className="button-secondary" onClick={() => void loadDemo()} disabled={busy}>
              {busy ? "Caricamento…" : "Carica dati di esempio"}
            </button>
          )}
        </div>
      )}
      {message && <p className="no-data-error" role="alert">{message}</p>}
    </section>
  );
}
