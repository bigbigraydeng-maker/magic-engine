// 李白 · 文案逐句溯源单测。全程假 LLM（vi.fn），绝不碰真 API。
// 虚构品牌 'Kea Tours'，避免任何真实客户数据进测试。
import { describe, it, expect, vi } from 'vitest'
import { MODEL_HAIKU } from '@/lib/anthropic/client'
import {
  LIBAI_COPY_GENERATED_EVENT,
  LibaiCopyGeneratedSchema,
  MAX_SENTENCES,
  SNAPSHOT_KEY,
  PROVENANCE_LABEL_ZH,
  splitSentences,
  collectSentences,
  buildProvenancePrompt,
  parseProvenanceResponse,
  mergeProvenanceIntoSnapshot,
  readProvenanceFromSnapshot,
  labelProvenance,
  type CopyField,
  type ProvenanceLlm,
  type ProvenanceReport,
} from '../libai-provenance'

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'

/** 造一个假 LLM：返回给定 JSON 文本，其余字段固定。 */
function fakeLlm(payload: unknown) {
  return vi.fn(async () => ({
    text: JSON.stringify(payload),
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0.003,
    stop_reason: 'end_turn',
  })) as unknown as ProvenanceLlm & { mock: { calls: unknown[][] } }
}

/** 官网正文必须 ≥ 200 字才不抛错。 */
const LONG_WEBSITE = 'Kea Tours runs small-group birding trips across Aotearoa. '.repeat(6)

describe('splitSentences', () => {
  it('按 。！. 和换行断句，丢弃 1 字碎片，保留 【…】 占位符', () => {
    const text = '你好。好！Hello world. 再见\n【填真实数字】的价格是？'
    const out = splitSentences(text)
    expect(out).toContain('你好。')
    expect(out).toContain('好！')
    expect(out).toContain('Hello world.')
    expect(out).toContain('再见')
    // 1 字碎片被丢
    expect(out).not.toContain('好')
    // 占位符留在句内，不被切开
    expect(out.some((s) => s.includes('【填真实数字】'))).toBe(true)
  })
})

describe('collectSentences', () => {
  it('每字段 index 从 0 重开，总数封顶 MAX_SENTENCES', () => {
    const fields: CopyField[] = [
      { field: 'hook', text: 'A one. B two. C three.' },
      { field: 'cta', text: 'D four. E five.' },
    ]
    const out = collectSentences(fields)
    expect(out[0]).toMatchObject({ field: 'hook', index: 0 })
    expect(out[1]).toMatchObject({ field: 'hook', index: 1 })
    expect(out[3]).toMatchObject({ field: 'cta', index: 0 })
    expect(out[4]).toMatchObject({ field: 'cta', index: 1 })

    const many: CopyField[] = [
      { field: 'x', text: Array.from({ length: MAX_SENTENCES + 10 }, (_, i) => `S${i} ok.`).join(' ') },
    ]
    expect(collectSentences(many).length).toBe(MAX_SENTENCES)
  })
})

describe('buildProvenancePrompt', () => {
  it('system 提到四个标签与 never guess；user 含 [0] 与官网正文', () => {
    const { system, user } = buildProvenancePrompt({
      sentences: [{ field: 'hook', index: 0, text: 'Kea Tours is the best.' }],
      websiteText: 'Kea Tours official site content here.',
      briefText: null,
      brandName: 'Kea Tours',
    })
    for (const l of ['website', 'brief', 'no_claim', 'unverified']) {
      expect(system).toContain(l)
    }
    expect(system).toContain('never guess')
    expect(user).toContain('[0]')
    expect(user).toContain('Kea Tours official site content here.')
    expect(user).toContain('(none provided)')
  })
})

describe('parseProvenanceResponse', () => {
  it('接受带 ``` 围栏的 JSON', () => {
    const raw = '```json\n{"sentences":[{"i":0,"label":"website","note":"ok"}]}\n```'
    const out = parseProvenanceResponse(raw, 1)
    expect(out).toEqual([{ i: 0, label: 'website', note: 'ok' }])
  })

  it('条数不符 / 标签非法 / 非 JSON 一律抛错', () => {
    expect(() => parseProvenanceResponse('{"sentences":[]}', 1)).toThrow()
    expect(() =>
      parseProvenanceResponse('{"sentences":[{"i":0,"label":"maybe","note":""}]}', 1),
    ).toThrow()
    expect(() => parseProvenanceResponse('not json at all', 1)).toThrow()
  })
})

describe('mergeProvenanceIntoSnapshot', () => {
  it('保留已有 endcard 键，只写 libai_provenance；非对象 current 从 {} 起', () => {
    const snap: ProvenanceReport = {
      status: 'labelled',
      checked_at: '2026-09-24T00:00:00.000Z',
      website_url: 'https://keatours.example',
      brief_id: null,
      sentences: [],
      unverified_count: 0,
      cost_usd: 0,
    }
    const merged = mergeProvenanceIntoSnapshot({ endcard: { cta: 'Book' } }, snap)
    expect(merged.endcard).toEqual({ cta: 'Book' })
    expect(merged[SNAPSHOT_KEY]).toBe(snap)

    const fromJunk = mergeProvenanceIntoSnapshot('nope', snap)
    expect(fromJunk).toEqual({ [SNAPSHOT_KEY]: snap })
  })
})

