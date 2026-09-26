'use client'

/**
 * 「全部客人」页的抽屉内容 —— 展开一行之后看到的那一块。
 *
 * 从 `page.tsx` 原样搬出来，一行逻辑没改（`ContactDetail` 和它私用的两个面板
 * `MarkWonPanel` / `ImportantMarkerEditor`，外加只有它们用的 `NAL_CLIENT_ID`）。
 *
 * ## 为什么必须搬
 *
 * 1. **仓库规矩**：文件 < 800 行（CLAUDE.md §7）。R6 第一轮把 page.tsx 从 1034 拆到
 *    867，接着 R7 加分段视图推到 965、修复轮再推到 1081 —— 两轮把上一轮的进度全吐
 *    回去还超出更多。魏征复审点名了这个趋势：卡的标题冻结在「拆到 867 行」，
 *    看卡的人不会知道它又长回去了。
 * 2. **PM 2026-09-27 要把详情改成抽屉式弹出**（调研了 8 家成熟 CRM，业界共识是
 *    列表旁边弹侧栏 + 「上一条/下一条」）。那一轮要动的就是这一块；它跟主表挤在
 *    同一个文件里，改抽屉必然跟分段视图的行渲染撞在一起。先搬出来，那一轮才能
 *    只改这个文件。
 */

import { useEffect, useRef, useState } from 'react'
import { ComposeNote, type StageOption } from '../../_components/ComposeNote'
import { DncBanner } from '../../_components/DncBanner'
import { TimelineItem } from './TimelineItem'
import {
  CHANNEL_LABEL,
  fmtDate,
  relTime,
  type ContactRow,
  type CustomColumnMeta,
  type TimelineEntry,
} from './contact-table-types'

/**
 * New Asian Logistics——同一个字面量在 `nal-messenger-lead-sync-run.ts`/
 * `nal-mark-won/route.ts` 各自声明一份是既有惯例（跟 CTS_CLIENT_ID 一样）。
 * 只有这一个客户在工作台里把联系人标"已成交"会顺带触发回传 Meta 广告转化 API——
 * 见 `nal-crm-won-to-capi-design-v1.md`：CTS 的成交回传走的是另一条独立通道
 * （Google 表格同步），不能让这里的改动波及它。
 */
const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'

/**
 * NAL 专属：标已成交时弹出的金额/到账日期录入。
 *
 * 幂等键在挂载时生成一次、整个提交生命周期复用（照抄 `ComposeNote` 同一个理由：
 * 双击/网络重试要复用同一个键，在点击那一刻才生成的话每次点击都是新键，
 * 重复提交就挡不住了）。
 */
