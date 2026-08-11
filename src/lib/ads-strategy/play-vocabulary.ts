/**
 * 「打法」词表 —— 广告引擎的学习单位。
 *
 * ── 为什么是「打法」而不是「变量」（PM 2026-08-04 第 2 问拍板）─────────────────
 *
 * 原提案想学「单个变量」（中文 vs 英文哪个便宜）。魏征实算否掉了：当天中英差异
 * 真实值 1.84 倍、**p ≈ 0.22**（掷硬币级）；要测出来需 73,800 次展示 ≈ $1,835，
 * 而一个 Type B 楼盘的总预算是 $2,000。**这个业务形态下永远测不出显著性。**
 *
 * 但「打法」不需要统计 —— 它是**记账**：
 *   「ThruPlay 攒池这个做法：某类客户跑过 3 次，两次出人一次没出。」
 * 记账不需要样本量，只需要有人记。
 *
 * 这条规矩换来的真实代价（当天）：CTS 在 2026-07-08~21 花 $232.62 跑过
 * `ThruPlay Reels - Pool builder`，**ME 里零记录**。8/4 我给 Roman 建了同一个
 * 打法，完全不知道上一次是成功还是失败。**账本存在就不会发生第二次。**
 *
 * ── 刻意封闭 ────────────────────────────────────────────────────────────────
 * 加一个新打法 → union 加一项 → `PLAY_CATALOG` 少一个 key 就编译不过 → 逼你当场
 * 回答「这个打法是干什么的、成效看哪个指标」。跟 `creative-link.ts` 的
 * `AdCreationPath`、`flywheel/metric-registry.ts` 同一招。
 *
 * ── 这里**不做**的事 ─────────────────────────────────────────────────────────
 * 不判断哪个打法更好。账本只记「跑过、花了多少、结果如何」，判断留给人。
 * 一旦这里开始排名，就退回成被否掉的那个提案了。
 */

/** ME 认识的打法。封闭 —— 加值必须同时补 PLAY_CATALOG。 */
export type PlayKey =
  /** 视频播放广告，目的是把人存进受众池，不求当场转化。 */
  | 'thruplay_pool_build'
  /** 即时表单收留资 —— 姓名/电话/邮箱直接进 CRM。 */
  | 'lead_form_harvest'
  /** 私信广告，让人直接开对话。⚠️ 结构上强制「机器先开口」。 */
  | 'messenger_direct'
  /** 对已有受众池重定向（池子够大才有意义）。 */
  | 'warm_pool_retarget'
  /** 纯触达/认知，成效不看结果数。 */
  | 'reach_awareness'
  /** 给自然帖子投流（boost）。 */
  | 'boost_organic_post'

export interface PlayDefinition {
  /** 人话名字，给 PM 看的。 */
  label: string
  /** 这个打法在干什么。 */
  what: string
  /** 成效看哪里 —— 呼应 describeResultsColumn：有些打法的 results 恒为 0。 */
  successSignal: string
  /** 已知的坑。写在这里，建广告时能一起打出来。 */
  knownTraps: string[]
}

export const PLAY_CATALOG: Readonly<Record<PlayKey, PlayDefinition>> = {
  thruplay_pool_build: {
    label: '看完视频 · 攒池',
    what: '用视频广告把看完的人存进受众池，为以后的重定向供血。',
    successSignal: '单次完播成本 + 池子涨了多少人。results 恒为 0，不是失败。',
    knownTraps: [
      '池子不到 1000 人时投不出去 —— 攒够之前别指望它带客',
      '主页类受众池会回溯历史互动，所以「今天才建」不等于「从今天才开始算」',
    ],
  },
  lead_form_harvest: {
    label: '即时表单 · 留资',
    what: '让人在 Facebook 内填表，直接拿到姓名/电话/邮箱。',
    successSignal: '每条留资成本 + 留资的真实成色（有没有回访接得上）。',
    knownTraps: [
      '表单建好就**不能改**，要改只能复制一份重建',
      '「灵活投放表单」默认开着，它会**自行删掉表单里的问题** —— 建完必须关',
      '主页必须先接受过表单条款，否则建广告直接被拒',
    ],
  },
  messenger_direct: {
    label: '私信 · 直接开聊',
    what: '让人点广告直接进 Messenger 对话。',
    successSignal: '每个对话成本 —— 但对话数不等于好客户，要看对话内容。',
    knownTraps: [
      '🔴 结构上**强制有一句机器先开口的问候语，关不掉**（清空会被拒绝保存）',
      '🔴 问候语照抄该创意自身的语言 —— 一个广告组里混多语种创意必然出事',
      '留不下电话邮箱，人走了就断',
    ],
  },
  warm_pool_retarget: {
    label: '暖池重定向',
    what: '只投给已经跟主页互动过的人。',
    successSignal: '相比冷投的成本差。',
    knownTraps: [
      '🔴 Meta 默认会开「允许投给名单外的人」和「优势受众」—— 不关掉等于没在重定向',
      '🔴 Meta 会自动补挂相似人群，创建接口的回显里看不到，只有回读能发现',
    ],
  },
  reach_awareness: {
    label: '触达 · 认知',
    what: '尽可能便宜地让更多人看到。',
    successSignal: '触达人数 + 千次展示成本。results 恒为 0，不是失败。',
    knownTraps: ['别拿它的 results 跟留资/私信类广告比大小 —— 两者不是同一个东西'],
  },
  boost_organic_post: {
    label: '自然帖投流',
    what: '给已经发出去的帖子加钱推。',
    successSignal: '看该帖原本的目标：互动/点击/对话。',
    knownTraps: ['互动量高不代表带来客户 —— 帖子内的展开也算点击'],
  },
}