describe('readProvenanceFromSnapshot', () => {
  it('垃圾返回 null；合法 labelled / unverifiable 原样返回', () => {
    expect(readProvenanceFromSnapshot(null)).toBeNull()
    expect(readProvenanceFromSnapshot({})).toBeNull()
    expect(readProvenanceFromSnapshot({ [SNAPSHOT_KEY]: { status: 'labelled' } })).toBeNull()

    const report = {
      status: 'labelled',
      checked_at: '2026-09-24T00:00:00.000Z',
      website_url: null,
      brief_id: null,
      sentences: [],
      unverified_count: 0,
      cost_usd: 0,
    }
    expect(readProvenanceFromSnapshot({ [SNAPSHOT_KEY]: report })).toEqual(report)

    const unver = { status: 'unverifiable', checked_at: '2026-09-24T00:00:00.000Z', reason: 'no site' }
    expect(readProvenanceFromSnapshot({ [SNAPSHOT_KEY]: unver })).toEqual(unver)
  })
})

describe('labelProvenance', () => {
  it('官网正文太短 → 抛错，且不调 LLM', async () => {
    const llm = fakeLlm({ sentences: [] })
    await expect(
      labelProvenance(
        {
          fields: [{ field: 'hook', text: 'Hello there.' }],
          websiteText: 'too short',
          websiteUrl: null,
          briefText: null,
          briefId: null,
          brandName: 'Kea Tours',
        },
        llm,
      ),
    ).rejects.toThrow('官网正文太短或为空，无法溯源')
    expect(llm).not.toHaveBeenCalled()
  })

  it('无句子 → 空报告，不调 LLM', async () => {
    const llm = fakeLlm({ sentences: [] })
    const report = await labelProvenance(
      {
        fields: [{ field: 'hook', text: '' }],
        websiteText: LONG_WEBSITE,
        websiteUrl: 'https://keatours.example',
        briefText: null,
        briefId: null,
        brandName: 'Kea Tours',
      },
      llm,
    )
    expect(report.sentences).toEqual([])
    expect(report.unverified_count).toBe(0)
    expect(report.cost_usd).toBe(0)
    expect(llm).not.toHaveBeenCalled()
  })

  it('happy path：3 句 → 标签 [website, no_claim, unverified]，unverified_count=1', async () => {
    const llm = fakeLlm({
      sentences: [
        { i: 0, label: 'website', note: 'on site' },
        { i: 1, label: 'no_claim', note: 'hook' },
        { i: 2, label: 'unverified', note: 'no source' },
      ],
    })
    const report = await labelProvenance(
      {
        fields: [{ field: 'hook', text: 'Kea Tours runs trips. Book now. We visit 12 islands.' }],
        websiteText: LONG_WEBSITE,
        websiteUrl: 'https://keatours.example',
        briefText: 'brief text',
        briefId: UUID_A,
        brandName: 'Kea Tours',
        now: new Date('2026-09-24T00:00:00.000Z'),
      },
      llm,
    )
    expect(report.sentences).toHaveLength(3)
    expect(report.sentences[2].label).toBe('unverified')
    expect(report.unverified_count).toBe(1)
    expect(report.cost_usd).toBe(0.003)
    expect(report.checked_at).toBe('2026-09-24T00:00:00.000Z')
    const call = llm.mock.calls[0][0] as { model?: string; singleAttempt?: boolean }
    // 模型 id 以 anthropic/client.ts 的 MODEL_HAIKU 为准，不手抄（带日期后缀会变）
    expect(call.model).toBe(MODEL_HAIKU)
    expect(call.singleAttempt).toBe(true)
  })

  it('LLM 抛错 → 原样上抛（由调用方记 unverifiable）', async () => {
    const llm = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as ProvenanceLlm
    await expect(
      labelProvenance(
        {
          fields: [{ field: 'hook', text: 'Kea Tours runs trips.' }],
          websiteText: LONG_WEBSITE,
          websiteUrl: null,
          briefText: null,
          briefId: null,
          brandName: 'Kea Tours',
        },
        llm,
      ),
    ).rejects.toThrow('boom')
  })
})

describe('event contract', () => {
  it('LibaiCopyGeneratedSchema 拒非 uuid，收合法 uuid', () => {
    expect(LIBAI_COPY_GENERATED_EVENT).toBe('me/libai.copy.generated')
    expect(LibaiCopyGeneratedSchema.safeParse({ client_id: 'nope', post_id: UUID_B }).success).toBe(false)
    expect(
      LibaiCopyGeneratedSchema.safeParse({ client_id: UUID_A, post_id: UUID_B }).success,
    ).toBe(true)
  })

  it('中文标签表齐全', () => {
    expect(PROVENANCE_LABEL_ZH.unverified).toBe('未证实')
  })
})
