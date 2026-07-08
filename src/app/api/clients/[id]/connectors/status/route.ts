/**
 * GET /api/clients/[id]/connectors/status
 *
 * Returns the list of connectors with live status from the client_connectors
 * table. Falls back to all-not_connected defaults if the client has no rows.
 *
 * Security: session-cookie via requireOnboardingClientAccess — self-serve
 * clients need to see their own connector status during onboarding.
 * Isolation is unchanged (caller can only read their own client's rows).
 * Reference: ROADMAP.md P8.10.S0.22 · Phase B $990 self-serve onboarding
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

// Connector catalogue — anchors must match the connectors page constants.
const CONNECTOR_CATALOGUE = [
  {
    anchor: 'gsc',
    name: 'Google Search Console',
    emoji: '🔎',
    description: '客户网站的真实搜索表现：展示量、点击量、关键词排名',
    setupHint: '点击"立即配置"，用客户的 Google 账号授权后填入 GSC Property URL。接入后，张骞将用真实搜索数据替代 SEMrush 估算。',
  },
  {
    anchor: 'google-ads',
    name: 'Google 广告',
    emoji: '🔵',
    description: '通过 Google Ads 透明度中心扫描，获取在投广告数量、格式及地区分布（公开数据，无需 API 凭证）',
    setupHint: '无需提供 API 凭证。保存后张骞将自动扫描 Google 广告透明度中心，分析品牌当前 Google 广告投放情况。',
  },
  {
    anchor: 'gbp',
    name: 'Google 商业档案 (GBP)',
    emoji: '📍',
    description: '本地搜索表现、地图曝光、客户评价、营业信息',
    setupHint: '在下方输入 Google 商业档案 URL，保存后张骞将自动补跑深度评价数据。',
  },
  {
    anchor: 'meta-ads',
    name: 'Facebook 主页',
    emoji: '📊',
    description: '公开粉丝数、互动率、Meta 广告库投放记录',
    setupHint: '添加客户的 Facebook 主页 URL，张骞将自动抓取公开粉丝数、互动率及 Meta 广告库投放记录（无需 API token）。',
  },
  {
    anchor: 'reviews',
    name: '第三方评价平台',
    emoji: '⭐',
    description: 'ProductReview, Trustpilot, Yelp 等的评分、评论、回复率',
    setupHint: '当前张骞通过 Jina/Apify 抓取公开数据，无需额外授权。',
  },
  {
    anchor: 'ga4',
    name: 'Google Analytics 4',
    emoji: '📈',
    description: '网站流量、转化、用户路径、归因数据',
    setupHint: '通过 GA4 Data API 接入。接入后，飞轮归因直接从 GA4 拉取，不再依赖估算。',
  },
  {
    anchor: 'publer',
    name: 'Publer 发布器',
    emoji: '🚀',
    description: '社媒内容统一调度、定时发布、跨平台分发',
    setupHint: 'Magic Engine 自有 Publer workspace 已连接。客户社媒账号需在 Publer 后台单独授权。',
    docsUrl: 'https://publer.io',
  },
  {
    anchor: 'social',
    name: '客户社媒账号',
    emoji: '📱',
    description: 'Instagram Business / Facebook Page / TikTok Business 等',
    setupHint: '客户社媒账号通过 Publer 授权后，Magic Engine 即可读取真实指标和调度发布。',
  },
]

interface ConnectorRow {
  anchor: string
  status: string
  config: Record<string, unknown> | null
  connected_at: string | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { data: rows, error } = await supabaseAdmin
    .from('client_connectors')
    .select('anchor, status, config, connected_at')
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const statusMap = new Map<string, ConnectorRow>(
    (rows as ConnectorRow[]).map(r => [r.anchor, r]),
  )

  const connectors = CONNECTOR_CATALOGUE.map(c => {
    const row = statusMap.get(c.anchor)
    const status = row?.status ?? 'not_connected'
    return {
      anchor: c.anchor,
      name: c.name,
      emoji: c.emoji,
      description: c.description,
      setupHint: c.setupHint,
      docsUrl: (c as { docsUrl?: string }).docsUrl,
      status: status as 'connected' | 'not_connected' | 'partial',
      statusLabel: status === 'connected' ? '已连接' : status === 'partial' ? '部分配置' : '未连接',
      connectedAt: row?.connected_at ?? null,
      config: row?.config ?? null,
    }
  })

  return NextResponse.json({ success: true, connectors })
}
