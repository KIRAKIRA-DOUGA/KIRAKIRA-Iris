import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris, normalizeText, mapNormalizedRange, mapSourceRange } from '../dist/esm/index.js';

test('raw and normalized matches retain every occurrence and merge equivalent spans', () => {
  const source = '前危险词危\n-险\u200b词后危险词';
  const result = createIris({ keywords: ['危险词'] }).keywordModerate(source);
  assert.equal(result.hit, true);
  assert.equal(result.hite, true);
  assert.equal(result.isIllegal, true);
  assert.equal(result.hitWord, result.hiteWord);
  assert.equal(result.matches.length, 3);
  assert.deepEqual(result.matches[0].matchedIn, ['source', 'normalized']);
  assert.deepEqual(result.matches[1].matchedIn, ['normalized']);
  for (const match of result.matches) {
    assert.equal(source.slice(match.wordStartInSource, match.wordEndInSource), match.sourceText);
    assert.equal(result.normalizeString.slice(match.wordStartInNormalize, match.wordEndInNormalize), '危险词');
  }
});

test('normalizes fullwidth, punctuation, emoji and invisible spacing on both sides', () => {
  const iris = createIris({ keywords: ['ＢＡＤ'] });
  const result = iris.keywordModerate('💜b.a\nd\u200b\uFEFF');
  assert.equal(result.isIllegal, true);
  assert.equal(result.normalizeString, 'bad');
  assert.equal(result.wordStartInSource, 2);
  assert.equal(result.wordEndInSource, 7);
  assert.equal(normalizeText('Ａ-Ｂ\nＣ\u200B\uFEFF\t💜危險\r\n詞').normalizeString, 'abc危险词');
});

test('simplified, traditional and mixed Chinese match in both directions', () => {
  for (const keyword of ['危险词', '危險詞', '危險词']) {
    const iris = createIris({ keywords: [keyword] });
    for (const source of ['危险词', '危險詞', '危險词', '危-險\n詞']) {
      const result = iris.keywordModerate(source);
      assert.equal(result.hit, true, keyword + ': ' + source);
      assert.equal(result.normalizeString, '危险词');
      assert.equal(result.matches[0].sourceText, source);
    }
  }
});

test('Chinese many-to-one variants share canonical characters without translating vocabulary', () => {
  for (const [keyword, source] of [['头发', '頭髮'], ['发展', '發展'], ['台湾', '臺灣'], ['里面', '裏面'], ['里面', '裡面'], ['为', '爲']]) {
    assert.equal(createIris({ keywords: [keyword] }).keywordModerate(source).hit, true);
  }
  assert.equal(createIris({ keywords: ['软件'] }).keywordModerate('軟體').hit, false);
});

test('traditional Chinese offsets remain UTF-16 source positions after emoji and obfuscation', () => {
  const source = '💜前危\u200b險-詞後';
  const result = createIris({ keywords: ['危险词'] }).keywordModerate(source);
  assert.equal(result.wordStartInSource, 3);
  assert.equal(result.wordEndInSource, 8);
  assert.equal(source.slice(result.wordStartInSource, result.wordEndInSource), '危\u200b險-詞');
  assert.equal(result.normalizeString.slice(result.wordStartInNormalize, result.wordEndInNormalize), '危险词');
});

test('grapheme composition preserves split accents, Hangul and supplementary characters', () => {
  const source = '💜e\u200b\u0301 ᄀ-ᅡ ﬃ 𠮷';
  const value = normalizeText(source);
  assert.equal(value.normalizeString, 'é가ffi𠮷');
  assert.deepEqual(mapNormalizedRange(value, 0, 1), { start: 2, end: 5 });
  const hangul = mapNormalizedRange(value, 1, 2);
  assert.equal(source.slice(hangul.start, hangul.end), 'ᄀ-ᅡ');
  const supplementary = mapNormalizedRange(value, value.normalizeString.length - 2, value.normalizeString.length);
  assert.equal(source.slice(supplementary.start, supplementary.end), '𠮷');
});

test('normalization is idempotent and its source map is monotonic', () => {
  for (const source of ['💜e\u200b\u0301', '危-險\n詞', 'Ａⓑﬃ', '頭髮發展', '𠮷a', 'I\u0307']) {
    const text = normalizeText(source);
    assert.equal(normalizeText(text.normalizeString).normalizeString, text.normalizeString);
    assert.equal(text.sourceMap.length, text.normalizeString.length);
    for (let i = 0; i < text.sourceMap.length; i++) {
      assert.ok(text.sourceMap[i].start >= 0);
      assert.ok(text.sourceMap[i].end <= source.length);
      assert.ok(text.sourceMap[i].end > text.sourceMap[i].start);
      if (i) assert.ok(text.sourceMap[i].start >= text.sourceMap[i - 1].start);
    }
  }
});

