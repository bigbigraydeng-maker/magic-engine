/**
 * 「今天该联系谁」看板上有哪几列。
 *
 * ⚠️ 为什么这份名单从路由里搬出来单独成文件（2026-08-02 真实事故）：
 *
 * 它原来是 `/crm/today` 路由里的一个局部常量。后来加了 `clicked_link`
 * （「看了行程，还没人跟」）这一段，段位、文案、优先级全写好了，**唯独忘了
 * 往这份名单里加一行**。结果 33 位客人 —— 都是自己点开了行程链接、之后没人
 * 联系过的，是名单上意向最明确的一批 —— 在整个页面上一个字都看不到：
 * 他们是 warm，进不了下面「不在今天名单上的人」那一栏（只收 cold / off），
 * 而看板又没有他们的列。人就这么凭空消失了，没有任何报错。
 *
 * 搬出来是为了能被测试钉住：`__tests__/worklist-groups.test.ts` 断言
 * **每一个 hot / warm 段都必须落在某一列里**。以后再加新段，忘了配列会当场
 * 测试失败，而不是等客人静悄悄地漏掉。
 */

import { SEGMENT_META, SEGMENT_ACTION_META, type Segment } from './segments'

/**
 * 这一列属于哪一层。
 *
 * 2026-08-02 PM 的判断：现在的看板把两种完全不同的东西铺在一起 ——
 * 「今天要跟进」「快出行了」是**要人做的事**（30 人），而「新客人」
 * 「打过没人接」「聊过没下文」是**积压的人堆**（354 人）。把 354 人的库存
 * 铺在「今天该联系谁」上，等于每天早上给销售看一座山；他做不完，就不再打开
 * 这一页 —— 那正是他要逃离的 Excel。
 *
 * 所以分三层，这一页只回答一个问题：**现在轮到人做什么**。
 */
export type WorklistLayer =
  /**
   * **客人真的开过口或动过手，而且没有真人回过他。**
   *
   * PM 2026-08-03 把这一层的定义收紧成一句话：以各渠道**真实对话内容**为准 ——
   * 邮箱回信、Messenger 回复、以后的 WhatsApp / 电话 / 短信。加上「点了我们
   * 邮件里的链接」（点击要真人动手；**打开不算**，苹果会替客人自动打开）。
   *
   * 「机器回过了」不算回过：Meta 的 AI 客服接了话，客人照样在等一个真人。
   */
  | 'waiting'
  /** 还没搭上话的：新进来的、打过一次没接上的。要人主动出击。 */
  | 'acted'
  /** 人不再一个个打了，交给自动跟进。折叠，只看数字。 */
  | 'queued'

export interface WorklistGroup {
  key: string
  members: Segment[]
  layer: WorklistLayer
}

/**
 * 展示用分桶。顺序就是列在页面上从左到右的顺序。
 *
 *「客户回话了」与「该回电了」合成一列：对销售来说这两批的动作完全一样 ——
 * 今天打这个电话。分成两个名字相近的列，只是让人在「这俩有什么区别」上多花
 * 一秒。区别保留在每个人卡片下面那行原因里（seg.reason），那才是有用的粒度：
 *「客户来消息了，已经等了 18 小时」比列名更能说明问题。
 */
export const WORKLIST_GROUPS: WorklistGroup[] = [
  { key: 'following_up',       members: ['replied', 'callback_due'], layer: 'waiting' },
  // 点了链接 = 客人自己动了手，跟「他回话了」是同一件事：有人在等。
  // （2026-08-03 从 acted 挪上来。PM 原话说的是「打开了邮件」，但打开证明不了
  //  任何事 —— 苹果的隐私保护会替用户自动打开；点击才要真人动手。）
  { key: 'clicked_link',       members: ['clicked_link'],            layer: 'waiting' },
  // 新进来的人在这里等第一步。原来它被放在最下面那层、还默认折起来 ——
  // 等于每天新来的询价一进系统就被折叠了。
  { key: 'new_untouched',      members: ['new_untouched'],           layer: 'acted' },
  { key: 'retry_channel',      members: ['retry_channel'],           layer: 'acted' },
  // 「聊过一轮就断了」排在「联系不上」前面：那批人我们真的说上过话，
  // 回头捞的价值比一个从没接通过的电话高。
  { key: 'stale_conversation', members: ['stale_conversation'],      layer: 'queued' },
  { key: 'handoff_sop',        members: ['handoff_sop'],             layer: 'queued' },
]

/** 每一层在页面上怎么说。措辞就是这一页的产品说明书，不是装饰。 */
export const LAYER_META: Record<WorklistLayer, { title: string; hint: string }> = {
  waiting: {
    title: '客人在等你',
    hint: '今天必须有人回。做完这一层，今天就算过关。',
  },
  acted: {
    title: '还没搭上话',
    hint: '新进来的、和打过一次没接上的。要你主动出击 —— 越早联系越容易成。',
  },
  queued: {
    title: '先放着，系统盯着',
    hint: '打了三天还没接上，人不用再一个个打了。他一旦开口或点链接，会自己跳回最上面。',
  },
}

/** 合并列要自己写标题（单段的列直接用那一段的文案）。 */
export const WORKLIST_GROUP_META: Record<string, { label: string; howTo: string }> = {
  following_up: {
    label: '今天要跟进',
    howTo: '客户来了消息，或之前约好今天打 —— 这批最容易成，今天一定要联系。每个人下面写了他为什么在这儿。',
  },
}

/** 这一列显示成什么样。合并列用 WORKLIST_GROUP_META 覆盖首个成员的文案。 */
export function groupDisplayMeta(group: WorklistGroup) {
  return { ...SEGMENT_ACTION_META[group.members[0]], ...(WORKLIST_GROUP_META[group.key] ?? {}) }
}

/**
 * 该出现在今天名单上的所有段 —— 也就是「必须有列可去」的那些。
 *
 * cold（以后才走）和 off（已成交 / 不再联系）走页面下方那一栏，不占列。
 */
/** 某一层有哪几列，顺序照旧。 */
export function groupsInLayer(layer: WorklistLayer): WorklistGroup[] {
  return WORKLIST_GROUPS.filter((g) => g.layer === layer)
}

export function worklistSegments(): Segment[] {
  return (Object.keys(SEGMENT_META) as Segment[]).filter((s) => {
    const t = SEGMENT_META[s].temperature
    return t === 'hot' || t === 'warm'
  })
}
