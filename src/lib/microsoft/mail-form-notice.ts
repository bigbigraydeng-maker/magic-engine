/**
 * 识别并解析「网站联系表单通知邮件」。
 *
 * 场景：网站把客户提交的联系表单，从公司邮箱发到公司邮箱自己。
 * 本模块只包含纯函数，不依赖 supabase / 网络。
 */

export interface FormNoticeCandidateArgs {
  direction: 'inbound' | 'outbound'
  subject: string | null
  fromAddress: string | null // 发件人地址
  mailbox: string // 已连接的邮箱地址
}

const CONTACT_FORM_SUBJECT_RE = /^contact form:/i

/**
 * 判断一封邮件是否可能是联系表单通知：
 * - 必须是 inbound
 * - 发件人地址（去空格、小写）必须等于已连接邮箱（去空格、小写）
 * - 主题（去空格）必须以 "contact form:" 开头
 *
 * 因此 "Re: Contact form: ..." / "Fwd: ..." / "回复: ..." 都会返回 false。
 */
export function isFormNoticeCandidate(a: FormNoticeCandidateArgs): boolean {
  if (a.direction !== 'inbound') return false
  if (!a.fromAddress || !a.mailbox) return false

  const from = a.fromAddress.trim().toLowerCase()
  const mailbox = a.mailbox.trim().toLowerCase()
  if (from !== mailbox) return false

  const subject = (a.subject ?? '').trim()
  return CONTACT_FORM_SUBJECT_RE.test(subject)
}

export interface FormNoticeInput {
  ownDomains: string[] // 客户自有域名（小写），例如 ['example.co.nz']
  replyTo: string[] // Reply-To 地址（可能为空）
  headers: Array<{ name: string; value: string }> // internetMessageHeaders
  body: string // 纯文本正文
  allowedDkimSelectors?: string[] // 默认 ['resend']
}

export interface FormNoticeLead {
  email: string
  name: string | null
  phone: string | null
  interest: string | null
  message: string | null
  submittedAt: string | null
  formUrl: string | null
}

export type FormNoticeReason =
  | 'bad_marker'
  | 'reply_to_count'
  | 'bad_email'
  | 'email_mismatch'
  | 'auth_failed'

export type FormNoticeParse =
  | { ok: true; lead: FormNoticeLead }
  | { ok: false; reason: FormNoticeReason }

const MARKER_RE = /^New message\s*[—–-]\s*Contact form/i
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
const DMARC_PASS_RE = /\bdmarc=pass\b/
const HEADER_FROM_RE = /header\.from=([a-z0-9.-]+)/i
const DKIM_DOMAIN_RE = /(?:^|[;\s])d=([a-z0-9.-]+)/i
const DKIM_SELECTOR_RE = /(?:^|[;\s])s=([a-z0-9._-]+)/i

const DEFAULT_DKIM_SELECTORS = ['resend']

/** 去掉域名末尾的点并转小写 */
function normaliseDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, '')
}

/** 规范化邮箱地址：去空格、小写 */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 邮箱地址是否合法（不允许空白、逗号、分号、尖括号） */
function isValidEmail(email: string): boolean {
  if (/[\s,;<>]/.test(email)) return false
  return EMAIL_RE.test(email)
}

/** 取第一个非空行 */
function firstNonEmptyLine(body: string): string {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    if (line.trim() !== '') return line
  }
  return ''
}

/** 判断某行是否为 "Message" 分隔行 */
function isMessageLine(line: string): boolean {
  return line.trim().toLowerCase() === 'message'
}

/**
 * 解析正文头部块（"Message" 行之前的部分）。
 * 标签行格式：`Label<tab 或 2+ 空格>value`，标签大小写不敏感，位于行首。
 * 每个标签只取第一次出现。
 */
function parseHeaderBlock(body: string): {
  fields: Map<string, string>
  message: string | null
} {
  const lines = body.split(/\r?\n/)
  const fields = new Map<string, string>()

  const labelRe = /^([A-Za-z][A-Za-z ]*?)(?:\t| {2,})(.*)$/
  // 真实通知里多词标签后面只有一个空格（"Travel interest Custom Itinerary"），单词标签才是多空格/制表符。
  // 已知的多词标签单独认，不放宽通用规则（放宽会把留言里的句子当标签）。
  const multiWordRe = /^(Travel interest|Form URL|First landing page|Submitted from|Arrived via|Tour pages viewed)\s+(.*)$/i

  let messageStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (isMessageLine(lines[i])) {
      messageStart = i
      break
    }
    const match = multiWordRe.exec(lines[i]) ?? labelRe.exec(lines[i])
    if (!match) continue
    const label = match[1].trim().toLowerCase()
    const value = match[2].trim()
    if (!fields.has(label)) {
      fields.set(label, value)
    }
  }

  let message: string | null = null
  if (messageStart >= 0) {
    const raw = lines
      .slice(messageStart + 1)
      .join('\n')
      .trim()
    const collapsed = raw.replace(/\s+/g, ' ').trim()
    if (collapsed !== '') {
      message = collapsed.slice(0, 200)
    }
  }

  return { fields, message }
}

