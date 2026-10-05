/**
 * Instagram 交叉发布的生产 store —— 薄封装 supabaseAdmin。
 *
 * 单独成文件的原因:主流程文件只依赖 CrosspostStore 接口,测试里全部注入内存实现,
 * 这里是唯一碰数据库的地方。supabaseAdmin 只在函数体内引用,不在模块加载时触发副作用。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { PublishTarget } from '../types'
import type { CrosspostCandidate, CrosspostStore } from './instagram-crosspost'

/** 把 unknown 收窄成普通对象（非数组、非 null）。 */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** 从数据库行构造候选；非对象字段一律退化为 {}。 */
function rowToCandidate(row: Record<string, unknown>): CrosspostCandidate {
  const masterBriefId = row.master_brief_id
  const angle = row.angle
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    master_brief_id: typeof masterBriefId === 'string' ? masterBriefId : null,
    angle: typeof angle === 'string' ? angle : null,
    brief: asPlainObject(row.brief) ?? {},
    output: asPlainObject(row.output) ?? {},
    review_ref: asPlainObject(row.review_ref) ?? {},
    published_ref: asPlainObject(row.published_ref) ?? {},
    updated_at: String(row.updated_at),
  }
}

/** 校验 Publer Instagram 账号 id 的格式。 */
const PUBLER_ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/** 从 factory_config 中解析 Instagram 账号 id；没配/不合法返回 null(不查品牌,没配的客户不该被品牌缺失拖累)。 */
function parseInstagramAccountId(factoryConfig: unknown): string | null {
  const cfg = asPlainObject(factoryConfig)
  if (cfg === null) return null
  const raw = asPlainObject(cfg.instagram_target)
  if (raw === null) return null
  if (raw.platform !== 'publer') return null
  if (raw.publer_provider !== 'instagram') return null
  const accountId = raw.publer_account_id
  if (typeof accountId !== 'string') return null
  return PUBLER_ACCOUNT_ID_RE.test(accountId) ? accountId : null
}

/**
 * 生产 store：薄封装 supabaseAdmin。supabaseAdmin 只在函数体内引用，
 * 避免在模块导入时触发副作用。
 */
export function createSupabaseCrosspostStore(): CrosspostStore {
  return {
    async listCandidates(limit: number): Promise<CrosspostCandidate[]> {
      const { data, error } = await supabaseAdmin
        .from('content_work_orders')
        .select(
          'id, client_id, master_brief_id, angle, brief, output, review_ref, published_ref, updated_at',
        )
        .eq('status', 'published')
        .eq('published_ref->>platform', 'facebook')
        .order('updated_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      const rows = Array.isArray(data) ? data : []
      return rows.map((row) => rowToCandidate(row as Record<string, unknown>))
    },

    async loadInstagramTarget(clientId: string): Promise<PublishTarget | null> {
      const { data: clientRow, error: clientErr } = await supabaseAdmin
        .from('clients')
        .select('factory_config')
        .eq('id', clientId)
        .maybeSingle()
      if (clientErr) throw clientErr
      const accountId = parseInstagramAccountId(asPlainObject(clientRow)?.factory_config)
      if (accountId === null) return null

      // 防误发要用客户品牌名核对 Publer 账号名;缺品牌名 => 失败关闭(不猜)。
      const { data: brandRow, error: brandErr } = await supabaseAdmin
        .from('master_briefs')
        .select('brand_name')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (brandErr) throw brandErr
      const brandName = asPlainObject(brandRow)?.brand_name
      if (typeof brandName !== 'string' || brandName.length === 0) {
        throw new Error('缺品牌名,无法做防误发校验')
      }

      return {
        platform: 'publer',
        publer_account_id: accountId,
        publer_provider: 'instagram',
        client_id: clientId,
        expect_brand: brandName,
      }
    },

    async writeOutput(
      id: string,
      expectedUpdatedAt: string,
      output: Record<string, unknown>,
    ): Promise<{ ok: true; updatedAt: string } | { ok: false }> {
      const newUpdatedAt = new Date().toISOString()
      const { data, error } = await supabaseAdmin
        .from('content_work_orders')
        .update({ output, updated_at: newUpdatedAt })
        .eq('id', id)
        .eq('status', 'published')
        .eq('updated_at', expectedUpdatedAt)
        .select('updated_at')
        .maybeSingle()
      if (error) throw error
      const row = asPlainObject(data)
      if (row === null) return { ok: false }
      const returned = row.updated_at
      if (typeof returned !== 'string') return { ok: false }
      return { ok: true, updatedAt: returned }
    },
  }
}
