import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
// Only remove this package's generated output directory.
rmSync(dist, { recursive: true, force: true });
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const compile = args => execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: 'inherit' });
compile(['-p', 'tsconfig.json']);
compile(['-p', 'tsconfig.json', '--module', 'CommonJS', '--moduleResolution', 'Node', '--verbatimModuleSyntax', 'false', '--outDir', 'dist/cjs']);
mkdirSync(new URL('cjs/', dist), { recursive: true });
writeFileSync(new URL('cjs/package.json', dist), JSON.stringify({ type: 'commonjs' }) + '\n');
