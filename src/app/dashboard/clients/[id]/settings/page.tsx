'use client'

/**
 * /dashboard/clients/[id]/settings
 *
 * Client platform-connection settings page.
 * Primary entry point after the GBP OAuth callback redirect.
 *
 * URL params handled:
 *   ?gbp=connected               → show success banner
 *   ?gbp=error&reason=<slug>     → show error banner
 *
 * Phase 24.A.7
 */

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { GbpPanel } from './_components/GbpPanel'
import { GoogleAdsPanel } from './_components/GoogleAdsPanel'
import { CompetitorDomainsPanel } from './_components/CompetitorDomainsPanel'
import { PrimaryKeywordsPanel } from './_components/PrimaryKeywordsPanel'
import { BrandAliasesPanel } from './_components/BrandAliasesPanel'
import { SocialHandlesPanel } from './_components/SocialHandlesPanel'
import { ApiKeysPanel } from './_components/ApiKeysPanel'
import { ExcludedTopicsPanel } from './_components/ExcludedTopicsPanel'
import { BrandRedlinesPanel } from './_components/BrandRedlinesPanel'

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: '无法从 Google 获取访问令牌，请重试。',
  gbp_api_failed:        'Google Business Profile API 返回错误，请检查账号权限后重试。',
  no_gbp_accounts:       '该 Google 账号下未找到 GBP 业务账户，请确认已创建 GBP 主页。',
}

export default function ClientSettingsPage() {
  const params       = useParams<{ id: string }>()
  const searchParams = useSearchParams()

  const clientId = params.id
  const gbpStatus = searchParams.get('gbp')    // 'connected' | 'error' | null
  const gbpReason = searchParams.get('reason') ?? ''

  const errorMessage = gbpStatus === 'error'
    ? (ERROR_MESSAGES[gbpReason] ?? '连接过程中发生未知错误，请重试。')
    : null

  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      <div className="mx-auto max-w-3xl px-5 py-8">

        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="font-medium text-cyan-700 hover:underline"
          >
            ← 返回客户主页
          </Link>
        </div>

        <h1 className="text-2xl font-black text-slate-950">客户配置中心</h1>
        <p className="mt-1 text-sm text-slate-500">
          管理客户的平台连接（OAuth 授权）和基础信息（竞品、品牌词等元数据）
        </p>

        {/* OAuth callback banners */}
        {gbpStatus === 'connected' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <span className="text-xl">✅</span>
            <div>
              <p className="font-black text-emerald-800">Google Business Profile 已成功连接！</p>
              <p className="mt-0.5 text-sm text-emerald-700">
                数据将在下次同步时开始更新。
              </p>
            </div>
          </div>
        )}

        {gbpStatus === 'error' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <span className="text-xl">❌</span>
            <div>
              <p className="font-black text-red-800">连接失败</p>
              <p className="mt-0.5 text-sm text-red-700">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* ── §1 平台连接（OAuth 类） ────────────────────────────────────── */}
        <div className="mt-8 mb-2 flex items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            § 1 · 平台连接
          </p>
          <span className="text-xs text-slate-400">OAuth 授权</span>
        </div>

        {/* GBP Connection Section */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📍</span>
            <h2 className="font-black text-slate-800">Google Business Profile</h2>
          </div>
          <GbpPanel clientId={clientId} />
        </section>

        {/* Google Ads Connection Section */}
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📢</span>
            <h2 className="font-black text-slate-800">Google Ads</h2>
          </div>
          <GoogleAdsPanel clientId={clientId} />
        </section>

        {/* Other connectors — managed on the legacy connectors page.
            google-ads is intentionally removed from this list (Phase 18.B.3
            moved it to a dedicated GoogleAdsPanel above). */}
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🔗</span>
            <h2 className="font-black text-slate-800">其他平台连接</h2>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            以下连接器在「Connectors」页面管理（前期 Phase 14 已上线）。后续会逐步迁移到本页统一管理。
          </p>
          <div className="space-y-2">
            {[
              { anchor: 'gsc',         label: 'Google Search Console', icon: '🔍', hint: 'GSC 搜索表现 + Indexing API' },
              { anchor: 'ga4',         label: 'Google Analytics 4',    icon: '📈', hint: '网站真实流量数据' },
              { anchor: 'meta-ads',    label: 'Facebook 主页',          icon: '📊', hint: 'Meta 广告库 + 公开粉丝数' },
            ].map(p => (
              <Link
                key={p.anchor}
                href={`/dashboard/clients/${clientId}/connectors/${p.anchor}`}
                className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
              >
                <span>{p.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{p.label}</div>
                  <div className="text-xs text-slate-500">{p.hint}</div>
                </div>
                <span className="text-cyan-600 opacity-0 transition group-hover:opacity-100">→</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── §2 SEO 基础信息（客户元数据） ───────────────────────────────── */}
        <div className="mt-10 mb-2 flex items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            § 2 · SEO 基础信息
          </p>
          <span className="text-xs text-slate-400">客户元数据 · 多支柱共用</span>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🎯</span>
            <h2 className="font-black text-slate-800">主关键词清单</h2>
          </div>
          <PrimaryKeywordsPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🏷️</span>
            <h2 className="font-black text-slate-800">品牌词别名</h2>
          </div>
          <BrandAliasesPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🥊</span>
            <h2 className="font-black text-slate-800">竞品域名清单</h2>
          </div>
          <CompetitorDomainsPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🚫</span>
            <h2 className="font-black text-slate-800">排除品类词（关键词 gap 过滤）</h2>
          </div>
          <ExcludedTopicsPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">⛔</span>
            <h2 className="font-black text-slate-800">品牌红线短语（内容工厂拒单闸）</h2>
          </div>
          <BrandRedlinesPanel clientId={clientId} />
        </section>

        {/* ── §3 社媒账号（诊断 social 维度数据源） ──────────────────────── */}
        <div className="mt-10 mb-2 flex items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            § 3 · 社媒账号
          </p>
          <span className="text-xs text-slate-400">驱动诊断引擎社媒维度</span>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📱</span>
            <h2 className="font-black text-slate-800">Instagram · Facebook · TikTok</h2>
          </div>
          <SocialHandlesPanel clientId={clientId} />
        </section>

        {/* ── §4 程序化访问（Phase 34） ───────────────────────────────────── */}
        <div className="mt-10 mb-2 flex items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            § 4 · 程序化访问
          </p>
          <span className="text-xs text-slate-400">客户用自己的 MCP 客户端查看本客户数据</span>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🔌</span>
            <h2 className="font-black text-slate-800">MCP API 访问</h2>
          </div>
          <ApiKeysPanel clientId={clientId} />
        </section>

      </div>
    </div>
  )
}
