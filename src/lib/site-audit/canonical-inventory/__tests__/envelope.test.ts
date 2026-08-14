/**
 * L1 生成信封与签名原语（Issue #960）。
 *
 * 🔴 这一组的核心判据只有一句：**不持 `K_gen` 的人改了任何一个被签字段，都验不回去。**
 *    所以每一条篡改都测**两种**手法 ——
 *      (a) 只改字段、留着原 digest 与签名  → 必须 `digest_mismatch`；
 *      (b) 改字段**并用公开函数重算 digest**、留着原签名 → 必须 `signature_invalid`。
 *    只测 (a) 是自欺：真实的编辑者当然会把 digest 一起重算，那正是 #930 那套
 *    「自带哈希」被绕过的方式。
 */

import { describe, expect, it } from 'vitest'
import {
  checkEnvelopeFreshness,
  computeGenerationDigest,
  PLAN_MAX_AGE_DAYS,
  sealEnvelope,
  verifyEnvelope,
} from '../envelope'
import {
  createHmacSigner,
  createHmacVerifier,
  createUnavailableVerifier,
  InventorySigningError,
  MIN_SIGNING_SECRET_BYTES,
} from '../signing'
import { canonicalJson } from '../canonical-json'
import { GEN_KEYS, GEN_KEY_ID, genSigner, ISSUED_AT, makeCore, makeEnvelope, PLAN_ID, verifyGeneration } from './fixtures'
import type { InventoryPlanEnvelope } from '../types'

const URLS = ['https://example.com/a', 'https://example.com/b/', 'http://example.com/insecure', 'garbage']

function baseEnvelope(): InventoryPlanEnvelope {
  return makeEnvelope(makeCore(URLS))
}

/** 把一份被改过的信封按「编辑者会怎么做」跑两遍，两次都必须验不过。 */
function expectTamperRejected(tampered: InventoryPlanEnvelope, label: string): void {
  expect(verifyEnvelope(tampered, verifyGeneration), `${label}：只改内容`).toBe('digest_mismatch')
  const rehashed = { ...tampered, generationDigest: computeGenerationDigest(tampered) }
  expect(verifyEnvelope(rehashed, verifyGeneration), `${label}：改内容 + 用公开函数重算 digest`).toBe(
    'signature_invalid',
  )
}

describe('封签与验签的基线（不先证明它能过，后面的「拒」就证明不了什么）', () => {
  it('封出来的信封验得过，而且 digest 是确定性的', () => {
    const envelope = baseEnvelope()
    expect(verifyEnvelope(envelope, verifyGeneration)).toBe('valid')
    expect(computeGenerationDigest(envelope)).toBe(envelope.generationDigest)
    expect(makeEnvelope(makeCore([...URLS].reverse())).generationDigest).toBe(envelope.generationDigest)
  })

  it('signature 只覆盖 digest，但 digest 覆盖整份 UnsignedEnvelope（含 planId / issuedAt）', () => {
    const envelope = baseEnvelope()
    const digestInput = canonicalJson({
      envelopeVersion: envelope.envelopeVersion,
      keyId: envelope.keyId,
      planId: envelope.planId,
      issuedAt: envelope.issuedAt,
      core: envelope.core,
    })
    expect(digestInput).toContain(PLAN_ID)
    expect(digestInput).toContain(ISSUED_AT)
  })
})

