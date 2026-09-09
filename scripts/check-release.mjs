import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
if (tag !== `v${pkg.version}`) throw new Error(`Release tag must be v${pkg.version}; received ${tag ?? '(missing)'}.`);
if (pkg.private) throw new Error('package.json marks this package private.');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('This workflow publishes stable versions only.');
console.log(`Ready to publish ${pkg.name}@${pkg.version}.`);
