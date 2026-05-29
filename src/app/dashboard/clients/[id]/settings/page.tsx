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

        <h1 className="text-2xl font-black text-slate-950">平台连接设置</h1>
        <p className="mt-1 text-sm text-slate-500">
          管理客户的第三方平台授权（Google Business Profile、Google Search Console 等）
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

        {/* GBP Connection Section */}
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base">📍</span>
            <h2 className="font-black text-slate-800">Google Business Profile</h2>
          </div>
          <GbpPanel clientId={clientId} />
        </section>

        {/* Future providers placeholder */}
        <section className="mt-6">
          <h2 className="mb-3 font-black text-slate-800">
            <span className="mr-2">🔮</span>即将推出
          </h2>
          <div className="space-y-2">
            {[
              { label: 'Google Search Console', icon: '🔍' },
              { label: 'Google Ads', icon: '📢' },
            ].map(p => (
              <div
                key={p.label}
                className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400"
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
                <span className="ml-auto text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Coming soon
                </span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
