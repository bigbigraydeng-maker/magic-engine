'use client'

/**
 * OtherDataSourcesPanel — 标记类连接器（不需要真授权，只是填个字段/打个勾）。
 *
 * PR5（docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.4）：
 * GBP/GSC/GA4 已经有真 OAuth 面板了（GbpPanel/GscPanel/Ga4Panel），这里只
 * 收剩下 4 个还没搬的：Facebook 主页 URL 抓取、Google 广告透明度扫描、
 * 第三方评价平台标记、客户社媒账号标记。
 *
 * 逻辑原样从 connectors/[anchor]/page.tsx 搬过来（同一套 API：
 * GET .../connectors/status + POST .../connectors/[anchor]/connect），
 * 只是从"独立页面"改成"手风琴式内嵌区块"，不再要求跳转。
 */

import { useState, useEffect, useCallback } from 'react'

interface AnchorMeta {
  name: string
  emoji: string
  description: string
  fields: Array<{ key: string; label: string; placeholder: string; required: boolean }>
  buttonLabel?: string
}

const ANCHORS: Record<string, AnchorMeta> = {
  'meta-ads': {
    name: 'Facebook 主页',
    emoji: '📊',
    description: '添加客户的 Facebook 主页 URL 后，张骞将自动抓取公开可见的粉丝数、互动率，以及 Meta 广告库中的投放记录（无需 API token，仅读取公开数据）。',
    fields: [{ key: 'page_url', label: 'Facebook 主页 URL', placeholder: 'https://www.facebook.com/yourbrand', required: true }],
    buttonLabel: '添加 Facebook 主页 →',
  },
  'google-ads': {
    name: 'Google 广告扫描',
    emoji: '🔵',
    description: '通过 Google Ads 透明度中心（公开数据）扫描品牌当前的 Google 广告投放情况。无需提供任何 API 凭证或广告账户授权。',
    fields: [],
    buttonLabel: '开启 Google 广告扫描 →',
  },
  reviews: {
    name: '第三方评价平台',
    emoji: '⭐',
    description: '当前张骞通过 Jina/Apify 抓取公开数据，无需额外授权。此处可标记为已确认配置。',
    fields: [],
  },
}

interface StatusRow {
  anchor: string
  status: string
  config: Record<string, unknown> | null
}

export function OtherDataSourcesPanel({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<StatusRow[] | null>(null)
  const [openAnchor, setOpenAnchor] = useState<string | null>(null)

  const loadStatus = useCallback(() => {
    return fetch(`/api/clients/${clientId}/connectors/status`)
      .then(r => r.ok ? r.json() as Promise<{ connectors: StatusRow[] }> : null)
      .then(data => setRows(data?.connectors ?? []))
      .catch(() => setRows([]))
  }, [clientId])

  useEffect(() => { void loadStatus() }, [loadStatus])

  const statusFor = (anchor: string) => rows?.find(r => r.anchor === anchor)?.status ?? 'not_connected'

  return (
    <div className="space-y-2">
      <a className="block rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-cyan-800"
        href={`/dashboard/clients/${encodeURIComponent(clientId)}/settings?tab=connect&section=social-connections`}>
        查看社媒授权与连接 →
      </a>
      {Object.entries(ANCHORS).map(([anchor, meta]) => (
        <AnchorRow
          key={anchor}
          anchor={anchor}
          meta={meta}
          clientId={clientId}
          status={statusFor(anchor)}
          open={openAnchor === anchor}
          onToggle={() => setOpenAnchor(o => (o === anchor ? null : anchor))}
          onSaved={loadStatus}
        />
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">✓ 已确认</span>
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">未确认</span>
}

function AnchorRow({
  anchor, meta, clientId, status, open, onToggle, onSaved,
}: {
  anchor: string
  meta: AnchorMeta
  clientId: string
  status: string
  open: boolean
  onToggle: () => void
  onSaved: () => void
}) {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const missingRequired = meta.fields.filter(f => f.required && !fieldValues[f.key]?.trim()).length > 0

  const handleConnect = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/connectors/${anchor}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: meta.fields.length > 0 ? fieldValues : null }),
      })
      const data = await res.json() as { success: boolean; error?: string }
      setResult(data.success ? { ok: true } : { ok: false, error: data.error ?? '保存失败' })
      // 魏征 2026-08-11 复审：保存成功后收起手风琴，头部徽章不刷新，会让人
      // 以为没存上——通知父组件重新拉一次状态。
      if (data.success) onSaved()
    } catch {
      setResult({ ok: false, error: '网络错误，请重试' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span>{meta.emoji}</span>
        <span className="flex-1 text-sm font-semibold text-slate-800">{meta.name}</span>
        <StatusBadge status={status} />
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">{meta.description}</p>
          {meta.fields.map(f => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                {f.label}{f.required && <span className="ml-1 text-red-500">*</span>}
              </label>
              <input
                type="text"
                placeholder={f.placeholder}
                value={fieldValues[f.key] ?? ''}
                onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          ))}
          {result && (
            <p className={`text-xs ${result.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {result.ok ? '✓ 已保存' : result.error}
            </p>
          )}
          <button
            onClick={() => void handleConnect()}
            disabled={saving || missingRequired}
            className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '保存中…' : (meta.buttonLabel ?? '确认 →')}
          </button>
        </div>
      )}
    </div>
  )
}
