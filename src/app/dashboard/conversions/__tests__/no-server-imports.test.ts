/**
 * 钉死：这个 'use client' 页面不许 import 任何牵连服务端/Node 模块的东西。
 *
 * 2026-09-06 线上事故：页面 import 了 metaCapiWriter（只为取一个常数 7），
 * 而 writer → hasher → node 的 crypto。打包能过、build 能过、类型检查能过，
 * 唯独浏览器运行时炸 —— 整页闪一下就打不开。
 *
 * 这类 bug 编译期抓不到，只能靠这条源码级守卫拦住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const PAGE = join(process.cwd(), 'src/app/dashboard/conversions/page.tsx')
const SRC = readFileSync(PAGE, 'utf8')

describe('成交页是纯客户端，不拖服务端模块进浏览器', () => {
  it('第一行就是 use client', () => {
    expect(SRC.trimStart().startsWith("'use client'")).toBe(true)
  })

  it.each([
    ['@/lib/meta/', 'Meta 引擎（牵连 crypto）'],
    ['writeback-service', '状态机（服务端）'],
    ['route-guard', '路由守卫（服务端）'],
    ['@/lib/pii/hasher', '哈希（node crypto）'],
    ["from 'crypto'", 'node crypto'],
    ['@supabase/supabase-js', 'supabase 客户端'],
    ['@/lib/supabase', 'service-role 客户端'],
  ])('不 import %s（%s）', (needle) => {
    expect(SRC.includes(needle), `页面里出现了 ${needle} —— 会把服务端代码拖进浏览器 bundle，运行时崩`).toBe(false)
  })

  it('时间窗口是写死的常数，不从 writer 取', () => {
    // 取一个常数 7 不值得 import 整个引擎。
    expect(/MAX_AGE_DAYS\s*=\s*7\b/.test(SRC)).toBe(true)
  })
})
