
import { useEffect, useState } from "react";
import { api, type FunnelStage } from "../api";

interface Props {
  onDataChange?: () => void;
}

export function FunnelSettings({ onDataChange }: Props) {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadStages() {
    setLoading(true);
    setError("");

    try {
      const data = await api.funnelStages();
      setStages(data.sort((a, b) => a.position - b.position));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Errore nel caricamento delle fasi."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStages();
  }, []);

  function startEditing(stage: FunnelStage) {
    setEditingId(stage.id);
    setEditingLabel(stage.label);
    setError("");
    setMessage("");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingLabel("");
  }

  async function saveEditing(id: string) {
    const label = editingLabel.trim();

    if (!label) {
      setError("Il nome della fase non può essere vuoto.");
      return;
    }

    const currentStage = stages.find((stage) => stage.id === id);

    if (currentStage?.label === label) {
      cancelEditing();
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await api.updateFunnelStage(id, { label });
      cancelEditing();
      await loadStages();
      setMessage("Nome della fase aggiornato.");
      onDataChange?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile rinominare la fase."
      );
    } finally {
      setSaving(false);
    }
  }

  async function addStage() {
    const label = newLabel.trim();
    if (!label) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await api.createFunnelStage(label);
      setNewLabel("");
      await loadStages();
      setMessage("Nuova fase aggiunta.");
      onDataChange?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile aggiungere la fase."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStage(
    id: string,
    data: { label?: string; isActive?: boolean }
  ) {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      await api.updateFunnelStage(id, data);
      await loadStages();
      setMessage("Fase aggiornata.");
      onDataChange?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile aggiornare la fase."
      );
    } finally {
      setSaving(false);
    }
  }

  async function moveStage(id: string, direction: -1 | 1) {
    const currentIndex = stages.findIndex((stage) => stage.id === id);
    const targetIndex = currentIndex + direction;

    if (
      currentIndex <= 0 ||
      targetIndex <= 0 ||
      targetIndex >= stages.length - 1
    ) {
      return;
    }

    const reordered = [...stages];

    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const updated = await api.reorderFunnelStages(
        reordered.map((stage) => stage.id)
      );

      setStages(updated.sort((a, b) => a.position - b.position));
      setMessage("Ordine delle fasi aggiornato.");
      onDataChange?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile riordinare le fasi."
      );
      await loadStages();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="loading">Caricamento delle fasi del percorso…</p>;
  }

  return (
    <div className="card funnel-settings">
      <h2>Configurazione del percorso</h2>

      <p className="subtitle">
        Personalizza le fasi del percorso cliente. Le modifiche non eliminano
        gli eventi storici già registrati.
      </p>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      <div className="funnel-stage-list">
        {stages.map((stage, index) => {
          const isEditing = editingId === stage.id;

          return (
            <div
              className={`funnel-stage-row ${!stage.isActive ? "inactive" : ""}`}
              key={stage.id}
            >
              <div className="funnel-stage-info">
                {isEditing ? (
                  <input
                    type="text"
                    value={editingLabel}
                    maxLength={50}
                    autoFocus
                    aria-label={`Nuovo nome per ${stage.label}`}
                    disabled={saving}
                    onChange={(event) => setEditingLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveEditing(stage.id);
                      }

                      if (event.key === "Escape") {
                        cancelEditing();
                      }
                    }}
                  />
                ) : (
                  <strong>{stage.label}</strong>
                )}

                <span className="hint">
                  {stage.id} ·{" "}
                  {stage.isSystem ? "Fase standard" : "Fase personalizzata"}
                  {!stage.isActive ? " · Disattivata" : ""}
                </span>
              </div>

              <div className="funnel-stage-actions">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={saving || !editingLabel.trim()}
                      onClick={() => void saveEditing(stage.id)}
                    >
                      Salva
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      disabled={saving}
                      onClick={cancelEditing}
                    >
                      Annulla
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={saving || index <= 1}
                      onClick={() => void moveStage(stage.id, -1)}
                      aria-label={`Sposta ${stage.label} in alto`}
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      disabled={saving || index >= stages.length - 2}
                      onClick={() => void moveStage(stage.id, 1)}
                      aria-label={`Sposta ${stage.label} in basso`}
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      disabled={saving}
                      onClick={() => startEditing(stage)}
                    >
                      Rinomina
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        saving ||
                        stage.id === "visit" ||
                        stage.id === "customer"
                      }
                      onClick={() =>
                        void updateStage(stage.id, {
                          isActive: !stage.isActive,
                        })
                      }
                    >
                      {stage.isActive ? "Disattiva" : "Attiva"}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="funnel-stage-add">
        <label htmlFor="new-funnel-stage">Aggiungi una fase</label>

        <div className="funnel-stage-add-controls">
          <input
            id="new-funnel-stage"
            type="text"
            maxLength={50}
            placeholder="Es. Demo completata"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            disabled={saving}
          />

          <button
            type="button"
            disabled={saving || !newLabel.trim()}
            onClick={() => void addStage()}
          >
            Aggiungi fase
          </button>
        </div>
      </div>

      <p className="hint">
        Visita e Cliente sono fasi obbligatorie. Le fasi disattivate non
        compaiono nel grafico, ma i relativi dati storici vengono conservati.
      </p>
    </div>
  );
}
