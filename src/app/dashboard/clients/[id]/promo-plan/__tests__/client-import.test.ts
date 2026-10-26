/**
 * 防白屏：计划页组件会被打进浏览器包。只要它（直接或间接）引到服务端模块（supabase 等），
 * 浏览器一加载就会因缺服务端密钥抛错、整页空白——而 tsc / vitest / build 都发现不了（测试常把 supabase 整个 mock 掉）。
 * 这条测试故意：不 mock supabase、清掉服务端密钥，直接 import 页面组件，要求不抛错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('promo-plan 页面组件能在没有服务端密钥的环境里加载', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) { saved[k] = process.env[k]; delete process.env[k] }
    vi.resetModules()
  })
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

  it('import _client.tsx 不抛错', async () => {
    await expect(import('../_client')).resolves.toBeDefined()
  })
})
