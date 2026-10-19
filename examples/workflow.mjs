import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [dataRoot, inputFile] = process.argv.slice(2);
if (!dataRoot || !inputFile) throw new Error('Usage: node examples/workflow.mjs /absolute/data input.csv');
const client = new Client({ name: 'local-workflow', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), '--data-root', dataRoot] }));
try {
  const result = await client.callTool({ name: 'quality_report', arguments: { path: inputFile, columns: { cas: 0, name: 1, formula: 2 } } });
  console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
  if (result.isError) process.exitCode = 1;
} finally { await client.close(); }
