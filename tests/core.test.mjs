import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, validChecksum, analyze, MAX_ROWS } from '../dist/core/engine.js';
import { checkCas, normalizeName, checkFormula, duplicates } from '../dist/chemistry.js';
import { parseText, parseFile, checkZip } from '../dist/core/files.js';
import { enforceSheets } from '../dist/dataset.js';

test('CAS regression: valid checksum and maximum identifier length', () => {
  for (const value of ['67-64-1', '64-17-5', '67-56-1', '1310-73-2', '50-00-0']) assert.equal(checkCas(value).valid, true);
  const stem = '123456712';
  const digit = [...stem].reverse().reduce((n, c, i) => n + Number(c) * (i + 1), 0) % 10;
  assert.equal(validChecksum(`1234567-12-${digit}`), true);
});
test('CAS regression: conservative normalization is opt-in', () => {
  for (const value of ['CAS: 67-64-1', 'CAS RN 67-64-1', '67–64–1', '67.64.1', ' 67-64-1 ', '67-\u200b64-1', '67 64 1']) {
    assert.equal(checkCas(value).value, value);
    const fixed = checkCas(value, true);
    assert.equal(fixed.value, '67-64-1');
    assert(fixed.findings.some(f => f.category === 'automatic_fix'));
  }
});
test('CAS regression: ambiguous and invalid identifiers never change', () => {
  for (const [value, issue] of [['0067-64-1', 'LEADING_ZERO'], ['67641', 'FORMAT'], ['67-64-2', 'CHECKSUM'], ['1934-01-05', 'DATE'], ['67-64-1;64-17-5', 'MULTIPLE'], ['Acetone (67-64-1)', 'EMBEDDED'], ['', 'EMPTY']]) {
    assert.equal(checkCas(value, true).value, value);
    assert(diagnose(value).issues.includes(issue));
    assert.equal(checkCas(value).valid, false);
  }
  assert.equal(diagnose('x'.repeat(10001)).status, 'warning');
});
test('name cleanup preserves stereochemistry and case', () => {
  const original = '  (R)-Sodium\u00a0  hydroxide\u200b ';
  assert.equal(normalizeName(original).value, '(R)-Sodium hydroxide');
  assert.equal(normalizeName(original, false).value, original);
  assert(normalizeName('').findings.some(f => f.code === 'EMPTY_NAME'));
});
test('formula syntax supports elements, groups, nested brackets and hydrates', () => {
  for (const value of ['H2O', 'C6H12O6', 'Ca(OH)2', 'K4[Fe(CN)6]', 'CuSO4·5H2O', 'Na2CO3.10H2O', 'Zn', 'Mn', 'Sn', 'In', 'Og']) assert.equal(checkFormula(value).status, 'valid_syntax', value);
  assert.deepEqual(checkFormula('CuSO4·5H2O').atoms, { Cu: 1, S: 1, O: 9, H: 10 });
  assert.deepEqual(checkFormula('K4[Fe(CN)6]').atoms, { K: 4, Fe: 1, C: 6, N: 6 });
});
test('formula errors and unsupported notation are distinguished with bounded recursion/counts', () => {
  for (const value of ['', 'Xx2', 'H0', 'H02', '()', 'Ca(OH', 'H2O)', 'H2O.', 'H1000001', '('.repeat(17) + 'H' + ')'.repeat(17), 'H1000000'.repeat(100)]) assert.equal(checkFormula(value).status, value.length > 256 ? 'unverifiable' : 'invalid', value);
  for (const value of ['NH4+', '[13C]H4', '[13C]H4-', 'H₂O', '(CH2)n', 'RCOOH', ' H2O']) assert.equal(checkFormula(value).status, 'unverifiable', value);
});
test('duplicates use safe CAS normalization, retain uncertain text and ignore blanks', () => {
  const d = duplicates(['CAS: 67-64-1', '67–64–1', '67-64-1', '', ' ', '67641', '67641']);
  assert.deepEqual(d.duplicates.map(x => [x.index, x.duplicateOf]), [[1, 0], [2, 0], [6, 5]]);
});
test('50,000 row core boundary and source row tracking', () => {
  const rows = Array.from({ length: MAX_ROWS }, () => ['67-64-1']);
  const mapping = { sheet: 0, header: false, cas: 0, name: -1 };
  assert.equal(analyze({ name: 'Data', rows }, mapping).at(-1).duplicateOf, 1);
  assert.throws(() => analyze({ name: 'Data', rows: [...rows, ['']] }, mapping), /ROWS/);
});
test('CSV quoting, multiline fields, BOM, empty lines and malformed input', () => {
  assert.deepEqual(parseText('\uFEFFCAS,Name\r\n67-64-1,"A, B"\r\n64-17-5,"two\nlines"\r\n')[0].rows, [['CAS', 'Name'], ['67-64-1', 'A, B'], ['64-17-5', 'two\nlines']]);
  assert.throws(() => parseText('a,b\n"unfinished'), /CSV/);
  assert.throws(() => parseText(' \n'), /EMPTY_FILE/);
  assert.throws(() => parseText(Array(201).fill('a').join(',')), /COLUMNS/);
  assert.throws(() => parseFile(new ArrayBuffer(0), 'file.exe'), /TYPE/);
  assert.throws(() => parseFile(new Uint8Array([0xff]).buffer, 'file.csv'), /ENCODING/);
});
test('ZIP metadata guard rejects dangerous expansion and malformed archives', () => {
  const buffer = new ArrayBuffer(100);
  const v = new DataView(buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint32(4, 0x02014b50, true);
  v.setUint32(24, 1, true);
  v.setUint32(28, 100000000, true);
  v.setUint32(78, 0x06054b50, true);
  v.setUint16(88, 1, true);
  v.setUint32(94, 4, true);
  assert.throws(() => checkZip(buffer), /SIZE/);
  assert.throws(() => checkZip(new Uint8Array([0x50, 0x4b, 3, 4]).buffer), /FILE/);
});
test('shared cell limits reject nested objects, oversize text, columns and total cells', () => {
  for (const rows of [[[{}]], [['a'.repeat(10001)]], [Array(201).fill('')], Array.from({length:10001}, () => Array(200).fill(''))]) assert.throws(() => enforceSheets([{ name:'Data', rows }]));
});
