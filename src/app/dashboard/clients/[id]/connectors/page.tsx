'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Connector {
  anchor: string
  name: string
  emoji: string
  description: string
  status: 'connected' | 'not_connected' | 'partial'
  statusLabel: string
  setupHint: string
  docsUrl?: string
}

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

export default function ConnectorsPage() {
  const params = useParams()
  const clientId = params.id as string

  const [loading, setLoading] = useState(true)
  const [connectors, setConnectors] = useState<Connector[]>([])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/clients/${clientId}/connectors/status`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        })
        if (res.ok) {
          const data = await res.json() as { connectors: Connector[] }
          setConnectors(data.connectors ?? [])
        } else {
          setConnectors(defaultConnectors)
        }
      } catch {
        setConnectors(defaultConnectors)
      } finally {
        setLoading(false)
      }
    })()
  }, [clientId])

  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← 返回
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">数据接入中心</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-sm text-indigo-900">
            <strong>把客户的官方数据源接到 Magic Engine</strong>——接入越多，诊断越准、归因越清晰、飞轮跑得越快。
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 rounded-xl bg-white border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {connectors.map(c => (
              <ConnectorCard
                key={c.anchor}
                connector={c}
                clientId={clientId}
                highlight={hash === c.anchor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectorCard({
  connector,
  clientId,
  highlight,
}: {
  connector: Connector
  clientId: string
  highlight: boolean
}) {
  const statusStyle = {
    connected:     'bg-green-100 text-green-700 border-green-200',
    partial:       'bg-yellow-100 text-yellow-700 border-yellow-200',
    not_connected: 'bg-gray-100 text-gray-600 border-gray-200',
  }[connector.status]

  return (
    <div
      id={connector.anchor}
      className={`rounded-xl border bg-white p-5 transition-all ${
        highlight ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">{connector.emoji}</span>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{connector.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{connector.description}</p>
          </div>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full border ${statusStyle}`}>
          {connector.statusLabel}
        </span>
      </div>

      <p className="text-xs text-gray-600 leading-relaxed mb-3 bg-gray-50 rounded-lg p-3">
        {connector.setupHint}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={`/dashboard/clients/${clientId}/connectors/${connector.anchor}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          {connector.status === 'connected' ? '管理连接' : '立即配置 →'}
        </Link>
        {connector.docsUrl && (
          <a
            href={connector.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-2"
          >
            查看文档 ↗
          </a>
        )}
      </div>
    </div>
  )
}

// Default connectors list — used as fallback if /api/clients/[id]/connectors/status isn't deployed yet
const defaultConnectors: Connector[] = [
  {
    anchor: 'gsc',
    name: 'Google Search Console',
    emoji: '🔎',
    description: '客户网站的真实搜索表现：展示量、点击量、关键词排名',
    status: 'not_connected',
    statusLabel: '未连接',
    setupHint: '在下方填入 GSC Property URL，并确保客户已将 magic-engine 服务账号加为验证用户。接入后，张骞用真实 GSC 数据替代 SEMrush 估算。',
  },
  {
    anchor: 'google-ads',
    name: 'Google 广告',
    emoji: '🔵',
    description: '通过 Google Ads 透明度中心扫描在投广告数量、格式及地区（公开数据，无需凭证）',
    status: 'not_connected',
    statusLabel: '未连接',
    setupHint: '无需 API 凭证。保存后张骞将自动扫描 Google 广告透明度中心，分析品牌的 Google 广告投放情况。',
  },
  {
    anchor: 'gbp',
    name: 'Google 商业档案 (GBP)',
    emoji: '📍',
    description: '本地搜索表现、地图曝光、客户评价、营业信息',
    status: 'not_connected',
    statusLabel: '未连接',
    setupHint: '通过 Google My Business API 接入。客户授权后，magic engine 可以读取评分、评论、回复率，并在「在 GBP 中执行」按钮里直接发帖/回评。',
  },
  {
    anchor: 'meta-ads',
    name: 'Facebook 主页',
    emoji: '📊',
    description: '公开粉丝数、互动率、Meta 广告库投放记录',
    status: 'not_connected',
    statusLabel: '未添加',
    setupHint: '添加客户的 Facebook 主页 URL，张骞将自动抓取公开粉丝数、互动率及 Meta 广告库投放记录（无需 API token）。',
  },
  {
    anchor: 'reviews',
    name: '第三方评价平台',
    emoji: '⭐',
    description: 'ProductReview, Trustpilot, Yelp 等的评分、评论、回复率',
    status: 'not_connected',
    statusLabel: '未连接',
    setupHint: '当前张骞通过 Jina/Apify 抓取公开数据。如果客户有 API 凭证（如 Trustpilot Business），可以直接 push 自动化回复，提升回复率指标。',
  },
  {
    anchor: 'ga4',
    name: 'Google Analytics 4',
    emoji: '📈',
    description: '网站流量、转化、用户路径、归因数据',
    status: 'not_connected',
    statusLabel: '未连接',
    setupHint: '通过 GA4 Data API 接入。接入后，飞轮归因（SEO 流量提升、社媒带来的转化）直接从 GA4 拉取，不再依赖估算。',
  },
  {
    anchor: 'publer',
    name: 'Publer 发布器',
    emoji: '🚀',
    description: '社媒内容统一调度、定时发布、跨平台分发',
    status: 'partial',
    statusLabel: '账号已配置',
    setupHint: 'Magic Engine 自有 Publer workspace 已连接。每个客户的社媒账号需在 Publer 后台单独授权（Instagram/Facebook/LinkedIn/TikTok）。',
    docsUrl: 'https://publer.io',
  },
  {
    anchor: 'social',
    name: '客户社媒账号',
    emoji: '📱',
    description: 'Instagram Business / Facebook Page / TikTok Business 等',
    status: 'not_connected',
    statusLabel: '需 Publer 授权',
    setupHint: '客户社媒账号通过 Publer 授权后，Magic Engine 即可读取真实粉丝/互动率（替代张骞估算）、调度发布、回流 engagement 数据。',
  },
]
