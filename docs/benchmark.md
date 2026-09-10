# Matching benchmark

Run `npm run bench` to reproduce. Data is synthetic, with 100,000 lowercase ASCII characters and 10 matches per input dimension; five timed samples after warmup, median reported. Both scanners must return the same match count. Each of the two result arrays contains 10 entries (20 total). Automatic tests also compare every offset against an exhaustive reference.

Measured for 0.3.0 on Windows, Node v23.5.0, 2026-09-10:

| Keywords | AC scan | Repeated indexOf | Full keywordModerate |
| ---: | ---: | ---: | ---: |
| 10 | 1.92 ms | 0.37 ms | 5.45 ms |
| 1,000 | 3.63 ms | 39.21 ms | 10.17 ms |
| 10,000 | 5.71 ms | 383.90 ms | 9.28 ms |

The full method includes normalization, source mapping, both matching dimensions and sorting into independent arrays. AC scan cost is O(n + z); mapping and sorting additionally cost O(z log n + z log z). The build occurs at initialization and explicit dictionary refresh. Identical raw/normalized dictionaries share an automaton; identical input views can share a scan. ASCII normalization avoids Unicode composition and the intermediate source map.

These measurements support retaining AC for large dictionaries; they do not claim it wins for small dictionaries, every input distribution, or dense overlapping matches. Chinese conversion and dense matches have additional costs. With the same synthetic 10,000-keyword case, the full method took about 38.47 ms before the normalization and shared-scan optimizations.
