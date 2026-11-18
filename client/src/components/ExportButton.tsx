
import { downloadCsv, type CsvCell } from "../csv";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
  title?: string;
  description?: string;
}

function getBaseFilename(filename: string): string {
  return filename.replace(/\.(csv|xlsx|pdf)$/i, "");
}

function getReportTitle(filename: string, title?: string): string {
  if (title) return title;

  return getBaseFilename(filename)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRows(
  headers: string[],
  rows: CsvCell[][]
): (string | number)[][] {
  return rows.map((row) =>
    headers.map((_, index) => {
      const value = row[index];
      return value === null || value === undefined ? "" : value;
    })
  );
}

function getColumnLetter(column: number): string {
  let result = "";
  let current = column + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

async function downloadExcel(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
  title: string,
  description?: string
): Promise<void> {
  // Libreria caricata solo quando serve: non pesa sul primo caricamento dell'app.
  const XLSX = await import("xlsx");
  const generatedAt = new Date();

  const worksheetData: (string | number)[][] = [
    [title],
    ...(description ? [[description]] : []),
    [`Generato il: ${generatedAt.toLocaleString("it-IT")}`],
    [`Numero di record: ${rows.length}`],
    [],
    headers,
    ...normalizeRows(headers, rows),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const headerRow = 6;
  const firstDataRow = headerRow + 1;
  const lastDataRow = headerRow + rows.length;

  worksheet["!cols"] = headers.map((header, index) => {
    const maxLength = Math.max(
      header.length,
      ...rows.map((row) => String(row[index] ?? "").length)
    );

    return {
      wch: Math.min(Math.max(maxLength + 2, 12), 40),
    };
  });

  worksheet["!freeze"] = {
    xSplit: 0,
    ySplit: headerRow,
    topLeftCell: `A${firstDataRow}`,
    activePane: "bottomLeft",
    state: "frozen",
  };

  if (headers.length > 0 && rows.length > 0) {
    worksheet["!autofilter"] = {
      ref: `A${headerRow}:${getColumnLetter(headers.length - 1)}${lastDataRow}`,
    };
  }

  const workbook = XLSX.utils.book_new();

  workbook.Props = {
    Title: title,
    Subject: "Analisi del percorso cliente",
    Author: "Analisi del percorso cliente",
    CreatedDate: generatedAt,
  };

  XLSX.utils.book_append_sheet(workbook, worksheet, "Analisi");

  XLSX.writeFile(workbook, `${getBaseFilename(filename)}.xlsx`, {
    compression: true,
  });
}

async function downloadPdf(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
  title: string,
  description?: string
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({
    orientation: headers.length > 5 ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });

  const generatedAt = new Date();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - 28;

  doc.setProperties({
    title,
    subject: "Analisi del percorso cliente",
    creator: "Analisi del percorso cliente",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(24, 55, 75);

  const titleLines = doc.splitTextToSize(title, contentWidth);
  doc.text(titleLines, 14, 20);

  const titleEndY = 20 + titleLines.length * 8;

  doc.setDrawColor(30, 125, 95);
  doc.setLineWidth(1);
  doc.line(14, titleEndY + 2, pageWidth - 14, titleEndY + 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 100, 110);

  let startY = titleEndY + 10;

  doc.text(
    `Generato il: ${generatedAt.toLocaleString("it-IT")}`,
    14,
    startY
  );

  startY += 6;

  doc.text(`Numero di record: ${rows.length}`, 14, startY);

  startY += 7;

  if (description) {
    const descriptionLines = doc.splitTextToSize(
      description,
      contentWidth
    );

    doc.text(descriptionLines, 14, startY);
    startY += descriptionLines.length * 4 + 5;
  }

  autoTable(doc, {
    startY,
    head: [headers],
    body: normalizeRows(headers, rows),
    theme: "grid",
    margin: {
      top: 15,
      right: 14,
      bottom: 18,
      left: 14,
    },
    showHead: "everyPage",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.5,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [30, 105, 82],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [243, 247, 245],
    },
    didDrawPage: () => {
  const currentPage = doc.getNumberOfPages();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);

  doc.text(
    `Analisi del percorso cliente | Pagina ${currentPage}`,
    14,
    pageHeight - 8
  );
},
  });

  doc.save(`${getBaseFilename(filename)}.pdf`);
}

/** Gli export Excel/PDF caricano le librerie on-demand: un errore di rete non deve passare inosservato. */
function runExport(task: Promise<void>, onError: (message: string) => void): void {
  task.catch(() => onError("Esportazione non riuscita. Controlla la connessione e riprova."));
}

export function ExportButton({
  filename,
  headers,
  rows,
  title,
  description,
}: Props) {
  const reportTitle = getReportTitle(filename, title);
  const [open, setOpen] = useState(false);
  const [exportError, setExportError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        if (!items.length) return;
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(action: () => void) {
    setExportError("");
    setOpen(false);
    triggerRef.current?.focus();
    action();
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="export export-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Esporta
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="export-list" role="menu" aria-label="Formato di esportazione">
          <button type="button" role="menuitem" className="export-item" aria-label="Esporta CSV"
            onClick={() => choose(() => downloadCsv(filename, headers, rows))}>
            CSV
          </button>
          <button type="button" role="menuitem" className="export-item" aria-label="Esporta Excel"
            onClick={() => choose(() => runExport(downloadExcel(filename, headers, rows, reportTitle, description), setExportError))}>
            Excel
          </button>
          <button type="button" role="menuitem" className="export-item" aria-label="Esporta PDF"
            onClick={() => choose(() => runExport(downloadPdf(filename, headers, rows, reportTitle, description), setExportError))}>
            PDF
          </button>
        </div>
      )}
      {exportError && <p className="error" role="alert">{exportError}</p>}
    </div>
  );
}
