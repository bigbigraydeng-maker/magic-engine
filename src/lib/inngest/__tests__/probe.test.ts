/**
 * #1346 · Inngest 接收端点的保证（三审必改项落实）：
 *   1. 探针受理判据 fail-closed（缺字段 / 0 / 负时间一律拒）
 *   2. 云端函数 id 命名空间隔离（cloud- 前缀）
 *   3. 云端函数不监听本机 worker 已消费的事件（一事件一主，防平行系统）
 *   4. 生产 fail-closed 守卫（缺 signing key / INNGEST_DEV 真值 → 拒绝服务）
 */
import { describe, it, expect } from 'vitest'
import { probeReceiptFor, CLOUD_PROBE_PING_EVENT } from '../functions/probe'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import { productionGuardError, inngestDevDisabled } from '../serve-guard'

describe('probeReceiptFor — fail-closed 受理判据', () => {
  it('合法 payload → ok，带回 source_id 与事件时间', () => {
    expect(probeReceiptFor({ source_id: 'probe-abc' }, 1_700_000_000)).toEqual({
      ok: true, source_id: 'probe-abc', received_ts: 1_700_000_000, app: 'magic-engine-web',
    })
  })
  it('缺 source_id / 空串 / 纯空白 / 非字符串 / data 非对象 → 拒', () => {
    expect(probeReceiptFor({}, 1).ok).toBe(false)
    expect(probeReceiptFor({ source_id: '' }, 1).ok).toBe(false)
    expect(probeReceiptFor({ source_id: '   ' }, 1).ok).toBe(false)
    expect(probeReceiptFor({ source_id: 123 }, 1).ok).toBe(false)
    expect(probeReceiptFor({ source_id: {} }, 1).ok).toBe(false)
    expect(probeReceiptFor(null, 1).ok).toBe(false)
    expect(probeReceiptFor('x', 1).ok).toBe(false)
  })
  it('事件时间缺失 / NaN / 0 / 负数 → 拒（0 与负数不是真实事件时间，魏征 S1）', () => {
    expect(probeReceiptFor({ source_id: 'ok' }, undefined).ok).toBe(false)
    expect(probeReceiptFor({ source_id: 'ok' }, NaN).ok).toBe(false)
    expect(probeReceiptFor({ source_id: 'ok' }, 0).ok).toBe(false)
    expect(probeReceiptFor({ source_id: 'ok' }, -1).ok).toBe(false)
  })
})

describe('云端函数命名空间 + 事件归属隔离（子牙必改项）', () => {
  it('注册的每个云端函数 id 都以 cloud- 开头', () => {
    expect(cloudFunctions.length).toBeGreaterThan(0)
    for (const fn of cloudFunctions) expect(fn.id()).toMatch(new RegExp(`^${CLOUD_FN_PREFIX}`))
  })
  it('探针事件是专属事件，不是任何真实业务事件', () => {
    expect(CLOUD_PROBE_PING_EVENT).toBe('cloud/probe.ping')
    expect(CLOUD_PROBE_PING_EVENT).not.toContain('publish_queue')
  })
  it('没有云端函数监听本机 worker 已消费的事件（一事件一主）', () => {
    // 真正防平行系统的不变量：按事件名归属，不靠 app id / 前缀。
    for (const fn of cloudFunctions) {
      const triggers = (fn as unknown as { opts: { triggers?: { event?: string }[] } }).opts.triggers ?? []
      for (const t of triggers) {
        expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(t.event)
      }
    }
  })
})

describe('生产 fail-closed 守卫（狄仁杰 / 魏征 M1+M2）', () => {
  it('非生产环境一律放行（本地 / 预览走 dev 模式）', () => {
    expect(productionGuardError({ nodeEnv: 'development', signingKey: undefined, inngestDev: '1' })).toBeNull()
    expect(productionGuardError({ nodeEnv: undefined, signingKey: undefined, inngestDev: undefined })).toBeNull()
  })
  it('生产缺 signing key → 拒绝服务', () => {
    expect(productionGuardError({ nodeEnv: 'production', signingKey: undefined, inngestDev: undefined })).toMatch(/SIGNING_KEY/)
    expect(productionGuardError({ nodeEnv: 'production', signingKey: '   ', inngestDev: undefined })).toMatch(/SIGNING_KEY/)
  })
  it('生产设了 INNGEST_DEV 真值 → 拒绝服务（会静默关掉签名校验）', () => {
    expect(productionGuardError({ nodeEnv: 'production', signingKey: 'sk', inngestDev: '1' })).toMatch(/INNGEST_DEV/)
    expect(productionGuardError({ nodeEnv: 'production', signingKey: 'sk', inngestDev: 'true' })).toMatch(/INNGEST_DEV/)
  })
  it('生产配置正确（有 key、无 INNGEST_DEV）→ 放行', () => {
    expect(productionGuardError({ nodeEnv: 'production', signingKey: 'sk', inngestDev: undefined })).toBeNull()
    expect(productionGuardError({ nodeEnv: 'production', signingKey: 'sk', inngestDev: 'false' })).toBeNull()
    expect(productionGuardError({ nodeEnv: 'production', signingKey: 'sk', inngestDev: '0' })).toBeNull()
  })
  it('inngestDevDisabled：false/0/空/未设 视为未开启', () => {
    expect(inngestDevDisabled(undefined)).toBe(false)
    expect(inngestDevDisabled('')).toBe(false)
    expect(inngestDevDisabled('false')).toBe(false)
    expect(inngestDevDisabled('0')).toBe(false)
    expect(inngestDevDisabled('1')).toBe(true)
    expect(inngestDevDisabled('true')).toBe(true)
  })
})
