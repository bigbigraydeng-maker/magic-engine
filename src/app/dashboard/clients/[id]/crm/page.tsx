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
// 从唯一那份定义引，**不要在这里再抄一遍**。
// 2026-08-03 就是抄的那份走散了：lib 里删掉了一个段，页面这份还留着，
// 两边对不上，tsc 才把它顶出来 —— 而它本可以一直静静地错下去。
import type { Segment } from '@/lib/crm/segments'
import { CONTACT_KIND_LABEL, type ContactKind } from '@/lib/crm/contact-kind'
import { countTrade, filterBucketByKind, type KindView } from '@/lib/crm/kind-filter'

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
  /** 今天已经有人联系过他 —— 卡片变浅，不用靠记。 */
  doneToday?: boolean
  /** 上次是谁跟的。不知道就是 null，页面不假装。 */
  lastBy?: string | null
  /** 他打开过邮件、之后没人跟。只是提示，不参与排序。 */
  openedDaysAgo?: number | null
  /** 被推迟到什么时候。今天名单上的人恒为 null —— 推迟的人已经被挡在外面。 */
  snoozeUntil?: string | null
  /** 终端客户还是同行。自己人根本不会出现在这一页（后端就丢掉了）。 */
  kind?: ContactKind
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
  group: 'won' | 'later' | 'stop' | 'snoozed' | 'fix_number'
  lastNote: string | null
  /** 被推迟到什么时候 —— 有值就能一键提前叫回来。 */
  snoozeUntil?: string | null
  kind?: ContactKind
}

type Layer = 'waiting' | 'acted' | 'queued'

