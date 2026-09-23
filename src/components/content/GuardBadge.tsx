// 发布前自检（中英混杂 / 套话开头）的红旗。
// 回执由 src/lib/content/content-guard.ts 写入，解读只在
// src/lib/content/guard-receipt.ts 一处——这里只负责把它说成人话。
//
// 看板卡片用 <GuardBadge>（一个小红标），详情/审核面板用 <GuardReviewPanel>
// （说清是哪句话、哪个词），别让人看见红旗却不知道要改什么。

import type { GuardFlag, GuardReason } from '@/lib/content/guard-receipt'

const REASON_LABEL: Record<GuardReason, string> = {
  mixed_language: '中英混杂',
  cliche_opener: '套话开头',
  check_unavailable: '检查没跑成',
}

export function guardReasonText(flag: GuardFlag): string {
  return flag.reasons.map((r) => REASON_LABEL[r]).join(' / ')
}

/** 卡片上的小红标。没跑过自检（flag === null）什么都不显示——那不等于「查过没问题」。 */
export function GuardBadge({ flag }: { flag: GuardFlag | null | undefined }) {
  if (!flag?.needsReview) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-red-700 bg-red-50 border border-red-300 rounded px-1.5 py-0.5">
      ⚠ 需人工复核：{guardReasonText(flag)}
    </span>
  )
}

/** 详情/审核面板里的完整说明：为什么标红 + 具体是哪几句。 */
export function GuardReviewPanel({ flag }: { flag: GuardFlag | null | undefined }) {
  if (!flag?.needsReview) return null
  return (
    <div className="mb-3 border border-red-300 bg-red-50 rounded-xl p-3">
      <div className="text-[13px] font-semibold text-red-700 mb-1">
        ⚠ 需人工复核：{guardReasonText(flag)}
      </div>
      {flag.languageFindings.length > 0 && (
        <div className="text-[12px] text-red-700 mb-1">
          <div className="font-semibold">混进来的不是同一种语言的字：</div>
          <ul className="list-disc pl-4">
            {flag.languageFindings.map((f, i) => (
              <li key={i}>
                「{f.fragment}」<span className="text-red-600/70"> —— 出自：{f.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {flag.reasons.includes('cliche_opener') && (
        <div className="text-[12px] text-red-700 mb-1">
          开头是套话（像「开启…新篇章」「赋能」「Unlock the power of」这类）。
          改成一句具体的事实、价格或细节。
        </div>
      )}
      {flag.reasons.includes('check_unavailable') && (
        <div className="text-[12px] text-red-700 mb-1">
          这条内容的自检没跑成{flag.judgeError ? `（${flag.judgeError}）` : ''}——
          <span className="font-semibold">没跑成不等于没问题</span>，得自己读一遍再决定。
        </div>
      )}
      <div className="text-[11px] text-red-600/80">
        标红的内容不能走「批量通过」，要发就在这里一条条看过再单独确认。
      </div>
    </div>
  )
}
