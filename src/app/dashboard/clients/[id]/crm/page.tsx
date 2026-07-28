'use client'

/**
 * 今天该联系谁。
 *
 * 分段照搬 PM 在 Google Sheet 第 4 个 tab 里手工维护的那份（客户已回信 →
 * 已约回电 → 新 lead 待首联），只是让系统自己算，不用人再填一遍状态。
 *
 * 手机优先：销售在外面用这一页，一屏一个人，电话邮箱点一下就拨。
 *
 * 写入（Phase1）：打完电话点「记一笔」，系统自己读懂这通电话；顺手能把人
 * 改到下一步。卡片默认保持干净 —— 一屏一张表单会让销售直接关掉，所以
 * 输入框只在点了之后才展开。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Segment =
  | 'replied' | 'callback_due' | 'new_untouched'
  | 'retry_channel' | 'nurture_future' | 'excluded'

interface Row {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  segment: Segment
  temperature: 'hot' | 'warm' | 'cold' | 'off'
  reason: string
  suggestedChannel: 'phone' | 'sms' | 'email' | 'none'
  dueAt: string | null
  lastNote: string | null
}

/** 不在今天名单上的人：已成交 / 明确拒绝 / 以后才走。要能翻回来。 */
interface OffRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  segment: Segment
  reason: string
  lastNote: string | null
}

interface Payload {
  worklist: Row[]
  offList: OffRow[]
  counts: Record<Segment, number>
  totalContacts: number
  truncated: boolean
  error?: string
}

interface StageOption {
  stageKey: string
  label: string
}

const SEGMENT_LABEL: Record<Segment, string> = {
  replied: '客户回话了',
  callback_due: '约好的时间到了',
  new_untouched: '新进线，没人碰过',
  retry_channel: '电话打不通',
  nurture_future: '以后才走',
  excluded: '别再联系',
}

/** 顺序即优先级，跟接口排出来的一致。 */
const GROUPS: Segment[] = ['replied', 'callback_due', 'new_untouched', 'retry_channel']

const CHANNEL_HINT: Record<Row['suggestedChannel'], string> = {
  phone: '打电话',
  sms: '发短信',
  email: '发邮件',
  none: '别联系',
}

function Stat({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-3 text-center">
      <p className={`text-2xl font-black ${strong && n > 0 ? 'text-[#C2453A]' : 'text-me-charcoal'}`}>{n}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-me-charcoal/45">{label}</p>
    </div>
  )
}

/**
 * 「记一笔」输入框。
 *
 * 幂等键在挂载时生成一次、整个提交生命周期复用 —— 双击不会记成两笔。
 * （若在点击时才生成，每次点击都是新键，重复提交就挡不住了。）
 */