interface Bucket {
  segment: Segment
  layer: Layer
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

/**
 * 三层的标题。
 *
 * 这一页只回答一个问题：**现在轮到人做什么**。
 * 第一层做完，今天就算过关；第二层是系统盯到有动作、自己浮上来的；
 * 第三层默认折起来 —— 那是库存，不是今天的活。
 */
const LAYERS: Array<{
  key: Layer
  title: string
  hint: string
  foldByDefault: boolean
  /** 整层的底色和圆点。**颜色本身就是优先级** —— 不用读字就知道哪块最急。 */
  band: string
  dot: string
  count: string
}> = [
  {
    key: 'waiting',
    title: '客人在等你',
    hint: '今天必须有人回。做完这一层，今天就算过关。',
    foldByDefault: false,
    band: 'bg-[#C2453A]/[0.055] border-[#C2453A]/20',
    dot: 'bg-[#C2453A]',
    count: 'text-[#C2453A]',
  },
  {
    key: 'acted',
    title: '他刚有动作',
    hint: '系统盯到的 —— 点了我们发的链接，人还热着。',
    foldByDefault: false,
    band: 'bg-me-ochre/[0.07] border-me-ochre/25',
    dot: 'bg-me-ochre',
    count: 'text-me-ochre',
  },
  {
    key: 'queued',
    title: '先放着的人',
    hint: '现在不用一个个打。他们一旦有动作，会自动跳到上面两层。',
    foldByDefault: true,
    band: 'bg-me-charcoal/[0.035] border-me-charcoal/10',
    dot: 'bg-me-taupe',
    count: 'text-me-charcoal/55',
  },
]

const OFF_GROUP_LABEL: Record<OffRow['group'], string> = {
  won: '已经成交 · 在走流程',
  later: '以后才走',
  // 被人手推迟的必须跟「规则排除的」分开显示 —— 混在一起，销售想把某个人
  // 提前叫回来，就得在一堆「明确拒绝」里找他上周随手放一放的那个人。
  snoozed: '你放一放的人 · 到期自己回来',
  // 号码抄错了的真客人，以前跟「明确拒绝」混在一起被永久静默排除。
  // 单拎出来是为了让它变成一件**有人能动手修**的事。
  fix_number: '号码是坏的 · 补一个对的就能继续跟',
  stop: '不用再联系',
}

/** 客人正在等我们 / 购买窗口到了 —— 列头数字标红催一下。 */
const HOT: ReadonlySet<Segment> = new Set<Segment>(['replied', 'callback_due', 'clicked_link'])

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
 * 跟进标记 —— 早上打开这一页，一眼回答「昨天跟到哪了」。
 *
 * 三条信息，按对早上那一刻的价值排：
 *  · 今天已经跟过 → 整张卡变浅 + 打勾，不用靠记
 *  · 上次谁跟的 → 两个销售同时跟一个客人，比谁都不跟更糟
 *  · 上次聊了什么 → 拿起电话前必须想起上下文
 *
 * 外加一条弱信号：**他打开过邮件**。它绝不参与排序、绝不进桶（Apple 会替
 * 用户自动打开邮件），但拿起电话时多一句「看到您看了我们的邮件」是有用的。
 */
function FollowUpMarks({ row }: { row: Row }) {
  const bits: string[] = []
  if (row.lastBy) bits.push(`上次 ${row.lastBy} 跟的`)
  if (typeof row.openedDaysAgo === 'number') {
    bits.push(row.openedDaysAgo <= 0 ? '今天打开过邮件' : `${row.openedDaysAgo} 天前打开过邮件`)
  }
  if (bits.length === 0 && !row.lastNote) return null

  return (
    <div className="border-t border-me-charcoal/8 px-3 py-2">
      {row.lastNote && (
        <p className="line-clamp-2 text-[13px] leading-snug text-me-charcoal/60">
          上次：{row.lastNote}
        </p>
      )}
      {bits.length > 0 && (
        <p className="mt-1 text-[12px] text-me-charcoal/40">{bits.join(' · ')}</p>
      )}
    </div>
  )
}

/**
 * 看板上的一张人卡。列很窄，只放最少的信息，其余进抽屉。
 *
 * 整张卡不能再是一个 <button> —— 图钉和「改阶段」提议都要能单独点，
 * 按钮套按钮既是非法 HTML，点击也会互相吞掉。所以主体是可点区域，
 * 另外两个动作各自成键。
 */
function Card({
  clientId,
  row,
  onOpen,
  onTogglePin,
  onAcceptStage,
  onLogged,
}: {
  clientId: string
  row: Row
  onOpen: () => void
  onTogglePin: (row: Row) => void
  onAcceptStage: (row: Row) => void
  onLogged: (msg: string, reload?: boolean) => void
}) {
  // 今天已经跟过的整张卡变浅 —— 销售扫一眼就知道还剩哪些没动，
  // 不用靠脑子记。鼠标移上去恢复，因为还是要能点进去看。
  const done = row.doneToday === true
  return (
    <div
      className={`relative rounded-xl border bg-white shadow-sm transition ${
        done ? 'opacity-50 hover:opacity-100' : ''
      } ${row.pinned ? 'border-me-ochre/60' : 'border-me-charcoal/10 hover:border-me-ochre/50'}`}
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
        <div className="flex items-baseline gap-1.5">
          {done && <span className="shrink-0 text-[13px] text-me-ochre" title="今天已经跟过了">✓</span>}
          <span className="truncate text-[16px] font-black text-me-charcoal">{row.name}</span>
          {/* 同行标记。**放在名字旁边、不放在最底下** —— 销售拿起电话之前
              必须先知道对面是同行还是散客，那决定他开口第一句话说什么。 */}
          {row.kind && row.kind !== 'retail' && (
            <span className="shrink-0 rounded-full bg-me-charcoal/8 px-1.5 py-0.5 text-[11px] font-bold text-me-charcoal/55">
              {CONTACT_KIND_LABEL[row.kind]}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-me-charcoal/65">{row.reason}</p>

        {row.dueAt && (
          <p className="mt-2 rounded-md bg-[#C2453A]/8 px-2 py-1 text-[13px] font-bold text-[#C2453A]">
            约的是：{dueText(row.dueAt)}
          </p>
        )}

        <div className="mt-1.5 flex items-center justify-between gap-2">
          {/* 原因里已经说了「等了多久」，这里不再用另一个单位重复一遍 ——
              「进线 835 小时还没人联系 / 等了 34 天」同一件事说两遍，
              单位还不一致，读的人要先做换算才能确认它们说的是同一件事。 */}
          <span />
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

      {/* 早上要一眼看懂的三件事：谁跟的、聊到哪了、他有没有打开过邮件 */}
      <FollowUpMarks row={row} />

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

      {/* 三个出口：推迟 / 他不买了 / 分错了。为什么不给「改分组」见 CardExits。 */}
      <CardExits clientId={clientId} row={row} onLogged={onLogged} />
    </div>
  )
}

/**
 * 卡片底部那排出口。
 *
 * PM 2026-08-03 问：「可以手动切换用户的分组吗？」答案是**不给**那个开关 ——
 * 手动维护的状态列必烂（CTS 那份手工 CRM 128 行里「阶段」列 0 个填了，
 * 自动提醒退化成 122 条一模一样的红字）。批次必须继续由系统从往来记录算。
 *
 * 但销售确实需要能表达三件事，否则名单会开始说假话，人就不再用它：
 *
 *   推迟    「三个月后再说」→ 改变系统看到的**事实**，到期自己回来
 *   不买了  「他明确说不要了」→ 一条结论性记录，走既有的排除规则
 *   分错了  「这条判断不对」→ **不改这个人**，只记下来去改规则
 *
 * 前两个是事实输入（系统据此重算），第三个根本不参与计算 —— 它是给我们看的。
 * 三个都不是「把这个人挪到另一批」，那只会把错误藏起来。
 */
function CardExits({
  clientId,
  row,
  onLogged,
}: {
  clientId: string
  row: Row
  onLogged: (msg: string, reload?: boolean) => void
}) {
  const [menu, setMenu] = useState<null | 'snooze' | 'wrong'>(null)
  const [busy, setBusy] = useState(false)

  const post = async (url: string, body: unknown, ok: string) => {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method: url.endsWith('/snooze') ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        onLogged(`没成功：${j.error ?? '请重试'}`)
        return
      }
      setMenu(null)
      onLogged(ok, true)
    } catch {
      onLogged('网络不通，没保存')
    } finally {
      setBusy(false)
    }
  }

  const base = 'rounded-md px-2 py-1 text-[12.5px] font-bold transition disabled:opacity-40'
  const quiet = `${base} text-me-charcoal/45 hover:bg-me-ivory hover:text-me-charcoal/80`

  return (
    <div className="border-t border-me-charcoal/8 px-2 py-1.5">
      {menu === null && (
        <div className="flex flex-wrap items-center gap-0.5">
          <button type="button" disabled={busy} onClick={() => setMenu('snooze')} className={quiet}>
            推迟
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void post(
                `/api/clients/${clientId}/crm/touchpoints`,
                {
                  contactId: row.contactId,
                  note: '他说不买了 —— 明确没兴趣',
                  // 结论直说，不让 AI 去猜。读成 unknown 的话这个人明天照旧
                  // 出现在名单上，而销售以为已经处理完了。
                  outcome: 'not_interested',
                  clientRef: crypto.randomUUID(),
                },
                '记下了 —— 他不会再出现在名单上',
              )
            }
            className={quiet}
          >
            他不买了
          </button>
          <button type="button" disabled={busy} onClick={() => setMenu('wrong')} className={quiet}>
            分错了
          </button>
        </div>
      )}

      {menu === 'snooze' && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[12.5px] text-me-charcoal/45">多久后再说？</span>
          {[
            { d: 7, label: '一周' },
            { d: 30, label: '一个月' },
            { d: 90, label: '三个月' },
          ].map((o) => (
            <button
              key={o.d}
              type="button"
              disabled={busy}
              onClick={() =>
                void post(
                  `/api/clients/${clientId}/crm/contacts/${row.contactId}/snooze`,
                  { days: o.d, clientRef: crypto.randomUUID() },
                  `先放着了 —— ${o.label}后他自己回来`,
                )
              }
              className={`${base} border border-me-charcoal/15 text-me-charcoal/70 hover:border-me-ochre/50`}
            >
              {o.label}
            </button>
          ))}
          <button type="button" onClick={() => setMenu(null)} className={quiet}>
            算了
          </button>
        </div>
      )}

