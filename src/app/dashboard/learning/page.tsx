import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { loadLedger } from '@/lib/ledger/load'
import { nzToday } from '@/lib/pm-todo/ledger-items'
import { loadSkillCards } from '@/lib/skill-cards/load'
import { buildBoard, type Board } from '@/lib/skill-cards/board'
import { BoardView, FatalBox } from './_components/board-sections'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Agent 学习库 · Magic Engine',
}

function loadBoard(): { board: Board } | { fatal: string } {
  try {
    const cards = loadSkillCards()
    const ledger = loadLedger()
    if (ledger.entries.length === 0) return { fatal: '台账（docs/ledger）读不到或为空，没法核对「待验证」' }
    if (cards.digestText.trim() === '') return { fatal: '广告规则摘要（ME-ADS-RULES-DIGEST.md）读不到或为空，没法核对「ME 早已在做」' }
    return {
      board: buildBoard({
        cards: cards.cards,
        errors: cards.errors,
        ledgerEntries: ledger.entries,
        rulebookText: cards.rulebookText,
        digestText: cards.digestText,
        today: nzToday(new Date()),
        ledgerErrors: ledger.errors,
      }),
    }
  } catch (error) {
    return {
      fatal: '技能卡目录或台账读不出：' + (error instanceof Error ? error.message : String(error)),
    }
  }
}

export default async function LearningBoardPage() {
  const h = await headers()
  if (
    h.get('x-user-role') !== 'admin' ||
    h.get('x-user-tier') !== 'admin' ||
    h.get('x-allowed-client-id') !== null
  ) {
    redirect('/unauthorized')
  }

  const result = loadBoard()

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-black text-slate-900">Agent 学习库</h1>
      <p className="text-xs text-slate-500">
        数据来自线上部署的主干版本；还没合并的学习笔记不在这里。
      </p>
      <p className="text-xs text-slate-500">
        广告 Agent 从专家视频里学到的每个点，现在走到哪一步了。
      </p>
      {'fatal' in result ? (
        <FatalBox message={result.fatal} />
      ) : result.board.fatal !== null ? (
        <FatalBox message={result.board.fatal} />
      ) : (
        <BoardView board={result.board} />
      )}
    </div>
  )
}
