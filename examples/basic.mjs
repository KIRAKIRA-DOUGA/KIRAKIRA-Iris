import { readFileSync } from 'node:fs';
import { createIris } from '../dist/esm/index.js';

// Use a newline-separated keyword file from the source of your choice.
const path = process.argv[2];
if (!path) throw new Error('Usage: node examples/basic.mjs <keywords.txt> [content]');
const keywords = readFileSync(path, 'utf8').split(/\r?\n/).map(word => word.trim()).filter(Boolean);
const iris = createIris({ keywords });
console.log(JSON.stringify(iris.keywordModerate(process.argv[3] ?? ''), null, 2));
