/**
 * 按「终端客户 / 同行」筛看板。
 *
 * ## 为什么这一段值得单独一个文件 + 单测
 *
 * 它决定的不是「显示什么」，是**谁会收到那封群发邮件**。
 *
 * 2026-08-04 第一版就在这里错了（Codex 复审抓到，PR #819 已合之后）：
 * 筛选只作用在 `people` 上，`batchEmails` 原样保留。于是在「只看终端客户」
 * 视图下：
 *
 *   · 复制出来的地址里**仍然带着同行**（House of Travel、TravelManagers…）
 *     → 一封面向散客的群发信发给了每周订十次位的同行
 *   · 而「已发出」那一笔只按筛选后的 `people` 记
 *     → **实际收件人和 CRM 记录对不上**
 *
 * 后面这条比前面那条更毒：名单一旦开始说假话，销售就不再信它，
 * 而这套东西存在的全部理由就是那份名单可信。
 *
 * 所以群发地址**必须从筛选后的人重新推**，绝不能沿用服务端那份。
 */

import type { ContactKind } from './contact-kind'

export type KindView = 'retail' | 'trade' | 'all'

export interface KindedPerson {
  email: string | null
  kind?: ContactKind
}

export interface KindedBucket<P extends KindedPerson> {
  batch: 'call_one_by_one' | 'send_email' | 'none'
  people: P[]
  batchEmails: string[]
  total: number
}

/** 没标 kind 的一律当终端客户 —— 后端还没上线这个字段时页面不该整个空掉。 */
export function matchesKindView(kind: ContactKind | undefined, view: KindView): boolean {
  return view === 'all' || (kind ?? 'retail') === view
}

/**
 * 把一个桶按视图筛一遍。
 *
 * 三样东西必须同时收窄，少一样就自相矛盾：
 *   people      —— 铺出来的卡片
 *   total       —— 列头那个数字（对不上，人会以为系统丢了人）
 *   batchEmails —— **群发地址**（对不上，信会发错人）
 */
export function filterBucketByKind<P extends KindedPerson, B extends KindedBucket<P>>(
  bucket: B,
  view: KindView,
): B {
  const people = bucket.people.filter((p) => matchesKindView(p.kind, view))
  return {
    ...bucket,
    people,
    total: people.length,
    batchEmails:
      bucket.batch === 'send_email'
        ? people.map((p) => p.email).filter((e): e is string => !!e)
        : [],
  }
}

/**
 * 这个客户一共有多少同行。
 *
 * **必须把名单外的也算上**（Codex 复审第二条）：一个客户的同行如果全都处在
 * 成交 / 停止 / 推迟状态，他们只存在于 offList；只数看板的话这个数字是 0，
 * 切换器就不渲染，而 offList 又按默认的「终端客户」筛掉了他们 ——
 * 这批人**在界面上彻底消失，没有任何入口能翻到**。
 *
 * 「切一下就全在」这句话，只有把两边都数进来才成立。
 */
export function countTrade(
  buckets: ReadonlyArray<{ people: ReadonlyArray<{ kind?: ContactKind }> }>,
  offList: ReadonlyArray<{ kind?: ContactKind }>,
): number {
  const inBuckets = buckets.reduce(
    (n, b) => n + b.people.filter((p) => (p.kind ?? 'retail') === 'trade').length,
    0,
  )
  const inOff = offList.filter((r) => (r.kind ?? 'retail') === 'trade').length
  return inBuckets + inOff
}
