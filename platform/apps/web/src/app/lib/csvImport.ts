/**
 * csvImport.ts — minimal RFC-4180-ish CSV parser for client-side file imports.
 * Handles: quoted fields, escaped double-quotes (""), commas/newlines inside quotes,
 * CRLF and LF line endings. Does NOT parse binary XLSX (follow-up task).
 */

/** Parse raw CSV text into a 2-D array of cell strings. Skips a trailing empty row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] === '"') {
      // Quoted field
      let field = '';
      i++; // skip opening quote
      while (i < n) {
        if (text[i] === '"') {
          if (i + 1 < n && text[i + 1] === '"') {
            // Escaped double-quote
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += text[i];
          i++;
        }
      }
      row.push(field);
      // After closing quote, expect comma or EOL
      if (i < n && text[i] === ',') i++;
    } else {
      // Unquoted field — read until comma or line ending
      let field = '';
      while (i < n && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
        field += text[i];
        i++;
      }
      row.push(field);
      if (i < n && text[i] === ',') i++;
    }

    // Handle line endings: CR, CRLF, LF
    if (i < n && (text[i] === '\r' || text[i] === '\n')) {
      if (text[i] === '\r' && i + 1 < n && text[i + 1] === '\n') i++; // CRLF
      i++;
      rows.push(row);
      row = [];
    }
  }

  // Push the last row if it has content
  if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
    rows.push(row);
  }

  return rows;
}

/** Parse CSV text into structured records. First row = headers. */
export function csvToRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map(h => h.trim());
  const records = rows.slice(1).map(row =>
    Object.fromEntries(headers.map((h, idx) => [h, row[idx]?.trim() ?? '']))
  );

  return { headers, records };
}
