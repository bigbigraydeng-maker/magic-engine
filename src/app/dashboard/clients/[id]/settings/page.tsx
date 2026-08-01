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
import { ClientStatusPanel } from './_components/ClientStatusPanel'
import { GbpPanel } from './_components/GbpPanel'
import { GbpLocationPanel } from './_components/GbpLocationPanel'
import { GoogleAdsPanel } from './_components/GoogleAdsPanel'
import { AdStrategyPanel } from './_components/AdStrategyPanel'
import { CompetitorDomainsPanel } from './_components/CompetitorDomainsPanel'
import { ReputationIdentityPanel } from './_components/ReputationIdentityPanel'
import { PrimaryKeywordsPanel } from './_components/PrimaryKeywordsPanel'
import { BrandAliasesPanel } from './_components/BrandAliasesPanel'
import { SocialHandlesPanel } from './_components/SocialHandlesPanel'
import { ApiKeysPanel } from './_components/ApiKeysPanel'
import { ExcludedTopicsPanel } from './_components/ExcludedTopicsPanel'
import { WeeklyBlogPanel } from './_components/WeeklyBlogPanel'
import { BrandRedlinesPanel } from './_components/BrandRedlinesPanel'
import { IndustryPanel } from './_components/IndustryPanel'
import { ProductsPanel } from './_components/ProductsPanel'
import { UploadLinkPanel } from './_components/UploadLinkPanel'
import { FactoryConfigPanel } from './_components/FactoryConfigPanel'
import { CommentAutoReplyPanel } from './_components/CommentAutoReplyPanel'
import { LeadsConfigPanel } from './_components/LeadsConfigPanel'
import { PipelineStagesPanel } from './_components/PipelineStagesPanel'
import { CommentAuditList } from './_components/CommentAuditList'

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: 'Google 那边没给我们通行证，请再试一次。',
  gbp_api_failed:        'Google 拒绝了这次连接，多半是这个账号没有管理这家商家页的权限 —— 换成客户老板的账号再试一次。',
  no_gbp_accounts:       '这个 Google 账号名下没有任何商家页 —— 十有八九是登错账号了，退出 Google 换客户老板的账号重来。',
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
              <p className="font-black text-emerald-800">Google 商家页已连接，门店也确认好了！</p>
              <p className="mt-0.5 text-sm text-emerald-700">
                线已经接通。接下来我们会把每周要发的商家页内容写好，放进你的今日待办等你点确认 ——
                你不点，就不会有任何东西发到客户的 Google 页面上。
              </p>
            </div>
          </div>
        )}

        {gbpStatus === 'needs_location' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-black text-amber-800">连上了，但还差最后一步：我们没认出是哪一家门店</p>
              <p className="mt-0.5 text-sm text-amber-700">
                这个 Google 账号下面挂了不止一家门店，名字和网址都对不上，我们不敢猜 ——
                猜错就会把内容发到别人家的页面上。在确认之前，我们一条内容都不会发。
              </p>
              <p className="mt-1.5 text-sm font-bold text-amber-800">
                下一步：把客户名字和正确的门店名发给 Ray，我们指定一下，一般当天就能好。
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

        {/* ── §0 客户状态（真客户闸门） ──────────────────────────────────── */}
        <div className="mt-8 mb-2 flex items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            § 0 · 客户状态
          </p>
          <span className="text-xs text-slate-400">周期性监测的成本闸门</span>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🚦</span>
            <h2 className="font-black text-slate-800">真客户 / 调研档案</h2>
          </div>
          <ClientStatusPanel clientId={clientId} />
        </section>

        {/* ── §1 平台连接（OAuth 类） ────────────────────────────────────── */}
        <div className="mt-10 mb-2 flex items-baseline gap-2">
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

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🏪</span>
            <h2 className="font-black text-slate-800">发到哪一家门店</h2>
          </div>
          <GbpLocationPanel clientId={clientId} />
        </section>

        {/* Google Ads Connection Section */}
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📢</span>
            <h2 className="font-black text-slate-800">Google Ads</h2>
          </div>
          <GoogleAdsPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🩺</span>
            <h2 className="font-black text-slate-800">广告健康监测</h2>
          </div>
          <AdStrategyPanel clientId={clientId} />
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
            <span className="text-base">🏢</span>
            <h2 className="font-black text-slate-800">所属行业（决定 AI 读不读同行经验）</h2>
          </div>
          <IndustryPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📦</span>
            <h2 className="font-black text-slate-800">主力产品（AI 写文案时逐条读）</h2>
          </div>
          <ProductsPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📤</span>
            <h2 className="font-black text-slate-800">客户素材上传链接（免登录）</h2>
          </div>
          <UploadLinkPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📧</span>
            <h2 className="font-black text-slate-800">邮件反应同步（谁打开了 / 谁点了链接）</h2>
          </div>
          <LeadsConfigPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🪜</span>
            <h2 className="font-black text-slate-800">客人跟进步骤</h2>
          </div>
          <PipelineStagesPanel clientId={clientId} />
        </section>

        <section className="mt-6">
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
            <span className="text-base">⭐</span>
            <h2 className="font-black text-slate-800">口碑监测身份（GBP / Tripadvisor / 竞品）</h2>
          </div>
          <ReputationIdentityPanel clientId={clientId} />
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
            <span className="text-base">📝</span>
            <h2 className="font-black text-slate-800">每周自动 Blog（SEO 盯梢）</h2>
          </div>
          <WeeklyBlogPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">⛔</span>
            <h2 className="font-black text-slate-800">品牌红线短语（内容工厂拒单闸）</h2>
          </div>
          <BrandRedlinesPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🎬</span>
            <h2 className="font-black text-slate-800">视频工厂配置（出片 / 发片）</h2>
          </div>
          <FactoryConfigPanel clientId={clientId} />
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

        {/* ── §3.5 社媒评论自动回复（social 支柱 / DAPE 执行） ──────────────── */}
        <div className="mt-10 mb-2 flex items-baseline gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            § 3.5 · 评论自动回复
          </p>
          <span className="text-xs text-slate-400">全自动 · AI 分类 + 护栏</span>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">💬</span>
            <h2 className="font-black text-slate-800">Facebook 评论自动回复</h2>
          </div>
          <CommentAutoReplyPanel clientId={clientId} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">🗂️</span>
            <h2 className="font-black text-slate-800">最近自动回复（审计）</h2>
          </div>
          <CommentAuditList clientId={clientId} />
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
