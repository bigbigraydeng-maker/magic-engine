/**
 * 素材补库调度器 —— 给 stock-pipeline 接上调用方。
 *
 * 为什么必须有:对抗审查(2026-07-25)最狠的一条 —— stock-pipeline **零调用方**,
 * 而它自己的头注正在批评上一层犯的同一个错(「抓+筛做完了但没有任何调用方 =
 * 有配方没进厨房」)。库里那 6 张 CTS 静图是手工灌的:全部同一微秒 created_at、
 * 同一个搜索词。没有任何机制会补第 7 张 —— 素材池被永久钉死。
 *
 * 后果链(逐段可查):
 *   池子不补 → evaluate 的 sourceImagePool 恒为空(除 CTS 那 6 张)
 *   → strategist 填 source_image_url: null
 *   → worker 退回同一张 seed/cts_source.jpg
 *   = 正是这一串改动想治的「所有 AI 画面从同一张图长出来」。
 *
 * 🔴 花钱边界:抓取按张计费(≈$0.002/张)。所以:
 * - 只给**配了 factory_config** 的客户抓(不给全表客户跑)
 * - 每客户每次最多 3 个搜索词 × 12 张,且 stock-pipeline 侧还有 HARD_MAX
 * - 素材够用就跳过(见 STOCK_TARGET):池子不是越大越好,够轮换就行,省钱也省选片噪音
 */

import { supabaseAdmin } from '@/lib/supabase'
import { harvestAndIngestForClient } from './stock-pipeline'

/** 静图池够这个数就不再抓 —— 8 段配方轮换绰绰有余,再多是浪费 */
const STOCK_TARGET = 24

export interface StockRefillOutcome {
  client_id: string
  client_name: string
  /** skipped_enough=池子够用 / skipped_no_brief=没品牌资料拼不出搜索词 / refilled / error */
  result: 'refilled' | 'skipped_enough' | 'skipped_no_brief' | 'error'
  before: number
  ingested?: number
  detail?: string
}

/**
 * 遍历配了 factory_config 的客户,给素材池不足的补货。
 * 单客户失败不拖累其他客户(跟 order-scheduler 同一纪律)。
 */
export async function runStockRefill(): Promise<{ scanned: number; outcomes: StockRefillOutcome[] }> {
  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, factory_config, industry')
    .not('factory_config', 'is', null)
  if (error) throw new Error(`clients query failed: ${error.message}`)

  // 只给真正在用工厂的客户抓:factory_config 是空对象的不算
  const targets = (clients ?? []).filter(
    (c) => Object.keys((c.factory_config ?? {}) as Record<string, unknown>).length > 0,
  )

  const outcomes: StockRefillOutcome[] = []

  for (const c of targets) {
    const clientId = c.id as string
    const clientName = (c.name as string) ?? clientId
    try {
      // 现有静图数:只数抓来的(origin=stock_harvest),客户自己传的真素材不算在内 ——
      // 那些是 a_real 的候选,不该因为客户传得多就停止补氛围图
      const { count } = await supabaseAdmin
        .from('video_clips')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'active')
        .eq('source_meta->>origin', 'stock_harvest')
      const before = count ?? 0

      if (before >= STOCK_TARGET) {
        outcomes.push({ client_id: clientId, client_name: clientName, result: 'skipped_enough', before })
        continue
      }

      // 搜索词只从品牌资料溯源(跟角度溯源同一条纪律),没资料就不抓 —— 绝不瞎编词去花钱
      const { data: brief } = await supabaseAdmin
        .from('master_briefs')
        .select('content_pillars, core_proposition, brand_name, tagline')
        .eq('client_id', clientId)
        .or('status.eq.active,is_active.eq.true')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      const pillars = (brief?.content_pillars ?? null) as Array<{ name?: string } | string> | null
      const core = (brief?.core_proposition ?? null) as string | null
      if (!pillars?.length && !core) {
        outcomes.push({ client_id: clientId, client_name: clientName, result: 'skipped_no_brief', before })
        continue
      }

      // 🔴 业务锚点 + 禁区词:从客户资料推导,不硬编码任何客户。
      // 没有锚点就不抓 —— 2026-07-26 实测教训:只用抽象支柱名搜,CTS(中国游)抓回
      // 意大利/巴黎/希腊,Oztop(建材)抓回汽水和俄语教程,全是花钱买废图。
      const cfg = (c.factory_config ?? {}) as Record<string, unknown>
      const anchor = deriveAnchor(
        { ...cfg, __industry: (c as Record<string, unknown>).industry },
        brief as Record<string, unknown> | null,
      )
      if (!anchor) {
        outcomes.push({ client_id: clientId, client_name: clientName, result: 'skipped_no_brief', before,
          detail: '缺业务锚点(stock_anchor / industry),不抓以免买到废图' })
        continue
      }

      const results = await harvestAndIngestForClient({
        clientId,
        contentPillars: pillars,
        coreProposition: core,
        anchor,
        offTopic: Array.isArray(cfg.stock_off_topic)
          ? (cfg.stock_off_topic as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
      })
      const ingested = results.reduce((s, r) => s + r.result.ingested, 0)
      const errs = results.flatMap((r) => r.result.errors)
      outcomes.push({
        client_id: clientId,
        client_name: clientName,
        result: 'refilled',
        before,
        ingested,
        detail: errs.length ? `${errs.length} 张失败: ${errs[0]}` : undefined,
      })
    } catch (e) {
      outcomes.push({
        client_id: clientId,
        client_name: clientName,
        result: 'error',
        before: 0,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { scanned: targets.length, outcomes }
}

/**
 * 业务锚点:每条搜索词都要带上它,否则抓回来的图跟客户没关系。
 *
 * 优先级:
 * ① `factory_config.stock_anchor` —— PM 手填,最准(如 "china travel"、"timber flooring Sydney")
 * ② `clients.industry` —— 建档时就有的行业字段
 * 都没有则返回 null → 调度器跳过该客户,**不抓**。
 *
 * 为什么不从 core_proposition 自动提炼:那是一整段营销文案,提炼出来的词不可控,
 * 而搜错方向是要花钱的。宁可让 PM 填一次,也不要每周买一批废图。
 */
export function deriveAnchor(
  factoryConfig: Record<string, unknown>,
  brief: Record<string, unknown> | null,
): string | null {
  const explicit = factoryConfig.stock_anchor
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 60)
  const industry = factoryConfig.__industry
  if (typeof industry === 'string' && industry.trim()) return industry.trim().slice(0, 60)
  void brief
  return null
}