      {menu === 'wrong' && (
        <WrongBucket
          clientId={clientId}
          row={row}
          busy={busy}
          onCancel={() => setMenu(null)}
          onSubmit={(note) =>
            void post(
              `/api/clients/${clientId}/crm/contacts/${row.contactId}/segment-feedback`,
              { segment: row.segment, reason: row.reason, note },
              '收到 —— 我们会去改规则，不是改他一个人',
            )
          }
        />
      )}
    </div>
  )
}

/**
 * 「这批分错了」。
 *
 * 理由**可以不填**：要求填理由会让这个动作变贵，然后就没人点，我们也就
 * 什么都收不到。一个不带理由的「分错了」仍然是有用的信号。
 */
function WrongBucket({
  row,
  busy,
  onCancel,
  onSubmit,
}: {
  clientId: string
  row: Row
  busy: boolean
  onCancel: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState('')
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] leading-snug text-me-charcoal/50">
        他不该在「{row.segment}」这一批？说一句哪儿不对（可以不说）。
        <b className="text-me-charcoal/70"> 这不会改他的分组</b> —— 我们拿它去改规则。
      </p>
      <div className="flex gap-1">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="哪儿不对？"
          className="min-w-0 flex-1 rounded-md border border-me-charcoal/15 px-2 py-1 text-[12.5px]"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(note)}
          className="shrink-0 rounded-md bg-me-charcoal px-2.5 py-1 text-[12.5px] font-bold text-white disabled:opacity-40"
        >
          报上去
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-bold text-me-charcoal/45"
        >
          算了
        </button>
      </div>
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

