import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { APP_BASE } from '@/lib/pm-todo/binding-request-items'
import {
  INNGEST_BOOT_SYNC_DELAY_MS,
  INNGEST_SERVE_URL,
  resetInngestBootSyncForTests,
  scheduleInngestSyncOnBoot,
  shouldSyncInngestOnBoot,
  syncInngestOnBoot,
  type InngestBootEnv,
} from '../sync-on-boot'

const prod: InngestBootEnv = {
  NODE_ENV: 'production',
  RENDER: 'true',
  INNGEST_SIGNING_KEY: 'sign-test',
}

beforeEach(() => resetInngestBootSyncForTests())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('shouldSyncInngestOnBoot', () => {
  it('只在 Render 生产进程、签名密钥齐全、且没有关掉校验时登记', () => {
    expect(shouldSyncInngestOnBoot(prod)).toBe(true)
    expect(shouldSyncInngestOnBoot({ ...prod, RENDER: undefined })).toBe(false)
    expect(shouldSyncInngestOnBoot({ ...prod, NODE_ENV: 'development' })).toBe(false)
    expect(shouldSyncInngestOnBoot({ ...prod, NEXT_PHASE: 'phase-production-build' })).toBe(false)
    expect(shouldSyncInngestOnBoot({ ...prod, NEXT_RUNTIME: 'edge' })).toBe(false)
    expect(shouldSyncInngestOnBoot({ ...prod, INNGEST_SIGNING_KEY: '' })).toBe(false)
    expect(shouldSyncInngestOnBoot({ ...prod, INNGEST_DEV: '1' })).toBe(false)
  })
})

describe('syncInngestOnBoot', () => {
  it('向现成的接收地址发 PUT，地址与后台入口一致', async () => {
    const calls: NextRequest[] = []
    const result = await syncInngestOnBoot(prod, async (req) => {
      calls.push(req)
      return new Response('{}', { status: 200 })
    })
    expect(result).toEqual({ ran: true, status: 200 })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(INNGEST_SERVE_URL)
    expect(INNGEST_SERVE_URL).toBe(`${APP_BASE}/api/inngest`)
  })

  it('不该登记时不去调用', async () => {
    const put = vi.fn(async () => new Response('{}', { status: 200 }))
    const result = await syncInngestOnBoot({ ...prod, RENDER: undefined }, put)
    expect(result).toEqual({ ran: false, status: null })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('scheduleInngestSyncOnBoot', () => {
  it('先返回，半分钟后再登记，同一进程只排一次', async () => {
    vi.useFakeTimers()
    const put = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(scheduleInngestSyncOnBoot(prod, { put })).toBe(true)
    expect(scheduleInngestSyncOnBoot(prod, { put })).toBe(false)
    expect(put).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(INNGEST_BOOT_SYNC_DELAY_MS)
    expect(put).toHaveBeenCalledOnce()
    expect(INNGEST_BOOT_SYNC_DELAY_MS).toBe(30_000)
  })

  it('登记失败不把启动拖垮', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const runs: Array<() => void> = []
    scheduleInngestSyncOnBoot(prod, {
      put: async () => {
        throw new Error('network down')
      },
      later: (fn) => {
        runs.push(fn)
      },
    })
    runs[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(error).toHaveBeenCalledWith('inngest boot sync failed: network down')
  })
})
