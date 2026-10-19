import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { MAX_BYTES, MAX_CELLS, MAX_COLUMNS, MAX_ROWS, type Cell, type Sheet } from './core/engine.js';
import { parseFile } from './core/files.js';
import { checkCas, checkFormula, duplicates, finding, normalizeName, type Finding } from './chemistry.js';

export class ToolError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type DatasetInput = {
  path?: string; rows?: (Cell | null)[][]; header: boolean; sheetIndex: number;
  columns: { cas: number; name?: number; formula?: number };
  applyFixes: boolean; sampleLimit: number;
};
export type LocalRoots = { dataRoot: string; outputRoot: string };

export function enforceSheets(sheets: Sheet[]) {
  if (!sheets.length || sheets.length > 100) throw new ToolError('LIMIT', 'Expected 1 to 100 worksheets.');
  let cells = 0;
  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_ROWS + 1) throw new ToolError('LIMIT', 'Split input into at most 50,000 data rows.');
    for (const row of sheet.rows) {
      cells += row.length;
      if (row.length > MAX_COLUMNS || cells > MAX_CELLS) throw new ToolError('LIMIT', 'Column or total cell limit exceeded.');
      if (row.some(v => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)))) throw new ToolError('JSON_SHAPE', 'Cells must be strings, finite numbers, booleans or null.');
      if (row.some(v => typeof v === 'string' && v.length > 10000)) throw new ToolError('LIMIT', 'A cell exceeds 10,000 characters.');
    }
  }
}

export async function readDataset(input: DatasetInput, roots: LocalRoots): Promise<Sheet> {
  let sheets: Sheet[];
  if (input.rows) {
    sheets = [{ name: 'Data', rows: input.rows.map(r => r.map(c => c ?? '')) }];
  } else {
    const root = await realpath(roots.dataRoot);
    let resolved: string;
    try { resolved = await realpath(path.resolve(root, input.path!)); }
    catch { throw new ToolError('FILE_NOT_FOUND', 'Input file cannot be resolved.'); }
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ToolError('PATH_DENIED', 'Input must be inside the configured data root.');
    const extension = path.extname(resolved).toLowerCase();
    if (!['.json', '.csv', '.tsv', '.xlsx', '.xls'].includes(extension)) throw new ToolError('TYPE', 'Supported types: CSV, TSV, XLSX, XLS and JSON.');
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new ToolError('TYPE', 'Input must be a regular file.');
      if (stat.size > MAX_BYTES) throw new ToolError('LIMIT', 'File exceeds 20 MiB; split it before processing.');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, buffer.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset > MAX_BYTES) throw new ToolError('LIMIT', 'File exceeds 20 MiB.');
      bytes = buffer.subarray(0, offset);
    } finally { await handle.close(); }
    if (extension === '.json') {
      let data: unknown;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new ToolError('JSON_PARSE', 'Expected valid UTF-8 JSON.'); }
      if (!Array.isArray(data)) throw new ToolError('JSON_SHAPE', 'JSON must be an array of row arrays or flat objects.');
      if (data.length > MAX_ROWS + 1) throw new ToolError('LIMIT', 'Too many JSON records.');
      if (data.every(Array.isArray)) {
        sheets = [{ name: 'Data', rows: data.map(r => r.map((v: unknown) => v ?? '')) as Cell[][] }];
      } else if (data.length && data.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
        if (!input.header) throw new ToolError('JSON_SHAPE', 'Object arrays require header=true.');
        const keys = [...new Set(data.flatMap(Object.keys))];
        if (keys.length > MAX_COLUMNS || (data.length + 1) * keys.length > MAX_CELLS) throw new ToolError('LIMIT', 'Too many JSON fields or cells.');
        sheets = [{ name: 'Data', rows: [keys, ...data.map(r => keys.map(k => Object.hasOwn(r, k) ? r[k] ?? '' : ''))] }];
      } else throw new ToolError('JSON_SHAPE', 'Do not mix row arrays, objects or scalar records.');
    } else {
      try { sheets = parseFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, resolved); }
      catch (error) {
        const code = error instanceof Error ? error.message : 'FILE';
        throw new ToolError(['ROWS', 'COLUMNS', 'SIZE'].includes(code) ? 'LIMIT' : 'FILE_PARSE', `Cannot parse input (${/^[A-Z_]+$/.test(code) ? code : 'FILE'}).`);
      }
    }
  }
  enforceSheets(sheets);
  const sheet = sheets[input.sheetIndex];
  if (!sheet) throw new ToolError('SHEET', 'Worksheet index is out of range.');
  const width = Math.max(0, ...sheet.rows.map(r => r.length));
  const selected = Object.values(input.columns);
  if (selected.some(c => c >= width) || new Set(selected).size !== selected.length) throw new ToolError('COLUMN', 'Select distinct existing column indexes.');
  if (sheet.rows.length - (input.header ? 1 : 0) > MAX_ROWS) throw new ToolError('LIMIT', 'Too many data rows.');
  if (sheet.rows.length <= (input.header ? 1 : 0)) throw new ToolError('EMPTY_FILE', 'No data rows found.');
  return sheet;
}

