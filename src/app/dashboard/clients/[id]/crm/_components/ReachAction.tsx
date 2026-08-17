'use client'

/**
 * 「怎么联系他」—— 今日看板卡片底部那一条，外加它要用的 `Row` 形状。
 *
 * 🔴 **为什么单独一个文件**（子牙复审 2026-08-17）：它本来长在 `page.tsx` 里，
 * 靠具名导出让单测能构造 `row`。但 Next App Router 对 page 模块的导出做白名单
 * 校验 —— 生成的 `.next/types/.../page.ts` 会报 `TS2344`，`npm run type-check`
 * 因此多一条错。代码里那句「router 会忽略 page 文件里的具名导出」是对框架内部
 * 的假设，实测不成立。同目录另外六个组件本来就走 `_components/` 这个约定。
 *
 * 这里的 DNC 判断是**安全码**，必须被直测钉住 —— 见 `__tests__/ReachAction.test.tsx`。
 */

import type { Segment } from '@/lib/crm/segments'

export interface Row {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  segment: Segment
  temperature: 'hot' | 'warm' | 'cold' | 'off'
  reason: string
  suggestedChannel: 'phone' | 'sms' | 'email' | 'messenger' | 'none'
  /** 库里有号码，但那个号打不通。跟「压根没留电话」是两句不同的话。 */
  phoneUnusable?: boolean
  /** 被标成「别再联系」—— 抽屉靠它给出取消入口。 */
  doNotContact?: boolean
  dueAt: string | null
  lastTouchAt: string | null
  lastNote: string | null
  pinned: boolean
  pinnedAt: string | null
  suggestedStage: {
    toStage: string
    label: string
    why: string
    /** true = 点完之后这个人**照旧留在名单上**，系统继续跟。决定提示语怎么说。 */
    stillFollowed?: boolean
  } | null
  /** 今天已经有人联系过他 —— 卡片变浅，不用靠记。 */
  doneToday?: boolean
  /** 今天是怎么处理的（今天联系过了 / 标了：他说不买了…）。没处理就是 null。 */
  handledWhy?: string | null
  /** 「跟进了」还是「关掉了」—— 两个数字分开显示，不混成一个「处理了 N 人」。 */
  handledKind?: 'followed' | 'closed' | null
  /** 上次是谁跟的。不知道就是 null，页面不假装。 */
  lastBy?: string | null
  /** 他打开过邮件、之后没人跟。只是提示，不参与排序。 */
  openedDaysAgo?: number | null
  /** 被推迟到什么时候。今天名单上的人恒为 null —— 推迟的人已经被挡在外面。 */
  snoozeUntil?: string | null
  /** 终端客户还是同行。自己人根本不会出现在这一页（后端就丢掉了）。 */
  kind?: ContactKind
}

/**
 * 「怎么联系他」—— 卡片底部那一条。
 *
 * 为什么必须在卡上、而不是点进去才看得到（PM 2026-08-02 反馈）：这一页一次铺
 * 几百张卡，每张多两次点击就等于没人用。
 *
 * 更要命的是**渠道对不对**：CTS 名单里 124 人（26%）没有电话号码，其中 106 人
 * 只有 Facebook 身份（从私信补挂进来的）。而「新客人，还没打过」这个桶的说明
 * 写着「越早打通越容易成」—— 销售点开发现根本打不了，这一页就开始不被信任。
 *
 * 渠道由后端按「他实际能被联系到什么」算好（segments 的 reachableChannel），
 * 这里只把它变成一个能当场点的动作。
 */
export function ReachAction({ row }: { row: Row }) {
  const base = 'block border-t border-me-charcoal/8 px-3 py-2.5 text-[14px] font-bold'

  /**
   * 🔴 **说了别联系的人，一个联系动作都不给**（缺口①修复 R3，2026-08-17）。
   *
   * 今天 DNC 的人在 day-list 里不冻结、直接掉出名单，正常到不了这张卡；
   * 但这是防御纵深 —— 一旦哪天冻结策略变了、或有人把 DNC 人错漏进热桶，
   * 好号会在下面 `tel:` 那条渲染成可点拨号、坏号会渲染成「先发邮件」。
   * 整块出口对 DNC 关掉，比只在坏号分支挂闸更稳。
   */
  if (row.doNotContact) return null

  if ((row.suggestedChannel === 'phone' || row.suggestedChannel === 'sms') && row.phone) {
    return (
      <a
        href={`tel:${row.phone}`}
        onClick={(e) => e.stopPropagation()}
        className={`${base} bg-me-ivory/60 text-me-charcoal hover:bg-me-ivory`}
      >
        📞 {row.phone}
      </a>
    )
  }

  /**
   * 🔴 号码在库里、但那个号打不通 —— **不能说成「没留电话」**。
   *
   * 抽屉里明明存着号码，卡上却写「没留电话」，销售一眼就能戳穿，
   * 而这一页最贵的资产是「它说的话可信」。顺带把该做的事说出来：
   * 用别的渠道回，**顺手问他要个新号**，否则这个号永远是坏的。
   */
  if (row.phoneUnusable) {
    const how = row.suggestedChannel === 'messenger' ? '先在 Messenger 回他' : '先发邮件'
    return (
      <p className={`${base} bg-me-ivory/40 text-me-charcoal/60`}>
        ⚠️ 这个号打不通 —— {how}，顺便问他要个新号
      </p>
    )
  }

  if (row.suggestedChannel === 'messenger') {
    return <p className={`${base} bg-me-ivory/40 text-me-charcoal/60`}>💬 没留电话 —— 只能在 Messenger 回他</p>
  }

  if (row.suggestedChannel === 'email') {
    return <p className={`${base} bg-me-ivory/40 text-me-charcoal/60`}>✉️ 没留电话 —— 只能发邮件</p>
  }

  return null
}
