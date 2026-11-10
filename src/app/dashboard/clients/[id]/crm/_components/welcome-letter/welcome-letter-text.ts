/**
 * 「欢迎信自动发送」页面上的话：接口回来的代号 → 给 PM 看的大白话。纯函数，单独测。
 * 代号的含义见 src/lib/messaging/triggered-send/authorization-{commands,authorize,status}.ts。
 */

/** 接口回来的状态（只写页面要用的字段）。 */
export interface RehearsalDay {
  leadLocalDay: string
  total: number
  agree: number
  explained: number
  unexplained: number
  unavailable: number
  unexplainedContactIds: string[]
}

export interface RehearsalEvidenceView {
  requiredDays: number
  consecutiveDays: number
  days: RehearsalDay[]
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
  trial: boolean
  rehearsal: RehearsalEvidenceView | null
  rehearsal_problem?: string | null
  template: TemplateViewData | null
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
  error?: string
  server_now?: string
  mode?: 'live' | 'practice'
  proposal?: ProposalView | null
  authorization?: AuthorizationView | null
  prerequisites?: { account: string; account_key: boolean; unsubscribe_secret: boolean; receipts_webhook: boolean } | null
}

const STATE_TEXT: Readonly<Record<string, string>> = {
  active: '生效中：每封信发出前都会再核一次这份授权',
  not_activated: '已批准，但还没生效（授权回执没发出去）',
  expired: '已过期，不会再发',
  rule_invalid: '规则读不懂了，已失效',
  gate_changed: '发信关口升级过，要重新提案、重新授权',
  template_changed: '信的内容改过了，要重新提案、重新授权',
  template_not_sendable: '模板被停用或不合规，暂时发不了',
  template_unreadable: '暂时读不到模板，这期间先不发',
  revoked: '已撤销',
}

const PROBLEM_TEXT: Readonly<Record<string, string>> = {
  RULE_HAS_NO_SEND_BLOCK: '这份提案只用来彩排，没有发件人、模板这些发信设置，不能授权。要授权，得先提一份带发信设置的新提案。',
  RULE_INVALID: '这份提案的规则读不懂（或被改过），不能授权。',
  GATE_VERSION_MISMATCH: '发信关口升级过，这份提案是旧版本的，要重新提案。',
  PROPOSAL_HAS_NO_TEMPLATE: '提案没有绑定信的内容，要重新提案。',
  TEMPLATE_UNREADABLE: '暂时读不到信的模板，稍后刷新再看。',
  TEMPLATE_NOT_SENDABLE: '模板被停用，或者用了只能人工发的写法（价格、团名、挑选等），不能自动发。',
  TEMPLATE_CHANGED: '提案之后信的内容改过。你批的必须是你看到的那一版，所以要重新提案。',
  REHEARSAL_UNREADABLE: '暂时读不到彩排对照，稍后刷新再看。',
  REHEARSAL_NOT_READY: '彩排还没有连续 5 天一致，正式名单暂时不能授权（只发内部邮箱的试跑不受这条限制）。',
}

const WARNING_TEXT: Readonly<Record<string, string>> = {
  SALES_FREQUENCY_CAP_WIDER: '销售手发那条路的「每周最多几封」比这份规则宽：客人一周里可能收到超过上限的信。销售那条路归「邮件模板」设置管，这里只提醒，不拦。',
  SALES_FREQUENCY_CAP_OFF: '销售手发那条路没有设每周上限。这里只提醒，不拦。',
  SALES_FREQUENCY_CAP_UNKNOWN: '读不到销售手发那条路的每周上限。这里只提醒，不拦。',
}

