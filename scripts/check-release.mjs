import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.license, 'MIT');
assert(!pkg.private);
assert.equal(pkg.dependencies.xlsx, 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
// These two workflows share the reviewed standalone export boundary.
const roots = ['src', 'tests', 'scripts', 'docs', 'examples'];
const files = [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    assert(!entry.isSymbolicLink(), `Symlink in release tree: ${file}`);
    if (entry.isDirectory()) await walk(file);
    else files.push(file);
  }
}
for (const dir of roots) await walk(dir);
for (const file of files) {
  assert(!/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12)$/.test(file), `Sensitive filename: ${file}`);
  const body = await readFile(file, 'utf8');
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body), `Private key: ${file}`);
  assert(
    !/(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(
      body,
    ),
    `Credential pattern: ${file}`,
  );
  assert(!/\/Users\/[^/\s]+\/|(?:\d{1,3}\.){3}\d{1,3}/.test(body), `Internal path or IP: ${file}`);
}
for (const file of files.filter((f) => f.startsWith('src/'))) {
  const body = await readFile(file, 'utf8');
  assert(
    !/\bfetch\s*\(|https?:\/\/|from ['"]node:(?:http|https|net|dns)['"]|process\.env/.test(body),
    `Unexpected runtime network/config access: ${file}`,
  );
}
console.log(
  `Release boundary checked: ${files.length} files; MIT package, no detected credentials/internal paths or application network calls.`,
);
