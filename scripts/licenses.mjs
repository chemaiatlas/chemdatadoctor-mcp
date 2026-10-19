import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const entries = Object.entries(lock.packages).filter(([key, value]) => key && !value.dev);
await mkdir('third-party-licenses', { recursive: true });
const inventory = [];
for (const [location, info] of entries) {
  const pkg = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
  if (!['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD'].includes(pkg.license)) throw new Error(`Review license for ${pkg.name}: ${pkg.license}`);
  const licenseFiles = (await readdir(location)).filter(name => /^(?:LICENSE|COPYING|NOTICE)(?:\..*)?$/i.test(name));
  if (!licenseFiles.length) throw new Error(`Missing license: ${location}`);
  for (const file of licenseFiles) await writeFile(path.join('third-party-licenses', `${pkg.name.replaceAll('/', '__')}--${file}`), await readFile(path.join(location, file)));
  if (pkg.name === 'xlsx') await writeFile('third-party-licenses/xlsx--dist-LICENSE', await readFile(path.join(location, 'dist/LICENSE')));
  inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license, resolved: info.resolved, integrity: info.integrity });
}
await writeFile('docs/dependency-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
console.log(`Retained licenses for ${inventory.length} production packages.`);
