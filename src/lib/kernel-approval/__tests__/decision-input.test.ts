/**
 * K-WP01A —— 请求体的边界。
 *
 * 🔴 请求体里能带的**只有三样**：approve/reject、看到的那份审批请求的 id、原因。
 *    操作者身份 / 客户 / 动作 / 权限档次 / 成本上限 / 政策版本一律由服务端取。
 *
 *    这里是**严格模式**：多带一个字段就 400。不是「读不到就忽略」——
 *    忽略的话，一个带着 `actorEmail` 的请求会安静地成功，
 *    而将来某个人顺手加一句 `body.actorEmail ??` 就把身份闸拆了。
 */

import { describe, it, expect } from 'vitest'
import { ApprovalError } from '../errors'
import { parseDecisionInput, MAX_REASON_LENGTH } from '../service'

// 🔴 合法 UUID。用 'decision-abc' 那种假值的话，这套测试会绕过
//    「expectedDecisionId 最终要进 uuid RPC 参数」这条真实边界。
const OK_ID = '0d000000-0000-4000-8000-0000000000ab'

function expectRejected(body: unknown, contains?: string): ApprovalError {
  let caught: unknown = null
  try {
    parseDecisionInput(body)
  } catch (e) {
    caught = e
  }
  expect(caught, `这个请求体本该被拒：${JSON.stringify(body)}`).toBeInstanceOf(ApprovalError)
  const err = caught as ApprovalError
  expect(err.code).toBe('invalid_request')
  expect(err.status).toBe(400)
  if (contains) expect(err.humanReason).toContain(contains)
  return err
}

describe('parseDecisionInput · 合法的三个字段', () => {
  it('approve 不带原因也行', () => {
    expect(parseDecisionInput({ resolution: 'approve', expectedDecisionId: OK_ID })).toEqual({
      resolution: 'approve',
      expectedDecisionId: OK_ID,
    })
  })

  it('approve 带原因就留着', () => {
    const parsed = parseDecisionInput({
      resolution: 'approve',
      expectedDecisionId: OK_ID,
      reason: '  跟客户确认过了  ',
    })
    expect(parsed.reason).toBe('跟客户确认过了')
  })

  it('reject 带原因', () => {
    expect(
      parseDecisionInput({ resolution: 'reject', expectedDecisionId: OK_ID, reason: '这周不发' }),
    ).toEqual({ resolution: 'reject', expectedDecisionId: OK_ID, reason: '这周不发' })
  })
})

describe('🔴 parseDecisionInput · 伪造身份的字段一律拒', () => {
  const FORGERIES: Array<[label: string, extra: Record<string, unknown>]> = [
    ['操作者邮箱', { actorEmail: 'attacker@evil.test' }],
    ['操作者身份（另一种拼法）', { approvedByUser: 'attacker@evil.test' }],
    ['用户对象', { user: { email: 'attacker@evil.test' } }],
    ['客户 id', { clientId: 'some-other-client' }],
    ['权限档次', { tier: 'admin' }],
    ['角色', { role: 'admin' }],
    ['动作键', { actionKey: 'seo.build_publish_package' }],
    ['成本上限', { costCapUsd: 9999 }],
    ['政策版本', { policyVersion: 1 }],
  ]

  it.each(FORGERIES)('%s 出现在请求体里 → 400', (_label, extra) => {
    const err = expectRejected(
      { resolution: 'approve', expectedDecisionId: OK_ID, ...extra },
      '不该有的字段',
    )
    expect(err.detail.unexpected as string[]).toEqual(Object.keys(extra))
  })

  it('🔴 拒绝时同样拦 —— 不能靠 reject 这条路绕过去', () => {
    expectRejected({
      resolution: 'reject',
      expectedDecisionId: OK_ID,
      reason: '不做',
      actorEmail: 'attacker@evil.test',
    })
  })
})

describe('🔴 parseDecisionInput · 其余不合法输入', () => {
  it('不是对象', () => {
    for (const body of [null, undefined, 'approve', 42, [], [{ resolution: 'approve' }]]) {
      expectRejected(body)
    }
  })

  it('resolution 只能是 approve / reject', () => {
    for (const resolution of [undefined, '', 'APPROVE', 'yes', 'deny', true, 1]) {
      expectRejected({ resolution, expectedDecisionId: OK_ID })
    }
  })

  it('🔴 缺 expectedDecisionId → 400（没有它就没法确认批的是不是他看见的那件事）', () => {
    for (const expectedDecisionId of [undefined, '', '   ', 42, null, {}]) {
      expectRejected({ resolution: 'approve', expectedDecisionId }, 'expectedDecisionId')
    }
  })

  it('🔴 expectedDecisionId 不是合法 UUID → 400（它最终要进 uuid RPC 参数）', () => {
    // 不判的话，Postgres 抛 22P02，接口答 500 —— 客户端问题被记成服务端故障。
    const bad = [
      'not-a-uuid',
      'decision-abc',
      '0d000000-0000-4000-8000-0000000000a', // 少一位
      '0d000000-0000-4000-8000-0000000000abc', // 多一位
      '0d000000_0000_4000_8000_0000000000ab', // 分隔符不对
      '0d000000-0000-4000-8000-0000000000ag', // g 不是十六进制
      "0d000000-0000-4000-8000-0000000000ab' OR 1=1--",
      '  0d000000-0000-4000-8000-0000000000ab  extra',
    ]
    for (const expectedDecisionId of bad) {
      expectRejected({ resolution: 'approve', expectedDecisionId }, '合法的 id')
    }
  })

  it('🔴 大小写混排的合法 UUID 照收，但**归一成小写**再往下传', () => {
    // 🔴 这条测的是一个真实的功能性坑：`expectedDecisionId` 后面要跟
    //    从库里读出来的 `authorization_decision_id` 做**字符串**比较，
    //    而 Postgres 吐的永远是小写。不归一的话，提交大写形式的合法 id
    //    会被判成 STALE_DECISION —— 批准和拒绝都永远提交不上去。
    const upper = '0D000000-0000-4000-8000-0000000000AB'
    expect(parseDecisionInput({ resolution: 'approve', expectedDecisionId: upper })).toEqual({
      resolution: 'approve',
      expectedDecisionId: '0d000000-0000-4000-8000-0000000000ab',
    })
  })

  it('🔴 全零 UUID 也是合法的（判据要跟数据库一致，别比数据库还严）', () => {
    const zero = '00000000-0000-0000-0000-000000000000'
    expect(
      parseDecisionInput({ resolution: 'approve', expectedDecisionId: zero }).expectedDecisionId,
    ).toBe(zero)
  })

  it('🔴 reject 不写原因 → 400', () => {
    for (const reason of [undefined, '', '   ', '\n\t ']) {
      expectRejected({ resolution: 'reject', expectedDecisionId: OK_ID, reason }, '必须写一句为什么')
    }
  })

  it('reason 不是文字 → 400', () => {
    expectRejected({ resolution: 'reject', expectedDecisionId: OK_ID, reason: 123 })
  })

  it(`reason 超过 ${MAX_REASON_LENGTH} 字 → 400`, () => {
    expectRejected({
      resolution: 'reject',
      expectedDecisionId: OK_ID,
      reason: 'x'.repeat(MAX_REASON_LENGTH + 1),
    })
    // 边界上那一条要放行
    expect(
      parseDecisionInput({
        resolution: 'reject',
        expectedDecisionId: OK_ID,
        reason: 'x'.repeat(MAX_REASON_LENGTH),
      }).reason,
    ).toHaveLength(MAX_REASON_LENGTH)
  })
})
