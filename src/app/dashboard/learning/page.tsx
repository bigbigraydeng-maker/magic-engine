import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { loadLedger } from '@/lib/ledger/load'
import { nzToday } from '@/lib/pm-todo/ledger-items'
import { loadSkillCards } from '@/lib/skill-cards/load'
import { buildBoard, type Board } from '@/lib/skill-cards/board'
import { BoardView, FatalBox, PageHeader } from './_components/board-sections'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Agent 学习库 · Magic Engine',
}

function loadBoard(): { board: Board } | { fatal: string } {
  try {
    const cards = loadSkillCards()
    const ledger = loadLedger()
    if (ledger.entries.length === 0) return { fatal: '台账读不到或为空，没法核对「待验证」' }
    if (cards.digestText.trim() === '') return { fatal: '广告规则摘要读不到或为空，没法核对「ME 早已在做」' }
    return {
      board: buildBoard({
        cards: cards.cards,
        errors: cards.errors,
        ledgerEntries: ledger.entries,
        resourcesByPillar: cards.resourcesByPillar,
        rulebookText: cards.rulebookText,
        digestText: cards.digestText,
        today: nzToday(new Date()),
        ledgerErrors: ledger.errors,
      }),
    }
  } catch (error) {
    return {
      fatal: '笔记目录或台账读不出：' + (error instanceof Error ? error.message : String(error)),
    }
  }
}

export default async function LearningBoardPage({
  searchParams,
}: {
  searchParams?: { pillar?: string }
}) {
  const h = await headers()
  if (
    h.get('x-user-role') !== 'admin' ||
    h.get('x-user-tier') !== 'admin' ||
    h.get('x-allowed-client-id') !== null
  ) {
    redirect('/unauthorized')
  }

  const result = loadBoard()
  const selectedPillar = searchParams?.pillar === 'ads' || searchParams?.pillar === 'social'
    ? searchParams.pillar
    : 'all'

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader />
      {'fatal' in result ? (
        <FatalBox message={result.fatal} />
      ) : result.board.fatal !== null ? (
        <FatalBox message={result.board.fatal} />
      ) : (
        <BoardView board={result.board} selectedPillar={selectedPillar} />
      )}
    </div>
  )
}
