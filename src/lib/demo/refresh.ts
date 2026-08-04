import { supabaseAdmin } from '@/lib/supabase'

/**
 * Demo 客户每日刷新。
 *
 * 演示账号最怕的是「数据是死的」—— 朋友隔几天再登录，看到的还是同一批
 * 上周的数字，一眼就假。所以每天把时间序列整体前滚，让「本周」永远是今天，
 * 并给指标加一点点确定性抖动。
 *
 * 幂等：按 client_id 全删再重建，一天跑几次结果都一样。
 * 只动 DEMO_CLIENT_ID 这一个客户，绝不触碰真实客户数据。
 */

export const DEMO_CLIENT_ID = 'd0000000-0000-0000-0000-000000000001'

const KEYWORDS = [
  { kw: 'physio auckland',              startPos: 22, gain: 1.6, vol: 1900, url: '/' },
  { kw: 'acc physio auckland',          startPos: 17, gain: 1.4, vol: 720,  url: '/services/acc-physiotherapy' },
  { kw: 'sports physio north shore',    startPos: 14, gain: 1.3, vol: 390,  url: '/services/sports-injury' },
  { kw: 'back pain treatment auckland', startPos: 26, gain: 1.1, vol: 880,  url: '/services/acc-physiotherapy' },
  { kw: 'physiotherapist takapuna',     startPos: 9,  gain: 0.9, vol: 260,  url: '/' },
  { kw: 'post surgery physio auckland', startPos: 31, gain: 0.7, vol: 170,  url: '/services/post-surgical' },
]

const WEEKS = 8

/** 以日期为种子的确定性抖动，保证同一天多次运行结果一致 */
function jitter(seed: string, range: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return (Math.abs(h) % (range * 2 + 1)) - range
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

export interface RefreshResult {
  serpRows: number
  snapshotRows: number
  goalsUpdated: number
  pagesTouched: number
}

export async function refreshDemoClient(): Promise<RefreshResult> {
  const today = isoDate(new Date())

  /* ---- SEO 排名：滚动 8 周，末周落在今天 ---- */
  await supabaseAdmin.from('serp_rankings').delete().eq('client_id', DEMO_CLIENT_ID)

  const serpRows = KEYWORDS.flatMap(k =>
    Array.from({ length: WEEKS }, (_, w) => {
      const date = isoDate(daysAgo((WEEKS - 1 - w) * 7))
      const drift = Math.round(w * k.gain)
      const noise = jitter(`${k.kw}-${date}`, 1)
      return {
        client_id: DEMO_CLIENT_ID,
        keyword: k.kw,
        position: Math.max(1, k.startPos - drift + noise),
        search_volume: k.vol,
        url: `https://harbourlinephysio.co.nz${k.url}`,
        date,
      }
    })
  )
  const { error: serpErr } = await supabaseAdmin.from('serp_rankings').insert(serpRows)
  if (serpErr) throw new Error(`serp_rankings 写入失败：${serpErr.message}`)

  /* ---- AI 可见度：同样滚动 8 周 ---- */
  await supabaseAdmin.from('ai_visibility_snapshots').delete().eq('client_id', DEMO_CLIENT_ID)

  const snapshotRows = Array.from({ length: WEEKS }, (_, w) => {
    const weekOf = isoDate(daysAgo((WEEKS - 1 - w) * 7))
    const avgRank = Number((8.4 - w * 0.55 + jitter(`ai-${weekOf}`, 1) * 0.1).toFixed(1))
    return {
      client_id: DEMO_CLIENT_ID,
      week_of: weekOf,
      avg_rank: avgRank,
      mentions_count: 2 + w * 2 + (jitter(`m-${weekOf}`, 1) > 0 ? 1 : 0),
      total_runs: 20,
      models_covered: w < 3 ? ['gpt-4o', 'claude'] : ['gpt-4o', 'claude', 'perplexity', 'gemini'],
      ranking_table: {
        'Harbourline Physio': avgRank,
        'Physio Plus': Number((2.1 + w * 0.15).toFixed(1)),
        'North Shore Physio': Number((4.8 - w * 0.05).toFixed(1)),
      },
    }
  })
  const { error: snapErr } = await supabaseAdmin.from('ai_visibility_snapshots').insert(snapshotRows)
  if (snapErr) throw new Error(`ai_visibility_snapshots 写入失败：${snapErr.message}`)

  /* ---- 目标进度：向目标缓慢推进，但不越过目标值 ---- */
  const { data: goals } = await supabaseAdmin
    .from('goals')
    .select('id, baseline_value, target_value, current_value')
    .eq('client_id', DEMO_CLIENT_ID)

  let goalsUpdated = 0
  for (const g of goals ?? []) {
    const span = Number(g.target_value) - Number(g.baseline_value)
    const step = span / 90 // 约 90 天走完
    const next = Math.min(Number(g.target_value), Number(g.current_value) + step)
    const { error } = await supabaseAdmin
      .from('goals')
      .update({ current_value: Number(next.toFixed(1)), current_value_fetched_at: new Date().toISOString() })
      .eq('id', g.id)
    if (!error) goalsUpdated++
  }

  /* ---- 网站抓取时间：保持「最近抓过」的观感 ---- */
  const { data: pages } = await supabaseAdmin
    .from('client_site_pages')
    .update({ last_crawled_at: new Date().toISOString(), crawled_at: new Date().toISOString() })
    .eq('client_id', DEMO_CLIENT_ID)
    .select('id')

  return {
    serpRows: serpRows.length,
    snapshotRows: snapshotRows.length,
    goalsUpdated,
    pagesTouched: pages?.length ?? 0,
  }
}
