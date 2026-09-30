/**
 * Minimal, dependency-free XLSX (OOXML SpreadsheetML) writer.
 * Produces a real .xlsx file (zip container, stored/uncompressed entries)
 * that Excel, Numbers, LibreOffice and Google Sheets all open natively.
 */

/* ---------------------------- CRC32 ------------------------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

/* ------------------------------ ZIP ------------------------------- */
function dosDateTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xFFFF;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
  return { time, day };
}

class ByteWriter {
  constructor() { this.chunks = []; this.length = 0; }

  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.push(b); }

  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.push(b); }

  bytes(b) { this.push(b); }

  push(b) { this.chunks.push(b); this.length += b.length; }

  blob(type) { return new Blob(this.chunks, { type }); }
}

function makeZip(files) {
  const writer = new ByteWriter();
  const { time, day } = dosDateTime();
  const central = [];

  files.forEach((file) => {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data;
    const crc = crc32(data);
    const offset = writer.length;

    writer.u32(0x04034b50);
    writer.u16(20);
    writer.u16(0x0800); // UTF-8 flag
    writer.u16(0); // stored
    writer.u16(time);
    writer.u16(day);
    writer.u32(crc);
    writer.u32(data.length);
    writer.u32(data.length);
    writer.u16(nameBytes.length);
    writer.u16(0);
    writer.bytes(nameBytes);
    writer.bytes(data);

    central.push({ nameBytes, crc, size: data.length, offset });
  });

  const centralStart = writer.length;
  central.forEach((f) => {
    writer.u32(0x02014b50);
    writer.u16(20);
    writer.u16(20);
    writer.u16(0x0800);
    writer.u16(0);
    writer.u16(time);
    writer.u16(day);
    writer.u32(f.crc);
    writer.u32(f.size);
    writer.u32(f.size);
    writer.u16(f.nameBytes.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(f.offset);
    writer.bytes(f.nameBytes);
  });
  const centralSize = writer.length - centralStart;

  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralStart);
  writer.u16(0);

  return writer.blob('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* ----------------------------- XLSX ------------------------------- */
function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cellXml(ref, value, styleId) {
  const style = styleId ? ` s="${styleId}"` : '';
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${style}/>`;
  if (typeof value === 'number' && isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

/**
 * @param {Array<{name: string, columns: Array<{key:string,label:string,width?:number,style?:number}>, rows: Array<object>}>} sheets
 */
export function buildXLSX(sheets) {
  const sheetFiles = sheets.map((sheet, index) => {
    const cols = sheet.columns;
    const widths = cols.map((c) => `<col min="${cols.indexOf(c) + 1}" max="${cols.indexOf(c) + 1}" width="${c.width || 16}" customWidth="1"/>`).join('');
    const header = `<row r="1">${cols.map((c, i) => cellXml(`${columnName(i)}1`, c.label, 1)).join('')}</row>`;
    const body = sheet.rows.map((row, r) => {
      const cells = cols.map((c, i) => {
        const value = typeof c.value === 'function' ? c.value(row) : row[c.key];
        return cellXml(`${columnName(i)}${r + 2}`, value, c.style);
      }).join('');
      return `<row r="${r + 2}">${cells}</row>`;
    }).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${widths}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
    return { name: `xl/worksheets/sheet${index + 1}.xml`, data: xml };
  });

  const workbookSheets = sheets.map((s, i) => `<sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbookRels = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: styles },
    ...sheetFiles,
  ];

  return makeZip(files);
}

export function exportXLSX(sheets, filename) {
  const blob = buildXLSX(sheets);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
