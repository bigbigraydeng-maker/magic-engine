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
import { ComposeNote, type StageOption } from './_components/ComposeNote'
import { CrmTabs } from './_components/CrmTabs'

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
  lastTouchAt: string | null
  lastNote: string | null
}

/** 「今天 下午 2:00（已经过了 3 小时）」—— 销售拿起电话前一定会想「我约的几点」。 */
function dueText(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = sameDay
    ? '今天'
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const lateH = Math.floor((now.getTime() - d.getTime()) / 3_600_000)
  if (lateH >= 24) return `${day} ${time}（已经过了 ${Math.floor(lateH / 24)} 天）`
  if (lateH >= 1) return `${day} ${time}（已经过了 ${lateH} 小时）`
  return `${day} ${time}`
}

/** 「等了 3 天」。同桶内排序也按这个，销售才知道为什么先打这个。 */
function waitedText(iso: string | null): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days >= 1) return `等了 ${days} 天`
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return hours >= 1 ? `等了 ${hours} 小时` : '刚刚'
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
  /** 为什么不在今天名单上：成交了 / 以后才走 / 不用再联系。 */
  group: 'won' | 'later' | 'stop'
  lastNote: string | null
}

const OFF_GROUP_LABEL: Record<OffRow['group'], string> = {
  won: '已经成交 · 在走流程',
  later: '以后才走',
  stop: '不用再联系',
}

/** 一桶 = 一批「同一种人、同一个做法」。一次只做一桶。 */
interface Bucket {
  segment: Segment
  label: string
  /** 这批人该怎么办（后端和页面共用一份文案，见 lib/crm/segments）。 */
  howTo: string
  batch: 'call_one_by_one' | 'send_email' | 'none'
  total: number
  truncated: boolean
  people: Row[]
  /** 整桶群发用的邮箱（只有「该发邮件」的桶才有）。 */
  batchEmails: string[]
}

interface Payload {
  buckets: Bucket[]
  offList: OffRow[]
  counts: Record<Segment, number>
  totalContacts: number
  todoTotal: number
  /** 今天已经联系了多少人 —— 没有进度感的名单永远像干不完。 */
  doneToday: number
  error?: string
}

const CHANNEL_HINT: Record<Row['suggestedChannel'], string> = {
  phone: '打电话',
  sms: '发短信',
  email: '发邮件',
  none: '别联系',
}

/** 前两桶是烫的（客户在等我们），数字标红催一下。 */
const HOT: ReadonlySet<Segment> = new Set<Segment>(['replied', 'callback_due'])

/**
 * 选桶。一次只做一桶 —— 这是这一页的核心。
 *
 * 之前把 4 桶一次全铺：CTS 真实数据下 6 个「客户回话了」躺在 108 个
 * 「打不通」中间，最该打的人反而看不见。
 */
