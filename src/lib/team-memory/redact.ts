/**
 * Team Working Memory — 服务端脱敏（第二道）
 *
 * 第一道在本机 hook 里（scripts/team-memory/redact.mjs），上报前就抹。
 * 这里是第二道：即使 hook 版本旧了 / 漏了，落库前再抹一次。
 * 两份清单不要求逐字一致 —— 纵深防御，宁可重复也不要只有一层。
 */

/** 每条事件摘要的硬上限，防止把整个文件内容刷进库 */
const MAX_SUMMARY_LEN = 600

interface RedactRule {
  name: string
  pattern: RegExp
}

const RULES: RedactRule[] = [
  // 各家 API key / token 的字面前缀
  { name: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { name: 'openai', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g },
  { name: 'github', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g },
  { name: 'meta', pattern: /\bEAA[A-Za-z0-9]{20,}/g },
  { name: 'google', pattern: /\bAIza[A-Za-z0-9_-]{20,}/g },
  { name: 'slack', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'stripe', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  // JWT（Supabase service key、GBP token 等都长这样）
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Authorization: Bearer xxx
  { name: 'bearer', pattern: /\b[Bb]earer\s+[A-Za-z0-9._-]{12,}/g },
  // KEY=value / password=value / token: value 形式
  {
    name: 'assignment',
    pattern:
      /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Za-z0-9_]*)\s*[=:]\s*["']?[^\s"']{6,}/gi,
  },
  // 私钥块
  { name: 'pem', pattern: /-----BEGIN[^-]{0,40}PRIVATE KEY-----[\s\S]*?-----END[^-]{0,40}PRIVATE KEY-----/g },
]

export interface RedactResult {
  text: string
  /** 命中的规则名，落库时留痕，方便回头确认脱敏在工作 */
  hits: string[]
}

/**
 * 抹掉文本里的密钥，并硬截断长度。
 * 只在这里做「抹」，不做「拒收」—— 拒收会让整条事件丢失，反而看不出发生过什么。
 */
export function redact(input: string | null | undefined): RedactResult {
  if (!input) return { text: '', hits: [] }

  const hits: string[] = []
  let text = input

  for (const rule of RULES) {
    // 每条规则用新的 lastIndex，避免 /g 正则跨调用串状态
    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    if (re.test(text)) {
      hits.push(rule.name)
      text = text.replace(new RegExp(rule.pattern.source, rule.pattern.flags), `[已抹去:${rule.name}]`)
    }
  }

  if (text.length > MAX_SUMMARY_LEN) {
    text = `${text.slice(0, MAX_SUMMARY_LEN)}…[截断]`
  }

  return { text, hits }
}

/** 批量脱敏，返回所有命中的规则名（去重） */
export function redactAll(values: (string | null | undefined)[]): {
  texts: string[]
  hits: string[]
} {
  const texts: string[] = []
  const hitSet = new Set<string>()
  for (const v of values) {
    const r = redact(v)
    texts.push(r.text)
    r.hits.forEach((h) => hitSet.add(h))
  }
  return { texts, hits: Array.from(hitSet) }
}
