/**
 * 真实数据的适配器：调读接口 /api/clients/[id]/crm/auto-letters，再交给 api-mapping 转成页面的形状。
 * 只读（两个 GET），没有任何会写、会发的调用。
 *
 * 失败时抛的都是中文句子（页面原样显示）：没权限 / 没找到 / 暂时读不到 / 内容格式不对；
 * 浏览器自己的英文报错在 loadErrorText 里统一变成「网络出错」。
 */

import type { AutoLetterDetail, AutoLettersList } from '@/lib/messaging/letters/types'
import type { AutoSendAdapter } from './adapter'
import { mapAutoLetterDetail, mapAutoLettersList } from './api-mapping'

export type FetchLike = (url: string) => Promise<Response>

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const NOT_FOUND_TEXT = '没有找到这封信，可能它已经不在计划里了。'
const UNREADABLE_TEXT = '暂时读不到，请稍后再试。'
const BAD_SHAPE_TEXT = '读到的内容格式不对，请告诉 Magic Engine。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 节奏：null（没配）或带着「订的时候离出发超过几个月」。 */
function isCadence(value: unknown): boolean {
  return value === null || (isRecord(value) && typeof value.firstMonth === 'number')
}

function isList(value: unknown): value is AutoLettersList {
  return (
    isRecord(value) &&
    Array.isArray(value.depositLetters) &&
    Array.isArray(value.scheduledLetters) &&
    Array.isArray(value.pastLetters) &&
    Array.isArray(value.tourGroups) &&
    typeof value.totalDistinctLetters === 'number' &&
    isCadence(value.cadence)
  )
}

function isDetail(value: unknown): value is AutoLetterDetail {
  return isRecord(value) && isRecord(value.letter) && isRecord(value.letter.counts) && Array.isArray(value.recipients)
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function failureText(status: number, body: unknown): string {
  if (status === 401 || status === 403) return NO_ACCESS_TEXT
  if (status === 404) return NOT_FOUND_TEXT
  const said = isRecord(body) && typeof body.error === 'string' ? body.error : ''
  return /[一-鿿]/.test(said) ? said : UNREADABLE_TEXT
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchImpl(url)
  const body = await readJson(res)
  if (!res.ok) throw new Error(failureText(res.status, body))
  return body
}

export function createHttpAdapter(
  clientId: string,
  fetchImpl: FetchLike = (url) => fetch(url, { headers: { Accept: 'application/json' } }),
): AutoSendAdapter {
  const base = `/api/clients/${encodeURIComponent(clientId)}/crm/auto-letters`
  return {
    async loadOverview() {
      const body = await getJson(fetchImpl, base)
      if (!isList(body)) throw new Error(BAD_SHAPE_TEXT)
      return mapAutoLettersList(body)
    },
    async loadLetterDetail(letterId: string) {
      const body = await getJson(fetchImpl, `${base}/${encodeURIComponent(letterId)}`)
      if (!isDetail(body)) throw new Error(BAD_SHAPE_TEXT)
      return mapAutoLetterDetail(body)
    },
  }
}
