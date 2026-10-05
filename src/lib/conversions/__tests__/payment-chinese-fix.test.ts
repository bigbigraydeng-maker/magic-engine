/**
 * 中文收款确认句的回归测试（草稿修复版）。
 *
 * 语料全部是虚构的（不含任何真实客人信息）。
 *
 * 中文没有词形变化，但同样有「还没到账」的写法（未收到 / 待收到 / 收到后），
 * 所以这里两类都要钉住：确认句必须判成 confirmed，否定 / 条件 / 疑问 / 转述 /
 * 模板 / 将来时一律不许判成 confirmed —— 后者一旦漏判，一个还没付钱的客人会被
 * 打上 paid_customer 并停掉所有跟进。
 */
import { describe, expect, it } from 'vitest'
import { readPaidSignal } from '@/lib/mailchimp/paid-signal'
import { classifyPaymentKind } from '@/lib/conversions/payment-email-extract'

function outbound(text: string) {
  return readPaidSignal({ text, direction: 'outbound' })
}

describe('中文确认句 → confirmed', () => {
  it.each([
    '已收到定金$500',
    '您好，已收到您的定金$500，谢谢',
    '全款已到账',
  ])('%s', (text) => {
    expect(outbound(text).kind).toBe('confirmed')
  })
})

describe('🔴 中文否定 / 条件 / 疑问 / 转述 / 模板 / 将来时 → 不是 confirmed', () => {
  it.each([
    '如已收到定金$500请忽略',
    '请您确认已收到定金$500',
    '麻烦确认已收到定金$500',
    '预计已收到定金$500',
    '只要已收到定金$500就可以出票',
    '已收到定金$500的话请回复',
    '已收到定金$500?',
    '已收到定金$500？',
    '示例：已收到定金$500',
    '已收到定金$500，客人说明天转账',
    '已收到定金$500。请忽略此条，测试消息',
    '模板：已收到定金',
  ])('%s', (text) => {
    expect(outbound(text).kind).not.toBe('confirmed')
  })
})

describe('classifyPaymentKind 中文类型', () => {
  it.each([
    ['已收到定金和尾款$5000', 'unknown'],
    ['已收到全款，其中定金$500', 'unknown'],
    ['收到尾款，定金已付', 'unknown'],
    ['已收到定金$500', 'deposit'],
    ['尾款已收到', 'balance'],
    ['Your deposit has been received, balance due', 'deposit'],
  ] as const)('%s → %s', (evidence, kind) => {
    expect(classifyPaymentKind(evidence)).toBe(kind)
  })
})
