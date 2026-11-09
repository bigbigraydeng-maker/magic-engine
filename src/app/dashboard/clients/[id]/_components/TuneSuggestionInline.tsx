'use client'

/**
 * Gate B 步骤 3 —— published post 卡片下方那一行 Tune 建议。
 *
 * fetchFailed === true    ：后台读失败（500 / 403 / 网络断），必须显式告知，
 *                            不能与「尚未到点」共用同一句话（PITFALLS「读失败别显示空输入框」）。
 * suggestion === null     ：这条 action 还没有 T+72 receipt（未到点 / 未落 unmeasurable 行）
 * decision === 'INCONCLUSIVE'：有 receipt 但 evaluator 拒绝下结论
 * 其它四种                ：REPEAT / ITERATE / STOP + 一句人话依据
 *
 * 纯展示：不做副作用、不点 provider、不改 Daily Plan 数据。
 */

import type { TuneRecommendation } from '@/lib/flywheel/tune/types'

interface Props {
  suggestion: TuneRecommendation | null
  /** true 时忽略 suggestion，一律显示「暂时读不到」——防止读失败被误判成尚未到点。 */
  fetchFailed?: boolean
}

const DECISION_LABEL: Record<string, string> = {
  REPEAT:       '值得再做一次',
  ITERATE:      '差不多，微调再试',
  STOP:         '不建议再做',
  INCONCLUSIVE: '数据还不够说话',
}

const DECISION_STYLE: Record<string, string> = {
  REPEAT:       'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/25',
  ITERATE:      'bg-me-ochre/12 text-me-ochre border-me-ochre/25',
  STOP:         'bg-[#C2453A]/12 text-[#C2453A] border-[#C2453A]/25',
  INCONCLUSIVE: 'bg-me-charcoal/[.06] text-me-charcoal/55 border-black/[.06]',
}

const CAVEAT_LABEL: Record<string, string> = {
  target_partial:                     '本条只测到一部分',
  shares_missing_on_target:           '转发数没能取到',
  shares_missing_across_cohort:       '同类历史都缺转发数',
  fell_back_from_likes_to_comments:   'likes 覆盖不够，改用 comments 判断',
  t4_only:                            '还只有 4 小时数据',
}

function formatCaveats(caveats: string[]): string {
  if (caveats.length === 0) return ''
  return caveats.map((c) => CAVEAT_LABEL[c] ?? c).join(' · ')
}

export function TuneSuggestionInline({ suggestion, fetchFailed = false }: Props) {
  if (fetchFailed) {
    return (
      <p className="mt-1 text-[10px] italic text-[#C2453A]/70">
        效果建议暂时读不到（后台报错），稍后刷新再看。
      </p>
    )
  }

  if (suggestion === null) {
    return (
      <p className="mt-1 text-[10px] italic text-me-charcoal/40">
        等 T+72（发布后第 3 天）到点再看效果建议。
      </p>
    )
  }

  const label = DECISION_LABEL[suggestion.decision] ?? suggestion.decision
  const style = DECISION_STYLE[suggestion.decision] ?? DECISION_STYLE.INCONCLUSIVE
  const caveatText = formatCaveats(suggestion.caveats)

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10px] font-medium ${style}`}
        >
          建议：{label}
        </span>
        <span className="text-[10px] text-me-charcoal/55">{suggestion.rationale}</span>
      </div>
      {caveatText && (
        <p className="text-[10px] text-me-charcoal/40">备注：{caveatText}</p>
      )}
    </div>
  )
}
