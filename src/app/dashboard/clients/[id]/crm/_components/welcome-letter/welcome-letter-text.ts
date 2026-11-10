/**
 * 「欢迎信自动发送」页面上的话：接口回来的代号 → 给 PM 看的大白话。纯函数，单独测。
 * 代号的含义见 src/lib/messaging/triggered-send/authorization-{core,assess,commands,authorize,status}.ts。
 */

/** 页面顶上那一行：刚才那一下做成了什么、没做成什么。 */
export interface Notice {
  tone: 'ok' | 'bad'
  text: string
}

/** 接口回来的状态（只写页面要用的字段）。 */
export interface RehearsalStats {
  leadLocalDay: string
  total: number
  agree: number
  explained: number
  unexplained: number
  unavailable: number
  unexplainedContactIds: string[]
}

export type RehearsalDayKind = 'consistent' | 'inconsistent' | 'no_leads' | 'not_compared' | 'other_rule' | 'switch_day'

export interface RehearsalCalendarDay {
  day: string
  kind: RehearsalDayKind
  stats: RehearsalStats | null
}

export interface BatchRow {
  campaignId: string
  title: string
  sentAt: string | null
  emailsSent: number
  matchedContacts: number
  gap: number
}

export interface RehearsalEvidenceView {
  requiredDays: number
  consecutiveDays: number
  runFrom: string | null
  runTo: string | null
  calendar: RehearsalCalendarDay[]
  undatedRows: number
  batches: BatchRow[]
  batchGap: number
  rowsCounted: number
}

export interface RecordView {
  id: string
  account: string
  rule_sha256: string
  template_version: number | null
  template_sha256: string | null
  daily_cap: number
  proposed_by_email: string
  proposed_at: string
  authorized_by_email: string | null
  authorized_at: string | null
  live_from: string | null
  expires_at: string | null
  activated_at: string | null
}

export interface TemplateViewData {
  key: string
  readable: boolean
  version: number | null
  subject: string | null
  body: string | null
  check: string
}

export interface ProposalView {
  record: RecordView
  summary: string[] | null
  problem: string | null
  problem_detail?: Record<string, unknown> | null
  trial: boolean
  rehearsal: RehearsalEvidenceView | null
  rehearsal_problem?: string | null
  template: TemplateViewData | null
  mailboxes_connected?: boolean | null
  warnings: string[]
}

export interface AuthorizationView {
  record: RecordView
  summary: string[] | null
  trial: boolean
  state: string
  template: TemplateViewData | null
}

export interface StatusPayload {
  success: boolean
  can_manage?: boolean
  can_authorize?: boolean
  error?: string
  server_now?: string
  mode?: 'live' | 'practice'
  proposal?: ProposalView | null
  authorization?: AuthorizationView | null
  prerequisites?: { account: string; account_key: boolean; unsubscribe_secret: boolean; events: boolean; trial_domains: boolean } | null
}

const STATE_TEXT: Readonly<Record<string, string>> = {
  active: '生效中：每封信发出前都会再核一次这份授权',
  not_activated: '已批准，但还没生效（授权的最后一步没完成）',
  expired: '已过期，不会再发',
  rule_invalid: '规则读不懂了，已失效',
  gate_changed: '发信关口升级过，要重新提案、重新授权',
  template_changed: '信的内容改过或被停用了，这份授权已作废：要重新提案、重新授权',
  template_unreadable: '暂时读不到模板，这期间先不发',
  revoked: '已撤销',
}

