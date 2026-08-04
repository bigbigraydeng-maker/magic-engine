/**
 * 「客资数」值不值得信。
 *
 * 起因（2026-08-04 实测）：CTS 的目标《CTS 2026 Best of China 团报名》目标值 30、
 * 当前 344 —— 仪表盘上 1147% 达成。查 GA4 真实数据：
 *
 *   · 只有一个事件被标成关键事件：generate_lead，28 天 341 次
 *   · 而**开始填表**（form_start）只有 86 次 —— 人还没动表单，「产生线索」先响了 4 遍
 *   · 它在每个页面都响：首页 93、关于我们 4、签证指南 8、连预览页都有 6 ——
 *     这些页面根本没有报名表
 *   · 客户官网代码里搜不到 generate_lead（站点只发 Google Ads 转化和 Meta Lead），
 *     所以是 GA4 后台的规则造出来的，触发条件太宽
 *
 * 体检报告原本的判断是「多个事件被标成了关键事件」—— **实测证伪**，只有一个。
 * 真问题是那一个事件自己就不可信。
 *
 * 🔴 这个模块只判断「能不能信」，不改数。错的数字比没有数字更危险，
 *    但悄悄把数字改掉更危险 —— 得让人知道它为什么不能信。
 */

export type LeadsVerdict =
  | { trustworthy: true }
  | {
      trustworthy: false
      /** 机器判据，给日志和测试用 */
      reason: 'exceeds_form_starts' | 'multiple_key_events' | 'no_key_events'
      /** 给人看的一句话，说清「为什么这个数不能信」 */
      humanReason: string
    }

export interface LeadsSanityInput {
  /** 被标成关键事件的事件名 → 次数 */
  keyEventsByName: Record<string, number>
  /** 同期「开始填表」次数（GA4 增强测量自带的 form_start） */
  formStarts: number
}

/**
 * 判断这个「客资数」值不值得拿去对目标。
 *
 * 两条判据都只用**同一份 GA4 数据内部的自洽性**，不需要外部基准：
 *   ① 客资比「开始填表」还多 —— 不可能，除非那个事件不是在量表单
 *   ② 好几种事件都被算成客资 —— 那这个数是几件不同的事加在一起，没法对目标
 */
export function judgeLeadsSanity(input: LeadsSanityInput): LeadsVerdict {
  const names = Object.keys(input.keyEventsByName)
  const total = Object.values(input.keyEventsByName).reduce((a, b) => a + b, 0)

  if (names.length === 0 || total === 0) {
    return {
      trustworthy: false,
      reason: 'no_key_events',
      humanReason: '网站没有任何事件被标成「关键事件」，所以这个客资数一直是 0，不是真的没人问',
    }
  }

  // ① 客资多过「开始填表」= 那个事件量的不是表单。
  //    form_starts 为 0 时不判 —— 可能是客户根本没用表单（全靠电话/微信），
  //    那种情况下拿它当分母是冤枉人。
  if (input.formStarts > 0 && total > input.formStarts) {
    const times = (total / input.formStarts).toFixed(1)
    return {
      trustworthy: false,
      reason: 'exceeds_form_starts',
      humanReason:
        `28 天记了 ${total} 个客资，但真正开始填表的只有 ${input.formStarts} 次 —— ` +
        `客资比填表还多 ${times} 倍。多半是「产生线索」这个事件的触发条件设得太宽，` +
        '在没有表单的页面上也在响',
    }
  }

  // ② 好几种事件都算客资 —— 这个数是几件不同的事加在一起
  if (names.length > 1) {
    const listed = names
      .map((n) => `${n}(${input.keyEventsByName[n]})`)
      .join('、')
    return {
      trustworthy: false,
      reason: 'multiple_key_events',
      humanReason:
        `这个客资数是 ${names.length} 种不同事件加起来的：${listed}。` +
        '它们不是同一件事，加在一起没法拿去对目标',
    }
  }

  return { trustworthy: true }
}
