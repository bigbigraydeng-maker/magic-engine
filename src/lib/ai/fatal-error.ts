/**
 * 「这个错误重试一百次也不会好」的判据 —— 账户级 AI 故障。
 *
 * ## 为什么需要它（2026-09-23 · 私信简报停产 3 天）
 *
 * OpenAI 账户 2026-09-20 19:11 UTC 余额用光。私信简报那一轮是**逐条 try/catch**
 * 写卡的（一个人的对话坏了不该让这一批剩下的人今天都看不到卡），所以额度错误
 * 不会中断循环 —— 循环忠实地对每一条候选都再试一次。
 *
 * 问题出在时间：OpenAI SDK 默认对 429 重试 2 次（带退避），于是**一条注定失败的
 * 调用要烧 20 秒**（2026-09-23 生产实测：22.2s / 18.5s / 19.0s，均值 20.1s），
 * 而正常写一张卡只要约 3.2 秒。一段 12 条 → 约 242 秒，网关约 125 秒就掐断连接：
 * 这一段永远不返回 → Inngest 重试也照样被掐 → 整条 run 判死 → `log-finish`
 * 一次都没跑到 → `cron_run_logs` 那行**永远停在「在跑」**。
 *
 * 也就是说：一个「充钱就好」的问题，被 20 秒 × 12 条放大成了「监控上看不出坏」。
 *
 * ## 判据边界（这是这个文件全部的价值，别放宽）
 *
 * 只认**账户级**：余额用光、额度用光、密钥无效/被拒。这类错误对这一轮里剩下的
 * 每一条候选都是同一个结论，**当场熄火**比逐条确认便宜得多，而且熄火之后上游
 * 能落一条带真实原因的失败记录，人看得见。
 *
 * 🔴 **普通限流（`rate_limit_exceeded`）不算**。那是「现在太挤，等一下就好」，
 *    当场熄火会把一次正常的拥堵变成一轮不写卡 —— 拥堵靠调用方的时间预算收口，
 *    不靠熄火。把两者混成一类，等于用治感冒的方式治断粮。
 */

/** 账户级 AI 故障的识别结果；不是这类故障返回 null。 */
export type FatalAiReason = string | null

/** OpenAI / Anthropic 的错误对象都带这几个字段，各带几个就读几个。 */
interface ProviderErrorShape {
  status?: unknown
  code?: unknown
  type?: unknown
  message?: unknown
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 这个错误是不是「重试也没用、这一轮剩下的全都会同样失败」。
 *
 * 返回一句中文原因（直接写进 `cron_run_logs.error_message`，PM 在体检报告里
 * 看到的就是这句），不是这类错误返回 null。
 */
export function fatalAiReason(err: unknown): FatalAiReason {
  if (!err || typeof err !== 'object') return null
  const e = err as ProviderErrorShape
  const status = typeof e.status === 'number' ? e.status : null
  const code = str(e.code)
  const type = str(e.type)
  const message = str(e.message)
  const haystack = `${code} ${type} ${message}`.toLowerCase()

  // 余额 / 额度用光。OpenAI 用 429 + insufficient_quota / credit_balance_exhausted，
  // 文案是 "You have no credits remaining"；Anthropic 用 credit_balance_too_low。
  if (
    haystack.includes('insufficient_quota') ||
    haystack.includes('credit_balance_exhausted') ||
    haystack.includes('credit_balance_too_low') ||
    haystack.includes('no credits remaining') ||
    haystack.includes('exceeded your current quota')
  ) {
    return 'AI 服务账户余额/额度用光了 —— 充值前这一轮剩下的都会同样失败，已当场停下'
  }

  // 密钥无效 / 被拒 / 权限不足。重试同样没用。
  if (status === 401 || status === 403) {
    return `AI 服务拒绝了我们的密钥（HTTP ${status}）—— 换掉密钥前这一轮剩下的都会同样失败，已当场停下`
  }
  if (haystack.includes('invalid_api_key') || haystack.includes('invalid api key')) {
    return 'AI 服务的密钥无效 —— 换掉密钥前这一轮剩下的都会同样失败，已当场停下'
  }

  return null
}
