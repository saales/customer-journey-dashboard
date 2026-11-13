import { useEffect, useState } from "react";
import { api, type Customer, type CustomerInput } from "../api";

const PAGE_SIZE = 50;

interface CustomerManagementProps {
  onDataChange: () => void;
  serverExportEnabled?: boolean;
}

export function CustomerManagement({ onDataChange, serverExportEnabled = false }: CustomerManagementProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [channel, setChannel] = useState("Organico");
const [createdAt, setCreatedAt] = useState("");
const [formError, setFormError] = useState<string | null>(null);
const [leadDate, setLeadDate] = useState("");
const [qualifiedDate, setQualifiedDate] = useState("");
const [opportunityDate, setOpportunityDate] = useState("");
const [customerDate, setCustomerDate] = useState("");

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
  }, []);


  function handleEdit(customer: Customer) {
  setEditingId(customer.id);
  setChannel(customer.channel);
  setCreatedAt(customer.createdAt);

  const getDate = (stage: string) =>
    customer.events.find((event) => event.stage === stage)?.occurredAt ?? "";

  setLeadDate(getDate("lead"));
  setQualifiedDate(getDate("qualified"));
  setOpportunityDate(getDate("opportunity"));
  setCustomerDate(getDate("customer"));

  setFormError(null);
  setShowForm(true);
}

  async function handleCreate() {
  if (!createdAt) {
    setFormError("Inserisci la data della prima visita.");
    return;
  }

  const newCustomer: CustomerInput = {
  channel,
  createdAt,
  events: [
    ...(leadDate ? [{ stage: "lead", occurredAt: leadDate }] : []),
    ...(qualifiedDate ? [{ stage: "qualified", occurredAt: qualifiedDate }] : []),
    ...(opportunityDate ? [{ stage: "opportunity", occurredAt: opportunityDate }] : []),
    ...(customerDate ? [{ stage: "customer", occurredAt: customerDate }] : []),
  ],
};
  try {
    setFormError(null);

    await api.createCustomer(newCustomer);
    await loadCustomers();
    onDataChange();

    setCreatedAt("");
setChannel("Organico");
setLeadDate("");
setQualifiedDate("");
setOpportunityDate("");
setCustomerDate("");
setShowForm(false);
  } catch (err) {
    setFormError(
      err instanceof Error ? err.message : "Errore durante il salvataggio."
    );
  }
}

async function handleUpdate() {
  if (editingId === null || !createdAt) {
    setFormError("Dati del cliente non validi.");
    return;
  }

  const updatedCustomer: CustomerInput = {
    channel,
    createdAt,
    events: [
      ...(leadDate ? [{ stage: "lead", occurredAt: leadDate }] : []),
      ...(qualifiedDate ? [{ stage: "qualified", occurredAt: qualifiedDate }] : []),
      ...(opportunityDate ? [{ stage: "opportunity", occurredAt: opportunityDate }] : []),
      ...(customerDate ? [{ stage: "customer", occurredAt: customerDate }] : []),
    ],
  };

  try {
    setFormError(null);

    await api.updateCustomer(editingId, updatedCustomer);
    await loadCustomers();
    onDataChange();

    setEditingId(null);
    setCreatedAt("");
    setChannel("Organico");
    setLeadDate("");
    setQualifiedDate("");
    setOpportunityDate("");
    setCustomerDate("");
    setShowForm(false);
  } catch (err) {
    setFormError(
      err instanceof Error ? err.message : "Errore durante la modifica."
    );
  }
}

async function handleDelete(customerId: string) {
  const confirmed = window.confirm(
    "Sei sicuro di voler eliminare questo cliente?"
  );

  if (!confirmed) {
    return;
  }

  try {
    setError(null);
    await api.deleteCustomer(customerId);
    const nextPage = customers.length === 1 && page > 1 ? page - 1 : page;
    await loadCustomers(nextPage);
    onDataChange();
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "Errore durante l'eliminazione."
    );
  }
}


  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Gestione clienti</h2>
          <p className="hint">Gestione dei clienti e delle relative fasi del percorso.</p>
        </div>
{serverExportEnabled && <button className="button-secondary" type="button" onClick={() => void exportCustomers()}>Esporta tutti i clienti CSV</button>}
<button className="export" onClick={() => setShowForm(!showForm)}>
  {showForm ? "Annulla" : "Nuovo cliente"}
</button>

      </div>


      {showForm && (
  <form
    onSubmit={(e) => {
  e.preventDefault();

  if (editingId !== null) {
    void handleUpdate();
  } else {
    void handleCreate();
  }
}}
    className="customer-form"
  >
    <label>
      Canale di acquisizione
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
      >
        <option value="Organico">Organico</option>
        <option value="Social">Social</option>
        <option value="Email">Email</option>
        <option value="Advertising">Pubblicità</option>
        <option value="Referral">Passaparola</option>
      </select>
    </label>

    <label>
      Data della prima visita
      <input
        type="date"
        value={createdAt}
        onChange={(e) => setCreatedAt(e.target.value)}
        required
      />
    </label>

    <label>
  Data contatto (facoltativa)
  <input
    type="date"
    value={leadDate}
    min={createdAt || undefined}
    onChange={(e) => setLeadDate(e.target.value)}
  />
</label>

<label>
  Data Qualificazione (facoltativa)
  <input
    type="date"
    value={qualifiedDate}
    min={leadDate || createdAt || undefined}
    onChange={(e) => setQualifiedDate(e.target.value)}
  />
</label>

<label>
  Data opportunità (facoltativa)
  <input
    type="date"
    value={opportunityDate}
    min={qualifiedDate || leadDate || createdAt || undefined}
    onChange={(e) => setOpportunityDate(e.target.value)}
  />
</label>

<label>
  Data conversione in cliente (facoltativa)
  <input
    type="date"
    value={customerDate}
    min={opportunityDate || qualifiedDate || leadDate || createdAt || undefined}
    onChange={(e) => setCustomerDate(e.target.value)}
  />
</label>

    {formError && <div className="error">{formError}</div>}

    <p className="hint">
      La fase Visita viene registrata automaticamente.
    </p>

    <button type="submit" className="export">
      Salva dati cliente
    </button>
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
          <th>Azioni</th>
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
        {({
  visit: "Visita",
  lead: "Contatto",
  qualified: "Qualificato",
  opportunity: "Opportunità",
  customer: "Cliente",
} as Record<string, string>)[event.stage] ?? event.stage}
      </span>
    ))}
  </div>
</td>
            <td>
  <button
    className="export export-edit"
    onClick={() => handleEdit(customer)}
  >
    Modifica
  </button>
  <button
  className="export export-delete"
  onClick={() => void handleDelete(customer.id)}
>
  Elimina
</button>
</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
      {!loading && !error && total > 0 && (
        <div className="pagination">
          <span className="hint">
            {total} clienti · pagina {page} di {Math.max(totalPages, 1)}
          </span>
          <div className="pagination-actions">
            <button
              type="button"
              className="export"
              disabled={page <= 1}
              onClick={() => void loadCustomers(page - 1)}
            >
              Precedente
            </button>
            <button
              type="button"
              className="export"
              disabled={page >= totalPages}
              onClick={() => void loadCustomers(page + 1)}
            >
              Successiva
            </button>
          </div>
        </div>
      )}
    </section>
  );
}