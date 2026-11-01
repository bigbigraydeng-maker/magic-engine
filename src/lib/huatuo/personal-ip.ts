/**
 * 个人 IP 客户的开方要求（客户类型 = personal_ip 时才追加；普通客户的提示词一字不变）。
 *
 * 客户类型来自 clients.client_kind（NULL = 普通），不靠关键词猜。
 * 达标线一律跟「开方时的起点」比，不写具体涨粉数字。
 */

import type { ClientKind, PrescriptionIntake } from '@/types/diagnostic'
import type { DiscoveredSocial } from '@/lib/zhangqian/types'

export const CLIENT_KIND_LABEL: Readonly<Record<ClientKind, string>> = {
  standard: '普通客户',
  personal_ip: '个人 IP',
}

/** 读库值 / 请求值。读不懂、空值一律当普通客户。 */
export function readClientKind(value: unknown): ClientKind {
  return value === 'personal_ip' ? 'personal_ip' : 'standard'
}

export function isPersonalIp(intake: Pick<PrescriptionIntake, 'client_kind'> | null | undefined): boolean {
  return intake?.client_kind === 'personal_ip'
}

/** 本人每周能拍几条：只认正整数，其余当没问到。 */
export function readWeeklyShootCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : null
}

/** 已扫描到的粉丝数、发帖数、互动率原始数；没扫到的写「未扫描到」，不估。 */
export function scannedSocialLines(profiles: DiscoveredSocial[] | null | undefined): string {
  const rows = (profiles ?? []).filter((p) =>
    p.followers_count != null || p.posts_last_30d != null || p.engagement_rate != null)
  if (rows.length === 0) return '（未扫描到粉丝数、发帖数、互动率；起点按「未知」处理，不要估一个数）'
  return rows.map((p) => {
    const followers = p.followers_count != null ? `${p.followers_count} 粉丝` : '粉丝数未扫描到'
    const posts = p.posts_last_30d != null ? `近 30 天发帖 ${p.posts_last_30d} 条` : '发帖数未扫描到'
    const rate = p.engagement_rate != null ? `互动率 ${(p.engagement_rate * 100).toFixed(1)}%` : '互动率未扫描到'
    return `- ${p.platform}${p.handle ? ` ${p.handle}` : ''}：${followers}，${posts}，${rate}`
  }).join('\n')
}

function shootLine(count: number | null | undefined): string {
  return count
    ? `- **本人每周能拍**：${count} 条（工作量不得超过这个数）`
    : '- **本人每周能拍**：未提供（按每周 2 条以内保守排，并在 notes 写明这是假设）'
}

/** 加在「客户意向」后面的几行。普通客户返回空串。 */
export function personalIpIntakeLines(
  intake: PrescriptionIntake,
  profiles: DiscoveredSocial[] | null | undefined,
): string {
  if (!isPersonalIp(intake)) return ''
  return `\n- **客户类型**：个人 IP（人就是品牌）\n${shootLine(intake.weekly_shoot_count)}\n- **已扫描到的社媒起点（原始数）**：\n${scannedSocialLines(profiles)}`
}

/** 加在「现在生成处方 JSON」记住清单末尾。普通客户返回空串。 */
export function personalIpInstruction(intake: PrescriptionIntake): string {
  if (!isPersonalIp(intake)) return ''
  return `

## 个人 IP 开方要求（本客户是个人 IP，以下优先于通用打法）

分三步，总共 12 周，phases 按这三步排：
- **第 1–3 周 立人设**：定人设、定 3–4 个固定选题栏目、稳定发内容；基本不投广告（广告预算接近 0）。**网站**：上线或补强「我是谁」页面（谁、做什么、凭什么信）；同步跟踪 AI 回答里有没有提到本人。
- **第 4–7 周 放大加攒人**：用视频广告攒「看过的人」；给表现前 20% 的自然帖加钱推；这一步约占总预算 60%。
- **第 8–12 周 把信任变成生意**：做案例和证言内容；对看过的人重投；用私信开聊广告把人引到私信。**CRM**：咨询一律引到 Facebook Messenger 私信或网站表单，进同一条 CRM 管道跟进。

渠道与指标：
- 内容渠道只用 **Facebook、TikTok、YouTube、Messenger**（不要写小红书等其他平台）。
- 粉丝数、触达/覆盖只作**展示参考**，不要写成 phasing 目标或 KPI 数字。

硬要求：
1. 一条内容要拆成多条用（长视频切短视频、配图文、摘金句），工作量按「本人每周能拍几条」排，不得超过。
2. 达标线一律跟开方时的起点比（互动率不低于起点、粉丝每月净增为正），**不写具体涨粉数字，不承诺涨粉**。
3. 主指标用：粉丝增量、私信对话数、品牌名搜索量；不要强行写目标线索成本。
4. 起点只用上面「已扫描到的社媒起点」里的原始数，没有就写未知，不要估。`
}

/** 自评阶段追加一条检查。普通客户返回空串。 */
export function personalIpSelfGradeCheck(intake: PrescriptionIntake): string {
  if (!isPersonalIp(intake)) return ''
  const cap = intake.weekly_shoot_count
    ? `本人每周能拍 ${intake.weekly_shoot_count} 条`
    : '本人每周拍摄量未提供（按每周 2 条以内算）'
  return `## 个人 IP 额外检查
- 排的内容量有没有超过本人能拍的量？（${cap}）超过就在 weaknesses 里写一条 high。
- 有没有写具体涨粉数字或承诺涨粉？有就写一条 high。
`
}
