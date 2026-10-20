import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export function verifyTag(tag, pkg, lock) {
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(pkg.version), 'Invalid release version');
  assert.equal(tag, `v${pkg.version}`, 'Tag must exactly match package.json version');
  assert.equal(lock.version, pkg.version, 'Lockfile version mismatch');
  assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version mismatch');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'Release requires a pushed tag');
  verifyTag(
    process.env.GITHUB_REF_NAME,
    JSON.parse(await readFile('package.json', 'utf8')),
    JSON.parse(await readFile('package-lock.json', 'utf8')),
  );
  console.log('Release tag and package versions match.');
}