describe('🔴 UnsignedEnvelope 的每一个叶子字段都在签名覆盖面里', () => {
  it('planId', () => {
    expectTamperRejected({ ...baseEnvelope(), planId: 'plan-9999' }, 'planId')
  })

  it('issuedAt（改它就能绕过七天有效期 —— 第一版设计漏掉的正是这个）', () => {
    expectTamperRejected({ ...baseEnvelope(), issuedAt: '2026-08-13T00:00:00.000Z' }, 'issuedAt')
  })

  it('envelopeVersion（在 digest 覆盖面里，但版本闸排在验签之前，所以结论是 version_mismatch）', () => {
    const tampered = { ...baseEnvelope(), envelopeVersion: 'canonical-inventory-envelope@0' }
    // 它确实进了 digest —— 改了它 digest 就变。
    expect(computeGenerationDigest(tampered)).not.toBe(tampered.generationDigest)
    // 但版本闸更靠前，所以两种手法都停在 version_mismatch。
    expect(verifyEnvelope(tampered, verifyGeneration)).toBe('version_mismatch')
    expect(
      verifyEnvelope({ ...tampered, generationDigest: computeGenerationDigest(tampered) }, verifyGeneration),
    ).toBe('version_mismatch')
  })

  const coreCases: [string, (e: InventoryPlanEnvelope) => InventoryPlanEnvelope][] = [
    ['core.clientId', (e) => ({ ...e, core: { ...e.core, clientId: 'other-tenant' } })],
    ['core.contractVersion', (e) => ({ ...e, core: { ...e.core, contractVersion: 'canonical-inventory-plan@1' } })],
    [
      'core.normalizationRuleVersion',
      (e) => ({ ...e, core: { ...e.core, normalizationRuleVersion: 'inventory-url-rules@0' } }),
    ],
    [
      'core.boundary.requestedDomain',
      (e) => ({ ...e, core: { ...e.core, boundary: { ...e.core.boundary, requestedDomain: 'other.com' } } }),
    ],
    [
      'core.boundary.approvedHosts',
      (e) => ({
        ...e,
        core: { ...e.core, boundary: { ...e.core.boundary, approvedHosts: ['example.com', 'www.example.com'] } },
      }),
    ],
    [
      'core.discovery[].count',
      (e) => ({ ...e, core: { ...e.core, discovery: e.core.discovery.map((d) => ({ ...d, count: d.count + 1 })) } }),
    ],
    [
      'core.discovery[].host',
      (e) => ({ ...e, core: { ...e.core, discovery: e.core.discovery.map((d) => ({ ...d, host: 'shop.example.com' })) } }),
    ],
    [
      'core.discovery[].foreignCount',
      (e) => ({ ...e, core: { ...e.core, discovery: e.core.discovery.map((d) => ({ ...d, foreignCount: 7 })) } }),
    ],
    [
      'core.discovery[].error',
      (e) => ({ ...e, core: { ...e.core, discovery: e.core.discovery.map((d) => ({ ...d, error: 'blocked' })) } }),
    ],
    [
      'core.candidates[].originalUrl',
      (e) => ({
        ...e,
        core: { ...e.core, candidates: e.core.candidates.map((c, i) => (i === 0 ? { ...c, originalUrl: 'https://example.com/z' } : c)) },
      }),
    ],
    [
      'core.candidates[].canonicalUrl',
      (e) => ({
        ...e,
        core: { ...e.core, candidates: e.core.candidates.map((c, i) => (i === 0 ? { ...c, canonicalUrl: 'https://example.com/hacked' } : c)) },
      }),
    ],
    [
      'core.candidates[].machineDecision',
      (e) => ({
        ...e,
        core: { ...e.core, candidates: e.core.candidates.map((c) => ({ ...c, machineDecision: 'pending' as const })) },
      }),
    ],
    [
      'core.candidates[].reasonCodes',
      (e) => ({ ...e, core: { ...e.core, candidates: e.core.candidates.map((c) => ({ ...c, reasonCodes: [] })) } }),
    ],
    [
      'core.candidates[].notes',
      (e) => ({ ...e, core: { ...e.core, candidates: e.core.candidates.map((c) => ({ ...c, notes: [] })) } }),
    ],
    [
      'core.candidates[].duplicateOf',
      (e) => ({
        ...e,
        core: { ...e.core, candidates: e.core.candidates.map((c, i) => (i === 0 ? { ...c, duplicateOf: 'https://example.com/x' } : c)) },
      }),
    ],
    [
      'core.candidates 整条插入（已批准主机上、从没被发现过的页面）',
      (e) => ({
        ...e,
        core: {
          ...e.core,
          candidates: [
            ...e.core.candidates,
            {
              originalUrl: 'https://example.com/never-discovered',
              canonicalUrl: 'https://example.com/never-discovered',
              machineDecision: 'pending' as const,
              reasonCodes: [],
              notes: [],
            },
          ],
        },
      }),
    ],
    [
      'core.candidates 整条删除',
      (e) => ({ ...e, core: { ...e.core, candidates: e.core.candidates.slice(1) } }),
    ],
    ['core.counts.discovered', (e) => ({ ...e, core: { ...e.core, counts: { ...e.core.counts, discovered: 99 } } })],
    ['core.counts.pending', (e) => ({ ...e, core: { ...e.core, counts: { ...e.core.counts, pending: 99 } } })],
    ['core.counts.rejected', (e) => ({ ...e, core: { ...e.core, counts: { ...e.core.counts, rejected: 99 } } })],
  ]

  it.each(coreCases)('%s', (label, mutate) => {
    expectTamperRejected(mutate(baseEnvelope()), label)
  })
})

