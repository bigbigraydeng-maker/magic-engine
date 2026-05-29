'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'

// ─── Connector config per anchor ─────────────────────────────────────────────

interface ConnectorMeta {
  name: string
  emoji: string
  description: string
  /** Fields the user fills in before connecting. Empty = just a "Connect" button. */
  fields: Array<{ key: string; label: string; placeholder: string; required: boolean }>
  /** Anchors that trigger advanced discovery on connect. */
  triggersAdvanced: boolean
  advancedHint: string
  /** Override for the submit button label (default: "确认连接 →") */
  buttonLabel?: string
  /** Override for the success message title (default: "✓ Connector 已连接") */
  successLabel?: string
  /** Override for the success sub-message when no advanced job triggered */
  savedLabel?: string
  /** When set, this connector uses Google OAuth before showing the form fields. */
  oauthAnchor?: string
}

const CONNECTOR_META: Record<string, ConnectorMeta> = {
  'meta-ads': {
    name: 'Facebook 主页',
    emoji: '📊',
    description: '添加客户的 Facebook 主页 URL 后，张骞将自动抓取公开可见的粉丝数、互动率，以及 Meta 广告库中的投放记录（无需 API token，仅读取公开数据）。',
    fields: [
      {
        key: 'page_url',
        label: 'Facebook 主页 URL',
        placeholder: 'https://www.facebook.com/yourbrand',
        required: true,
      },
    ],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台自动补跑 Facebook 数据，通常 2–5 分钟完成。',
    buttonLabel: '添加 Facebook 主页 →',
    successLabel: '✓ Facebook 主页已添加',
    savedLabel: '主页已添加。如果还没有基础发现报告，请先运行张骞发现，高级发现将自动补跑。',
  },
  gbp: {
    name: 'Google 商业档案 (GBP)',
    emoji: '📍',
    description: '标记 GBP 已授权后，张骞将补跑更详细的本地评价分析（评分分布、差评样本、回复率）。',
    fields: [
      {
        key: 'place_id',
        label: 'Google Place ID（可选）',
        placeholder: 'ChIJxxxxxxxxxxxxxxxxxx',
        required: false,
      },
    ],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台自动补跑高级发现，通常 1–3 分钟完成。',
  },
  gsc: {
    name: 'Google Search Console',
    emoji: '🔎',
    description: '接入 GSC 后，张骞将拉取真实 query、展示量、点击率、平均排名，替代 SEMrush 关键词估算。\n\n点击下方按钮用 Google 账号授权，授权完成后从下拉列表选择对应的 GSC Property 即可完成连接。',
    fields: [
      {
        key: 'site_url',
        label: 'GSC Property',
        placeholder: 'https://example.com.au/ 或 sc-domain:example.com.au',
        required: true,
      },
    ],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台自动拉取过去 28 天的真实搜索数据（query / 展示量 / 点击率 / 排名），通常 1–2 分钟完成。',
    buttonLabel: '连接 Google Search Console →',
    successLabel: '✓ Google Search Console 已连接',
    oauthAnchor: 'gsc',
  },
  'google-ads': {
    name: 'Google 广告',
    emoji: '🔵',
    description: '通过 Google Ads 透明度中心（公开数据）扫描品牌当前的 Google 广告投放情况，包括活跃广告数量、创意格式及投放地区。无需提供任何 API 凭证或广告账户授权。',
    fields: [],
    triggersAdvanced: true,
    advancedHint: '保存后张骞将在后台扫描 Google 广告透明度中心，通常 2–5 分钟完成。',
    buttonLabel: '开启 Google 广告扫描 →',
    successLabel: '✓ Google 广告扫描已启用',
  },
  ga4: {
    name: 'Google Analytics 4',
    emoji: '📈',
    description: '通过 GA4 Data API 接入网站真实流量数据（会话、用户、页面浏览、跳出率、流量来源），飞轮归因将直接使用 GA4 真实数据。\n\n⚠️ 前置要求：请先在 Google Search Console 页面完成「Google 账号授权」（使用有 GA4 管理权限的 Google 账号），再回到这里填入 Property ID。\n\nGA4 Property ID 可在 GA4 后台 → 管理 → 媒体资源设置中找到（纯数字，如 123456789）。',
    fields: [
      {
        key: 'property_id',
        label: 'GA4 Property ID',
        placeholder: '123456789（GA4 后台 → 管理 → 媒体资源设置）',
        required: true,
      },
    ],
    triggersAdvanced: false,
    advancedHint: '',
    buttonLabel: '连接 Google Analytics 4 →',
    successLabel: '✓ Google Analytics 4 已连接',
    savedLabel: '已保存。点击下方「立即同步」拉取最近 28 天流量数据。',
  },
  reviews: {
    name: '第三方评价平台',
    emoji: '⭐',
    description: '当前张骞通过 Jina/Apify 抓取公开数据，无需额外授权。此处可标记为已确认配置。',
    fields: [],
    triggersAdvanced: false,
    advancedHint: '',
  },
  publer: {
    name: 'Publer 发布器',
    emoji: '🚀',
    description: 'Magic Engine 自有 Publer workspace 已连接。客户社媒账号需在 Publer 后台单独授权。',
    fields: [],
    triggersAdvanced: false,
    advancedHint: '',
  },
  social: {
    name: '客户社媒账号',
    emoji: '📱',
    description: '客户社媒账号通过 Publer 授权后，在此标记为已连接。',
    fields: [],
    triggersAdvanced: false,
    advancedHint: '',
  },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConnectorDetailPage() {
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const clientId     = params.id as string
  const anchor       = params.anchor as string

  const meta = CONNECTOR_META[anchor]

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [saving, setSaving]           = useState(false)
  const [result, setResult]           = useState<{
    ok: boolean
    advancedJobId?: string | null
    error?: string
  } | null>(null)

  // For OAuth connectors: track whether the Google auth step is done
  const [oauthEmail, setOauthEmail]   = useState<string | null>(null)
  const [oauthDone, setOauthDone]     = useState(false)
  const [oauthChecked, setOauthChecked] = useState(false)

  // GSC sites dropdown — populated from /api/clients/[id]/gsc/sites once OAuth is done
  const [gscSites, setGscSites]               = useState<Array<{ siteUrl: string; permissionLevel: string }> | null>(null)
  const [gscSitesLoading, setGscSitesLoading] = useState(false)
  const [gscSitesError, setGscSitesError]     = useState<string | null>(null)
  const [gscManualMode, setGscManualMode]     = useState(false)

  // Publer account binding state (only used when anchor === 'publer')
  const [publerAccounts, setPublerAccounts]         = useState<Array<{ id: string; provider: string; name: string }>>([])
  const [publerAccountsLoading, setPublerAccountsLoading] = useState(false)
  const [publerSelectedIds, setPublerSelectedIds]   = useState<Record<string, string>>({})
  const [publerSaving, setPublerSaving]             = useState(false)
  const [publerSaveResult, setPublerSaveResult]     = useState<{ ok: boolean; error?: string } | null>(null)

  // On mount for OAuth connectors: check existing status + handle ?oauth= param
  useEffect(() => {
    if (!meta?.oauthAnchor) return

    const oauthParam = searchParams.get('oauth')

    void (async () => {
      try {
        const res  = await fetch(`/api/clients/${clientId}/connectors/status`)
        if (!res.ok) return
        const data = await res.json() as {
          connectors: Array<{ anchor: string; status: string; config: Record<string, unknown> | null }>
        }
        const row = data.connectors.find(c => c.anchor === anchor)
        if (row && (row.status === 'partial' || row.status === 'connected')) {
          const email = (row.config?.google_email as string | undefined) ?? null
          setOauthEmail(email)
          setOauthDone(true)
          if (row.config?.site_url) {
            setFieldValues({ site_url: row.config.site_url as string })
          }
        }
        if (oauthParam === 'error') {
          setResult({ ok: false, error: 'Google 授权失败，请重试' })
        }
      } finally {
        setOauthChecked(true)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Publer only: fetch workspace accounts + existing binding config on mount
  useEffect(() => {
    if (anchor !== 'publer') return
    setPublerAccountsLoading(true)
    void Promise.all([
      fetch('/api/publer/accounts').then(r => r.json() as Promise<{ accounts?: Array<{ id: string; provider: string; name: string }> }>),
      fetch(`/api/clients/${clientId}/connectors/status`).then(r => r.ok ? r.json() as Promise<{ connectors?: Array<{ anchor: string; config: Record<string, unknown> | null }> }> : null),
    ]).then(([accountsData, statusData]) => {
      setPublerAccounts(accountsData.accounts ?? [])
      const row = statusData?.connectors?.find(c => c.anchor === 'publer')
      const existing = (row?.config?.publer_account_ids as Record<string, string> | undefined) ?? {}
      setPublerSelectedIds(existing)
    }).finally(() => setPublerAccountsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])

  // GSC only: once OAuth is done, fetch the list of sites this user can access
  useEffect(() => {
    if (anchor !== 'gsc' || !oauthDone) return
    setGscSitesLoading(true)
    setGscSitesError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/gsc/sites`)
        const data = await res.json() as {
          success: boolean
          sites?: Array<{ siteUrl: string; permissionLevel: string }>
          error?: string
        }
        if (data.success && data.sites) {
          setGscSites(data.sites)
        } else {
          setGscSitesError(data.error ?? '无法获取 GSC 网站列表')
        }
      } catch (err) {
        setGscSitesError(err instanceof Error ? err.message : '网络错误')
      } finally {
        setGscSitesLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthDone, anchor])

  if (!meta) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-sm">未知的 Connector：{anchor}</p>
          <Link
            href={`/dashboard/clients/${clientId}/connectors`}
            className="mt-3 inline-block text-xs text-indigo-600 hover:underline"
          >
            ← 返回 Connectors
          </Link>
        </div>
      </div>
    )
  }

  const handleConnect = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/connectors/${anchor}/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: meta.fields.length > 0
              ? { ...fieldValues, ...(oauthEmail ? { google_email: oauthEmail } : {}) }
              : null,
          }),
        },
      )
      const data = await res.json() as { success: boolean; advanced_job_id?: string | null; error?: string }
      if (data.success) {
        setResult({ ok: true, advancedJobId: data.advanced_job_id })
      } else {
        setResult({ ok: false, error: data.error ?? '保存失败' })
      }
    } catch {
      setResult({ ok: false, error: '网络错误，请重试' })
    } finally {
      setSaving(false)
    }
  }

  const handlePublerSave = async () => {
    setPublerSaving(true)
    setPublerSaveResult(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/connectors/publer/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
        config: {
          publer_account_ids: Object.fromEntries(
            Object.entries(publerSelectedIds).filter(([, v]) => v !== '')
          ),
        },
      }),
        },
      )
      const data = await res.json() as { success: boolean; error?: string }
      setPublerSaveResult(data.success ? { ok: true } : { ok: false, error: data.error ?? '保存失败' })
    } catch {
      setPublerSaveResult({ ok: false, error: '网络错误，请重试' })
    } finally {
      setPublerSaving(false)
    }
  }

  const missingRequired =
    (meta.oauthAnchor !== undefined && !oauthDone) ||
    meta.fields
      .filter(f => f.required && !fieldValues[f.key]?.trim())
      .length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}/connectors`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ← 返回
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            {meta.emoji} {meta.name}
          </h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        {/* Description */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{meta.description}</p>
        </div>

        {/* ── OAuth step (GSC and future Google connectors) ── */}
        {meta.oauthAnchor && oauthChecked && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">第 1 步：Google 账号授权</h2>
            {oauthDone ? (
              <div className="flex items-center gap-2">
                <span className="text-green-600 font-semibold text-sm">✓ 已授权</span>
                {oauthEmail && <span className="text-sm text-gray-600">{oauthEmail}</span>}
                <button
                  onClick={() => {
                    window.location.href = `/api/auth/google/connect?client_id=${clientId}`
                  }}
                  className="ml-auto text-xs text-indigo-600 hover:underline"
                >
                  重新授权
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  window.location.href = `/api/auth/google/connect?client_id=${clientId}`
                }}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                使用 Google 账号授权
              </button>
            )}
          </div>
        )}

        {/* Form fields — for OAuth connectors, only show after OAuth step */}
        {meta.fields.length > 0 && (!meta.oauthAnchor || oauthDone) && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">配置信息</h2>
            {meta.fields.map(f => {
              const isGscSiteField = anchor === 'gsc' && f.key === 'site_url'
              const showDropdown   = isGscSiteField
                && !gscManualMode
                && gscSites !== null
                && gscSites.length > 0

              return (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                  </label>

                  {isGscSiteField && gscSitesLoading && (
                    <div className="h-9 w-full rounded-lg bg-gray-100 animate-pulse" />
                  )}

                  {isGscSiteField && !gscSitesLoading && gscSitesError && (
                    <p className="text-xs text-amber-700 mb-2">
                      ⚠ 无法获取已授权的 GSC 网站列表（{gscSitesError}）。请手动输入 Property。
                    </p>
                  )}

                  {showDropdown ? (
                    <>
                      <select
                        value={fieldValues[f.key] ?? ''}
                        onChange={e =>
                          setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="">— 选择已授权的 Property —</option>
                        {gscSites!.map(s => (
                          <option key={s.siteUrl} value={s.siteUrl}>
                            {s.siteUrl} ({s.permissionLevel})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setGscManualMode(true)}
                        className="mt-2 text-xs text-indigo-600 hover:underline"
                      >
                        手动输入 Property URL
                      </button>
                    </>
                  ) : (!isGscSiteField || !gscSitesLoading) && (
                    <>
                      <input
                        type="text"
                        placeholder={f.placeholder}
                        value={fieldValues[f.key] ?? ''}
                        onChange={e =>
                          setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      {isGscSiteField && gscSites !== null && gscSites.length > 0 && gscManualMode && (
                        <button
                          type="button"
                          onClick={() => setGscManualMode(false)}
                          className="mt-2 text-xs text-indigo-600 hover:underline"
                        >
                          ← 从下拉列表选择
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Publer: account binding per client */}
        {anchor === 'publer' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">绑定该客户的 Publishing Hub 账号</h2>
              <p className="text-xs text-gray-500 mt-1">
                选择该客户在 Publishing Hub 中对应的社媒账号，确保内容发布到正确的账户而非其他客户账号。
              </p>
            </div>

            {publerAccountsLoading ? (
              <div className="space-y-2">
                <div className="h-9 w-full rounded-lg bg-gray-100 animate-pulse" />
                <div className="h-9 w-full rounded-lg bg-gray-100 animate-pulse" />
              </div>
            ) : publerAccounts.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠ Publishing Hub workspace 中暂无社媒账号，请先在 Publer 后台授权客户的 Instagram / Facebook 等账号。
              </p>
            ) : (
              <div className="space-y-3">
                {Array.from(new Set(publerAccounts.map(a => a.provider))).sort().map(provider => {
                  const providerAccounts = publerAccounts.filter(a => a.provider === provider)
                  return (
                    <div key={provider}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5 capitalize">
                        {provider}
                      </label>
                      <select
                        value={publerSelectedIds[provider] ?? ''}
                        onChange={e => setPublerSelectedIds(prev => ({
                          ...prev,
                          [provider]: e.target.value,
                        }))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">— 未绑定（不发布到此平台）—</option>
                        {providerAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}

                <button
                  onClick={() => void handlePublerSave()}
                  disabled={publerSaving}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {publerSaving ? '保存中…' : '💾 保存账号绑定'}
                </button>

                {publerSaveResult && (
                  <p className={`text-xs ${publerSaveResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {publerSaveResult.ok ? '✓ 账号绑定已保存，后续发布将使用以上账号' : publerSaveResult.error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Advanced discovery hint */}
        {meta.triggersAdvanced && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <p className="text-xs text-indigo-800">
              <strong>高级发现将自动触发</strong> — {meta.advancedHint}
            </p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`rounded-xl border px-4 py-3 ${
              result.ok
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            {result.ok ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-green-800">{meta.successLabel ?? '✓ 已保存'}</p>
                {result.advancedJobId ? (
                  <p className="text-xs text-green-700">
                    张骞正在后台补跑数据（Job ID: {result.advancedJobId}），通常 2–5 分钟完成后自动写入发现报告。
                  </p>
                ) : meta.triggersAdvanced ? (
                  <p className="text-xs text-green-700">
                    {meta.savedLabel ?? '已保存。如果还没有基础发现报告，请先运行张骞发现，高级发现将自动补跑。'}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-red-700">{result.error}</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        {!result?.ok && (
          <button
            onClick={() => void handleConnect()}
            disabled={saving || missingRequired}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '正在保存…' : (meta.buttonLabel ?? '确认连接 →')}
          </button>
        )}

        {result?.ok && (
          <button
            onClick={() => router.push(`/dashboard/clients/${clientId}/connectors`)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← 返回 Connectors
          </button>
        )}

        {/* Snapshot preview + sync button — GSC and GA4 only */}
        {(anchor === 'gsc' || anchor === 'ga4') && (
          <SnapshotSyncPanel anchor={anchor} clientId={clientId} />
        )}
      </div>
    </div>
  )
}

// ─── SnapshotSyncPanel ────────────────────────────────────────────────────────

interface GscSnapshot {
  total_clicks: number
  total_impressions: number
  avg_ctr: number
  avg_position: number
  period_start: string
  period_end: string
  synced_at: string
  top_queries: Array<{ query?: string; clicks: number }>
}

interface Ga4Snapshot {
  total_sessions: number
  total_users: number
  total_pageviews: number
  bounce_rate: number
  period_start: string
  period_end: string
  synced_at: string
  top_sources: Array<{ source: string; medium: string; sessions: number }>
}

type AnySnapshot = GscSnapshot | Ga4Snapshot

function isGsc(s: AnySnapshot): s is GscSnapshot {
  return 'total_clicks' in s
}

function SnapshotSyncPanel({ anchor, clientId }: { anchor: string; clientId: string }) {
  const [snapshot, setSnapshot] = useState<AnySnapshot | null>(null)
  const [loadingSnap, setLoadingSnap] = useState(true)
  const [syncing, setSyncing]         = useState(false)
  const [syncMsg, setSyncMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  const fetchLatest = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/${anchor}/snapshots?limit=1`)
      if (res.ok) {
        const data = await res.json() as { latest: AnySnapshot | null }
        setSnapshot(data.latest ?? null)
      }
    } finally {
      setLoadingSnap(false)
    }
  }

  useEffect(() => { void fetchLatest() }, [clientId, anchor]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/${anchor}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json() as { success: boolean; error?: string }
      if (data.success) {
        setSyncMsg({ ok: true, text: '✓ 同步成功' })
        setLoadingSnap(true)
        await fetchLatest()
      } else {
        setSyncMsg({ ok: false, text: data.error ?? '同步失败，请检查连接配置' })
      }
    } catch {
      setSyncMsg({ ok: false, text: '网络错误，请重试' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {anchor === 'gsc' ? '🔎 Search Console 数据快照' : '📈 Analytics 4 数据快照'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">点击「立即同步」拉取最近 28 天数据</p>
        </div>
        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {syncing ? '同步中…' : '立即同步'}
        </button>
      </div>

      {syncMsg && (
        <p className={`text-xs ${syncMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {syncMsg.text}
        </p>
      )}

      {loadingSnap ? (
        <div className="h-16 rounded-lg bg-white border border-slate-100 animate-pulse" />
      ) : snapshot ? (
        <div className="rounded-lg border border-slate-100 bg-white p-3 space-y-2">
          <p className="text-[10px] text-slate-400">
            {snapshot.period_start} – {snapshot.period_end}
            {' · '}
            上次同步：{new Date(snapshot.synced_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>

          {isGsc(snapshot) ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <SnapMetric label="点击量"   value={fmtNum(snapshot.total_clicks)} />
                <SnapMetric label="展示量"   value={fmtNum(snapshot.total_impressions)} />
                <SnapMetric label="平均 CTR" value={`${(snapshot.avg_ctr * 100).toFixed(1)}%`} />
                <SnapMetric label="平均排名" value={snapshot.avg_position.toFixed(1)} />
              </div>
              {snapshot.top_queries.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1">热门关键词</p>
                  <div className="space-y-0.5">
                    {snapshot.top_queries.slice(0, 3).map((q, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-600 truncate">{q.query ?? '—'}</span>
                        <span className="text-slate-400 shrink-0">{fmtNum(q.clicks)} 点击</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <SnapMetric label="会话数"   value={fmtNum((snapshot as Ga4Snapshot).total_sessions)} />
                <SnapMetric label="用户数"   value={fmtNum((snapshot as Ga4Snapshot).total_users)} />
                <SnapMetric label="页面浏览" value={fmtNum((snapshot as Ga4Snapshot).total_pageviews)} />
                <SnapMetric label="跳出率"   value={`${((snapshot as Ga4Snapshot).bounce_rate * 100).toFixed(1)}%`} />
              </div>
              {(snapshot as Ga4Snapshot).top_sources.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1">主要流量来源</p>
                  <div className="space-y-0.5">
                    {(snapshot as Ga4Snapshot).top_sources.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-600 truncate">
                          {s.source}{s.medium && s.medium !== '(none)' ? ` / ${s.medium}` : ''}
                        </span>
                        <span className="text-slate-400 shrink-0">{fmtNum(s.sessions)} 会话</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">暂无快照数据 — 连接成功后点击「立即同步」</p>
      )}
    </div>
  )
}

function SnapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold leading-tight text-slate-700">{value}</p>
    </div>
  )
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