function BucketTabs({
  buckets,
  active,
  onPick,
}: {
  buckets: Bucket[]
  active: Segment | null
  onPick: (s: Segment) => void
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {buckets.map((b, i) => {
        const on = b.segment === active
        const empty = b.total === 0
        return (
          <button
            key={b.segment}
            // 空桶不 disable：点了给一句「这批清空了」，比点了毫无反应像卡死强。
            onClick={() => onPick(b.segment)}
            ref={(el) => {
              // 选中的桶自动滚进视野 —— 4 个桶在小屏放不下，系统自动选中第 5 桶时
              // 高亮的那个会掉在屏幕外，销售只会觉得页面错乱。
              if (on && el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }}
            className={`shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition ${
              on
                ? 'border-me-charcoal bg-me-charcoal text-white'
                : empty
                  ? 'border-black/5 bg-white text-me-charcoal/35'
                  : 'border-black/10 bg-white text-me-charcoal'
            }`}
          >
            <p
              className={`text-xl font-black leading-none ${
                on ? 'text-white' : HOT.has(b.segment) && !empty ? 'text-[#C2453A]' : ''
              }`}
            >
              {empty ? '✓' : b.total}
            </p>
            <p className={`mt-1 whitespace-nowrap text-xs font-bold ${on ? 'text-white/85' : 'text-me-charcoal/65'}`}>
              {i + 1}. {b.label}
            </p>
          </button>
        )
      })}
    </div>
  )
}

/**
 * 整桶一起发邮件。
 *
 * 「打过没人接」是最大的一桶（CTS 108 人）。让销售一个个点开再打一遍，是在
 * 重复已经失败过的动作。这批人该一次性发邮件 —— 复制出来粘进邮件客户端
 * 就能群发，不必等邮件系统接进来。
 *
 * 🔴 密送不是建议，是红线：地址粘进「收件人」栏，这 108 位客户就会互相看到
 * 彼此的邮箱 —— 这是未经同意披露个人信息，而且客户一眼看出是群发，
 * CTS 靠「人对人服务」建立的信任一封信就打回去了。所以按钮上不写「群发」
 * 二字（那会诱导他粘进收件人栏），警告必须常驻、不能折叠。
 */
function BatchEmail({
  clientId,
  emails,
  contactIds,
  total,
  onLogged,
}: {
  clientId: string
  emails: string[]
  contactIds: string[]
  total: number
  onLogged: (msg: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const [logging, setLogging] = useState(false)
  /** 幂等键：挂载时生成一次，同一批重复点不会重复记。 */
  const [clientRef] = useState(() => globalThis.crypto.randomUUID())

  if (emails.length === 0) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join('; '))
      setCopied(true)
      setFailed(false)
      window.setTimeout(() => setCopied(false), 4000)
    } catch {
      // 手机上复制常被浏览器挡掉。静默失败 = 销售以为页面坏了，必须给兜底。
      setFailed(true)
    }
  }

  const logSent = async () => {
    if (logging) return
    setLogging(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds, note: '群发了一封邮件', clientRef }),
      })
      const json = (await res.json()) as { recorded?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? '记不上')
      onLogged(`✓ 已经给 ${json.recorded ?? 0} 人各记了一笔`)
    } catch {
      onLogged('没记上，再点一下试试')
    } finally {
      setLogging(false)
    }
  }

  const missing = total - emails.length

  return (
    <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
      <button
        onClick={() => void copy()}
        className="w-full rounded-lg bg-me-charcoal py-2.5 text-sm font-black text-white"
      >
        {copied ? '✓ 已复制 —— 记得粘到「密送 / BCC」栏' : `复制这 ${emails.length} 个邮箱`}
      </button>

      <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 px-3 py-2">
        <p className="text-xs font-black leading-relaxed text-[#C2453A]">
          ⚠️ 一定要粘进「密送 / BCC」那一栏。
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-me-charcoal/70">
          粘到「收件人」栏的话，这 {emails.length} 位客人会互相看到对方的邮箱。
        </p>
      </div>

      <ol className="mt-2 space-y-0.5 text-xs leading-relaxed text-me-charcoal/55">
        <li>① 点上面按钮复制</li>
        <li>② 新建一封邮件，收件人填你自己</li>
        <li>③ 把复制的地址粘到「密送 / BCC」</li>
      </ol>

      {emails.length > 50 && (
        <p className="mt-2 text-xs text-me-charcoal/45">
          邮箱一次发不了这么多的话，分两次发。
        </p>
      )}

      {failed && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-semibold text-me-charcoal/60">
            复制不了？长按下面这段，全选复制：
          </p>
          <textarea
            readOnly
            value={emails.join('; ')}
            rows={3}
            className="w-full rounded-lg border border-black/10 bg-me-ivory px-2 py-1.5 text-[11px] text-me-charcoal/70"
          />
        </div>
      )}

      {missing > 0 && (
        <p className="mt-2 text-xs text-me-charcoal/45">
          还有 {missing} 人没留邮箱，只能逐个打或发短信。
        </p>
      )}

      {/* 发完不销账的话，这一桶明天打开还是同样的人数 —— 销售会认定这页记不住
          他做过什么，然后回去用 Excel。 */}
      <button
        onClick={() => void logSent()}
        disabled={logging}
        className="mt-3 w-full rounded-lg border border-me-stone py-2 text-sm font-bold text-me-charcoal disabled:opacity-40"
      >
        {logging ? '记着…' : '都发出去了，帮我记一笔'}
      </button>
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
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  /**
   * 刚记完的人留在原位、打个勾，下次刷新页面才真正消失。
   *
   * 记完就让他从列表里消失的话，下面所有人往上跳一格 —— 销售打到第 20 个
   * 抬头一看不认识了，不知道打到哪儿了。这是会让人退回 Excel 的那种小事。
   */
  const [justDone, setJustDone] = useState<string | null>(null)
  const btn = 'rounded-lg border border-me-stone px-3 py-2 text-sm font-semibold text-me-charcoal'

  const waited = waitedText(row.lastTouchAt)

  const changeStage = async (toStage: string, label: string) => {
    if (!window.confirm(`现在：${row.stageLabel ?? '还没标到哪一步'} → 改成「${label}」？`)) return
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

  // 记完的人：留在原位，灰掉打勾，不让下面的人往上跳。
  if (justDone) {
    return (
      <article className="rounded-xl border border-black/10 bg-me-ivory/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="min-w-0 truncate font-bold text-me-charcoal/40 line-through">{row.name}</h3>
          <span className="shrink-0 text-xs font-black text-me-charcoal/50">✓ {justDone}</span>
        </div>
      </article>
    )
  }

  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate font-black text-me-charcoal">{row.name}</h3>
        <span className="shrink-0 rounded-full bg-me-charcoal px-2.5 py-1 text-[11px] font-black text-white">
          {CHANNEL_HINT[row.suggestedChannel]}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <p className="text-sm text-me-charcoal/70">{row.reason}</p>
        {waited && <span className="text-xs font-semibold text-me-charcoal/35">· {waited}</span>}
      </div>

      {/* 约的几点 —— 不显示的话，客户一句「我们不是约的明天上午吗」就把销售问住了。 */}
      {row.dueAt && (
        <p className="mt-1.5 rounded-lg bg-[#C2453A]/8 px-3 py-1.5 text-xs font-bold text-[#C2453A]">
          约的是：{dueText(row.dueAt)}
        </p>
      )}

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
            现在：{row.stageLabel ?? '还没标到哪一步'}
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
          onDone={(msg) => {
            setComposing(false)
            // 本卡就地打勾（不重拉整页），列表不跳动，销售不会丢失位置。
            setJustDone(
              new Date().toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }),
            )
            onSaved(msg, false)
          }}
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
    if (!window.confirm(`现在：${row.stageLabel ?? '还没标到哪一步'} → 改成「${label}」？`)) return
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

          {(['won', 'later', 'stop'] as const).map((g) => {
            const list = shown.filter((r) => r.group === g)
            if (list.length === 0) return null
            return (
              <div key={g} className="mt-4">
                {/* 成交客户跟「明确拒绝」分开 —— 前者最该继续维护（催余款、确认行程），
                    混在一起叫「已排除」既刺眼又会让人不去碰他们。 */}
                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">
                  {OFF_GROUP_LABEL[g]} · {list.length}
                </p>
                <div className="space-y-2">
                  {list.map((r) => (
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
                </div>
              </div>
            )
          })}
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-me-charcoal/40">没找到这个人。</p>
          )}
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
  /** 用户点过的桶。没点过就自动落在最靠前的非空桶（= 最该先做的那批）。 */
  const [picked, setPicked] = useState<Segment | null>(null)
  /** 本次进页面之后记了几笔（不重拉整页时先本地顶上，让进度立刻可见）。 */
  const [localDone, setLocalDone] = useState(0)
  /** 顶部搜人：客户回拨过来，5 秒内要知道这是谁、上次聊到哪儿。 */
  const [q, setQ] = useState('')

  const buckets = data?.buckets ?? []
  // 没点过就自动落在第一个非空桶（最该先做的）。点过就听他的 —— 包括点到
  // 已经清空的桶，那时显示「这批清空了 ✓」，比默默跳到别的桶少一分意外。
  const activeSeg =
    (picked && buckets.find((b) => b.segment === picked)?.segment) ??
    buckets.find((b) => b.total > 0)?.segment ??
    null
  const active = buckets.find((b) => b.segment === activeSeg) ?? null
  const doneToday = (data?.doneToday ?? 0) + localDone

  // 搜全部人：今天名单上的（各桶）+ 不在名单上的，合起来就是这个客户的所有人。
  const kw = q.trim().toLowerCase()
  const searching = kw.length > 0
  const found: Row[] = searching
    ? [
        ...buckets.flatMap((b) => b.people),
        // 不在名单上的人字段少几个，补成卡片能用的形状（他们本来就没有约定时间）。
        ...(data?.offList ?? []).map((o) => ({
          ...o,
          temperature: 'off' as const,
          suggestedChannel: 'none' as const,
          dueAt: null,
          lastTouchAt: null,
        })),
      ].filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          (r.phone ?? '').replace(/\s/g, '').includes(kw.replace(/\s/g, '')) ||
          (r.email ?? '').toLowerCase().includes(kw),
      )
    : []

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

  /**
   * 写完之后。
   *
   * reload=false 用于「记一笔」：卡片已经就地打勾了，这时重拉整页会让这个人
   * 凭空消失、下面所有人往上跳一格，销售就丢失了自己打到哪儿。人数用本地
   * 计数先顶上，切桶或手动刷新时才跟服务端对齐。
   */
  const afterWrite = (msg: string, reload = true) => {
    setToast(msg)
    if (reload) void load()
    else setLocalDone((n) => n + 1)
    window.setTimeout(() => setToast(null), 2200)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-me-charcoal">今天该联系谁</h1>
          <CrmTabs clientId={clientId} active="today" />
        </div>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/45">
          人已经按情况分好了，<span className="font-semibold text-me-charcoal/60">一次做一批</span> ——
          点上面任意一批，只看这一批的人。
          <br />
          打完随手记一笔就行，名单系统自己更新。说过别再联系的人已经挡在外面。
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
          {/* 客户回拨过来，销售得在几秒内知道这是谁 —— 这一条不给，Excel 的
              Ctrl+F 就永远赢。搜的是全部人，不只今天名单上的。 */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 客户打回来了？按名字 / 电话 / 邮箱找他"
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm focus:border-me-charcoal focus:outline-none"
          />

          {searching ? (
            <section className="mt-4">
              <p className="mb-2 text-xs font-bold text-me-charcoal/45">
                找到 {found.length} 人
              </p>
              <div className="space-y-3">
                {found.map((r) => (
                  <PersonCard
                    key={r.contactId}
                    clientId={clientId}
                    row={r}
                    stages={stages}
                    onSaved={afterWrite}
                  />
                ))}
                {found.length === 0 && (
                  <p className="py-10 text-center text-sm text-me-charcoal/40">没找到这个人。</p>
                )}
              </div>
            </section>
          ) : (
            <>
              <p className="mb-2 mt-4 text-xs font-bold text-me-charcoal/40">
                从左往右做，左边最急
              </p>
              <BucketTabs buckets={data.buckets} active={activeSeg} onPick={setPicked} />

              {doneToday > 0 && (
                <p className="mt-2 text-xs font-bold text-me-ochre">
                  今天已经联系 {doneToday} 人 👍
                </p>
              )}

              <p className="mt-2 text-xs leading-relaxed text-me-charcoal/45">
                另有 {data.counts.nurture_future} 人今天不用打（说了以后才走，到时间系统会捞回来）。
                再有 {data.counts.excluded} 人不用再联系（明确拒绝 / 号码作废 / 已经成交）。
              </p>

              {data.todoTotal === 0 && (
                <p className="py-12 text-center text-sm text-me-charcoal/45">今天没有需要联系的人。</p>
              )}

              {picked && active && active.total === 0 && (
                <p className="mt-5 rounded-xl border border-black/10 bg-white py-8 text-center text-sm font-bold text-me-charcoal/45">
                  「{active.label}」这批今天清空了 ✓
                </p>
              )}

              {active && active.total > 0 && (
                <section className="mt-5">
                  <div className="rounded-xl border border-me-ochre/25 bg-me-ochre/8 px-4 py-3">
                    <p className="text-sm font-black text-me-charcoal">
                      {active.label} · {active.total} 人
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-me-charcoal/60">{active.howTo}</p>
                  </div>

                  <BatchEmail
                    clientId={clientId}
                    emails={active.batchEmails}
                    contactIds={active.people.map((p) => p.contactId)}
                    total={active.total}
                    onLogged={afterWrite}
                  />

                  <div className="mt-3 space-y-3">
                    {active.people.map((r) => (
                      <PersonCard
                        key={r.contactId}
                        clientId={clientId}
                        row={r}
                        stages={stages}
                        onSaved={afterWrite}
                      />
                    ))}
                  </div>

                  {active.truncated && (
                    <p className="mt-4 text-center text-xs text-me-charcoal/40">
                      这批人太多，先显示前 {active.people.length} 个 —— 打完刷新一下还有。
                    </p>
                  )}
                </section>
              )}

              <NewContact clientId={clientId} onDone={() => afterWrite('✓ 存进来了')} />
            </>
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
