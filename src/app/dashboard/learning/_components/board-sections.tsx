import type { PillarBlock, AttentionList, Board, BoardItem } from '@/lib/skill-cards/board'
import type { BoardIssue, SkillCardError } from '@/lib/skill-cards/types'
import { LEDGER_ENTRY_URL } from '@/lib/pm-todo/ledger-items'
import { SKILL_CARD_URL } from '@/lib/skill-cards/load'

const MAX_PROBLEM_LINES = 5

export function PageHeader() {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-black text-slate-900">Agent 学习库</h1>
      <p className="text-xs text-slate-500">各 Agent 学到的东西走到哪一步了；细节由 Agent 自己读笔记。</p>
    </div>
  )
}

export function FatalBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-bold text-red-700">学习库读不出来，先不显示数字</p>
      <p className="mt-1 text-xs text-red-600">{message}</p>
    </div>
  )
}

interface ProblemLineProps {
  issues: BoardIssue[]
  unorganized: SkillCardError[]
}

interface ProblemRow {
  key: string
  text: string
  error: boolean
}

function unorganizedRows(unorganized: SkillCardError[]): ProblemRow[] {
  return unorganized.map((err) => ({
    key: 'u:' + err.file,
    text: `还没整理：${err.file}：${err.reason}`,
    error: true,
  }))
}

function issueRows(issues: BoardIssue[]): ProblemRow[] {
  return issues.map((issue, i) => ({
    key: 'i:' + i,
    text: `${issue.cardId}${issue.pointKey ? ' · ' + issue.pointKey : ''}：${issue.message}`,
    error: issue.level === 'error',
  }))
}

function ProblemLine({ issues, unorganized }: ProblemLineProps) {
  const total = issues.length + unorganized.length
  if (total === 0) return null
  const rows = [...unorganizedRows(unorganized), ...issueRows(issues)]
  const shown = rows.slice(0, MAX_PROBLEM_LINES)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-slate-900">数据对不上（{total} 条）</p>
      <ul className="mt-2 space-y-1">
        {shown.map((row) => (
          <li key={row.key} className={'text-xs ' + (row.error ? 'text-red-600' : 'text-amber-600')}>
            {row.text}
          </li>
        ))}
      </ul>
      {total > MAX_PROBLEM_LINES ? (
        <p className="mt-1 text-xs text-slate-400">还有 {total - MAX_PROBLEM_LINES} 条</p>
      ) : null}
    </div>
  )
}

function AttentionRows({ list }: { list: AttentionList }) {
  return (
    <ul className="mt-1 space-y-1">
      {list.shown.map((item) => (
        <li key={`${item.cardId}#${item.key}`} className="text-xs text-slate-700">
          {item.text}{' '}
          <AttentionLink item={item} />
        </li>
      ))}
      {list.more > 0 ? <li className="text-xs text-slate-400">还有 {list.more} 条</li> : null}
    </ul>
  )
}

function AttentionLink({ item }: { item: BoardItem }) {
  if (item.orphan) {
    return (
      <a href={LEDGER_ENTRY_URL + item.key + '.md'} target="_blank" rel="noreferrer" className="underline">
        交接卡
      </a>
    )
  }
  return (
    <a href={SKILL_CARD_URL + item.cardId + '.md'} target="_blank" rel="noreferrer" className="underline">
      {item.cardTitle}
    </a>
  )
}

function BigNumber({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-4xl font-black text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

function PillarSection({ block }: { block: PillarBlock }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-black text-slate-900">{block.label}</h2>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <BigNumber value={block.counts.learning} label="学习中" />
        <BigNumber value={block.counts.verifying} label="待验证" />
        <BigNumber value={block.counts.pmDecision} label="等你拍板" />
      </div>
      {block.decisions.shown.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate-700">等你拍板的</p>
          <AttentionRows list={block.decisions} />
        </div>
      ) : null}
      {block.overdue.shown.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate-700">验证已过期的</p>
          <AttentionRows list={block.overdue} />
        </div>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">
        已放弃 {block.counts.passed} · 已写进规则 {block.counts.adopted}
      </p>
    </section>
  )
}

const PILLAR_FILTERS = [
  { key: 'all', label: '全部', href: '/dashboard/learning' },
  { key: 'ads', label: '广告', href: '/dashboard/learning?pillar=ads' },
  { key: 'social', label: '社媒', href: '/dashboard/learning?pillar=social' },
] as const

export function BoardView({ board, selectedPillar = 'all' }: { board: Board; selectedPillar?: string }) {
  const visiblePillars = selectedPillar === 'all'
    ? board.pillars
    : board.pillars.filter((block) => block.pillar === selectedPillar)

  return (
    <div className="space-y-4">
      <nav aria-label="学习支柱" className="flex flex-wrap gap-2">
        {PILLAR_FILTERS.map((filter) => {
          const selected = filter.key === selectedPillar
          return (
            <a
              key={filter.key}
              href={filter.href}
              aria-current={selected ? 'page' : undefined}
              className={selected
                ? 'rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white'
                : 'rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50'}
            >
              {filter.label}
            </a>
          )
        })}
      </nav>
      <ProblemLine issues={board.issues} unorganized={board.unorganized} />
      {visiblePillars.map((block) => (
        <PillarSection key={block.pillar} block={block} />
      ))}
    </div>
  )
}
