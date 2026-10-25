// AI 供应商故障转移的纯编排核心。
// 本文件不涉及网络、SDK、时钟或数据库：所有依赖均由调用方注入，便于测试枚举所有分支。

export type Provider = 'openai' | 'anthropic' | 'deepseek'

/** 单个供应商失败的原因。是现有账户级失败类型的超集。 */
export type FailoverFailureKind =
  | 'account_exhausted' // 余额耗尽——只能由人工处理
  | 'credential_invalid' // 密钥被拒——只能由人工处理
  | 'gateway_auth_failed' // 在网关处被拦截——只能由人工处理
  | 'rate_limited'
  | 'timeout' // 该供应商分到的预算已耗尽
  | 'schema_invalid' // 有返回，但 JSON 校验失败
  | 'request_invalid' // 调用方的请求本身有误（HTTP 400/422）——是 bug，绝不换供应商重试
  | 'other'

export interface FailoverProvider {
  provider: Provider
  /** 模型名，回传给调用方，以便记录真正作答的模型。 */
  model: string
  /** 发送一次请求并返回模型的 JSON（尚未校验）。任何失败都应抛出。必须响应 `signal`。内部不得重试。 */
  call(signal: AbortSignal): Promise<unknown>
}

export interface CooldownEntry {
  until: number
  kind: FailoverFailureKind
}

/** 进程内可变的记忆：记录当前已知损坏的供应商。 */
export interface FailoverState {
  cooldowns: Map<Provider, CooldownEntry>
}

export function createFailoverState(): FailoverState {
  return { cooldowns: new Map<Provider, CooldownEntry>() }
}

export const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000

export interface RunFailoverArgs<T> {
  providers: readonly FailoverProvider[]
  /** 校验原始 JSON。不可接受时必须抛出。返回类型化的值。 */
  validate: (raw: unknown) => T
  /** 把 `call` 抛出的错误归类。注入此函数，使本文件不依赖任何 SDK 知识。 */
  classifyError: (provider: Provider, err: unknown) => FailoverFailureKind
  /** 整次运行的总预算（毫秒），不是每个供应商的预算。 */
  totalBudgetMs: number
  /** 可选的调用方信号（例如调用方自己的截止时间）。 */
  signal?: AbortSignal
  now: () => number
  state: FailoverState
  cooldownMs?: number
  /** 每次供应商失败时调用一次（用于记录账本）。绝不能把异常抛回给我们：内部用 try/catch 包裹并忽略错误。 */
  onProviderFailure?: (provider: Provider, kind: FailoverFailureKind, err: unknown) => void
}

export interface FailoverSuccess<T> {
  data: T
  provider: Provider
  model: string
  attempts: number
}

export class AllProvidersFailedError extends Error {
  readonly kinds: Partial<Record<Provider, FailoverFailureKind>>
  readonly attempts: number
  /** 当本次查看的每个供应商都在账户级失败时为 true。调用方据此提前终止整批任务，而不是为每一项都浪费时间。 */
  readonly accountLevel: boolean

  constructor(kinds: Partial<Record<Provider, FailoverFailureKind>>, attempts: number) {
    super(buildMessage(kinds))
    this.name = 'AllProvidersFailedError'
    this.kinds = kinds
    this.attempts = attempts
    const entries = Object.entries(kinds) as Array<[Provider, FailoverFailureKind]>
    this.accountLevel = entries.length > 0 && entries.every(([, kind]) => isAccountLevel(kind))
  }
}

function buildMessage(kinds: Partial<Record<Provider, FailoverFailureKind>>): string {
  const parts = (Object.entries(kinds) as Array<[Provider, FailoverFailureKind]>).map(
    ([provider, kind]) => `${provider}=${kind}`,
  )
  return `所有 AI 供应商都失败了：${parts.join(', ')}`
}

export function isAccountLevel(kind: FailoverFailureKind): boolean {
  return (
    kind === 'account_exhausted' ||
    kind === 'credential_invalid' ||
    kind === 'gateway_auth_failed'
  )
}

/** 计算当前活跃的供应商：清理已过期的冷却记录，并过滤掉仍在冷却中的供应商。 */
function resolveActiveProviders(
  providers: readonly FailoverProvider[],
  state: FailoverState,
  now: () => number,
): FailoverProvider[] {
  const current = now()
  const active: FailoverProvider[] = []
  for (const p of providers) {
    const entry = state.cooldowns.get(p.provider)
    if (entry === undefined) {
      active.push(p)
      continue
    }
    if (entry.until > current) {
      // 仍在冷却中，跳过。
      continue
    }
    // 冷却已过期：删除记录，视为活跃（供应商自愈）。
    state.cooldowns.delete(p.provider)
    active.push(p)
  }
  return active
}

