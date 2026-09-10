import { Automaton } from './automaton.js';
import { normalizeText } from './normalize.js';
import type { KeywordMatch, KeywordResult, NormalizedText } from './types.js';

export class KeywordMatcher {
  private readonly words: string[];
  private readonly sourceMatcher: Automaton;
  private readonly normalizedMatcher: Automaton;

  constructor(keywords: readonly string[]) {
    if (!Array.isArray(keywords)) throw new TypeError('keywords must be a string array.');
    this.words = Array.from(keywords, word => {
      if (typeof word !== 'string' || !word.trim()) throw new TypeError('Each keyword must be a nonempty string.');
      return word;
    });
    const normalized = this.words.map(word => normalizeText(word).normalizeString);
    this.sourceMatcher = new Automaton(this.words);
    this.normalizedMatcher = this.words.every((word, index) => word === normalized[index])
      ? this.sourceMatcher : new Automaton(normalized);
  }

  check(text: NormalizedText, maxMatches: number): KeywordResult {
    const matchesInSource: KeywordMatch[] = [];
    const matchesInNormalize: KeywordMatch[] = [];
    const add = (wordIndex: number, start: number, end: number, inSource: boolean): void => {
      if (matchesInSource.length + matchesInNormalize.length >= maxMatches) {
        throw new RangeError(`Keyword matches exceed maxMatches (${maxMatches}).`);
      }
      (inSource ? matchesInSource : matchesInNormalize).push({
        hitWord: this.words[wordIndex]!, start, end,
      });
    };
    if (this.sourceMatcher === this.normalizedMatcher && text.source === text.normalizeString) {
      // Share the scan while keeping independent match objects in both arrays.
      this.sourceMatcher.scan(text.source, (word, start, end) => {
        add(word, start, end, true);
        add(word, start, end, false);
      });
    } else {
      this.sourceMatcher.scan(text.source, (word, start, end) => add(word, start, end, true));
      this.normalizedMatcher.scan(text.normalizeString, (word, start, end) => add(word, start, end, false));
    }
    matchesInSource.sort((a, b) => a.start - b.start || a.end - b.end);
    matchesInNormalize.sort((a, b) => a.start - b.start || a.end - b.end);
    return {
      hit: matchesInSource.length > 0 || matchesInNormalize.length > 0,
      normalizeString: text.normalizeString, matchesInSource, matchesInNormalize,
    };
  }
}
