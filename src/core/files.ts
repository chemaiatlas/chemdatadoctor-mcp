import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  MAX_BYTES,
  MAX_CELLS,
  MAX_COLUMNS,
  MAX_ROWS,
  type Cell,
  type Sheet,
} from './engine.js';

// Inspect ZIP metadata before SheetJS allocates decompressed workbook contents.
export function checkZip(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint32(0, true) !== 0x04034b50) return;
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('FILE');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    total = 0;
  if (count > 2000 || offset === 0xffffffff) throw new Error('SIZE');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('FILE');
    const packed = view.getUint32(offset + 20, true),
      unpacked = view.getUint32(offset + 24, true);
    total += unpacked;
    if (
      total > 100 * 1024 * 1024 ||
      unpacked > 50 * 1024 * 1024 ||
      unpacked / Math.max(packed, 1) > 1000
    )
      throw new Error('SIZE');
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}
function enforce(rows: Cell[][]): Cell[][] {
  if (rows.length > MAX_ROWS + 1) throw new Error('ROWS');
  if (rows.some((r) => r.length > MAX_COLUMNS)) throw new Error('COLUMNS');
  if (rows.reduce((n, r) => n + r.length, 0) > MAX_CELLS) throw new Error('SIZE');
  return rows;
}
export function parseText(text: string, delimiter?: string): Sheet[] {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('SIZE');
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: delimiter ?? '',
    skipEmptyLines: false,
  });
  if (parsed.errors.some((e) => e.code !== 'UndetectableDelimiter')) throw new Error('CSV');
  const rows = parsed.data;
  // One terminal line break is a record terminator, not an extra record.
  if (/\r?\n$/.test(text) && rows.at(-1)?.every((v) => !v)) rows.pop();
  if (!rows.some((r) => r.some((v) => v.trim()))) throw new Error('EMPTY_FILE');
  return [{ name: 'Data', rows: enforce(rows) }];
}
export function parseFile(buffer: ArrayBuffer, filename: string, encoding = 'utf-8'): Sheet[] {
  if (buffer.byteLength > MAX_BYTES) throw new Error('SIZE');
  if (/\.(csv|tsv)$/i.test(filename)) {
    let decoded: string;
    try {
      decoded = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      throw new Error('ENCODING');
    }
    return parseText(decoded, /\.tsv$/i.test(filename) ? '\t' : undefined);
  }
  if (!/\.xlsx?$/i.test(filename)) throw new Error('TYPE');
  checkZip(buffer);
  const book = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    cellFormula: false,
    cellNF: true,
    sheetRows: MAX_ROWS + 2,
  });
  if (book.SheetNames.length > 100) throw new Error('SIZE');
  let totalCells = 0;
  return book.SheetNames.map((name) => {
    const ws = book.Sheets[name];
    const dateCells: Record<string, true> = {};
    const ref = ws['!fullref'] ?? ws['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      if (range.e.r >= MAX_ROWS + 1) throw new Error('ROWS');
      if (range.e.c >= MAX_COLUMNS) throw new Error('COLUMNS');
      totalCells += (range.e.r + 1) * (range.e.c + 1);
      if (totalCells > MAX_CELLS) throw new Error('SIZE');
    }
    // Keep numbers as numbers, except dates: retain the displayed date for diagnosis.
    for (const key of Object.keys(ws)) {
      if (key.startsWith('!')) continue;
      const cell = ws[key];
      if (cell && cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
        const address = XLSX.utils.decode_cell(key);
        dateCells[`${address.r}:${address.c}`] = true;
        cell.t = 's';
        cell.v =
          cell.w ??
          XLSX.SSF.format(cell.z, cell.v, {
            date1904: book.Workbook?.WBProps?.date1904,
          });
        cell.z = '@';
        cell.w = cell.v;
      } else if (cell && cell.t === 'e') {
        cell.t = 's';
        cell.v = cell.w ?? '#ERROR!';
        cell.z = '@';
      }
    }
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: true,
      range: 0,
    });
    return { name, rows: enforce(rows), dateCells };
  });
}
