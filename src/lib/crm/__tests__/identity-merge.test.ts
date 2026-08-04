/**
 * 「这两个联系方式是不是同一个人」—— 合并的两种口径。
 *
 * 渠道适配器和人手打字，能信的程度完全不同：
 *   Meta 表单里的电话和邮箱来自同一次提交，是同一个人的两个身份 → 该合并。
 *   销售打字录新客人，电话打错一位、正好撞到另一个老客户 → 合并是灾难，
 *   两个真人的全部历史被搅在一起，不可逆、无审计。
 *
 * 这份测试钉住的就是这个分叉，以及「撞到老客户时不许改人家的名字」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact, AmbiguousIdentityError } from '../identity'

const CLIENT = 'client-a'
const PHONE = { kind: 'phone' as const, value: '+6421363598' }
const EMAIL = { kind: 'email' as const, value: 'chris@example.com' }

/** 记录下所有对 contacts 的 update，断言「有没有改名」要用。 */
let contactUpdates: Record<string, unknown>[]

/**
 * 两个身份分别命中两个不同的既有联系人 —— 就是那个危险场景。
 */
function mockTwoDifferentPeople() {
  contactUpdates = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contact_identities') {
      return {
        select: () => ({
          eq: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  { contact_id: 'person-old', kind: 'phone', value: PHONE.value },
                  { contact_id: 'person-other', kind: 'email', value: EMAIL.value },
                ],
              }),
          }),
        }),
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: () => Promise.resolve({ error: null }),
      }
    }
    if (table === 'contacts') {
      return {
        select: () => ({
          in: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { id: 'person-old', created_at: '2026-01-01T00:00:00Z' },
                  { id: 'person-other', created_at: '2026-05-01T00:00:00Z' },
                ],
              }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          contactUpdates.push(patch)
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return { update: () => ({ in: () => Promise.resolve({ error: null }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('手工录入：撞到两个已有客人时不许自作主张', () => {
  it('抛错交给人判断，不把两个人合成一个', async () => {
    mockTwoDifferentPeople()
    await expect(
      resolveContact({
        clientId: CLIENT,
        identities: [PHONE, EMAIL],
        displayName: '新客人',
        mergeStrategy: 'reject',
      }),
    ).rejects.toBeInstanceOf(AmbiguousIdentityError)
  })

  it('抛错时带上是哪两个人，界面才能摆给销售看', async () => {
    mockTwoDifferentPeople()
    const err = await resolveContact({
      clientId: CLIENT,
      identities: [PHONE, EMAIL],
      mergeStrategy: 'reject',
    }).catch((e) => e as AmbiguousIdentityError)

    expect(err).toBeInstanceOf(AmbiguousIdentityError)
    expect(err.contactIds.sort()).toEqual(['person-old', 'person-other'])
  })

  it('抛错之前不许动任何一条记录', async () => {
    mockTwoDifferentPeople()
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE, EMAIL],
      mergeStrategy: 'reject',
    }).catch(() => undefined)

    // 合并一旦发生就不可逆，所以必须是「先拦住，再什么都别做」
    expect(contactUpdates).toEqual([])
  })
})

describe('渠道适配器：同一次提交里的电话+邮箱，该合并还是要合并', () => {
  it('不传 mergeStrategy 时保持原有的自动合并行为', async () => {
    mockTwoDifferentPeople()
    const r = await resolveContact({
      clientId: CLIENT,
      identities: [PHONE, EMAIL],
      displayName: 'Chris Brown',
    })
    // 选最早创建的那个做主体
    expect(r.contactId).toBe('person-old')
    expect(r.created).toBe(false)
  })

  it('默认会用新名字更新显示名（表单里客户自己填的，越新越准）', async () => {
    mockTwoDifferentPeople()
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE, EMAIL],
      displayName: 'Chris Brown',
    })
    expect(contactUpdates.some((p) => p.display_name === 'Chris Brown')).toBe(true)
  })
})

describe('撞到老客户时不许改掉人家的名字', () => {
  it('overwriteDisplayName=false 时只更新时间，不动 display_name', async () => {
    mockTwoDifferentPeople()
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE, EMAIL],
      displayName: '打错号码的新客人',
      overwriteDisplayName: false,
    })
    // 电话打错一位撞到老客户，老客户不该被改名 —— 而且真正的新客人一条都没留下，
    // 那才是最该被人看见的事故，不是默默改名。
    expect(contactUpdates.every((p) => !('display_name' in p))).toBe(true)
  })
})
