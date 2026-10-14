import { downloadCsv, type CsvCell } from "../csv";

interface Props {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
}

export function ExportButton({ filename, headers, rows }: Props) {
  return (
    <button type="button" className="export" onClick={() => downloadCsv(filename, headers, rows)}>
      Esporta CSV
    </button>
  );
}
