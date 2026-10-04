import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  KILL_REASON_PREFIX,
  buildKillTripRows,
  readActivationKillState,
  type KillStateDeps,
} from '../activation-kill'

/** 造一个 readCircuit 的返回值。 */
function circuit(over: Partial<{ tripped: boolean; reason: string | null; queryError: string | null }>) {
  return {
    tripped: false,
    reason: null,
    queryError: null,
    ...over,
  }
}

describe('readActivationKillState', () => {
  it('所有账户都没熔断 → engaged:false，accounts 原样（含 act_ 前缀与不带前缀混合）', async () => {
    const ids = ['act_111', '222', 'act_333']
    const deps: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids })),
      readCircuit: vi.fn(async () => circuit({})),
    }

    const state = await readActivationKillState(deps, 'c1')

    expect(state.engaged).toBe(false)
    expect(state.accounts).toEqual(['act_111', '222', 'act_333'])
  })

  it('紧急开关打开：reason 以 manual_emergency_stop 开头 → kill_switch_engaged', async () => {
    const deps: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: ['act_111', 'act_222'] })),
      readCircuit: vi.fn(async (_clientId: string, adAccountId: string) =>
        adAccountId === 'act_222'
          ? circuit({ tripped: true, reason: 'manual_emergency_stop: 客户投诉' })
          : circuit({}),
      ),
    }

    const state = await readActivationKillState(deps, 'c1')

    expect(state.engaged).toBe(true)
    if (!state.engaged) throw new Error('unreachable')
    expect(state.code).toBe('kill_switch_engaged')
    expect(state.accountId).toBe('act_222')
    expect(state.message).toContain('act_222')
  })

  it('系统熔断：reason 不是紧急开关前缀 → circuit_tripped', async () => {
    const deps: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: ['act_111'] })),
      readCircuit: vi.fn(async () => circuit({ tripped: true, reason: 'spend_over_cap' })),
    }

    const state = await readActivationKillState(deps, 'c1')

    expect(state.engaged).toBe(true)
    if (!state.engaged) throw new Error('unreachable')
    expect(state.code).toBe('circuit_tripped')
    expect(state.accountId).toBe('act_111')
  })

  it('多账户只有第二个熔断也被挡住（停开关之后才新绑定的账户也被罩住）', async () => {
    const deps: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: ['act_111', 'act_222', 'act_333'] })),
      readCircuit: vi.fn(async (_clientId: string, adAccountId: string) =>
        adAccountId === 'act_222'
          ? circuit({ tripped: true, reason: 'manual_emergency_stop: 停开关后新绑的账户' })
          : circuit({}),
      ),
    }

    const state = await readActivationKillState(deps, 'c1')

    expect(state.engaged).toBe(true)
    if (!state.engaged) throw new Error('unreachable')
    expect(state.code).toBe('kill_switch_engaged')
    expect(state.accountId).toBe('act_222')
  })

  it('readCircuit 返回 queryError → circuit_unreadable 并点名账户；抛异常同样 circuit_unreadable（不外抛）', async () => {
    const depsErr: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: ['act_111', 'act_222'] })),
      readCircuit: vi.fn(async (_clientId: string, adAccountId: string) =>
        adAccountId === 'act_222' ? circuit({ queryError: 'boom' }) : circuit({}),
      ),
    }

    const stateErr = await readActivationKillState(depsErr, 'c1')
    expect(stateErr.engaged).toBe(true)
    if (!stateErr.engaged) throw new Error('unreachable')
    expect(stateErr.code).toBe('circuit_unreadable')
    expect(stateErr.accountId).toBe('act_222')
    expect(stateErr.message).toContain('act_222')

    const depsThrow: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: ['act_111'] })),
      readCircuit: vi.fn(async () => {
        throw new Error('network down')
      }),
    }

    const stateThrow = await readActivationKillState(depsThrow, 'c1')
    expect(stateThrow.engaged).toBe(true)
    if (!stateThrow.engaged) throw new Error('unreachable')
    expect(stateThrow.code).toBe('circuit_unreadable')
    expect(stateThrow.accountId).toBe('act_111')
  })

  it('listAccounts 返回 error 或抛异常 → registry_unreadable；ids 为空或全空白 → no_accounts', async () => {
    const depsError: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: [], error: 'db down' })),
      readCircuit: vi.fn(async () => circuit({})),
    }
    const stateError = await readActivationKillState(depsError, 'c1')
    expect(stateError.engaged).toBe(true)
    if (!stateError.engaged) throw new Error('unreachable')
    expect(stateError.code).toBe('registry_unreadable')

    const depsThrow: KillStateDeps = {
      listAccounts: vi.fn(async () => {
        throw new Error('boom')
      }),
      readCircuit: vi.fn(async () => circuit({})),
    }
    const stateThrow = await readActivationKillState(depsThrow, 'c1')
    expect(stateThrow.engaged).toBe(true)
    if (!stateThrow.engaged) throw new Error('unreachable')
    expect(stateThrow.code).toBe('registry_unreadable')

    const depsEmpty: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: [] })),
      readCircuit: vi.fn(async () => circuit({})),
    }
    const stateEmpty = await readActivationKillState(depsEmpty, 'c1')
    expect(stateEmpty.engaged).toBe(true)
    if (!stateEmpty.engaged) throw new Error('unreachable')
    expect(stateEmpty.code).toBe('no_accounts')

    const depsBlank: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids: ['', '   '] })),
      readCircuit: vi.fn(async () => circuit({})),
    }
    const stateBlank = await readActivationKillState(depsBlank, 'c1')
    expect(stateBlank.engaged).toBe(true)
    if (!stateBlank.engaged) throw new Error('unreachable')
    expect(stateBlank.code).toBe('no_accounts')
  })

  it('注册表原样：传给 readCircuit 的账户号与注册表给的字符串完全相同（含 act_ 前缀）', async () => {
    const ids = ['act_111', '222']
    const readCircuit = vi.fn(async () => circuit({}))
    const deps: KillStateDeps = {
      listAccounts: vi.fn(async () => ({ ids })),
      readCircuit,
    }

    await readActivationKillState(deps, 'c1')

    expect(readCircuit).toHaveBeenCalledTimes(2)
    expect(readCircuit).toHaveBeenNthCalledWith(1, 'c1', 'act_111')
    expect(readCircuit).toHaveBeenNthCalledWith(2, 'c1', '222')
  })
})

