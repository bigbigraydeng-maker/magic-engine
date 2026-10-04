import { describe, it, expect, vi } from 'vitest'
import { runPreflight, MIN_REMAINING_MS } from '../preflight'
import type { ActivateDeps, ActivateInput, LiveDraftState } from '../deps'
import { computeMetaFingerprint } from '@/lib/ads-strategy/meta-fingerprint'
import type { MetaFingerprintRaw } from '@/lib/ads-strategy/meta-fingerprint'
import type { KillBlockCode, KillState } from '@/lib/ads-strategy/activation-kill'

const T0 = Date.parse('2026-10-05T00:00:00Z')

/** 把 unknown 收窄成普通对象（非 null、非数组），否则返回空对象。 */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

/** 现场原始数据：全绿路径的基准。 */
function liveRaw(): MetaFingerprintRaw {
  return {
    campaign: {
      id: 'c1',
      objective: 'OUTCOME_ENGAGEMENT',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    },
    adSet: {
      id: 's1',
      daily_budget: '500',
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'CONVERSATIONS',
      destination_type: 'MESSENGER',
      start_time: '2026-10-06T00:00:00+0000',
      end_time: '2026-10-12T00:00:00+0000',
      promoted_object: { page_id: 'p1' },
      targeting: {
        geo_locations: { countries: ['NZ'] },
        age_min: 25,
        age_max: 65,
        targeting_automation: { advantage_audience: 0 },
      },
    },
    ads: [
      {
        id: '111',
        creative: {
          object_story_spec: {
            page_id: 'p1',
            video_data: {
              video_id: 'v1',
              message: 'Join our tour',
              title: 'Message us',
              image_hash: 'h1',
              call_to_action: {
                type: 'MESSAGE_PAGE',
                value: { app_destination: 'MESSENGER' },
              },
            },
          },
        },
      },
    ],
  }
}

/** 输入：与现场一致的指纹。 */
function makeInput(): ActivateInput {
  return {
    draftActionId: 'draft-1',
    draftHash: 'hash-1',
    adAccountId: '111',
    campaignId: 'c1',
    adSetId: 's1',
    adIds: ['111'],
    dailyBudgetCents: 500,
    currency: 'NZD',
    capCentsSnapshot: 15000,
    metaFingerprint: computeMetaFingerprint(liveRaw()),
  }
}

/** 现场状态：全绿基准。 */
function makeLive(): LiveDraftState {
  return {
    campaign: { id: 'c1', accountId: 'act_111', status: 'PAUSED' },
    adSet: {
      id: 's1',
      accountId: 'act_111',
      status: 'PAUSED',
      endTimeMs: T0 + 3 * 24 * 3600 * 1000,
      dailyBudgetCents: 500,
    },
    ads: [{ id: '111', accountId: 'act_111', status: 'PAUSED' }],
    siblingAdSetIds: ['s1'],
    siblingAdIds: ['111'],
    fingerprintRaw: liveRaw(),
    adSetReadback: {
      id: 's1',
      name: 'DM set',
      optimization_goal: 'CONVERSATIONS',
      destination_type: 'MESSENGER',
      targeting: { geo_locations: { countries: ['NZ'] } },
    },
    adsReadback: [{ adId: '111', adName: 'ad1', texts: ['Join our tour', 'Message us'] }],
  }
}

