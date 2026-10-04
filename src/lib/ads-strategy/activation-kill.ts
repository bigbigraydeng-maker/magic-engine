/**
 * 广告「紧急开关」纯逻辑模块。
 *
 * 紧急开关 = 给客户**每个注册账户**各写一行 sticky trip（reason 以
 * `manual_emergency_stop` 开头）。开启广告前读：客户**任一**注册账户熔断中，
 * 就拒绝开启。
 *
 * 本文件只做两件事：
 *   ① 读状态判定（`readActivationKillState`）—— 通过注入的函数读注册表与熔断状态。
 *   ② 造要插入的行（`buildKillTripRows`）—— 纯数据构造，不碰数据库。
 * 数据库读写由别的模块做。
 *
 * 🔴 账户号必须**原样**使用注册表里读出来的字符串，不要自己去掉 `act_` 前缀或改
 *    大小写 —— 解除路由是按账户号精确匹配的，改了就解不掉。
 *
 * 🔴 fail-closed：任何读不出来都算「挡住」。
 */

import type { CircuitState } from './circuit-state'

/** 紧急开关 trip 的 reason 前缀。 */
export const KILL_REASON_PREFIX = 'manual_emergency_stop'

export interface KillStateDeps {
  listAccounts(clientId: string): Promise<{ ids: string[]; error?: string }>
  readCircuit(
    clientId: string,
    adAccountId: string,
  ): Promise<Pick<CircuitState, 'tripped' | 'reason' | 'queryError'>>
}

export type KillBlockCode =
  | 'kill_switch_engaged' // 有账户熔断中，且最新那条 trip 的 reason 以 KILL_REASON_PREFIX 开头（人按的紧急开关）
  | 'circuit_tripped' // 有账户熔断中，但不是紧急开关（系统熔断）
  | 'circuit_unreadable' // 读某账户熔断状态本身出错
  | 'registry_unreadable' // 读客户账户清单出错
  | 'no_accounts' // 客户没有任何登记账户

export type KillState =
  | { engaged: false; accounts: string[] }
  | {
      engaged: true
      code: KillBlockCode
      message: string
      accountId?: string
      accounts: string[]
    }

/** 去掉空串/纯空白，保留原样字符串（不改写）。 */
function cleanIds(ids: readonly string[]): string[] {
  return ids.filter((id) => id.trim() !== '')
}

export async function readActivationKillState(
  deps: KillStateDeps,
  clientId: string,
): Promise<KillState> {
  // ① 读客户账户清单。读不出来 → registry_unreadable（fail-closed）。
  let listed: { ids: string[]; error?: string }
  try {
    listed = await deps.listAccounts(clientId)
  } catch (err) {
    return {
      engaged: true,
      code: 'registry_unreadable',
      message: `读不到客户账户清单，无法确认紧急开关状态：${errorText(err)}`,
      accounts: [],
    }
  }

  if (typeof listed.error === 'string' && listed.error !== '') {
    return {
      engaged: true,
      code: 'registry_unreadable',
      message: `读不到客户账户清单，无法确认紧急开关状态：${listed.error}`,
      accounts: [],
    }
  }

  // ② 没有任何登记账户 → no_accounts。
  const accounts = cleanIds(listed.ids ?? [])
  if (accounts.length === 0) {
    return {
      engaged: true,
      code: 'no_accounts',
      message: '客户没有任何登记账户，无法确认紧急开关状态',
      accounts: [],
    }
  }

  // ③ 按顺序逐个账户读熔断状态。
  for (const accountId of accounts) {
    let state: Pick<CircuitState, 'tripped' | 'reason' | 'queryError'>
    try {
      state = await deps.readCircuit(clientId, accountId)
    } catch (err) {
      return {
        engaged: true,
        code: 'circuit_unreadable',
        message: `读不到账户 ${accountId} 的熔断状态：${errorText(err)}`,
        accountId,
        accounts,
      }
    }

    if (typeof state.queryError === 'string' && state.queryError !== '') {
      return {
        engaged: true,
        code: 'circuit_unreadable',
        message: `读不到账户 ${accountId} 的熔断状态：${state.queryError}`,
        accountId,
        accounts,
      }
    }

    if (state.tripped === true) {
      const reason = typeof state.reason === 'string' ? state.reason : ''
      const isKill = reason.startsWith(KILL_REASON_PREFIX)
      return {
        engaged: true,
        code: isKill ? 'kill_switch_engaged' : 'circuit_tripped',
        message: `账户 ${accountId} 的熔断（原因：${reason}）还没解除`,
        accountId,
        accounts,
      }
    }
  }

  // ④ 全部账户都没熔断。
  return { engaged: false, accounts }
}

/** 把未知异常转成可读文本。 */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export interface KillTripRow {
  client_id: string
  ad_account_id: string
  kind: 'trip'
  reason: string
  sticky: true
  evidence: { source: 'activation_kill'; by: string; at: string }
  actor: string
}

export function buildKillTripRows(input: {
  clientId: string
  accountIds: readonly string[]
  reason: string
  actorEmail: string
  at: Date
}): { ok: true; rows: KillTripRow[] } | { ok: false; error: string } {
  const reason = input.reason.trim()
  if (reason === '') return { ok: false, error: '必须写原因' }
  if (reason.length > 500) return { ok: false, error: '原因太长' }

  const email = input.actorEmail.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
    return { ok: false, error: '拿不到操作人邮箱' }
  }

  const clientId = input.clientId.trim()
  if (clientId === '') return { ok: false, error: '拿不到客户 ID' }

  // 按原样去重（不改写账户号）。
  const seen = new Set<string>()
  const accountIds: string[] = []
  for (const raw of input.accountIds) {
    if (raw.trim() === '') continue
    if (seen.has(raw)) continue
    seen.add(raw)
    accountIds.push(raw)
  }
  if (accountIds.length === 0) return { ok: false, error: '没有可操作的账户' }

  const at = input.at.toISOString()
  const rows: KillTripRow[] = accountIds.map((adAccountId) => ({
    client_id: clientId,
    ad_account_id: adAccountId,
    kind: 'trip',
    reason: `${KILL_REASON_PREFIX}: ${reason}`,
    sticky: true,
    evidence: { source: 'activation_kill', by: email, at },
    actor: `human:${email}`,
  }))

  return { ok: true, rows }
}