describe('buildKillTripRows', () => {
  it('合法输入 → 每账户一行，字段逐一断言；邮箱大小写和首尾空格被规整', () => {
    const at = new Date('2024-01-02T03:04:05.000Z')
    const result = buildKillTripRows({
      clientId: 'c1',
      accountIds: ['act_111', '222'],
      reason: '  客户投诉  ',
      actorEmail: '  Ray@X.com  ',
      at,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows).toHaveLength(2)

    const [row0, row1] = result.rows
    expect(row0.client_id).toBe('c1')
    expect(row0.ad_account_id).toBe('act_111')
    expect(row0.kind).toBe('trip')
    expect(row0.sticky).toBe(true)
    expect(row0.reason).toBe(`${KILL_REASON_PREFIX}: 客户投诉`)
    expect(row0.actor).toBe('human:ray@x.com')
    expect(row0.evidence).toEqual({
      source: 'activation_kill',
      by: 'ray@x.com',
      at: at.toISOString(),
    })

    expect(row1.ad_account_id).toBe('222')
    expect(row1.reason).toBe(`${KILL_REASON_PREFIX}: 客户投诉`)
  })

  it('原因为空/纯空白 → ok:false；原因 501 字 → ok:false', () => {
    const at = new Date('2024-01-02T03:04:05.000Z')
    const base = {
      clientId: 'c1',
      accountIds: ['act_111'],
      actorEmail: 'ray@x.com',
      at,
    }

    expect(buildKillTripRows({ ...base, reason: '' }).ok).toBe(false)
    expect(buildKillTripRows({ ...base, reason: '   ' }).ok).toBe(false)
    expect(buildKillTripRows({ ...base, reason: 'x'.repeat(501) }).ok).toBe(false)
  })

  it('邮箱缺失/空串/不含 @ → ok:false', () => {
    const at = new Date('2024-01-02T03:04:05.000Z')
    const base = {
      clientId: 'c1',
      accountIds: ['act_111'],
      reason: '客户投诉',
      at,
    }

    expect(buildKillTripRows({ ...base, actorEmail: '' }).ok).toBe(false)
    expect(buildKillTripRows({ ...base, actorEmail: '   ' }).ok).toBe(false)
    expect(buildKillTripRows({ ...base, actorEmail: 'no-at-sign' }).ok).toBe(false)
  })

  it('账户全空 → ok:false；账户重复只出一行', () => {
    const at = new Date('2024-01-02T03:04:05.000Z')
    const base = {
      clientId: 'c1',
      reason: '客户投诉',
      actorEmail: 'ray@x.com',
      at,
    }

    expect(buildKillTripRows({ ...base, accountIds: [] }).ok).toBe(false)
    expect(buildKillTripRows({ ...base, accountIds: ['', '   '] }).ok).toBe(false)

    const dup = buildKillTripRows({
      ...base,
      accountIds: ['act_111', 'act_111', '222'],
    })
    expect(dup.ok).toBe(true)
    if (!dup.ok) throw new Error('unreachable')
    expect(dup.rows).toHaveLength(2)
    expect(dup.rows.map((r) => r.ad_account_id)).toEqual(['act_111', '222'])
  })
})

describe('源文件约束', () => {
  it('源文件不含 release', () => {
    const src = readFileSync(join(__dirname, '..', 'activation-kill.ts'), 'utf8')
    expect(src.toLowerCase()).not.toContain('release')
  })
})
