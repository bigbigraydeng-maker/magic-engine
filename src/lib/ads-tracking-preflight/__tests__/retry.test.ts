import { describe, expect, it } from 'vitest'
import { RETRY_DELAY_MS, retryOnce } from '../retry'

// 审查整改：读取器永不 reject（读不到就判灰），所以函数级的 retries: 2 救不了一次超时。
// 每个外部读取在读取器内部多试一次，免得开投日一次抖动就把硬门判成灰。

function recorder() {
  const events: string[] = []
  const sleeps: number[] = []
  return {
    events,
    sleeps,
    sleep: async (ms: number): Promise<void> => { sleeps.push(ms); events.push(`sleep:${ms}`) },
  }
}

describe('retryOnce · 最多多试一次', () => {
  it('第一次就成功 → 只调用一次，不等待', async () => {
    const r = recorder()
    let calls = 0
    const out = await retryOnce(async () => { calls += 1; return 'ok' }, { sleep: r.sleep })
    expect(out).toBe('ok')
    expect(calls).toBe(1)
    expect(r.sleeps).toEqual([])
  })

  it('第一次抛错、第二次成功 → 先等一下（默认 RETRY_DELAY_MS）再试，返回第二次的结果', async () => {
    const r = recorder()
    let calls = 0
    const out = await retryOnce(async () => {
      calls += 1
      r.events.push(`call:${calls}`)
      if (calls === 1) throw new Error('瞬时故障')
      return 'second'
    }, { sleep: r.sleep })
    expect(out).toBe('second')
    expect(r.events).toEqual(['call:1', `sleep:${RETRY_DELAY_MS}`, 'call:2'])
    expect(RETRY_DELAY_MS).toBe(800)
  })

  it('连着两次抛错 → 抛第二次的错误，一共只调用两次（不会试第三次）', async () => {
    const r = recorder()
    let calls = 0
    await expect(retryOnce(async () => { calls += 1; throw new Error(`第${calls}次失败`) }, { sleep: r.sleep }))
      .rejects.toThrow('第2次失败')
    expect(calls).toBe(2)
    expect(r.sleeps).toHaveLength(1)
  })

  it('错误被判定为不值得重试（比如令牌失效）→ 原样抛出，不重试不等待', async () => {
    const r = recorder()
    let calls = 0
    await expect(retryOnce(async () => { calls += 1; throw new Error('permanent') }, {
      sleep: r.sleep, retryError: () => false,
    })).rejects.toThrow('permanent')
    expect(calls).toBe(1)
    expect(r.sleeps).toEqual([])
  })

  it('结果本身说明是瞬时故障（比如 503）→ 等一下再试，返回第二次的结果', async () => {
    const r = recorder()
    const results = ['busy', 'fine']
    let calls = 0
    const out = await retryOnce(async () => results[calls++], { sleep: r.sleep, retryResult: v => v === 'busy' })
    expect(out).toBe('fine')
    expect(calls).toBe(2)
    expect(r.sleeps).toEqual([RETRY_DELAY_MS])
  })

  it('两次结果都是瞬时故障 → 返回第二次的结果（由调用方按失败处理），只试两次', async () => {
    const r = recorder()
    let calls = 0
    const out = await retryOnce(async () => { calls += 1; return `busy-${calls}` }, { sleep: r.sleep, retryResult: v => v.startsWith('busy') })
    expect(out).toBe('busy-2')
    expect(calls).toBe(2)
  })

  it('等待时长可以改（delayMs），0 也行', async () => {
    const r = recorder()
    let calls = 0
    await retryOnce(async () => { calls += 1; if (calls === 1) throw new Error('x'); return 1 }, { sleep: r.sleep, delayMs: 0 })
    expect(r.sleeps).toEqual([0])
  })
})
