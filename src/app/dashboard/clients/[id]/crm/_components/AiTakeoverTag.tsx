'use client'

/**
 * 「AI 跟进中」/「客人回来了」小标 —— 名单那一行和抽屉名字旁共用这一份（Figma ⑦⑨）。
 * 客人回来了时只显示「客人回来了」：那一刻员工该接手，「AI 跟进中」反而误导。
 */

export function AiTakeoverTag({ aiTakeover, cameBack }: { aiTakeover?: boolean; cameBack?: boolean }) {
  if (cameBack) {
    return (
      <span
        data-testid="came-back-tag"
        title="接管期间客人回信 / 填表 / 来电 / 发私信了，请员工接手"
        className="shrink-0 rounded-full bg-[#C2453A]/12 px-2 py-0.5 text-[11px] font-black text-[#C2453A]"
      >
        客人回来了
      </span>
    )
  }
  if (!aiTakeover) return null
  return (
    <span
      data-testid="ai-takeover-tag"
      title="系统在自动跟进，客人一开口就停手"
      className="shrink-0 rounded-full bg-me-charcoal/[0.08] px-2 py-0.5 text-[11px] font-bold text-me-charcoal/70"
    >
      AI 跟进中
    </span>
  )
}
