'use client'

import { useEffect, useState } from 'react'
import { type StageOption } from '../../_components/ComposeNote'
import { BatchEmail, type BatchEmailBucket } from '../../_components/BatchEmail'
import { type KindView } from '@/lib/crm/kind-filter'
import { type ContactRow } from './contact-table-types'

/**
 * 跟进人筛选的三挡 + 具体人（issue #3158 part 3）。
 *   - 'all' = 全部，不筛（默认）
 *   - 'me' = 自己负责的 —— 服务端用 `access.user.email` 判
 *   - 'unassigned' = 没分配的
 *   - 具体邮箱字符串 = 筛这个人
 */
export type AssigneeView = 'all' | 'me' | 'unassigned' | string

type FilterProps = {
  stages: StageOption[]
  stageFilter: string[]
  onStageFilterChange: (updater: (prev: string[]) => string[]) => void
  grouped: boolean
  onToggleGrouped: () => void
  kindFilter: KindView
  onKindFilterChange: (k: KindView) => void
  /** 当前的跟进人筛选 —— 分段模式下不生效（服务端 priority 视图这一轮不接）。 */
  assigneeFilter: AssigneeView
  onAssigneeFilterChange: (v: AssigneeView) => void
  /** 客户 id —— 候选名单从 /api/clients/[id]/crm/assignees 拉。 */
  clientId: string
}

