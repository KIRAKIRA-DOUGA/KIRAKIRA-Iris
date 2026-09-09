# Matching benchmark

Run `npm run bench` to reproduce. Data is synthetic, with 100,000 lowercase ASCII characters and 10 matches; five timed samples after warmup, median reported. Both scanners must return the same match count. Automatic tests also compare every offset against an exhaustive reference.

Measured on Windows, Node v23.5.0, 2026-09-10:

| Keywords | AC scan | Repeated indexOf | Full keywordModerate |
| ---: | ---: | ---: | ---: |
| 10 | 1.71 ms | 0.37 ms | 8.18 ms |
| 1,000 | 3.77 ms | 38.17 ms | 9.23 ms |
| 10,000 | 5.87 ms | 381.63 ms | 10.88 ms |

The full method includes normalization, source mapping, both matching dimensions, deduplication and sorting. AC scan cost is O(n + z); mapping and sorting additionally cost O(z log n + z log z). The build occurs once per Iris instance. Identical raw/normalized dictionaries share an automaton; identical input views can share a scan. ASCII normalization avoids Unicode composition and the intermediate source map.

These measurements support retaining AC for large dictionaries; they do not claim it wins for small dictionaries, every input distribution, or dense overlapping matches. Chinese conversion and dense matches have additional costs. With the same synthetic 10,000-keyword case, the full method took about 38.47 ms before the normalization and shared-scan optimizations.