/** 从 Form URL 值中只保留 '<' 之前的部分 */
function extractFormUrl(value: string | undefined): string | null {
  if (value === undefined) return null
  const idx = value.indexOf('<')
  const url = (idx >= 0 ? value.slice(0, idx) : value).trim()
  return url === '' ? null : url
}

/** 校验认证结果（DMARC + DKIM） */
function checkAuth(
  input: FormNoticeInput,
  ownDomains: string[],
): boolean {
  const allowedSelectors = (
    input.allowedDkimSelectors ?? DEFAULT_DKIM_SELECTORS
  ).map((s) => s.trim().toLowerCase())

  // 只使用第一个 Authentication-Results 头
  const authHeader = input.headers.find(
    (h) => h.name.trim().toLowerCase() === 'authentication-results',
  )
  if (!authHeader) return false

  const authValue = authHeader.value
  if (!DMARC_PASS_RE.test(authValue)) return false

  const headerFromMatch = HEADER_FROM_RE.exec(authValue)
  if (!headerFromMatch) return false
  const headerFromDomain = normaliseDomain(headerFromMatch[1])
  if (!ownDomains.includes(headerFromDomain)) return false

  // 🔴 DKIM 必须是**收件服务器验证通过**的：Authentication-Results 里要有 `dkim=pass ... header.d=<自家域>`。
  // 只看 DKIM-Signature 头不够 —— 那一行是发件人自己写的，可以原样伪造（魏征 2026-10-19 复审 R1）。
  const dkimPassRe = /dkim=pass[^;]*?header\.d=([a-z0-9.-]+)/gi
  let dkimVerified = false
  for (let m = dkimPassRe.exec(authValue); m; m = dkimPassRe.exec(authValue)) {
    if (ownDomains.includes(normaliseDomain(m[1]))) dkimVerified = true
  }
  if (!dkimVerified) return false

  // 至少一个 DKIM-Signature，其 d= 属于自有域名，s= 在允许列表中
  const dkimOk = input.headers.some((h) => {
    if (h.name.trim().toLowerCase() !== 'dkim-signature') return false
    const dMatch = DKIM_DOMAIN_RE.exec(h.value)
    if (!dMatch) return false
    const domain = normaliseDomain(dMatch[1])
    if (!ownDomains.includes(domain)) return false

    const sMatch = DKIM_SELECTOR_RE.exec(h.value)
    if (!sMatch) return false
    const selector = sMatch[1].trim().toLowerCase()
    return allowedSelectors.includes(selector)
  })

  return dkimOk
}

/**
 * 解析联系表单通知邮件。
 * 按顺序检查，返回第一个失败原因。
 */
export function parseFormNotice(input: FormNoticeInput): FormNoticeParse {
  const ownDomains = input.ownDomains.map(normaliseDomain)

  // 1. 标记行
  const markerLine = firstNonEmptyLine(input.body)
  if (!MARKER_RE.test(markerLine)) {
    return { ok: false, reason: 'bad_marker' }
  }

  // 2. 认证
  if (!checkAuth(input, ownDomains)) {
    return { ok: false, reason: 'auth_failed' }
  }

  // 3. Reply-To 数量
  const replyToAddresses = input.replyTo
    .map((r) => r.trim())
    .filter((r) => r !== '')
  if (replyToAddresses.length !== 1) {
    return { ok: false, reason: 'reply_to_count' }
  }

  // 4. 解析正文头部块
  const { fields, message } = parseHeaderBlock(input.body)

  const bodyEmailRaw = fields.get('email')
  const name = fields.get('name') ?? null
  const phone = fields.get('phone') ?? null
  const interest = fields.get('travel interest') ?? null
  const submittedAt = fields.get('submitted') ?? null
  const formUrl = extractFormUrl(fields.get('form url'))

  // 5. 邮箱合法性
  if (bodyEmailRaw === undefined) {
    return { ok: false, reason: 'bad_email' }
  }
  const bodyEmail = normaliseEmail(bodyEmailRaw)
  const replyToEmail = normaliseEmail(replyToAddresses[0])

  if (!isValidEmail(bodyEmail) || !isValidEmail(replyToEmail)) {
    return { ok: false, reason: 'bad_email' }
  }

  // 6. 邮箱一致性
  if (bodyEmail !== replyToEmail) {
    return { ok: false, reason: 'email_mismatch' }
  }

  return {
    ok: true,
    lead: {
      email: bodyEmail,
      name,
      phone,
      interest,
      message,
      submittedAt,
      formUrl,
    },
  }
}
