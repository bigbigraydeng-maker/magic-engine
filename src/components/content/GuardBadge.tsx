// 发布前自检（中英混杂 / 套话开头）的红旗。
// 回执由 src/lib/content/content-guard.ts 写入，解读只在
// src/lib/content/guard-receipt.ts 一处——这里只负责把它说成人话。
//
// 看板卡片用 <GuardBadge>（一个小红标），详情/审核面板用 <GuardReviewPanel>
// （说清是哪句话、哪个词），别让人看见红旗却不知道要改什么。
//
// 🔴 这几块界面客户也能打开。判分服务的原始报错（带供应商名、全是黑话）绝不
// 上屏——接口那侧已经用 toPublicGuardFlag 把它摘掉了，这里也拿不到。

import type { PublicGuardFlag, GuardReason } from '@/lib/content/guard-receipt'

const REASON_LABEL: Record<GuardReason, string> = {
  mixed_language: '中英混杂',
  cliche_opener: '套话开头',
  check_unavailable: '自检没跑成',
}

export function guardReasonText(flag: PublicGuardFlag): string {
  return flag.reasons.map((r) => REASON_LABEL[r]).join(' / ')
}

/**
 * 卡片上的小红标。没跑过自检（flag == null）什么都不显示——那不等于「查过没问题」。
 * compact：只说「需人工复核」，原因留给详情面板（挤在标题同一行时用，
 * 三种原因全中的完整那句会把标题顶断行）。
 */
export function GuardBadge({ flag, compact = false }: { flag: PublicGuardFlag | null | undefined; compact?: boolean }) {
  if (!flag?.needsReview) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-red-700 bg-red-50 border border-red-300 rounded px-1.5 py-0.5">
      ⚠ 需人工复核{compact ? '' : `：${guardReasonText(flag)}`}
    </span>
  )
}

/**
 * 详情/审核面板里的完整说明：为什么标红 + 具体是哪几句。
 * editable：这一屏能不能直接改文字（单讲工作台能，看板抽屉只读）——出路不同，
 * 话就得说得不一样，不然人对着一个改不了的屏找编辑框。
 */
export function GuardReviewPanel({
  flag,
  editable = false,
}: {
  flag: PublicGuardFlag | null | undefined
  editable?: boolean
}) {
  if (!flag?.needsReview) return null
  return (
    <div className="mb-3 border border-red-300 bg-red-50 rounded-xl p-3">
      <div className="text-[13px] font-semibold text-red-700 mb-1">
        ⚠ 需人工复核：{guardReasonText(flag)}
      </div>
      {flag.languageFindings.length > 0 && (
        <div className="text-[12px] text-red-700 mb-1">
          <div className="font-semibold">这几处没翻干净（中英文混在一起）：</div>
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
          这条内容的自检没跑成（系统那侧的问题，跟文案本身无关）——
          <span className="font-semibold">没跑成不等于没问题</span>，得自己读一遍再决定。
        </div>
      )}
      <div className="text-[11px] text-red-600/80">
        {editable
          ? '在下面的逐字稿里改完保存即可。注意：这个提示记的是生成那一刻的检查结果，改完保存它不会自动消失。'
          : '这一屏只能读、改不了文字：读一遍决定发还是打回；要改内容得让技术窗口重跑一次生成。'}
        标红的内容不会被「批量通过」放行，要发只能逐条看过后单独确认。
      </div>
    </div>
  )
}
