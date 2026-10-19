import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const server = createServer({ dataRoot: '.', outputRoot: './artifacts' });
const client = new Client({ name: 'schema-export', version: '1.0.0' });
await server.connect(serverSide);
await client.connect(clientSide);
try {
  const { tools } = await client.listTools();
  await writeFile('docs/tool-schemas.json', JSON.stringify({ tools }, null, 2) + '\n');
} finally { await client.close(); await server.close(); }