/** 打法是怎么记上的 —— 可信度递减。 */
export type PlaySource =
  /** 建广告那一刻声明的。唯一完全可信的来源。 */
  | 'declared_at_creation'
  /** 事后从广告名字解析的。**低可信** —— 名字有多套规范，而且会被改。 */
  | 'parsed_from_name'
  /** 人工补录。 */
  | 'human_backfill'

export const PLAY_SOURCE_TRUST: Readonly<Record<PlaySource, 'high' | 'low'>> = {
  declared_at_creation: 'high',
  parsed_from_name: 'low',
  human_backfill: 'high',
}

/** 名字里的线索 → 打法。顺序有意义：先匹配到的赢。 */
const NAME_HINTS: readonly (readonly [RegExp, PlayKey])[] = [
  [/thru\s*-?play|攒池|pool.?build|看完视频/i, 'thruplay_pool_build'],
  [/lead.?form|即时表单|表单|预约表单/i,        'lead_form_harvest'],
  [/重定向|retarget|暖池|warm.?pool/i,          'warm_pool_retarget'],
  [/reach|触达|awareness|知名度/i,              'reach_awareness'],
  [/boost|投流|加热/i,                          'boost_organic_post'],
  [/messenger|私信|message.?leads|ctm/i,        'messenger_direct'],
]

export interface PlayInference {
  play: PlayKey | null
  source: PlaySource
  /** 为什么是这个结论 —— 认不出时说清楚，别静默留空。 */
  reason: string
}

/**
 * 从广告系列/广告组名字猜打法。**只当补录用，不当真相源。**
 *
 * 为什么要标低可信：库里现存的名字有三套规范，而且最花钱的那条叫
 * 「新潜在客户广告 - 广告副本」（$1,653），零信息量；还有三条名字被**事后改写**
 * 成 `[停用·编造看房时间] …` 来记录事故 —— 名字驱动的判定会随改名而变，
 * 同一周重跑得出不同答案，幂等性直接破功。
 *
 * 所以：能在建广告时声明就绝不靠猜；靠猜出来的一律标 `parsed_from_name`，
 * 下游看到低可信要能区别对待。
 */
export function inferPlayFromName(name: string | null | undefined): PlayInference {
  const s = (name ?? '').trim()
  if (!s) {
    return { play: null, source: 'parsed_from_name', reason: '没有名字可解析' }
  }
  for (const [re, play] of NAME_HINTS) {
    if (re.test(s)) {
      return { play, source: 'parsed_from_name', reason: `名字里含「${re.source.split('|')[0]}」类线索（低可信，名字可能被改）` }
    }
  }
  return { play: null, source: 'parsed_from_name', reason: `名字「${s}」认不出打法 —— 需要人工补录，不猜` }
}

/** 拿一个打法的完整说明，含已知的坑。给「建广告前先看一眼」用。 */
export function describePlay(play: PlayKey): PlayDefinition {
  return PLAY_CATALOG[play]
}

/** 全部打法，给下拉框/文档用。 */
export function allPlays(): { key: PlayKey; def: PlayDefinition }[] {
  return (Object.keys(PLAY_CATALOG) as PlayKey[]).map(key => ({ key, def: PLAY_CATALOG[key] }))
}