export function MarkWonPanel({
  contactId,
  onDone,
  onCancel,
}: {
  contactId: string
  /** 第二个参数 = 要不要顺手重拉列表；失败时传 false。 */
  onDone: (msg: string, reload?: boolean) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const submit = async () => {
    const amountMajor = Number(amount)
    if (!amountMajor || amountMajor <= 0) {
      onDone('请填一个大于 0 的金额', false)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/conversions/nal-mark-won', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          amountMajor,
          occurredAt: new Date(occurredAt).toISOString(),
          idempotencyKey,
        }),
      })
      const body = (await res.json()) as { message?: string; error?: string }
      if (!res.ok) {
        onDone(`没记上：${body.error ?? '出错了'}`, false)
        return
      }
      onDone(body.message ?? '记好了', true)
    } catch {
      onDone('没记上，再试一次', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-me-ochre/25 bg-me-gold/10 p-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-bold text-me-charcoal">这笔生意多少钱？（到账后再回传给广告平台）</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-me-charcoal/50">NZD $</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金额"
            className="w-28 rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-me-charcoal/50">到账日期</span>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
        </div>
        <button
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
        >
          {busy ? '记录中…' : '确认已成交'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-me-stone px-3 py-1.5 text-xs font-semibold text-me-charcoal">
          取消
        </button>
      </div>
    </div>
  )
}

/**
 * 「⭐置顶」附带的原因 + 到期日编辑。
 *
 * 星本身（pinned_at）在表格那一列直接点，这里只管"标了什么"和"到什么时候"——
 * 对应员工老表 R/S 列的红字。受控 state，按「保存」才落库，不是每敲一个字发一次。
 */
export function ImportantMarkerEditor({
  clientId,
  row,
  onSaved,
}: {
  clientId: string
  row: ContactRow
  onSaved: (msg: string) => void
}) {
  const [note, setNote] = useState(row.important?.note ?? '')
  const [dueDate, setDueDate] = useState(row.important?.dueAt ? row.important.dueAt.slice(0, 10) : '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const body: { note: string | null; dueAt: string | null } = {
        note: note.trim() === '' ? null : note.trim(),
        // 空 = 清空；非空 date → 当天 12:00 本地时区当作截止时刻（员工只想标一天，不写具体时间）
        dueAt: dueDate === '' ? null : new Date(`${dueDate}T12:00:00`).toISOString(),
      }
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/important`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      onSaved('✓ 存好了')
    } catch {
      onSaved('没存上，再试一次')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-me-charcoal/10 bg-me-ivory p-3">
      <div className="text-xs font-bold text-me-charcoal/60">
        ⭐ 重要标记（选填）—— 员工老表 R/S 列的红字放这里
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="约好周三 3 点回电 / 只发邮件不打电话 / ..."
        maxLength={500}
        rows={2}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none"
      />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-me-charcoal/50">到期：</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => setDueDate('')}
            className="text-xs text-me-charcoal/40 hover:text-me-charcoal"
          >
            清除日期
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="ml-auto rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white disabled:opacity-40"
        >
          {busy ? '存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/** 展开区：往来时间线 + 记一笔 + 改状态。一次只有一行展开。 */
export function ContactDetail({
  clientId,
  row,
  stages,
  timeline,
  omitted,
  loading,
  onWrote,
}: {
  clientId: string
  row: ContactRow
  stages: StageOption[]
  timeline: TimelineEntry[] | null
  omitted: number
  loading: boolean
  /** 第二个参数 = 要不要顺手重拉列表；失败时传 false。 */
  onWrote: (msg: string, reload?: boolean) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [markingWon, setMarkingWon] = useState(false)

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
      onWrote('✓ 改好了')
    } catch {
      onWrote('没改上，再试一次')
    }
  }

  const shown = timeline ? (showAll ? timeline : timeline.slice(0, 5)) : []
  const hidden = timeline ? timeline.length - shown.length : 0

  return (
    <div className="space-y-4">
      {/* 重要标记放最上面 —— 员工打开抽屉第一眼就该看到"红字"，跟老表习惯一致。 */}
      <ImportantMarkerEditor clientId={clientId} row={row} onSaved={(msg) => onWrote(msg, true)} />

      {/* 联系方式 —— 展开里再给一次，方便直接拨号/发信 */}
      <div className="flex flex-wrap gap-2">
        {/* 号码打不通就不给拨号链接 —— 号码照旧显示（要改号得先看得见），
            但点不动。两个 CRM 入口必须说同一件事，否则销售两边都不再信。 */}
        {row.phone && row.phoneUnusable && (
          <span className="rounded-lg border border-me-stone bg-black/[0.04] px-3 py-1.5 text-sm font-semibold text-me-charcoal/45 line-through">
            📞 {row.phone}
          </span>
        )}
        {row.phone && row.phoneUnusable && (
          <span className="w-full text-xs font-semibold text-me-charcoal/55">
            ⚠️ 这个号打不通 —— 用邮件 / 私信联系，顺便问他要个新号
          </span>
        )}
        {row.phone && !row.phoneUnusable && (
          <a href={`tel:${row.phone}`} className="rounded-lg border border-me-stone px-3 py-1.5 text-sm font-semibold text-me-charcoal">
            📞 {row.phone}
          </a>
        )}
        {row.email && (
          <a href={`mailto:${row.email}`} className="break-all rounded-lg border border-me-stone px-3 py-1.5 text-sm font-semibold text-me-charcoal">
            ✉️ {row.email}
          </a>
        )}
        {/* 「可能被误判成永久拒联」那条人工任务的 href 就落在这一页 ——
            控件必须在这里，不然 FDE 照着任务点进来会找不到任务里说的按钮。 */}
        {row.doNotContact && (
          <DncBanner
            clientId={clientId}
            contactId={row.contactId}
            name={row.name}
            onSaved={onWrote}
          />
        )}
      </div>

      {/* 往来时间线 */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-me-charcoal/40">往来记录</p>
        {loading && <p className="text-sm text-me-charcoal/40">加载中…</p>}
        {!loading && timeline && timeline.length === 0 && omitted === 0 && (
          <p className="text-sm text-me-charcoal/45">还没有任何往来记录 —— 打完 / 聊完顺手在下面记一笔。</p>
        )}
        {!loading && timeline && timeline.length > 0 && (
          <>
            <ul className="space-y-2.5">
              {shown.map((e, i) => (
                <TimelineItem key={i} e={e} />
              ))}
            </ul>
            {hidden > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-2 text-xs font-bold text-me-charcoal/55 hover:text-me-charcoal"
              >
                看更早的 {hidden} 条 ↓
              </button>
            )}
          </>
        )}
        {!loading && omitted > 0 && (
          <p className="mt-2 text-xs text-me-charcoal/40">另有 {omitted} 条图片 / 表情 / 附件没显示。</p>
        )}
      </div>

      {/* 记一笔 + 改状态 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white"
          >
            记一笔
          </button>
        )}
        {stages.length > 0 && (
          <button
            onClick={() => setChangingStage((v) => !v)}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-me-charcoal/60"
          >
            跟进到哪步：{row.stageLabel ?? '还没标'}
          </button>
        )}
      </div>

      {changingStage && (
        <div className="flex flex-wrap gap-1.5">
          {stages
            .filter((s) => s.stageKey !== row.stage)
            .map((s) => (
              <button
                key={s.stageKey}
                onClick={() => {
                  // NAL + "已成交"档：不是简单改个状态字，还要录金额、顺带回传
                  // 广告平台——弹金额面板，不走普通的"改到哪步"确认框。
                  // 见 nal-crm-won-to-capi-design-v1.md：只对 NAL 生效，CTS 走
                  // 另一条独立的成交回传通道（Google 表格同步），不能碰这里。
                  if (clientId === NAL_CLIENT_ID && s.marketingAction === 'won') {
                    setChangingStage(false)
                    setMarkingWon(true)
                    return
                  }
                  void changeStage(s.stageKey, s.label)
                }}
                className="rounded-full bg-me-ivory px-3 py-1.5 text-xs font-bold text-me-charcoal"
              >
                {s.label}
              </button>
            ))}
        </div>
      )}

      {markingWon && (
        <MarkWonPanel
          contactId={row.contactId}
          onCancel={() => setMarkingWon(false)}
          onDone={(msg, reload) => {
            setMarkingWon(false)
            onWrote(msg, reload)
          }}
        />
      )}

      {composing && (
        <ComposeNote
          clientId={clientId}
          row={{ contactId: row.contactId, stage: row.stage }}
          stages={stages}
          onCancel={() => setComposing(false)}
          onDone={(msg) => {
            setComposing(false)
            onWrote(msg)
          }}
        />
      )}
    </div>
  )
}
