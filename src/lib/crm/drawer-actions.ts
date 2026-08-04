/**
 * 点开一个人之后，该给他哪几个按钮。
 *
 * 2026-08-02 PM 看着「新客人，还没打过」点开后说：「按钮是不是太多了！」
 * 数了一下确实：9 个阶段快捷键 + 一个 10 项的下拉 + 方向切换 + 输入框 +
 * 私信框。**一个从没被联系过的人，只有两种可能的结果：打通了，或者没打通。**
 * 其余十几个控件在这一刻全是噪音，而噪音的代价是销售不用这一页。
 *
 * 这里做两件事：
 *   1. 把「现在该做什么」收敛成**最多两个主按钮**，措辞按他能被联系到的渠道走
 *   2. 阶段只给**下一步**（外加「谈崩了」这类快速出口），其余折进「其他」
 *
 * 都是纯函数，页面不自己判断。
 */

import type { Segment } from './segments'

export interface StageLike {
  stageKey: string
  label: string
  sortOrder?: number
  marketingAction?: string
  isTerminal?: boolean
}

export type ActionKind =
  /** 打开输入框，记这次聊了什么。 */
  | 'log'
  /** 一键：打了没人接。不用打字 —— 这是最高频的结果，让它零成本。 */
  | 'no_answer'
  /** 一键：消息发出去了，等他回。没电话的人用这个代替「没打通」。 */
  | 'sent_waiting'

export interface DrawerAction {
  kind: ActionKind
  label: string
  /** 一键动作要写进记录的那句话。'log' 由销售自己打字，所以是 null。 */
  cannedNote: string | null
  /** 主按钮（深色）还是次按钮（描边）。 */
  primary: boolean
}

/** 这个人能被联系到的渠道 —— 跟卡片上那条「怎么联系他」同一个值。 */
export type Channel = 'phone' | 'sms' | 'email' | 'messenger' | 'none'

/**
 * 这一刻该给哪几个按钮。
 *
 * 措辞按渠道变，因为「没打通」对一个只有 Facebook 身份的人毫无意义 ——
 * 他根本没有号码可打，那个按钮点下去等于记了一句假话。
 */
export function drawerActions(segment: Segment, channel: Channel): DrawerAction[] {
  // 结论已定的人（明确拒绝 / 号码作废 / 已成交）不该再有「去联系他」的按钮。
  // 只留记一笔 —— 补记历史、或者记下他后来又回来了。
  if (segment === 'excluded') {
    return [{ kind: 'log', label: '记一笔', cannedNote: null, primary: true }]
  }

  // 三样联系方式都没有 —— 只能补记历史。给「发出去了，等他回」是同一类错误：
  // 他根本没有可发的地方，点下去等于往记录里写一句做不到的事。
  if (channel === 'none') {
    return [{ kind: 'log', label: '记一笔', cannedNote: null, primary: true }]
  }

  const byPhone = channel === 'phone' || channel === 'sms'

  // 还没联系过 / 打过没人接 —— 这两批的任务都是「先联系上他」。
  const tryingToReach = segment === 'new_untouched' || segment === 'retry_channel'

  if (byPhone) {
    return [
      {
        kind: 'log',
        label: tryingToReach ? '打通了，记一笔' : '聊完了，记一笔',
        cannedNote: null,
        primary: true,
      },
      {
        kind: 'no_answer',
        label: '没打通',
        // 这句话会进他的往来记录，也会被解析成 outcome=no_answer，
        // 让他明天自动落到「打过没人接」那一批。
        cannedNote: '打了，没人接',
        primary: false,
      },
    ]
  }

  // 没有电话的人（CTS 有 110 个只有 Facebook 身份）：能做的是回他一条消息。
  // 给「没打通」是错的 —— 他没有号码可打。
  const viaWord = channel === 'email' ? '发了邮件' : '回了他'
  return [
    { kind: 'log', label: `${viaWord}，记一笔`, cannedNote: null, primary: true },
    {
      kind: 'sent_waiting',
      label: '发出去了，等他回',
      cannedNote: channel === 'email' ? '发了邮件，等他回' : '回了私信，等他回',
      primary: false,
    },
  ]
}

export interface StageChoices {
  /** 这一刻最可能选的几个 —— 直接铺出来。 */
  suggested: StageLike[]
  /** 其余的，折进「其他」。 */
  rest: StageLike[]
}

/**
 * 「谈崩了」类的出口 —— 任何时候都该一键可达，不用翻。
 *
 * 判据只认 `marketingAction === 'suppress'`（不感兴趣 / 别再联系），**不能用
 * `isTerminal`**：「已付全款」也是终态，但那是成交，是往前走的一步。把它当成
 * 出口，销售会在「已报价」的人身上看到一个「已付全款」的快捷键 —— 那是这一页
 * 能犯的最糟的建议之一。
 */
function isExit(s: StageLike): boolean {
  return s.marketingAction === 'suppress'
}

/**
 * 现在这一步之后，最可能改到哪。
 *
 * 规则简单到能对销售解释清楚：**下一步 + 出口**。
 *  · 下一步 = 按客户自己配的顺序，排在当前阶段后面的那一个
 *  · 出口 = 「不感兴趣」这类终态，谈崩了随时要能一键标掉
 *
 * 铺 9 个阶段的问题不是多占地方，而是**每多一个选项就多一次犹豫**；
 * 而真实数据里，一个人从「新线索」跳到「已付全款」的情况根本不存在。
 * 剩下的没有藏起来 —— 折进「其他」，点一下就全出来。
 */
export function nextStageChoices(stages: StageLike[], currentStage: string | null): StageChoices {
  const ordered = stages
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter((s) => s.stageKey !== currentStage)

  if (ordered.length === 0) return { suggested: [], rest: [] }

  const currentOrder =
    stages.find((s) => s.stageKey === currentStage)?.sortOrder ??
    // 还没标过的人：当作站在队首之前，下一步就是第一个阶段。
    Number.NEGATIVE_INFINITY

  // 成交类终态（已付全款）留在「下一步」里 —— 它确实是往前走的一步。
  const forward = ordered.filter((s) => (s.sortOrder ?? 0) > currentOrder && !isExit(s))
  const exits = ordered.filter(isExit)

  const suggested: StageLike[] = []
  if (forward[0]) suggested.push(forward[0])
  // 只给一个出口 —— 两个「谈崩了」的选项会让人停下来分辨区别。
  if (exits[0]) suggested.push(exits[0])

  const shown = new Set(suggested.map((s) => s.stageKey))
  return { suggested, rest: ordered.filter((s) => !shown.has(s.stageKey)) }
}
