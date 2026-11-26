'use client'

/**
 * 推广计划页里「投放素材已批准」那一行下面展开的清单：本计划用到的每条素材，
 * 在这里直接选推广期、批准，不用跳去广告健康页。
 * 权限、推广期校验、批准人（服务端从会话取）都在现有接口里，这里一律不放宽：
 *   POST …/ad-strategy-config/creative-pool/promo-window
 *   POST …/ad-strategy-config/creative-pool/approve
 */

import { useCallback, useEffect, useState } from 'react'

interface PoolEntry {
  kind: string
  ref: string
  status: string
  approved_by?: string | null
  promo_window?: { kind: 'dated'; start: string; end: string } | { kind: 'evergreen' }
}

type Draft = { mode: '' | 'dated' | 'evergreen'; start: string; end: string }
const EMPTY_DRAFT: Draft = { mode: '', start: '', end: '' }

const EXTENDED_STATUS: Record<string, string> = {
  pending_qc: '质检中', test_queue: '待测试', testing: '测试中', scaling: '放大中',
  rejected: '数据差已停', inconclusive: '没测成', retired: '已退役', manual_approved: '手批在跑',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function draftValid(d: Draft): boolean {
  if (d.mode === 'evergreen') return true
  return d.mode === 'dated' && DATE_RE.test(d.start) && DATE_RE.test(d.end) && d.start <= d.end
}

function windowText(w: PoolEntry['promo_window']): string {
  if (!w) return '还没声明'
  return w.kind === 'evergreen' ? '长期有效' : `${w.start} 至 ${w.end}`
}

async function readError(res: Response): Promise<string> {
  const j = await res.json().catch(() => null) as { error?: string; message?: string } | null
  return j?.message ?? j?.error ?? `HTTP ${res.status}`
}

interface Props {
  clientId: string
  /** 本计划这个阶段用到的素材编号；null = 读不到 */
  refs: string[] | null
  /** 当前账号能不能批准（服务端判定过 approver_only 时为 false） */
  canAct: boolean
  /** 批准成功后：让上层重读检查清单 */
  onChanged: () => void
}

export function CreativeApprovalList({ clientId, refs, canAct, onChanged }: Props) {
  const base = `/api/clients/${clientId}/ad-strategy-config`
  const [pool, setPool] = useState<PoolEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [forbidden, setForbidden] = useState(false)

  const loadPool = useCallback(async () => {
    try {
      const res = await fetch(base)
      if (!res.ok) throw new Error(await readError(res))
      const j = await res.json() as { config?: { creative_pool?: PoolEntry[] } }
      setPool(j.config?.creative_pool ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [base])

  useEffect(() => { void loadPool() }, [loadPool])

  useEffect(() => {
    let alive = true
    fetch(`${base}/creative-pool/labels`)
      .then(r => (r.ok ? r.json() : { labels: {} }))
      .then((j: { labels?: Record<string, { title?: string }> }) => {
        if (!alive) return
        const next: Record<string, string> = {}
        for (const [ref, l] of Object.entries(j.labels ?? {})) if (l?.title) next[ref] = l.title
        setNames(next)
      })
      .catch(() => { /* 读不到名字就只显示编号，不影响批准 */ })
    return () => { alive = false }
  }, [base])

  if (refs === null) {
    return <p className="mt-2 text-xs text-gray-500">读不到素材清单（这份计划的广告步骤没读出来），这一项保持红灯。</p>
  }
  if (refs.length === 0) {
    return <p className="mt-2 text-xs text-gray-500">这个阶段的广告步骤还没有指定素材：先在计划里填写。</p>
  }
  if (loadError) {
    return <p className="mt-2 text-xs text-red-600">素材池读不出来：{loadError}</p>
  }
  if (pool === null) {
    return <p className="mt-2 text-xs text-gray-400">读取素材池…</p>
  }

  const setDraft = (ref: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [ref]: { ...(prev[ref] ?? EMPTY_DRAFT), ...patch } }))

  const post = (path: string, body: unknown) => fetch(`${base}/creative-pool/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  const approve = async (entry: PoolEntry) => {
    if (!window.confirm('批准后这条视频才允许用于广告。不会自动开广告、不花钱。')) return
    setBusyRef(entry.ref)
    setErrors(prev => ({ ...prev, [entry.ref]: '' }))
    try {
      const draft = drafts[entry.ref] ?? EMPTY_DRAFT
      if (!entry.promo_window) {
        const promoWindow = draft.mode === 'evergreen'
          ? { kind: 'evergreen' }
          : { kind: 'dated', start: draft.start, end: draft.end }
        const r1 = await post('promo-window', { ref: entry.ref, promo_window: promoWindow })
        if (!r1.ok) {
          if (r1.status === 401 || r1.status === 403) setForbidden(true)
          throw new Error(await readError(r1))
        }
      }
      const r2 = await post('approve', { ref: entry.ref })
      if (!r2.ok) {
        if (r2.status === 401 || r2.status === 403) setForbidden(true)
        throw new Error(await readError(r2))
      }
      await loadPool()
      onChanged()
    } catch (e) {
      setErrors(prev => ({ ...prev, [entry.ref]: (e as Error).message }))
      await loadPool()
    } finally {
      setBusyRef(null)
    }
  }

  const blocked = !canAct || forbidden

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
      <p className="text-xs font-medium text-gray-700">本计划用到的素材（在这里直接批准，不用去别的页面）</p>
      {blocked && <p className="text-xs text-amber-700">批准素材需要 Magic Lab 内部账号；你现在这个账号只能看。</p>}
      {refs.map(ref => {
        const entry = pool.find(e => e.ref === ref)
        const title = names[ref] ? `${names[ref]}（${ref}）` : ref
        if (!entry) {
          return (
            <div key={ref} className="text-xs">
              <p className="text-gray-900 font-medium">{title}</p>
              <p className="text-red-600">不在素材池里：先把它加进素材池，或从计划的广告步骤里去掉。</p>
            </div>
          )
        }
        const draft = drafts[ref] ?? EMPTY_DRAFT
        const windowReady = Boolean(entry.promo_window) || draftValid(draft)
        const approvable = entry.status === 'candidate'
        const disabled = busyRef !== null || blocked || !windowReady
        return (
          <div key={ref} className="text-xs space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-gray-900 font-medium">{title}</p>
              <span className={entry.status === 'approved' ? 'text-emerald-600' : 'text-gray-500'}>
                {entry.status === 'approved' ? `已批准（${entry.approved_by ?? '—'}）`
                  : entry.status === 'candidate' ? '待批准'
                    : `自动流程：${EXTENDED_STATUS[entry.status] ?? entry.status}`}
              </span>
              <span className="text-gray-500">推广期：{windowText(entry.promo_window)}</span>
            </div>
            {approvable && !entry.promo_window && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  <input type="radio" name={`mode-${ref}`} checked={draft.mode === 'dated'} disabled={blocked}
                    onChange={() => setDraft(ref, { mode: 'dated' })} />有期限
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name={`mode-${ref}`} checked={draft.mode === 'evergreen'} disabled={blocked}
                    onChange={() => setDraft(ref, { mode: 'evergreen' })} />长期有效（画面里没有日期和价格）
                </label>
                {draft.mode === 'dated' && (
                  <>
                    <input type="date" aria-label={`${ref} 推广期开始`} value={draft.start} disabled={blocked}
                      onChange={e => setDraft(ref, { start: e.target.value })} className="rounded border border-gray-300 px-1.5 py-0.5" />
                    <span>至</span>
                    <input type="date" aria-label={`${ref} 推广期结束`} value={draft.end} disabled={blocked}
                      onChange={e => setDraft(ref, { end: e.target.value })} className="rounded border border-gray-300 px-1.5 py-0.5" />
                  </>
                )}
              </div>
            )}
            {approvable && (
              <div className="flex items-center gap-2">
                <button type="button" disabled={disabled} onClick={() => approve(entry)}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {busyRef === ref ? '批准中…' : '批准'}
                </button>
                {!blocked && !windowReady && <span className="text-gray-500">先选推广期</span>}
              </div>
            )}
            {errors[ref] && <p className="text-red-600">{errors[ref]}</p>}
          </div>
        )
      })}
    </div>
  )
}