export function inspectDataset(sheet: Sheet, input: DatasetInput) {
  const offset = input.header ? 1 : 0;
  const rows = sheet.rows.slice(offset);
  const dup = new Map(duplicates(rows.map(r => String(r[input.columns.cas] ?? ''))).duplicates.map(d => [d.index, d.duplicateOf]));
  const counts = { error: 0, warning: 0, automatic_fix: 0, unverifiable: 0 };
  const rowsByCategory = { error: 0, warning: 0, automatic_fix: 0, unverifiable: 0 };
  const issuesByCode: Record<string, number> = {};
  let changedRows = 0;
  const records = rows.map((original, index) => {
    const sourceRow = index + offset + 1;
    const cleaned = [...original];
    let cas = checkCas(String(original[input.columns.cas] ?? ''), input.applyFixes);
    if (sheet.dateCells?.[`${sourceRow - 1}:${input.columns.cas}`]) cas = {
      ...cas, value: String(original[input.columns.cas] ?? ''), valid: false, status: 'warning', suggestion: undefined,
      findings: [finding('warning', 'DATE', 'Excel date cell cannot be reconstructed as a CAS identifier.'), finding('unverifiable', 'CAS_IDENTITY_UNVERIFIED', 'Original identifier cannot be recovered from this date cell.')],
    };
    if (cas.value !== String(original[input.columns.cas] ?? '')) cleaned[input.columns.cas] = cas.value;
    const findings: Finding[] = [...cas.findings];
    const name = input.columns.name === undefined ? undefined : normalizeName(String(original[input.columns.name] ?? ''), input.applyFixes);
    if (name && input.columns.name !== undefined) {
      if (name.value !== String(original[input.columns.name] ?? '')) cleaned[input.columns.name] = name.value;
      findings.push(...name.findings);
    }
    const formula = input.columns.formula === undefined ? undefined : checkFormula(String(original[input.columns.formula] ?? ''));
    if (formula) findings.push(...formula.findings);
    const duplicateOf = dup.get(index);
    if (duplicateOf !== undefined) findings.push(finding('warning', 'DUPLICATE', `Duplicate of source row ${duplicateOf + offset + 1}; retained.`));
    for (const f of findings) { counts[f.category]++; issuesByCode[f.code] = (issuesByCode[f.code] ?? 0) + 1; }
    for (const category of new Set(findings.map(f => f.category))) rowsByCategory[category]++;
    if (cleaned.some((v, i) => v !== original[i])) changedRows++;
    return { sourceRow, original, cleaned, cas, name, formula, duplicateOf: duplicateOf === undefined ? undefined : duplicateOf + offset + 1, findings };
  });
  return {
    summary: { totalRows: rows.length, changedRows, duplicateRows: dup.size, findings: counts, rowsByCategory, issuesByCode },
    records,
  };
}

export async function writeArtifacts(sheet: Sheet, inspection: ReturnType<typeof inspectDataset>, input: DatasetInput, roots: LocalRoots) {
  await mkdir(roots.outputRoot, { recursive: true, mode: 0o700 });
  const root = await realpath(roots.outputRoot);
  const directory = await mkdtemp(path.join(root, 'run-'));
  const paths = { results: path.join(directory, 'results.json'), report: path.join(directory, 'report.json'), csv: path.join(directory, 'cleaned.csv'), excel: path.join(directory, 'cleaned.xlsx') };
  const width = Math.max(...sheet.rows.map(r => r.length));
  const headers = Array.from({ length: width }, (_, i) => input.header ? sheet.rows[0][i] ?? '' : `Column ${i + 1}`);
  const data = [headers, ...inspection.records.map(r => r.cleaned)];
  // CSV protection modifies only exported text; JSON retains exact original and cleaned cells.
  const safe = data.map(r => r.map(v => typeof v === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(v) ? `'${v}` : v));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Cleaned');
  const writes = [
    writeFile(paths.results, JSON.stringify({ sheet: sheet.name, headers, columns: input.columns, records: inspection.records }), { flag: 'wx', mode: 0o600 }),
    writeFile(paths.report, JSON.stringify(inspection.summary, null, 2), { flag: 'wx', mode: 0o600 }),
    writeFile(paths.csv, '\uFEFF' + Papa.unparse(safe), { flag: 'wx', mode: 0o600 }),
    writeFile(paths.excel, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }), { flag: 'wx', mode: 0o600 }),
  ];
  await Promise.all(writes);
  return paths;
}
