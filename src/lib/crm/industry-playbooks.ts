/**
 * 行业剧本注册表 —— 「这个客户属于哪个行业，冷热就按哪本剧本判」。
 *
 * `segments.ts` 里的通用引擎不认识任何行业词汇，它只问剧本三件事：
 * 有没有等待信号 / 到期没有 / 理由怎么写。行业专属的部分全封在剧本里。
 * 旅游剧本（`TOURISM_PLAYBOOK`）跟通用引擎住在一起是历史原因（它是从
 * `segmentContact` 里搬出来的第一本），新增的剧本放这里，避免 segments.ts
 * 随行业数量线性膨胀。
 */

import type { IndustryPlaybook } from './segments'
import { TOURISM_PLAYBOOK } from './segments'

/**
 * 物流 / 货代 / 3PL 剧本。
 *
 * ⚠️ **故意不实现 `resolveWaitSignal`** —— 这不是漏写。
 *
 * 旅游的等待信号是「客人说了出行时间」：一个几个月后的日历日期，说完就该
 * 压住不打扰，到点再捞回来。货代生意里没有对应的东西：客户说的是
 * 「明天给你确切尺寸」「我去找 SDS」「等供应商发货」—— 这些是**几天内的
 * 交付承诺**，不是几个月后的日历锚点，而且它们已经被通用引擎的
 * 「约好回电」（`callbackAt`，规则 3）和「客户回话了」覆盖住了。
 *
 * 硬造一个物流版 wait signal 只会让「客户答应明天给资料」这种最该当天跟的
 * 线索被压进培育桶。`IndustryPlaybook` 的接口注释写得很清楚：
 * 「不是每个行业都有这个概念 —— 没有就不实现，规则会跳过，不报错、不硬凑」。
 * 这里就是那个「没有」的情况，写明是为了下一个人不要把它当成待办补上。
 */
export const LOGISTICS_PLAYBOOK: IndustryPlaybook = {
  /**
   * 故意不覆盖 `clickWindowMs` —— 沿用通用引擎的 30 天兜底。
   *
   * 货代询价到订舱确实是交易型、节奏以天计（2026-09-02 一条真实对话里，
   * 客户从第一次问运费到追问空运截单时间只隔了两天），14 天窗口看起来更贴合。
   * 但这个 14 天目前只有单个客户的单条对话作为依据，还没跑过一整轮真实数据
   * 验证。把它直接定成行业级默认，会让第一个客户的个例定义整个物流行业的
   * 判冷热行为——一旦有第二个货代客户节奏不同，14 天就会变成误判热线索的
   * 全行业 bug，而且不报错、没人看得出来。
   *
   * 等跨客户证据攒够、能确认「物流行业普遍比 30 天短」再回来把这个值写实。
   * 在此之前，需要更短窗口的客户应该走 client-specific 配置，不是行业默认。
   */
}

/**
 * 行业代码（`mapIndustryToCategory` 的输出）→ 剧本。
 *
 * ⚠️ **没匹配到的行业返回 `{}`（空剧本），不是回退到旅游剧本。**
 *
 * 回退到旅游会让一个建材客户悄悄开始用「客人说了出行时间」这条规则判冷热 ——
 * 不报错，只是判错，而且没人看得出来。空剧本的含义是诚实的：「这个行业我们
 * 还没写剧本，行业专属信号一条都不跑，通用规则照常」。
 *
 * ⚠️ **注意**：`segmentContact` 的 playbook 参数**默认值是旅游剧本**，
 * 而现在 `crm/today` 和 `crm/contacts` 两个读接口都没传这个参数 ——
 * 也就是说今天所有客户（包括未来的物流客户）事实上都在吃旅游剧本。
 * 把这两个调用方改成用本函数解析，会改变 CTS 之外客户的线上行为，
 * 属于「影响已上线功能」，必须单独一个改动 + 走复审，不能顺手夹带。
 * 本文件只提供解析能力，不动任何调用方。
 */
export function playbookForIndustryCategory(
  category: string | null | undefined,
): IndustryPlaybook {
  switch (category) {
    case 'tourism_operator':
      return TOURISM_PLAYBOOK
    case 'logistics_3pl':
      return LOGISTICS_PLAYBOOK
    default:
      return {}
  }
}