describe('🔴 密钥边界', () => {
  const TWO_KEYS = { 'gen-a': 'a'.repeat(40), 'gen-b': 'b'.repeat(40) }

  it('key confusion：用 A 的密钥签、声称是 B 签的 → 拒', () => {
    const signerA = createHmacSigner({ keys: TWO_KEYS, activeKeyId: 'gen-a' })
    const verifier = createHmacVerifier({ keys: TWO_KEYS })
    const envelope = sealEnvelope({ planId: PLAN_ID, issuedAt: ISSUED_AT, core: makeCore(URLS) }, signerA)
    const swapped = { ...envelope, keyId: 'gen-b' }
    // 只换 keyId → digest 变了（keyId 在覆盖面里）
    expect(verifyEnvelope(swapped, verifier)).toBe('digest_mismatch')
    // 换 keyId 并重算 digest → 验签器按 gen-b 查密钥，算出来的 HMAC 对不上
    expect(verifyEnvelope({ ...swapped, generationDigest: computeGenerationDigest(swapped) }, verifier)).toBe(
      'signature_invalid',
    )
  })

  it('未知 keyId → unknown_key（密钥已作废，不是「被改过」）', () => {
    const envelope = baseEnvelope()
    const stranger = { ...envelope, keyId: 'gen-retired' }
    expect(verifyEnvelope({ ...stranger, generationDigest: computeGenerationDigest(stranger) }, verifyGeneration)).toBe(
      'unknown_key',
    )
  })

  it('一把密钥都没配 → key_unavailable（运维问题，不是篡改；更不是「验过了」）', () => {
    expect(verifyEnvelope(baseEnvelope(), createHmacVerifier({ keys: {} }))).toBe('key_unavailable')
    expect(verifyEnvelope(baseEnvelope(), createUnavailableVerifier())).toBe('key_unavailable')
  })

  it('🔴 信封结构版本不是当前这一版 → version_mismatch（旧信封不许套新语义）', () => {
    const e = baseEnvelope()
    const old = { ...e, envelopeVersion: 'canonical-inventory-envelope@0' }
    // 连 digest 一起重算也没用 —— 版本闸在验签之前，且比的是当前代码里的常量。
    expect(verifyEnvelope(old, verifyGeneration)).toBe('version_mismatch')
    expect(verifyEnvelope({ ...old, generationDigest: computeGenerationDigest(old) }, verifyGeneration)).toBe(
      'version_mismatch',
    )
  })

  it('缺 keyId / 缺签名 / 缺 digest → malformed', () => {
    const e = baseEnvelope()
    expect(verifyEnvelope({ ...e, keyId: '  ' }, verifyGeneration)).toBe('malformed')
    expect(verifyEnvelope({ ...e, generationSignature: '' }, verifyGeneration)).toBe('malformed')
    expect(verifyEnvelope({ ...e, generationDigest: '' }, verifyGeneration)).toBe('malformed')
  })

  it('🔴 签名器：空密钥环 / 没指定 active / active 不在环里 → 直接抛（签不出来比签错好）', () => {
    expect(() => createHmacSigner({ keys: {}, activeKeyId: 'x' })).toThrow(InventorySigningError)
    expect(() => createHmacSigner({ keys: GEN_KEYS })).toThrow(/没有指定当前签名密钥/)
    expect(() => createHmacSigner({ keys: GEN_KEYS, activeKeyId: 'nope' })).toThrow(/不在密钥环里/)
  })

  it(`🔴 密钥短于 ${MIN_SIGNING_SECRET_BYTES} 字节 → 直接抛（多半是随手填的占位串）`, () => {
    const short = { 'gen-a': 'x'.repeat(MIN_SIGNING_SECRET_BYTES - 1) }
    expect(() => createHmacSigner({ keys: short, activeKeyId: 'gen-a' })).toThrow(/至少要/)
    // 验签侧同样在构造时就抛 —— 「配错了」不该被当成「暂时验不了」放过去。
    expect(() => createHmacVerifier({ keys: short })).toThrow(/至少要/)
  })

  it('keyId 形状非法 → 抛（带分隔符的 id 会让签名原文的拼接产生歧义）', () => {
    expect(() => createHmacVerifier({ keys: { 'gen a': 'z'.repeat(40) } })).toThrow(/不合规/)
  })

  it('同一份内容、同一把密钥 → 签名稳定（否则重放/对账全都没法做）', () => {
    const a = sealEnvelope({ planId: PLAN_ID, issuedAt: ISSUED_AT, core: makeCore(URLS) }, genSigner)
    const b = sealEnvelope({ planId: PLAN_ID, issuedAt: ISSUED_AT, core: makeCore(URLS) }, genSigner)
    expect(a.generationSignature).toBe(b.generationSignature)
    expect(a.keyId).toBe(GEN_KEY_ID)
  })
})

