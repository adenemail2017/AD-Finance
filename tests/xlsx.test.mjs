/**
 * XLSX writer tests — the generated file must be a structurally valid OOXML
 * package (ZIP container + required parts + stored-entry CRCs).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXLSX } from '../src/utils/xlsx.js';

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

/** Minimal ZIP reader for STORED (uncompressed) entries. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset < bytes.length - 4 && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.push({ name, method, crc, size, data });
    offset = dataStart + size;
  }
  return entries;
}

const sheets = [
  {
    name: 'Transactions',
    columns: [
      { key: 'date', label: 'Date', width: 12 },
      { key: 'description', label: 'Description', width: 30 },
      { key: 'amount', label: 'Amount', width: 14, style: 2, value: (row) => Number(row.amount) },
    ],
    rows: [
      { date: '2026-09-30', description: 'Gaji Bulanan', amount: 8500000 },
      { date: '2026-09-29', description: 'Belanja <Bulanan> & "Lain"', amount: 750000 },
    ],
  },
  {
    name: 'Rekap',
    columns: [{ key: 'a', label: 'Kategori' }, { key: 'b', label: 'Total', style: 2 }],
    rows: [{ a: 'Food', b: 2000000 }],
  },
];

test('xlsx package contains every required OOXML part', async () => {
  const blob = buildXLSX(sheets);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.ok(bytes.length > 800, 'file is not empty');

  const entries = readZip(bytes);
  const names = entries.map((e) => e.name);
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].forEach((required) => {
    assert.ok(names.includes(required), `missing part: ${required}`);
  });
  entries.forEach((entry) => {
    assert.equal(entry.method, 0, 'entries are stored (uncompressed)');
    assert.equal(crc32(entry.data), entry.crc, `CRC mismatch for ${entry.name}`);
    assert.equal(entry.data.length, entry.size);
  });
});

test('sheet contents escape XML and preserve numbers as numeric cells', async () => {
  const blob = buildXLSX(sheets);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(bytes);
  const sheet1 = new TextDecoder().decode(entries.find((e) => e.name === 'xl/worksheets/sheet1.xml').data);

  assert.match(sheet1, /<c r="A2"[^>]*t="inlineStr"><is><t xml:space="preserve">2026-09-30<\/t>/);
  assert.match(sheet1, /Belanja &lt;Bulanan&gt; &amp; &quot;Lain&quot;/, 'special characters escaped');
  assert.ok(!sheet1.includes('<Bulanan>'), 'no raw markup leaked into the file');
  assert.match(sheet1, /<c r="C2" s="2"><v>8500000<\/v><\/c>/, 'amounts are numeric cells with currency style');
  assert.match(sheet1, /<sheetData>/, 'sheetData present');
});

test('workbook exposes sheets in order with matching relationships', async () => {
  const blob = buildXLSX(sheets);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(bytes);
  const workbook = new TextDecoder().decode(entries.find((e) => e.name === 'xl/workbook.xml').data);
  const rels = new TextDecoder().decode(entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels').data);
  assert.match(workbook, /<sheet name="Transactions" sheetId="1" r:id="rId1"\/>/);
  assert.match(workbook, /<sheet name="Rekap" sheetId="2" r:id="rId2"\/>/);
  assert.match(rels, /Id="rId1"[^>]*worksheets\/sheet1\.xml/);
  assert.match(rels, /styles\.xml/);
});

test('sheet names longer than 31 chars are truncated', async () => {
  const long = 'A'.repeat(48);
  const blob = buildXLSX([{ name: long, columns: [{ key: 'x', label: 'X' }], rows: [{ x: 1 }] }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(bytes);
  const workbook = new TextDecoder().decode(entries.find((e) => e.name === 'xl/workbook.xml').data);
  assert.match(workbook, new RegExp(`name="${'A'.repeat(31)}"`));
});
