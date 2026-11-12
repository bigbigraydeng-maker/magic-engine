import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import { contentFingerprint } from '@/lib/confirmation-card/facts'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'

import { decideWeekPlanApproval, openWeekPlanApproval, planCardFacts } from './approval'
import { assembleInput } from './assemble'
import { buildWeeklySocialPlan } from './build'
import { mergeApproval, slotDigest } from './digest'
import { emptyGoalInput } from './read'
import type { WeeklySocialPlan } from './types'

const CLIENT = '11111111-1111-4111-8111-111111111111'

function readyPlan(): WeeklySocialPlan {
  return buildWeeklySocialPlan({
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    industryKey: 'travel',
    clientConfig: null,
    weeklyQuota: { storyPerWeek: 2, postPerWeek: 1, reelPerWeek: 1 },
    pillarNames: {},
    lockMix: false,
    stage: {
      auth: { state: 'ok', value: true },
      authLost: { state: 'ok', value: false },
      facts: { state: 'ok', value: 20 },
      assets: { state: 'ok', value: 15 },
      onTimeWeeks: { state: 'unreadable', value: 0 },
      receipts: { state: 'unreadable', value: 0 },
      periods: { state: 'unreadable', value: 0 },
      circuitBreaker: { state: 'unreadable', value: false },
      complaintSpike: { state: 'unreadable', value: false },
    },
    goal: emptyGoalInput(),
    themes: { read: 'none', items: [] },
  })
}

function fingerprintOf(plan: WeeklySocialPlan, digest: string): string {
  return contentFingerprint(planCardFacts(plan, CLIENT, digest))
}

describe('week plan approval', () => {
  it('asks for one approval and says this card does not publish', () => {
    const plan = readyPlan()
    const facts = planCardFacts(plan, CLIENT, slotDigest(plan))
    expect(facts.what).toContain('一起批')
    expect(facts.what).toContain('不发布')
    expect(facts.amount).toBe('不涉及广告花费')
    expect(facts.scope.length).toBeLessThanOrEqual(180)
    expect(facts.hardChecks.map((check) => check.label)).toEqual(['方案', '目标卡', '广告主题', '发布'])
    expect(facts.hardChecks.every((check) => check.state === 'green')).toBe(true)
    expect(facts.hardChecks.some((check) => check.label.includes('阶段'))).toBe(false)
  })

  it('blocks confirm when the goal card could not be read, and does not stamp', async () => {
    const plan = { ...readyPlan(), goal: emptyGoalInput('unreadable') }
    const digest = slotDigest(plan)
    let stamped = false
    const decide = async () => 'card'
    const stamp = async () => { stamped = true; return true }
    await expect(decideWeekPlanApproval(
      { decide, stamp },
      { plan, clientId: CLIENT, digest, resolution: 'confirm', runId: CLIENT, expectedDecisionId: CLIENT, fingerprint: fingerprintOf(plan, digest), now: new Date('2026-11-10T00:00:00Z') },
    )).rejects.toBeInstanceOf(ConfirmationCardError)
    expect(stamped).toBe(false)
  })

  it('stamps a decline even when the plan is held', async () => {
    const plan = { ...readyPlan(), status: 'held' as const, items: [] }
    const digest = slotDigest(plan)
    const calls: string[] = []
    await decideWeekPlanApproval({
      decide: async () => { calls.push('decide'); return 'card' },
      stamp: async (approval) => { calls.push(approval.status); return true },
    }, {
      plan, clientId: CLIENT, digest, resolution: 'decline', runId: CLIENT, expectedDecisionId: CLIENT,
      fingerprint: fingerprintOf(plan, digest), now: new Date('2026-11-10T00:00:00Z'),
    })
    expect(calls).toEqual(['decide', 'declined'])
  })

  it('stamps agree and does not need a publish port', async () => {
    const plan = readyPlan()
    const digest = slotDigest(plan)
    const calls: string[] = []
    const result = await decideWeekPlanApproval({
      decide: async () => { calls.push('decide'); return { id: 'card' } },
      stamp: async (approval) => { calls.push(approval.status); return true },
    }, {
      plan, clientId: CLIENT, digest, resolution: 'confirm', runId: CLIENT, expectedDecisionId: CLIENT,
      fingerprint: fingerprintOf(plan, digest), now: new Date('2026-11-10T00:00:00Z'),
    })
    expect(calls).toEqual(['decide', 'confirmed'])
    expect(result.stamped).toBe(true)
    expect(mergeApproval({ slotDigest: digest, planKind: 'weekly_slot_plan_v1' }, result.approval).slotDigest).toBe(digest)
  })

  it('does not decide when the plan changed', async () => {
    const plan = readyPlan()
    let decided = false
    await expect(decideWeekPlanApproval({
      decide: async () => { decided = true; return 'card' },
      stamp: async () => true,
    }, {
      plan, clientId: CLIENT, digest: slotDigest(plan), resolution: 'confirm', runId: CLIENT, expectedDecisionId: CLIENT,
      fingerprint: 'ab'.repeat(32), now: new Date('2026-11-10T00:00:00Z'),
    })).rejects.toMatchObject({ code: 'stale' })
    expect(decided).toBe(false)
  })

  it('issues a card that lasts until the end of the New Zealand day', async () => {
    const plan = readyPlan()
    let lifetime = ''
    await openWeekPlanApproval({
      issue: async (_facts, given) => { lifetime = given; return 'card' },
    }, plan, CLIENT, slotDigest(plan))
    expect(lifetime).toBe('nz_day')
  })
})

