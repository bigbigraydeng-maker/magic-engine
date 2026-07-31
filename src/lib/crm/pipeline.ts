/**
 * 客户阶段模型 —— 共享枚举 / 文案 / 判定。
 *
 * 前端(配置页 + 工作台)和后端(路由校验)共用，所以这里保持纯净:
 * 不 import supabase、不碰运行时环境，client / server 都能安全引。
 *
 * stage_key 是稳定英文 slug(代码 / 审计引用，永不改)，label 是中文(运营可改)。
 * 每个阶段挂一个 marketing_action —— 决定后续自动化怎么对待这个人，也决定他
 * 还该不该出现在「今天该联系谁」的名单里。
 */

export const MARKETING_ACTIONS = ['nurture', 'defer', 'suppress', 'postsale', 'won'] as const
export type MarketingAction = (typeof MARKETING_ACTIONS)[number]

export function isMarketingAction(v: unknown): v is MarketingAction {
  return typeof v === 'string' && (MARKETING_ACTIONS as readonly string[]).includes(v)
}

/**
 * 到了这些动作的阶段，说明这个人已经有了结论性状态(成交 / 售后 / 停止营销)，
 * 不该再出现在「今天该联系谁」的通话名单里。这也是「改阶段」真正影响名单、
 * 而不是又一个没人看的状态列的关键。
 */
const SUPPRESSING_ACTIONS: ReadonlySet<MarketingAction> = new Set<MarketingAction>([
  'suppress',
  'postsale',
  'won',
])

/** 这个阶段是否应把联系人排出今天的名单。 */
export function stageSuppressesWorklist(
  action: MarketingAction | null | undefined,
  isTerminal: boolean | null | undefined,
): boolean {
  if (isTerminal) return true
  return !!action && SUPPRESSING_ACTIONS.has(action)
}

/**
 * 运营看的大白话结果卡(板桥定稿)。禁止把 slug 塞进下拉 —— 运营只看这些。
 *   title     这个阶段挂上后「系统做什么」
 *   behaviour 一句系统行为
 *   example   帮非技术 PM 对号:哪种客人该挂这一档
 *   tone      给 UI 上色区分冷暖(won 正向、suppress 中性…)
 */
export interface MarketingActionMeta {
  title: string
  behaviour: string
  example: string
  tone: 'go' | 'defer' | 'stop' | 'postsale' | 'won'
}

export const MARKETING_ACTION_META: Record<MarketingAction, MarketingActionMeta> = {
  nurture: {
    title: '继续跟进',
    behaviour: '系统自动给他发后续跟进内容，保持联系',
    example: '刚进线、已报价还在谈',
    tone: 'go',
  },
  defer: {
    title: '先放一放',
    behaviour: '现在不发，到你设的时间自动捞回名单',
    example: '说了「以后才走」',
    tone: 'defer',
  },
  suppress: {
    // 注意：这一档不只是「不自动发」，人也会从「今天该联系谁」里移走
    // （见 SUPPRESSING_ACTIONS）。文案必须说出这件事，否则运营会以为
    // 只是关掉了自动邮件，结果销售的通话名单里也不见了这个人。
    title: '停止营销',
    behaviour: '不再自动发内容，也不出现在销售今天的名单里（还能在「不在名单上的人」里找到）',
    example: '打不通、暂时没兴趣',
    tone: 'stop',
  },
  postsale: {
    title: '已成交 · 转售后',
    behaviour: '停止推销，转成售后服务；也不再出现在销售今天的名单里',
    example: '付了定金 / 全款、行程还没走完',
    tone: 'postsale',
  },
  won: {
    title: '成交结案',
    behaviour: '归档收好，不再有任何自动动作，也不出现在今天的名单里',
    example: '旅程结束、这单彻底完成',
    tone: 'won',
  },
}

/** UI fallback:将来 DB 加了新 action 而前端还没跟上时，不炸,给个中性展示。 */
export const UNKNOWN_ACTION_META: MarketingActionMeta = {
  title: '（未知动作）',
  behaviour: '这个动作系统还不认识，先当「停止营销」处理，请更新配置。',
  example: '',
  tone: 'stop',
}

export function actionMeta(action: string | null | undefined): MarketingActionMeta {
  return isMarketingAction(action) ? MARKETING_ACTION_META[action] : UNKNOWN_ACTION_META
}

/** 客户阶段(前后端共用的行模型)。 */
export interface PipelineStage {
  stageKey: string
  label: string
  sortOrder: number
  marketingAction: MarketingAction
  isTerminal: boolean
  /** 当前有多少客人在这一档(GET 时带上,配置页删除守卫要用)。 */
  contactCount?: number
}
