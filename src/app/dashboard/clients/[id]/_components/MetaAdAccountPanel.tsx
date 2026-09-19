'use client'

/**
 * MetaAdAccountPanel — FDE-managed Meta (Facebook) ad account binding.
 *
 * Single write entry for clients.meta_ad_account_id. Consumed by
 *   - Meta Ads daily sync cron (flywheel metrics)
 *   - Manual sync endpoint
 *   - MetaAdsAdapter diagnostic adapter
 *   - the ownership gate on ad writes (stop-loss / execute)
 *
 * AD-SEC-3 (2026-09-13): only internal staff can change it (`can_edit` from GET).
 * Saving is two steps: 核实 asks Meta what this account is (name, business, and
 * whether it is already registered to another client), then 确认保存 writes.
 * The Meta name is shown because a readable account is NOT proof it belongs to
 * this client — the shared token can see several clients' accounts.
 */

import { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
}

interface Preview {
  account: { id: string; name: string | null; business_name: string | null }
  token_source: 'client_domain' | 'client_page' | 'shared_fallback'
  shared_with: { client_id: string; client_name: string | null }[]
}

interface PendingRequest {
  requested_value: string
  actor_email: string
  created_at: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      adAccountId: string | null
      canEdit: boolean
      pending: PendingRequest | null
      /** 读待核实请求失败 —— 必须显示出来，不能当成「没有请求」 */
      pendingError: string | null
    }

const TOKEN_SOURCE_LABEL: Record<Preview['token_source'], string> = {
  client_domain: '这个客户专属的令牌',
  client_page: '这个客户主页专属的令牌',
  shared_fallback: '共享令牌（能看到多家客户的账户，读得到不代表属于这个客户）',
}

type Json = Record<string, unknown>

function isPreview(v: Json): v is Json & Preview {
  const account = v.account as Json | undefined
  return typeof account?.id === 'string' && typeof v.token_source === 'string' && Array.isArray(v.shared_with)
}

function isPendingRequest(v: unknown): v is PendingRequest {
  return typeof v === 'object' && v !== null && typeof (v as Json).requested_value === 'string'
}

