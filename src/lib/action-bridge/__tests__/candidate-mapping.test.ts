/**
 * ActionCandidate → ActionKey 映射。
 *
 * 这一层要证明的三件事：
 *   ① 映射不上一律**结构化拒绝**，而且分得清三种不同的原因；
 *   ② 任何输入都不会把它打崩（入参是 `unknown`，不能靠调用方守规矩）；
 *   ③ 拼字符串会有的那种误映射，这里造不出来。
 */

import { describe, it, expect } from 'vitest'
import {
  createCandidateMapper,
  mapCandidateIdentity,
  listGovernedActionVocabulary,
  GovernedVocabularyConfigurationError,
  MAPPING_TABLE,
  type CandidateMappingEntry,
} from '../index'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import type { ActionDefinition, ActionKey } from '@/lib/kernel/types'
import type { ActionRegistry } from '@/lib/kernel/registry'

const REAL_KEY = 'seo.build_publish_package' as const

/** 一个只认得 REAL_KEY 的注册表；用来跟「配对指向的动作不存在」区分开。 */
function registryWith(keys: readonly ActionKey[], version = 7): ActionRegistry {
  const has = (k: string): k is ActionKey => (keys as readonly string[]).includes(k)
  return {
    has,
    get: (k: string): ActionDefinition | null =>
      has(k) ? ({ actionKey: k, version, title: `title:${k}`, sideEffect: 'internal_write' } as unknown as ActionDefinition) : null,
    keys: () => keys,
  }
}

const table = (entries: CandidateMappingEntry[]): readonly CandidateMappingEntry[] => entries

describe('映射：形状不成立的输入一律安全拒绝', () => {
  const mapper = createCandidateMapper({ registry: registryWith([REAL_KEY]), table: table([]) })

  it('🔴 null / undefined / 数组 / 原始值 都不许把它打崩', () => {
    for (const bad of [null, undefined, [], ['geo'], 'geo', 42, true, Symbol('x')]) {
      const result = mapper.map(bad)
      expect(result.outcome, `${String(bad)} 应该被拒绝`).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })

  it('缺字段 / 字段不是字符串 → malformed_identity', () => {
    for (const bad of [
      {},
      { domain: 'geo' },
      { intent: 'optimize' },
      { domain: 'geo', intent: 1 },
      { domain: null, intent: 'optimize' },
      { domain: ['geo'], intent: 'optimize' },
    ]) {
      const result = mapper.map(bad)
      expect(result.outcome).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })

  it('🔴 纯空白不算有内容（否则 " " 会被当成一个合法的域）', () => {
    for (const bad of [
      { domain: '', intent: 'optimize' },
      { domain: '   ', intent: 'optimize' },
      { domain: 'geo', intent: '' },
      { domain: 'geo', intent: '\t\n ' },
    ]) {
      const result = mapper.map(bad)
      expect(result.outcome).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })
})

describe('映射：三种拒绝原因分得开', () => {
  it('身份是好的但没人认领 → unmapped_identity（不是 malformed）', () => {
    const mapper = createCandidateMapper({ registry: registryWith([REAL_KEY]), table: table([]) })
    const result = mapper.map({ domain: 'geo', intent: 'optimize_page_answerability' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'unmapped_identity' })
    if (result.outcome === 'rejected') {
      expect(result.reason).toContain('geo')
      expect(result.reason).toContain('optimize_page_answerability')
    }
  })

  it('🔴 配对指向的动作注册表里没有 → registry_drift（是配置问题，不是调用方的错）', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([]), // 注册表空了
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'registry_drift' })
  })

  it('配对得上 → mapped，且版本号从注册表读（不从配对表读）', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([REAL_KEY], 9),
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result).toEqual({ outcome: 'mapped', actionKey: REAL_KEY, actionVersion: 9 })
  })
})

