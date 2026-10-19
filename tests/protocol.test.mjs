import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolSchemas } from '../dist/server.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const defaults = { columns: { cas: 0, name: 1, formula: 2 } };
const fixture = 'CAS,Name,Formula\nCAS: 67-64-1, Acetone ,C3H6O\n67-64-1,=1+1,C3H6O\n67-64-2,Bad,Xx2\n67641,Unknown,NH4+\n';

test('real stdio MCP lifecycle, schemas, all tools, errors and offline file safety', { timeout: 30000 }, async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'chemdatadoctor-test-'));
  const dataRoot = path.join(base, 'data');
  const outputRoot = path.join(base, 'output');
  await mkdir(dataRoot);
  await writeFile(path.join(dataRoot, 'input.csv'), fixture);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--require', path.join(repo, 'tests/no-network.cjs'), path.join(repo, 'dist/cli.js'), '--data-root', dataRoot, '--output-root', outputRoot], stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  t.after(async () => { await client.close(); assert.equal(stderr, ''); });
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, 'chemdatadoctor-mcp');
  await client.ping();
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(x => x.name).sort(), Object.keys(toolSchemas).sort());
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.outputSchema.type, 'object');
    assert.equal(tool.annotations.openWorldHint, false);
  }
  const call = async (name, args, errorCode) => {
    const result = await client.callTool({ name, arguments: args });
    const body = result.structuredContent;
    if (body) {
      toolSchemas[name].output.parse(body);
      assert.deepEqual(JSON.parse(result.content[0].text), body);
    }
    if (errorCode) { assert.equal(result.isError, true); if (errorCode !== 'SCHEMA') assert.equal(body.error.code, errorCode); }
    else { assert.equal(result.isError, false); assert.equal(body.ok, true); }
    return body?.data;
  };
  await t.test('individual tools: valid, invalid, empty and corrected values', async () => {
    const cas = await call('validate_cas', { values: ['67-64-1', 'CAS: 67-64-1', '67-64-2', ''], applyFixes: true });
    assert.equal(cas.results[1].value, '67-64-1');
    assert.equal(cas.results[2].valid, false);
    const names = await call('normalize_names', { values: ['  (R)-A\u200b ', ''] });
    assert.equal(names.results[0].value, '(R)-A');
    const formulas = await call('validate_formulas', { values: ['Ca(OH)2', 'Xx2', 'NH4+'] });
    assert.deepEqual(formulas.results.map(x => x.status), ['valid_syntax', 'invalid', 'unverifiable']);
    const dup = await call('detect_duplicates', { values: ['67-64-1', 'CAS: 67-64-1', '', ''] });
    assert.equal(dup.duplicates.length, 1);
    assert.equal(dup.duplicates[0].duplicateOf, 0);
  });
  await t.test('invalid input schemas for every tool and unknown-tool recovery', async () => {
    for (const name of Object.keys(toolSchemas)) await call(name, {}, 'SCHEMA');
    await call('validate_cas', { values: ['x'], extra: true }, 'SCHEMA');
    await call('normalize_names', { values: [42] }, 'SCHEMA');
    await call('validate_formulas', { values: Array(101).fill('H2O') }, 'SCHEMA');
    await call('detect_duplicates', { values: Array(1001).fill('a') }, 'SCHEMA');
    await call('quality_report', { ...defaults, path: 'input.csv', rows: [['a']] }, 'SCHEMA');
    await call('clean_dataset', { ...defaults, rows: Array(202).fill(['a']) }, 'SCHEMA');
    const unknown = await client.callTool({ name: 'no_such_tool', arguments: {} });
    assert.equal(unknown.isError, true);
    await client.ping();
  });
  await t.test('individual tool boundaries and headerless row-count limit', async () => {
    for (const name of ['validate_cas', 'normalize_names', 'validate_formulas']) {
      const data = await call(name, {values:Array(100).fill('H2O')});
      assert.equal(data.results.length,100);
      await call(name, {values:['a'.repeat(10001)]}, 'SCHEMA');
    }
    assert.equal((await call('detect_duplicates', {values:Array(1000).fill('67-64-1')})).duplicates.length,999);
    await call('quality_report', {rows:[['CAS']], columns:{cas:0}}, 'EMPTY_FILE');
  });
  await t.test('quality report is read-only and compact with categorized counts', async () => {
    const report = await call('quality_report', { ...defaults, path: 'input.csv' });
    assert.equal(report.summary.totalRows, 4);
    assert.equal(report.summary.changedRows, 0);
    assert.equal(report.summary.duplicateRows, 1);
    assert(report.summary.findings.error > 0);
    assert(report.summary.findings.warning > 0);
    assert(report.summary.findings.unverifiable > 0);
    assert.deepEqual(report.samples, []);
    assert(!JSON.stringify(report).includes('Acetone'));
    await assert.rejects(stat(outputRoot));
    const preview = await call('quality_report', { ...defaults, path: 'input.csv', applyFixes: true, sampleLimit: 1 });
    assert.equal(preview.summary.changedRows, 1);
    assert.equal(preview.samples.length, 1);
  });
  await t.test('cleaning retains originals and duplicates, prevents overwrite, neutralizes CSV formulas', async () => {
    const args = { ...defaults, path: 'input.csv', applyFixes: true };
    const clean = await call('clean_dataset', args);
    assert.equal(await readFile(path.join(dataRoot, 'input.csv'), 'utf8'), fixture);
    const results = JSON.parse(await readFile(clean.artifacts.results, 'utf8'));
    assert.equal(results.records.length, 4);
    assert.equal(results.records[0].original[0], 'CAS: 67-64-1');
    assert.equal(results.records[0].cleaned[0], '67-64-1');
    assert.equal(results.records[1].duplicateOf, 2);
    assert.equal(results.records[2].cleaned[0], '67-64-2');
    assert.equal(results.records[1].original[1], '=1+1');
    assert((await readFile(clean.artifacts.csv, 'utf8')).includes("'=1+1"));
    const workbook = XLSX.read(await readFile(clean.artifacts.excel));
    assert.equal(workbook.Sheets.Cleaned.B3.t, 's');
    assert.equal(workbook.Sheets.Cleaned.B3.f, undefined);
    const again = await call('clean_dataset', args);
    assert.notEqual(again.artifacts.results, clean.artifacts.results);
    assert.equal((await readdir(outputRoot)).length, 2);
  });
  await t.test('JSON rows and objects, null cells, headerless inline data and TSV', async () => {
    await writeFile(path.join(dataRoot, 'objects.json'), JSON.stringify([{ cas: '67-64-1', name: null }, { cas: '67-64-2', name: 'B' }]));
    const objects = await call('quality_report', { path: 'objects.json', columns: { cas: 0, name: 1 } });
    assert.equal(objects.summary.totalRows, 2);
    await writeFile(path.join(dataRoot, 'special-keys.json'), '[{"cas":"67-64-1","toString":"A","__proto__":"B"},{"cas":"64-17-5"}]');
    assert.equal((await call('quality_report', {path:'special-keys.json', columns:{cas:0,name:1}})).summary.totalRows,2);
    await writeFile(path.join(dataRoot, 'arrays.json'), JSON.stringify([['CAS'], ['67-64-1']]));
    assert.equal((await call('quality_report', { path: 'arrays.json', columns: { cas: 0 } })).summary.totalRows, 1);
    const inline = await call('quality_report', { rows: [['67-64-1'], [null]], header: false, columns: { cas: 0 } });
    assert.equal(inline.summary.totalRows, 2);
    const numeric = await call('clean_dataset', {rows:[[67641,42,false]], header:false, columns:{cas:0,name:1}});
    assert.equal(numeric.summary.changedRows,0);
    const numericRecords = JSON.parse(await readFile(numeric.artifacts.results,'utf8'));
    assert.deepEqual(numericRecords.records[0].cleaned,[67641,42,false]);
    await writeFile(path.join(dataRoot, 'input.tsv'), 'CAS\tName\n67-64-1\tA');
    assert.equal((await call('quality_report', { path: 'input.tsv', columns: { cas: 0 } })).summary.totalRows, 1);
  });
  await t.test('Excel XLS/XLSX sheets and date cells never get guessed fixes', async () => {
    for (const bookType of ['xls', 'xlsx']) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['CAS'], ['67-64-1']]), 'First');
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['CAS'], [new Date('2024-01-01T00:00:00Z')]]), 'Dates');
      await writeFile(path.join(dataRoot, `book.${bookType}`), XLSX.write(book, {type:'buffer', bookType}));
      const report = await call('quality_report', {path:`book.${bookType}`, sheetIndex:1, columns:{cas:0}, applyFixes:true, sampleLimit:1});
      assert(report.samples[0].issueCodes.includes('DATE'));
      assert.equal(report.summary.changedRows, 0);
    }
  });
  await t.test('path traversal, symlink escapes, malformed files, wrong columns and bounds', async () => {
    await writeFile(path.join(base, 'outside.csv'), 'CAS\n67-64-1');
    await symlink(path.join(base, 'outside.csv'), path.join(dataRoot, 'escape.csv'));
    for (const file of ['../outside.csv', path.join(base, 'outside.csv'), 'escape.csv']) await call('quality_report', { path: file, columns: { cas: 0 } }, 'PATH_DENIED');
    await call('clean_dataset', { path: 'missing.csv', columns: { cas: 0 } }, 'FILE_NOT_FOUND');
    for (const name of ['clean_dataset', 'quality_report']) {
      await call(name, { path: 'input.csv', columns: { cas: 99 } }, 'COLUMN');
      await call(name, { path: 'input.csv', sheetIndex: 99, columns: { cas: 0 } }, 'SHEET');
      await call(name, { path: 'input.csv', columns: { cas: 0, name: 0 } }, 'COLUMN');
    }
    for (const [file, content, code] of [['bad.json','[','JSON_PARSE'],['nested.json','[{"cas":{}}]','JSON_SHAPE'],['empty.json','[]','COLUMN'],['bad.csv','a,b\n"unfinished','FILE_PARSE'],['bad.txt','x','TYPE']]) {
      await writeFile(path.join(dataRoot,file),content);
      await call('quality_report', {path:file, columns:{cas:0}}, code);
    }
    await writeFile(path.join(dataRoot, 'large.csv'), Buffer.alloc(20 * 1024 * 1024 + 1));
    await call('quality_report', {path:'large.csv', columns:{cas:0}}, 'LIMIT');
    await writeFile(path.join(dataRoot, 'many.csv'), 'CAS\n' + '67-64-1\n'.repeat(50001));
    await call('quality_report', {path:'many.csv', columns:{cas:0}}, 'LIMIT');
    await writeFile(path.join(dataRoot, 'max.csv'), 'CAS\n' + '67-64-1\n'.repeat(50000));
    const maximum = await call('quality_report', {path:'max.csv', columns:{cas:0}});
    assert.equal(maximum.summary.totalRows, 50000);
    assert.equal(maximum.summary.duplicateRows, 49999);
    assert(JSON.stringify(maximum).length < 2000);
  });
});

