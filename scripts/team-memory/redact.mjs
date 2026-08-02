/**
 * Team Working Memory — 本机脱敏（第一道）
 *
 * 密钥在**离开这台电脑之前**就抹掉。服务端 src/lib/team-memory/redact.ts 还有第二道。
 * 两道故意重复：只有一道的话，哪天这个脚本没更新，密钥就直接进库了。
 */

const RULES = [
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{8,}/g],
  ['openai', /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g],
  ['github', /\bgh[pousr]_[A-Za-z0-9]{16,}/g],
  ['meta', /\bEAA[A-Za-z0-9]{20,}/g],
  ['google', /\bAIza[A-Za-z0-9_-]{20,}/g],
  ['slack', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['stripe', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['bearer', /\b[Bb]earer\s+[A-Za-z0-9._-]{12,}/g],
  [
    'assignment',
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Za-z0-9_]*)\s*[=:]\s*["']?[^\s"']{6,}/gi,
  ],
  ['pem', /-----BEGIN[^-]{0,40}PRIVATE KEY-----[\s\S]*?-----END[^-]{0,40}PRIVATE KEY-----/g],
]

const MAX_LEN = 600

export function redact(input) {
  if (!input) return ''
  let text = String(input)

  for (const [name, pattern] of RULES) {
    const re = new RegExp(pattern.source, pattern.flags)
    text = text.replace(re, `[已抹去:${name}]`)
  }

  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN)}…[截断]`
  return text
}

/** 单行化 + 脱敏，用于把命令、文件路径塞进一行摘要 */
export function oneLine(input, max = 200) {
  const t = redact(input).replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