function ComposeNote({
  clientId,
  row,
  stages,
  onDone,
  onCancel,
}: {
  clientId: string
  row: Row
  stages: StageOption[]
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const [clientRef] = useState(() => globalThis.crypto.randomUUID())
  const [note, setNote] = useState('')
  const [inbound, setInbound] = useState(false)
  const [nextStage, setNextStage] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!note.trim() || saving) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: row.contactId,
          direction: inbound ? 'inbound' : 'outbound',
          note: note.trim(),
          clientRef,
        }),
      })
      const json = (await res.json()) as { error?: string; created?: boolean }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      // created=false 说明这一笔之前就存过（同一个记录框重试）。要说出来，
      // 否则用户以为补写的内容存上了，其实服务端保留的是第一版。
      if (json.created === false) {
        onDone('这一笔之前已经记过了，没有重复记')
        return
      }

      // 顺手把人改到下一步（可跳过）。改失败不能吞——用户以为推进了其实没有。
      if (nextStage && nextStage !== row.stage) {
        const stageRes = await fetch(
          `/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toStage: nextStage }),
          },
        )
        if (!stageRes.ok) {
          onDone('✓ 记好了，但这一步没改上，再点一下试试')
          return
        }
      }
      onDone('✓ 记好了')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '没存上，再试一次')
    } finally {
      setSaving(false)
    }
  }

  const pill = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs font-bold ${on ? 'bg-me-charcoal text-white' : 'bg-me-ivory text-me-charcoal/50'}`

  return (
    <div className="mt-3 rounded-lg border border-black/10 bg-me-ivory p-3">
      <div className="mb-2 flex gap-2">
        <button onClick={() => setInbound(false)} className={pill(!inbound)}>我联系的</button>
        <button onClick={() => setInbound(true)} className={pill(inbound)}>客户来找的</button>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        autoFocus
        placeholder="这次聊了什么？例：聊得不错，想明年三月去，问了长城那个团"
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none"
      />

      {stages.length > 0 && (
        <div className="mt-2">
          <label className="text-xs text-me-charcoal/50">要更新他到哪一步吗？（可跳过）</label>
          <select
            value={nextStage}
            onChange={(e) => setNextStage(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          >
            <option value="">不改，就记这一笔</option>
            {stages.map((s) => (
              <option key={s.stageKey} value={s.stageKey}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {err && <p className="mt-2 text-xs font-semibold text-[#C2453A]">⚠ {err}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={!note.trim() || saving}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:bg-me-charcoal/30"
        >
          {saving ? '存着…' : '存这一笔'}
        </button>
        <button onClick={onCancel} className="text-sm text-me-charcoal/40">取消</button>
      </div>
    </div>
  )
}

function PersonCard({
  clientId,
  row,
  stages,
  onSaved,
}: {
  clientId: string
  row: Row
  stages: StageOption[]
  onSaved: (msg: string) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  const btn = 'rounded-lg border border-me-stone px-3 py-2 text-sm font-semibold text-me-charcoal'

  const changeStage = async (toStage: string, label: string) => {
    if (!window.confirm(`现在：${row.stageLabel ?? '还没分步骤'} → 改成「${label}」？`)) return
    setChangingStage(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage }),
      })
      if (!res.ok) throw new Error()
      onSaved('✓ 改好了')
    } catch {
      onSaved('没改上，再试一次')
    }
  }

  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate font-black text-me-charcoal">{row.name}</h3>
        <span className="shrink-0 rounded-full bg-me-charcoal px-2.5 py-1 text-[11px] font-black text-white">
          {CHANNEL_HINT[row.suggestedChannel]}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-me-charcoal/70">{row.reason}</p>

      {row.lastNote && (
        <p className="mt-2 rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/60">
          上次：{row.lastNote}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.phone && <a href={`tel:${row.phone}`} className={btn}>📞 {row.phone}</a>}
        {row.email && <a href={`mailto:${row.email}`} className={`${btn} break-all`}>✉️ {row.email}</a>}

        {stages.length > 0 && (
          <button
            onClick={() => setChangingStage((v) => !v)}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-me-charcoal/60"
          >
            现在：{row.stageLabel ?? '还没分步骤'}
          </button>
        )}
      </div>

      {changingStage && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stages
            .filter((s) => s.stageKey !== row.stage)
            .map((s) => (
              <button
                key={s.stageKey}
                onClick={() => void changeStage(s.stageKey, s.label)}
                className="rounded-full bg-me-ivory px-3 py-1.5 text-xs font-bold text-me-charcoal"
              >
                {s.label}
              </button>
            ))}
        </div>
      )}

      {!composing ? (
        <button
          onClick={() => setComposing(true)}
          className="mt-3 w-full rounded-lg bg-me-charcoal py-2.5 text-sm font-black text-white"
        >
          打完了，记一笔
        </button>
      ) : (
        <ComposeNote
          clientId={clientId}
          row={row}
          stages={stages}
          onCancel={() => setComposing(false)}
          onDone={(msg) => { setComposing(false); onSaved(msg) }}
        />
      )}
    </article>
  )
}

/**
 * 不在今天名单上的人。
 *
 * 已成交 / 已付定金 / 明确拒绝 / 以后才走的人不该占着今天的名单，但必须能翻回来 ——
 * 「已付定金」「即将出行」恰恰是最需要继续跟进的两批（催余款、确认行程），
 * 而且点错了也得能改回来。没有这一块，一次误点这个人就在系统里失踪了。
 */
function OffList({
  clientId,
  rows,
  stages,
  onSaved,
}: {
  clientId: string
  rows: OffRow[]
  stages: StageOption[]
  onSaved: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  if (rows.length === 0) return null

  const kw = q.trim().toLowerCase()
  const shown = kw
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          (r.phone ?? '').includes(kw) ||
          (r.email ?? '').toLowerCase().includes(kw),
      )
    : rows

  const changeStage = async (row: OffRow, toStage: string, label: string) => {
    if (!window.confirm(`现在：${row.stageLabel ?? '还没分步骤'} → 改成「${label}」？`)) return
    setEditing(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage }),
      })
      if (!res.ok) throw new Error()
      onSaved('✓ 改好了')
    } catch {
      onSaved('没改上，再试一次')
    }
  }

  return (
    <section className="mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-left"
      >
        <span className="text-sm font-black text-me-charcoal">
          {open ? '▾' : '▸'} 不在今天名单上的人 · {rows.length}
        </span>
        <span className="ml-2 text-xs text-me-charcoal/45">已成交 / 以后才走 / 别再联系</span>
      </button>

      {open && (
        <div className="mt-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按名字、电话或邮箱找人"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none"
          />

          <div className="mt-3 space-y-2">
            {shown.map((r) => (
              <article key={r.contactId} className="rounded-xl border border-black/10 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="min-w-0 truncate text-sm font-black text-me-charcoal">{r.name}</h4>
                  {r.stageLabel && (
                    <span className="shrink-0 rounded-full bg-me-ivory px-2 py-0.5 text-[11px] font-bold text-me-charcoal/60">
                      {r.stageLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-me-charcoal/55">{r.reason}</p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {r.phone && (
                    <a href={`tel:${r.phone}`} className="rounded-lg border border-me-stone px-2.5 py-1.5 text-xs font-semibold text-me-charcoal">
                      📞 {r.phone}
                    </a>
                  )}
                  {r.email && (
                    <a href={`mailto:${r.email}`} className="break-all rounded-lg border border-me-stone px-2.5 py-1.5 text-xs font-semibold text-me-charcoal">
                      ✉️ {r.email}
                    </a>
                  )}
                  {stages.length > 0 && (
                    <button
                      onClick={() => setEditing(editing === r.contactId ? null : r.contactId)}
                      className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-semibold text-me-charcoal/60"
                    >
                      改一下他到哪步了
                    </button>
                  )}
                </div>

                {editing === r.contactId && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {stages
                      .filter((s) => s.stageKey !== r.stage)
                      .map((s) => (
                        <button
                          key={s.stageKey}
                          onClick={() => void changeStage(r, s.stageKey, s.label)}
                          className="rounded-full bg-me-ivory px-3 py-1.5 text-xs font-bold text-me-charcoal"
                        >
                          {s.label}
                        </button>
                      ))}
                  </div>
                )}
              </article>
            ))}
            {shown.length === 0 && (
              <p className="py-6 text-center text-sm text-me-charcoal/40">没找到这个人。</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** 新客人录进来。没有它，纯电话进线的客人就只能继续记在 Excel 里。 */
function NewContact({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 电话和邮箱指向两个不同的老客人 —— 多半是打错了，摆出来让人看。 */
  const [clash, setClash] = useState<{ name: string; phone: string | null; email: string | null }[] | null>(null)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setErr(null)
    setClash(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email }),
      })
      const json = (await res.json()) as {
        error?: string
        reason?: string
        candidates?: { name: string; phone: string | null; email: string | null }[]
      }
      if (res.status === 409 && json.reason === 'ambiguous') {
        setClash(json.candidates ?? [])
        setErr(json.error ?? '这个电话和邮箱分别属于两位已有的客人')
        return
      }
      if (!res.ok) throw new Error(json.error ?? '录入失败')
      setName(''); setPhone(''); setEmail(''); setOpen(false)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '录入失败')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none'

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-xl border border-dashed border-me-charcoal/25 py-2.5 text-sm font-bold text-me-charcoal/60"
      >
        + 新客人
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-black/10 bg-white p-4">
      <p className="mb-2 text-sm font-black text-me-charcoal">新客人打进来了</p>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名（可不填）" className={input} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="电话" className={input} inputMode="tel" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱（可不填）" className={input} inputMode="email" />
      </div>
      <p className="mt-2 text-xs text-me-charcoal/40">电话和邮箱至少填一个。已经在系统里的人不会重复建。</p>
      {err && <p className="mt-2 text-xs font-semibold text-[#C2453A]">⚠ {err}</p>}
      {clash && (
        <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 p-3">
          <p className="text-xs font-bold text-[#C2453A]">这两位已经在系统里了：</p>
          <ul className="mt-1 space-y-1">
            {clash.map((c, i) => (
              <li key={i} className="text-xs text-me-charcoal/70">
                · {c.name}　{c.phone ?? ''} {c.email ?? ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-me-charcoal/60">
            检查一下是不是号码或邮箱打错了。确实是同一个人的话，先只填一个联系方式。
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={saving || (!phone.trim() && !email.trim())}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:bg-me-charcoal/30"
        >
          {saving ? '存着…' : '存进来'}
        </button>
        <button onClick={() => setOpen(false)} className="text-sm text-me-charcoal/40">取消</button>
      </div>
    </div>
  )
}

export default function CrmTodayPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<Payload | null>(null)
  const [stages, setStages] = useState<StageOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, stageRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/crm/today`),
        fetch(`/api/clients/${clientId}/pipeline-stages`),
      ])
      const json = (await res.json()) as Payload
      if (!res.ok) { setError(json.error ?? '加载失败'); return }
      setData(json)
      if (stageRes.ok) {
        const s = (await stageRes.json()) as { stages?: StageOption[] }
        setStages((s.stages ?? []).map((x) => ({ stageKey: x.stageKey, label: x.label })))
      }
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const afterWrite = (msg: string) => {
    setToast(msg)
    void load()
    window.setTimeout(() => setToast(null), 2200)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <h1 className="mt-2 text-2xl font-black text-me-charcoal">今天该联系谁</h1>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/45">
          系统按所有渠道的接触记录自己排的 ——
          <span className="font-semibold text-me-charcoal/60">不用任何人去填状态。</span>
          说过别再联系的人已经被挡在名单外。
          <br />
          打完随手记一笔就行，名单系统自己更新。
        </p>
      </header>

      {toast && (
        <div className="sticky top-2 z-10 mb-3 rounded-xl bg-me-charcoal px-4 py-2 text-center text-sm font-black text-white">
          {toast}
        </div>
      )}

      {loading && !data && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm font-black text-me-charcoal underline">
            重试
          </button>
        </div>
      )}

      {!error && data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat n={data.counts.replied} label="回话了" strong />
            <Stat n={data.counts.callback_due} label="约好的到了" strong />
            <Stat n={data.counts.new_untouched} label="没人碰过" />
            <Stat n={data.counts.retry_channel} label="打不通" />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-me-charcoal/45">
            另有 <span className="font-semibold text-me-charcoal/70">{data.counts.nurture_future}</span> 人说了以后才走（现在打是打扰，进培育）、
            <span className="font-semibold text-me-charcoal/70"> {data.counts.excluded}</span> 人已排除（明确拒绝 / 号码作废 / 已经成交）。
            共 {data.totalContacts} 人。
          </p>

          <NewContact clientId={clientId} onDone={() => afterWrite('✓ 存进来了')} />

          {data.worklist.length === 0 && (
            <p className="py-12 text-center text-sm text-me-charcoal/45">今天没有需要联系的人。</p>
          )}

          {GROUPS.map((seg) => {
            const rows = data.worklist.filter((r) => r.segment === seg)
            if (rows.length === 0) return null
            return (
              <section key={seg} className="mt-6">
                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">
                  {SEGMENT_LABEL[seg]} · {rows.length}
                </p>
                <div className="space-y-3">
                  {rows.map((r) => (
                    <PersonCard
                      key={r.contactId}
                      clientId={clientId}
                      row={r}
                      stages={stages}
                      onSaved={afterWrite}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          {data.truncated && (
            <p className="mt-6 text-center text-xs text-me-charcoal/40">
              名单太长，这里只显示前 100 个 —— 先把上面的打完。
            </p>
          )}

          <OffList
            clientId={clientId}
            rows={data.offList ?? []}
            stages={stages}
            onSaved={afterWrite}
          />
        </>
      )}
    </div>
  )
}
