/**
 * 客户自有素材 → 出片底图池（2026-08-02）。
 *
 * 补的是一个真实断点：客户上传的素材（`client_assets`，CTS 44 张 / Oztop 37 张，
 * 且已全部过 AI 视觉分析）**一张都进不了出片**。原因是 `evaluate.ts` 的
 * `sourceImagePool` 只收 `is_ai_transformed=true` 的片段 —— 那条规则是为
 * **抓来的第三方图**设的防版权闸，客户自己的素材被它一并挡在门外。
 * 结果：CTS 出片可用底图 = 0，工厂只能拿占位帧硬凑，正是 PM 退回
 * 「画面跑题（19 秒出现地中海小镇）」那条片的成因。
 *
 * 🔴 为什么客户自有素材不需要 AI 改写就能用（与防版权红线不冲突）
 *   那条红线针对的是「我们主动去 Pinterest/全网抓来的**别人的作品**」——
 *   原图进成片等于把版权风险发给客户。客户自己提供的素材性质完全不同：
 *   素材是客户给的，用途是给客户做片，版权责任在客户侧，这是正常代理关系。
 *   改写它反而有害 —— 客户真实产品被 AI 重绘就不真了。
 *
 * 🔴 但它仍**不能给真价背书**
 *   免登录上传链接不过期、可无限转发（见 client-upload-token.ts），
 *   客户完全可能传网图进来。所以这里出去的图一律只当 i2v 底图（产物是
 *   `b_generated`），真价红线仍只认 FDE 逐张确认过的素材。本模块不碰那条闸。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { projectOrFilter } from '@/lib/clients/project-scope'

/** 每个客户最多取这么多张当底图池 —— 够轮换即可，不必全量。 */
const MAX_ASSETS = 40
/** 视觉分析给的质量分低于此值不进池（1-10）。 */
const MIN_QUALITY = 5

/**
 * ⚠️ `quality_score` 是 `vision_metadata` 里的一个键，**不是表上的列**。
 * 首版按顶层列写，PostgREST 直接报「column does not exist」→ 错误被吞 →
 * 整个功能静默返回空。而单测用的是自己编的行形状，测试全绿、生产全空。
 * 教训：纯函数测试保证不了查询正确，行形状必须照着真实 schema 写。
 */
export interface AssetRow {
  storage_url: string | null
  vision_metadata?: unknown
}

function visionOf(row: AssetRow): Record<string, unknown> {
  return (row.vision_metadata ?? {}) as Record<string, unknown>
}

/** 视觉分析给的 1-10 分；缺失返回 null（老数据不该被误伤）。 */
function qualityOf(row: AssetRow): number | null {
  const raw = visionOf(row).quality_score
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * 纯函数：把素材行筛成可用底图 URL。
 *
 * 排除视频行 —— `vision_metadata.kind='video'` 的行没有 scene/objects，
 * 且 i2v 要的是静图，喂视频进去会失败（魏征 M6 同源问题）。
 */
export function selectAssetUrls(rows: AssetRow[], max: number = MAX_ASSETS): string[] {
  return rows
    .filter((r) => {
      if (!r.storage_url) return false
      if (visionOf(r).kind === 'video') return false
      const q = qualityOf(r)
      return q == null || q >= MIN_QUALITY
    })
    .sort((a, b) => (qualityOf(b) ?? 0) - (qualityOf(a) ?? 0))
    .map((r) => r.storage_url as string)
    .slice(0, max)
}

/**
 * 读该客户自有素材的公开地址，供 i2v 当底图。
 *
 * 查询恒带 `client_id` —— 客户素材永不跨客户（PM 2026-08-02 拍板：
 * 客户实拍绝不共用）。失败返回空数组，出片走原有降级路径。
 */
export async function loadClientAssetPool(
  clientId: string,
  supabase: SupabaseClient = supabaseAdmin,
  /** 出片对象楼盘。中介客户(Roman)名下多个楼盘时必须给,否则会跨楼盘串用。 */
  projectId: string | null = null,
): Promise<string[]> {
  let q = supabase
    .from('client_assets')
    .select('storage_url, vision_metadata')
    .eq('client_id', clientId)
    .eq('status', 'analyzed')
    .is('archived_at', null)

  // 楼盘级隔离(PM 2026-08-03):做某个楼盘时,只能用该楼盘的 + 不属于任何楼盘的素材;
  // 不做楼盘时,楼盘专属素材一律不给 —— 别把 A 楼盘的房子放进 B 楼盘或别的客户的片子。
  const orFilter = projectOrFilter(projectId)
  q = orFilter ? q.or(orFilter) : q.is('project_id', null)

  const { data, error } = await q.limit(MAX_ASSETS * 3)

  if (error || !data) return []
  return selectAssetUrls(data as AssetRow[])
}
