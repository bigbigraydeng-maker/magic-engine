/**
 * Magic Engine · Inngest 云端消费者：Tools Lab 留资 + 发信回执（工具实验室共用库整理 · 验收条件⑤）
 *
 * 两个独立事件、两个独立函数，都只做「留一条 Inngest 自己保存运行历史的回执」这一件事
 * （`step.run` 的返回值 Inngest 后台就能查到，跟 `conversation-inbound-draft.ts` 用具名
 * step id 当轻量回执是同一个写法），不驱动任何下游副作用、不做重试式重发：
 *
 *   · `tools_lab/lead.captured`         —— `lead-events.ts::recordToolLead` 每写下一条
 *                                          **新**（非重复）留资就发一次。
 *   · `tools_lab/report_email.attempted` —— 网站诊断报告邮件路由每尝试发一次（不管成功还是
 *                                          失败）就发一次，留下「什么时候、哪条线索、发没发成」
 *                                          的可查记录。**发信本身仍然同步跑在 HTTP 请求里**——
 *                                          访客立刻看到「报告已发出」还是「没发出去，请重试」
 *                                          这句诚实反馈不能变成异步的「稍后可能失败」，那样
 *                                          访客会带着假的成功感离开。这条事件只是补一条审计
 *                                          记录，不是把发信改成异步。
 *
 * 🔴 **为什么不把留资写进 CRM `contacts` 表**（原验收条件写的是「留资进 CRM」）：读过
 *    `src/lib/crm/identity.ts`/`web-form-lead.ts` 才发现，`contacts` 是**按 client_id 分租户**
 *    的——存的是「客户自己的客人」（比如 CTS 的游客、Roman 的买家），不是「Magic Engine
 *    自己的潜在客户」。广告体检的留资本来就是一个已存在的 `clients` 行（自助客户已经注册
 *    完了），没有另一个「联系人」需要新建；网站诊断的留资是匿名访客，压根不属于任何一个
 *    现有客户，硬塞进这张表要么瞎编一个 client_id（表结构从没打算这么用，风险不可控），
 *    要么就是语义上不对。**现阶段留资进「今日待办」（`src/lib/pm-todo/tool-lead-items.ts`
 *    直接读 `website_lead_events`，同步读取、无外部副作用，按 CLAUDE.md §3 本不需要
 *    Inngest）就是唯一确实有人会看到这条信号的地方。** 如果以后 PM 要给 Magic Engine
 *    自己建一套「潜在客户」CRM（不是给客户用的那套），那是一个新的产品决策，不在这次
 *    「整理已有两个工具的重复代码」范围内。
 *
 * 一事件一主：两个事件名都不在 `WORKER_OWNED_EVENTS` 里，本机 worker 不消费。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'

export const TOOLS_LAB_LEAD_CAPTURED_EVENT = 'tools_lab/lead.captured'
export const TOOLS_LAB_REPORT_EMAIL_ATTEMPTED_EVENT = 'tools_lab/report_email.attempted'

export interface ToolsLabLeadCapturedData {
  leadEventId: string
  tool: 'ads-check' | 'site-check'
  dedupeKey: Record<string, string>
  email: string | null
  created_at: string
}

export interface ToolsLabLeadReceipt {
  readonly lead_event_id: string
  readonly tool: string
  readonly has_email: boolean
  readonly received_at: string
}

export const toolsLabLeadFollowUp = inngest.createFunction(
  { id: `${CLOUD_FN_PREFIX}tools-lab-lead-followup`, name: 'Tools Lab: receipt a captured lead', retries: 1 },
  { event: TOOLS_LAB_LEAD_CAPTURED_EVENT },
  async ({ event, step }): Promise<ToolsLabLeadReceipt> => {
    const data = event.data as ToolsLabLeadCapturedData
    return step.run('receipt', async () => ({
      lead_event_id: data.leadEventId,
      tool: data.tool,
      has_email: data.email !== null,
      received_at: new Date().toISOString(),
    }))
  },
)

export interface ToolsLabReportEmailAttemptedData {
  leadId: string
  delivered: boolean
  /** Only meaningful when `delivered` is false — the code the visitor's request handler returned. */
  failureCode: string | null
  attempted_at: string
}

export interface ToolsLabReportEmailReceipt {
  readonly lead_id: string
  readonly delivered: boolean
  readonly failure_code: string | null
  readonly received_at: string
}

export const toolsLabReportEmailReceipt = inngest.createFunction(
  { id: `${CLOUD_FN_PREFIX}tools-lab-report-email-receipt`, name: 'Tools Lab: receipt a report-email send attempt', retries: 1 },
  { event: TOOLS_LAB_REPORT_EMAIL_ATTEMPTED_EVENT },
  async ({ event, step }): Promise<ToolsLabReportEmailReceipt> => {
    const data = event.data as ToolsLabReportEmailAttemptedData
    return step.run('receipt', async () => ({
      lead_id: data.leadId,
      delivered: data.delivered,
      failure_code: data.failureCode,
      received_at: new Date().toISOString(),
    }))
  },
)
