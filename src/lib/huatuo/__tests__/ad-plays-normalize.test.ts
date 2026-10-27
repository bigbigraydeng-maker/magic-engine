/**
 * DAPE — huatuo ad_plays: prompt 注入 + normalizePrescriptionContent 清洗测试
 *
 * 覆盖:
 *  - system prompt 完整包含 adPlaysPromptSection / adPlaysSchemaExample / 所有 PLAY_CATALOG key
 *  - normalizePrescriptionContent 对 initiative_seed.ad_plays 的清洗:
 *    合法保留、非法 play 丢弃、重复 step_key 丢弃、非数组/空数组丢弃、
 *    多余字段剥离、其它 seed 字段不受影响
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'm',
  parseJsonResponse: JSON.parse,
  getAnthropicClient: () => ({}),
}))

import { normalizePrescriptionContent } from '../agent'
import { HUATUO_GENERATION_SYSTEM_PROMPT } from '../prompts'
import {
  adPlaysPromptSection,
  adPlaysSchemaExample,
} from '@/lib/ads-strategy/plan-seed/ad-plays-prompt'
import { PLAY_CATALOG } from '@/lib/ads-strategy/play-vocabulary'
import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { wasAdPlaysDropped } from '@/lib/ads-strategy/plan-seed/ad-plays'
import type { PrescriptionContent } from '@/types/diagnostic'

const BASE_SEED: Record<string, unknown> = {
  initiative_type: 'demand_generation',
  title: 'Brisbane 询盘获客',
  posture: 'offensive',
  budget_percent: 60,
  hypothesis: 'h',
}

function contentWithSeed(seed: Record<string, unknown>): Partial<PrescriptionContent> {
  return JSON.parse(JSON.stringify({
    summary: 's',
    phases: [
      {
        phase_number: 1,
        name: 'n',
        duration_weeks: 4,
        actions: [],
        initiative_seed: seed,
      },
    ],
    kpi_targets: [],
    budget_allocation: [],
  })) as Partial<PrescriptionContent>
}

function seedWith(adPlays: unknown): Record<string, unknown> {
  return { ...BASE_SEED, ad_plays: adPlays }
}

function contentWithPhases(
  seeds: Array<{ phase_number: number; seed: Record<string, unknown> }>,
): Partial<PrescriptionContent> {
  return JSON.parse(JSON.stringify({
    summary: 's',
    phases: seeds.map(({ phase_number, seed }) => ({
      phase_number,
      name: 'n',
      duration_weeks: 4,
      actions: [],
      initiative_seed: seed,
    })),
    kpi_targets: [],
    budget_allocation: [],
  })) as Partial<PrescriptionContent>
}

describe('HUATUO_GENERATION_SYSTEM_PROMPT ad_plays', () => {
  it('完整包含 adPlaysPromptSection()', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(adPlaysPromptSection())
  })

  it('包含 adPlaysSchemaExample()', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(adPlaysSchemaExample())
  })

  it('包含 PLAY_CATALOG 的每一个 key', () => {
    for (const key of Object.keys(PLAY_CATALOG)) {
      expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(key)
    }
  })

  it('包含「不要写账户、预算、人数、花费」约束', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain('不要写账户、预算、人数、花费')
  })
})

describe('normalizePrescriptionContent ad_plays', () => {
  it('合法 ad_plays：play 保留，step_key 由系统生成', () => {
    const adPlays = [
      { step_key: 'phase1-lead', play: 'lead_form_harvest' },
      { step_key: 'phase1-pool', play: 'thruplay_pool_build' },
    ]
    const result = normalizePrescriptionContent(contentWithSeed(seedWith(adPlays)))
    expect(result.phases[0].initiative_seed?.ad_plays).toEqual([
      { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
      { step_key: 'p1-2-thruplay_pool_build', play: 'thruplay_pool_build' },
    ])
  })

  it('非法 play 名 → 丢弃 ad_plays 字段', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(seedWith([{ step_key: 'phase1-x', play: 'not_a_real_play' }])),
    )
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
  })

  it('重复 step_key 被忽略，照样生成', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(
        seedWith([
          { step_key: 'phase1-lead', play: 'lead_form_harvest' },
          { step_key: 'phase1-lead', play: 'thruplay_pool_build' },
        ]),
      ),
    )
    expect(result.phases[0].initiative_seed?.ad_plays).toEqual([
      { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
      { step_key: 'p1-2-thruplay_pool_build', play: 'thruplay_pool_build' },
    ])
  })

  it('ad_plays 是字符串 → 丢弃', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(seedWith('lead_form_harvest')),
    )
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
  })

  it('ad_plays 是 null → 丢弃', () => {
    const result = normalizePrescriptionContent(contentWithSeed(seedWith(null)))
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
  })

  it('ad_plays 是空数组 → 丢弃', () => {
    const result = normalizePrescriptionContent(contentWithSeed(seedWith([])))
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
  })

  it('没有 ad_plays 字段 → 不出现', () => {
    const result = normalizePrescriptionContent(contentWithSeed({ ...BASE_SEED }))
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
  })

  it('多余数字字段被剥离', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(
        seedWith([
          { step_key: 'phase1-lead', play: 'lead_form_harvest', budget: 500, spend: 12 },
        ]),
      ),
    )
    const adPlays = result.phases[0].initiative_seed?.ad_plays
    expect(adPlays).toEqual([{ step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' }])
    expect(adPlays?.[0]).not.toHaveProperty('budget')
    expect(adPlays?.[0]).not.toHaveProperty('spend')
  })

  it('其它 seed 字段保持不变', () => {
    const adPlays = [{ step_key: 'phase1-lead', play: 'lead_form_harvest' }]
    const result = normalizePrescriptionContent(contentWithSeed(seedWith(adPlays)))
    const seed = result.phases[0].initiative_seed
    expect(seed?.title).toBe('Brisbane 询盘获客')
    expect(seed?.budget_percent).toBe(60)
    expect(seed?.posture).toBe('offensive')
    expect(seed?.ad_plays).toEqual([
      { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])
  })
})

describe('normalizePrescriptionContent ad_plays 系统生成 step_key + 留痕', () => {
  it('LLM 给的 step_key 全部被忽略', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(
        seedWith([
          { step_key: 'Phase1-Lead', play: 'lead_form_harvest' },
          { step_key: 'phase1-lead-form-harvest-first-home-buyers-q1', play: 'thruplay_pool_build' },
          { step_key: 'act-1234567890-50aud-day', play: 'reach_awareness' },
        ]),
      ),
    )
    const adPlays = result.phases[0].initiative_seed?.ad_plays ?? []
    expect(adPlays).toHaveLength(3)
    for (const p of adPlays) {
      expect(p.step_key).toMatch(/^p\d+-\d+-[a-z_]+$/)
    }
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('1234567890')
    expect(serialized).not.toContain('Phase1-Lead')
  })

  it('不同阶段写同一个 play 互不影响', () => {
    const result = normalizePrescriptionContent(
      contentWithPhases([
        { phase_number: 1, seed: seedWith([{ play: 'lead_form_harvest' }]) },
        { phase_number: 2, seed: seedWith([{ play: 'lead_form_harvest' }]) },
      ]),
    )
    expect(result.phases[0].initiative_seed?.ad_plays).toEqual([
      { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])
    expect(result.phases[1].initiative_seed?.ad_plays).toEqual([
      { step_key: 'p2-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])
    expect(collectAdPlays(result)).toHaveLength(2)
  })

  it('某阶段非法 play → 该阶段丢弃并 warn，其它阶段不受影响', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = normalizePrescriptionContent(
        contentWithPhases([
          { phase_number: 1, seed: seedWith([{ play: 'lead_form_harvest' }]) },
          { phase_number: 2, seed: seedWith([{ play: 'retargeting' }]) },
        ]),
      )
      const phase2Seed = result.phases[1].initiative_seed
      expect(phase2Seed).toBeDefined()
      expect(phase2Seed && 'ad_plays' in phase2Seed).toBe(false)
      expect(result.phases[0].initiative_seed?.ad_plays).toEqual([
        { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
      ])
      const messages = warnSpy.mock.calls.map((call) => String(call[0]))
      expect(messages.some((m) => m.includes('phase=2') && m.includes('不在允许范围内'))).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('warn 文本有界且不泄露原文', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      normalizePrescriptionContent(contentWithSeed(seedWith('x'.repeat(500))))
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const message = String(warnSpy.mock.calls[0][0])
      expect(message).toContain('phase=1')
      expect(message).toContain('广告打法必须是一个列表')
      expect(message.length).toBeLessThan(80)
      expect(message).not.toContain('xxxx')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('null / [] / 缺失 → 不 warn 且不打丢弃标记；非法 → 打标记', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const nullResult = normalizePrescriptionContent(contentWithSeed(seedWith(null)))
      const emptyResult = normalizePrescriptionContent(contentWithSeed(seedWith([])))
      const absentResult = normalizePrescriptionContent(contentWithSeed({ ...BASE_SEED }))
      for (const result of [nullResult, emptyResult, absentResult]) {
        const seed = result.phases[0].initiative_seed
        expect(seed).toBeDefined()
        expect(seed && 'ad_plays' in seed).toBe(false)
        expect(wasAdPlaysDropped(seed!)).toBe(false)
      }
      const messages = warnSpy.mock.calls.map((call) => String(call[0]))
      expect(messages.some((m) => m.includes('ad_plays dropped'))).toBe(false)

      const invalidResult = normalizePrescriptionContent(
        contentWithSeed(seedWith([{ play: 'retargeting' }])),
      )
      expect(wasAdPlaysDropped(invalidResult.phases[0].initiative_seed!)).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('超过 8 条 → 丢弃并 warn 最多 8 条', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const nine = Array.from({ length: 9 }, () => ({ play: 'lead_form_harvest' }))
      const result = normalizePrescriptionContent(contentWithSeed(seedWith(nine)))
      const seed = result.phases[0].initiative_seed
      expect(seed).toBeDefined()
      expect(seed && 'ad_plays' in seed).toBe(false)
      const messages = warnSpy.mock.calls.map((call) => String(call[0]))
      expect(messages.some((m) => m.includes('最多 8 条'))).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
