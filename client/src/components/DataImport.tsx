import { useEffect, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  FileUp,
  FileSpreadsheet,
  X,
  AlertCircle,
  CheckCircle2,
  Download,
} from "lucide-react";
import { api } from "../api";
import type { FunnelStage, ImportResult } from "../api";

type CsvRow = Record<string, string>;

interface ValidationRow {
  rowNumber: number;
  data: CsvRow;
  errors: string[];
}

interface CsvResult {
  headers: string[];
  rows: CsvRow[];
  fileName: string;
}

const MAX_IMPORT_ROWS = 10_000;
const MAX_EXTERNAL_ID_LENGTH = 100;

const REQUIRED_HEADERS = [
  "externalId",
  "channel",
  "createdAt",
  "stage",
  "occurredAt",
];

const VALID_CHANNELS = [
  "Organico",
  "Social",
  "Email",
  "Advertising",
  "Referral",
];

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function validateRows(
  rows: CsvRow[],
  activeStages: FunnelStage[]
): ValidationRow[] {
  const validStageIds = activeStages.map((stage) => stage.id);

  const stageOrder = new Map(
    activeStages.map((stage) => [stage.id, stage.position])
  );

  const validationRows: ValidationRow[] = rows.map((data, index) => {
    const errors: string[] = [];

    const externalId = (data.externalId ?? "").trim();
    const channel = data.channel ?? "";
    const createdAt = data.createdAt ?? "";
    const stage = data.stage ?? "";
    const occurredAt = data.occurredAt ?? "";

    if (!externalId) {
      errors.push("Identificativo cliente obbligatorio.");
    } else if (externalId.length > MAX_EXTERNAL_ID_LENGTH) {
      errors.push(`Identificativo cliente troppo lungo: massimo ${MAX_EXTERNAL_ID_LENGTH} caratteri.`);
    }

    if (!channel) {
      errors.push("Canale obbligatorio.");
    } else if (!VALID_CHANNELS.includes(channel)) {
      errors.push(`Canale non riconosciuto: ${channel}.`);
    }

    if (!createdAt) {
      errors.push("Data di ingresso obbligatoria.");
    } else if (!isValidDate(createdAt)) {
      errors.push("Data di ingresso non valida. Usa YYYY-MM-DD.");
    }

    if (!stage) {
      errors.push("Fase del funnel obbligatoria.");
    } else if (!validStageIds.includes(stage)) {
      errors.push(`Fase del funnel non riconosciuta o disattivata: ${stage}.`);
    }

    if (!occurredAt) {
      errors.push("Data dell'evento obbligatoria.");
    } else if (!isValidDate(occurredAt)) {
      errors.push("Data dell'evento non valida. Usa YYYY-MM-DD.");
    }

    if (
      isValidDate(createdAt) &&
      isValidDate(occurredAt) &&
      occurredAt < createdAt
    ) {
      errors.push(
        "La data dell'evento non può precedere la data di ingresso."
      );
    }

    return {
      rowNumber: index + 1,
      data,
      errors,
    };
  });

  const customers = new Map<string, ValidationRow[]>();

  for (const row of validationRows) {
    const externalId = (row.data.externalId ?? "").trim();

    if (!externalId) continue;

    const group = customers.get(externalId) ?? [];
    group.push(row);
    customers.set(externalId, group);
  }

  for (const [externalId, group] of customers) {
    const channels = new Set(
      group.map((row) => row.data.channel)
    );

    const createdDates = new Set(
      group.map((row) => row.data.createdAt)
    );

    if (channels.size > 1) {
      group.forEach((row) => {
        row.errors.push(
          `Il cliente ${externalId} ha canali differenti tra le sue righe.`
        );
      });
    }

    if (createdDates.size > 1) {
      group.forEach((row) => {
        row.errors.push(
          `Il cliente ${externalId} ha date di ingresso differenti tra le sue righe.`
        );
      });
    }

    const hasInitialVisit = group.some(
      (row) =>
        row.data.stage === "visit" &&
        row.data.occurredAt === row.data.createdAt
    );

    if (!hasInitialVisit) {
      group.forEach((row) => {
        row.errors.push(
          `Il cliente ${externalId} deve avere una fase visit con data uguale alla data di ingresso.`
        );
      });
    }

    const seenStages = new Set<string>();
    const duplicateStages = new Set<string>();

    for (const row of group) {
      const stage = row.data.stage ?? "";

      if (!stage || !validStageIds.includes(stage)) continue;

      if (seenStages.has(stage)) {
        duplicateStages.add(stage);
      }

      seenStages.add(stage);
    }

    if (duplicateStages.size > 0) {
      group.forEach((row) => {
        row.errors.push(
          `Il cliente ${externalId} ha più eventi per la stessa fase: ${[...duplicateStages].join(", ")}.`
        );
      });
    }

    const orderedRows = [...group]
      .filter(
        (row) =>
          validStageIds.includes(row.data.stage) &&
          isValidDate(row.data.occurredAt)
      )
      .sort(
        (a, b) =>
          (stageOrder.get(a.data.stage) ?? Infinity) -
          (stageOrder.get(b.data.stage) ?? Infinity)
      );

    for (let index = 1; index < orderedRows.length; index++) {
      const previous = orderedRows[index - 1];
      const current = orderedRows[index];

      if (current.data.occurredAt < previous.data.occurredAt) {
        group.forEach((row) => {
          row.errors.push(
            `Il cliente ${externalId} ha date non cronologiche tra le fasi ${previous.data.stage} e ${current.data.stage}.`
          );
        });

        break;
      }
    }
  }

  return validationRows;
}

