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
  it('合法 ad_plays 原样保留', () => {
    const adPlays = [
      { step_key: 'phase1-lead', play: 'lead_form_harvest' },
      { step_key: 'phase1-pool', play: 'thruplay_pool_build' },
    ]
    const result = normalizePrescriptionContent(contentWithSeed(seedWith(adPlays)))
    expect(result.phases[0].initiative_seed?.ad_plays).toEqual(adPlays)
  })

  it('非法 play 名 → 丢弃 ad_plays 字段', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(seedWith([{ step_key: 'phase1-x', play: 'not_a_real_play' }])),
    )
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
  })

  it('重复 step_key → 丢弃 ad_plays 字段', () => {
    const result = normalizePrescriptionContent(
      contentWithSeed(
        seedWith([
          { step_key: 'phase1-lead', play: 'lead_form_harvest' },
          { step_key: 'phase1-lead', play: 'thruplay_pool_build' },
        ]),
      ),
    )
    const seed = result.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)
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
    expect(adPlays).toEqual([{ step_key: 'phase1-lead', play: 'lead_form_harvest' }])
    expect(adPlays?.[0]).not.toHaveProperty('budget')
  })

  it('其它 seed 字段保持不变', () => {
    const adPlays = [{ step_key: 'phase1-lead', play: 'lead_form_harvest' }]
    const result = normalizePrescriptionContent(contentWithSeed(seedWith(adPlays)))
    const seed = result.phases[0].initiative_seed
    expect(seed?.title).toBe('Brisbane 询盘获客')
    expect(seed?.budget_percent).toBe(60)
    expect(seed?.posture).toBe('offensive')
    expect(seed?.ad_plays).toEqual(adPlays)
  })
})
