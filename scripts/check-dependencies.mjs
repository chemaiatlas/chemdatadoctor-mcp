import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Validate installed metadata as well as the lockfile, including build/test packages.
const allowed = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
let count = 0;
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location) continue;
  assert(
    location.startsWith('node_modules/') && !location.split('/').includes('..') && !entry.link,
    'Linked/local dependency requires review',
  );
  const source = new URL(entry.resolved);
  assert(
    source.protocol === 'https:' &&
      !source.username &&
      !source.password &&
      !source.search &&
      ['registry.npmjs.org', 'cdn.sheetjs.com'].includes(source.hostname),
    'Dependency source requires review',
  );
  assert(/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity), 'Missing lockfile integrity');
  const installed = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
  assert(
    installed.version === entry.version &&
      allowed.has(installed.license) &&
      installed.license === entry.license,
    'Dependency version/license requires review',
  );
  assert(
    (await readdir(location)).some((file) => /^(LICENSE|COPYING)(\..*)?$/i.test(file)),
    'Dependency license text is missing',
  );
  count++;
}
console.log(
  `Dependency license/source check passed for ${count} runtime and development packages.`,
);