const ERROR_TEXT: Readonly<Record<string, string>> = {
  GLOBAL_ADMIN_REQUIRED: '只有管理员能做这一步。',
  RULE_CHANGED: '页面上的提案已经不是最新的了，刷新后再看一遍。',
  TEMPLATE_MISMATCH: '页面上的提案已经不是最新的了，刷新后再看一遍。',
  TEMPLATE_CHANGED: '信的内容在提案之后改过，要重新提案。',
  REHEARSAL_NOT_READY: '彩排还没有连续 5 天一致，正式名单暂时不能授权。',
  PROPOSAL_REVOKED: '这份提案已经被撤下了，刷新看看。',
  PROPOSAL_NOT_OPEN: '这份提案已经被处理过了，刷新看看。',
  ALREADY_AUTHORIZED: '这份提案已经批过了，刷新看看。',
  AUTHORIZED_EXISTS: '刚好有另一份授权生效了，刷新看看。',
  PROPOSAL_NOT_FOUND: '找不到这份提案，刷新看看。',
  EVENTS_NOT_CONFIGURED: '系统的事件通道没配好，现在批不了。之前生效的授权没有动。',
  AUTHORIZATION_EVENT_NOT_SENT: '授权回执没发出去，这次授权已经自动撤回；之前生效的那份也已经停了，现在没有生效的授权。',
  AUTHORIZATION_NOT_ACTIVATED: '授权没能生效，已经自动撤回；之前生效的那份也已经停了，现在没有生效的授权。',
  REVOKED_DURING_ARMING: '授权过程中被撤销了，现在没有生效。',
  AUTHORIZE_WINDOW_REFUSED: '服务器和数据库的时间对不上，请再点一次。',
  OLD_AUTHORIZATION_NOT_REVOKED: '之前生效的授权没能停掉，所以新授权没有写。请稍后再试。',
  ALREADY_REVOKED: '已经撤销过了。',
  AUTHORIZATION_NOT_FOUND: '找不到这份授权，刷新看看。',
  REVOKE_FAILED: '撤销没写进去，请马上再点一次。',
  PROPOSAL_CONFLICT: '刚好有人也提交了提案，刷新后再试。',
  PROPOSAL_NOT_WRITTEN: '提案没写进去，请重试。',
  OLD_PROPOSAL_NOT_REVOKED: '旧提案没能撤下，新提案没有写。请稍后再试。',
  RULE_INVALID: '规则写得不对。',
  GATE_VERSION_MISMATCH: '规则的关口版本不是现在的版本。',
  ACCOUNT_INVALID: '发信账号写得不对。',
  TEMPLATE_NOT_SENDABLE: '这个模板不能自动发。',
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

/** 一次操作失败时给 PM 看的话；撤回失败时一定要叫他马上手动撤销。 */
export function errorText(body: { error?: unknown; detail?: unknown; reason?: unknown; rollback?: unknown } | null): string {
  const code = typeof body?.error === 'string' ? body.error : ''
  let text = ERROR_TEXT[code] ?? (code.startsWith('INVALID_') ? '提交的内容格式不对。' : '出错了，稍后再试。')
  if (code === 'RULE_INVALID' && typeof body?.detail === 'string') text += `（${body.detail}）`
  if (code === 'TEMPLATE_NOT_SENDABLE' && typeof body?.reason === 'string') text += `（${body.reason}）`
  if (body?.rollback === 'FAILED') text += ' 自动撤回也失败了：这份授权可能还在生效，请马上点「撤销」。'
  return text
}

/** 新西兰时间，到分钟。读不懂的时间原样显示。 */
export function nzTime(iso: string | null): string {
  if (iso === null) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(t))
}

/** 彩排结论一句话。 */
export function rehearsalHeadline(e: RehearsalEvidenceView): string {
  if (e.rowsCounted === 0) return '这份规则还没有彩排记录。'
  const done = e.consecutiveDays >= e.requiredDays
  return `最近连续 ${e.consecutiveDays} 天，ME「本该发」和旧群发「实际发」逐人一致${done ? '，已满' : '，要满'} ${e.requiredDays} 天${done ? '' : '才能授权正式名单'}。`
}