function hasFieldError(row: ValidationRow, field: string): boolean {
  const errorPatterns: Record<string, string[]> = {
    externalId: ["Identificativo cliente", "Il cliente"],
    channel: ["Canale", "canali differenti"],
    createdAt: ["Data di ingresso", "date di ingresso"],
    stage: ["Fase del funnel"],
    occurredAt: ["Data dell'evento"],
  };

  return (errorPatterns[field] ?? []).some((pattern) =>
    row.errors.some((error) => error.includes(pattern))
  );
}

interface DataImportProps {
  onDataChange: () => void;
}

export function DataImport({ onDataChange }: DataImportProps) {
  const [result, setResult] = useState<CsvResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<ImportResult | null>(null);

  const [activeStages, setActiveStages] = useState<FunnelStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [stagesError, setStagesError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadActiveStages() {
      try {
        const stages = await api.funnelStages();

        if (!cancelled) {
          setActiveStages(
            stages
              .filter((stage) => stage.isActive)
              .sort((a, b) => a.position - b.position)
          );
        }
      } catch (err) {
        if (!cancelled) {
          setStagesError(
            err instanceof Error
              ? err.message
              : "Impossibile caricare le fasi del percorso."
          );
        }
      } finally {
        if (!cancelled) {
          setStagesLoading(false);
        }
      }
    }

    void loadActiveStages();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(file?: File) {
    if (!file) return;

    const selectedFileName = file.name;

    setResult(null);
    setError("");
    setSuccess(null);

    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!["csv", "xlsx", "xls"].includes(extension ?? "")) {
      setError(
        "Formato non supportato. Seleziona un file CSV o Excel (.xlsx, .xls)."
      );
      return;
    }

    if (file.size === 0) {
      setError("Il file selezionato è vuoto.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Il file supera il limite massimo di 10 MB.");
      return;
    }

    setLoading(true);

    function processRows(headers: string[], rows: CsvRow[]) {
      if (headers.length === 0) {
        setError("Non sono state trovate intestazioni nel file.");
        return;
      }

      if (headers.some((header) => !header)) {
        setError("Il file contiene intestazioni vuote.");
        return;
      }

      if (new Set(headers).size !== headers.length) {
        setError("Il file contiene intestazioni duplicate.");
        return;
      }

      const missingHeaders = REQUIRED_HEADERS.filter(
        (header) => !headers.includes(header)
      );

      if (missingHeaders.length > 0) {
        setError(
          `Mancano le colonne obbligatorie: ${missingHeaders.join(", ")}.`
        );
        return;
      }

      if (rows.length === 0) {
        setError("Il file contiene le intestazioni ma nessuna riga di dati.");
        return;
      }

      if (rows.length > MAX_IMPORT_ROWS) {
        setError(`Il file contiene ${rows.length} righe: il limite massimo è ${MAX_IMPORT_ROWS}. Dividi il file in più importazioni.`);
        return;
      }

      setResult({
        headers,
        rows,
        fileName: selectedFileName,
      });
    }

    if (extension === "csv") {
      Papa.parse<CsvRow>(file, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.trim(),
        transform: (value) => value.trim(),

        complete: (parsed) => {
          setLoading(false);

          if (parsed.errors.length > 0) {
            setError(
              `Impossibile leggere il CSV: ${parsed.errors[0].message}`
            );
            return;
          }

          processRows(
            parsed.meta.fields ?? [],
            parsed.data
          );
        },

        error: (parseError) => {
          setLoading(false);
          setError(`Errore durante la lettura: ${parseError.message}`);
        },
      });

      return;
    }

    try {
      const buffer = await file.arrayBuffer();

      const workbook = XLSX.read(buffer, {
        type: "array",
        cellDates: true,
      });

      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        setError("Il file Excel non contiene fogli di lavoro.");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];

      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
        dateNF: "yyyy-mm-dd",
      });

      if (matrix.length === 0) {
        setError("Il foglio Excel è vuoto.");
        return;
      }

      const headers = matrix[0].map((value) =>
        String(value ?? "").trim()
      );

      const rows = matrix
        .slice(1)
        .filter((row) =>
          row.some((value) => String(value ?? "").trim() !== "")
        )
        .map((row) =>
          Object.fromEntries(
            headers.map((header, index) => [
              header,
              String(row[index] ?? "").trim(),
            ])
          )
        );

      processRows(headers, rows);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Errore durante la lettura del file Excel: ${err.message}`
          : "Impossibile leggere il file Excel."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateCell(
    rowIndex: number,
    field: string,
    value: string
  ) {
    setResult((current) => {
      if (!current) return current;

      const rows = current.rows.map((row, index) =>
        index === rowIndex
          ? { ...row, [field]: value }
          : row
      );

      return { ...current, rows };
    });
  }

  function reset() {
    setResult(null);
    setError("");
    setLoading(false);
    setSuccess(null);
  }

  const validationRows = result
    ? validateRows(result.rows, activeStages)
    : [];

  const customerGroups = new Map<string, ValidationRow[]>();

  for (const row of validationRows) {
    const externalId = (row.data.externalId ?? "").trim();

    if (!externalId) continue;

    const group = customerGroups.get(externalId) ?? [];
    group.push(row);
    customerGroups.set(externalId, group);
  }

  const importableRows = [...customerGroups.values()]
    .filter((group) => group.every((row) => row.errors.length === 0))
    .flat();

  // Righe senza errori propri, indipendentemente dal gruppo cliente.
  const individuallyValidRows = validationRows.filter(
    (row) => row.errors.length === 0
  );

  // Righe con errori di validazione diretti.
  const invalidCount = validationRows.filter(
    (row) => row.errors.length > 0
  ).length;

  // Righe valide singolarmente, ma bloccate da errori
  // presenti in altre righe dello stesso cliente.
  const blockedRowsCount =
    individuallyValidRows.length - importableRows.length;

  const validCount = individuallyValidRows.length;

  const customersToImport = new Set(
    importableRows.map((row) => (row.data.externalId ?? "").trim())
  ).size;

  const eventsToImport = importableRows.length;

  function handleDownloadErrors() {
    if (!result) return;

    const invalidRows = validationRows.filter(
      (row) => row.errors.length > 0
    );

    if (invalidRows.length === 0) return;

    const csv = Papa.unparse({
      fields: [...result.headers, "errors"],
      data: invalidRows.map((row) => ({
        ...row.data,
        errors: row.errors.join(" "),
      })),
    });

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${result.fileName.replace(/\.(csv|xlsx|xls)$/i, "")}-errori.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function handleDownloadValidRows() {
    if (!result || importableRows.length === 0) return;

    const csv = Papa.unparse({
      fields: result.headers,
      data: importableRows.map((row) => row.data),
    });

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${result.fileName.replace(/\.(csv|xlsx|xls)$/i, "")}-validi.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (
      !result ||
      invalidCount > 0 ||
      blockedRowsCount > 0 ||
      submitting ||
      success ||
      stagesLoading ||
      stagesError
    ) {
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(null);

    try {
      const rows = result.rows.map((row) => ({
        externalId: (row.externalId ?? "").trim(),
        channel: row.channel ?? "",
        createdAt: row.createdAt ?? "",
        stage: row.stage ?? "",
        occurredAt: row.occurredAt ?? "",
      }));

      const response = await api.importCsv(result.fileName, rows);

      setSuccess(response);
      onDataChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Errore durante l'importazione."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function renderEditableCell(row: ValidationRow, header: string) {
    const value = row.data[header] ?? "";
    const invalid = hasFieldError(row, header);

    const className = `import-cell-input ${
      invalid ? "import-cell-error" : ""
    }`;

    if (header === "channel") {
      return (
        <select
          className={className}
          value={value}
          aria-label={`${header}, riga ${row.rowNumber}`}
          onChange={(event) =>
            updateCell(row.rowNumber - 1, header, event.target.value)
          }
        >
          <option value="">Seleziona...</option>

          {value && !VALID_CHANNELS.includes(value) && (
            <option value={value}>{value} (non valido)</option>
          )}

          {VALID_CHANNELS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (header === "stage") {
      return (
        <select
          className={className}
          value={value}
          aria-label={`${header}, riga ${row.rowNumber}`}
          onChange={(event) =>
            updateCell(row.rowNumber - 1, header, event.target.value)
          }
        >
          <option value="">Seleziona...</option>

          {value && !activeStages.some((stage) => stage.id === value) && (
            <option value={value}>{value} (non valido o disattivato)</option>
          )}

          {activeStages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        className={className}
        type="text"
        value={value}
        placeholder={
          header === "createdAt" || header === "occurredAt"
            ? "YYYY-MM-DD"
            : ""
        }
        aria-label={`${header}, riga ${row.rowNumber}`}
        onChange={(event) =>
          updateCell(row.rowNumber - 1, header, event.target.value)
        }
      />
    );
  }

  return (
    <div className="import-page">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Importazione dati da CSV o Excel</h2>
            <p className="hint">
              Carica un file CSV, controlla i dati e correggi
              eventuali errori prima dell'importazione.
            </p>
          </div>

          <FileSpreadsheet size={26} />
        </div>

        {stagesLoading && (
          <p className="loading">Caricamento delle fasi del percorso…</p>
        )}

        {stagesError && (
          <div className="error" role="alert">
            <AlertCircle size={18} />
            Impossibile caricare le fasi del percorso: {stagesError}
          </div>
        )}

        <label className="import-upload">
          <FileUp size={30} />
          <strong>Seleziona un file CSV o Excel</strong>
          <span>
            Formati supportati: CSV, XLSX, XLS · Massimo 10 MB
          </span>

          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(event) =>
              handleFile(event.target.files?.[0])
            }
            disabled={loading || stagesLoading || !!stagesError}
          />
        </label>

        {loading && (
          <p className="loading">Lettura del file in corso…</p>
        )}

        {error && (
          <div className="error" role="alert">
            <AlertCircle size={18} />
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="card import-preview">
          <div className="card-head">
            <div>
              <h2>
                <CheckCircle2 size={19} />
                Anteprima e correzione dati
              </h2>

              <p className="hint">
                File: {result.fileName} · {result.rows.length} righe ·{" "}
                {result.headers.length} colonne
              </p>
            </div>

            <button
              type="button"
              className="export"
              onClick={reset}
            >
              <X size={16} />
              Rimuovi file
            </button>
          </div>

          <div className="import-validation-summary">
            <div className="import-summary-item">
              <strong>{customersToImport}</strong>
              <span>Clienti da importare</span>
            </div>

            <div className="import-summary-item">
              <strong>{validCount}</strong>
              <span>Righe senza errori propri</span>
            </div>

            <div className="import-summary-item">
              <strong>{eventsToImport}</strong>
              <span>Eventi da importare</span>
            </div>

            <div className="import-summary-item">
              <strong>{invalidCount}</strong>
              <span>Righe con errori</span>
            </div>

            <div className="import-summary-item">
              <strong>{blockedRowsCount}</strong>
              <span>Righe bloccate da errori del cliente</span>
            </div>
          </div>

          {success && (
            <div className="success" role="status">
              <CheckCircle2 size={18} />
              Importazione completata: {success.importedCustomers} clienti,
              {` ${success.importedRows} righe e ${success.importedEvents} eventi importati.`}
            </div>
          )}

          <div className="import-actions">
            <button
              type="button"
              className="primary"
              onClick={handleImport}
              disabled={
                invalidCount > 0 ||
                blockedRowsCount > 0 ||
                submitting ||
                !!success ||
                stagesLoading ||
                !!stagesError
              }
            >
              {submitting
                ? "Importazione in corso…"
                : "Importa dati"}
            </button>

            {invalidCount > 0 && (
              <button
                type="button"
                className="export"
                onClick={handleDownloadErrors}
              >
                <Download size={16} />
                Scarica report errori
              </button>
            )}

            {customersToImport > 0 && (
              <button
                type="button"
                className="export"
                onClick={handleDownloadValidRows}
              >
                <Download size={16} />
                Scarica dati validi
              </button>
            )}
          </div>

          <p className="hint">
            Puoi modificare direttamente i campi. La validazione
            si aggiorna automaticamente.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {result.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                  <th>Stato</th>
                  <th>Problemi rilevati</th>
                </tr>
              </thead>

              <tbody>
                {validationRows.map((row) => (
                  <tr key={row.rowNumber}>
                    {result.headers.map((header) => (
                      <td key={header}>
                        {REQUIRED_HEADERS.includes(header)
                          ? renderEditableCell(row, header)
                          : row.data[header] ?? ""}
                      </td>
                    ))}

                    <td>
                      {row.errors.length === 0 ? (
                        <span className="import-valid">
                          <CheckCircle2 size={15} />
                          Valida
                        </span>
                      ) : (
                        <span className="import-invalid">
                          <AlertCircle size={15} />
                          Errore
                        </span>
                      )}
                    </td>

                    <td>
                      {row.errors.length === 0
                        ? "Nessun problema"
                        : row.errors.join(" ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