/** 从冷却记录构造 kinds，用于“全部处于冷却中”的短路场景。 */
function kindsFromCooldowns(
  providers: readonly FailoverProvider[],
  state: FailoverState,
): Partial<Record<Provider, FailoverFailureKind>> {
  const kinds: Partial<Record<Provider, FailoverFailureKind>> = {}
  for (const p of providers) {
    const entry = state.cooldowns.get(p.provider)
    if (entry !== undefined) {
      kinds[p.provider] = entry.kind
    }
  }
  return kinds
}

/** 安全地调用 onProviderFailure：任何异常都被吞掉。 */
function safeNotify(
  onProviderFailure: RunFailoverArgs<unknown>['onProviderFailure'],
  provider: Provider,
  kind: FailoverFailureKind,
  err: unknown,
): void {
  if (onProviderFailure === undefined) return
  try {
    onProviderFailure(provider, kind, err)
  } catch {
    // 忽略：账本记录失败不应影响故障转移。
  }
}

/** 为某个供应商构造信号：其预算切片 + 可选的调用方信号。 */
function buildSignal(sliceMs: number, callerSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(sliceMs)
  if (callerSignal === undefined) return timeoutSignal
  return AbortSignal.any([timeoutSignal, callerSignal])
}

/** 单次尝试的结果。 */
type AttemptOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: FailoverFailureKind; err: unknown; rethrow?: boolean }

/** 对单个供应商执行一次尝试（调用 + 校验）。 */
async function attemptOnce<T>(
  provider: FailoverProvider,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  validate: (raw: unknown) => T,
  classifyError: (provider: Provider, err: unknown) => FailoverFailureKind,
): Promise<AttemptOutcome<T>> {
  let raw: unknown
  try {
    raw = await provider.call(signal)
  } catch (err) {
    const sliceAborted = signal.aborted
    const callerAborted = callerSignal?.aborted === true
    const kind: FailoverFailureKind =
      sliceAborted && !callerAborted ? 'timeout' : classifyError(provider.provider, err)
    return { ok: false, kind, err, rethrow: kind === 'request_invalid' }
  }
  try {
    const data = validate(raw)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, kind: 'schema_invalid', err }
  }
}

export async function runFailover<T>(args: RunFailoverArgs<T>): Promise<FailoverSuccess<T>> {
  const { providers, validate, classifyError, totalBudgetMs, signal, now, state } = args
  const cooldownMs = args.cooldownMs ?? DEFAULT_COOLDOWN_MS

  if (providers.length === 0) {
    throw new AllProvidersFailedError({}, 0)
  }

  const active = resolveActiveProviders(providers, state, now)
  if (active.length === 0) {
    // 熔断：所有供应商都已知损坏，直接短路，不发起任何调用。
    throw new AllProvidersFailedError(kindsFromCooldowns(providers, state), 0)
  }

  const start = now()
  const n = active.length
  const kinds: Partial<Record<Provider, FailoverFailureKind>> = {}
  let attempts = 0

  for (let i = 0; i < n; i++) {
    const provider = active[i]
    const remaining = totalBudgetMs - (now() - start)
    if (remaining <= 0) break

    const slice = remaining / (n - i)
    const providerSignal = buildSignal(slice, signal)
    const maxAttempts = i === 0 ? 2 : 1

    for (let a = 0; a < maxAttempts; a++) {
      attempts++
      const outcome = await attemptOnce(provider, providerSignal, signal, validate, classifyError)

      if (outcome.ok) {
        return { data: outcome.data, provider: provider.provider, model: provider.model, attempts }
      }

      if (outcome.rethrow === true) {
        // 请求本身有误：换供应商只会为同一个 bug 花钱，立即抛出原始错误。
        throw outcome.err
      }

      kinds[provider.provider] = outcome.kind
      safeNotify(args.onProviderFailure, provider.provider, outcome.kind, outcome.err)

      if (isAccountLevel(outcome.kind)) {
        state.cooldowns.set(provider.provider, { until: now() + cooldownMs, kind: outcome.kind })
      }

      // 只有“校验失败”才允许在同一供应商上重试。
      if (outcome.kind !== 'schema_invalid') break
    }

    if (signal?.aborted === true) break
  }

  throw new AllProvidersFailedError(kinds, attempts)
}
