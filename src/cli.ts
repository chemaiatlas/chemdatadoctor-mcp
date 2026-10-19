#!/usr/bin/env node
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

try {
  const { values } = parseArgs({ options: { 'data-root': { type: 'string' }, 'output-root': { type: 'string' }, help: { type: 'boolean' } }, allowPositionals: false });
  if (values.help) {
    process.stderr.write('ChemDataDoctor MCP\nUsage: chemdatadoctor-mcp --data-root /absolute/data [--output-root /absolute/results]\nTransport: stdio. No runtime network access.\n');
  } else {
    if (!values['data-root']) throw new Error('Pass --data-root with an existing local directory.');
    const dataRoot = await realpath(path.resolve(values['data-root']));
    if (!(await stat(dataRoot)).isDirectory()) throw new Error('Data root must be a directory.');
    const outputRoot = path.resolve(values['output-root'] ?? path.join(dataRoot, '.chemdatadoctor-output'));
    const server = createServer({ dataRoot, outputRoot });
    await server.connect(new StdioServerTransport());
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().finally(() => process.exit(0)); });
  }
} catch {
  process.stderr.write('ChemDataDoctor MCP could not start. Use --help and provide an accessible --data-root.\n');
  process.exitCode = 1;
}
