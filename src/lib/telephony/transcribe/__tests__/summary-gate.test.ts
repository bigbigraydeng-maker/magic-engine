import { describe, expect, it } from 'vitest'

import {
  CHARACTERISATION_PATTERNS,
  MAX_SUMMARY_CHARS,
  digitRunsIn,
  fallbackSummaryFromFacts,
  namesInSummary,
  verifySummary,
} from '../summary-gate'

describe('namesInSummary', () => {
  const cases: ReadonlyArray<{ name: string; input: string; expected: string[] }> = [
    {
      name: 'finds a two-word person name inside Chinese prose',
      input: '旅行社回电客人Sergio Dyer，询问其中国旅行计划',
      expected: ['Sergio Dyer'],
    },
    {
      name: 'finds nothing for single capitalised place names',
      input: '客人想去Shanghai和Beijing',
      expected: [],
    },
    {
      name: 'finds nothing for all-caps tokens',
      input: 'CTS 回电客人',
      expected: [],
    },
    {
      name: 'finds a three-word person name',
      input: 'The agent spoke with Mary Jane Watson about the tour.',
      expected: ['Mary Jane Watson'],
    },
    {
      // 抽取是贪婪的：句首大写词会被一起吞进来（'Later Sergio Dyer'），
      // 因为它跟真实的三词人名（Mary Jane Watson）形状完全一样，分不开。
      // 这不影响判断——verifySummary 用「包含」比对，见下面那条用例。
      name: 'de-duplicates, and greedily includes a leading capitalised word',
      input: 'Sergio Dyer called. Later Sergio Dyer called again.',
      expected: ['Sergio Dyer', 'Later Sergio Dyer'],
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(namesInSummary(c.input)).toEqual(c.expected)
    })
  }
})

describe('digitRunsIn', () => {
  it('returns digit runs de-duplicated in order', () => {
    expect(digitRunsIn('14 days, budget 9999, again 14')).toEqual(['14', '9999'])
  })

  it('returns an empty array when there are no digits', () => {
    expect(digitRunsIn('no numbers here')).toEqual([])
  })
})

describe('CHARACTERISATION_PATTERNS', () => {
  it('matches the Chinese and English characterisation phrases', () => {
    const samples = [
      '客人首次去中国',
      '这是第一次',
      '初次到访',
      '从未去过',
      '从来没去过',
      '没去过中国',
      '没有去过中国',
      'first time to China',
      'first-time visitor',
      'never been to China',
      'first visit to China',
    ]
    for (const s of samples) {
      expect(CHARACTERISATION_PATTERNS.some((re) => re.test(s))).toBe(true)
    }
  })

  it('does not match neutral prose', () => {
    expect(CHARACTERISATION_PATTERNS.some((re) => re.test('客人想了解价格。'))).toBe(false)
  })
})

