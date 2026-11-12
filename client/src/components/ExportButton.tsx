
import { downloadCsv, type CsvCell } from "../csv";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

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

function downloadExcel(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
  title: string,
  description?: string
): void {
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
    Subject: "Report Customer Journey Intelligence",
    Author: "Customer Journey Intelligence",
    CreatedDate: generatedAt,
  };

  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");

  XLSX.writeFile(workbook, `${getBaseFilename(filename)}.xlsx`, {
    compression: true,
  });
}

function downloadPdf(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
  title: string,
  description?: string
): void {
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
    subject: "Report Customer Journey Intelligence",
    creator: "Customer Journey Intelligence",
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
    `Customer Journey Intelligence | Pagina ${currentPage}`,
    14,
    pageHeight - 8
  );
},
  });

  doc.save(`${getBaseFilename(filename)}.pdf`);
}

export function ExportButton({
  filename,
  headers,
  rows,
  title,
  description,
}: Props) {
  const reportTitle = getReportTitle(filename, title);

  return (
    <div className="export-group">
      <button
        type="button"
        className="export"
        onClick={() => downloadCsv(filename, headers, rows)}
        title="Esporta i dati in formato CSV"
      >
        Esporta CSV
      </button>

      <button
        type="button"
        className="export"
        onClick={() =>
          downloadExcel(
            filename,
            headers,
            rows,
            reportTitle,
            description
          )
        }
        title="Esporta i dati in formato Excel"
      >
        Esporta Excel
      </button>

      <button
        type="button"
        className="export"
        onClick={() =>
          downloadPdf(
            filename,
            headers,
            rows,
            reportTitle,
            description
          )
        }
        title="Esporta i dati in formato PDF"
      >
        Esporta PDF
      </button>
    </div>
  );
}
