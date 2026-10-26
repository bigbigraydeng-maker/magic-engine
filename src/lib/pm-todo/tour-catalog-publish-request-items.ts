/**
 * 今日待办里的「员工改了团目录，等你上架」。
 *
 * 数据来源：团目录的「上架请求」表（通过 publish-request-feed 这个唯一允许的读取口）。
 * 员工在团目录里改完东西会点「请求上架」，但没人看得见——所以要在待办里摆出来：
 * 不上架，这些修改不会对外生效。
 *
 * 拉模式：直接查库，事件丢了、进程重启了，待办照样出得来。
 * 注意：生产库可能还没有这张表，读失败时只告警、绝不抛错，不能拖垮整个待办任务。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { listOpenPublishRequests, type OpenPublishRequest } from '@/lib/tour-catalog/publish-request-feed'

const NZ_TZ = 'Pacific/Auckland'
const NOTE_MAX = 200
const UNKNOWN_TIME = '时间未知'
const NO_NOTE = '（没有写备注）'

export type TourPublishRequestItemKind = 'tour_publish_requested'

/** Stable entry page for one client's catalog (login required, so it is an entry page, not a deep link). */
export function tourCatalogHref(clientId: string): string {
  return `https://app.magicengine.com.au/dashboard/clients/${clientId}/tour-catalog`
}

/** "10月10日 14:05" in Pacific/Auckland; '' when the timestamp cannot be parsed. */
export function formatRequestTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NZ_TZ,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')}`
}

/** The note, trimmed and cut to 200 characters, or a placeholder when empty. */
function noteText(note: string): string {
  const trimmed = note.trim()
  if (trimmed === '') return NO_NOTE
  return trimmed.slice(0, NOTE_MAX)
}

export function buildPublishRequestItem(request: OpenPublishRequest, clientName: string): ManualItem {
  const time = formatRequestTime(request.createdAt) || UNKNOWN_TIME
  const note = noteText(request.note)
  return {
    kind: 'tour_publish_requested',
    client_id: request.clientId,
    client_name: clientName,
    what:
      `${clientName} 的员工 ${request.requestedBy} 请你把团目录的修改上架（${time}）：${note}。` +
      '不上架，这些修改不会对外生效。',
    how: '打开团目录，点［查看并上架］核对后上架。',
    href: tourCatalogHref(request.clientId),
  }
}

/** Keep only the newest request per client, ordered by createdAt ascending. */
function newestPerClient(requests: OpenPublishRequest[]): OpenPublishRequest[] {
  const byClient = new Map<string, OpenPublishRequest>()
  for (const request of requests) {
    byClient.set(request.clientId, request)
  }
  return [...byClient.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function pushTourCatalogPublishRequestItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (clientId: string) => string,
): Promise<void> {
  let requests: OpenPublishRequest[]
  try {
    requests = await listOpenPublishRequests(supabase)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[tour-catalog-publish-request-items] 上架请求读取失败（不阻塞其他待办）:', message)
    return
  }
  for (const request of newestPerClient(requests)) {
    items.push(buildPublishRequestItem(request, nameOf(request.clientId)))
  }
}
