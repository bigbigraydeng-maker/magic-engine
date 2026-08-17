/**
 * Facebook「点私信」广告落进来的那条**开场白**里，客人的姓名 / 电话 / 邮箱。
 *
 * ## 为什么要有这个文件
 *
 * PM 2026-08-17 报的线上问题：CRM 卡片上写着「💬 没留电话 —— 只能在 Messenger
 * 回他」，**但那个人明明留了电话和邮箱** —— 就写在这段对话的第一条消息里。
 *
 * Meta 的 lead 广告走 Messenger 时，客人填完表单，系统会以**客人的身份**发出
 * 一条固定格式的开场白，长这样（格式来自 PM 2026-08-17 给的线上样本，
 * **姓名 / 电话 / 邮箱已全部换成虚构值** —— 真实客户资料不进仓库）：
 *
 * ```
 * Hello! I filled out your form and would like to know more about your business.
 * Full name: Jordan Avery
 * Phone number: 021 555 0134
 * Which tour interests you most?: Still deciding — show me all 4
 * Email: jordan.avery.example@example.com
 * ```
 *
 * 同步私信时这段正文原样存进了 `conversation_messages`，但**没有人去读它** ——
 * `link-contacts` 只拿正文里的邮箱去「认出这是谁」，从来不把电话邮箱**取出来
 * 补进客户档案**。于是档案上那两栏是空的，卡片就照实说「没留电话」，
 * 销售信了这句话，只好去私信里回 —— 而客人其实在等电话。
 *
 * ## 跟 `meta-lead.ts` 的关系
 *
 * 字段名是同一套（`Full name` / `Phone number` / `Email` + 客户自定义问题），
 * 因为两边都来自同一张 Meta 表单，只是一个从 Graph 的 lead 接口进来（结构化
 * 的 `field_data`），一个以纯文本落在私信里。所以这里**只做「文本 → 问答对」
 * 这一步**，剩下的标准化交给 `parseLeadAnswers()`：
 *
 *   · 「感兴趣的团」只认问题名里带 tour 的那一条（不是抓第一个自定义答案）
 *   · 姓名允许 `Full name` 或 `First/Last name` 两种
 *   · 自定义问答原样保留
 *
 * 一份判据，两个入口 —— 以后表单加字段，两边一起认。
 *
 * ## 判据宁可窄
 *
 * 认不出来只是少补一条电话（现状），**认错了会把别人的号码写进这个人的档案**。
 * 所以要求同时满足：
 *   1. 至少命中一条**标准字段**（姓名 / 电话 / 邮箱），自定义问题不算数
 *   2. 那一行必须是 `标签: 值` 的规整写法
 * 客人自己手打的「my number is 021...」故意不认 —— 那种写法怎么解释都有歧义，
 * 该由销售看一眼再决定。
 */

import { parseLeadAnswers, type ParsedLeadAnswers } from '@/lib/crm/meta-lead'
import type { MetaLeadAnswer } from '@/lib/meta/lead-forms'

/**
 * 标签 → Meta 标准字段名。
 *
 * 键是**归一化之后**的标签（小写、去掉空格和下划线），所以 `Full name` /
 * `full_name` / `Full Name` 都落到同一条。
 */
const LABEL_TO_FIELD: Record<string, string> = {
  fullname: 'full_name',
  name: 'full_name',
  firstname: 'first_name',
  lastname: 'last_name',
  phonenumber: 'phone_number',
  phone: 'phone_number',
  mobile: 'phone_number',
  email: 'email',
  emailaddress: 'email',
}

