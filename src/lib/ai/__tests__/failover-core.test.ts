// @vitest-environment node
// 生产是 Node：AbortSignal.timeout 拒绝非整数。jsdom 的同名方法会收下小数，复现不了线上那个 RangeError。
import { describe, it, expect, vi } from 'vitest'
import {
  runFailover,
  createFailoverState,
  integerTimeoutMs,
  AllProvidersFailedError,
  isAccountLevel,
  DEFAULT_COOLDOWN_MS,
  type FailoverProvider,
  type FailoverFailureKind,
  type Provider,
} from '../failover-core'

/** 构造一个假供应商。 */
function makeProvider(
  provider: Provider,
  model: string,
  call: (signal: AbortSignal) => Promise<unknown>,
): FailoverProvider {
  return { provider, model, call: vi.fn(call) }
}

/** 一个永远挂起、直到 signal 中止才拒绝的调用。 */
function hangUntilAbort(signal: AbortSignal): Promise<unknown> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
}

/** 默认分类器：把错误消息当作 kind。 */
function classifyByMessage(_provider: Provider, err: unknown): FailoverFailureKind {
  const msg = err instanceof Error ? err.message : String(err)
  const known: FailoverFailureKind[] = [
    'account_exhausted',
    'credential_invalid',
    'gateway_auth_failed',
    'rate_limited',
    'timeout',
    'schema_invalid',
    'request_invalid',
    'other',
  ]
  return (known as string[]).includes(msg) ? (msg as FailoverFailureKind) : 'other'
}

/** 恒等校验：任何值都接受。 */
function acceptAll(raw: unknown): unknown {
  return raw
}

describe('integerTimeoutMs', () => {
  it('把除不尽、过小、过大、非数字收成定时器肯收的整数', () => {
    expect(integerTimeoutMs(20_000 / 3)).toBe(6_666)
    expect(integerTimeoutMs(10_000)).toBe(10_000)
    expect(integerTimeoutMs(0.9)).toBe(0)
    expect(integerTimeoutMs(-1)).toBe(0)
    expect(integerTimeoutMs(Number.NaN)).toBe(0)
    expect(integerTimeoutMs(Number.POSITIVE_INFINITY)).toBe(0)
    expect(integerTimeoutMs(2 ** 31)).toBe(2 ** 31 - 1)
    expect(Number.isInteger(integerTimeoutMs(20_000 / 3))).toBe(true)
  })
})

