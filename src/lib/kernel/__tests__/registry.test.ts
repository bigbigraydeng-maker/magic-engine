/**
 * 注册表与幂等键 —— 封闭词汇表 + 稳定身份。
 */

import { describe, it, expect } from 'vitest'
import { ACTION_REGISTRY, ACTION_KEYS, validateAgainstSchema } from '../registry'
import { computeIdempotencyKey, computeUnknownActionKey } from '../idempotency'
import { KernelError } from '../errors'
import { outwardBlockReason } from '../outward-authorization'
import type { ActionDefinition } from '../types'

const DEF = ACTION_REGISTRY.get('seo.build_publish_package') as ActionDefinition

describe('注册表是封闭的', () => {
  it('认得出自己注册过的动作', () => {
    expect(ACTION_REGISTRY.has('seo.build_publish_package')).toBe(true)
    expect(ACTION_REGISTRY.get('seo.build_publish_package')?.version).toBe(1)
  })

  it('🔴 认不出的一律返回 null，绝不返回「大概是这个」', () => {
    // 这几个都是库里真实出现过的自由文本动作类型
    for (const key of [
      'diversify_meta_ad_creatives',
      'diversify_meta_creatives',
      'seo.refresh_blog',
      'publish_geo_directive',
      '',
    ]) {
      expect(ACTION_REGISTRY.has(key)).toBe(false)
      expect(ACTION_REGISTRY.get(key)).toBeNull()
    }
  })

  it('原型链上的属性不算注册过的动作', () => {
    // `key in obj` 会把 toString / constructor 也算进来 —— 那是能被利用的
    expect(ACTION_REGISTRY.has('toString')).toBe(false)
    expect(ACTION_REGISTRY.has('constructor')).toBe(false)
    expect(ACTION_REGISTRY.get('__proto__')).toBeNull()
  })

  it('keys() 给得出完整清单（将来要反向注入 agent prompt 收口生成端）', () => {
    expect(ACTION_KEYS).toContain('seo.build_publish_package')
    expect(ACTION_KEYS).toContain('page.apply_optimization_request')
    // 唯一性 = 名字不重复；不硬编数字，防止每加一条动作都要改一次
    expect(new Set(ACTION_KEYS).size).toBe(ACTION_KEYS.length)
  })
})

