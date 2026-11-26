/**
 * 每个阶段的受众建议顺序：广泛 → 兴趣 → 相似受众。
 * 只是建议。不新建受众，不写广告后台。
 * 按投放国家圈人，不按族裔圈人。
 */

import type { DeliveryStage } from './spec'

export type QualifiedSeed = 'unreadable' | 'unset' | 'empty' | 'ready'
export type QuotedSeed = 'unreadable' | 'absent' | 'excluded' | 'included'

export interface LadderInput {
  /** null = 计划还没标阶段，建议按试投来说，但不回写计划。 */
  stage: DeliveryStage | null
  countries: string[]
  qualified: QualifiedSeed
  quoted: QuotedSeed
}

export interface LadderRung { title: string; detail: string; suggested: boolean }
export interface LadderView { note: string; rungs: LadderRung[] }

function broadDetail(countries: string[]): string {
  if (countries.length === 0) return '计划里还没写投放国家，不能假定投给哪一国的人。'
  return `投给 ${countries.join('、')} 里可能买这次产品的人。按国家或城市圈，不按族裔圈。`
}

function lookalikeDetail(input: LadderInput): string {
  const tail = '这只是建议，不会在广告后台新建受众。'
  if (input.qualified === 'unreadable' || input.quoted === 'unreadable') return `合格客人读不到，相似受众先不建议。${tail}`
  if (input.qualified === 'unset') return `还没勾选哪些阶段算合格客人，相似受众先不建议。${tail}`
  if (input.quoted === 'excluded') return `客户系统里有「已报价」，但还没把它算进合格客人，相似受众先不拿它当种子。${tail}`
  if (input.qualified === 'empty') return `合格阶段里现在没有人，相似受众先不做。${tail}`
  if (input.quoted === 'included') return `种子只用合格客人，包括标成「已报价」以及更后面的人。${tail}`
  return `这个客户的阶段里没有「已报价」。种子只用已经勾选的合格阶段。${tail}`
}

function suggestedKey(input: LadderInput): 'broad' | 'interest' | 'lookalike' | null {
  const stage = input.stage ?? 'test'
  if (stage === 'steady') return null
  if (stage === 'test') return 'broad'
  const seedReady = input.qualified === 'ready' && input.quoted !== 'excluded' && input.quoted !== 'unreadable'
  return seedReady ? 'lookalike' : 'interest'
}

export function audienceLadder(input: LadderInput): LadderView {
  const stage = input.stage ?? 'test'
  const pick = suggestedKey(input)
  const note = input.stage === null
    ? '计划还没标阶段，下面按试投的顺序来说，不会改这份计划。'
    : stage === 'steady'
      ? '稳住阶段不新开一档受众，沿用已经在跑的那一档。顺序仍写在下面，方便对照。'
      : stage === 'scale'
        ? '放量仍按这个顺序看：有合格客人种子就优先相似受众，没有就停在兴趣。'
        : '试投按这个顺序试：先广泛，再兴趣，最后才是相似受众。'
  const rungs: LadderRung[] = [
    { title: '广泛', detail: broadDetail(input.countries), suggested: pick === 'broad' },
    { title: '兴趣', detail: '按这次卖的产品来圈兴趣，不按族裔或国籍来圈。', suggested: pick === 'interest' },
    { title: '相似受众', detail: lookalikeDetail(input), suggested: pick === 'lookalike' },
  ]
  return { note, rungs }
}
