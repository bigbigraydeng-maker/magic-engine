/**
 * K-WP01A —— capability tier 闸。
 *
 * 🔴 **这道闸单独直测，不靠前一道闸遮着。**
 *
 *    线上 `requirePaidClientAccess` 已经把 `self_serve` / `portal_only` 挡在门外，
 *    所以「self_serve 批不了东西」这件事，光靠走一遍接口是**测不出来**的 ——
 *    红的会是前一道闸，而这一道就算整个删掉也照样全绿。
 *    那正是遮蔽闸的温床：哪天前面那道放宽了，这里就是唯一一道，
 *    而它从来没有被验证过。
 *
 *    所以下面直接对着 `canAuthorizeAction` 逐档过一遍。
 */

import { describe, it, expect } from 'vitest'
import type { ActionRun } from '@/lib/kernel/types'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { ApprovalError } from '../errors'
import {
  canAuthorizeAction,
  assertActorMayApprove,
  approvalPermissionsFor,
} from '../service'

const ALL_REQUIRED_TIERS = ['admin', 'paid_client', 'self_serve', 'portal_only'] as const

function fakeRun(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'run-1',
    client_id: 'client-a',
    action_key: 'seo.build_publish_package',
    action_version: 1,
    status: 'pending_approval',
    ...overrides,
  } as ActionRun
}

describe('canAuthorizeAction · 冻结判定', () => {
  it('admin 能授权任何门槛的动作', () => {
    for (const required of ALL_REQUIRED_TIERS) {
      expect(canAuthorizeAction('admin', required), `admin → ${required}`).toBe(true)
    }
  })

  it('paid_client 能授权门槛不是 admin 的动作', () => {
    expect(canAuthorizeAction('paid_client', 'paid_client')).toBe(true)
    expect(canAuthorizeAction('paid_client', 'self_serve')).toBe(true)
    expect(canAuthorizeAction('paid_client', 'portal_only')).toBe(true)
  })

  it('🔴 paid_client 授权不了门槛为 admin 的动作', () => {
    expect(canAuthorizeAction('paid_client', 'admin')).toBe(false)
  })

  it('🔴 self_serve 一律不许授权（连门槛最低的都不行）', () => {
    for (const required of ALL_REQUIRED_TIERS) {
      expect(canAuthorizeAction('self_serve', required), `self_serve → ${required}`).toBe(false)
    }
  })

  it('🔴 portal_only 一律不许授权', () => {
    for (const required of ALL_REQUIRED_TIERS) {
      expect(canAuthorizeAction('portal_only', required), `portal_only → ${required}`).toBe(false)
    }
  })

  it('🔴 **未知的 required tier** 同样 fail closed（这是否定判断会漏掉的那一半）', () => {
    // 🔴 早先写的是 `paid_client → requiredTier !== 'admin'`。那是否定判断：
    //    注册表哪天用上一个还没分类的新门槛（比如更高权限的 super_admin），
    //    它「不等于 admin」，paid_client 立刻就获得批准权 —— 跟 fail closed 相反。
    //    穷举白名单的默认答案是「不许」，否定判断的默认答案是「放行」。
    for (const unknownRequired of ['super_admin', 'owner', 'ADMIN', 'paid_client ', '', 'staff']) {
      expect(
        canAuthorizeAction('paid_client', unknownRequired),
        `paid_client → 未知门槛「${unknownRequired}」必须拒`,
      ).toBe(false)
      expect(
        canAuthorizeAction('admin', unknownRequired),
        `admin → 未知门槛「${unknownRequired}」同样必须拒（表里没有就是没有）`,
      ).toBe(false)
    }
  })

  it('🔴 真值表逐格钉死 —— 加一档新 tier 必须回来改这张表', () => {
    const TRUTH: ReadonlyArray<[actor: string, required: string, expected: boolean]> = [
      ['admin', 'admin', true],
      ['admin', 'paid_client', true],
      ['admin', 'self_serve', true],
      ['admin', 'portal_only', true],
      ['paid_client', 'admin', false],
      ['paid_client', 'paid_client', true],
      ['paid_client', 'self_serve', true],
      ['paid_client', 'portal_only', true],
      ['self_serve', 'admin', false],
      ['self_serve', 'paid_client', false],
      ['self_serve', 'self_serve', false],
      ['self_serve', 'portal_only', false],
      ['portal_only', 'admin', false],
      ['portal_only', 'paid_client', false],
      ['portal_only', 'self_serve', false],
      ['portal_only', 'portal_only', false],
    ]
    for (const [actor, required, expected] of TRUTH) {
      expect(canAuthorizeAction(actor, required), `${actor} → ${required}`).toBe(expected)
    }
  })

  it('🔴 认不出的档次 fail closed —— 加一个新档次忘了分类，默认是「不许」', () => {
    for (const unknown of ['', 'superuser', 'ADMIN', 'admin ', 'fde', 'both', 'client']) {
      expect(canAuthorizeAction(unknown, 'paid_client'), `未知档次「${unknown}」`).toBe(false)
    }
  })
})

