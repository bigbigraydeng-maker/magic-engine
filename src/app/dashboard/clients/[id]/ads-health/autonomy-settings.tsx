'use client'

/**
 * Autonomy settings — P21.K.5
 *
 * The control panel for the Ad Strategy Engine: daily budget cap, autonomy
 * mode, and the creative pool. Deliberately self-contained (React + fetch
 * only) so it can be dropped into the ads-health page without pulling server
 * imports into a client component.
 *
 * Red-line: if the config read fails we render ONLY the error notice. Empty
 * inputs that look editable would let a save overwrite real values with blanks.
 */

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type AutonomyMode = 'observe' | 'bounded_auto'

interface CreativePoolEntry {
  kind: string
  ref: string
  status: string
  approved_by?: string | null
  alias_refs?: string[]
}

function videoNumber(entry: CreativePoolEntry): string {
  const alias = entry.alias_refs?.find((id) => /^\d+$/.test(id))
  if (entry.kind === 'work_order' && alias) return alias
  return entry.ref
}

/** 自动流程状态的中文名（spec 2026-10-21 §2）。candidate / approved 不走这里。 */
const EXTENDED_STATUS_LABELS: Record<string, string> = {
  pending_qc: '质检中',
  test_queue: '待测试',
  testing: '测试中',
  scaling: '放大中',
  rejected: '数据差已停',
  inconclusive: '没测成',
  retired: '已退役',
  manual_approved: '手批在跑',
}

interface AdStrategyConfig {
  daily_budget_cap_cents: number | null
  autonomy_mode: AutonomyMode
  creative_pool: CreativePoolEntry[]
}

interface CreativeLabel {
  title: string
  subtitle: string | null
  publishedAt: string | null
  url: string | null
}

interface LabelsResponse {
  labels?: Record<string, CreativeLabel>
}

