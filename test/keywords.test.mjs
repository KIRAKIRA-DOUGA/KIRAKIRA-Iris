import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris, normalizeText, mapNormalizedRange, mapSourceRange } from '../dist/esm/index.js';

test('raw and normalized arrays retain independent matches with offsets in their own text', () => {
  const source = '前危险词危\n-险\u200b词后危险词';
  const result = createIris({ keywords: ['危险词'] }).keywordModerate(source);
  assert.equal(result.hit, true);
  assert.equal(result.matchesInSource.length, 2);
  assert.equal(result.matchesInNormalize.length, 3);
  assert.deepEqual(result.matchesInSource.map(({ start, end }) => [start, end]), [[1, 4], [11, 14]]);
  assert.deepEqual(result.matchesInNormalize.map(({ start, end }) => [start, end]), [[1, 4], [4, 7], [8, 11]]);
  for (const match of result.matchesInSource) {
    assert.equal(source.slice(match.start, match.end), '危险词');
  }
  for (const match of result.matchesInNormalize) {
    assert.equal(match.hitWord, '危险词');
    assert.equal(result.normalizeString.slice(match.start, match.end), '危险词');
  }
});

test('normalizes fullwidth, punctuation, emoji and invisible spacing on both sides', () => {
  const iris = createIris({ keywords: ['ＢＡＤ'] });
  const result = iris.keywordModerate('💜b.a\nd\u200b\uFEFF');
  assert.equal(result.hit, true);
  assert.equal(result.normalizeString, 'bad');
  assert.equal(result.matchesInSource.length, 0);
  assert.equal(result.matchesInNormalize[0].hitWord, 'ＢＡＤ');
  assert.equal(result.matchesInNormalize[0].start, 0);
  assert.equal(result.matchesInNormalize[0].end, 3);
  assert.equal(normalizeText('Ａ-Ｂ\nＣ\u200B\uFEFF\t💜危險\r\n詞').normalizeString, 'abc危险词');
});

test('simplified, traditional and mixed Chinese match in both directions', () => {
  for (const keyword of ['危险词', '危險詞', '危險词']) {
    const iris = createIris({ keywords: [keyword] });
    for (const source of ['危险词', '危險詞', '危險词', '危-險\n詞']) {
      const result = iris.keywordModerate(source);
      assert.equal(result.hit, true, keyword + ': ' + source);
      assert.equal(result.normalizeString, '危险词');
      const match = result.matchesInNormalize[0];
      assert.equal(match.hitWord, keyword);
      assert.equal(result.normalizeString.slice(match.start, match.end), '危险词');
    }
  }
});

test('Chinese many-to-one variants share canonical characters without translating vocabulary', () => {
  for (const [keyword, source] of [['头发', '頭髮'], ['发展', '發展'], ['台湾', '臺灣'], ['里面', '裏面'], ['里面', '裡面'], ['为', '爲']]) {
    assert.equal(createIris({ keywords: [keyword] }).keywordModerate(source).hit, true);
  }
  assert.equal(createIris({ keywords: ['软件'] }).keywordModerate('軟體').hit, false);
});

