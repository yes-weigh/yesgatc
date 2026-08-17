import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/appVersion.ts');
const source = readFileSync(filePath, 'utf8');
const match = source.match(/APP_VERSION = 'V(\d+)\.(\d+)'/);
if (!match) {
  console.error('Could not parse APP_VERSION in src/lib/appVersion.ts');
  process.exit(1);
}

const next = `V${match[1]}.${Number(match[2]) + 1}`;
writeFileSync(filePath, source.replace(/APP_VERSION = 'V\d+\.\d+'/, `APP_VERSION = '${next}'`));
process.stdout.write(`${next}\n`);
