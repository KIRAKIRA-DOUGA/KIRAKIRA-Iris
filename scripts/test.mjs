import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(new URL('../test/', import.meta.url))
  .filter(file => file.endsWith('.test.mjs')).sort().map(file => `test/${file}`);
execFileSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
