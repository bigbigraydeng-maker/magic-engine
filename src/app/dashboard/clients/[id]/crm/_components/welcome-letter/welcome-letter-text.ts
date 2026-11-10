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

export type RehearsalDayKind = 'consistent' | 'inconsistent' | 'partial' | 'no_leads' | 'not_compared' | 'not_yet' | 'other_rule' | 'switch_day'

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
  /** The leads' day of this batch was a day a proposal was switched (only partly compared). */
  partialDay?: boolean
}

export interface RehearsalEvidenceView {
  requiredDays: number
  consecutiveDays: number
  runFrom: string | null
  runTo: string | null
  calendar: RehearsalCalendarDay[]
  undatedRows: number
  switchToday?: boolean
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

/** 「最近发送」里的一封真发的信（不含邮箱：客人只有联系人编号，页面链到客户档案）。 */
export interface RecentSendView {
  id: string
  contact_id: string
  status: string
  reason_code: string | null
  last_block_reason: string | null
  bounce_kind: string | null
  provider_impact: string
  attempts: number
  first_attempt_at: string | null
  sent_at: string | null
  last_event_type: string | null
  last_event_at: string | null
  created_at: string
  updated_at: string
  resolution: { outcome: 'sent' | 'not_sent'; by: string; at: string } | null
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
  prerequisites?: { account: string; account_key: boolean; unsubscribe_secret: boolean; events: boolean; trial_domains: boolean; approvers?: boolean; app_url?: boolean } | null
  /** null = 读不到（页面要说读不到，不能当成「没发过」）。结果不明的信全部排在最前面。 */
  recent_sends?: RecentSendView[] | null
  recent_sends_limit?: number
  /** 结果不明、等人标的信有几封（服务端数的，不受 20 封的限制）；more = 太多，页面只列出前一部分。 */
  unknown_sends?: { count: number; more: boolean } | null
}

const STATE_TEXT: Readonly<Record<string, string>> = {
  active: '生效中：每封信发出前都会再核一次这份授权',
  not_activated: '已批准，但还没生效（授权的最后一步没完成）',
  expired: '已过期，不会再发',
  rule_invalid: '规则读不懂了，已失效',
  gate_changed: '发信关口升级过，要重新提案、重新授权',
  template_changed: '信的内容改过或被停用了，这份授权已作废：要重新提案、重新授权',
  template_unreadable: '暂时读不到模板，这期间先不发',
  trial_recipient_not_internal: '试跑名单里的地址已不在内部邮箱域名里，不会发',
  formal_sending_not_enabled: '这是正式名单的授权；这一版只发内部邮箱的试跑，正式名单一封都不发（要等「正式名单真发」那张单上线）',
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
  LEGACY_BATCH_GAP: '旧群发发给了一些 ME 没看到的人（比如回访客人、官网订阅的人、合并过的联系人；换提案那天的差额里也有一部分是换提案造成的）。换成 ME 发之后，这些人就收不到欢迎信了。授权前请先看下面的批次对账，弄清楚是谁。',
  REHEARSAL_RESETS_TOMORROW: '这份提案是今天交的：今天批，彩排天数照算；过了今天才批，今天这一天只比了一部分，连续天数会从头算，要再等 5 天。',
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
  if (body?.replaced_authorization_revoked === true) {
    // After a failed rollback this one may still be in force: then only say that the earlier one was stopped.
    text += body?.rollback === 'FAILED'
      ? ' 之前生效的那份授权已经停了。'
      : ' 注意：之前生效的那份授权已经停了，现在没有生效的授权，新客人暂时收不到欢迎信。'
  }
  if (body?.replaced_proposal_revoked === true) text += ' 注意：之前那份待批提案已经撤下，彩排会停到新提案交上为止。'
  return text
}

/** 撤销失败时的话：刹车要马上再踩，不是「稍后再试」。 */
export function revokeErrorText(body: (Answer & { current_authorization?: unknown; current_unreadable?: unknown }) | null): string {
  const code = typeof body?.error === 'string' ? body.error : ''
  if (code === 'ALREADY_REVOKED') {
    if (body?.current_unreadable === true || body?.current_authorization === undefined) {
      return '这一份早就撤销过了，但现在查不到哪一份在生效：页面已刷新，请看上面①区写的状态。'
    }
    return body.current_authorization !== null
      ? '这一份早就撤销过了。页面已刷新：上面还有另一份授权（看它写的状态），要停请点它的「撤销授权」。'
      : '这一份早就撤销过了，现在没有生效的授权。页面已刷新。'
  }
  if (code === 'AUTHORIZATION_NOT_FOUND') return '找不到这一份，页面已刷新，请看上面现在生效的是哪一份。'
  return '撤销没成功，请马上再点一次；再不行就告诉发信窗口。'
}

// ── 「最近发送」 ─────────────────────────────────────────────────────────────────────────────────────────

/** 页面顶上那一句：这一版只发试跑。 */
export const TRIAL_ONLY_NOTE = '这一版只发内部邮箱的试跑：正式名单的授权批了也一封都不发。'

/** 正式名单的提案下面那一句。 */
export const FORMAL_PROPOSAL_NOTE = '这是正式名单的提案。这一版只发内部邮箱的试跑：正式名单就算批了也一封都不发。'

/** 现在已经有一份授权在生效时，正式提案下面多说的一句。 */
export const FORMAL_PROPOSAL_REPLACES_NOTE = '而且批了会替换掉现在生效的那份授权：试跑也就停了。'

/** 试跑授权生效、又没有正式提案放着时的提醒（彩排按最新一份没撤销的规则来比）。 */
export const TRIAL_FOLLOWUP_NOTE =
  '试跑批完以后，请马上再提一份正式名单的提案放着（先不用批）：彩排按最新一份没撤销的规则来比，不提的话，试跑这几天的真客人都会被记成「不在试跑名单」，正式名单的「连续一致天数」会断。'

const SEND_STATUS_TEXT: Readonly<Record<string, string>> = {
  blocked: '暂缓：下一轮再试',
  skipped: '不发',
  pending: '正在发（或等下一轮自动重试）',
  unknown_outcome: '结果不明：系统判断不了发没发出去，要人核对',
  sent: '已交给发信服务',
  delivery_delayed: '对方邮箱暂时没收，发信服务还在重试',
  delivered: '已送达',
  suppressed: '发信服务没发（这个地址在它的停发名单里）',
  failed: '没发出',
  bounced: '退信',
  complained: '客人把信标成了垃圾邮件',
}

export type SendTone = 'track' | 'exec' | 'attn' | 'sched' | 'rej'

const SEND_STATUS_TONE: Readonly<Record<string, SendTone>> = {
  blocked: 'attn',
  skipped: 'attn',
  pending: 'sched',
  delivery_delayed: 'sched',
  unknown_outcome: 'exec',
  sent: 'track',
  delivered: 'track',
  suppressed: 'rej',
  failed: 'rej',
  bounced: 'rej',
  complained: 'rej',
}

const SEND_REASON_TEXT: Readonly<Record<string, string>> = {
  stale: '进来太久了，不再补发',
  bad_email: '邮箱地址不能用',
  system_address: '是系统地址，不是真客人',
  not_in_allowlist: '不在试跑名单里',
  dnc: '标了「别再联系」',
  mailchimp_suppressed: '在 Mailchimp 里退订了或被停发',
  excluded_tag: '带了「不发」的标签',
  no_consent_basis: '没有能发信的同意依据',
  sales_email_exists: '销售已经亲自写过信',
  frequency_full: '这 7 天收到的信已经满了',
  email_unsubscribed: '客人退订了 ME 的邮件',
  complained: '客人投诉过 ME 的信',
  hard_bounced_address: '这个邮箱以前永久退信过',
  legacy_welcomed: '旧群发已经发过欢迎信',
  address_duplicate: '同一个邮箱已经在另一位客人名下收过（或正在发）',
  dnc_unverifiable: '查不到客人有没有标「别再联系」，先不发，下一轮再看',
  consent_unreadable: '读不到客人的同意记录，先不发，下一轮再看',
  legacy_unverifiable: '查不到旧群发有没有发过，先不发，下一轮再看',
  evidence_unverifiable: '查不到销售写没写过信、这周收了几封，先不发，下一轮再看',
  frequency_unverifiable: '查不到这 7 天已经收了几封，先不发，下一轮再看',
  unsubscribe_unverifiable: '查不到客人有没有退订，先不发，下一轮再看',
  address_history_unreadable: '查不到这个邮箱有没有退信、投诉过，先不发，下一轮再看',
  missing_first_name: '客人没有名字，信里没法称呼；补上名字后下一轮会发',
  render_failed: '信没排出来',
  request_invalid: '发信内容不合格，没发',
  lock_busy: '同一位客人正被另一轮处理，下一轮再试',
  lock_unreadable: '暂时拿不到处理权，下一轮再试',
  cap_reached: '今天的封数到上限了，明天再发',
  expired_20h: '20 小时里都没确认发没发出去，系统不再重试',
  provider_rejected: '发信服务拒收了，不会重发',
  provider_account_error: '发信账号出了问题（钥匙或账号设置），没发',
  not_attempted: '发之前就停了，没发',
  provider_failed: '发信服务报告没发出',
  sent_confirmed: '人工核对后标了「已发出」',
  not_sent_confirmed: '人工核对后标了「没发出」',
  skipped: '不发',
}

const PROVIDER_IMPACT_TEXT: Readonly<Record<string, string>> = {
  NONE: '发信服务没有接收',
  PROVIDER_ACCEPTED: '发信服务已接收',
  PROVIDER_UNKNOWN: '交没交给发信服务，不确定',
}

export function sendStatusText(status: string): string {
  return SEND_STATUS_TEXT[status] ?? `状态：${status}`
}

export function sendStatusTone(status: string): SendTone {
  return SEND_STATUS_TONE[status] ?? 'attn'
}

export function sendReasonText(code: string): string {
  return SEND_REASON_TEXT[code] ?? `原因代号：${code}`
}

export function providerImpactText(impact: string): string {
  return PROVIDER_IMPACT_TEXT[impact] ?? impact
}

/** 「结果不明」怎么核对。 */
export const RESOLVE_HOW_TO_CHECK = '怎么核对：点「看客人」查到他的邮箱，去发信服务的后台按邮箱搜这封信；或者直接问客人收没收到。'

/** 点「确认」之前给 PM 看的后果。 */
export const RESOLVE_CONSEQUENCE_TEXT: Readonly<Record<'sent' | 'not_sent', string>> = {
  sent: '按「已经发出」记：算进这位客人这 7 天收到的封数，系统不会再给他发欢迎信。如果客人其实没收到，请销售手发。',
  not_sent:
    '按「没发出」记：这位客人（和这个邮箱）以后不会再自动收到欢迎信，要发请销售手发；这封仍算进他这 7 天收到的封数（系统确定不了它没发出），所以销售手发可能要等几天。时间线上那一条会改成「没有发出」。如果之后发信服务的回执证明其实送到了，这一页会跟着显示出来，但时间线那条不会自动改回：到时请告诉发信窗口，也别让销售再手发。',
}

/** 预览「已发出」时，这封信连时间线都没有：发信前一定先写时间线，写不进就不发，所以它没交给过发信服务。 */
export const NO_TIMELINE_HINT = '系统记录：这封信连时间线都没有。发信前一定先写时间线、写不进就不发，所以它没交给过发信服务，标「没发出」更准。'

/** 你标过「没发出」、后来回执证明发出去了的那一行。 */
export const RECEIPT_OVERRODE_NOT_SENT =
  '你标过「没发出」，但后来发信服务的回执证明这封信发出去了。时间线上那条还写着「没有发出」：请告诉发信窗口改回来，也别让销售再手发。'

/** 超过 20 小时还停在「正在发」的信（例如授权撤销了，没人再接手）。 */
export const STUCK_PENDING_TEXT = '超过 20 小时还没确认发没发出去：系统不会再重试，之后会转成「结果不明」让你核对。'

const RESOLVE_ERROR_TEXT: Readonly<Record<string, string>> = {
  APPROVER_REQUIRED: '只有 PM 本人能标。',
  GLOBAL_ADMIN_REQUIRED: '只有管理员能做这一步。',
  NOT_UNKNOWN: '这封信的状态已经变了（可能回执到了），不用再标。页面已刷新。',
  SEND_CHANGED: '这封信刚有了新动静，页面已刷新，请再看一眼再标。',
  ALREADY_RESOLVED: '这封信已经有人标过了，页面已刷新。',
  SEND_NOT_FOUND: '找不到这封信，页面已刷新。',
}

/** 标「已发出 / 没发出」没成功时的话。 */
export function resolveErrorText(body: { error?: unknown } | null): string {
  const code = typeof body?.error === 'string' ? body.error : ''
  return RESOLVE_ERROR_TEXT[code] ?? '这次没标成，请再点一次；再不行就告诉发信窗口。'
}

/** 标成功（或之前已经标过同样的）之后的话；时间线那一条没改成就一定说出来。 */
export function resolvedText(outcome: 'sent' | 'not_sent', body: { mode?: unknown; timeline?: unknown } | null): string {
  const label = outcome === 'sent' ? '已发出' : '没发出'
  let line = body?.mode === 'ALREADY_RESOLVED' ? `这封信之前已经标过「${label}」了。` : `已标「${label}」。`
  if (outcome === 'not_sent' && body?.mode !== 'ALREADY_RESOLVED') line += '这位客人以后不会再自动收到欢迎信。'
  if (body?.timeline === 'failed') line += '时间线上那一条没改成「没有发出」，不影响发信；请告诉发信窗口补改。'
  if (body?.timeline === 'receipt_arrived') line += '刚标完，发信服务的回执就证明这封其实发出去了：这一页已按回执显示，时间线没改，也别让销售再手发。'
  return line
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
  partial: '这天有客人还没比完（断开）',
  not_yet: '还没比（今天上午扫描后再看）',
  no_leads: '这天没有新客人',
  not_compared: '这天没比对（断开）',
  other_rule: '这天按另一份规则彩排（断开）',
  switch_day: '这天中途换了提案，只比了一部分（断开）',
}
