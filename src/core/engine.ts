export type Status = 'healthy' | 'fixable' | 'warning' | 'invalid' | 'empty';
export type Issue =
  | 'VALID'
  | 'CHECKSUM'
  | 'FORMAT'
  | 'PREFIX'
  | 'SEPARATOR'
  | 'WHITESPACE'
  | 'INVISIBLE'
  | 'LEADING_ZERO'
  | 'MULTIPLE'
  | 'EMBEDDED'
  | 'DATE'
  | 'EMPTY'
  | 'NAME'
  | 'DUPLICATE';
export interface Diagnosis {
  status: Status;
  issues: Issue[];
  suggestion?: string;
}
export interface Result extends Diagnosis {
  id: number;
  row: number;
  original: string;
  value: string;
  name: string;
  originalName: string;
  nameSuggestion?: string;
  duplicateOf?: number;
  changed: boolean;
}
export type Cell = string | number | boolean;
export interface Sheet {
  name: string;
  rows: Cell[][];
  dateCells?: Record<string, true>;
}
export interface Mapping {
  sheet: number;
  header: boolean;
  cas: number;
  name: number;
}
export interface Edit {
  value: string;
  name: string;
}
export const MAX_ROWS = 50000;
export const MAX_COLUMNS = 200;
export const MAX_CELLS = 2000000;
export const MAX_BYTES = 20 * 1024 * 1024;
export const cleanText = (value: string) =>
  value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
export function validChecksum(value: string): boolean {
  if (!/^[1-9]\d{1,6}-\d{2}-\d$/.test(value)) return false;
  const digits = value.replace(/-/g, '');
  return (
    [...digits.slice(0, -1)].reverse().reduce((sum, n, i) => sum + Number(n) * (i + 1), 0) % 10 ===
    Number(digits.at(-1))
  );
}
const candidate =
  /(?<![\dA-Za-z])\d{2,9}(?:\s*[-\u2010-\u2015\u2212.]+\s*|\s+)\d{2}(?:\s*[-\u2010-\u2015\u2212.]+\s*|\s+)\d(?![\dA-Za-z])/g;
