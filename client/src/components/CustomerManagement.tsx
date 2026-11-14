import { useEffect, useMemo, useState } from "react";
import { api, type Customer, type CustomerEvent, type CustomerInput, type FunnelStage } from "../api";

const PAGE_SIZE = 50;

interface CustomerManagementProps {
  onDataChange: () => void;
  serverExportEnabled?: boolean;
  readOnly?: boolean;
}

export function CustomerManagement({ onDataChange, serverExportEnabled = false, readOnly = false }: CustomerManagementProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [channel, setChannel] = useState("Organico");
  const [createdAt, setCreatedAt] = useState("");
  const [stageDates, setStageDates] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const orderedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );
  const editableStages = orderedStages.filter((stage) => stage.id !== "visit" && stage.isActive);

  async function loadCustomers(requestedPage = page) {
    try {
      setLoading(true);
      setError(null);
      const result = await api.customers(requestedPage, PAGE_SIZE);
      setCustomers(result.data);
      setPage(result.pagination.page);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore nel caricamento.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomers();
    api.funnelStages()
      .then(setStages)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Errore nel caricamento delle fasi."));
  }, []);

  function resetForm() {
    setEditingCustomer(null);
    setChannel("Organico");
    setCreatedAt("");
    setStageDates({});
    setFormError(null);
    setShowForm(false);
  }

  function handleEdit(customer: Customer) {
    setEditingCustomer(customer);
    setChannel(customer.channel);
    setCreatedAt(customer.createdAt);
    setStageDates(Object.fromEntries(customer.events.map((event) => [event.stage, event.occurredAt])));
    setFormError(null);
    setShowForm(true);
  }

  function buildCustomerInput(): CustomerInput {
    if (!createdAt) throw new Error("Inserisci la data della prima visita.");
    const previousEvents = new Map(
      (editingCustomer?.events ?? []).map((event) => [event.stage, event]),
    );
    const events: CustomerEvent[] = [];

    for (const stage of orderedStages) {
      if (stage.id === "visit") continue;
      const date = stage.isActive
        ? stageDates[stage.id]
        : previousEvents.get(stage.id)?.occurredAt;
      if (date) events.push({ stage: stage.id, occurredAt: date });
    }

    return { channel, createdAt, events };
  }

  async function saveCustomer() {
    try {
      setFormError(null);
      const input = buildCustomerInput();
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, input);
      } else {
        await api.createCustomer(input);
      }
      await loadCustomers();
      onDataChange();
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Errore durante il salvataggio.");
    }
  }

  async function exportCustomers() {
    try {
      const response = await fetch("/api/export/customers.csv", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Esportazione non riuscita (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "percorso-clienti.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Esportazione non riuscita.");
    }
  }

  async function handleDelete(customerId: string) {
    if (!window.confirm("Sei sicuro di voler eliminare questo cliente?")) return;
    try {
      setError(null);
      await api.deleteCustomer(customerId);
      const nextPage = customers.length === 1 && page > 1 ? page - 1 : page;
      await loadCustomers(nextPage);
      onDataChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
    }
  }

  function minimumDateFor(stageIndex: number): string {
    for (let index = stageIndex - 1; index >= 0; index -= 1) {
      const previous = orderedStages[index];
      if (previous && stageDates[previous.id]) return stageDates[previous.id]!;
    }
    return createdAt;
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Gestione clienti</h2>
          <p className="hint">Gestione dei clienti e delle relative fasi del percorso.</p>
        </div>
        {serverExportEnabled && <button className="button-secondary" type="button" onClick={() => void exportCustomers()}>Esporta tutti i clienti CSV</button>}
        {!readOnly && <button className="export" type="button" onClick={() => showForm ? resetForm() : setShowForm(true)}>
          {showForm ? "Annulla" : "Nuovo cliente"}
        </button>}
      </div>

      {showForm && !readOnly && (
        <form className="customer-form" onSubmit={(event) => { event.preventDefault(); void saveCustomer(); }}>
          <label>
            Canale di acquisizione
            <select value={channel} onChange={(event) => setChannel(event.target.value)}>
              <option value="Organico">Organico</option>
              <option value="Social">Social</option>
              <option value="Email">Email</option>
              <option value="Advertising">Pubblicità</option>
              <option value="Referral">Passaparola</option>
            </select>
          </label>

          <label>
            Data della prima visita
            <input type="date" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} required />
          </label>

          {editableStages.map((stage) => {
            const stageIndex = orderedStages.findIndex((item) => item.id === stage.id);
            return (
              <label key={stage.id}>
                Data: {stage.label} (facoltativa)
                <input
                  type="date"
                  aria-label={`Data: ${stage.label}`}
                  value={stageDates[stage.id] ?? ""}
                  min={minimumDateFor(stageIndex) || undefined}
                  onChange={(event) => setStageDates((current) => ({ ...current, [stage.id]: event.target.value }))}
                />
              </label>
            );
          })}

          {formError && <div className="error" role="alert">{formError}</div>}
          <p className="hint">La fase Visita viene registrata automaticamente. Le fasi disponibili seguono l'ordine configurato nel funnel.</p>
          <button type="submit" className="export">Salva dati cliente</button>
        </form>
      )}

      {loading && <p className="loading">Caricamento dei dati clienti…</p>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && customers.length === 0 && (
        <p className="empty">Non sono presenti clienti nel periodo selezionato.</p>
      )}
      {!loading && !error && customers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Canale</th>
                <th>Prima visita</th>
                <th>Fasi del percorso raggiunte</th>
                {!readOnly && <th>Azioni</th>}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.id}</td>
                  <td>{customer.channel}</td>
                  <td>{customer.createdAt}</td>
                  <td>
                    <div className="stage-list">
                      {customer.events.map((event) => (
                        <span className="stage-badge" key={`${customer.id}-${event.stage}`}>
                          {orderedStages.find((stage) => stage.id === event.stage)?.label ?? event.stage}
                        </span>
                      ))}
                    </div>
                  </td>
                  {!readOnly && <td>
                    <button type="button" className="export export-edit" onClick={() => handleEdit(customer)}>Modifica</button>
                    <button type="button" className="export export-delete" onClick={() => void handleDelete(customer.id)}>Elimina</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && total > 0 && (
        <div className="pagination">
          <span className="hint">{total} clienti · pagina {page} di {Math.max(totalPages, 1)}</span>
          <div className="pagination-actions">
            <button type="button" className="export" disabled={page <= 1} onClick={() => void loadCustomers(page - 1)}>Precedente</button>
            <button type="button" className="export" disabled={page >= totalPages} onClick={() => void loadCustomers(page + 1)}>Successiva</button>
          </div>
        </div>
      )}
    </section>
  );
}