/** 依赖：默认全绿，over 覆盖。 */
function makeDeps(over: Partial<ActivateDeps> = {}): ActivateDeps {
  const base: ActivateDeps = {
    now: vi.fn(() => T0),
    readKillState: vi.fn(async (): Promise<KillState> => ({ engaged: false, accounts: ['act_111'] })),
    readDecisionApprover: vi.fn(async () => ({ ok: true as const, value: { email: 'ray@x.com' } })),
    isApprover: vi.fn((e: string | null | undefined) => e === 'ray@x.com'),
    listRegisteredAccounts: vi.fn(async () => ({ ids: ['act_111'] })),
    readDraftStatus: vi.fn(async () => ({ ok: true as const, value: { status: 'activating' } })),
    readLiveState: vi.fn(async () => ({ ok: true as const, value: makeLive() })),
    loadRedlines: vi.fn(async () => [] as string[]),
    loadBudgetFacts: vi.fn(async () => ({
      ok: true as const,
      value: {
        clientCapCents: 15000,
        accounts: [
          {
            accountId: '111',
            currency: 'NZD',
            complete: true,
            capCents: null,
            campaigns: [
              {
                id: 'c0',
                accountId: '111',
                status: 'ACTIVE',
                dailyBudgetCents: null,
                lifetimeBudgetCents: null,
              },
            ],
            adSets: [
              {
                id: 's0',
                accountId: '111',
                campaignId: 'c0',
                status: 'ACTIVE',
                dailyBudgetCents: 10000,
                lifetimeBudgetCents: null,
              },
            ],
          },
        ],
      },
    })),
  }
  return { ...base, ...over }
}

/** 调用入口。 */
function run(deps: ActivateDeps) {
  return runPreflight({ clientId: 'client-1', decisionId: 'dec-1', input: makeInput() }, deps)
}

/** 两条广告的场景：多语言混放必须发生在两条广告之间。 */
function twoAdScenario(): { input: ActivateInput; live: LiveDraftState } {
  const raw2: MetaFingerprintRaw = {
    ...liveRaw(),
    ads: [
      ...liveRaw().ads,
      {
        id: '222',
        creative: {
          object_story_spec: {
            page_id: 'p1',
            video_data: {
              video_id: 'v2',
              message: 'Another tour',
              title: 'Message us',
              image_hash: 'h2',
              call_to_action: {
                type: 'MESSAGE_PAGE',
                value: { app_destination: 'MESSENGER' },
              },
            },
          },
        },
      },
    ],
  }

  const input: ActivateInput = {
    ...makeInput(),
    adIds: ['111', '222'],
    metaFingerprint: computeMetaFingerprint(raw2),
  }

  const live = structuredClone(makeLive())
  live.ads.push({ id: '222', accountId: 'act_111', status: 'PAUSED' })
  live.siblingAdIds = ['111', '222']
  live.fingerprintRaw = raw2
  live.adsReadback = [
    { adId: '111', adName: 'ad1', texts: ['Join our tour'] },
    { adId: '222', adName: 'ad2', texts: ['圣诞节新西兰双岛游，现在私信我们'] },
  ]

  return { input, live }
}