describe('映射：判别联合是诚实的', () => {
  const mapper = createCandidateMapper({
    registry: registryWith([REAL_KEY]),
    table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
  })

  it('🔴 rejected 分支运行时不许混进 actionKey / actionVersion', () => {
    const result = mapper.map({ domain: 'geo', intent: 'nope' })
    expect(result.outcome).toBe('rejected')
    expect(Object.keys(result).sort()).toEqual(['code', 'outcome', 'reason'])
    expect('actionKey' in result).toBe(false)
    expect('actionVersion' in result).toBe(false)
  })

  it('🔴 mapped 分支运行时不许混进 code / reason，且两个成功字段都必须在', () => {
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result.outcome).toBe('mapped')
    expect(Object.keys(result).sort()).toEqual(['actionKey', 'actionVersion', 'outcome'])
    expect('code' in result).toBe(false)
    expect('reason' in result).toBe(false)
  })
})

describe('映射：不拼字符串，所以造不出分隔符碰撞', () => {
  /**
   * 🔴 早先设计用 `${domain}:${intent}` 当键。那样下面这两个不同的候选
   *    会算出同一个键 `geo:x:y`，于是其中一个会被误映射到另一个的动作上。
   */
  const mapper = createCandidateMapper({
    registry: registryWith([REAL_KEY]),
    table: table([{ domain: 'geo', intent: 'x:y', actionKey: REAL_KEY }]),
  })

  it('🔴 `{domain:"geo:x", intent:"y"}` 不许命中 `{domain:"geo", intent:"x:y"}` 的配对', () => {
    const collided = mapper.map({ domain: 'geo:x', intent: 'y' })
    expect(collided.outcome).toBe('rejected')
    expect(collided).toMatchObject({ code: 'unmapped_identity' })
  })

  it('真正配得上的那一个照常命中', () => {
    const exact = mapper.map({ domain: 'geo', intent: 'x:y' })
    expect(exact).toMatchObject({ outcome: 'mapped', actionKey: REAL_KEY })
  })

  it('大小写 / 首尾空白都不做规范化 —— 不模糊匹配', () => {
    for (const near of [
      { domain: 'GEO', intent: 'x:y' },
      { domain: ' geo', intent: 'x:y' },
      { domain: 'geo', intent: 'X:Y' },
    ]) {
      expect(mapper.map(near).outcome, JSON.stringify(near)).toBe('rejected')
    }
  })
})