function StageFilter(props: Pick<FilterProps, 'stages' | 'stageFilter' | 'onStageFilterChange'>) {
  const { stages, stageFilter, onStageFilterChange } = props
  if (stages.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-me-charcoal/45">到哪一步了：</span>
      {stages.map((s) => {
        const on = stageFilter.includes(s.stageKey)
        return (
          <button
            key={s.stageKey}
            onClick={() =>
              onStageFilterChange((prev) =>
                on ? prev.filter((k) => k !== s.stageKey) : [...prev, s.stageKey],
              )
            }
            className={`rounded-full border border-black/10 px-3 py-1 text-xs font-semibold ${
              on ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60'
            }`}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

const KIND_OPTIONS = [
  ['all', '全部'],
  ['retail', '终端客户'],
  ['trade', '🤝 同行'],
] as const

function KindFilter(props: Pick<FilterProps, 'kindFilter' | 'onKindFilterChange'>) {
  const { kindFilter, onKindFilterChange } = props
  return (
    <div className="inline-flex rounded-lg border border-me-charcoal/15 p-0.5">
      {KIND_OPTIONS.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onKindFilterChange(k)}
          className={`rounded-md px-3 py-1 text-xs font-bold transition ${
            kindFilter === k ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60 hover:text-me-charcoal'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * 第一行：先选「看谁」（全部 / 终端客户 / 同行），智能分段开关靠右。
 * 阶段筛选在它下面——先收窄人群，再按阶段细分，顺序跟人的想法一致（2026-10-14 好用性整理）。
 */
function GroupToggleRow(props: Pick<FilterProps, 'grouped' | 'onToggleGrouped' | 'kindFilter' | 'onKindFilterChange'>) {
  const { grouped, onToggleGrouped, kindFilter, onKindFilterChange } = props
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 终端客户 / 同行 筛选（2026-09-28 WP-B3）——分段模式下不显示，服务端还没接。 */}
      {!grouped && <KindFilter kindFilter={kindFilter} onKindFilterChange={onKindFilterChange} />}
      {grouped && (
        <span className="text-xs text-me-charcoal/45">
          系统读完往来记录和 AI 摘要，告诉你今天该先联系谁、做什么；段内按紧急程度排，点表头不改顺序
        </span>
      )}
      <button
        type="button"
        onClick={onToggleGrouped}
        className="ml-auto rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-xs font-bold text-me-charcoal hover:bg-me-ivory"
      >
        {grouped ? '← 回到平铺名单' : '✨ Magic Engine 智能'}
      </button>
    </div>
  )
}

/**
 * 跟进人筛选条 —— 分段视图下不显示（服务端 priority 视图这一轮没接 ?assignee）。
 *
 * 「我的待跟进」是入口：候选为空（这个客户还没配跟进人）时也**保留** `👤 我负责`
 * 这个按钮——点下去服务端返回空列表，员工能看出来「名单还没配」，不要悄悄把
 * 入口藏起来让人以为自己没线索可跟。
 */
function AssigneeFilter(props: {
  clientId: string
  value: AssigneeView
  onChange: (v: AssigneeView) => void
}) {
  const { clientId, value, onChange } = props
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [viewerEmail, setViewerEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/assignees`)
        if (!res.ok) return
        const json = (await res.json()) as { assignees?: { email: string }[]; viewerEmail?: string | null }
        if (cancelled) return
        setCandidates((json.assignees ?? []).map((a) => a.email))
        setViewerEmail(json.viewerEmail ?? null)
      } catch {
        // 读失败就按「没配」渲染 —— 不炸整块筛选条
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const chipCls = (on: boolean) =>
    `rounded-full border border-black/10 px-3 py-1 text-xs font-semibold ${
      on ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60'
    }`

  // 自己不在候选里 = 还没把自己放进 round-robin 名单；仍然给「我负责」按钮，
  // 服务端会按登录邮箱筛，筛到自己之前手动改过的那几条。
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="assignee-filter">
      <span className="text-xs text-me-charcoal/45">跟进人：</span>
      <button className={chipCls(value === 'all')} onClick={() => onChange('all')}>
        全部
      </button>
      <button className={chipCls(value === 'me')} onClick={() => onChange('me')}>
        👤 我负责
      </button>
      <button className={chipCls(value === 'unassigned')} onClick={() => onChange('unassigned')}>
        未分配
      </button>
      {candidates !== null &&
        candidates
          .filter((email) => !viewerEmail || email.toLowerCase() !== viewerEmail.toLowerCase())
          .map((email) => (
            <button
              key={email}
              className={chipCls(value === email)}
              onClick={() => onChange(email)}
              title={email}
            >
              {email}
            </button>
          ))}
    </div>
  )
}

export function ListFilters(props: FilterProps) {
  return (
    <>
      <GroupToggleRow
        grouped={props.grouped}
        onToggleGrouped={props.onToggleGrouped}
        kindFilter={props.kindFilter}
        onKindFilterChange={props.onKindFilterChange}
      />
      {!props.grouped && (
        <AssigneeFilter
          clientId={props.clientId}
          value={props.assigneeFilter}
          onChange={props.onAssigneeFilterChange}
        />
      )}
      <StageFilter
        stages={props.stages}
        stageFilter={props.stageFilter}
        onStageFilterChange={props.onStageFilterChange}
      />
    </>
  )
}

// 批量发邮件——只在「🤝 同行」筛选下出现。人从当前已加载的 rows 来：
// 同行通常是一小撮人（CTS 约 20 人），一页（100）装得下，不需要额外拉全量。
// doneToday 恒 false——"全部客人"没有"今天处理过"这个每日重置的概念，
// 跟"今天要联系"那页的批次语义不是一回事，批量发送面向的是"这批同行"
// 整体，不是"今天还没联系过的同行"。
// 🔴 魏征 2026-09-28 复审 B3 查出：同行超过一页（100 人）时，这个面板只会
// 发给当前这一页，且原来没有任何提示——容易被当成"已经是全部同行"。
// 生产唯一客户 CTS 目前约 20 人不会触发，但这是结构性缺口，先在这里挡一句、
// 不让人无声漏发；真要支持大批量同行客户，需要另开一条不分页的批量取数接口。
export function TradeBatchPanel(props: {
  clientId: string
  rows: ContactRow[]
  total: number
  onLogged: (msg: string) => void
}) {
  const { clientId, rows, total, onLogged } = props
  return (
    <>
      {total > rows.length && (
        <p className="rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 px-3 py-2 text-xs font-semibold text-[#C2453A]">
          ⚠️ 同行一共 {total} 人，这一页只装得下 {rows.length} 人——批量发邮件现在只会发给这一页看到的人，翻页分批发，别当成已经发给了全部同行。
        </p>
      )}
      <BatchEmail
        clientId={clientId}
        bucket={
          {
            batch: 'send_email',
            people: rows.map((r) => ({ contactId: r.contactId, email: r.email, kind: 'trade', doneToday: false })),
            batchEmails: [],
            total: rows.length,
          } satisfies BatchEmailBucket
        }
        onLogged={onLogged}
      />
    </>
  )
}