describe('assertActorMayApprove（批准前的硬闸）', () => {
  it('付费客户可以授权注册表里门槛为 paid_client 的动作', () => {
    expect(ACTION_REGISTRY.get('seo.build_publish_package')!.requiredCapabilityTier).toBe(
      'paid_client',
    )
    expect(() => assertActorMayApprove(fakeRun(), 'paid_client')).not.toThrow()
    expect(() => assertActorMayApprove(fakeRun(), 'admin')).not.toThrow()
  })

  it('🔴 self_serve / portal_only 拿到 403 forbidden_tier', () => {
    for (const tier of ['self_serve', 'portal_only'] as const) {
      const err = (() => {
        try {
          assertActorMayApprove(fakeRun(), tier)
          return null
        } catch (e) {
          return e
        }
      })()
      expect(err, `${tier} 必须被拒`).toBeInstanceOf(ApprovalError)
      expect((err as ApprovalError).code).toBe('forbidden_tier')
      expect((err as ApprovalError).status).toBe(403)
    }
  })

  it('🔴 契约升过版 → 旧请求不许拿新版的规则来批（fail closed）', () => {
    // 🔴 注册表只存**当前**这一版。旧 run 按 action_key 是查得到定义的 ——
    //    查到的是新版。真实后果有两层：
    //      · 权限：requiredCapabilityTier 按新版判。旧版要 admin、新版降成
    //        paid_client 的话，一条本该只有内部人能批的旧动作就对付费客户开了；
    //      · 展示：把新版标题 / 风险 / 副作用贴在一条旧请求上。
    //    Kernel 的 preflight 早就在判这一条，审批路径没理由更松。
    const current = ACTION_REGISTRY.get('seo.build_publish_package')!
    const oldVersionRun = fakeRun({ action_version: current.version + 1 })

    for (const tier of ['admin', 'paid_client'] as const) {
      const err = (() => {
        try {
          assertActorMayApprove(oldVersionRun, tier)
          return null
        } catch (e) {
          return e
        }
      })()
      expect(err, `${tier} 也不许批一条版本对不上的请求`).toBeInstanceOf(ApprovalError)
      expect((err as ApprovalError).code).toBe('forbidden_tier')
      expect((err as ApprovalError).detail.reason).toBe('unknown_action_version')
    }
  })

  it('🔴 批不了的时候，permissions 仍然说「可以拒绝」—— 这条 run 不许被卡死', () => {
    // 🔴 铁律「管道不许断头」：契约升版 / 动作下架之后，这些旧请求
    //    没有别的清理入口。连拒绝都挡掉的话，它们会永久停在待审批里，
    //    而界面上看起来一切正常。门槛只管「批准」，不管「说不做」。
    const current = ACTION_REGISTRY.get('seo.build_publish_package')!
    const cases: Array<[label: string, run: ActionRun, reason: string]> = [
      ['版本对不上', fakeRun({ action_version: current.version + 1 }), 'unknown_action_version'],
      ['动作已下架', fakeRun({ action_key: 'geo.rewrite_the_whole_site' }), 'unknown_action'],
    ]
    for (const [label, run, reason] of cases) {
      for (const tier of ['admin', 'paid_client'] as const) {
        const perms = approvalPermissionsFor(run, tier)
        expect(perms.canApprove, `${label} / ${tier} 不许批`).toBe(false)
        expect(perms.approveBlockedReason).toBe(reason)
        expect(perms.canReject, `${label} / ${tier} **必须**还能拒绝`).toBe(true)
      }
    }
  })

  it('🔴 档次不够时同样：批不了，但拒绝仍然可以', () => {
    const perms = approvalPermissionsFor(fakeRun(), 'self_serve')
    expect(perms.canApprove).toBe(false)
    expect(perms.approveBlockedReason).toBe('insufficient_tier')
    expect(perms.canReject).toBe(true)
  })

  it('能批的时候 permissions 两项都是真，且没有 blocked 原因', () => {
    const perms = approvalPermissionsFor(fakeRun(), 'paid_client')
    expect(perms).toEqual({ canApprove: true, canReject: true, approveBlockedReason: null })
  })

  it('✅ 版本对得上时照常放行（判据不是把所有人都拦掉）', () => {
    const current = ACTION_REGISTRY.get('seo.build_publish_package')!
    expect(() =>
      assertActorMayApprove(fakeRun({ action_version: current.version }), 'paid_client'),
    ).not.toThrow()
  })

  it('🔴 注册表认不出这个动作 → 谁也批不了（fail closed，不是「先批了再说」）', () => {
    const err = (() => {
      try {
        assertActorMayApprove(fakeRun({ action_key: 'geo.rewrite_the_whole_site' }), 'admin')
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('forbidden_tier')
    expect((err as ApprovalError).detail.reason).toBe('unknown_action')
  })
})
