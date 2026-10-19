import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function checkFiles(files) {
  const names = files.map(file => file.path);
  for (const name of names) {
    assert(!name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')), `Unsafe package path: ${name}`);
    assert(
      ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'].includes(name) ||
      /^(?:docs|examples|third-party-licenses)\/[A-Za-z0-9@_./-]+$/.test(name) ||
      /^dist\/(?:core\/)?[a-z-]+\.(?:js|d\.ts)$/.test(name),
      `Unexpected package file: ${name}`,
    );
    assert(!/\.(?:pem|key|p12|tgz|zip|log)$/i.test(name), `Sensitive package file: ${name}`);
  }
  for (const required of ['package.json', 'dist/cli.js', 'dist/server.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
    assert(names.includes(required), `Missing package file: ${required}`);
  assert(names.some(name => name.startsWith('third-party-licenses/')), 'Missing dependency licenses');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // npm pack creates a local archive; it never publishes to a registry.
  // Pack outside the source tree, then promote only a validated installation archive.
  const temp = await mkdtemp(path.join(os.tmpdir(), 'mcp-release-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const [packed] = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { encoding: 'utf8' }));
    checkFiles(packed.files);
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const expected = `chemdatadoctor-mcp-${pkg.version}.tgz`;
    assert.equal(packed.filename, expected);
    const bytes = await readFile(path.join(temp, expected));
    const digest = createHash('sha256').update(bytes).digest('hex');
    await mkdir('release'); // refuse to overwrite a previous release candidate
    await rename(path.join(temp, expected), path.join('release', expected));
    await writeFile('release/SHA256SUMS', `${digest}  ${expected}\n`, { flag: 'wx' });
    console.log(`Created ${expected} and SHA256SUMS (${packed.files.length} allowlisted installation files).`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