describe('🔴 输入只认自有的数据属性', () => {
  const mapper = createCandidateMapper({
    registry: registryWith([REAL_KEY]),
    table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
  })

  it('🔴 getter 一次都不许被执行（恶意 getter 能把拒绝变成抛异常）', () => {
    let getterRan = false
    const hostile = {}
    Object.defineProperty(hostile, 'domain', {
      enumerable: true,
      get() {
        getterRan = true
        throw new Error('这个 getter 不该被执行')
      },
    })
    Object.defineProperty(hostile, 'intent', { enumerable: true, value: 'optimize' })

    // 不抛，返回结构化拒绝
    const result = mapper.map(hostile)
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'malformed_identity' })
    expect(getterRan, 'getter 被执行了 —— 说明读的是属性值而不是描述符').toBe(false)
  })

  it('🔴 原型链上继承来的 domain / intent 不算数', () => {
    const proto = { domain: 'geo', intent: 'optimize' }
    const inherited = Object.create(proto) as object
    // 自证：普通读法确实读得到，所以这条测的是「我们没用普通读法」
    expect((inherited as { domain: string }).domain).toBe('geo')

    const result = mapper.map(inherited)
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'malformed_identity' })
  })

  it('只有一半是继承来的也不行', () => {
    const halfInherited = Object.create({ domain: 'geo' }) as object
    Object.defineProperty(halfInherited, 'intent', { enumerable: true, value: 'optimize' })
    expect(mapper.map(halfInherited).outcome).toBe('rejected')
  })

  it('访问器属性（getter 返回合法值）也不接受 —— 判据是数据属性，不是取到的值', () => {
    const accessor = {}
    Object.defineProperty(accessor, 'domain', { enumerable: true, get: () => 'geo' })
    Object.defineProperty(accessor, 'intent', { enumerable: true, value: 'optimize' })
    expect(mapper.map(accessor)).toMatchObject({ code: 'malformed_identity' })
  })

  it('不可枚举的自有属性不接受', () => {
    const hidden = {}
    Object.defineProperty(hidden, 'domain', { enumerable: false, value: 'geo' })
    Object.defineProperty(hidden, 'intent', { enumerable: true, value: 'optimize' })
    expect(mapper.map(hidden)).toMatchObject({ code: 'malformed_identity' })
  })

  it('symbol 键不参与匹配（只认字符串键 domain / intent）', () => {
    const sym = Symbol('domain')
    const weird = { [sym]: 'geo', intent: 'optimize' }
    expect(mapper.map(weird)).toMatchObject({ code: 'malformed_identity' })
  })

  /**
   * 🔴 多带字段一律拒绝，**不是「只取我要的两个、其余忽略」**。
   *    忽略等于默许调用方往身份对象里夹带东西 —— 那些字段今天不生效，
   *    明天被谁顺手读一下就生效了。身份对象必须恰好是 domain + intent。
   */
  it('🔴 多带一个字符串字段 → 拒绝（哪怕内容看着无害）', () => {
    for (const extra of [
      { domain: 'geo', intent: 'optimize', note: 'just a note' },
      { domain: 'geo', intent: 'optimize', authorised: true },
      { domain: 'geo', intent: 'optimize', sideEffect: 'outward' },
    ]) {
      const result = mapper.map(extra)
      expect(result.outcome, JSON.stringify(extra)).toBe('rejected')
      expect(result).toMatchObject({ code: 'malformed_identity' })
    }
  })

  it('🔴 多带一个 symbol 键 → 拒绝（Object.keys 看不见它，Reflect.ownKeys 看得见）', () => {
    const withSymbol = { domain: 'geo', intent: 'optimize', [Symbol('extra')]: 'x' }
    // 自证：普通的 Object.keys 只看得到两个键，所以这条测的是「我们没用 Object.keys」
    expect(Object.keys(withSymbol)).toEqual(['domain', 'intent'])
    expect(mapper.map(withSymbol)).toMatchObject({ code: 'malformed_identity' })
  })

  it('🔴 多带一个不可枚举的自有键 → 拒绝', () => {
    const hidden = { domain: 'geo', intent: 'optimize' }
    Object.defineProperty(hidden, 'smuggled', { enumerable: false, value: 'x' })
    expect(mapper.map(hidden)).toMatchObject({ code: 'malformed_identity' })
  })

  it('恰好 domain + intent 两个键 → 正常映射（严格化没有误伤正常输入）', () => {
    expect(mapper.map({ domain: 'geo', intent: 'optimize' })).toEqual({
      outcome: 'mapped',
      actionKey: REAL_KEY,
      actionVersion: 7,
    })
  })
})

describe('🔴 配对表自身坏了就 fail closed', () => {
  const dupTable = table([
    { domain: 'geo', intent: 'optimize', actionKey: REAL_KEY },
    { domain: 'geo', intent: 'optimize', actionKey: REAL_KEY },
  ])

  it('🔴 重复配对 → registry_drift，即使两条指向同一个 ActionKey', () => {
    const mapper = createCandidateMapper({ registry: registryWith([REAL_KEY]), table: dupTable })
    const result = mapper.map({ domain: 'geo', intent: 'optimize' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'registry_drift' })
    if (result.outcome === 'rejected') expect(result.reason).toContain('不止一次')
  })

  it('🔴 重复配对 → 词汇表当场抛，不产出一份靠数组顺序的清单', () => {
    const mapper = createCandidateMapper({ registry: registryWith([REAL_KEY]), table: dupTable })
    expect(() => mapper.listVocabulary()).toThrow(GovernedVocabularyConfigurationError)
    expect(() => mapper.listVocabulary()).toThrow(/不止一次/)
  })

  it('畸形表项（空 domain / 缺 actionKey）两个 API 都拒', () => {
    for (const bad of [
      [{ domain: '', intent: 'optimize', actionKey: REAL_KEY }],
      [{ domain: 'geo', intent: '   ', actionKey: REAL_KEY }],
      [{ domain: 'geo', intent: 'optimize', actionKey: '' as unknown as ActionKey }],
    ]) {
      const mapper = createCandidateMapper({
        registry: registryWith([REAL_KEY]),
        table: table(bad as CandidateMappingEntry[]),
      })
      expect(mapper.map({ domain: 'geo', intent: 'optimize' })).toMatchObject({
        code: 'registry_drift',
      })
      expect(() => mapper.listVocabulary()).toThrow(GovernedVocabularyConfigurationError)
    }
  })

  it('非法 submissionBoundary 两个 API 都拒', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([REAL_KEY]),
      table: table([{
        domain: 'geo',
        intent: 'optimize',
        actionKey: REAL_KEY,
        submissionBoundary: 'untrusted_boundary',
      } as unknown as CandidateMappingEntry]),
    })
    expect(mapper.map({ domain: 'geo', intent: 'optimize' })).toMatchObject({
      code: 'registry_drift',
    })
    expect(() => mapper.listVocabulary()).toThrow(GovernedVocabularyConfigurationError)
  })

  it('两条不同的配对不算重复', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([REAL_KEY]),
      table: table([
        { domain: 'geo', intent: 'a', actionKey: REAL_KEY },
        { domain: 'geo', intent: 'b', actionKey: REAL_KEY },
      ]),
    })
    expect(mapper.map({ domain: 'geo', intent: 'b' })).toMatchObject({ outcome: 'mapped' })
    expect(mapper.listVocabulary()).toHaveLength(2)
  })
})