test('source and normalized matches use their own UTF-16 offsets after emoji and obfuscation', () => {
  const source = '💜𠮷前危\u200b險-詞後';
  const result = createIris({ keywords: ['危险词', '危\u200b險-詞'] }).keywordModerate(source);
  const original = result.matchesInSource[0];
  assert.equal(original.start, 5);
  assert.equal(original.end, 10);
  assert.equal(source.slice(original.start, original.end), '危\u200b險-詞');
  assert.equal(result.normalizeString, '𠮷前危险词后');
  assert.equal(result.matchesInNormalize.length, 2);
  for (const match of result.matchesInNormalize) {
    assert.equal(match.start, 3);
    assert.equal(match.end, 6);
    assert.equal(result.normalizeString.slice(match.start, match.end), '危险词');
  }
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

test('shared scan keeps literal offsets without expanding combining grapheme spans', () => {
  const source = 'a\u0321';
  const result = createIris({ keywords: ['a'] }).keywordModerate(source);
  assert.equal(result.normalizeString, source);
  assert.equal(result.matchesInSource.length, 1);
  assert.equal(result.matchesInNormalize.length, 1);
  assert.deepEqual(result.matchesInSource[0], { hitWord: 'a', start: 0, end: 1 });
  assert.deepEqual(result.matchesInNormalize[0], { hitWord: 'a', start: 0, end: 1 });
});

test('public keyword results contain only hit, text and two sorted match arrays', () => {
  const result = createIris({ keywords: ['第二', '第一'] }).keywordModerate('第一第二');
  assert.deepEqual(Object.keys(result).sort(), ['hit', 'matchesInNormalize', 'matchesInSource', 'normalizeString']);
  for (const matches of [result.matchesInSource, result.matchesInNormalize]) {
    assert.deepEqual(matches.map(match => match.hitWord), ['第一', '第二']);
    assert.deepEqual(Object.keys(matches[0]).sort(), ['end', 'hitWord', 'start']);
  }
  result.matchesInSource[0].hitWord = 'changed';
  result.matchesInSource[0].start = 1;
  assert.equal(result.matchesInNormalize[0].hitWord, '第一');
  assert.equal(result.matchesInNormalize[0].start, 0);
});

test('no embedded keywords; empty dictionary stays empty', () => {
  const result = createIris().keywordModerate('任意内容 dangerous bad');
  assert.equal(result.hit, false);
  assert.deepEqual(result.matchesInSource, []);
  assert.deepEqual(result.matchesInNormalize, []);
});

test('keywords normalized to empty strings only match the original text', () => {
  const result = createIris({ keywords: ['!!!'] }).keywordModerate('!!!');
  assert.equal(result.hit, true);
  assert.deepEqual(result.matchesInSource[0], { hitWord: '!!!', start: 0, end: 3 });
  assert.deepEqual(result.matchesInNormalize, []);
});

test('Aho-Corasick emits overlaps, suffixes and duplicate rules', () => {
  const result = createIris({ keywords: ['a', 'aa', 'aaa', 'aa'] }).keywordModerate('aaa');
  assert.equal(result.matchesInSource.length, 8);
  assert.equal(result.matchesInNormalize.length, 8);
  assert.deepEqual(createIris({ keywords: ['he', 'she', 'hers', 'his'] }).keywordModerate('ushers').matchesInSource.map(match => match.hitWord), ['she', 'he', 'hers']);
});

test('compatibility expansions retain separate normalized matches', () => {
  const result = createIris({ keywords: ['f'] }).keywordModerate('ﬃ');
  assert.equal(result.matchesInSource.length, 0);
  assert.deepEqual(result.matchesInNormalize.map(({ start, end }) => [start, end]), [[0, 1], [1, 2]]);
  for (const match of result.matchesInNormalize) {
    assert.equal(result.normalizeString.slice(match.start, match.end), 'f');
  }
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
  assert.throws(() => createIris({ maxMatches: 1, keywords: ['a'] }).keywordModerate('a'), /maxMatches/);
  const result = createIris({ maxMatches: 2, keywords: ['a'] }).keywordModerate('a');
  assert.equal(result.matchesInSource.length + result.matchesInNormalize.length, 2);
});

test('caller strings are copied and object keywords are rejected', () => {
  const mutable = ['a'];
  const iris = createIris({ keywords: mutable });
  mutable[0] = 'b';
  assert.equal(iris.keywordModerate('a').hit, true);
  for (const keyword of ['', ' ', {}, { word: 'a' }, { word: 'a', comment: 'x' }, null, 3, undefined]) {
    assert.throws(() => createIris({ keywords: [keyword] }), TypeError);
  }
  assert.throws(() => createIris({ keywords: new Array(1) }), TypeError);
});

test('seeded fuzz matches an exhaustive literal reference for every occurrence', () => {
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const word = length => Array.from({ length }, () => 'abc'[Math.floor(random() * 3)]).join('');
  for (let trial = 0; trial < 100; trial++) {
    const keywords = Array.from({ length: 15 }, () => word(1 + Math.floor(random() * 5)));
    const input = word(50);
    const result = createIris({ keywords }).keywordModerate(input);
    const expected = [];
    keywords.forEach(keyword => {
      for (let start = 0; start <= input.length - keyword.length; start++) {
        if (input.startsWith(keyword, start)) expected.push(`${keyword}:${start}:${start + keyword.length}`);
      }
    });
    for (const matches of [result.matchesInSource, result.matchesInNormalize]) {
      const actual = matches.map(match => `${match.hitWord}:${match.start}:${match.end}`).sort();
      assert.deepEqual(actual, expected.sort());
    }
  }
});
