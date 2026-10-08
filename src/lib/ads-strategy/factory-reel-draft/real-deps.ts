/**
 * Factory Reel 自动起草广告 —— 生产环境唯一的 I/O 接线层。
 *
 * 这里是整个特性里唯一真正碰数据库 / Meta 的文件：把 run.ts 里声明的
 * RunDeps 契约接到真实的 supabase / token-manager / graph-io 上。
 * 流水线本身的逻辑全部在 run.ts，用假依赖做测试；本文件不做任何决策，
 * 只负责「把外部调用包成契约要求的形状」——任何抛错或数据库错误都收敛成
 * 契约里约定的安全值（null / { ok:false }），绝不外抛、绝不猜测。
 *
 * 安全边界：本文件不 import 任何 activate / approve / 开启广告的模块，
 * 因此这里没有任何路径能把一条广告从暂停切成开启。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFactoryReelDraftConfig } from './config'
import { createGraphGet, probeMetaToken, type FetchLike } from './graph-io'
import type { RunDeps, ClientMetaFacts } from './run'
import type { ReelWorkOrderRow } from './gates'
import { createDraftForApproval } from '../draft-and-gate'
import { loadDraftRedlines } from '../draft-redlines'
import { resolveMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'

/** 把任意 JSON 值收敛成「普通对象或 null」；数组 / 原始值一律 null。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 非字符串一律 null。 */
function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 广告账号 ID 归一化：去空白、转小写、去掉前导 'act_'。 */
function normalizeAdAccountId(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('act_') ? trimmed.slice(4) : trimmed
}

export function buildRunDeps(supabase: SupabaseClient): RunDeps {
  const fetchLike: FetchLike = (url, init) => fetch(url, init)

  return {
    supabase,
    nowMs: () => Date.now(),

    loadConfig: (clientId) => loadFactoryReelDraftConfig(supabase, clientId),

    loadWorkOrder: async (workOrderId) => {
      const { data, error } = await supabase
        .from('content_work_orders')
        .select('id, client_id, status, brief, output, review_ref, published_ref')
        .eq('id', workOrderId)
        .maybeSingle()
      if (error) return { ok: false, error: error.message }
      if (!data) return { ok: true, row: null }
      const row = data as Record<string, unknown>
      const built: ReelWorkOrderRow = {
        id: String(row.id),
        client_id: String(row.client_id),
        status: String(row.status),
        brief: asRecord(row.brief),
        output: asRecord(row.output),
        review_ref: asRecord(row.review_ref),
        published_ref: asRecord(row.published_ref),
      }
      return { ok: true, row: built }
    },

    loadRedlines: (clientId) => loadDraftRedlines(supabase, clientId),

    loadClientMeta: async (clientId) => {
      const { data, error } = await supabase
        .from('clients')
        .select('meta_ad_account_id, facebook_page_id, country, industry')
        .eq('id', clientId)
        .maybeSingle()
      if (error || !data) return null
      const row = data as Record<string, unknown>
      const meta: ClientMetaFacts = {
        adAccountId: asStringOrNull(row.meta_ad_account_id),
        facebookPageId: asStringOrNull(row.facebook_page_id),
        country: asStringOrNull(row.country),
        industry: asStringOrNull(row.industry),
      }
      return meta
    },

    isAdAccountRegistered: async (clientId, adAccountId) => {
      const { data, error } = await supabase
        .from('client_meta_ad_accounts')
        .select('ad_account_id')
        .eq('client_id', clientId)
      if (error) return null
      const target = normalizeAdAccountId(adAccountId)
      const rows = (data ?? []) as { ad_account_id: unknown }[]
      return rows.some(
        (r) => typeof r.ad_account_id === 'string' && normalizeAdAccountId(r.ad_account_id) === target,
      )
    },

    resolveToken: async (clientId) => {
      try {
        const r = await resolveMetaTokenForClient(clientId)
        return r ? { token: r.token, source: String(r.source) } : null
      } catch {
        return null
      }
    },

    probeToken: (token) => probeMetaToken(fetchLike, token),

    loadPageToken: async (clientId, pageId) => {
      try {
        return await getStoredPageToken(clientId, pageId)
      } catch {
        return null
      }
    },

    graphGetWith: (pageToken) => createGraphGet(fetchLike, pageToken),

    createDraft: createDraftForApproval,
  }
}