const PROBLEM_TEXT: Readonly<Record<string, string>> = {
  RULE_HAS_NO_SEND_BLOCK: '这份提案只用来彩排，没有发件人、模板这些发信设置，不能授权。要授权，得先提一份带发信设置的新提案。',
  RULE_INVALID: '这份提案的规则读不懂（或被改过），不能授权。',
  GATE_VERSION_MISMATCH: '发信关口升级过，这份提案是旧版本的，要重新提案。',
  ACCOUNT_INVALID: '发信账号写得不对，要重新提案。',
  TRIAL_DOMAINS_NOT_CONFIGURED: '这是试跑提案，但系统里还没设「哪些邮箱算内部邮箱」，所以不能批。要在 Render 里设好内部邮箱的域名。',
  TRIAL_RECIPIENT_NOT_INTERNAL: '试跑名单里有不是内部邮箱的地址，不能批。试跑只许发给内部邮箱。',
  PROPOSAL_HAS_NO_TEMPLATE: '提案没有绑定信的内容，要重新提案。',
  TEMPLATE_UNREADABLE: '暂时读不到信的模板，稍后刷新再看。',
  TEMPLATE_NOT_SENDABLE: '模板被停用，或者用了只能人工发的写法（价格、团名、挑选等），不能自动发。',
  TEMPLATE_CHANGED: '提案之后信的内容改过。你批的必须是你看到的那一版，所以要重新提案。',
  REQUIRED_MAILBOXES_NOT_CONNECTED: '有销售邮箱没连上：系统要先能看到销售有没有亲自写过信，才敢自动发。先把邮箱重新连上。',
  REQUIRED_MAILBOXES_UNREADABLE: '暂时查不到销售邮箱连没连上，稍后刷新再看。',
  REHEARSAL_UNREADABLE: '暂时读不到彩排对照，稍后刷新再看。',
  REHEARSAL_NOT_READY: '彩排还没有「到昨天为止连续 5 天一致」，正式名单暂时不能授权（只发内部邮箱的试跑不受这条限制）。',
  EVENTS_NOT_CONFIGURED: '系统的事件通道没配好，现在批不了。',
}

const WARNING_TEXT: Readonly<Record<string, string>> = {
  SALES_FREQUENCY_CAP_WIDER: '销售手发那条路的「每周最多几封」比这份规则宽：客人一周里可能收到超过上限的信。销售那条路归「邮件模板」设置管，这里只提醒，不拦。',
  SALES_FREQUENCY_CAP_OFF: '销售手发那条路没有设每周上限。这里只提醒，不拦。',
  SALES_FREQUENCY_CAP_UNKNOWN: '读不到销售手发那条路的每周上限。这里只提醒，不拦。',
  LEGACY_BATCH_GAP: '旧群发发给了一些 ME 没看到的人（比如回访客人、官网订阅的人、合并过的联系人）。换成 ME 发之后，这些人就收不到欢迎信了。授权前请先看下面的批次对账，弄清楚是谁。',
}

const ERROR_TEXT: Readonly<Record<string, string>> = {
  GLOBAL_ADMIN_REQUIRED: '只有管理员能做这一步。',
  APPROVER_REQUIRED: '只有 PM 本人能授权。',
  RULE_CHANGED: '页面上的提案已经不是最新的了，刷新后再看一遍。',
  TEMPLATE_MISMATCH: '页面上的提案已经不是最新的了，刷新后再看一遍。',
  PROPOSAL_REVOKED: '这份提案已经被撤下了，页面已刷新。',
  PROPOSAL_NOT_OPEN: '这份提案刚被别人处理过（撤下或批过），这次没批成。',
  ALREADY_AUTHORIZED: '这份提案已经批过了，页面已刷新。',
  AUTHORIZED_EXISTS: '刚好有另一份授权生效了，这次没批成。',
  PROPOSAL_NOT_FOUND: '找不到这份提案，页面已刷新。',
  AUTHORIZE_WINDOW_REFUSED: '服务器和数据库的时间对不上，这次没批成。',
  AUTHORIZE_FAILED: '这次没批成。',
  REVOKED_DURING_ARMING: '授权过程中被撤销了，现在没有生效。',
  OLD_AUTHORIZATION_NOT_REVOKED: '之前生效的授权没能停掉，所以新授权没有写。之前那份照常生效。',
  AUTHORIZATION_NOT_FOUND: '找不到这份授权，页面已刷新。',
  PROPOSAL_CONFLICT: '刚好有人也提交了提案，这次没交上。',
  PROPOSAL_NOT_WRITTEN: '提案没写进去，请重试。',
  OLD_PROPOSAL_NOT_REVOKED: '旧提案没能撤下，新提案没有写。请稍后再试。',
  JSON_REQUIRED: '页面出错了，刷新后再试。',
  CLIENT_ID_MISMATCH: '页面出错了，刷新后再试。',
  INVALID_CLIENT_ID: '页面出错了，刷新后再试。',
}

export function stateText(state: string): string {
  return STATE_TEXT[state] ?? `状态：${state}`
}

