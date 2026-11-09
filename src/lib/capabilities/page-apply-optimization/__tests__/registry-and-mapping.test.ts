/**
 * 验 registry + mapping + outward-authorization 全部对齐：
 * 认识这个动作，且真的能承接它（不给半成品放行）。
 */

import { describe, it, expect } from 'vitest'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { outwardBlockReason } from '@/lib/kernel/outward-authorization'
import { mapCandidateIdentity, MAPPING_TABLE } from '@/lib/action-bridge'
import type { OutwardApproval } from '@/lib/kernel/types'

const KEY = 'page.apply_optimization_request'

describe(`ActionDefinition · ${KEY}`, () => {
  const def = ACTION_REGISTRY.get(KEY)!

  it('已注册', () => {
    expect(def).toBeTruthy()
    expect(def.actionKey).toBe(KEY)
    expect(def.version).toBe(1)
  })

  it('sideEffect=outward + reversible=true + outwardAuth 完整声明', () => {
    expect(def.sideEffect).toBe('outward')
    expect(def.reversible).toBe(true)
    expect(def.outwardAuthorization).toBeTruthy()
    expect(def.outwardAuthorization?.approval.mode).toBe('human_only')
    expect(def.outwardAuthorization?.rollback).toBe('provider_native')
    expect(def.outwardAuthorization?.declaredIn).toMatch(/docs\/specs\/.+\.md$/)
  })

  it('outward-authorization gate 放行', () => {
    expect(outwardBlockReason(def)).toBeNull()
  })

  it('verification = page_apply_integrity（execution-integrity only）', () => {
    expect(def.verification?.method).toBe('page_apply_integrity')
    expect(def.verification?.delayMs).toBe(0)
  })

  it('idempotency keyFields 三元组 = page_url + page_version_token + validated_diff_hash', () => {
    expect(def.idempotency.keyFields).toEqual([
      'page_url', 'page_version_token', 'validated_diff_hash',
    ])
    expect(def.idempotency.scope).toBe('client')
  })

  it('inputSchema 必填字段严格', () => {
    expect(def.inputSchema.required).toEqual([
      'page_url', 'page_version_token', 'validated_diff_hash', 'intents', 'do_not_touch',
    ])
    expect(def.inputSchema.additionalProperties).toBe(false)
  })

  it('每一步都有显式成本上界（outward gate 硬要求）', () => {
    for (const step of def.steps) {
      expect(def.costModel.stepCeilingUsd?.[step]).toBe(0)
    }
  })

  it('providerIdempotency = supported（对外动作必须诚实声明，不能 not_applicable）', () => {
    expect(def.providerIdempotency).toBe('supported')
  })
})

describe(`Mutation guards on ${KEY}`, () => {
  const base = ACTION_REGISTRY.get(KEY)!

  it('把 outwardAuthorization 改成 null → outward gate 拒', () => {
    const mutated = { ...base, outwardAuthorization: null }
    expect(outwardBlockReason(mutated)).not.toBeNull()
  })

  it('把 reversible 改成 false → outward gate 拒', () => {
    const mutated = { ...base, reversible: false }
    expect(outwardBlockReason(mutated)).not.toBeNull()
  })

  it('声明 bounded 却不给 envelope → 类型上不该编过；运行时 gate 也拒', () => {
    const mutated = {
      ...base,
      outwardAuthorization: {
        ...base.outwardAuthorization!,
        approval: { mode: 'bounded' } as unknown as OutwardApproval,
      },
    }
    expect(outwardBlockReason(mutated)).not.toBeNull()
  })

  it('把 providerIdempotency 改成 not_applicable → outward gate 拒（对外动作必须诚实）', () => {
    const mutated = { ...base, providerIdempotency: 'not_applicable' as const }
    expect(outwardBlockReason(mutated)).not.toBeNull()
  })

  it('少声明一步的上界 → outward gate 拒', () => {
    const mutated = {
      ...base,
      costModel: { ...base.costModel, stepCeilingUsd: { prepare: 0, commit: 0, open_pr: 0 } },
    }
    expect(outwardBlockReason(mutated)).not.toBeNull()
  })
})

describe('Action Bridge mapping', () => {
  it('MAPPING_TABLE 至少有一条 GEO → page.apply_optimization_request', () => {
    const hit = MAPPING_TABLE.find(
      (e) => e.domain === 'geo' && e.intent === 'optimize_page_answerability',
    )
    expect(hit?.actionKey).toBe(KEY)
  })

  it('mapCandidateIdentity 认领 GEO candidate', () => {
    const result = mapCandidateIdentity({ domain: 'geo', intent: 'optimize_page_answerability' })
    expect(result.outcome).toBe('mapped')
    if (result.outcome === 'mapped') {
      expect(result.actionKey).toBe(KEY)
      expect(result.actionVersion).toBe(1)
    }
  })

  it('陌生 candidate 仍返回 unmapped_identity', () => {
    const result = mapCandidateIdentity({ domain: 'geo', intent: 'noop' })
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') {
      expect(result.code).toBe('unmapped_identity')
    }
  })
})