/** Stored in cents; shown to people in whole currency units. */
function centsToDisplay(cents: number | null): string {
  if (cents == null) return ''
  const v = cents / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function displayToCents(text: string): number | null {
  if (text.trim() === '') return null
  const v = parseFloat(text)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
}

interface ConfigResponse {
  success?: boolean
  config?: AdStrategyConfig
  /** 素材池的乐观锁版本；缺省表示服务端没给 */
  version?: string | null
  /** 服务端读不到版本时置 true（此时没有 version 键） */
  version_unreadable?: boolean
  error?: string
  /** 给员工看的中文说明（比 error 代码好懂）；有就优先显示 */
  message?: string
}

interface AccountCapRow {
  ad_account_id: string
  daily_budget_cap_cents: number | null
  /** 缺省当「显示」。只有明确 true 才是藏起来。 */
  hidden_from_ad_health?: boolean | null
}

interface AccountCapsResponse {
  accounts?: AccountCapRow[]
  client_total_cap_cents?: number | null
  error?: string
}

// ─── Sub-components (each kept small and single-purpose) ──────────────────────

function CapField({
  draftCap,
  currentCap,
  onChange,
  onSave,
  saving,
}: {
  draftCap: string
  currentCap: number | null
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">每天最多花多少</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          min={0.01}
          step="0.01"
          value={draftCap}
          onChange={e => onChange(e.target.value)}
          placeholder="未设"
          className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums text-gray-800 focus:border-gray-400 focus:outline-none"
        />
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          data-testid="save-total-cap"
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存上限'}
        </button>
        <span className="text-xs text-gray-400">$ / 天（按广告账户的币种）</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">广告自动化每天最多花这么多钱。留空 = 没设上限，这时系统只看不动钱。</p>
      <p className="mt-0.5 text-xs text-gray-400">
        当前：
        <span className="tabular-nums text-gray-600">
          {currentCap == null ? '未设' : `$${centsToDisplay(currentCap)} / 天`}
        </span>
      </p>
    </div>
  )
}

function ModeField({
  draftMode,
  capUnset,
  onChange,
}: {
  draftMode: AutonomyMode
  capUnset: boolean
  onChange: (m: AutonomyMode) => void
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700">广告自动化做到哪一步</span>
      <div className="mt-1.5 space-y-1.5">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="autonomy_mode"
            checked={draftMode === 'observe'}
            onChange={() => onChange('observe')}
            className="accent-me-ochre"
          />
          只巡察，不动钱
        </label>
        <label className={`flex items-center gap-2 text-sm ${capUnset ? 'text-gray-400' : 'text-gray-700'}`}>
          <input
            type="radio"
            name="autonomy_mode"
            disabled={capUnset}
            checked={draftMode === 'bounded_auto'}
            onChange={() => onChange('bounded_auto')}
            className="accent-me-ochre"
          />
          在每天上限内自动调整预算 / 暂停广告（需要先设好上面的每天上限）
        </label>
      </div>
    </div>
  )
}

function VideoRow({ entry, label }: { entry: CreativePoolEntry; label: CreativeLabel | undefined }) {
  const number = videoNumber(entry)
  const fbUrl = label?.url ?? (/^\d+$/.test(number) ? `https://www.facebook.com/reel/${number}` : null)
  return (
    <div className="min-w-0">
      <p className="truncate text-gray-800">
        {label ? label.title : <span className="text-amber-700">未能识别，请核对</span>}
        {label?.subtitle && <span className="text-gray-500"> · {label.subtitle}</span>}
      </p>
      <p className="text-xs text-gray-400">
        发布日期 {formatDate(label?.publishedAt ?? null)} · 编号 <span className="tabular-nums">{number}</span>
        {fbUrl && (
          <>
            {' '}·{' '}
            <a href={fbUrl} target="_blank" rel="noreferrer" className="text-gray-500 underline hover:text-gray-700">
              在 Facebook 打开
            </a>
          </>
        )}
      </p>
    </div>
  )
}

function CreativePoolList({
  clientId,
  entries,
  onApproved,
  onConflict,
}: {
  clientId: string
  entries: CreativePoolEntry[]
  onApproved: (config: AdStrategyConfig, version?: string | null) => void
  onConflict: () => void
}) {
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [labels, setLabels] = useState<Record<string, CreativeLabel>>({})
  const refKey = entries.map(e => e.ref).join(',')

  useEffect(() => {
    if (refKey === '') return
    let alive = true
    fetch(`/api/clients/${clientId}/ad-strategy-config/creative-pool/labels`)
      .then(r => (r.ok ? (r.json() as Promise<LabelsResponse>) : { labels: {} }))
      .then(j => { if (alive) setLabels(j.labels ?? {}) })
      .catch(() => { /* names stay "unrecognised"; never block approval UI */ })
    return () => { alive = false }
  }, [clientId, refKey])

  const approve = async (ref: string) => {
    if (!window.confirm('批准后这条视频才允许用于广告。不会自动开广告、不花钱。')) return
    setBusyRef(ref)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config/creative-pool/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref }),
      })
      const json = (await res.json()) as ConfigResponse
      if (res.status === 409) {
        setError(json.message ?? '素材池刚被别处改过，请刷新页面后再试。')
        onConflict()
        return
      }
      if (!res.ok || !json.config) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      // version_unreadable 时没有 version 键：传 undefined，让上层去刷新版本。
      onApproved(json.config, json.version_unreadable === true ? undefined : json.version)
    } catch (err) {
      setError(err instanceof Error ? err.message : '批准失败')
    } finally {
      setBusyRef(null)
    }
  }

  if (entries.length === 0) {
    return <p className="text-xs text-gray-400">还没有视频。</p>
  }

  return (
    <div className="space-y-2.5">
      {entries.map(e => (
        <div key={`${e.kind}:${e.ref}`} className="flex items-center justify-between gap-3 text-sm">
          <VideoRow entry={e} label={labels[e.ref]} />
          <div className="flex shrink-0 items-center gap-2">
            <span className={`text-xs ${e.status === 'approved' ? 'text-emerald-600' : 'text-gray-400'}`}>
              {e.status === 'approved'
                ? `已批准（${e.approved_by ?? '—'}）`
                : e.status === 'candidate'
                  ? '待批准'
                  : `自动流程：${EXTENDED_STATUS_LABELS[e.status] ?? e.status}`}
            </span>
            {e.status === 'candidate' && (
              <button
                type="button"
                disabled={busyRef !== null}
                onClick={() => approve(e.ref)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {busyRef === e.ref ? '批准中…' : '批准'}
              </button>
            )}
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/**
 * 清空一个账户的上限**不等于**"不设上限"——真正的判据
 * （`src/lib/capabilities/ads/envelope-facts.ts` 里 `perAccountCaps` 那段）分两种：
 *   · 这个客户只绑了 1 个账户 → 回落成**客户总闸**，等于把这个账户的额度抬到总闸
 *   · 绑了 2 个及以上 → 这个账户直接不许自动动钱
 * 第一种是放宽钱闸，所以清空必须二次确认，文案也要分开说（魏征复审 2026-10-19）。
 */
function clearConfirmText(accountCount: number, totalCap: number | null): string {
  if (accountCount <= 1) {
    const ceiling = totalCap == null ? '客户总闸（现在也没设）' : `客户总闸 $${centsToDisplay(totalCap)} / 天`
    return `清空后这个账户不是"没有上限"：因为这个客户只绑了一个广告账户，判据会回落成${ceiling}，等于把它的额度放宽。确定清空吗？`
  }
  return '清空后这个账户将不允许自动动钱（这个客户绑了 2 个及以上账户时的规则）。确定清空吗？'
}

/** 关掉显示 = 心跳整户跳过这个账户（超支提醒不响），所以和清空上限一样要二次确认；打开方向不拦。 */
const HIDE_CONFIRM_TEXT =
  '关掉后这个账户整户跳过心跳、超支提醒不会响、广告健康页也不再列它。确定关掉吗？'

function HealthPageSwitch({
  shown,
  busy,
  onChange,
}: {
  shown: boolean
  busy: boolean
  onChange: (shown: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-700">
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-label="在广告健康页显示"
        disabled={busy}
        onClick={() => onChange(!shown)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
          shown ? 'bg-gray-800' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
            shown ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      在广告健康页显示
    </label>
  )
}

function AccountCapRowEditor({
  row,
  draft,
  busy,
  visibilityBusy,
  onDraftChange,
  onSave,
  onShownChange,
}: {
  row: AccountCapRow
  draft: string
  busy: boolean
  visibilityBusy: boolean
  onDraftChange: (v: string) => void
  onSave: () => void
  onShownChange: (shown: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="tabular-nums text-gray-800">{row.ad_account_id}</span>
      <input
        type="number"
        min={0.01}
        step="0.01"
        value={draft}
        onChange={e => onDraftChange(e.target.value)}
        placeholder="未设"
        className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums text-gray-800 focus:border-gray-400 focus:outline-none"
      />
      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
      >
        保存
      </button>
      <span className="text-xs text-gray-400">
        当前：
        <span className="tabular-nums text-gray-600">
          {row.daily_budget_cap_cents == null ? '未设' : `$${centsToDisplay(row.daily_budget_cap_cents)} / 天`}
        </span>
      </span>
      <HealthPageSwitch shown={row.hidden_from_ad_health !== true} busy={visibilityBusy} onChange={onShownChange} />
    </div>
  )
}

/** 留空（null）是合法的「清空」；NaN 或 <= 0 不是。 */
function capDraftIsUsable(parsed: number | null): boolean {
  return !Number.isNaN(parsed) && (parsed === null || parsed > 0)
}

function flagVisibility(row: AccountCapRow): AccountCapRow {
  return { ...row, hidden_from_ad_health: row.hidden_from_ad_health === true }
}

async function fetchAccountCaps(clientId: string): Promise<AccountCapsResponse> {
  const res = await fetch(`/api/clients/${clientId}/ad-accounts`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as AccountCapsResponse
}

/** 账户级上限的读取与保存都收在这里，`AccountCapList` 只负责画。 */
function useAccountCaps(clientId: string) {
  const [rows, setRows] = useState<AccountCapRow[] | null>(null)
  const [totalCap, setTotalCap] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchAccountCaps(clientId)
      .then(j => {
        if (!alive) return
        const list = (j.accounts ?? []).map(flagVisibility)
        setRows(list)
        setTotalCap(j.client_total_cap_cents ?? null)
        setDrafts(Object.fromEntries(list.map(r => [r.ad_account_id, centsToDisplay(r.daily_budget_cap_cents)])))
      })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [clientId])

  const save = async (adAccountId: string) => {
    const parsed = displayToCents(drafts[adAccountId] ?? '')
    if (!capDraftIsUsable(parsed)) {
      setMessage('每天上限要填大于 0 的金额；留空表示清空这个账户的上限（清空会二次确认）')
      return
    }
    // 清空是放宽钱闸的一种（单账户客户会回落成客户总闸），所以要二次确认。
    if (parsed === null && !window.confirm(clearConfirmText(rows?.length ?? 0, totalCap))) {
      return
    }
    setBusyId(adAccountId)
    setMessage(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-accounts/${adAccountId}/daily-cap`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_budget_cap_cents: parsed }),
      })
      const json = (await res.json()) as { daily_budget_cap_cents?: number | null; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const saved = typeof json.daily_budget_cap_cents === 'number' ? json.daily_budget_cap_cents : null
      setRows(prev => prev?.map(r => (r.ad_account_id === adAccountId ? { ...r, daily_budget_cap_cents: saved } : r)) ?? prev)
      setDrafts(prev => ({ ...prev, [adAccountId]: centsToDisplay(saved) }))
      setMessage('已保存')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusyId(null)
    }
  }

  return { rows, setRows, totalCap, drafts, setDrafts, busyId, message, loadFailed, save }
}

/** 开关先跟着点的方向走，接口回来后再改成它返回的结果；失败则弹回并显示原文。 */
function useHealthVisibility(
  clientId: string,
  setRows: React.Dispatch<React.SetStateAction<AccountCapRow[] | null>>,
) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef<string | null>(null)

  const setShown = async (adAccountId: string, shown: boolean, previousHidden: boolean) => {
    if (inflight.current !== null) return
    if (!shown && !window.confirm(HIDE_CONFIRM_TEXT)) return
    inflight.current = adAccountId
    setError(null)
    setBusyId(adAccountId)
    setRows(prev => prev?.map(r => (
      r.ad_account_id === adAccountId ? { ...r, hidden_from_ad_health: !shown } : r
    )) ?? prev)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-accounts/${adAccountId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden_from_ad_health: !shown }),
      })
      const json = (await res.json()) as { hidden_from_ad_health?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const hidden = json.hidden_from_ad_health === true
      setRows(prev => prev?.map(r => (
        r.ad_account_id === adAccountId ? { ...r, hidden_from_ad_health: hidden } : r
      )) ?? prev)
    } catch (err) {
      setRows(prev => prev?.map(r => (
        r.ad_account_id === adAccountId ? { ...r, hidden_from_ad_health: previousHidden } : r
      )) ?? prev)
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      inflight.current = null
      setBusyId(null)
    }
  }

  return { visibilityBusyId: busyId, visibilityError: error, setShown }
}

function AccountCapList({ clientId }: { clientId: string }) {
  const { rows, setRows, totalCap, drafts, setDrafts, busyId, message, loadFailed, save } = useAccountCaps(clientId)
  const { visibilityBusyId, visibilityError, setShown } = useHealthVisibility(clientId, setRows)
  if (loadFailed) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        读不到各账户的每天上限，没有显示输入框（怕把真实值存成空白）
      </div>
    )
  }

  if (rows === null) {
    return <div className="text-sm text-gray-400 py-4">加载中…</div>
  }

  if (rows.length === 0) {
    return <p className="text-xs text-gray-400">这个客户还没绑定广告账户</p>
  }

  return (
    <div className="space-y-2.5">
      {rows.map(row => (
        <AccountCapRowEditor
          key={row.ad_account_id}
          row={row}
          draft={drafts[row.ad_account_id] ?? ''}
          busy={busyId !== null}
          visibilityBusy={visibilityBusyId !== null}
          onDraftChange={v => setDrafts(prev => ({ ...prev, [row.ad_account_id]: v }))}
          onSave={() => void save(row.ad_account_id)}
          onShownChange={shown => void setShown(row.ad_account_id, shown, row.hidden_from_ad_health === true)}
        />
      ))}
      {message && <p className="text-xs text-gray-500">{message}</p>}
      {visibilityError && <p className="text-xs text-red-600">{visibilityError}</p>}
      <p className="text-xs text-gray-400">关掉「在广告健康页显示」后，广告健康页不再列出这个账户，超支提醒也不会盯着它。打开后从下一次心跳 / 明早体检起生效；今日实时面板最多一分钟后更新。</p>
      <p className="text-xs text-gray-400">
        客户总闸：
        <span className="tabular-nums text-gray-600">
          {totalCap == null ? '未设' : `$${centsToDisplay(totalCap)} / 天`}
        </span>
      </p>
      <p className="text-xs text-gray-400">各账户加起来不能超过客户总闸；超了保存会被拒绝</p>
      <p className="text-xs text-gray-400">
        清空某个账户的上限不等于「不设上限」：这个客户只绑 1 个账户时，判据会回落成客户总闸（等于放宽）；绑了 2 个及以上时，没填上限的账户不许自动动钱。
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AutonomySettings({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<AdStrategyConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [draftCap, setDraftCap] = useState('')
  const [draftMode, setDraftMode] = useState<AutonomyMode>('observe')
  const [draftRefs, setDraftRefs] = useState('')
  const [version, setVersion] = useState<string | null | undefined>(undefined)

  const applyConfig = (c: AdStrategyConfig, v?: string | null) => {
    setConfig(c)
    setDraftCap(centsToDisplay(c.daily_budget_cap_cents))
    setDraftMode(c.autonomy_mode)
    if (v !== undefined) setVersion(v)
  }

  const load = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`)
      const json = (await res.json()) as ConfigResponse
      if (!res.ok || !json.config) throw new Error(json.error ?? `HTTP ${res.status}`)
      applyConfig(json.config, json.version)
    } catch {
      setLoadError('读不到广告自治配置，稍后再试')
    }
  }

  /**
   * 只刷新 config 和 version，**不碰**用户正在编辑的草稿。
   * 409 之后用它：服务端值变了，但用户没保存的上限/模式不能被冲掉。
   */
  const refreshFromServer = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`)
      const json = (await res.json()) as ConfigResponse
      if (!res.ok || !json.config) throw new Error(json.error ?? `HTTP ${res.status}`)
      setConfig(json.config)
      if (json.version !== undefined) setVersion(json.version)
      return true
    } catch {
      setMessage('读不到最新设置，请刷新页面。')
      return false
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </div>
    )
  }

  if (!config) {
    return <div className="text-sm text-gray-400 py-4">加载中…</div>
  }

  /**
   * 批准成功：只套用新配置和版本，**不碰**用户正在编辑的草稿
   * （同一页上没保存的上限/模式不能被冲掉）。
   * 服务端读不到版本时再刷一次版本。
   */
  const handleApproved = (c: AdStrategyConfig, v?: string | null) => {
    setConfig(c)
    if (v !== undefined) setVersion(v)
    if (v === undefined) {
      void refreshFromServer().then(ok => {
        // 读不到版本就置为未知，下次保存不带 expected_version。
        if (!ok) setVersion(undefined)
      })
    }
  }

  const capUnset = draftCap.trim() === '' && config.daily_budget_cap_cents == null
  const newRefs = draftRefs.split('\n').map(r => r.trim()).filter(Boolean)
  const existingRefs = new Set(config.creative_pool.map(e => e.ref))
  const freshRefs = [...new Set(newRefs)].filter(r => !existingRefs.has(r))

  // 单独保存客户总闸：和账户级保存按钮体验一致，用户改完数字可以直接存，不用滚到最底部。
  // 只 PATCH daily_budget_cap_cents，不动模式、不动素材池；expected_version 也不带（这个字段只在素材池并发时才有意义）。
  const saveTotalCap = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const parsedCap = displayToCents(draftCap)
      if (parsedCap !== null && (!Number.isInteger(parsedCap) || parsedCap <= 0)) {
        setMessage('每天上限要填大于 0 的金额')
        return
      }
      if (parsedCap === config.daily_budget_cap_cents) {
        setMessage('没有改动')
        return
      }
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_budget_cap_cents: parsedCap }),
      })
      const json = (await res.json()) as ConfigResponse
      if (!res.ok || !json.config) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      applyConfig(json.config, json.version)
      setMessage('已保存')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const body: Record<string, unknown> = {}

      const parsedCap = displayToCents(draftCap)
      if (parsedCap !== null && (!Number.isInteger(parsedCap) || parsedCap <= 0)) {
        setMessage('每天上限要填大于 0 的金额')
        return
      }
      if (parsedCap !== config.daily_budget_cap_cents) body.daily_budget_cap_cents = parsedCap
      if (draftMode !== config.autonomy_mode) body.autonomy_mode = draftMode

      // 只在提交新候选时才动素材池。服务端会保留已有素材的批准状态，但会带上
      // 页面加载时的版本；页面太旧时服务端返回 409，界面刷新后让用户重做。
      // 素材池只是这次保存的一部分：它有问题时不能连带取消预算/模式的修改。
      const skippedExisting = newRefs.length > 0 && freshRefs.length === 0
      const versionUnknown = newRefs.length > 0 && freshRefs.length > 0 && version === undefined
      if (freshRefs.length > 0 && version !== undefined) {
        body.creative_pool = [
          ...config.creative_pool.map(e => ({ kind: e.kind, ref: e.ref, status: 'candidate' })),
          ...freshRefs.map(ref => ({ kind: 'meta_video', ref, status: 'candidate' })),
        ]
        // version 可能是 null（库里还没有设置行），也必须带上。
        body.expected_version = version
      }

      if (Object.keys(body).length === 0) {
        // 全是重复 / 已存在的编号：不发请求，也不清空输入框，让用户自己改。
        if (skippedExisting) {
          setMessage('这些视频编号已经在列表里了，没有需要添加的')
        } else if (versionUnknown) {
          setMessage('读不到页面版本，请刷新页面后再添加素材')
        } else {
          setMessage('没有改动')
        }
        return
      }

      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as ConfigResponse
      if (res.status === 409) {
        // 素材池被别处改过：刷新到最新配置和版本，但保留用户填的编号，方便直接再点保存。
        setMessage(json.message ?? '素材池刚被别处改过，请刷新页面后再保存。')
        await refreshFromServer()
        return
      }
      if (!res.ok || !json.config) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)

      applyConfig(json.config, json.version)
      if (skippedExisting) {
        // 编号已存在：预算/模式照常保存，但不清空输入框，让用户自己改。
        setMessage('编号已存在，预算/模式已保存')
      } else if (versionUnknown) {
        setMessage('预算/模式已保存；素材没有添加：读不到页面版本，请刷新页面后再添加')
      } else {
        setDraftRefs('')
        setMessage('已保存')
      }
      // 服务端读不到版本：先把版本刷回来，读不到就置为未知，下次保存不带 expected_version。
      if (json.version_unreadable === true) {
        const ok = await refreshFromServer()
        if (!ok) setVersion(undefined)
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-800">目标 · 每天最多花多少 · 可用于广告的视频</h2>

      <div className="mt-4 space-y-5">
        <div>
          <span className="block text-sm font-medium text-gray-700">目标</span>
          <p className="mt-1 text-xs text-gray-500">目标在「目标」页设置，日报第一行会显示进度</p>
          <Link
            href={`/dashboard/clients/${clientId}/goals/history`}
            className="mt-1 inline-block text-xs text-gray-500 hover:text-gray-700"
          >
            去看目标 →
          </Link>
        </div>

        <CapField
          draftCap={draftCap}
          currentCap={config.daily_budget_cap_cents}
          onChange={setDraftCap}
          onSave={saveTotalCap}
          saving={saving}
        />

        <ModeField draftMode={draftMode} capUnset={capUnset} onChange={setDraftMode} />

        <div>
          <span className="block text-sm font-medium text-gray-700">每个广告账户各自每天最多花多少</span>
          <p className="mt-1 text-xs text-gray-400">
            上面那个是这个客户所有账户加起来的总闸；下面是每个账户各自的上限。客户绑了 2 个及以上账户时，没填自己上限的账户不允许自动动钱。
          </p>
          <div className="mt-1.5">
            <AccountCapList clientId={clientId} />
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700">可用于广告的视频</span>
          <p className="mt-1 text-xs text-gray-400">
            只有在这里批准过的视频，广告自动化才允许拿去投。批准本身不会开广告、不花钱。
          </p>
          <div className="mt-1.5">
            <CreativePoolList
              clientId={clientId}
              entries={config.creative_pool}
              onApproved={handleApproved}
              onConflict={() => { void refreshFromServer() }}
            />
          </div>
          <textarea
            value={draftRefs}
            onChange={e => setDraftRefs(e.target.value)}
            rows={3}
            placeholder="添加待批准的视频（每行填一个 Facebook 视频编号）"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
          />
          <p className="mt-1 text-xs text-amber-700">
            添加新视频不会影响已批准的视频。如果这个页面打开很久了，保存时会提示「已被别处改过」，按提示刷新后再保存即可。
          </p>
          {version === undefined && newRefs.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">读不到页面版本，请刷新页面后再添加素材。</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>
    </div>
  )
}