export function problemText(problem: string): string {
  return PROBLEM_TEXT[problem] ?? `暂时不能授权（${problem}）`
}

export function warningText(code: string): string {
  return WARNING_TEXT[code] ?? code
}

type Answer = { error?: unknown; detail?: unknown; reason?: unknown; rollback?: unknown; replaced_authorization_revoked?: unknown; replaced_proposal_revoked?: unknown } | null

function authorizeFailureText(code: string, body: Answer): string | null {
  if (code !== 'AUTHORIZATION_EVENT_NOT_SENT' && code !== 'AUTHORIZATION_NOT_ACTIVATED') return null
  const why = code === 'AUTHORIZATION_EVENT_NOT_SENT' ? '授权回执没发出去' : '授权最后一步没完成'
  if (body?.rollback === 'FAILED') return `${why}，自动撤回也失败了：这份授权可能在生效，请马上点它的「撤销授权」。`
  return `${why}，这次授权已自动撤回；这份提案也跟着撤下了，要重新提案。`
}

/** 一次操作失败时给 PM 看的话：按实际结果拼，旧授权 / 旧提案被停了就一定说出来。 */
export function errorText(body: Answer): string {
  const code = typeof body?.error === 'string' ? body.error : ''
  let text = authorizeFailureText(code, body) ?? PROBLEM_TEXT[code] ?? ERROR_TEXT[code] ?? (code.startsWith('INVALID_') ? '提交的内容格式不对。' : '出错了，稍后再试。')
  if (code === 'RULE_INVALID' && typeof body?.detail === 'string') text += `（${body.detail}）`
  if (code === 'TEMPLATE_NOT_SENDABLE' && typeof body?.reason === 'string') text += `（${body.reason}）`
  if (body?.replaced_authorization_revoked === true) text += ' 注意：之前生效的那份授权已经停了，现在没有生效的授权，新客人暂时收不到欢迎信。'
  if (body?.replaced_proposal_revoked === true) text += ' 注意：之前那份待批提案已经撤下，彩排会停到新提案交上为止。'
  return text
}

/** 撤销失败时的话：刹车要马上再踩，不是「稍后再试」。 */
export function revokeErrorText(body: (Answer & { current_authorization?: unknown }) | null): string {
  const code = typeof body?.error === 'string' ? body.error : ''
  if (code === 'ALREADY_REVOKED') {
    return body?.current_authorization != null
      ? '这一份早就撤销过了。页面已刷新：上面还有另一份「生效中」的授权，要停请点它的「撤销授权」。'
      : '这一份早就撤销过了，现在没有生效的授权。页面已刷新。'
  }
  if (code === 'AUTHORIZATION_NOT_FOUND') return '找不到这一份，页面已刷新，请看上面现在生效的是哪一份。'
  return '撤销没成功，请马上再点一次；再不行就告诉发信窗口。'
}

/** 新西兰时间，到分钟。读不懂的时间原样显示。 */
export function nzTime(iso: string | null): string {
  if (iso === null) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(t))
  return `${text}（新西兰时间）`
}

/** 彩排结论一句话：写出日期，不说「最近」。 */
export function rehearsalHeadline(e: RehearsalEvidenceView): string {
  if (e.undatedRows > 0) return `有 ${e.undatedRows} 行彩排记录算不出是哪天的线索，先不算连续天数，请让发信窗口查。`
  if (e.consecutiveDays === 0 || e.runFrom === null || e.runTo === null) {
    return `到昨天为止没有连续一致的日子（要连续 ${e.requiredDays} 天才能授权正式名单）。`
  }
  const enough = e.consecutiveDays >= e.requiredDays
  return `${e.runFrom} 到 ${e.runTo}：连续 ${e.consecutiveDays} 天，ME「本该发」和旧群发「实际发」逐人一致${enough ? '，够了' : `，要满 ${e.requiredDays} 天`}。`
}

export const DAY_KIND_TEXT: Readonly<Record<RehearsalDayKind, string>> = {
  consistent: '一致',
  inconsistent: '有对不上的',
  no_leads: '这天没有新客人',
  not_compared: '这天没比对（断开）',
  other_rule: '这天按另一份规则彩排（断开）',
  switch_day: '这天中途换了提案，只比了一部分（断开）',
}
