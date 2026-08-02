'use client'

/**
 * 楼盘管理 —— 中介名下每个开发项目在这里建档。
 *
 * 此前楼盘只能靠直接改数据库来建（违反 CLAUDE.md 铁律 8：FDE/PM 要填的字段
 * 必须连界面一起做完）。这一页就是那条写入路径。
 *
 * 界面上刻意突出两件事，因为它们最容易被漏掉：
 *   · 开票对象没填 —— 这单的钱不知道找谁要
 *   · 楼盘还没素材 —— 出片只能靠花钱生成
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  type ClientProject,
  type ProjectStatus,
} from '@/lib/clients/projects-store'

interface Props {
  clientId: string
  clientName: string
}

interface Draft {
  name: string
  status: ProjectStatus
  invoice_to_name: string
  invoice_to_contact: string
  invoice_to_email: string
  note: string
}

const emptyDraft = (): Draft => ({
  name: '',
  status: 'active',
  invoice_to_name: '',
  invoice_to_contact: '',
  invoice_to_email: '',
  note: '',
})

const draftFrom = (p: ClientProject): Draft => ({
  name: p.name,
  status: p.status,
  invoice_to_name: p.invoice_to_name ?? '',
  invoice_to_contact: p.invoice_to_contact ?? '',
  invoice_to_email: p.invoice_to_email ?? '',
  note: typeof p.brief?.note === 'string' ? (p.brief.note as string) : '',
})

export function ProjectsClient({ clientId, clientName }: Props) {
  const [projects, setProjects] = useState<ClientProject[]>([])
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({})
  const [listingCounts, setListingCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/projects`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? '读取失败')
      setProjects(json.projects ?? [])
      setAssetCounts(json.assetCounts ?? {})
      setListingCounts(json.listingCounts ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const isNew = editing === 'new'
      const url = isNew
        ? `/api/clients/${clientId}/projects`
        : `/api/clients/${clientId}/projects/${editing}`
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? '保存失败')
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-me-charcoal/60">
          {clientName} 名下的楼盘。每个楼盘各有自己的卖点、策略和素材，
          <span className="font-black text-me-charcoal/75">素材不会跨楼盘串用</span>。
        </p>
        <button
          onClick={() => { setDraft(emptyDraft()); setEditing('new') }}
          className="shrink-0 rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-black text-white hover:bg-me-charcoal/85"
        >
          + 新建楼盘
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-3">
          <p className="text-sm font-bold text-[#C2453A]">{error}</p>
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-me-charcoal/15 bg-white p-4">
          <p className="mb-3 text-sm font-black text-me-charcoal">
            {editing === 'new' ? '新建楼盘' : '修改楼盘'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="楼盘名字" hint="素材归属、开票、报告标题都用它">
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="例：30 Kiteroa Rothesay Bay"
                className={inputCls}
              />
            </Field>
            <Field label="状态">
              <select
                value={draft.status}
                onChange={e => setDraft(d => ({ ...d, status: e.target.value as ProjectStatus }))}
                className={inputCls}
              >
                {PROJECT_STATUSES.map(s => (
                  <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </Field>
            <Field label="发票开给谁" hint="楼盘开发商 —— 不是中介本人">
              <input
                value={draft.invoice_to_name}
                onChange={e => setDraft(d => ({ ...d, invoice_to_name: e.target.value }))}
                placeholder="开发商公司名"
                className={inputCls}
              />
            </Field>
            <Field label="开发商对接人">
              <input
                value={draft.invoice_to_contact}
                onChange={e => setDraft(d => ({ ...d, invoice_to_contact: e.target.value }))}
                placeholder="姓名 / 电话"
                className={inputCls}
              />
            </Field>
            <Field label="开发商邮箱">
              <input
                value={draft.invoice_to_email}
                onChange={e => setDraft(d => ({ ...d, invoice_to_email: e.target.value }))}
                placeholder="发票寄到哪个邮箱"
                className={inputCls}
              />
            </Field>
            <Field label="这个楼盘的卖点" hint="人群、价格带、跟别的楼盘怎么区分">
              <input
                value={draft.note}
                onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              disabled={saving || !draft.name.trim()}
              className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              onClick={() => { setEditing(null); setError(null) }}
              className="rounded-lg border border-me-charcoal/20 px-3 py-1.5 text-xs font-bold text-me-charcoal/70"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm font-semibold text-me-charcoal/45">读取中…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-me-charcoal/20 p-8 text-center">
          <p className="text-sm font-bold text-me-charcoal/60">还没有楼盘</p>
          <p className="mt-1 text-xs font-semibold text-me-charcoal/45">
            点右上角「新建楼盘」，把这个中介手上的开发项目建档。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map(p => {
            const assets = assetCounts[p.id] ?? 0
            const listings = listingCounts[p.id] ?? 0
            return (
              <div key={p.id} className="rounded-xl border border-me-charcoal/12 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-base font-black text-me-charcoal">{p.name}</p>
                      <span className="rounded bg-me-charcoal/8 px-1.5 py-0.5 text-[10px] font-black text-me-charcoal/60">
                        {PROJECT_STATUS_LABEL[p.status]}
                      </span>
                      {p.merged_from_client_id && (
                        <span className="rounded bg-me-ochre/12 px-1.5 py-0.5 text-[10px] font-bold text-me-ochre">
                          由旧客户档降级
                        </span>
                      )}
                    </div>
                    {typeof p.brief?.note === 'string' && p.brief.note && (
                      <p className="mt-1 text-xs font-semibold text-me-charcoal/55">{p.brief.note as string}</p>
                    )}
                    <BriefFacts brief={p.brief} />
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-semibold">
                      {/* 这两条是最容易漏的，漏了就说清楚漏了什么、后果是什么 */}
                      {p.invoice_to_name ? (
                        <span className="text-me-charcoal/55">发票开给：{p.invoice_to_name}</span>
                      ) : (
                        <span className="text-[#C2453A]">⚠️ 没填发票开给谁 —— 这单的钱不知道找谁要</span>
                      )}
                      {listings > 0 && (
                        <span className="text-me-charcoal/55">{listings} 套房</span>
                      )}
                      {assets > 0 ? (
                        <span className="text-me-charcoal/55">专属素材 {assets} 条</span>
                      ) : (
                        <span className="text-me-ochre">还没有专属素材 —— 出片只能靠花钱生成</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { setDraft(draftFrom(p)); setEditing(p.id) }}
                    className="shrink-0 rounded-lg border border-me-charcoal/20 px-2.5 py-1 text-[11px] font-bold text-me-charcoal/70 hover:border-me-charcoal/40"
                  >
                    修改
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] font-semibold text-me-charcoal/40">
        楼盘不能删 —— 删了它下面的素材会从「只能用于本楼盘」变成「哪都能用」，一次误删就把隔离打开了。
        要停就把状态改成「归档」。
      </p>

      <Link
        href={`/dashboard/clients/${clientId}`}
        className="inline-block text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
      >
        ← 返回工作台
      </Link>
    </div>
  )
}

