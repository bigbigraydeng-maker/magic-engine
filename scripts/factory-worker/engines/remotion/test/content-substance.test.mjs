import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanText,
  isSubstantive,
  unionSeconds,
  contentSubstanceOf,
} from '../src/contentSubstance.ts';

test('cleanText strips zero-width/bidi characters and collapses spaces', () => {
  assert.equal(cleanText('  a\u200Bb  '), 'ab');
  assert.equal(cleanText('a\u202Eb\uFEFFc'), 'abc');
  assert.equal(cleanText('hello   world'), 'hello world');
  assert.equal(cleanText('\u0000\u001Fabc'), 'abc');
});

test('isSubstantive basic rules', () => {
  assert.equal(isSubstantive('ab'), false);
  assert.equal(isSubstantive('abc'), true);
  assert.equal(isSubstantive('中文'), true);
  assert.equal(isSubstantive('中'), false);
  assert.equal(isSubstantive('$3,480'), false);
  assert.equal(isSubstantive('  '), false);
  assert.equal(isSubstantive('a\u200B'), false);
});

test('unionSeconds merges overlapping and disjoint intervals', () => {
  assert.equal(unionSeconds([[0, 2], [1, 3]]), 3);
  assert.equal(unionSeconds([[0, 1], [2, 3]]), 2);
  assert.equal(unionSeconds([[0, 1], [0.5, 1.5], [3, 4]]), 2.5);
  assert.equal(unionSeconds([]), 0);
});

test('atmosphere: null line fails', () => {
  const result = contentSubstanceOf('atmosphere', {
    line: null,
    durationSec: 15,
    fadeInSec: 1,
    fadeOutSec: 1.5,
  });
  assert.equal(result.verdict, 'fail');
});

test('atmosphere: sourced line passes with expected textSeconds', () => {
  const result = contentSubstanceOf('atmosphere', {
    line: {
      text: 'The old town at dusk',
      sourceUrl: 'https://example.test/a',
      sourceQuote: 'The old town at dusk.',
    },
    durationSec: 15,
    fadeInSec: 1,
    fadeOutSec: 1.5,
  });
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.kinds, ['selling_line']);
  assert.equal(result.textSeconds, 11.9);
});

test('atmosphere: empty sourceQuote fails', () => {
  const result = contentSubstanceOf('atmosphere', {
    line: {
      text: 'The old town at dusk',
      sourceUrl: 'https://example.test/a',
      sourceQuote: '',
    },
    durationSec: 15,
    fadeInSec: 1,
    fadeOutSec: 1.5,
  });
  assert.equal(result.verdict, 'fail');
});

test('postcard: sourced scenes and brand card pass', () => {
  const props = {
    timing: { hookSec: 3, sceneSec: 4, priceSec: 4 },
    hook: { lines: ['Discover the city'] },
    scenes: [
      {
        place: 'Shanghai',
        line: 'The skyline',
        sourceUrl: 'https://example.test/a',
        sourceQuote: 'The skyline.',
      },
      {
        place: 'Shanghai',
        line: 'The skyline',
        sourceUrl: 'https://example.test/a',
        sourceQuote: 'The skyline.',
      },
    ],
    price: null,
    end: { title: 'BRAND', backdropClip: 'clips/x.mp4' },
  };
  const result = contentSubstanceOf('postcard', props);
  assert.equal(result.verdict, 'pass');
  assert.ok(result.kinds.includes('place_or_tour'));
  assert.ok(result.kinds.includes('selling_line'));
  assert.ok(result.kinds.includes('brand_card'));
});

test('postcard: short places, empty lines, no end fails', () => {
  const props = {
    timing: { hookSec: 3, sceneSec: 4, priceSec: 4 },
    hook: { lines: ['Discover the city'] },
    scenes: [
      {
        place: 'a',
        line: '',
        sourceUrl: 'https://example.test/a',
        sourceQuote: 'The skyline.',
      },
      {
        place: 'a',
        line: '',
        sourceUrl: 'https://example.test/a',
        sourceQuote: 'The skyline.',
      },
    ],
    price: null,
    end: null,
  };
  const result = contentSubstanceOf('postcard', props);
  assert.equal(result.verdict, 'fail');
});

function makeListBeats() {
  const beats = [];
  for (let i = 0; i < 19; i++) beats.push(i * 0.5);
  return beats;
}

test('list: brand card reveal passes', () => {
  const props = {
    beats: makeListBeats(),
    hook: { lines: [{ text: 'Top places' }] },
    items: [
      { text: 'Alpha Place' },
      { text: 'Beta Place' },
      { text: 'Gamma Place' },
    ],
    revealTitle: 'BRAND TOUR',
  };
  const result = contentSubstanceOf('list', props);
  assert.equal(result.verdict, 'pass');
  assert.ok(result.kinds.includes('brand_card'));
});

test('list: price-like reveal and short items fail (the hook alone never counts)', () => {
  const props = {
    beats: makeListBeats(),
    hook: { lines: [{ text: 'Top places' }] },
    items: [
      { text: 'Alpha Place' },
      { text: 'Beta Place' },
      { text: 'Gamma Place' },
    ],
    revealTitle: '$3,480',
  };
  const result = contentSubstanceOf('list', props);
  assert.equal(result.verdict, 'fail');
  assert.ok(!result.kinds.includes('hook_text'));
  assert.ok(!result.kinds.includes('place_or_tour'));
  assert.ok(!result.kinds.includes('brand_card'));
});

function makeMontageBeats() {
  const beats = [];
  for (let i = 0; i < 33; i++) beats.push(i * 0.5);
  return beats;
}

test('montage: ten words pass', () => {
  const words = [];
  for (let i = 0; i < 10; i++) {
    words.push({ at: i, beats: 1, text: `word${i}` });
  }
  const result = contentSubstanceOf('montage', {
    beats: makeMontageBeats(),
    totalBeats: 32,
    words,
  });
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.kinds, ['kinetic_words']);
  assert.ok(Math.abs(result.textSeconds - 5) < 0.2);
});

test('montage: four words fail', () => {
  const words = [];
  for (let i = 0; i < 4; i++) {
    words.push({ at: i, beats: 1, text: `word${i}` });
  }
  const result = contentSubstanceOf('montage', {
    beats: makeMontageBeats(),
    totalBeats: 32,
    words,
  });
  assert.equal(result.verdict, 'fail');
});

test('unknown template fails', () => {
  const result = contentSubstanceOf('mystery', {});
  assert.equal(result.verdict, 'fail');
  assert.equal(result.reason, '未知模板：内容闸不放行');
});