describe(`🔴 有效期固定 ${PLAN_MAX_AGE_DAYS} 天`, () => {
  const day = 24 * 60 * 60 * 1000
  const at = (ms: number): string => new Date(Date.parse(ISSUED_AT) + ms).toISOString()

  it('刚签发 → fresh', () => {
    expect(checkEnvelopeFreshness(ISSUED_AT, ISSUED_AT)).toBe('fresh')
  })

  it('第 7 天差 1 毫秒 → 还 fresh', () => {
    expect(checkEnvelopeFreshness(ISSUED_AT, at(PLAN_MAX_AGE_DAYS * day - 1))).toBe('fresh')
  })

  it('刚好第 7 天 → 还 fresh（日期**写死**，不从被测常量推 —— 否则常量改成 3650 它照样绿）', () => {
    expect(checkEnvelopeFreshness('2026-08-12T00:00:00.000Z', '2026-08-19T00:00:00.000Z')).toBe('fresh')
  })

  it('第 7 天多 1 毫秒 → expired（同样写死日期）', () => {
    expect(checkEnvelopeFreshness('2026-08-12T00:00:00.000Z', '2026-08-19T00:00:00.001Z')).toBe('expired')
    expect(checkEnvelopeFreshness(ISSUED_AT, at(PLAN_MAX_AGE_DAYS * day + 1))).toBe('expired')
  })

  it('签发时间解析不了 → invalid_timestamp（不是「当作没过期」）', () => {
    expect(checkEnvelopeFreshness('not-a-date', ISSUED_AT)).toBe('invalid_timestamp')
    expect(checkEnvelopeFreshness(ISSUED_AT, 'not-a-date')).toBe('invalid_timestamp')
  })

  it('🔴 签发时间比当前还晚 → invalid_timestamp（否则等于一枚永不过期的信封）', () => {
    expect(checkEnvelopeFreshness(at(day), ISSUED_AT)).toBe('invalid_timestamp')
  })
})

describe('稳定序列化（签名原文的确定性）', () => {
  it('对象键排序：键顺序不同 → 同一份原文', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('数组保序：顺序不同 → 不同原文（顺序本身是内容）', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('undefined 剔除；null 显式保留（两者不是一回事）', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }))
  })

  it('顶层 undefined / null → "null"（签名原文永远不是空串）', () => {
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson(null)).toBe('null')
  })

  it('🔴 非普通对象直接抛，不静默塌成 {}（两个不同的 Date 否则会拿到同一个 digest）', () => {
    expect(() => canonicalJson({ t: new Date(1) })).toThrow(/只接受普通对象/)
    expect(() => canonicalJson(new Map())).toThrow(/只接受普通对象/)
    expect(() => canonicalJson([new Set()])).toThrow(/只接受普通对象/)
    // 普通对象 / 数组 / 原始值照常
    expect(canonicalJson({ a: [1, 'x', null] })).toBe('{"a":[1,"x",null]}')
  })
})
