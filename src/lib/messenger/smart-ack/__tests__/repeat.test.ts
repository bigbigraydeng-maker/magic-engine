/**
 * Draft tests for repeat.ts. The maintainer will move this file next to the
 * module and adjust the import path from '../repeat' to "../repeat".
 */

import { describe, it, expect } from 'vitest'
import {
  PREFILLED_PHRASES,
  isPrefilledOpener,
  shouldSkipRepeatedMessage,
  isSameAsLastOutbound,
} from '../repeat'

describe('PREFILLED_PHRASES', () => {
  it('contains the normalised forms of the Meta openers', () => {
    expect(PREFILLED_PHRASES.length).toBe(7)
    expect(PREFILLED_PHRASES).toContain('hellocanigetmoreinfoonthis')
    expect(PREFILLED_PHRASES).toContain('hiiminterestedandidlikemoreinformation')
    expect(PREFILLED_PHRASES).toContain('helloiwouldlikemoreinformation')
    expect(PREFILLED_PHRASES).toContain('hicanigetmoreinfo')
    expect(PREFILLED_PHRASES).toContain('iminterestedinthis')
    expect(PREFILLED_PHRASES).toContain('canigetmoreinfoonthis')
  })
})

describe('isPrefilledOpener', () => {
  it('matches an exact opener', () => {
    expect(isPrefilledOpener('Hello! Can I get more info on this?')).toBe(true)
  })

  it('matches with different case and punctuation', () => {
    expect(isPrefilledOpener('hello can i get more info on this')).toBe(true)
  })

  it('matches with full-width characters', () => {
    expect(isPrefilledOpener('Ｈｅｌｌｏ！ Ｃａｎ Ｉ ｇｅｔ ｍｏｒｅ ｉｎｆｏ ｏｎ ｔｈｉｓ？')).toBe(true)
  })

  it('matches with zero-width characters inserted', () => {
    expect(isPrefilledOpener('Hello! Can I get more info on this?')).toBe(true)
  })

  it('does not match short greetings', () => {
    expect(isPrefilledOpener('Hi')).toBe(false)
    expect(isPrefilledOpener('ok')).toBe(false)
  })

  it('does not match arbitrary long text', () => {
    expect(
      isPrefilledOpener('I would like a private tour of Tibet for my family next year please'),
    ).toBe(false)
  })
})

describe('shouldSkipRepeatedMessage', () => {
  it('skips when the same prefilled opener was already answered', () => {
    expect(
      shouldSkipRepeatedMessage({
        current: 'Hello! Can I get more info on this?',
        repliedEarlierInbound: ['Hello! Can I get more info on this?'],
      }),
    ).toBe(true)
  })

  it('skips when the earlier opener differs only in case/punctuation', () => {
    expect(
      shouldSkipRepeatedMessage({
        current: 'hello can i get more info on this',
        repliedEarlierInbound: ['Hello! Can I get more info on this?'],
      }),
    ).toBe(true)
  })

  it('skips when the earlier opener has emoji decoration', () => {
    expect(
      shouldSkipRepeatedMessage({
        current: 'Hi, can I get more info',
        repliedEarlierInbound: ['Hi, can I get more info 👍'],
      }),
    ).toBe(true)
  })

  it('skips when the earlier opener is full-width', () => {
    expect(
      shouldSkipRepeatedMessage({
        current: 'Can I get more info on this',
        repliedEarlierInbound: ['Ｃａｎ Ｉ ｇｅｔ ｍｏｒｅ ｉｎｆｏ ｏｎ ｔｈｉｓ'],
      }),
    ).toBe(true)
  })

  it('does not skip "ok"', () => {
    expect(
      shouldSkipRepeatedMessage({ current: 'ok', repliedEarlierInbound: ['ok'] }),
    ).toBe(false)
  })

  it('does not skip "yes"', () => {
    expect(
      shouldSkipRepeatedMessage({ current: 'yes', repliedEarlierInbound: ['yes'] }),
    ).toBe(false)
  })

  it('does not skip "?"', () => {
    expect(
      shouldSkipRepeatedMessage({ current: '?', repliedEarlierInbound: ['?'] }),
    ).toBe(false)
  })

  it('does not skip "👍"', () => {
    expect(
      shouldSkipRepeatedMessage({ current: '👍', repliedEarlierInbound: ['👍'] }),
    ).toBe(false)
  })

  it('does not skip "Hi"', () => {
    expect(
      shouldSkipRepeatedMessage({ current: 'Hi', repliedEarlierInbound: ['Hi'] }),
    ).toBe(false)
  })

  it('does not skip when the earlier text is different', () => {
    expect(
      shouldSkipRepeatedMessage({
        current: 'Hello! Can I get more info on this?',
        repliedEarlierInbound: ['Hi, can I get more info'],
      }),
    ).toBe(false)
  })

  it('does not skip when repliedEarlierInbound is empty', () => {
    expect(
      shouldSkipRepeatedMessage({
        current: 'Hello! Can I get more info on this?',
        repliedEarlierInbound: [],
      }),
    ).toBe(false)
  })

  it('does not skip a non-opener long repeated message', () => {
    const text = 'I would like a private tour of Tibet for my family next year please'
    expect(
      shouldSkipRepeatedMessage({ current: text, repliedEarlierInbound: [text] }),
    ).toBe(false)
  })
})

describe('isSameAsLastOutbound', () => {
  it('returns true for case and punctuation differences', () => {
    expect(
      isSameAsLastOutbound('Hello, how can I help?', 'hello how can i help'),
    ).toBe(true)
  })

  it('returns false when lastOutbound is null', () => {
    expect(isSameAsLastOutbound('Hello', null)).toBe(false)
  })

  it('returns false when candidate squashes to empty', () => {
    expect(isSameAsLastOutbound('   ', 'Hello')).toBe(false)
    expect(isSameAsLastOutbound('!!!', 'Hello')).toBe(false)
  })

  it('returns false for different text', () => {
    expect(isSameAsLastOutbound('Hello there', 'Hello')).toBe(false)
  })
})
