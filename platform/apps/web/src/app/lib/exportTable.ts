/**
 * exportTable.ts — CSV export helper for tabular data surfaces.
 * Exports the full filtered+sorted set (not the current page).
 */

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function exportRowsToCsv(
  rows: any[],
  fields: { id: string; label: string }[],
  filename: string,
): void {
  const header = ['Name', ...fields.map(f => f.label)];
  const lines: string[] = [header.map(csvEscape).join(',')];

  for (const row of rows) {
    const cells = [
      String(row.name ?? ''),
      ...fields.map(f => {
        const v = row[f.id];
        if (v == null) return '';
        if (Array.isArray(v)) return v.join('; ');
        return String(v);
      }),
    ];
    lines.push(cells.map(csvEscape).join(','));
  }

  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
