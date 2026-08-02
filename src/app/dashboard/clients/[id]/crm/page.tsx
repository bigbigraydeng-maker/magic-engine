'use client'

/**
 * 今天该联系谁 —— 看板。
 *
 * 六批人并排成列，一眼看全谁在哪一批、哪一批堆了人；点一个人从右侧滑出他的
 * 全部往来记录（表单 / 电话 / 私信，以后是邮件和外呼），在抽屉里记一笔、
 * 改到下一步。视觉和交互跟 admin/prospecting 的 CRM 看板一致。
 *
 * 为什么不是「一次只显示一批」：那个版本要点来点去才知道别的批里有什么，
 * 看不到全局 —— PM 的原话是 prospecting 那个更简单直观。
 *
 * 手机上列自动堆成竖排（销售在外面用这一页，横滑六列没法用）。
 *
 * 分批规则全在 lib/crm/segments 里算，页面不自己判断冷热。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { type StageOption } from './_components/ComposeNote'
import { CrmTabs } from './_components/CrmTabs'
import { PersonDrawer, type DrawerRow } from './_components/PersonDrawer'

type Segment =
  | 'replied' | 'callback_due' | 'travel_due' | 'new_untouched'
  | 'retry_channel' | 'stale_conversation' | 'nurture_future' | 'excluded'

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
  suggestedChannel: 'phone' | 'sms' | 'email' | 'messenger' | 'none'
  dueAt: string | null
  lastTouchAt: string | null
  lastNote: string | null
  pinned: boolean
  pinnedAt: string | null
  suggestedStage: { toStage: string; label: string; why: string } | null
}

interface OffRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  segment: Segment
  reason: string
  group: 'won' | 'later' | 'stop'
  lastNote: string | null
}

interface Bucket {
  segment: Segment
  label: string
  howTo: string
  batch: 'call_one_by_one' | 'send_email' | 'none'
  total: number
  truncated: boolean
  people: Row[]
  batchEmails: string[]
}

interface Payload {
  buckets: Bucket[]
  offList: OffRow[]
  counts: Record<Segment, number>
  totalContacts: number
  todoTotal: number
  doneToday: number
  /** 从抽屉里发私信时，发出去的话挂在谁名下。 */
  viewerEmail?: string | null
  error?: string
}

const OFF_GROUP_LABEL: Record<OffRow['group'], string> = {
  won: '已经成交 · 在走流程',
  later: '以后才走',
  stop: '不用再联系',
}

/** 客人正在等我们 / 购买窗口到了 —— 列头数字标红催一下。 */
const HOT: ReadonlySet<Segment> = new Set<Segment>(['replied', 'callback_due', 'travel_due'])

/** 「等了 3 天」。同一列里等得最久的排最前，卡片上要说出来。 */
function waitedText(iso: string | null): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `等了 ${days} 天`
  const hours = Math.floor(ms / 3_600_000)
  return hours >= 1 ? `等了 ${hours} 小时` : '刚刚'
}

/** 「约的是：今天 14:00（已经过了 3 小时）」—— 打之前一定要看见。 */
function dueText(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = d.toDateString() === now.toDateString()
    ? '今天'
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const lateH = Math.floor((now.getTime() - d.getTime()) / 3_600_000)
  if (lateH >= 24) return `${day} ${time}（过了 ${Math.floor(lateH / 24)} 天）`
  if (lateH >= 1) return `${day} ${time}（过了 ${lateH} 小时）`
  return `${day} ${time}`
}

/**
 * 「怎么联系他」—— 卡片底部那一条。
 *
 * 为什么必须在卡上、而不是点进去才看得到（PM 2026-08-02 反馈）：这一页一次铺
 * 几百张卡，每张多两次点击就等于没人用。
 *
 * 更要命的是**渠道对不对**：CTS 名单里 124 人（26%）没有电话号码，其中 106 人
 * 只有 Facebook 身份（从私信补挂进来的）。而「新客人，还没打过」这个桶的说明
 * 写着「越早打通越容易成」—— 销售点开发现根本打不了，这一页就开始不被信任。
 *
 * 渠道由后端按「他实际能被联系到什么」算好（segments 的 reachableChannel），
 * 这里只把它变成一个能当场点的动作。
 */