test('CLI help and invalid startup keep stdout clean', () => {
  const help = spawnSync(process.execPath, ['dist/cli.js', '--help'], {cwd:repo, encoding:'utf8'});
  assert.equal(help.status, 0); assert.equal(help.stdout, ''); assert(help.stderr.includes('stdio'));
  const invalid = spawnSync(process.execPath, ['dist/cli.js'], {cwd:repo, encoding:'utf8'});
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
});

test('wire compatibility with earlier MCP protocol versions', {timeout:10000}, async t => {
  for (const protocolVersion of ['2024-11-05','2025-03-26','2025-06-18']) await t.test(protocolVersion, async t => {
    const child = spawn(process.execPath,['dist/cli.js','--data-root',repo],{cwd:repo,stdio:['pipe','pipe','pipe']});
    t.after(() => child.kill());
    const pending = new Map();
    let buffer = '';
    child.stdout.on('data', bytes => {
      buffer += bytes;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0,newline)); buffer = buffer.slice(newline+1);
        const resolve = pending.get(message.id); if (resolve) { pending.delete(message.id); resolve(message); }
      }
    });
    let id = 0;
    const request = (method,params) => new Promise(resolve => {
      const current = ++id; pending.set(current,resolve);
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');
    });
    const initialized = await request('initialize',{protocolVersion, capabilities:{},clientInfo:{name:'wire-test',version:'1'}});
    assert.equal(initialized.result.protocolVersion,protocolVersion);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    assert.equal((await request('tools/list',{})).result.tools.length,6);
    const result = await request('tools/call',{name:'validate_cas',arguments:{values:['67-64-1']}});
    assert.equal(JSON.parse(result.result.content[0].text).data.results[0].valid,true);
    assert.equal((await request('unknown/method',{})).error.code,-32601);
    assert.deepEqual((await request('ping',{})).result,{});
    child.stdin.end();
  });
});
