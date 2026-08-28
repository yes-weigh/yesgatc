import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const androidDir = join(root, 'android');

if (existsSync(androidDir)) {
  process.exit(0);
}

const result = spawnSync('npx', ['cap', 'add', 'android'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