describe('verifySummary', () => {
  it('rejects person_name for the real case — a transcript-presence check would NOT have caught it', () => {
    // The agent mis-said the name, so "Sergio Dyer" IS in the transcript.
    // Only the known-names allowlist catches this.
    const transcript = 'Agent: Is this Sergio Dyer? Customer: Yes, speaking.'
    expect(transcript).toContain('Sergio Dyer')

    const verdict = verifySummary({
      summary: '旅行社回电客人Sergio Dyer，询问其中国旅行计划。',
      transcript,
      knownNames: ['Sarju Dayal'],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.rejected).toContain('person_name')
  })

  it('accepts the same summary when the name is in knownNames', () => {
    const verdict = verifySummary({
      summary: '旅行社回电客人Sergio Dyer，询问其中国旅行计划。',
      transcript: 'Agent: Is this Sergio Dyer? Customer: Yes, speaking.',
      knownNames: ['Sergio Dyer'],
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.rejected).toEqual([])
  })

  it('matches knownNames after normalisation (case and spacing)', () => {
    const verdict = verifySummary({
      summary: 'Called Sarju Dayal about the tour.',
      transcript: 'Agent: Is this Sarju Dayal?',
      knownNames: ['sarju  dayal'],
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects customer_characterisation even when the transcript contains "1st time"', () => {
    const transcript =
      "Customer: 1st time. Yeah. I've never been... I've been to South China, but not Central China."
    expect(transcript).toContain('1st time')

    const verdict = verifySummary({
      summary: '客人首次去中国，想了解价格。',
      transcript,
      knownNames: [],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.rejected).toContain('customer_characterisation')
  })

  it('rejects unsupported_number when a digit run is absent from the transcript', () => {
    const verdict = verifySummary({
      summary: '客人想要 14 天行程，预算 9999 纽币。',
      transcript: 'Customer: We want a 14 day trip.',
      knownNames: [],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.rejected).toContain('unsupported_number')
  })

  it('accepts when every digit run appears in the transcript', () => {
    const verdict = verifySummary({
      summary: '客人想要 14 天行程，预算 9999 纽币。',
      transcript: 'Customer: 14 days, budget 9999 NZD.',
      knownNames: [],
    })

    expect(verdict.ok).toBe(true)
    expect(verdict.rejected).toEqual([])
  })

  it('rejects too_long', () => {
    const verdict = verifySummary({
      summary: 'a'.repeat(MAX_SUMMARY_CHARS + 1),
      transcript: '',
      knownNames: [],
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.rejected).toContain('too_long')
  })

  it('rejects empty', () => {
    const verdict = verifySummary({ summary: '   ', transcript: '', knownNames: [] })
    expect(verdict.ok).toBe(false)
    expect(verdict.rejected).toContain('empty')
  })

  it('collects multiple rejections at once', () => {
    const verdict = verifySummary({
      summary: '客人Sergio Dyer首次去中国，预算 9999 纽币。',
      // 转写里没有「第一次」的说法，所以摘要里那句是编的 —— 连同写错的人名和
      // 凭空的预算数字，一次收集三条拒绝理由。
      transcript: 'Customer: Is this Sergio Dyer?',
      knownNames: ['Sarju Dayal'],
    })

    expect(verdict.ok).toBe(false)
    expect(verdict.rejected).toEqual(
      expect.arrayContaining([
        'person_name',
        'unsupported_number',
        'customer_characterisation',
      ]),
    )
  })

  it('accepts a clean summary with no names, digits, or characterisation', () => {
    const verdict = verifySummary({
      summary: '客人想了解价格和出发时间。',
      transcript: 'Customer: I want to know the price and departure time.',
      knownNames: [],
    })
    expect(verdict.ok).toBe(true)
    expect(verdict.rejected).toEqual([])
  })

  it('echoes back the trimmed summary', () => {
    const verdict = verifySummary({
      summary: '  客人想了解价格。  ',
      transcript: '',
      knownNames: [],
    })
    expect(verdict.summary).toBe('客人想了解价格。')
  })
})

describe('fallbackSummaryFromFacts', () => {
  it('returns the fixed sentence for an empty fact list', () => {
    expect(fallbackSummaryFromFacts([])).toBe('这通电话没有抽到可核实的信息。')
  })

  it('joins two fact values with the Chinese semicolon', () => {
    expect(
      fallbackSummaryFromFacts([
        { key: 'destination_or_tour', value: '中国中部团' },
        { key: 'party_size', value: '三个人' },
      ]),
    ).toBe('这通电话抽到的可核实信息：中国中部团；三个人。')
  })

  it('truncates a long list to exactly MAX_SUMMARY_CHARS', () => {
    const facts = Array.from({ length: 40 }, (_, i) => ({
      key: 'concern',
      value: `顾虑${i}`,
    }))
    const out = fallbackSummaryFromFacts(facts)
    expect(out.length).toBe(MAX_SUMMARY_CHARS)
  })
})

describe('verifySummary — 句首大写词被吞进来时不许误判', () => {
  it('「Called Sarju Dayal」里含客人真名，算对得上', () => {
    const v = verifySummary({
      summary: 'Called Sarju Dayal about the tour.',
      transcript: 'Agent: Is this Sarju Dayal?',
      knownNames: ['Sarju Dayal'],
    })
    expect(v.rejected).not.toContain('person_name')
  })

  it('但名字真的写错了还是要拦（真实事故：Sergio Dyer ≠ Sarju Dayal）', () => {
    const v = verifySummary({
      summary: 'Later Sergio Dyer asked about prices.',
      transcript: 'Agent: Is this Sergio Dyer?',
      knownNames: ['Sarju Dayal'],
    })
    expect(v.rejected).toContain('person_name')
  })
})

describe('数字依据：口语写法与书面写法不同，不能只跟转写比字面', () => {
  // 2026-10-25 真实误判：转写 "It's for March 20 27th"，摘要「2027年3月20日」，
  // 而这个日期本身是条带原话的已核实事实。
  const transcript = "声道2：It's for March 20 27th. 声道1：Okay."
  const summary = '客人计划2027年3月20日出行。'

  it('只跟转写比 → 误判成没依据', () => {
    const v = verifySummary({ summary, transcript, knownNames: [] })
    expect(v.rejected).toContain('unsupported_number')
  })

  it('把已核实事实也算进依据 → 放行', () => {
    const v = verifySummary({ summary, transcript, knownNames: [], supportingTexts: ['2027年3月20日', "It's for March 20 27th"] })
    expect(v.rejected).not.toContain('unsupported_number')
  })

  it('但真瞎编的数字照样拦（事实里也没有）', () => {
    const v = verifySummary({ summary: '预算 9999 纽币。', transcript, knownNames: [], supportingTexts: ['2027年3月20日'] })
    expect(v.rejected).toContain('unsupported_number')
  })
})

describe('判断性描述：对的要放行，被客人自己推翻的要拦（两通真实电话）', () => {
  it('10-12 真实通话：客人说 "It\'s 1st time for the family to go to China" → 摘要写「第一次去中国」是对的，放行', () => {
    const v = verifySummary({
      summary: '客人一家四口第一次去中国，想去北京、上海和西安。',
      transcript: "声道2：for a family of 4. We we... It's 1st time for the family to go to China,",
      knownNames: [],
      supportingTexts: ['一家四口'],
    })
    expect(v.rejected).not.toContain('customer_characterisation')
  })

  it('10-22 真实通话：客人说 1st time 但又说 "I\'ve been to South China" → 摘要写「首次去中国」要拦', () => {
    const v = verifySummary({
      summary: '客人首次去中国，询问行程价格。',
      transcript: "声道2：Yeah. 1st time. Yeah. I've never been... I've been to South China, but not Central China.",
      knownNames: [],
    })
    expect(v.rejected).toContain('customer_characterisation')
  })

  it('转写里压根没说过「第一次」→ 摘要自己编的，拦', () => {
    const v = verifySummary({ summary: '客人第一次去中国。', transcript: '声道2：I want to go to China.', knownNames: [] })
    expect(v.rejected).toContain('customer_characterisation')
  })
})
