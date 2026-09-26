import { applyCircuitBreaker, CIRCUIT_BREAKER_ACTOR } from '../circuit-breaker-apply'
import type { CircuitBreakerEvidence } from '../circuit-breaker'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, it, expect } from 'vitest'

interface FakeState {
  configRow: { autonomy_mode: string } | null
  configReadError: string | null
  configUpdateError: string | null
  insertError: string | null
  inserted: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
}

function makeFakeSupabase(state: FakeState): SupabaseClient {
  const fake = {
    from(table: string) {
      if (table === 'ads_circuit_events') {
        return {
          insert(rows: Array<Record<string, unknown>>) {
            for (const row of rows) {
              state.inserted.push(row)
            }
            return Promise.resolve({
              error: state.insertError ? { message: state.insertError } : null,
            })
          },
        }
      }
      if (table === 'ad_strategy_configs') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: state.configRow,
                      error: state.configReadError
                        ? { message: state.configReadError }
                        : null,
                    })
                  },
                }
              },
            }
          },
          update(patch: Record<string, unknown>) {
            state.updates.push(patch)
            return {
              eq() {
                return Promise.resolve({
                  error: state.configUpdateError
                    ? { message: state.configUpdateError }
                    : null,
                })
              },
            }
          },
        }
      }
      throw new Error('unexpected table: ' + table)
    },
  }
  return fake as unknown as SupabaseClient
}

function evidence(
  over: Partial<CircuitBreakerEvidence> = {},
): CircuitBreakerEvidence {
  return {
    clientId: '11111111-1111-1111-1111-111111111111',
    cycleDate: '2026-09-27',
    dataCompleteness: 'complete',
    spendTodayCents: 10_000,
    spendMedianPrev7Cents: 9_000,
    accountDeltaTodayCents: 1_000,
    dailyBudgetCapCents: 50_000,
    kernelRollbackFailures: 0,
    consecutiveJevLowScores: 0,
    jevLowScoreLimit: 3,
    ...over,
  }
}

function state(over: Partial<FakeState> = {}): FakeState {
  return {
    configRow: { autonomy_mode: 'bounded_auto' },
    configReadError: null,
    configUpdateError: null,
    insertError: null,
    inserted: [],
    updates: [],
    ...over,
  }
}

const SPIKE = { spendTodayCents: 28_000, spendMedianPrev7Cents: 9_000 }

describe('applyCircuitBreaker', () => {
  it('全绿时写 5 条事件、不切档位、不写配置', async () => {
    const s = state()
    const sb = makeFakeSupabase(s)

    const result = await applyCircuitBreaker(sb, evidence())

    expect(s.inserted).toHaveLength(5)
    expect(result.eventsWritten).toBe(5)
    expect(result.modeSwitch).toBe('not_required')
    expect(s.updates).toHaveLength(0)
  })

  it('每条事件都带 client_id / occurred_on / trigger_code / outcome，且日期与客户 id 正确', async () => {
    const s = state()
    const sb = makeFakeSupabase(s)

    await applyCircuitBreaker(sb, evidence())

    for (const row of s.inserted) {
      expect(row).toHaveProperty('client_id')
      expect(row).toHaveProperty('occurred_on')
      expect(row).toHaveProperty('trigger_code')
      expect(row).toHaveProperty('outcome')
      expect(row.occurred_on).toBe('2026-09-27')
      expect(row.client_id).toBe('11111111-1111-1111-1111-111111111111')
    }
  })

  it('花钱暴涨且当前是 bounded_auto 时切回只观察，并写入审计标签', async () => {
    const s = state()
    const sb = makeFakeSupabase(s)

    const result = await applyCircuitBreaker(sb, evidence(SPIKE))

    expect(result.modeSwitch).toBe('switched_to_observe')
    expect(s.updates).toHaveLength(1)
    expect(s.updates[0].autonomy_mode).toBe('observe')
    expect(s.updates[0].autonomy_mode_updated_by).toBe(CIRCUIT_BREAKER_ACTOR)
  })

  it('熔断写入的档位永远不是 deny', async () => {
    const s = state()
    const sb = makeFakeSupabase(s)

    await applyCircuitBreaker(sb, evidence(SPIKE))

    expect(s.updates[0].autonomy_mode).not.toBe('deny')
  })

  it('数据不完整时只做当日冻结，不切档位', async () => {
    const s = state()
    const sb = makeFakeSupabase(s)

    const result = await applyCircuitBreaker(
      sb,
      evidence({ dataCompleteness: 'partial' }),
    )

    expect(result.modeSwitch).toBe('not_required')
    expect(s.updates).toHaveLength(0)
    const frozen = s.inserted.find((row) => row.trigger_code === 'data_incomplete')
    expect(frozen).toBeDefined()
    expect(frozen?.outcome).toBe('frozen_for_day')
  })

  it('数据不完整时花钱暴涨判据只记为 unknown_data_partial，且不切档位', async () => {
    const s = state()
    const sb = makeFakeSupabase(s)

    await applyCircuitBreaker(
      sb,
      evidence({ ...SPIKE, dataCompleteness: 'partial' }),
    )

    const spike = s.inserted.find((row) => row.trigger_code === 'spend_spike')
    expect(spike).toBeDefined()
    expect(spike?.outcome).toBe('unknown_data_partial')
    expect(s.updates).toHaveLength(0)
  })

  it('已经是 observe 时不再重复写档位', async () => {
    const s = state({ configRow: { autonomy_mode: 'observe' } })
    const sb = makeFakeSupabase(s)

    const result = await applyCircuitBreaker(sb, evidence(SPIKE))

    expect(result.modeSwitch).toBe('already_observe')
    expect(s.updates).toHaveLength(0)
  })

  it('没有配置行时返回 no_config 且不写档位', async () => {
    const s = state({ configRow: null })
    const sb = makeFakeSupabase(s)

    const result = await applyCircuitBreaker(sb, evidence(SPIKE))

    expect(result.modeSwitch).toBe('no_config')
    expect(s.updates).toHaveLength(0)
  })

  it('记账失败不挡住止损：事件写失败但仍切回只观察', async () => {
    const s = state({ insertError: 'boom' })
    const sb = makeFakeSupabase(s)

    const result = await applyCircuitBreaker(sb, evidence(SPIKE))

    expect(result.eventWriteError).toBe('boom')
    expect(result.eventsWritten).toBe(0)
    expect(result.modeSwitch).toBe('switched_to_observe')
  })

  it('读不到当前档位时抛错（fail closed）', async () => {
    const s = state({ configReadError: 'read boom' })
    const sb = makeFakeSupabase(s)

    await expect(applyCircuitBreaker(sb, evidence(SPIKE))).rejects.toThrow()
  })

  it('写档位失败时抛错', async () => {
    const s = state({ configUpdateError: 'write boom' })
    const sb = makeFakeSupabase(s)

    await expect(applyCircuitBreaker(sb, evidence(SPIKE))).rejects.toThrow()
  })
})