function ReachAction({ row }: { row: Row }) {
  const base = 'block border-t border-me-charcoal/8 px-3 py-2.5 text-[14px] font-bold'

  if ((row.suggestedChannel === 'phone' || row.suggestedChannel === 'sms') && row.phone) {
    return (
      <a
        href={`tel:${row.phone}`}
        onClick={(e) => e.stopPropagation()}
        className={`${base} bg-me-ivory/60 text-me-charcoal hover:bg-me-ivory`}
      >
        📞 {row.phone}
      </a>
    )
  }

  if (row.suggestedChannel === 'messenger') {
    return <p className={`${base} bg-me-ivory/40 text-me-charcoal/60`}>💬 没留电话 —— 只能在 Messenger 回他</p>
  }

  if (row.suggestedChannel === 'email') {
    return <p className={`${base} bg-me-ivory/40 text-me-charcoal/60`}>✉️ 没留电话 —— 只能发邮件</p>
  }

  return null
}

/**
 * 看板上的一张人卡。列很窄，只放最少的信息，其余进抽屉。
 *
 * 整张卡不能再是一个 <button> —— 图钉和「改阶段」提议都要能单独点，
 * 按钮套按钮既是非法 HTML，点击也会互相吞掉。所以主体是可点区域，
 * 另外两个动作各自成键。
 */
