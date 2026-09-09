import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Automaton } from '../dist/esm/automaton.js';
import { createIris } from '../dist/esm/index.js';

// Synthetic data only: no production keywords are shipped with the library.
let seed = 12345;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const text = size => Array.from({ length: size }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 26)]).join('');
const input = text(100_000);
const median = run => {
  run(); // Warm up before measurement.
  const samples = Array.from({ length: 5 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return Number(samples[2].toFixed(2));
};
const results = [];
for (const size of [10, 1000, 10_000]) {
  const words = Array.from({ length: size }, () => text(8));
  for (let i = 0; i < Math.min(size, 10); i++) words[i] = input.slice(i * 100, i * 100 + 8);
  const buildStart = performance.now();
  const automaton = new Automaton(words);
  const buildMs = Number((performance.now() - buildStart).toFixed(2));
  const scan = () => {
    let count = 0;
    automaton.scan(input, () => { count++; });
    return count;
  };
  const naive = () => {
    let count = 0;
    for (const word of words) {
      let from = 0;
      while (true) {
        const index = input.indexOf(word, from);
        if (index < 0) break;
        count++;
        from = index + 1;
      }
    }
    return count;
  };
  assert.equal(scan(), naive());
  const iris = createIris({ keywords: words });
  assert.equal(iris.keywordModerate(input).matches.length, scan());
  results.push({
    keywords: size, utf16Length: input.length, matches: scan(),
    buildMs, ahoCorasickMs: median(scan), indexOfPerWordMs: median(naive),
    keywordModerateMs: median(() => iris.keywordModerate(input)),
  });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, samples: 5, statistic: 'median', results }, null, 2));
