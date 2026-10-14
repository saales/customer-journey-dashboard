export type CsvCell = string | number | null;

const DELIMITER = ";"; // separatore usato da Excel con impostazioni regionali italiane

function cell(value: CsvCell): string {
  if (value === null) return "";
  // numeri con la virgola decimale, come si aspetta Excel in italiano
  const text = typeof value === "number" ? String(value).replace(".", ",") : value;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Costruisce il contenuto di un file CSV (con BOM UTF-8, così Excel legge bene gli accenti). */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(cell).join(DELIMITER));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
