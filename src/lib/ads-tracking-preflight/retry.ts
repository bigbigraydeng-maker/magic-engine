/**
 * 外部读取失败后「多试一次」的小工具（平台通用）。
 *
 * 为什么放在读取器里而不靠函数级的 retries: 2：读取器永不 reject——读不到就带着原因返回，
 * 对应的门判灰。所以函数不会抛错、Inngest 的函数级重试根本不会被触发，
 * 开投日一次网络抖动就会把硬门判成灰。每个外部读取自己多试一次，抖动就被吃掉了。
 *
 * 只用在只读请求上（重试没有副作用）。最多多试一次：第二次的结果（或错误）就是最终结果。
 */

export type Sleep = (ms: number) => Promise<void>

/** 失败后等多久再试一次（毫秒）。 */
export const RETRY_DELAY_MS = 800

export const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export interface RetryOptions<T> {
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
  delayMs?: number
  /** 抛出的错误值得重试吗？默认值得（网络错误、超时都算）。返回 false = 原样抛出。 */
  retryError?: (error: unknown) => boolean
  /** 没抛错，但结果本身说明是瞬时故障吗（比如 503、限流）？ */
  retryResult?: (result: T) => boolean
}

export async function retryOnce<T>(op: () => Promise<T>, options: RetryOptions<T> = {}): Promise<T> {
  const sleep = options.sleep ?? realSleep
  const delayMs = options.delayMs ?? RETRY_DELAY_MS

  let first: T
  try {
    first = await op()
  } catch (error) {
    if (options.retryError !== undefined && !options.retryError(error)) throw error
    await sleep(delayMs)
    return op()
  }
  if (options.retryResult !== undefined && options.retryResult(first)) {
    await sleep(delayMs)
    return op()
  }
  return first
}
