import { LEDGER_ENTRY_URL } from '@/lib/pm-todo/ledger-items'
import { SKILL_CARD_URL } from '@/lib/skill-cards/load'
import type { Board, BoardCounts, BoardItem } from '@/lib/skill-cards/board'
import type { BoardIssue, PointState, SkillCardError } from '@/lib/skill-cards/types'

export function FatalBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
      <p className="text-sm font-black">学习库现在读不出来，先不显示任何数字</p>
      <p className="mt-1 text-xs">{message}</p>
    </div>
  )
}

function StatTiles({ counts }: { counts: BoardCounts }) {
  const tiles = [
    { label: '学习中', value: counts.learning },
    { label: '待验证', value: counts.verifying },
    { label: 'pass 掉', value: counts.passed },
    { label: '已合并进 ME', value: counts.adopted },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{tile.label}</p>
            <p className="text-3xl font-black text-slate-900">{tile.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        其中等你拍板 {counts.pmDecision} 个 · ME 早已在做 {counts.alreadyInMe} 个（视频印证了现有规则，不计入上面四个数）
      </p>
    </div>
  )
}

function ProblemZone({ issues, unorganized }: { issues: BoardIssue[]; unorganized: SkillCardError[] }) {
  const total = issues.length + unorganized.length
  if (total === 0) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-black text-slate-800">数据对不上（{total} 条）</h2>
      <ul className="mt-2 space-y-1">
        {unorganized.map((err) => (
          <li key={err.file} className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">
            还没整理：{err.file} —— {err.reason}
          </li>
        ))}
        {issues.map((issue, index) => (
          <li
            key={`${issue.cardId}#${issue.pointKey ?? ''}#${index}`}
            className={
              issue.level === 'error'
                ? 'rounded bg-red-50 px-2 py-1 text-xs text-red-800'
                : 'rounded bg-amber-50 px-2 py-1 text-xs text-amber-800'
            }
          >
            {issue.cardId}
            {issue.pointKey ? ' · ' + issue.pointKey : ''}：{issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function passLabel(state: PointState | null): string {
  if (state === 'not_applicable') return '判断不适用'
  if (state === 'tried_failed') return '试过不成立'
  if (state === 'cannot_check') return '查不了'
  return ''
}

function ItemRow({ item }: { item: BoardItem }) {
  const label = passLabel(item.state)
  return (
    <li className="border-b border-slate-100 py-2 text-sm">
      <p className="font-semibold text-slate-800">{item.text}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {item.orphan ? (
          <a
            href={LEDGER_ENTRY_URL + item.key + '.md'}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            台账交接卡
          </a>
        ) : (
          <a
            href={SKILL_CARD_URL + item.cardId + '.md'}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {item.cardTitle}
          </a>
        )}
        {item.owner ? <span>负责：{item.owner}</span> : null}
        {item.verifyBy ? <span>到期 {item.verifyBy}</span> : null}
        {item.rule ? <span>规则 {item.rule}</span> : null}
        {item.note ? <span>{item.note}</span> : null}
        {label ? <span className="rounded bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600">{label}</span> : null}
        {item.overdue ? <span className="rounded bg-red-100 px-1.5 text-[11px] font-bold text-red-700">已过期</span> : null}
        {item.verifiedPending ? (
          <span className="rounded bg-green-100 px-1.5 text-[11px] font-bold text-green-700">验完待写入规则</span>
        ) : null}
        {item.orphan ? (
          <span className="rounded bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600">还没挂到学习笔记</span>
        ) : null}
      </p>
    </li>
  )
}

function ItemList({ items, empty = '暂无' }: { items: BoardItem[]; empty?: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-400">{empty}</p>
  }
  return (
    <ul>
      {items.map((item) => (
        <ItemRow key={`${item.cardId}#${item.key}`} item={item} />
      ))}
    </ul>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-black text-slate-800">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

export function BoardView({ board }: { board: Board }) {
  return (
    <div className="space-y-4">
      <StatTiles counts={board.counts} />
      <p className="text-xs text-slate-500">共读到 {board.cardCount} 张学习笔记。</p>
      <ProblemZone issues={board.issues} unorganized={board.unorganized} />
      <Section title="学习中">
        <ItemList items={board.groups.learning} />
        <h3 className="mt-3 text-xs font-black text-slate-700">等你拍板</h3>
        <ItemList items={board.groups.pm_decision} />
      </Section>
      <Section title="待验证（已派出去在验）">
        <ItemList items={board.groups.verifying} />
      </Section>
      <Section title="pass 掉">
        <ItemList items={board.groups.passed} />
      </Section>
      <Section title="已合并进 ME">
        <ItemList items={board.groups.adopted} empty="还没有点正式写进广告 Agent 规则手册" />
      </Section>
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-black text-slate-800">
          ME 早已在做（{board.groups.already_in_me.length} 个，点开看）
        </summary>
        <div className="mt-2">
          <ItemList items={board.groups.already_in_me} />
        </div>
      </details>
    </div>
  )
}