async function patch(clientId: string, body: Json): Promise<{ ok: boolean; status: number; json: Json }> {
  const res = await fetch(`/api/clients/${clientId}/meta-ad-account`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Json
  return { ok: res.ok, status: res.status, json }
}

export function MetaAdAccountPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [shareOk, setShareOk] = useState(false)
  const [shareReason, setShareReason] = useState('')
  const [keepPrevious, setKeepPrevious] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/meta-ad-account`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Json
      const value = typeof data.ad_account_id === 'string' ? data.ad_account_id : null
      const pending = isPendingRequest(data.pending_request) ? data.pending_request : null
      const raw = data.pending_request as Json | null | undefined
      const pendingError = raw && typeof raw.error === 'string' ? raw.error : null
      setState({ phase: 'ready', adAccountId: value, canEdit: data.can_edit === true, pending, pendingError })
      setDraft(value ?? '')
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const resetPreview = () => { setPreview(null); setShareOk(false); setShareReason(''); setKeepPrevious(false) }

  const run = async (body: Json, onOk: (json: Json) => void | Promise<void>) => {
    setBusy(true)
    setErrMsg(null)
    try {
      const r = await patch(clientId, body)
      if (!r.ok) throw new Error(typeof r.json.error === 'string' ? r.json.error : `HTTP ${r.status}`)
      await onOk(r.json)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = () =>
    run({ ad_account_id: draft.trim(), preview: true }, json => {
      if (!isPreview(json)) throw new Error('核实结果格式不对，请刷新后重试')
      setPreview(json)
    })

  const handleSave = () => {
    const trimmed = draft.trim()
    const body: Json = { ad_account_id: trimmed.length === 0 ? null : trimmed, keep_previous_as_secondary: keepPrevious }
    if (preview && preview.shared_with.length > 0) {
      body.allow_shared_account = shareOk
      body.override_reason = shareReason
    }
    return run(body, async () => {
      resetPreview()
      setSavedAt(new Date().toLocaleTimeString())
      await load()
    })
  }

  const handleDismiss = () => run({ dismiss_request: true }, () => load())

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  if (!state.canEdit) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          当前绑定：<code className="rounded bg-slate-100 px-1 text-xs">{state.adAccountId ?? '未绑定'}</code>
        </p>
        <p className="mt-2 text-xs text-slate-400">广告账户只能由 Magic Lab 团队核实后绑定，如需更换请联系你的 FDE。</p>
      </div>
    )
  }

  const pending = state.pending
  const dirty = draft.trim() !== (state.adAccountId ?? '').trim()
  const clearing = dirty && draft.trim().length === 0
  const shareSatisfied = preview !== null && (preview.shared_with.length === 0 || (shareOk && shareReason.trim().length >= 10))
  const canSave = clearing || shareSatisfied

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {state.pendingError && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          ⚠ 读不到客户有没有提交过待核实的账户号（{state.pendingError}）—— 不代表没有，稍后刷新再看。
        </p>
      )}

      {pending && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p>
            客户（{pending.actor_email}）提交了账户号{' '}
            <code className="rounded bg-white px-1">{pending.requested_value}</code>，等你核实。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => { setDraft(pending.requested_value); resetPreview() }}
              className="rounded border border-amber-300 bg-white px-2 py-0.5 font-bold hover:bg-amber-100"
            >
              填入这个号
            </button>
            <button onClick={handleDismiss} disabled={busy} className="text-amber-700 underline">
              忽略这个请求
            </button>
          </div>
        </div>
      )}

      <p className="mb-3 text-sm text-slate-600">
        填入 Meta 广告账户 ID，格式 <code className="rounded bg-slate-100 px-1 text-xs">act_数字</code>。
        只填数字也行。保存前先点「核实」，确认 Meta 返回的账户名是这个客户的。
      </p>

      <input
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); resetPreview() }}
        placeholder="act_2775766642787274"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {preview && (
        <PreviewBox
          preview={preview}
          shareOk={shareOk}
          setShareOk={setShareOk}
          shareReason={shareReason}
          setShareReason={setShareReason}
        />
      )}

      {dirty && state.adAccountId && (clearing || preview) && (
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={keepPrevious} onChange={e => setKeepPrevious(e.target.checked)} className="mt-0.5" />
          <span>
            旧账户 <code className="rounded bg-slate-100 px-1">{state.adAccountId}</code> 也是这个客户的，保留为第二账户
            （不勾 = 从这个客户名下移除，这个客户就不能再停/改那个账户里的广告）
          </span>
        </label>
      )}

      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}

      <div className="mt-3 flex items-center gap-2">
        {dirty && !clearing && !preview && (
          <button
            onClick={handleVerify}
            disabled={busy}
            className="rounded-lg border border-cyan-600 px-4 py-1.5 text-sm font-bold text-cyan-700 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '核实中…' : '核实'}
          </button>
        )}
        {dirty && (clearing || preview) && (
          <button
            onClick={handleSave}
            disabled={busy || !canSave}
            className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? '保存中…' : clearing ? (keepPrevious ? '确认清空主账户' : '确认清空并移除') : '确认保存'}
          </button>
        )}
        {dirty && !busy && (
          <button
            onClick={() => { setDraft(state.adAccountId ?? ''); resetPreview() }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && savedAt && <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>}
        {!dirty && !savedAt && state.adAccountId === null && <span className="text-xs text-slate-400">未绑定</span>}
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        在 Meta Ads Manager 左上账户切换器找到，复制完整 ID（含 <code className="rounded bg-slate-100 px-1">act_</code> 前缀）。
        绑定后下一次 cron（每日 03:00 UTC）会自动同步广告花费 / CTR / ROAS 到 ME 飞轮。每次修改都会记下是谁改的。
      </p>
    </div>
  )
}

function PreviewBox(props: {
  preview: Preview
  shareOk: boolean
  setShareOk: (v: boolean) => void
  shareReason: string
  setShareReason: (v: string) => void
}) {
  const { preview, shareOk, setShareOk, shareReason, setShareReason } = props
  const shared = preview.shared_with.length > 0
  const tone = shared ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50 text-slate-700'
  return (
    <div className={`mt-3 rounded-lg border p-3 text-xs ${tone}`}>
      <p>Meta 返回：<b>{preview.account.name ?? '（没有名字）'}</b>（{preview.account.id}）</p>
      <p className="mt-1">所属商户：{preview.account.business_name ?? '读不到（个人账户或令牌无权限）'}</p>
      <p className="mt-1">核实用的是：{TOKEN_SOURCE_LABEL[preview.token_source]}</p>
      {shared && (
        <div className="mt-2 border-t border-red-200 pt-2">
          <p className="font-bold">
            ⚠ 这个账户已经登记在：{preview.shared_with.map(s => s.client_name ?? s.client_id).join('、')}。
            保存后这几个客户都能停/改这个账户里的广告。
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={shareOk} onChange={e => setShareOk(e.target.checked)} />
            我确认这个账户确实由这几个客户共用
          </label>
          <input
            type="text"
            value={shareReason}
            onChange={e => setShareReason(e.target.value)}
            placeholder="写清为什么共用（至少 10 个字，会记进审计）"
            className="mt-2 w-full rounded border border-red-200 bg-white px-2 py-1"
          />
        </div>
      )}
    </div>
  )
}
