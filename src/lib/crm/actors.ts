/**
 * 「这一笔是谁做的」—— 机器身份清单 + 翻成人话。
 *
 * ## 为什么要有这个文件
 *
 * AI 已经在读往来记录判「这个人到哪一步了」，生产上判了 971 次，**971 次都写了
 * 理由、还带客人原话**（`contact_stage_events.note`）。但员工一次都看不到完整的一条：
 *
 * · 「全部客人」页的 `TimelineItem` 显示理由，**不显示是谁判的**
 * · 「今天要联系」页的 `StageRow` 显示是谁判的，却把 `ai:conversation-read`
 *   **这串内部字符串原样丢给员工看**，而且把理由丢了
 *
 * 两个渲染器各自实现、各自漂移，正是 `contact-model.ts` 头注记过的那种事故形状。
 * 所以翻译只留一份，放在这里，两边都 import。
 *
 * ## 为什么不直接从各自的模块 import 那些常量
 *
 * `STAGE_INFER_ACTOR` 原本长在 `stage-infer.ts` 里，而那个文件 `import { supabaseAdmin }`
 * —— 客户端组件一 import 就把服务端模块拽进浏览器包，整页崩。所以常量下沉到这个
 * **不碰任何服务端东西**的文件，`stage-infer.ts` 反过来从这里拿。
 *
 * ## PM 2026-09-27 的方向
 *
 * 「尽量少让用户手动填写或选择，让大模型根据互动痕迹去记录、判断、给建议。」
 * AI 判得再准，员工看不到它凭什么判，就不会信、也不敢用 —— 记忆里那条说得更狠：
 * **「不给凭据的一键执行，按两次就没人敢按」**。这个文件是那条的落点之一。
 */

import { AUTO_TAG_ACTOR } from './qualified-buyer'

/**
 * AI 读往来记录判阶段时写下的身份。
 *
 * 🔴 单一真源在这里 —— `stage-infer.ts` 从这里 import，不要各写一份。
 */
export const STAGE_INFER_ACTOR = 'ai:conversation-read'

/** 「邮件 / WhatsApp 来客是不是有效咨询」筛选写阶段时用的机器身份（设计稿 2026-10-21-crm-valid-leads-only-design）。 */
export const ENQUIRY_SCREEN_ACTOR = 'ai:enquiry-screen'
/** 回退脚本补的反向事件用的身份。 */
export const ENQUIRY_SCREEN_ROLLBACK_ACTOR = 'ai:enquiry-screen-rollback'

/**
 * 机器发件身份（长得像邮箱，但不是人）。
 *
 * ⚠️ `governed-reply-agent@magicengine.cloud` 带 `@`，所以任何「含 @ 就算人」的
 * 判据都会把它当成真人 —— `isHumanActor` 现在就是这么判的（它今天还没有生产调用方，
 * 所以没出事）。这里先把名单立起来，让**显示**这一侧不会认错人。
 * 把 Inngest 那两个文件里的同名常量改成从这里 import，是状态模型那个工作包的事
 * （WP2 M1-②），不在这一轮。
 */
export const AUTOMATED_SENDER_EMAILS: ReadonlySet<string> = new Set([
  'governed-reply-agent@magicengine.cloud',
])

/** 这个身份是机器吗（用于显示，不用于授权）。 */
export function isAutomatedActor(actor: string | null | undefined): boolean {
  if (!actor) return false
  const a = actor.trim().toLowerCase()
  if (AUTOMATED_SENDER_EMAILS.has(a)) return true
  // `ai:` / `system:` 前缀是本仓的机器身份约定（stage-infer / qualified-buyer 都照它写）。
  return a.startsWith('ai:') || a.startsWith('system:') || a === 'system'
}

/**
 * 把「谁改的阶段」翻成员工看得懂的一句话。
 *
 * 生产上实际出现过的取值（2026-09-27 查库）：
 *   971 次 `ai:conversation-read`
 *    26 次 `system:qualified-buyer`
 *    18 次 `system`
 *    12 次 `info@ctstours.co.nz`（真人，唯一没有理由的那一类 —— 人不会解释自己）
 *
 * 认不出来的机器身份**宁可说「系统」也不要原样显示**：员工看到一串
 * `ai:something-new` 只会当成乱码，而说「系统」至少是真的。
 * 认不出来又不像机器的，按邮箱前缀显示（真人就是这么被显示的）。
 */
export function describeStageActor(actor: string | null | undefined): string {
  if (!actor || !actor.trim()) return '系统'
  const raw = actor.trim()
  const a = raw.toLowerCase()

  if (a === STAGE_INFER_ACTOR) return '系统读往来记录判的'
  if (a === AUTO_TAG_ACTOR) return '系统自动标的'
  if (a === ENQUIRY_SCREEN_ACTOR) return '系统判成不是咨询'
  if (a === ENQUIRY_SCREEN_ROLLBACK_ACTOR) return '系统撤回了不是咨询的判定'
  if (a === 'system') return '系统回填的'
  if (AUTOMATED_SENDER_EMAILS.has(a)) return '系统自动回复'
  if (isAutomatedActor(a)) return '系统'

  // 真人：只显示邮箱前缀。整个邮箱太长，而且同事之间认前缀就够。
  const local = raw.split('@')[0]
  return local && local !== raw ? `${local} 改的` : `${raw} 改的`
}

/** 这条阶段变更是机器判的吗 —— 决定要不要在旁边显示「凭这句」。 */
export function stageChangeWasAutomated(actor: string | null | undefined): boolean {
  return isAutomatedActor(actor)
}

/**
 * 机器写理由时自己加的开头。
 *
 * 这些开头在「谁改的」那一格已经说过一遍了 —— 不剥掉，员工看到的是
 * 「系统读往来记录判的 · **读往来记录判的**：客户对旅游信息感兴趣」，同一句话说两遍
 * （2026-09-27 拿生产数据试跑时肉眼抓到的）。
 *
 * 🔴 单一真源：写的那一侧（`stage-infer.ts` / `qualified-buyer-autotag.ts`）
 * 也从这里 import，别各写一份字面量 —— 一旦漂移，剥离就静默失效，
 * 而症状只是「显示有点啰嗦」，没人会去查。
 */
export const STAGE_REASON_PREFIX = {
  /** AI 读往来记录判阶段。 */
  inferred: '读往来记录判的：',
  /** 系统自动标真买家。 */
  qualifiedBuyer: '系统自动标为真买家：',
} as const

/**
 * 把库里那条理由整理成**跟在「谁改的」后面**显示的样子。
 *
 * 只剥我们自己写的那几个固定开头，不做任何聪明的猜测：剥错了会吃掉真正的理由，
 * 而那比啰嗦严重得多。剥完是空的就返回 null（让调用方干脆别显示这一格）。
 */
export function stageReasonForDisplay(note: string | null | undefined): string | null {
  if (!note) return null
  let out = note.trim()
  for (const prefix of Object.values(STAGE_REASON_PREFIX)) {
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length).trim()
      break
    }
  }
  return out.length > 0 ? out : null
}