describe('输入契约校验', () => {
  it('缺必填 → 说清缺哪个', () => {
    const r = validateAgainstSchema(DEF.inputSchema, { blog_post_id: 'x' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('content_hash')
  })

  it('类型不对 → 说清应该是什么', () => {
    const r = validateAgainstSchema(DEF.inputSchema, { blog_post_id: 1, content_hash: 'h' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('string')
  })

  it('多了没定义的字段 → 拒绝（防止悄悄夹带指令）', () => {
    const r = validateAgainstSchema(DEF.inputSchema, {
      blog_post_id: 'x',
      content_hash: 'h',
      publish: true,
    })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('publish')
  })

  it('不是对象 → 拒绝', () => {
    expect(validateAgainstSchema(DEF.inputSchema, 'not an object').ok).toBe(false)
    expect(validateAgainstSchema(DEF.inputSchema, ['a']).ok).toBe(false)
    expect(validateAgainstSchema(DEF.inputSchema, null).ok).toBe(false)
  })
})

describe('幂等键', () => {
  it('同样的输入永远算出同一把键（字段顺序不影响）', () => {
    const a = computeIdempotencyKey(DEF, 'client-1', { blog_post_id: 'p1', content_hash: 'h1' })
    const b = computeIdempotencyKey(DEF, 'client-1', { content_hash: 'h1', blog_post_id: 'p1' })
    expect(a).toBe(b)
  })

  it('客户不同 → 键不同（scope=client 的含义）', () => {
    const a = computeIdempotencyKey(DEF, 'client-1', { blog_post_id: 'p1', content_hash: 'h1' })
    const b = computeIdempotencyKey(DEF, 'client-2', { blog_post_id: 'p1', content_hash: 'h1' })
    expect(a).not.toBe(b)
  })

  it('任一键字段变了 → 键就变（那是另一件事，不是重复执行）', () => {
    const base = computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h1' })
    expect(computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p2', content_hash: 'h1' })).not.toBe(base)
    expect(computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h2' })).not.toBe(base)
  })

  it('同一确认操作重试仍复用原键，新操作获得新键', () => {
    const input = { blog_post_id: 'p1', content_hash: 'h1' }
    const first = computeIdempotencyKey(DEF, 'c', input, 'attempt-1')
    expect(computeIdempotencyKey(DEF, 'c', input, 'attempt-1')).toBe(first)
    expect(computeIdempotencyKey(DEF, 'c', input, 'attempt-2')).not.toBe(first)
    expect(computeIdempotencyKey(DEF, 'c', input)).not.toBe(first)
  })

  it('不参与键的字段变了 → 键不变', () => {
    const a = computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h1' })
    const b = computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: 'h1', note: '随手写的' })
    expect(a).toBe(b)
  })

  it('🔴 键字段是空的 → 抛错，不拿 undefined 参与计算', () => {
    // 悄悄用 undefined 算的话，两条其实不同的提交会算出同一把键，
    // 于是第二件事会被误判成「已经做过了」而永远不做。
    for (const bad of [undefined, null, '']) {
      expect(() =>
        computeIdempotencyKey(DEF, 'c', { blog_post_id: 'p1', content_hash: bad }),
      ).toThrow(KernelError)
    }
  })

  it('未知动作也有稳定身份（否则每天新增一条一样的拒绝记录）', () => {
    const a = computeUnknownActionKey('ads.whatever', 'c', { x: 1 })
    const b = computeUnknownActionKey('ads.whatever', 'c', { x: 1 })
    const c = computeUnknownActionKey('ads.whatever', 'c', { x: 2 })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('unknown:')).toBe(true)
  })
})

describe('契约自洽：会花钱的动作必须如实声明 provider 幂等能力', () => {
  it('🔴 声明 not_applicable 的动作，不许同时声明正的成本', async () => {
    const { ACTION_REGISTRY } = await import('../registry')
    const bad: string[] = []
    for (const key of ACTION_REGISTRY.keys()) {
      const d = ACTION_REGISTRY.get(key)!
      if (d.providerIdempotency !== 'not_applicable') continue
      const ceilings = Object.values(d.costModel.stepCeilingUsd ?? {}).map(Number)
      const positive = ceilings.some((v) => v > 0)
      if (positive) bad.push(`${key}：stepCeilingUsd 里有正数`)
    }
    expect(
      bad,
      'not_applicable 的意思是「根本不调外部 provider」。既然如此就不该有正的每步成本 —— ' +
        '这两件事同时声明是契约自相矛盾，运行时会按最保守的 unsupported 处置（见 gateway 的 paidStepWithoutIdempotency）。',
    ).toEqual([])
  })

  it('🔴 每个动作都必须显式声明 providerIdempotency（不许留空靠默认）', async () => {
    const { ACTION_REGISTRY } = await import('../registry')
    const allowed = ['not_applicable', 'supported', 'unsupported']
    const bad = ACTION_REGISTRY.keys().filter(
      (k) => !allowed.includes(ACTION_REGISTRY.get(k)!.providerIdempotency),
    )
    expect(
      bad,
      '填错的代价是客户被重复扣款 —— 所以这一项必须是有意识填的，不能靠默认值。',
    ).toEqual([])
  })
})

describe('ads.activate_paused_draft —— 开启暂停广告的动作定义', () => {
  const KEY = 'ads.activate_paused_draft'
  const def = ACTION_REGISTRY.get(KEY) as ActionDefinition
  const VALID_INPUT = {
    draft_action_id: 'draft-1',
    draft_hash: 'hash-1',
    ad_account_id: '123',
    campaign_id: 'c1',
    ad_set_id: 's1',
    ad_ids: ['a1', 'a2'],
    daily_budget_cents: 500,
    currency: 'NZD',
    cap_cents_snapshot: 15000,
    meta_fingerprint: { campaign: 'x', ad_set: 'y' },
  }

  it('已注册：注册表认得出它，清单里也有它', () => {
    expect(ACTION_REGISTRY.has(KEY)).toBe(true)
    expect(ACTION_KEYS).toContain(KEY)
  })

  it('必须人批：开启会真花钱，所以是 human_only 且 sideEffect 是 outward', () => {
    expect(def.outwardAuthorization?.approval.mode).toBe('human_only')
    expect(def.sideEffect).toBe('outward')
  })

  it('授权层级是 admin、目的是 maintenance', () => {
    expect(def.requiredCapabilityTier).toBe('admin')
    expect(def.allowedPurposes).toEqual(['maintenance'])
  })

  it('撤回必须是 provider_native，且声明可逆', () => {
    expect(def.outwardAuthorization?.rollback).toBe('provider_native')
    expect(def.reversible).toBe(true)
  })

  it('结构闸放行：声明完整，outwardBlockReason 返回 null', () => {
    expect(outwardBlockReason(def)).toBeNull()
  })

  it('风险等级是 high', () => {
    expect(def.risk).toBe('high')
  })

  it('合法输入通过校验', () => {
    expect(validateAgainstSchema(def.inputSchema, VALID_INPUT).ok).toBe(true)
  })

  it('缺任何一个必填字段都被拒，并说清缺哪个', () => {
    for (const field of def.inputSchema.required ?? []) {
      const input: Record<string, unknown> = { ...VALID_INPUT }
      delete input[field]
      const r = validateAgainstSchema(def.inputSchema, input)
      expect(r.ok, `缺 ${field} 时应当被拒`).toBe(false)
      expect(r.ok === false && r.reason).toContain(field)
    }
  })

  it('多夹带字段被拒', () => {
    const r = validateAgainstSchema(def.inputSchema, { ...VALID_INPUT, publish: true })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('publish')
  })

  it('类型不对被拒', () => {
    expect(validateAgainstSchema(def.inputSchema, { ...VALID_INPUT, ad_ids: 'a1' }).ok).toBe(false)
    expect(
      validateAgainstSchema(def.inputSchema, { ...VALID_INPUT, daily_budget_cents: '500' }).ok,
    ).toBe(false)
    expect(
      validateAgainstSchema(def.inputSchema, { ...VALID_INPUT, meta_fingerprint: 'x' }).ok,
    ).toBe(false)
  })

  it('幂等键：同一草案同一版本算出同一把键', () => {
    const a = computeIdempotencyKey(def, 'client-1', VALID_INPUT)
    const b = computeIdempotencyKey(def, 'client-1', VALID_INPUT)
    expect(a).toBe(b)
  })

  it('幂等键：草案内容 hash 变了就是另一件事', () => {
    const base = computeIdempotencyKey(def, 'client-1', VALID_INPUT)
    const changed = computeIdempotencyKey(def, 'client-1', { ...VALID_INPUT, draft_hash: 'hash-2' })
    expect(changed).not.toBe(base)
  })

  it('幂等键：换一个 nonce 就是新一次尝试', () => {
    const noNonce = computeIdempotencyKey(def, 'client-1', VALID_INPUT)
    const first = computeIdempotencyKey(def, 'client-1', VALID_INPUT, '1')
    const second = computeIdempotencyKey(def, 'client-1', VALID_INPUT, '2')
    expect(first).not.toBe(second)
    expect(first).not.toBe(noNonce)
    expect(second).not.toBe(noNonce)
  })

  it('幂等键字段是空的 → 抛 KernelError', () => {
    expect(() =>
      computeIdempotencyKey(def, 'client-1', { ...VALID_INPUT, draft_action_id: '' }),
    ).toThrow(KernelError)
    expect(() =>
      computeIdempotencyKey(def, 'client-1', { ...VALID_INPUT, draft_hash: '' }),
    ).toThrow(KernelError)
  })

  it('每个执行步骤的成本上界都是有限的 0', () => {
    for (const step of def.steps) {
      const ceiling = def.costModel.stepCeilingUsd?.[step]
      expect(Number.isFinite(ceiling), `步骤 ${step} 缺少有限成本上界`).toBe(true)
      expect(ceiling).toBe(0)
    }
  })

  it('步骤固定为 snapshot_pre → apply → readback', () => {
    expect(def.steps).toEqual(['snapshot_pre', 'apply', 'readback'])
  })
})