describe('assembleInput', () => {
  it('keeps a client weekly count when stage counts were not read', () => {
    const loaded = assembleInput({
      weekStart: '2026-11-16', weekEnd: '2026-11-22', clientError: false, industry: 'travel',
      config: { social_week: { story_per_week: 18, post_per_week: 4, reel_per_week: 3 } },
      pillarsError: false,
      pillarsRaw: [{ id: 'travel_mood', name: '旅行氛围', post_ratio: 1 }],
      goalError: false, goalRow: null, themeError: false, themeRows: [],
      factError: false, factCount: 20, assetError: false, assetCount: 15, authStatuses: ['active'],
    })
    const plan = buildWeeklySocialPlan(loaded.input)
    expect(plan.stage).toBeNull()
    expect(plan.counts).toEqual({ story: 18, post: 4, reel: 3 })
    expect(loaded.input.stage.onTimeWeeks.state).toBe('unreadable')
  })

  it('does not fill the industry mix when the client mix could not be read', () => {
    const loaded = assembleInput({
      weekStart: '2026-11-16', weekEnd: '2026-11-22', clientError: false, industry: 'travel',
      config: { social_week: { story_per_week: 1, post_per_week: 1, reel_per_week: 0 } },
      pillarsError: true, pillarsRaw: null, goalError: true, goalRow: null, themeError: true, themeRows: null,
      factError: true, factCount: null, assetError: false, assetCount: 0, authStatuses: 'unreadable',
    })
    expect(loaded.input.lockMix).toBe(true)
    expect(loaded.input.goal.read).toBe('unreadable')
    expect(loaded.input.themes.read).toBe('unreadable')
    expect(loaded.gaps.some((gap) => gap.includes('内容比例读不到'))).toBe(true)
  })
})

describe('weekly plan boundaries', () => {
  it('does not read money, tokens, or publish code', () => {
    const root = process.cwd()
    const db = readFileSync(join(root, 'src/lib/social/weekly-plan/db.ts'), 'utf8')
    expect(db).toContain(".select('title, fde_reasoning, intent, sub_type, awareness_subtype')")
    expect(db).toContain(".select('id, title, campaign_angle')")
    expect(db).toContain(".select('status')")
    expect(db).not.toMatch(/access_token|target_value|budget|offer/)
    const files = [
      'src/lib/social/weekly-plan/approval.ts',
      'src/lib/social/weekly-plan/db.ts',
      'src/lib/social/weekly-plan/run.ts',
      'src/app/api/clients/[id]/social-week-plan/route.ts',
      'src/app/api/clients/[id]/social-week-plan/approval/route.ts',
    ]
    const banned = /week-pack\/flow|promoteReel|authorizeStory|story-lite|factory\/publish|inngest|weekly-loop/
    for (const file of files) {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(banned)
    }
  })
})