/**
 * 一个批次。
 *
 * **占满整行宽度，卡片在里面按网格排** —— 这里原来是一根固定 260px 的窄列，
 * 几根并排放在 1400px 的页面里，右边永远空着一大半（PM 2026-08-03：「大量留白，
 * 不够友好」）。而且列一多就要横向滚动，早上扫一眼这一页的人得左右拖。
 *
 * 现在一行摆 4 张卡，页面多宽就用多宽，窄屏自动掉成 1 列。
 */
function BucketBlock({
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
    // 缩进 + 左边一根细竖线：从属关系用位置说，不靠标题字号猜。
    // 上一版层和批次都是一行黑字，扫过去像六个平级的小标题（PM 2026-08-03）。
    <div className="border-l-2 border-me-charcoal/12 pl-3.5">
      {/* 标题行：批次名 + 人数 + 怎么做，一行说完，不占一整块 */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="text-[15px] font-black tracking-wide text-me-charcoal">
          {bucket.label}
        </span>
        <span
          className={`text-[19px] font-black leading-none ${
            HOT.has(bucket.segment) && bucket.total > 0 ? 'text-[#C2453A]' : 'text-me-charcoal/60'
          }`}
        >
          {bucket.total}
        </span>
        <p className="text-[13px] leading-snug text-me-charcoal/50">{bucket.howTo}</p>
      </div>

      {bucket.batch === 'send_email' && (
        <BatchEmail clientId={clientId} bucket={bucket} onLogged={onLogged} />
      )}

      {shown.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => (
            <Card
              key={r.contactId}
              clientId={clientId}
              row={r}
              onOpen={() => onOpen(r)}
              onTogglePin={onTogglePin}
              onAcceptStage={onAcceptStage}
              onLogged={onLogged}
            />
          ))}
        </div>
      )}

      {bucket.total === 0 && (
        <p className="rounded-xl border border-dashed border-me-charcoal/10 py-4 text-center text-[13px] text-me-charcoal/30">
          这批清空了 ✓
        </p>
      )}

      {folded > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-xl border border-dashed border-me-charcoal/20 py-2.5 text-[13px] font-bold text-me-charcoal/55 hover:border-me-ochre/50 hover:text-me-charcoal"
        >
          还有 {folded} 人 —— 展开
        </button>
      )}

      {expanded && (
        <>
          {/* 后端每批最多发 300 个。展开后仍然差的那些要照实说，
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
 * 一层。
 *
 * 「先放着的人」默认折起来 —— 那 354 人是库存，不是今天的活。把库存铺在
 * 「今天该联系谁」上，等于每天早上给销售看一座山；他做不完，就不再打开这一页。
 * 折起来但**人数照旧显示**，谁都能点开看，不是藏起来。
 */
function LayerSection({
  clientId,
  layer,
  buckets,
  onOpen,
  onTogglePin,
  onAcceptStage,
  onLogged,
}: {
  clientId: string
  layer: (typeof LAYERS)[number]
  buckets: Bucket[]
  onOpen: (row: Row) => void
  onTogglePin: (row: Row) => void
  onAcceptStage: (row: Row) => void
  onLogged: (msg: string, reload?: boolean) => void
}) {
  const [open, setOpen] = useState(!layer.foldByDefault)
  if (buckets.length === 0) return null

  const total = buckets.reduce((n, b) => n + b.total, 0)

  return (
    <section className={`mb-5 rounded-2xl border px-4 pb-4 pt-1 ${layer.band}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 py-3.5 text-left"
      >
        <span className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${layer.dot}`} />
        <span className="text-[19px] font-black tracking-tight text-me-charcoal">
          {open ? layer.title : `▸ ${layer.title}`}
        </span>
        <span className={`text-[19px] font-black leading-none tabular-nums ${layer.count}`}>{total}</span>
        <span className="text-[13px] text-me-charcoal/50">{layer.hint}</span>
      </button>

      {/* 折起来时也要说清里面装着什么 —— 只留一个数字，等于让人非展开不可，
          而这一层折起来的全部意义就是「今天不用看它」。 */}
      {!open && (
        <p className="pb-1 text-[13px] text-me-charcoal/50">
          {buckets.map((b, i) => (
            <span key={b.segment}>
              {i > 0 && <span className="mx-1.5 text-me-charcoal/25">·</span>}
              {b.label} <b className="tabular-nums text-me-charcoal/70">{b.total}</b>
            </span>
          ))}
          <span className="ml-1.5 text-me-charcoal/35">—— 点标题展开</span>
        </p>
      )}

      {open && (
        // 批次竖着堆，每个占满整行 —— 原来是并排的窄列 + 横向滚动，
        // 宽屏上右边空一大片，窄屏上要左右拖，两头都不讨好。
        <div className="flex flex-col gap-5">
          {buckets.map((b) => (
            <BucketBlock
              key={b.segment}
              clientId={clientId}
              bucket={b}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onAcceptStage={onAcceptStage}
              onLogged={onLogged}
            />
          ))}
        </div>
      )}
    </section>
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
  clientId,
  rows,
  onOpen,
  onLogged,
}: {
  clientId: string
  rows: OffRow[]
  onOpen: (r: OffRow) => void
  onLogged: (msg: string, reload?: boolean) => void
}) {
  const [open, setOpen] = useState(false)

  const unsnooze = async (r: OffRow) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${r.contactId}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: null, clientRef: crypto.randomUUID() }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        onLogged(`没成功：${j.error ?? '请重试'}`)
        return
      }
      onLogged(`${r.name} 回到今天的名单了`, true)
    } catch {
      onLogged('网络不通，没保存')
    }
  }

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
        <span className="ml-2 text-xs text-me-charcoal/45">你放一放的人 / 号码要修 / 已成交 / 以后才走 / 不用再联系</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* 「你放一放的人」排最前：这是唯一一组还可能被主动叫回来的 —— 其余三组
              都是结论已定。放最后等于让人翻半页才找得到自己上周放的那个人。 */}
          {(['snoozed', 'fix_number', 'won', 'later', 'stop'] as const).map((g) => {
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
                      {/* 提前叫回来。放在卡上而不是点进去 —— 「我早点联系他」是
                          这一组唯一会发生的动作，藏一层等于没有。 */}
                      {r.snoozeUntil && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            void unsnooze(r)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation()
                              e.preventDefault()
                              void unsnooze(r)
                            }
                          }}
                          className="mt-2 inline-block cursor-pointer rounded-md border border-me-charcoal/15 px-2 py-1 text-[12.5px] font-bold text-me-charcoal/60 hover:border-me-ochre/50 hover:text-me-charcoal"
                        >
                          现在就叫回来
                        </span>
                      )}
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
  /**
   * 只看终端客户 / 只看同行 / 全部。
   *
   * PM 2026-08-04：「今天该联系谁主要还是终端客户」。所以**默认只看终端客户** ——
   * CTS 的名单里同行占了相当一部分（House of Travel 四个门店、TravelManagers、
   * Orbit…），混在一起时销售会用「您考虑得怎么样了」去问一个每周订十次位的同行。
   *
   * 但绝不把同行藏掉：他们是真业务，只是跟进方式不同。切一下就全在。
   */
  const [kindView, setKindView] = useState<KindView>('retail')
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
        // 排序和阶段类型必须一起带过去 —— 抽屉要靠它们算出「下一步」和「出口」。
        setStages(
          (s.stages ?? []).map((x) => ({
            stageKey: x.stageKey,
            label: x.label,
            sortOrder: x.sortOrder,
            marketingAction: x.marketingAction,
            isTerminal: x.isTerminal,
          })),
        )
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

  // 待认领的 Facebook 对话数 —— 认不出是谁的消息不会进名单，
  // 不在这里提一句，这批人（CTS 142 段）就静静烂在后台没人知道。
  const [unclaimed, setUnclaimed] = useState(0)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/messenger/unclaimed`, {
          credentials: 'include',
        })
        if (!res.ok) return
        const json = await res.json()
        setUnclaimed(json.total ?? 0)
      } catch {
        // 拿不到就不显示这个入口，不影响主名单
      }
    })()
  }, [clientId])

  /**
   * 同行不参与分批和排序，只在这里被筛掉 —— 判据跟散客完全一样。
   *
   * 筛选逻辑在 lib/crm/kind-filter，**不写在这里**：它决定的不是显示什么，
   * 是谁会收到那封群发邮件。第一版就在这里错过一次（只筛了人、没筛群发地址），
   * 那种错误必须被单测钉住，而页面组件测不了。
   */
  const keepKind = (k: ContactKind | undefined) =>
    kindView === 'all' || (k ?? 'retail') === kindView

  const rawBuckets = data?.buckets ?? []
  const tradeCount = countTrade(rawBuckets, data?.offList ?? [])
  const buckets = rawBuckets.map((b) => filterBucketByKind(b, kindView))
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

        {unclaimed > 0 && (
          <Link
            href={`/dashboard/clients/${clientId}/crm/unclaimed`}
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-me-ochre/35 bg-me-ochre/8 px-4 py-2.5 transition hover:bg-me-ochre/15"
          >
            <span className="text-[13px] leading-snug text-me-charcoal/75">
              还有 <strong className="font-black text-me-ochre">{unclaimed}</strong> 条 Facebook 消息认不出是谁，
              没进下面的名单
            </span>
            <span className="flex-none text-[12px] font-black text-me-ochre">去认领 →</span>
          </Link>
        )}
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
            {/* 终端客户 / 同行。只有这个客户真的有同行时才显示 —— 一个永远是
                「0 同行」的切换器只是噪音。 */}
            {tradeCount > 0 && (
              <div className="flex overflow-hidden rounded-xl border border-me-charcoal/15 bg-white">
                {([
                  { k: 'retail' as const, label: '终端客户' },
                  { k: 'trade' as const, label: `同行 ${tradeCount}` },
                  { k: 'all' as const, label: '全部' },
                ]).map((o) => (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => setKindView(o.k)}
                    className={`px-3 py-2 text-sm font-bold transition ${
                      kindView === o.k
                        ? 'bg-me-charcoal text-white'
                        : 'text-me-charcoal/55 hover:bg-me-ivory'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
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
                  <Card
                    key={r.contactId}
                    clientId={clientId}
                    row={r}
                    onOpen={() => setPicked(r)}
                    onTogglePin={togglePin}
                    onAcceptStage={acceptStage}
                    onLogged={afterWrite}
                  />
                ))}
              </div>
              {found.length === 0 && (
                <p className="py-10 text-center text-sm text-me-charcoal/40">没找到这个人。</p>
              )}
            </section>
          ) : (
            <>
              {/* 三层：客人在等你 → 他刚有动作 → 先放着的人。
                  这一页只回答一个问题：现在轮到人做什么。 */}
              {LAYERS.map((layer) => (
                <LayerSection
                  key={layer.key}
                  clientId={clientId}
                  layer={layer}
                  buckets={buckets.filter((b) => b.layer === layer.key)}
                  onOpen={(r) => setPicked(r)}
                  onTogglePin={togglePin}
                  onAcceptStage={acceptStage}
                  onLogged={afterWrite}
                />
              ))}

              <p className="mt-3 text-xs leading-relaxed text-me-charcoal/45">
                另有 {data.counts.nurture_future} 人今天不用打（说了以后才走，到时间系统会捞回来）。
                再有 {data.counts.excluded} 人不用再联系（明确拒绝 / 号码作废 / 已经成交）。
              </p>

              {data.todoTotal === 0 && (
                <p className="py-12 text-center text-sm text-me-charcoal/45">今天没有需要联系的人。</p>
              )}

              <OffList
                clientId={clientId}
                rows={(data.offList ?? []).filter((r) => keepKind(r.kind))}
                onOpen={(r) => setPicked(r)}
                onLogged={afterWrite}
              />
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