/**
 * 那条开场白自带的固定问候语。
 *
 * 🔴 **没有它就不能只凭「有 Email: 一行」认定这是表单开场白**（Codex 复审
 * 2026-08-17）：客人在对话中途转发同行者的资料、贴一段邮件签名，同样是
 * `Name: … / Phone: …` 的形状 —— 认了就会把**别人的号码**写进这个人的档案。
 *
 * Meta 的模板措辞可能随语言变，所以不强制要求它，而是当成两条路之一：
 * 有这句话 → 认；没有 → 必须**至少两条标准字段**（姓名/电话/邮箱里的两条），
 * 且调用方对第一条入站消息之后的每一条都要求它。
 *
 * 🔴 **必须锚在开头、而且主语是「我」**（Codex 复审 2026-08-17）：裸的
 * `filled out the form` 会把「**my friend** filled out the form」也当成模板 ——
 * 那正是「客人转发同行者资料」最自然的说法，认了就把别人的号码写进这个人的档案。
 * Meta 的模板永远是消息开头的第一人称那一句，所以判据跟着锚死。
 */
const FORM_MARKER =
  /^\s*(hello|hi|hey)?\s*[!,.，。]?\s*(i|i've|i have)\s+(just\s+)?fill(ed)?\s+out\s+(your|the)\s+form|^\s*(你好|您好)?[!！,，。]?\s*我(已经|刚)?填(写)?了(你们的|贵司的)?.{0,4}表单/i

/** 归一化标签：小写 + 去掉空格 / 下划线 / 连字符。 */
function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/[\s_-]/g, '')
}

/**
 * 一行里的「标签: 值」。
 *
 * 中英文冒号都认（客户的自定义问题可能是中文）。**值里允许再出现冒号** ——
 * 只在第一个冒号处切开，否则 `Which tour interests you most?: 3:1 私家团`
 * 这种会被切碎。
 */
const LINE_RE = /^\s*([^:：\n]{1,60})[:：]\s*(.+?)\s*$/

/**
 * 这条私信是不是那条开场白；是的话，把里面的字段取出来。
 *
 * 返回 `null` = 不是（普通聊天、或格式对不上）。**调用方只该拿它补空栏，
 * 不该拿它覆盖已有的值** —— 客人后来亲口更正过的号码比表单里那个新。
 */
export function parseLeadIntroMessage(
  body: string | null | undefined,
  /**
   * `true` = **必须**带那句问候语才认。
   *
   * 🔴 调用方对**第一条入站消息之后**的每一条都要传 true（Codex 复审 2026-08-17）：
   * 「两条标准字段」这条兜底只对开场白位置成立；对话中途客人转发同行者的
   * `Name: … / Phone: …`，恰好也是两条字段 —— 认了就把别人的号码写进这个人的档案。
   */
  opts: { requireMarker?: boolean } = {},
): ParsedLeadAnswers | null {
  if (!body) return null

  const answers: MetaLeadAnswer[] = []
  const standardFields = new Set<string>()

  for (const line of body.split('\n')) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const rawLabel = m[1].trim()
    const value = m[2].trim()
    if (!rawLabel || !value) continue

    const field = LABEL_TO_FIELD[normaliseLabel(rawLabel)]
    if (field) {
      standardFields.add(field === 'first_name' || field === 'last_name' ? 'full_name' : field)
      answers.push({ name: field, value })
    } else {
      // 自定义问题原样带过去 —— `parseLeadAnswers` 会挑出问题名带 tour 的那条。
      answers.push({ name: rawLabel, value })
    }
  }

  // 一条标准字段都没有 = 这不是那条开场白，宁可不认。
  if (standardFields.size === 0) return null

  /**
   * 🔴 没有那句问候语时，**必须两条以上标准字段**才算数（Codex 复审 2026-08-17）。
   * 一条 `Phone: 021…` 太容易在正常聊天里出现（转发同行者资料、邮件签名），
   * 而认错的代价是把别人的号码写进这个人的档案。
   */
  if (!FORM_MARKER.test(body) && (opts.requireMarker || standardFields.size < 2)) return null

  const parsed = parseLeadAnswers(answers)
  // 三样全空（比如只有一行 `Notes: ...` 被当成自定义问题）也不算。
  if (!parsed.name && !parsed.phone && !parsed.email) return null
  return parsed
}