test('ASCII fast path matches Unicode normalization for all ASCII code points', () => {
  const ascii = String.fromCharCode(...Array.from({ length: 128 }, (_, index) => index));
  const fast = normalizeText(ascii);
  const general = normalizeText(ascii + '漢');
  assert.equal(general.normalizeString, fast.normalizeString + '汉');
  assert.deepEqual(general.sourceMap.slice(0, -1), fast.sourceMap);
});

test('shared scan preserves distinct raw/normalized ranges for combining graphemes', () => {
  const source = 'a\u0321';
  const result = createIris({ keywords: ['a'] }).keywordModerate(source);
  assert.equal(result.normalizeString, source);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].wordEndInSource, 1);
  assert.equal(result.matches[1].wordEndInSource, 2);
});

test('all hits are illegal and summary uses source order, retaining custom comments', () => {
  const result = createIris({ keywords: ['第二', { word: '第一', id: 'rule-1', category: 'test', comment: '自定义评论' }] }).keywordModerate('第一第二');
  assert.equal(result.isIllegal, true);
  assert.equal(result.hitWord, '第一');
  assert.equal(result.comment, '自定义评论');
  assert.equal(result.matches[0].id, 'rule-1');
  assert.equal(result.matches[0].category, 'test');
  assert.equal('severity' in result, false);
  assert.equal('severity' in result.matches[0], false);
});

test('no embedded keywords; empty dictionary stays empty', () => {
  const result = createIris().keywordModerate('任意内容 dangerous bad');
  assert.equal(result.hit, false);
  assert.equal(result.isIllegal, false);
  assert.equal(result.hitWord, null);
  assert.equal(result.wordStartInSource, -1);
  assert.deepEqual(result.matches, []);
});

test('symbols-only rules match the original text with no normalized interval', () => {
  const result = createIris({ keywords: ['!!!'] }).keywordModerate('!!!');
  assert.equal(result.isIllegal, true);
  assert.equal(result.wordStartInNormalize, -1);
  assert.equal(result.wordEndInNormalize, -1);
  assert.deepEqual(result.matches[0].matchedIn, ['source']);
});

test('Aho-Corasick emits overlaps, suffixes and duplicate rules', () => {
  assert.equal(createIris({ keywords: ['a', 'aa', 'aaa', 'aa'] }).keywordModerate('aaa').matches.length, 8);
  assert.deepEqual(createIris({ keywords: ['he', 'she', 'hers', 'his'] }).keywordModerate('ushers').matches.map(match => match.hitWord), ['she', 'he', 'hers']);
});

test('compatibility expansions retain separate normalized matches', () => {
  const result = createIris({ keywords: ['f'] }).keywordModerate('ﬃ');
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(match => match.wordStartInNormalize), [0, 1]);
  for (const match of result.matches) assert.equal(match.sourceText, 'ﬃ');
});

test('range helpers reject invalid ranges and project stripped characters to -1', () => {
  const text = normalizeText('a-b');
  assert.deepEqual(mapSourceRange(text, 1, 2), { start: -1, end: -1 });
  for (const range of [[-1, 1], [0, 0], [0, 50], [0.5, 1]]) {
    assert.throws(() => mapSourceRange(text, ...range), RangeError);
    assert.throws(() => mapNormalizedRange(text, ...range), RangeError);
  }
});

test('limits reject rather than returning truncated review results', () => {
  assert.throws(() => createIris({ maxInputLength: 2 }).keywordModerate('abc'), /maxInputLength/);
  assert.throws(() => createIris({ maxMatches: 2, keywords: ['a'] }).keywordModerate('aaa'), /maxMatches/);
});

test('caller rules are copied; invalid and obsolete keyword configuration is rejected', () => {
  const mutable = [{ word: 'a' }];
  const iris = createIris({ keywords: mutable });
  mutable[0].word = 'b';
  assert.equal(iris.keywordModerate('a').hit, true);
  for (const keyword of ['', ' ', {}, { word: 'a', comment: 3 }, { word: 'a', severity: 'general' }]) {
    assert.throws(() => createIris({ keywords: [keyword] }), TypeError);
  }
});

test('seeded fuzz matches an exhaustive literal reference for every occurrence', () => {
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const word = length => Array.from({ length }, () => 'abc'[Math.floor(random() * 3)]).join('');
  for (let trial = 0; trial < 100; trial++) {
    const keywords = Array.from({ length: 15 }, () => word(1 + Math.floor(random() * 5)));
    const input = word(50);
    const actual = createIris({ keywords }).keywordModerate(input).matches
      .map(match => `${match.ruleIndex}:${match.wordStartInSource}:${match.wordEndInSource}`).sort();
    const expected = [];
    keywords.forEach((keyword, index) => {
      for (let start = 0; start <= input.length - keyword.length; start++) {
        if (input.startsWith(keyword, start)) expected.push(`${index}:${start}:${start + keyword.length}`);
      }
    });
    assert.deepEqual(actual, expected.sort());
  }
});
