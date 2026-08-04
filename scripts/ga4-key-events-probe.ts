/**
 * 查一个客户的「客资数」是怎么来的 —— 值不值得信，以及不可信时是哪里在乱响。
 *
 * 起因 2026-08-04：CTS 目标《Best of China 团报名》目标值 30、当前 344。
 * 查下来只有一个关键事件 generate_lead，28 天 341 次，而真正开始填表只有 86 次，
 * 且它在关于我们、签证指南这种没有表单的页面上也在响 —— 触发条件太宽。
 *
 * 判定逻辑在 src/lib/strategy/leads-sanity.ts（今日待办也在用同一份），
 * 这个脚本只是把「哪些页面在乱响」这层额外的证据也打出来，方便定位。
 *
 * 跑法：CLIENT_ID=<uuid> npx tsx --env-file=.env.local scripts/ga4-key-events-probe.ts
 */

import { getValidAccessToken } from '@/lib/google-oauth/client'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGa4KeyEventBreakdown } from '@/lib/ga4/client'
import { judgeLeadsSanity } from '@/lib/strategy/leads-sanity'

const CLIENT_ID = process.env.CLIENT_ID ?? 'c0000000-0000-0000-0000-000000000000' // 默认 CTS

async function main() {
  const { data: conn } = await supabaseAdmin
    .from('client_connectors')
    .select('config')
    .eq('client_id', CLIENT_ID)
    .eq('anchor', 'ga4')
    .maybeSingle<{ config: { property_id?: string } | null }>()
  const propertyId = conn?.config?.property_id
  if (!propertyId) { console.error('❌ 这个客户没连统计后台'); return }

  const breakdown = await fetchGa4KeyEventBreakdown(propertyId, CLIENT_ID)
  if (!breakdown) { console.error('❌ 拿不到数据（授权过期？）'); return }

  console.log('关键事件构成:', breakdown.keyEventsByName)
  console.log('同期开始填表:', breakdown.formStarts, '次')
  const verdict = judgeLeadsSanity(breakdown)
  console.log('判定:', verdict.trustworthy ? '✅ 可信' : `❌ 不可信 —— ${verdict.humanReason}`)
  if (verdict.trustworthy) return

  // 额外证据：那个事件到底在哪些页面响 —— 定位是哪条触发规则太宽
  const token = await getValidAccessToken(CLIENT_ID)
  if (!token) return
  for (const evName of Object.keys(breakdown.keyEventsByName)) {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: evName } } },
          orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
          limit: 15,
        }),
      },
    )
    if (!res.ok) continue
    const j = (await res.json()) as {
      rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>
    }
    console.log(`\n「${evName}」在哪些页面响的:`)
    for (const r of j.rows ?? []) {
      console.log('   ', r.metricValues[0].value.padStart(6), r.dimensionValues[0].value.slice(0, 70))
    }
  }
}

main().catch((e) => console.error(e))
