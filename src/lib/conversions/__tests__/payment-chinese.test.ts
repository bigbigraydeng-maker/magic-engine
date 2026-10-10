/**
 * 中文收款确认句的回归测试。
 *
 * 语料全部是虚构的（不含任何真实客人信息）。
 *
 * 中文没有词形变化，但同样有「还没到账」的写法（未收到 / 待收到 / 收到后），
 * 所以这里两类都要钉住：确认句必须判成 confirmed，否定 / 条件 / 疑问句
 * 一律不许判成 confirmed —— 后者一旦漏判，一个还没付钱的客人会被打上
 * paid_customer 并停掉所有跟进。
 */
import { describe, expect, it } from 'vitest'
import { readPaidSignal } from '@/lib/mailchimp/paid-signal'
import { classifyPaymentKind } from '@/lib/conversions/payment-email-extract'

function outbound(text: string) {
  return readPaidSignal({ text, direction: 'outbound' })
}

describe('中文确认句 → confirmed', () => {
  it.each([
    '您好，已收到您的定金$500，谢谢！',
    '定金已收到',
    '全款已到账，谢谢您',
    '我们已经收到您的尾款',
    '收到了您的全款 NZD 4500',
  ])('%s', (text) => {
    expect(outbound(text).kind).toBe('confirmed')
  })
})

describe('🔴 中文否定 / 条件 / 疑问句 → 不是 confirmed', () => {
  it.each([
    '请问您的定金是否已经收到？',
    '定金还没收到',
    '待收到定金后为您确认',
    '收到定金后我们会发送行程',
    '款项未到账',
  ])('%s', (text) => {
    expect(outbound(text).kind).not.toBe('confirmed')
  })
})

describe('inbound 里的中文确认句不算数', () => {
  it('客人自己说「定金已收到」→ 不是 confirmed', () => {
    const signal = readPaidSignal({ text: '定金已收到', direction: 'inbound' })
    expect(signal.kind).not.toBe('confirmed')
  })
})

describe('classifyPaymentKind 中文类型', () => {
  it.each([
    ['已收到您的定金', 'deposit'],
    ['尾款已收到', 'balance'],
    ['全款已到账', 'full'],
    ['款项已收到', 'unknown'],
  ] as const)('%s → %s', (evidence, kind) => {
    expect(classifyPaymentKind(evidence)).toBe(kind)
  })

  it('英文 deposit received 仍然是 deposit', () => {
    expect(classifyPaymentKind('deposit received')).toBe('deposit')
  })
})