/**
 * 楼盘档里已有的事实。
 *
 * 这些不是手填的 —— 是系统里已经跑出来的分析（listing_briefs / 张骞 Discovery）
 * 直接接过来。**存了不显示等于没存**，所以哪怕只有几条也要露出来。
 */
function BriefFacts({ brief }: { brief: Record<string, unknown> }) {
  const str = (k: string) => (typeof brief[k] === 'string' ? (brief[k] as string) : null)
  const arr = (k: string) => (Array.isArray(brief[k]) ? (brief[k] as unknown[]).map(String) : [])
  const market = (brief.market ?? {}) as Record<string, unknown>
  const num = (k: string) => (typeof market[k] === 'number' ? (market[k] as number) : null)

  const angles = arr('top_angles')
  const segments = arr('buyer_segments')
  const projectsKnown = arr('known_projects')
  const blockers = arr('blockers')
  const median = num('median_price')
  const yoy = num('yoy_change_pct')
  const openQ = typeof brief.open_questions_count === 'number' ? brief.open_questions_count : null

  const hasAny =
    angles.length || segments.length || projectsKnown.length || blockers.length ||
    median != null || str('school_zone') || str('source')
  if (!hasAny) return null

  return (
    <div className="mt-2 space-y-1.5 rounded-lg bg-me-charcoal/[0.03] p-2.5">
      {angles.length > 0 && <Row label="主打卖点" items={angles} />}
      {segments.length > 0 && <Row label="买家画像" items={segments} />}
      {projectsKnown.length > 0 && <Row label="已知项目" items={projectsKnown} />}
      {str('school_zone') && (
        <p className="text-[11px] font-semibold text-me-charcoal/55">学区：{str('school_zone')}</p>
      )}
      {median != null && (
        <p className="text-[11px] font-semibold text-me-charcoal/55">
          区域中位价 ${median.toLocaleString()}
          {yoy != null && (
            <span className={yoy < 0 ? 'text-[#C2453A]' : 'text-[#5C8A4A]'}>
              {' '}（同比 {yoy > 0 ? '+' : ''}{yoy}%）
            </span>
          )}
        </p>
      )}
      {blockers.length > 0 && (
        <p className="text-[11px] font-semibold text-me-ochre">
          还缺 {blockers.length} 项资料：{blockers.join('、')}
        </p>
      )}
      {openQ != null && openQ > 0 && (
        <p className="text-[11px] font-semibold text-me-ochre">
          分析报告里有 {openQ} 条存疑，对外用之前要核实
        </p>
      )}
      {str('source') && (
        <p className="text-[10px] font-semibold text-me-charcoal/35">来源：{str('source')}</p>
      )}
    </div>
  )
}

function Row({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-black text-me-charcoal/45">{label}</span>
      {items.map(x => (
        <span key={x} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-me-charcoal/65">
          {x}
        </span>
      ))}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-me-charcoal/20 px-2.5 py-1.5 text-sm font-semibold text-me-charcoal outline-none focus:border-me-ochre'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-black text-me-charcoal/70">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] font-semibold text-me-charcoal/40">{hint}</span>}
    </label>
  )
}
