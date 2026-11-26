/**
 * Pause one ad after the winner card was already confirmed.
 * There is no second card and no second click.
 * Guards run before the only pause. A bad read-back is not written again.
 */

import { pauseAd, readAdPlacement } from '@/lib/meta/ads-manager'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

export interface WinnerPauseInput {
  readonly clientId: string
  readonly adId: string
  readonly adAccountId: string
  readonly adsetId: string
}

export interface WinnerPauseResult {
  readonly ok: boolean
  readonly wroteMeta: boolean
  readonly readback: string | null
  readonly reason: string
}

export interface WinnerPausePorts {
  token(clientId: string): Promise<string | null>
  accounts(clientId: string): Promise<{ ids: string[]; error?: string }>
  read(adId: string, token: string): Promise<{ status: string | null; accountId: string | null; adsetId: string | null } | null>
  pause(adId: string, token: string): Promise<void>
}

export async function pauseConfirmedWinnerAd(
  input: WinnerPauseInput,
  ports: WinnerPausePorts = defaultPorts(),
): Promise<WinnerPauseResult> {
  const token = await ports.token(input.clientId)
  if (!token) return missed('读不到广告账户的钥匙，没有暂停。')
  const blocked = await guard(input, token, ports)
  if (blocked) return missed(blocked)
  try {
    await ports.pause(input.adId, token)
  } catch {
    return missed('暂停没有写成，已标失败，没有再写一次。')
  }
  const after = await ports.read(input.adId, token).catch(() => null)
  if (after?.status !== 'PAUSED') {
    return { ok: false, wroteMeta: true, readback: after?.status ?? null, reason: '回读和暂停不一致，已标失败，没有再写一次。' }
  }
  return { ok: true, wroteMeta: true, readback: 'PAUSED', reason: '已暂停，回读是暂停。' }
}

function defaultPorts(): WinnerPausePorts {
  return {
    token: getMetaTokenForClient,
    accounts: getRegisteredAccountIds,
    read: async (adId, token) => {
      const row = await readAdPlacement(adId, token)
      if (!row) return null
      return { status: row.status, accountId: row.accountId, adsetId: row.adsetId }
    },
    pause: pauseAd,
  }
}

async function guard(input: WinnerPauseInput, token: string, ports: WinnerPausePorts): Promise<string | null> {
  const accounts = await ports.accounts(input.clientId).catch(() => ({ ids: [] as string[], error: 'unread' }))
  if (accounts.error) return '这个客户的广告账户读不到，没有暂停。'
  const live = await ports.read(input.adId, token).catch(() => null)
  if (!live) return '这条广告现在读不到，没有暂停。'
  if (!sameAccount(live.accountId, input.adAccountId) || !listed(accounts.ids, input.adAccountId)) {
    return '这条广告不在这个客户的账户里，没有暂停。'
  }
  if (live.adsetId !== input.adsetId) return '这条广告已经不在原来的广告组里，没有暂停。'
  if (live.status !== 'ACTIVE') return '这条广告已经不是在投，没有暂停。'
  return null
}

function listed(ids: readonly string[], accountId: string): boolean {
  return ids.some((id) => sameAccount(id, accountId))
}

function sameAccount(left: string | null, right: string): boolean {
  if (!left) return false
  const a = left.replace(/^act_/, '')
  const b = right.replace(/^act_/, '')
  return a.length > 0 && a === b
}

function missed(reason: string): WinnerPauseResult {
  return { ok: false, wroteMeta: false, readback: null, reason }
}