describe('受治理的词汇表', () => {
  it('由配对表 ⋈ 注册表派生 —— 不维护第二份清单', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([REAL_KEY], 3),
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    expect(mapper.listVocabulary()).toEqual([
      {
        domain: 'geo',
        intent: 'optimize',
        actionKey: REAL_KEY,
        title: `title:${REAL_KEY}`,
        sideEffect: 'internal_write',
      },
    ])
  })

  it('🔴 注册表漂移必须当场炸，不许静默跳过返回一份残缺清单', () => {
    const mapper = createCandidateMapper({
      registry: registryWith([]),
      table: table([{ domain: 'geo', intent: 'optimize', actionKey: REAL_KEY }]),
    })
    expect(() => mapper.listVocabulary()).toThrow(GovernedVocabularyConfigurationError)
    expect(() => mapper.listVocabulary()).toThrow(/注册表里没有这个动作/)
  })
})

describe('生产实例：当前状态', () => {
  it('生产配对表只放有受治理调用边界的动作', () => {
    // 每条 mapping 都指向注册表里真实存在的 ActionKey（防"半成品映射"）。
    expect(MAPPING_TABLE.length).toBeGreaterThan(0)
    for (const entry of MAPPING_TABLE) {
      expect(ACTION_REGISTRY.get(entry.actionKey)?.actionKey).toBe(entry.actionKey)
    }
  })

  it('生产词汇表反映当前 MAPPING_TABLE，且不抛异常', () => {
    const vocab = listGovernedActionVocabulary()
    expect(vocab.length).toBe(MAPPING_TABLE.length)
  })

  it('GEO candidate 命中已治理映射', () => {
    const result = mapCandidateIdentity({ domain: 'geo', intent: 'optimize_page_answerability' })
    expect(result.outcome).toBe('mapped')
  })

  it('WordPress 页面元数据 candidate 命中独立 WordPress 动作，不冒充 GEO', () => {
    expect(mapCandidateIdentity({
      domain: 'seo',
      intent: 'apply_wordpress_page_metadata',
    })).toEqual({
      outcome: 'mapped',
      actionKey: 'page.apply_wordpress_optimization_request',
      actionVersion: 1,
      submissionBoundary: 'wordpress_reference_loop',
    })
  })

  it('CTS 页面查询归属 identity 命中独立 CTS GitHub metadata action', () => {
    expect(mapCandidateIdentity({
      domain: 'seo',
      intent: 'clarify_page_query_url_ownership',
    })).toEqual({
      outcome: 'mapped',
      actionKey: 'page.apply_cts_github_metadata_request',
      actionVersion: 2,
      submissionBoundary: 'cts_github_reference_loop',
    })
  })

  it('陌生 candidate 仍返回 unmapped_identity', () => {
    const result = mapCandidateIdentity({ domain: 'geo', intent: 'noop_never_registered' })
    expect(result.outcome).toBe('rejected')
    expect(result).toMatchObject({ code: 'unmapped_identity' })
  })

  it('真注册表确实认得内部动作 seo.build_publish_package', () => {
    expect(ACTION_REGISTRY.get(REAL_KEY)?.actionKey).toBe(REAL_KEY)
  })
})