describe('runPreflight', () => {
  it('全绿：通过并返回预算合计与上限', async () => {
    const res = await run(makeDeps())
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.budget.totalCents).toBe(10000)
      expect(res.budget.capCents).toBe(15000)
    }
  })

  describe('1 签批人', () => {
    it('读不到签批人 → approver_mismatch', async () => {
      const deps = makeDeps({
        readDecisionApprover: vi.fn(async () => ({ ok: false as const, error: 'x' })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('approver_mismatch')
      expect(deps.readKillState).not.toHaveBeenCalled()
      expect(deps.listRegisteredAccounts).not.toHaveBeenCalled()
      expect(deps.readLiveState).not.toHaveBeenCalled()
      expect(deps.loadBudgetFacts).not.toHaveBeenCalled()
    })

    it('签批人邮箱为 null → approver_mismatch', async () => {
      const deps = makeDeps({
        readDecisionApprover: vi.fn(async () => ({ ok: true as const, value: { email: null } })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('approver_mismatch')
      expect(deps.readKillState).not.toHaveBeenCalled()
      expect(deps.listRegisteredAccounts).not.toHaveBeenCalled()
      expect(deps.readLiveState).not.toHaveBeenCalled()
      expect(deps.loadBudgetFacts).not.toHaveBeenCalled()
    })

    it('签批人邮箱为空白 → approver_mismatch', async () => {
      const deps = makeDeps({
        readDecisionApprover: vi.fn(async () => ({ ok: true as const, value: { email: '  ' } })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('approver_mismatch')
      expect(deps.readKillState).not.toHaveBeenCalled()
      expect(deps.listRegisteredAccounts).not.toHaveBeenCalled()
      expect(deps.readLiveState).not.toHaveBeenCalled()
      expect(deps.loadBudgetFacts).not.toHaveBeenCalled()
    })

    it('签批人不是授权人 → approver_mismatch', async () => {
      const deps = makeDeps({ isApprover: vi.fn(() => false) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('approver_mismatch')
      expect(deps.readKillState).not.toHaveBeenCalled()
      expect(deps.listRegisteredAccounts).not.toHaveBeenCalled()
      expect(deps.readLiveState).not.toHaveBeenCalled()
      expect(deps.loadBudgetFacts).not.toHaveBeenCalled()
    })
  })

  describe('2 开关', () => {
    it('紧急开关开启 → kill_switch_engaged', async () => {
      const deps = makeDeps({
        readKillState: vi.fn(async (): Promise<KillState> => ({
          engaged: true,
          code: 'kill_switch_engaged',
          message: 'x',
          accounts: [],
        })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('kill_switch_engaged')
      expect(deps.readLiveState).not.toHaveBeenCalled()
      expect(deps.loadBudgetFacts).not.toHaveBeenCalled()
    })

    it.each<KillBlockCode>(['circuit_tripped', 'circuit_unreadable', 'registry_unreadable', 'no_accounts'])(
      '熔断 code=%s → circuit_tripped',
      async (code) => {
        const deps = makeDeps({
          readKillState: vi.fn(async (): Promise<KillState> => ({
            engaged: true,
            code,
            message: 'x',
            accounts: [],
          })),
        })
        const res = await run(deps)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.code).toBe('circuit_tripped')
        expect(deps.readLiveState).not.toHaveBeenCalled()
        expect(deps.loadBudgetFacts).not.toHaveBeenCalled()
      },
    )
  })

  describe('3 归属', () => {
    it('读不到登记账户 → ownership_mismatch', async () => {
      const deps = makeDeps({
        listRegisteredAccounts: vi.fn(async () => ({ ids: [], error: 'x' })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('登记账户为空 → ownership_mismatch', async () => {
      const deps = makeDeps({ listRegisteredAccounts: vi.fn(async () => ({ ids: [] })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('输入账户不在登记里 → ownership_mismatch', async () => {
      const deps = makeDeps({ listRegisteredAccounts: vi.fn(async () => ({ ids: ['act_999'] })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('登记无前缀、现场带 act_ 前缀 → 归一化后通过', async () => {
      const deps = makeDeps({ listRegisteredAccounts: vi.fn(async () => ({ ids: ['111'] })) })
      const res = await run(deps)
      expect(res.ok).toBe(true)
    })

    it('读不到现场状态 → meta_unreadable', async () => {
      const deps = makeDeps({
        readLiveState: vi.fn(async () => ({ ok: false as const, error: 'x' })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('meta_unreadable')
    })

    it('现场系列 id 不对 → ownership_mismatch', async () => {
      const live = structuredClone(makeLive())
      live.campaign.id = 'cX'
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('现场广告组 id 不对 → ownership_mismatch', async () => {
      const live = structuredClone(makeLive())
      live.adSet.id = 'sX'
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('现场少读一条广告 → ownership_mismatch', async () => {
      const live = structuredClone(makeLive())
      live.ads = []
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('现场多读一条广告 → ownership_mismatch', async () => {
      const live = structuredClone(makeLive())
      live.ads.push({ id: '999', accountId: 'act_111', status: 'PAUSED' })
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it('文案回读少了一条广告 → ownership_mismatch，message 含「文案」', async () => {
      const live = structuredClone(makeLive())
      live.adsReadback = []
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('ownership_mismatch')
        expect(res.message).toContain('文案')
      }
    })

    it('文案回读多了一条不属于本草案的广告 → ownership_mismatch', async () => {
      const live = structuredClone(makeLive())
      live.adsReadback = [
        { adId: '111', adName: 'ad1', texts: ['Join our tour'] },
        { adId: '999', adName: 'ad9', texts: ['Other'] },
      ]
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })

    it.each([
      ['campaign', null],
      ['campaign', 'act_999'],
      ['adSet', null],
      ['adSet', 'act_999'],
      ['ad', null],
      ['ad', 'act_999'],
    ] as const)('现场 %s 的 accountId=%s → ownership_mismatch', async (layer, accountId) => {
      const live = structuredClone(makeLive())
      if (layer === 'campaign') live.campaign.accountId = accountId
      else if (layer === 'adSet') live.adSet.accountId = accountId
      else live.ads[0].accountId = accountId
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ownership_mismatch')
    })
  })

  describe('4 状态', () => {
    it('读不到草案状态 → draft_not_activating', async () => {
      const deps = makeDeps({
        readDraftStatus: vi.fn(async () => ({ ok: false as const, error: 'x' })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('draft_not_activating')
    })

    it.each(['awaiting_approval', null])('草案状态 %s → draft_not_activating', async (status) => {
      const deps = makeDeps({
        readDraftStatus: vi.fn(async () => ({ ok: true as const, value: { status } })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('draft_not_activating')
    })

    it.each([
      ['campaign', 'ACTIVE'],
      ['campaign', 'DELETED'],
      ['campaign', null],
      ['adSet', 'ACTIVE'],
      ['adSet', 'DELETED'],
      ['adSet', null],
      ['ad', 'ACTIVE'],
      ['ad', 'DELETED'],
      ['ad', null],
    ] as const)('现场 %s 状态 %s → not_in_paused_state', async (layer, status) => {
      const live = structuredClone(makeLive())
      if (layer === 'campaign') live.campaign.status = status
      else if (layer === 'adSet') live.adSet.status = status
      else live.ads[0].status = status
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('not_in_paused_state')
    })

    it('状态小写 paused 仍通过', async () => {
      const live = structuredClone(makeLive())
      live.campaign.status = 'paused'
      live.adSet.status = 'paused'
      live.ads[0].status = 'paused'
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(true)
    })
  })

  describe('5 兄弟', () => {
    it('系列下多出广告组 → unexpected_siblings', async () => {
      const live = structuredClone(makeLive())
      live.siblingAdSetIds = ['s1', 's2']
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('unexpected_siblings')
    })

    it('广告组下多出广告 → unexpected_siblings', async () => {
      const live = structuredClone(makeLive())
      live.siblingAdIds = ['111', '999']
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('unexpected_siblings')
    })

    it('系列下找不到广告组 → unexpected_siblings', async () => {
      const live = structuredClone(makeLive())
      live.siblingAdSetIds = []
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('unexpected_siblings')
    })
  })

  describe('6 指纹与闸门', () => {
    it('现场预算被改 → meta_side_changed，message 含 adSet', async () => {
      const live = structuredClone(makeLive())
      live.fingerprintRaw.adSet.daily_budget = '50000'
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('meta_side_changed')
        expect(res.message).toContain('adSet')
      }
    })

    it('现场广告文案被改 → meta_side_changed，message 含 ad:111', async () => {
      const live = structuredClone(makeLive())
      const creative = asRecord(live.fingerprintRaw.ads[0].creative)
      const storySpec = asRecord(creative.object_story_spec)
      const videoData = asRecord(storySpec.video_data)
      videoData.message = 'Changed message'
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('meta_side_changed')
        expect(res.message).toContain('ad:111')
      }
    })

    it('现场每日预算与输入不等 → meta_side_changed', async () => {
      const live = structuredClone(makeLive())
      live.adSet.dailyBudgetCents = 9999
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('meta_side_changed')
    })

    it('现场指纹算不出来 → meta_side_changed，不外抛', async () => {
      const live = structuredClone(makeLive())
      live.fingerprintRaw.ads = [
        {
          creative: {
            object_story_spec: {
              page_id: 'p1',
              video_data: {
                video_id: 'v1',
                message: 'Join our tour',
                title: 'Message us',
                image_hash: 'h1',
                call_to_action: {
                  type: 'MESSAGE_PAGE',
                  value: { app_destination: 'MESSENGER' },
                },
              },
            },
          },
        },
      ]
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('meta_side_changed')
    })

    it('回读发现多语言混放 blocker → readback_blocked', async () => {
      const { input, live } = twoAdScenario()
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await runPreflight({ clientId: 'client-1', decisionId: 'dec-1', input }, deps)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('readback_blocked')
        expect(res.message).toContain('语言')
      }
    })
  })

  describe('7 时间', () => {
    it('结束时间为 null → schedule_expired', async () => {
      const live = structuredClone(makeLive())
      live.adSet.endTimeMs = null
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('schedule_expired')
    })

    it('结束时间不足 24 小时 → schedule_expired', async () => {
      const live = structuredClone(makeLive())
      live.adSet.endTimeMs = T0 + MIN_REMAINING_MS - 1
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('schedule_expired')
    })

    it('结束时间恰好 24 小时 → 通过', async () => {
      const live = structuredClone(makeLive())
      live.adSet.endTimeMs = T0 + MIN_REMAINING_MS
      const deps = makeDeps({ readLiveState: vi.fn(async () => ({ ok: true as const, value: live })) })
      const res = await run(deps)
      expect(res.ok).toBe(true)
    })
  })

  describe('8 红线', () => {
    it('读不到红线词表 → redlines_unavailable', async () => {
      const deps = makeDeps({ loadRedlines: vi.fn(async () => null) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('redlines_unavailable')
    })

    it('文案命中红线 → brand_redline_hit，message 含该词', async () => {
      const deps = makeDeps({ loadRedlines: vi.fn(async () => ['join our tour']) })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('brand_redline_hit')
        expect(res.message).toContain('join our tour')
      }
    })

    it('文案未命中红线 → 通过', async () => {
      const deps = makeDeps({ loadRedlines: vi.fn(async () => ['no such phrase']) })
      const res = await run(deps)
      expect(res.ok).toBe(true)
    })
  })

  describe('9 预算', () => {
    it('读不到预算数据 → budget_unavailable', async () => {
      const deps = makeDeps({
        loadBudgetFacts: vi.fn(async () => ({ ok: false as const, error: 'x' })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('budget_unavailable')
    })

    it('超出每日总上限 → budget_cap_exceeded', async () => {
      const deps = makeDeps({
        loadBudgetFacts: vi.fn(async () => ({
          ok: true as const,
          value: {
            clientCapCents: 10400,
            accounts: [
              {
                accountId: '111',
                currency: 'NZD',
                complete: true,
                capCents: null,
                campaigns: [
                  {
                    id: 'c0',
                    accountId: '111',
                    status: 'ACTIVE',
                    dailyBudgetCents: null,
                    lifetimeBudgetCents: null,
                  },
                ],
                adSets: [
                  {
                    id: 's0',
                    accountId: '111',
                    campaignId: 'c0',
                    status: 'ACTIVE',
                    dailyBudgetCents: 10000,
                    lifetimeBudgetCents: null,
                  },
                ],
              },
            ],
          },
        })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe('budget_cap_exceeded')
        expect(res.message).toMatch(/NZD 10[45]\.00/)
      }
    })

    it('上限刚好等于合计 → 通过', async () => {
      const deps = makeDeps({
        loadBudgetFacts: vi.fn(async () => ({
          ok: true as const,
          value: {
            clientCapCents: 10500,
            accounts: [
              {
                accountId: '111',
                currency: 'NZD',
                complete: true,
                capCents: null,
                campaigns: [
                  {
                    id: 'c0',
                    accountId: '111',
                    status: 'ACTIVE',
                    dailyBudgetCents: null,
                    lifetimeBudgetCents: null,
                  },
                ],
                adSets: [
                  {
                    id: 's0',
                    accountId: '111',
                    campaignId: 'c0',
                    status: 'ACTIVE',
                    dailyBudgetCents: 10000,
                    lifetimeBudgetCents: null,
                  },
                ],
              },
            ],
          },
        })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(true)
    })

    it('客户上限读不到 → budget_unavailable', async () => {
      const deps = makeDeps({
        loadBudgetFacts: vi.fn(async () => ({
          ok: true as const,
          value: {
            clientCapCents: null,
            accounts: [
              {
                accountId: '111',
                currency: 'NZD',
                complete: true,
                capCents: null,
                campaigns: [
                  {
                    id: 'c0',
                    accountId: '111',
                    status: 'ACTIVE',
                    dailyBudgetCents: null,
                    lifetimeBudgetCents: null,
                  },
                ],
                adSets: [
                  {
                    id: 's0',
                    accountId: '111',
                    campaignId: 'c0',
                    status: 'ACTIVE',
                    dailyBudgetCents: 10000,
                    lifetimeBudgetCents: null,
                  },
                ],
              },
            ],
          },
        })),
      })
      const res = await run(deps)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('budget_unavailable')
    })
  })

  describe('短路顺序', () => {
    it('全绿路径的调用顺序固定', async () => {
      const order: string[] = []
      const deps = makeDeps({
        readDecisionApprover: vi.fn(async () => {
          order.push('readDecisionApprover')
          return { ok: true as const, value: { email: 'ray@x.com' } }
        }),
        readKillState: vi.fn(async (): Promise<KillState> => {
          order.push('readKillState')
          return { engaged: false, accounts: ['act_111'] }
        }),
        listRegisteredAccounts: vi.fn(async () => {
          order.push('listRegisteredAccounts')
          return { ids: ['act_111'] }
        }),
        readLiveState: vi.fn(async () => {
          order.push('readLiveState')
          return { ok: true as const, value: makeLive() }
        }),
        readDraftStatus: vi.fn(async () => {
          order.push('readDraftStatus')
          return { ok: true as const, value: { status: 'activating' } }
        }),
        loadRedlines: vi.fn(async () => {
          order.push('loadRedlines')
          return [] as string[]
        }),
        loadBudgetFacts: vi.fn(async () => {
          order.push('loadBudgetFacts')
          return {
            ok: true as const,
            value: {
              clientCapCents: 15000,
              accounts: [
                {
                  accountId: '111',
                  currency: 'NZD',
                  complete: true,
                  capCents: null,
                  campaigns: [
                    {
                      id: 'c0',
                      accountId: '111',
                      status: 'ACTIVE',
                      dailyBudgetCents: null,
                      lifetimeBudgetCents: null,
                    },
                  ],
                  adSets: [
                    {
                      id: 's0',
                      accountId: '111',
                      campaignId: 'c0',
                      status: 'ACTIVE',
                      dailyBudgetCents: 10000,
                      lifetimeBudgetCents: null,
                    },
                  ],
                },
              ],
            },
          }
        }),
      })
      const res = await run(deps)
      expect(res.ok).toBe(true)
      expect(order).toEqual([
        'readDecisionApprover',
        'readKillState',
        'listRegisteredAccounts',
        'readLiveState',
        'readDraftStatus',
        'loadRedlines',
        'loadBudgetFacts',
      ])
    })
  })
})