const normalize = (v: string) => v.replace(/\s*[-\u2010-\u2015\u2212.]+\s*|\s+/g, '-');
export function diagnose(input: unknown): Diagnosis {
  const original = String(input ?? '');
  if (original.length > 10000) return { status: 'warning', issues: ['FORMAT'] };
  const value = cleanText(original);
  if (!value) return { status: 'empty', issues: ['EMPTY'] };
  if (
    /^(?:(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])|\d{1,2}[/]\d{1,2}[/]\d{2,4}|\d{1,2}[- ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[- ]\d{2,4})(?:\s.*)?$/i.test(
      value,
    )
  )
    return { status: 'warning', issues: ['DATE'] };
  const matches = [...value.matchAll(candidate)];
  if (matches.length > 1) return { status: 'warning', issues: ['MULTIPLE'] };
  if (!matches.length)
    return { status: /^\d+$/.test(value) ? 'warning' : 'invalid', issues: ['FORMAT'] };
  const found = matches[0];
  const normalized = normalize(found[0]);
  if (/^0/.test(normalized)) return { status: 'warning', issues: ['LEADING_ZERO'] };
  if (!/^[1-9]\d{1,6}-\d{2}-\d$/.test(normalized)) return { status: 'invalid', issues: ['FORMAT'] };
  const before = value.slice(0, found.index).trim();
  const after = value.slice((found.index ?? 0) + found[0].length).trim();
  // Only identifier labels are safe to strip. Chemical names, punctuation and units need review.
  const safeLabel =
    /^(?:CAS(?:\s*(?:RN|No\.?|Number|Registry\s+Number|号|编号|番号))?\s*[:：#]?\s*)?$/i;
  const safeSurrounding = safeLabel.test(before) && !after;
  if (!safeSurrounding)
    return {
      status: 'warning',
      issues: ['EMBEDDED', ...(!validChecksum(normalized) ? ['CHECKSUM' as Issue] : [])],
      suggestion: normalized,
    };
  if (!validChecksum(normalized)) return { status: 'invalid', issues: ['CHECKSUM'] };
  const issues: Issue[] = [];
  if (before) issues.push('PREFIX');
  if (/[\u200B-\u200D\u2060\uFEFF]/.test(original)) issues.push('INVISIBLE');
  if (original !== original.trim() || /\s/.test(found[0])) issues.push('WHITESPACE');
  if (normalize(found[0]) !== found[0] && /[^\d\s-]|--/.test(found[0])) issues.push('SEPARATOR');
  if (original !== normalized && !issues.length) issues.push('SEPARATOR');
  return issues.length
    ? { status: 'fixable', issues, suggestion: normalized }
    : { status: 'healthy', issues: ['VALID'] };
}
export function analyze(
  sheet: Sheet,
  mapping: Mapping,
  edits = new Map<number, Edit>(),
  progress?: (n: number) => void,
): Result[] {
  const rows = sheet.rows.slice(mapping.header ? 1 : 0);
  if (rows.length > MAX_ROWS) throw new Error('ROWS');
  const seen = new Map<string, number>();
  return rows.map((cells, id) => {
    const row = id + (mapping.header ? 2 : 1);
    const original = String(cells[mapping.cas] ?? '');
    const originalName = mapping.name >= 0 ? String(cells[mapping.name] ?? '') : '';
    const edit = edits.get(id);
    const value = edit?.value ?? original;
    const name = edit?.name ?? originalName;
    const diagnosis: Diagnosis =
      sheet.dateCells?.[`${row - 1}:${mapping.cas}`] && value === original
        ? { status: 'warning', issues: ['DATE'] }
        : diagnose(value);
    const nameSuggestion =
      mapping.name >= 0 && cleanText(name) !== name ? cleanText(name) : undefined;
    if (nameSuggestion !== undefined) {
      diagnosis.issues = diagnosis.issues.filter((i) => i !== 'VALID').concat('NAME');
      if (diagnosis.status === 'healthy') diagnosis.status = 'fixable';
    }
    const key =
      diagnosis.status === 'healthy' || diagnosis.status === 'fixable'
        ? (diagnosis.suggestion ?? value)
        : value;
    const duplicateOf = key.trim() ? seen.get(key) : undefined;
    if (key.trim() && duplicateOf === undefined) seen.set(key, row);
    if (duplicateOf !== undefined)
      diagnosis.issues = diagnosis.issues.filter((i) => i !== 'VALID').concat('DUPLICATE');
    if (id % 1000 === 0) progress?.(Math.round((id / Math.max(rows.length, 1)) * 100));
    return {
      ...diagnosis,
      id,
      row,
      original,
      value,
      name,
      originalName,
      nameSuggestion,
      duplicateOf,
      changed: value !== original || name !== originalName,
    };
  });
}
export function guessColumn(headers: Cell[], rows: Cell[][]): number {
  const named = headers.findIndex((h) =>
    /^cas(?:\s*(?:rn|number|registry\s*number|no\.?|#|号|编号|番号))?$/i.test(String(h).trim()),
  );
  if (named >= 0) return named;
  rows = [headers, ...rows];
  let best = -1,
    score = 0;
  for (let c = 0; c < Math.max(headers.length, ...rows.slice(0, 30).map((r) => r.length)); c++) {
    const values = rows
      .slice(0, 30)
      .map((r) => String(r[c] ?? ''))
      .filter(Boolean);
    const ratio =
      values.filter((v) => ['healthy', 'fixable'].includes(diagnose(v).status)).length /
      Math.max(values.length, 1);
    if (ratio > score && ratio >= 0.5) {
      best = c;
      score = ratio;
    }
  }
  return best;
}
