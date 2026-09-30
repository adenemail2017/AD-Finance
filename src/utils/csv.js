/** CSV export helpers (Excel-friendly: UTF-8 BOM + ; or , delimiter). */

export function toCSV(rows, columns, { delimiter = ',' } = {}) {
  const escapeCell = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    if (/["\n\r]|,|;/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = columns.map((c) => escapeCell(c.label)).join(delimiter);
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value ? c.value(row) : row[c.key])).join(delimiter));
  return [head, ...body].join('\r\n');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  downloadBlob(blob, filename);
}

export function exportCSV(rows, columns, filename, opts = {}) {
  const csv = toCSV(rows, columns, opts);
  downloadText(`\ufeff${csv}`, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function timestampedName(base) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