describe('runFailover', () => {
  it('健康：第一个供应商作答，第二个不被调用', async () => {
    let t = 0
    const now = () => t
    const first = makeProvider('openai', 'gpt-4o', async () => ({ ok: 1 }))
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const result = await runFailover({
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state: createFailoverState(),
    })
    expect(result).toEqual({ data: { ok: 1 }, provider: 'openai', model: 'gpt-4o', attempts: 1 })
    expect(second.call).not.toHaveBeenCalled()
  })

  it('第一个账户耗尽 → 第二个作答，第一个进入冷却', async () => {
    let t = 0
    const now = () => t
    const state = createFailoverState()
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('account_exhausted')
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const result = await runFailover({
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state,
    })
    expect(result.provider).toBe('anthropic')
    expect(state.cooldowns.get('openai')?.kind).toBe('account_exhausted')
  })

  it('下一次运行（时钟未变）不会调用冷却中的供应商', async () => {
    let t = 0
    const now = () => t
    const state = createFailoverState()
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('account_exhausted')
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const args = {
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state,
    }
    await runFailover(args)
    ;(first.call as ReturnType<typeof vi.fn>).mockClear()
    const result = await runFailover(args)
    expect(result.provider).toBe('anthropic')
    expect(first.call).not.toHaveBeenCalled()
  })

  it('自愈：时钟越过 until 后第一个供应商再次被调用，冷却记录被清除', async () => {
    let t = 0
    const now = () => t
    const state = createFailoverState()
    let firstShouldFail = true
    const first = makeProvider('openai', 'gpt-4o', async () => {
      if (firstShouldFail) throw new Error('account_exhausted')
      return { ok: 1 }
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const args = {
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state,
    }
    await runFailover(args)
    expect(state.cooldowns.has('openai')).toBe(true)
    t = DEFAULT_COOLDOWN_MS + 1
    firstShouldFail = false
    const result = await runFailover(args)
    expect(result.provider).toBe('openai')
    expect(state.cooldowns.has('openai')).toBe(false)
  })

  it('全部处于冷却中 → 不发起任何调用，抛出 accountLevel 错误', async () => {
    let t = 0
    const now = () => t
    const state = createFailoverState()
    state.cooldowns.set('openai', { until: 1000, kind: 'account_exhausted' })
    state.cooldowns.set('anthropic', { until: 1000, kind: 'credential_invalid' })
    const first = makeProvider('openai', 'gpt-4o', async () => ({ ok: 1 }))
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    let caught: unknown
    try {
      await runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    const e = caught as AllProvidersFailedError
    expect(e.accountLevel).toBe(true)
    expect(e.attempts).toBe(0)
    expect(first.call).not.toHaveBeenCalled()
    expect(second.call).not.toHaveBeenCalled()
  })

  it.each<FailoverFailureKind>(['rate_limited', 'other', 'timeout'])(
    '%s 不会创建冷却',
    async (kind) => {
      let t = 0
      const now = () => t
      const state = createFailoverState()
      const first = makeProvider('openai', 'gpt-4o', async () => {
        throw new Error(kind)
      })
      const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
      await runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state,
      })
      expect(state.cooldowns.has('openai')).toBe(false)
    },
  )

  it('schema 重试：第一个先返回非法 JSON 再返回合法 → attempts === 2，由第一个作答', async () => {
    let t = 0
    const now = () => t
    let calls = 0
    const first = makeProvider('openai', 'gpt-4o', async () => {
      calls++
      return calls === 1 ? { bad: true } : { ok: 1 }
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const validate = (raw: unknown): unknown => {
      const r = raw as { ok?: number }
      if (r.ok === undefined) throw new Error('invalid')
      return r
    }
    const result = await runFailover({
      providers: [first, second],
      validate,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state: createFailoverState(),
    })
    expect(result.attempts).toBe(2)
    expect(result.provider).toBe('openai')
    expect(second.call).not.toHaveBeenCalled()
  })

  it('schema 重试只针对第一个活跃供应商：第二个返回非法 JSON 时只调用一次', async () => {
    let t = 0
    const now = () => t
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('rate_limited')
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ bad: true }))
    const validate = (raw: unknown): unknown => {
      const r = raw as { ok?: number }
      if (r.ok === undefined) throw new Error('invalid')
      return r
    }
    await expect(
      runFailover({
        providers: [first, second],
        validate,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state: createFailoverState(),
      }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError)
    expect(second.call).toHaveBeenCalledTimes(1)
  })

  it('第一个供应商校验连续失败两次 → 落到第二个供应商', async () => {
    let t = 0
    const now = () => t
    const first = makeProvider('openai', 'gpt-4o', async () => ({ bad: true }))
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const validate = (raw: unknown): unknown => {
      const r = raw as { ok?: number }
      if (r.ok === undefined) throw new Error('invalid')
      return r
    }
    const result = await runFailover({
      providers: [first, second],
      validate,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state: createFailoverState(),
    })
    expect(result.provider).toBe('anthropic')
    expect(first.call).toHaveBeenCalledTimes(2)
  })

  it('request_invalid → 立即抛出原始错误，第二个供应商不被调用', async () => {
    let t = 0
    const now = () => t
    const original = new Error('request_invalid')
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw original
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    let caught: unknown
    try {
      await runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state: createFailoverState(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBe(original)
    expect(second.call).not.toHaveBeenCalled()
  })

  // 🔴 下面这几条必须用**真时钟**。第一版用手拨的假时钟（永远是 0），于是「前一家
  //    吃掉了多少预算」在测试里根本不存在 —— 把「按剩余家数切预算」整个删掉，
  //    20 条测试照样全绿，而生产里时钟会走，第一家会把整个预算吃光、第二家连发请求
  //    的机会都没有。变异测试逮出来的（魏征审查指出的 P0 正是这一条）。
  it('🔴 备用家返回 request_invalid（多半是适配器不兼容）→ 记下，但继续试下一家，不能立即抛', async () => {
    // 2026-10-26 真实试跑：DeepSeek 因提示词里没有 "json" 这个词对每条请求 400。
    // 如果备用家的 400 也立即抛，一个适配器缺陷就会把剩下的家全部放弃。
    const first = makeProvider('openai', 'gpt-4o', async () => { throw new Error('account_exhausted') })
    const second = makeProvider('anthropic', 'claude', async () => { throw new Error('request_invalid') })
    const third = makeProvider('deepseek', 'ds', async () => ({ ok: 3 }))
    const result = await runFailover({
      providers: [first, second, third],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now: () => Date.now(),
      state: createFailoverState(),
    })
    expect(result.provider).toBe('deepseek')
    expect(third.call).toHaveBeenCalledTimes(1)
  })

  it('备用家 request_invalid 不进冷却（不是账户问题，下一条还该再试它）', async () => {
    const state = createFailoverState()
    const first = makeProvider('openai', 'gpt-4o', async () => { throw new Error('account_exhausted') })
    const second = makeProvider('anthropic', 'claude', async () => { throw new Error('request_invalid') })
    const third = makeProvider('deepseek', 'ds', async () => ({ ok: 3 }))
    await runFailover({ providers: [first, second, third], validate: acceptAll, classifyError: classifyByMessage, totalBudgetMs: 1000, now: () => Date.now(), state })
    expect(state.cooldowns.has('anthropic')).toBe(false)
  })

  it('预算切片：第一个挂起只拿一半就被中止，第二个仍能作答且拿到的信号还活着', async () => {
    const first = makeProvider('openai', 'gpt-4o', hangUntilAbort)
    let secondSignalAbortedAtStart: boolean | undefined
    const second = makeProvider('anthropic', 'claude', async (signal) => {
      secondSignalAbortedAtStart = signal.aborted
      return { ok: 2 }
    })
    const result = await runFailover({
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 200,
      now: () => Date.now(),
      state: createFailoverState(),
    })
    expect(result.provider).toBe('anthropic')
    expect(secondSignalAbortedAtStart).toBe(false)
  })

  it('预算切片：第一家被中止的时刻约在总预算的一半，而不是整个预算', async () => {
    const started = Date.now()
    let abortedAfterMs = -1
    const first = makeProvider('openai', 'gpt-4o', (signal) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          abortedAfterMs = Date.now() - started
          reject(new Error('aborted'))
        })
      })
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    await runFailover({
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 300,
      now: () => Date.now(),
      state: createFailoverState(),
    })
    // 两家启用 → 第一家拿 300/2 = 150ms。留足抖动空间，只要明显小于整个 300 就证明切了。
    expect(abortedAfterMs).toBeGreaterThan(100)
    expect(abortedAfterMs).toBeLessThan(250)
  })

  it('🔴 第一家很快就失败时，剩下的预算全部留给下一家（不浪费）', async () => {
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('account_exhausted')
    })
    let secondBudgetLeft = -1
    const started = Date.now()
    const second = makeProvider('anthropic', 'claude', (signal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: 2 }), 260)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          secondBudgetLeft = Date.now() - started
          reject(new Error('aborted'))
        })
      })
    })
    // 总预算 300，第一家瞬间失败 → 第二家应拿到接近整个 300，所以 260ms 的活能干完。
    // 如果误把第二家也只给一半（150），它会在 150ms 被掐掉。
    const result = await runFailover({
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 300,
      now: () => Date.now(),
      state: createFailoverState(),
    })
    expect(result.provider).toBe('anthropic')
    expect(secondBudgetLeft).toBe(-1)
  })

  it('三家平分 20 秒时超时必须是整数（20000/3 原样传给定时器会抛 RangeError）', async () => {
    // 线上简报：单条预算 20 秒、三家都启用。修复前第一条候选就在这里炸掉，一张卡都写不出。
    const raw = 20_000 / 3
    expect(Number.isInteger(raw)).toBe(false)
    expect(() => AbortSignal.timeout(raw)).toThrow(RangeError)

    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const providers = (['openai', 'anthropic', 'deepseek'] as const).map((provider) =>
        makeProvider(provider, provider, async () => ({ ok: 1 })),
      )
      const result = await runFailover({
        providers,
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 20_000,
        now: () => 0,
        state: createFailoverState(),
      })
      expect(result).toEqual({ data: { ok: 1 }, provider: 'openai', model: 'openai', attempts: 1 })
      expect(timeout).toHaveBeenCalledTimes(1)
      expect(timeout.mock.calls[0]?.[0]).toBe(6_666)
      expect(Number.isInteger(timeout.mock.calls[0]?.[0])).toBe(true)
    } finally {
      timeout.mockRestore()
    }
  })

  it('调用方传入的总预算本身除不尽时，也不把小数交给定时器', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const only = makeProvider('openai', 'gpt-4o', async () => ({ ok: 1 }))
      const result = await runFailover({
        providers: [only],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 20_000 / 3,
        now: () => 0,
        state: createFailoverState(),
      })
      expect(result.provider).toBe('openai')
      expect(timeout.mock.calls[0]?.[0]).toBe(6_666)
    } finally {
      timeout.mockRestore()
    }
  })

  it('能整除的切片保持原值（两家平分 20 秒仍是 10 秒）', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const first = makeProvider('openai', 'gpt-4o', async () => ({ ok: 1 }))
      const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
      await runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 20_000,
        now: () => 0,
        state: createFailoverState(),
      })
      expect(timeout.mock.calls[0]?.[0]).toBe(10_000)
    } finally {
      timeout.mockRestore()
    }
  })

  it('🔴 一家自己超时 → 记成 timeout，不是 other（超时不该冷却，也不该被当成没钱）', async () => {
    const onFail = vi.fn()
    const only = makeProvider('openai', 'gpt-4o', hangUntilAbort)
    let caught: unknown
    try {
      await runFailover({
        providers: [only],
        validate: acceptAll,
        // 故意把任何错误都说成 other：如果核心没有自己识别超时，这里就会漏
        classifyError: () => 'other',
        totalBudgetMs: 60,
        now: () => Date.now(),
        state: createFailoverState(),
        onProviderFailure: onFail,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).kinds.openai).toBe('timeout')
    expect(onFail).toHaveBeenCalledWith('openai', 'timeout', expect.anything())
  })

  it('调用方信号已中止时，第一次失败后不再尝试其他供应商', async () => {
    let t = 0
    const now = () => t
    const controller = new AbortController()
    const first = makeProvider('openai', 'gpt-4o', async () => {
      controller.abort()
      throw new Error('rate_limited')
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    await expect(
      runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        signal: controller.signal,
        now,
        state: createFailoverState(),
      }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError)
    expect(second.call).not.toHaveBeenCalled()
  })

  it('onProviderFailure 每次失败调用一次；抛异常也不影响故障转移', async () => {
    let t = 0
    const now = () => t
    const onProviderFailure = vi.fn(() => {
      throw new Error('ledger down')
    })
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('account_exhausted')
    })
    const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
    const result = await runFailover({
      providers: [first, second],
      validate: acceptAll,
      classifyError: classifyByMessage,
      totalBudgetMs: 1000,
      now,
      state: createFailoverState(),
      onProviderFailure,
    })
    expect(result.provider).toBe('anthropic')
    expect(onProviderFailure).toHaveBeenCalledTimes(1)
    expect(onProviderFailure).toHaveBeenCalledWith('openai', 'account_exhausted', expect.any(Error))
  })

  it('全部账户级失败 → accountLevel === true', async () => {
    let t = 0
    const now = () => t
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('account_exhausted')
    })
    const second = makeProvider('anthropic', 'claude', async () => {
      throw new Error('credential_invalid')
    })
    let caught: unknown
    try {
      await runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state: createFailoverState(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).accountLevel).toBe(true)
  })

  it('一个账户级 + 一个 timeout → accountLevel === false', async () => {
    let t = 0
    const now = () => t
    const first = makeProvider('openai', 'gpt-4o', async () => {
      throw new Error('account_exhausted')
    })
    const second = makeProvider('anthropic', 'claude', async () => {
      throw new Error('timeout')
    })
    let caught: unknown
    try {
      await runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state: createFailoverState(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).accountLevel).toBe(false)
  })

  it('空供应商列表 → AllProvidersFailedError，attempts === 0', async () => {
    let t = 0
    const now = () => t
    let caught: unknown
    try {
      await runFailover({
        providers: [],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state: createFailoverState(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).attempts).toBe(0)
  })

  it('相同输入两次运行结果一致（无隐藏模块状态）', async () => {
    const runOnce = async (): Promise<unknown> => {
      let t = 0
      const now = () => t
      const first = makeProvider('openai', 'gpt-4o', async () => {
        throw new Error('account_exhausted')
      })
      const second = makeProvider('anthropic', 'claude', async () => ({ ok: 2 }))
      return runFailover({
        providers: [first, second],
        validate: acceptAll,
        classifyError: classifyByMessage,
        totalBudgetMs: 1000,
        now,
        state: createFailoverState(),
      })
    }
    const a = await runOnce()
    const b = await runOnce()
    expect(a).toEqual(b)
  })

  it('isAccountLevel 对账户级类型返回 true', () => {
    expect(isAccountLevel('account_exhausted')).toBe(true)
    expect(isAccountLevel('credential_invalid')).toBe(true)
    expect(isAccountLevel('gateway_auth_failed')).toBe(true)
    expect(isAccountLevel('rate_limited')).toBe(false)
    expect(isAccountLevel('timeout')).toBe(false)
  })
})
