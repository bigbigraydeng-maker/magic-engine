/**
 * 把任意抛出的值洗成一句可以写进回执 / 日志 / 待办的话。
 * 绝不外带令牌：先抹掉密钥，再压控制字符，最后截断。
 */

export const MAX_ERROR_CHARS = 160

const HIDDEN = '[已隐藏]'

const SECRET_KEYS = [
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'secret',
  'client_secret',
  'api_key',
  'api-key',
  'apikey',
  'password',
  'authorization',
]

/** key=value / key: value，只替换值；值遇到空白、& ; , 或引号就结束。 */
const KEY_VALUE_RE = new RegExp(
  `\\b(${SECRET_KEYS.join('|')})\\b(\\s*[=:]\\s*)(?:(Bearer|Basic)\\s+)?([^\\s&;,'"]+)`,
  'gi',
)

/** 独立的 Bearer <token>。 */
const BEARER_RE = /\bBearer\s+[^\s&;,'"]+/gi

/** 40 位以上的令牌样子字符串。 */
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{40,}/g

/** 控制字符 + 两个特殊空格，压成一个空格。 */
const CONTROL_RE = /[\u0000-\u001f\u007f\u00a0\u3000]+/g

function extractText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '未知错误'
}

function replaceSecrets(text: string): string {
  return text
    .replace(KEY_VALUE_RE, (_match, key: string, sep: string, scheme: string | undefined) => {
      const prefix = scheme ? `${scheme} ` : ''
      return `${key}${sep}${prefix}${HIDDEN}`
    })
    .replace(BEARER_RE, `Bearer ${HIDDEN}`)
    .replace(LONG_TOKEN_RE, HIDDEN)
}

/** 太短的“密钥”（比如空串）整句替换会把正常文字也抹坏，直接忽略。 */
const MIN_KNOWN_SECRET_CHARS = 6

/** 手里明确知道的密钥值（比如这次请求用的令牌）：整段精确抹掉，不管它长什么样、在句子的哪里。 */
function redactKnown(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length >= MIN_KNOWN_SECRET_CHARS) out = out.split(secret).join(HIDDEN)
  }
  return out
}

/**
 * @param secrets 调用方明确知道的密钥值。先精确抹掉它们，再按形状抹，最后才截断——
 *   顺序不能反：先截断的话，密钥可能被拦腰切开，剩下的半截就认不出来了。
 */
export function sanitizeError(err: unknown, secrets: readonly string[] = []): string {
  const text = redactKnown(extractText(err), secrets)
  const cleaned = replaceSecrets(text).replace(CONTROL_RE, ' ').trim()
  return cleaned.slice(0, MAX_ERROR_CHARS)
}