function Card({
  row,
  onOpen,
  onTogglePin,
  onAcceptStage,
}: {
  row: Row
  onOpen: () => void
  onTogglePin: (row: Row) => void
  onAcceptStage: (row: Row) => void
}) {
  const waited = waitedText(row.lastTouchAt)
  return (
    <div
      className={`relative mb-2 rounded-xl border bg-white shadow-sm transition ${
        row.pinned ? 'border-me-ochre/60' : 'border-me-charcoal/10 hover:border-me-ochre/50'
      }`}
    >
      {/* 图钉：钉住的人排在本桶最前 */}
      <button
        type="button"
        onClick={() => onTogglePin(row)}
        title={row.pinned ? '取消置顶' : '置顶到这一批最前面'}
        aria-label={row.pinned ? '取消置顶' : '置顶'}
        className={`absolute right-1.5 top-1.5 z-10 rounded-md px-1.5 py-1 text-[13px] leading-none transition ${
          row.pinned
            ? 'text-me-ochre'
            : 'text-me-charcoal/20 hover:bg-me-ivory hover:text-me-charcoal/50'
        }`}
      >
        {row.pinned ? '📌' : '📍'}
      </button>

      <button onClick={onOpen} className="block w-full p-3 pr-8 text-left">
        <div className="truncate text-[16px] font-black text-me-charcoal">{row.name}</div>
        <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-me-charcoal/65">{row.reason}</p>

        {row.dueAt && (
          <p className="mt-2 rounded-md bg-[#C2453A]/8 px-2 py-1 text-[13px] font-bold text-[#C2453A]">
            约的是：{dueText(row.dueAt)}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          {waited && <span className="text-[13px] text-me-charcoal/45">{waited}</span>}
          {row.stageLabel && (
            <span className="truncate rounded-full bg-me-ivory px-2 py-0.5 text-[12px] font-bold text-me-charcoal/60">
              {row.stageLabel}
            </span>
          )}
        </div>
      </button>

      {/* 怎么联系他 —— 卡上直接给，不用点进去。
          没号码的人绝不显示「打电话」：CTS 名单里 124 人（26%）没有电话，
          其中 106 人只有 Facebook 身份。让销售去打一个打不了的人，这一页就废了。 */}
      <ReachAction row={row} />

      {/* 系统提议改阶段 —— 提议，不自动改。点一下才生效。 */}
      {row.suggestedStage && (
        <div className="border-t border-me-charcoal/8 bg-me-ivory/60 px-3 py-2">
          <p className="text-[13px] leading-snug text-me-charcoal/55">
            {row.suggestedStage.why}
          </p>
          <button
            type="button"
            onClick={() => onAcceptStage(row)}
            className="mt-1.5 w-full rounded-lg border border-me-ochre/40 bg-white px-2 py-1.5 text-[13px] font-bold text-me-ochre hover:bg-me-ochre/10"
          >
            改成「{row.suggestedStage.label}」
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 看板上的一列。
 *
 * 为什么默认只铺 12 张（2026-08-02 PM 截图反馈）：CTS 的「新客人，还没打过」
 * 有 140 人，整列一路拉到底，销售翻到第 30 张就没有「今天能做完」的感觉了 ——
 * 那正是他要逃离的 Excel 的感觉。
 *
 * **不是截断，是折叠**：人数照旧显示在列头（那是真实总数），下面一行明说
 * 「还有 128 人」并且点一下就全出来。系统按紧急程度排过序，最上面 12 个
 * 本来就是最该先打的；剩下的没有藏起来，只是没挡路。
 */
const CARDS_BEFORE_FOLD = 12

function BucketColumn({
  clientId,
  bucket,
  onOpen,
  onTogglePin,
  onAcceptStage,
  onLogged,
}: {
  clientId: string
  bucket: Bucket
  onOpen: (row: Row) => void
  onTogglePin: (row: Row) => void
  onAcceptStage: (row: Row) => void
  onLogged: (msg: string, reload?: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? bucket.people : bucket.people.slice(0, CARDS_BEFORE_FOLD)
  // 折起来的人数要算上后端封顶没发过来的那些 —— 只数手上这一批会少报，
  // 让人以为「展开就能看到全部」。
  const folded = bucket.total - shown.length

  return (
    <div className="lg:w-[260px] lg:flex-none">
      <div className="mb-2 rounded-lg bg-white px-2.5 py-2 lg:bg-transparent lg:px-1 lg:py-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[14px] font-black tracking-wide text-me-charcoal/70">
            {bucket.label}
          </span>
          <span
            className={`text-lg font-black ${
              HOT.has(bucket.segment) && bucket.total > 0 ? 'text-[#C2453A]' : 'text-me-charcoal/70'
            }`}
          >
            {bucket.total}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-me-charcoal/45">{bucket.howTo}</p>
      </div>

      {bucket.batch === 'send_email' && (
        <BatchEmail clientId={clientId} bucket={bucket} onLogged={onLogged} />
      )}

      {shown.map((r) => (
        <Card
          key={r.contactId}
          row={r}
          onOpen={() => onOpen(r)}
          onTogglePin={onTogglePin}
          onAcceptStage={onAcceptStage}
        />
      ))}

      {bucket.total === 0 && (
        <p className="rounded-xl border border-dashed border-me-charcoal/10 py-4 text-center text-[13px] text-me-charcoal/30">
          这批清空了 ✓
        </p>
      )}

      {folded > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full rounded-xl border border-dashed border-me-charcoal/20 py-2.5 text-[13px] font-bold text-me-charcoal/55 hover:border-me-ochre/50 hover:text-me-charcoal"
        >
          还有 {folded} 人 —— 展开
        </button>
      )}

      {expanded && (
        <>
          {/* 后端每列最多发 300 个。展开后仍然差的那些要照实说，
              否则「展开」看起来像是给全了。 */}
          {bucket.truncated && (
            <p className="py-1 text-center text-[12px] text-me-charcoal/40">
              还有 {bucket.total - bucket.people.length} 人没显示（这一批太大了）
            </p>
          )}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="w-full py-2 text-[13px] font-bold text-me-charcoal/40 hover:text-me-charcoal"
          >
            收起
          </button>
        </>
      )}
    </div>
  )
}

/**
 * 整批一起发邮件（只有「打过没人接」这一批有）。
 *
 * 🔴 密送是红线：地址粘进「收件人」栏，这一批客人就互相看到了彼此的邮箱 ——
 * 属于未经同意披露个人信息，而且客人一眼看出是群发。所以按钮上不写「群发」
 * 二字（那会诱导他粘进收件人栏），警告常驻、不折叠。
 */
function BatchEmail({
  clientId,
  bucket,
  onLogged,
}: {
  clientId: string
  bucket: Bucket
  onLogged: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const [logging, setLogging] = useState(false)
  const [clientRef] = useState(() => globalThis.crypto.randomUUID())

  const emails = bucket.batchEmails
  if (emails.length === 0) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join('; '))
      setCopied(true)
      setFailed(false)
      window.setTimeout(() => setCopied(false), 4000)
    } catch {
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
        body: JSON.stringify({
          contactIds: bucket.people.map((p) => p.contactId),
          note: '群发了一封邮件',
          clientRef,
        }),
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

  const missing = bucket.total - emails.length

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-2 w-full rounded-lg border border-me-charcoal/15 bg-white py-2 text-[13px] font-bold text-me-charcoal/70"
      >
        ✉️ 给这批发邮件（{emails.length}）
      </button>
    )
  }

  return (
    <div className="mb-2 rounded-xl border border-me-charcoal/10 bg-white p-2.5">
      <button
        onClick={() => void copy()}
        className="w-full rounded-lg bg-me-charcoal py-2 text-[13px] font-black text-white"
      >
        {copied ? '✓ 已复制 —— 记得粘到「密送」' : `复制这 ${emails.length} 个邮箱`}
      </button>

      <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 px-2 py-1.5">
        <p className="text-[12px] font-black leading-snug text-[#C2453A]">
          ⚠️ 一定要粘进「密送 / BCC」那一栏
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-me-charcoal/65">
          粘到「收件人」栏的话，这 {emails.length} 位客人会互相看到对方的邮箱。
        </p>
      </div>

      <ol className="mt-1.5 space-y-0.5 text-[12px] leading-snug text-me-charcoal/50">
        <li>① 点上面按钮复制</li>
        <li>② 新建邮件，收件人填你自己</li>
        <li>③ 地址粘到「密送 / BCC」</li>
      </ol>

      {failed && (
        <textarea
          readOnly
          value={emails.join('; ')}
          rows={3}
          className="mt-1.5 w-full rounded-lg border border-me-charcoal/10 bg-me-ivory px-2 py-1 text-[12px]"
        />
      )}

      {missing > 0 && (
        <p className="mt-1.5 text-[12px] text-me-charcoal/45">另有 {missing} 人没留邮箱。</p>
      )}

      <button
        onClick={() => void logSent()}
        disabled={logging}
        className="mt-2 w-full rounded-lg border border-me-stone py-1.5 text-[13px] font-bold text-me-charcoal disabled:opacity-40"
      >
        {logging ? '记着…' : '都发出去了，帮我记一笔'}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="mt-1 w-full text-[12px] text-me-charcoal/35"
      >
        收起
      </button>
    </div>
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

  const input = 'w-full rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none'

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-me-charcoal/25 px-3 py-1.5 text-sm font-bold text-me-charcoal/60"
      >
        + 新客人
      </button>
    )
  }

  return (
    <div className="w-full rounded-xl border border-me-charcoal/10 bg-white p-4 sm:max-w-sm">
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
              <li key={i} className="text-xs text-me-charcoal/70">· {c.name}　{c.phone ?? ''} {c.email ?? ''}</li>
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

/**
 * 不在今天名单上的人。
 *
 * 已成交 / 明确拒绝 / 以后才走的人不该占着今天的名单，但必须能翻回来 ——
 * 「已付定金」「即将出行」恰恰最需要继续跟进（催余款、确认行程），而且点错了
 * 也得能改回来。没有这一块，一次误点这个人就在系统里失踪了。
 */
function OffList({
  rows,
  onOpen,
}: {
  rows: OffRow[]
  onOpen: (r: OffRow) => void
}) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null

  return (
    <section className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-xl border border-me-charcoal/10 bg-white px-4 py-3 text-left"
      >
        <span className="text-sm font-black text-me-charcoal">
          {open ? '▾' : '▸'} 不在今天名单上的人 · {rows.length}
        </span>
        <span className="ml-2 text-xs text-me-charcoal/45">已成交 / 以后才走 / 不用再联系</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {(['won', 'later', 'stop'] as const).map((g) => {
            const list = rows.filter((r) => r.group === g)
            if (list.length === 0) return null
            return (
              <div key={g}>
                <p className="mb-2 text-[13px] font-black tracking-[0.08em] text-me-ochre">
                  {OFF_GROUP_LABEL[g]} · {list.length}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((r) => (
                    <button
                      key={r.contactId}
                      onClick={() => onOpen(r)}
                      className="rounded-xl border border-me-charcoal/10 bg-white p-3 text-left hover:border-me-ochre/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-[16px] font-black text-me-charcoal">{r.name}</span>
                        {r.stageLabel && (
                          <span className="shrink-0 rounded-full bg-me-ivory px-2 py-0.5 text-[12px] font-bold text-me-charcoal/55">
                            {r.stageLabel}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] text-me-charcoal/55">{r.reason}</p>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
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
  const [localDone, setLocalDone] = useState(0)
  const [q, setQ] = useState('')
  /** 点开的那个人（看板卡片 / 搜索结果 / 名单外的人 都用同一个抽屉）。 */
  const [picked, setPicked] = useState<DrawerRow | null>(null)

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
   * reload=false 用于「记一笔」：抽屉还开着，这时重拉整块看板会让脚下的列表
   * 跳动、人凭空消失。人数用本地计数先顶上，关掉抽屉或手动刷新时再对齐。
   */
  const afterWrite = (msg: string, reload = true) => {
    setToast(msg)
    if (reload) void load()
    else setLocalDone((n) => n + 1)
    window.setTimeout(() => setToast(null), 2200)
  }

  /** 图钉：钉住的人排在本桶最前。 */
  const togglePin = async (row: Row) => {
    const next = !row.pinned
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
        credentials: 'include',
      })
      if (!res.ok) throw new Error('操作失败')
      afterWrite(next ? `已置顶 ${row.name}` : `已取消置顶 ${row.name}`)
    } catch {
      afterWrite('置顶失败，请重试', false)
    }
  }

  /** 接受系统提议的阶段变更 —— 人点了才改。 */
  const acceptStage = async (row: Row) => {
    if (!row.suggestedStage) return
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toStage: row.suggestedStage.toStage,
          note: `系统提议：${row.suggestedStage.why}`,
        }),
        credentials: 'include',
      })
      if (!res.ok) throw new Error('操作失败')
      afterWrite(`${row.name} 已改为「${row.suggestedStage.label}」`)
    } catch {
      afterWrite('改阶段失败，请重试', false)
    }
  }

  const buckets = data?.buckets ?? []
  const doneToday = (data?.doneToday ?? 0) + localDone

  // 搜全部人：看板各列 + 不在名单上的，合起来就是这个客户的所有人。
  const kw = q.trim().toLowerCase()
  const searching = kw.length > 0
  const found: Row[] = searching
    ? [
        ...buckets.flatMap((b) => b.people),
        ...(data?.offList ?? []).map((o) => ({
          ...o,
          temperature: 'off' as const,
          suggestedChannel: 'none' as const,
          dueAt: null,
          lastTouchAt: null,
          // 不在名单上的人不参与置顶排序，也不给阶段提议 ——
          // 他们已经是结论性状态（成交 / 拒绝 / 以后才走）。
          pinned: false,
          pinnedAt: null,
          suggestedStage: null,
        })),
      ].filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          (r.phone ?? '').replace(/\s/g, '').includes(kw.replace(/\s/g, '')) ||
          (r.email ?? '').toLowerCase().includes(kw),
      )
    : []

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-4">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-me-charcoal">今天该联系谁</h1>
            <p className="mt-1 text-sm text-me-charcoal/45">
              系统按所有渠道的往来自己分的批 —— 点一个人看他的全部记录、记一笔。
            </p>
          </div>
          <CrmTabs clientId={clientId} active="today" />
        </div>
      </header>

      {toast && (
        <div className="sticky top-2 z-30 mb-3 rounded-xl bg-me-charcoal px-4 py-2 text-center text-sm font-black text-white">
          {toast}
        </div>
      )}

      {loading && !data && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm font-black underline">重试</button>
        </div>
      )}

      {!error && data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {/* 客户打回来了要能几秒内找到他 —— 搜的是全部人，不只今天名单上的 */}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 客户打回来了？按名字 / 电话 / 邮箱找他"
              className="min-w-[240px] flex-1 rounded-xl border border-me-charcoal/15 bg-white px-4 py-2 text-sm focus:border-me-charcoal focus:outline-none"
            />
            <NewContact clientId={clientId} onDone={() => afterWrite('✓ 存进来了')} />
            {doneToday > 0 && (
              <span className="rounded-full bg-me-ochre/12 px-3 py-1.5 text-xs font-black text-me-ochre">
                今天已联系 {doneToday} 人 👍
              </span>
            )}
          </div>

          {searching ? (
            <section>
              <p className="mb-2 text-xs font-bold text-me-charcoal/45">找到 {found.length} 人</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {found.map((r) => (
                  <Card key={r.contactId} row={r} onOpen={() => setPicked(r)} onTogglePin={togglePin} onAcceptStage={acceptStage} />
                ))}
              </div>
              {found.length === 0 && (
                <p className="py-10 text-center text-sm text-me-charcoal/40">没找到这个人。</p>
              )}
            </section>
          ) : (
            <>
              {/* 看板：宽屏并排成列，手机堆成竖排 */}
              <div className="flex flex-col gap-3 lg:flex-row lg:overflow-x-auto lg:pb-2">
                {buckets.map((b) => (
                  <BucketColumn
                    key={b.segment}
                    clientId={clientId}
                    bucket={b}
                    onOpen={(r) => setPicked(r)}
                    onTogglePin={togglePin}
                    onAcceptStage={acceptStage}
                    onLogged={afterWrite}
                  />
                ))}
              </div>

              <p className="mt-3 text-xs leading-relaxed text-me-charcoal/45">
                另有 {data.counts.nurture_future} 人今天不用打（说了以后才走，到时间系统会捞回来）。
                再有 {data.counts.excluded} 人不用再联系（明确拒绝 / 号码作废 / 已经成交）。
              </p>

              {data.todoTotal === 0 && (
                <p className="py-12 text-center text-sm text-me-charcoal/45">今天没有需要联系的人。</p>
              )}

              <OffList rows={data.offList ?? []} onOpen={(r) => setPicked(r)} />
            </>
          )}
        </>
      )}

      {picked && (
        <PersonDrawer
          clientId={clientId}
          row={picked}
          stages={stages}
          viewerEmail={data?.viewerEmail ?? null}
          onClose={() => { setPicked(null); void load() }}
          onSaved={afterWrite}
        />
      )}
    </div>
  )
}
