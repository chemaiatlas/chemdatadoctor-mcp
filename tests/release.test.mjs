import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTag } from '../scripts/verify-tag.mjs';
import { checkFiles } from '../scripts/package-release.mjs';

const pkg = { version: '0.1.0' };
const lock = { version: '0.1.0', packages: { '': { version: '0.1.0' } } };
test('release rejects mismatched tags and lockfile versions', () => {
  verifyTag('v0.1.0', pkg, lock);
  for (const tag of ['v0.2.0', '0.1.0', 'v0.1.0-extra', 'vlatest'])
    assert.throws(() => verifyTag(tag, pkg, lock));
  assert.throws(() => verifyTag('v0.1.0', pkg, { ...lock, version: '0.2.0' }));
  assert.throws(() => verifyTag('v0.1.0', pkg, { ...lock, packages: { '': { version: '0.2.0' } } }));
});
const files = ['package.json', 'dist/cli.js', 'dist/server.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party-licenses/example--LICENSE'].map(path => ({ path }));
test('installation package rejects private files, unsafe paths and missing runtime/licenses', () => {
  checkFiles(files);
  for (const path of ['.env', '../package.json', 'src/private.ts', 'dist/private.txt', '.github/workflows/ci.yml', 'node_modules/example/index.js', 'docs/.env', 'docs/private.key', 'docs/../secret'])
    assert.throws(() => checkFiles([...files, { path }]));
  for (const path of ['dist/cli.js', 'LICENSE', 'third-party-licenses/example--LICENSE'])
    assert.throws(() => checkFiles(files.filter(file => file.path !== path)));
});
