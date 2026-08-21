/**
 * PM Change A：createCapabilities 必须把 page.apply_optimization_request 注册进去。
 * 没有这一步，Kernel authorize 通过后一执行就 dead-letter。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createCapabilities } from '@/lib/capabilities'

const KEY = 'page.apply_optimization_request'
const CTS_GITHUB_KEY = 'page.apply_cts_github_metadata_request'
const WORDPRESS_KEY = 'page.apply_wordpress_optimization_request'

describe(`createCapabilities · ${KEY} 已注册`, () => {
  const fakeSb = {} as SupabaseClient
  const caps = createCapabilities(fakeSb)

  it('key 出现在装配表里', () => {
    expect(Object.keys(caps)).toContain(KEY)
  })

  it('impl 的 actionKey 匹配', () => {
    expect(caps[KEY].actionKey).toBe(KEY)
  })

  it('四个 step handler 都存在', () => {
    expect(Object.keys(caps[KEY].steps).sort()).toEqual(['commit', 'open_pr', 'prepare', 'record'])
  })

  it('WordPress v2 独立注册，且只有 prepare/apply/verify', () => {
    expect(caps[WORDPRESS_KEY].actionKey).toBe(WORDPRESS_KEY)
    expect(Object.keys(caps[WORDPRESS_KEY].steps)).toEqual(['prepare', 'apply', 'verify'])
    expect(caps[WORDPRESS_KEY].rollback).toBeTypeOf('function')
  })

  it('CTS GitHub metadata action 独立注册为 Draft PR 四步能力', () => {
    expect(caps[CTS_GITHUB_KEY].actionKey).toBe(CTS_GITHUB_KEY)
    expect(Object.keys(caps[CTS_GITHUB_KEY].steps)).toEqual([
      'prepare', 'commit', 'open_pr', 'record',
    ])
    expect(caps[CTS_GITHUB_KEY].rollback).toBeTypeOf('function')
  })
})
