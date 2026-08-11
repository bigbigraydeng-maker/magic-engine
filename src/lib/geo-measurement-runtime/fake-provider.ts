/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— fake provider（Issue #874 / WP04）
 *
 * 🔴 本 WP 唯一授权的 provider 实现。**不调用任何真实/付费 AI API，不发起任何
 *    网络请求**（Build Control Room 2026-08-11 WP04 裁定：不执行真实 GEO 测量）。
 *    真实 provider adapter 是未来 WP 的事，不在本文件范围内。
 *
 * 调用方通过 `script` 显式声明每一次调用该返回什么结果 —— 这样才能确定性地
 * 证明 preflight / 失败分类 / evidence 规则 / 覆盖率统计的行为，而不是靠随机数
 * 制造一个测不准的系统。
 */

import type { GeoRuntimeProvider, GeoRuntimeProviderCallInput, GeoRuntimeProviderIdempotency, GeoRuntimeProviderOutcome } from './types'

export type GeoFakeProviderScriptEntry = (input: GeoRuntimeProviderCallInput) => GeoRuntimeProviderOutcome

export interface CreateFakeGeoProviderOptions {
  readonly costCeilingUsdPerCall: number
  readonly idempotency?: GeoRuntimeProviderIdempotency
  /** 按调用顺序（第几次 `call()`）决定返回什么；用完则重复最后一条。 */
  readonly script: readonly GeoFakeProviderScriptEntry[]
}

export interface GeoFakeGeoProvider extends GeoRuntimeProvider {
  readonly callLog: readonly GeoRuntimeProviderCallInput[]
}

const DEFAULT_IDEMPOTENCY: GeoRuntimeProviderIdempotency = Object.freeze({
  supported: false,
  note: 'fake provider declares no idempotency guarantee by default — ambiguous outcomes must not be auto-replayed',
})

/** 一个总是成功、每次调用固定成本的 fake provider，供不关心失败路径的测试用。 */
export function createAlwaysSucceedsFakeProvider(costCeilingUsdPerCall: number): GeoFakeGeoProvider {
  return createFakeGeoProvider({
    costCeilingUsdPerCall,
    script: [
      (input) => ({
        kind: 'success',
        rawResponse: `fake response for ${input.query.queryKey}#${input.sampleIndex}`,
        citations: [],
        confidence: 0.95,
        costUsd: costCeilingUsdPerCall,
      }),
    ],
  })
}

export function createFakeGeoProvider(options: CreateFakeGeoProviderOptions): GeoFakeGeoProvider {
  if (!Number.isFinite(options.costCeilingUsdPerCall) || options.costCeilingUsdPerCall < 0) {
    throw new Error('fake provider costCeilingUsdPerCall must be a finite, non-negative number')
  }
  if (options.script.length === 0) {
    throw new Error('fake provider script must declare at least one outcome')
  }

  const callLog: GeoRuntimeProviderCallInput[] = []

  return {
    costCeilingUsdPerCall: options.costCeilingUsdPerCall,
    idempotency: options.idempotency ?? DEFAULT_IDEMPOTENCY,
    callLog,
    async call(input: GeoRuntimeProviderCallInput): Promise<GeoRuntimeProviderOutcome> {
      callLog.push(input)
      const scriptIndex = Math.min(callLog.length - 1, options.script.length - 1)
      return options.script[scriptIndex](input)
    },
  }
}
