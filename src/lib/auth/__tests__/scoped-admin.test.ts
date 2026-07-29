import { getUserPermissions } from '../whitelist'

/**
 * 受限管理员（DEMO_ADMINS）。
 *
 * 为什么必须有测试：这是唯一挡在「演示账号」和「23 个真实客户的品牌简报 /
 * 联系人 / 广告账户」之间的东西。ADMIN_EMAILS 给的 allowedClientId 是 null，
 * 在 client-access 里等于放行一切；DEMO_ADMINS 必须返回具体 clientId，
 * 否则演示账号改个 URL 就能读到别人的数据。
 */

const ENV_KEYS = ['DEMO_ADMINS', 'ADMIN_EMAILS', 'CLIENT_VIEWERS', 'ADMIN_EMAIL_DOMAIN'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const DEMO = 'd0000000-0000-0000-0000-000000000001'

describe('DEMO_ADMINS — 受限管理员', () => {
  it('返回 admin 角色但带上 clientId', () => {
    process.env.DEMO_ADMINS = `friend@example.com:${DEMO}`
    expect(getUserPermissions('friend@example.com')).toEqual({
      role: 'admin',
      allowedClientId: DEMO,
    })
  })

  it('邮箱大小写与空格不影响匹配', () => {
    process.env.DEMO_ADMINS = `friend@example.com:${DEMO}`
    expect(getUserPermissions('  Friend@Example.COM ')?.allowedClientId).toBe(DEMO)
  })

  it('支持多个受限管理员', () => {
    const other = 'd0000000-0000-0000-0000-000000000002'
    process.env.DEMO_ADMINS = `a@x.com:${DEMO}, b@x.com:${other}`
    expect(getUserPermissions('a@x.com')?.allowedClientId).toBe(DEMO)
    expect(getUserPermissions('b@x.com')?.allowedClientId).toBe(other)
  })

  it('同一邮箱同时出现在 ADMIN_EMAILS 时，取更严格的受限身份', () => {
    // 否则一旦有人「顺手」把演示账号也加进 ADMIN_EMAILS，限制就被静默解除了
    process.env.DEMO_ADMINS = `friend@example.com:${DEMO}`
    process.env.ADMIN_EMAILS = 'friend@example.com'
    expect(getUserPermissions('friend@example.com')).toEqual({
      role: 'admin',
      allowedClientId: DEMO,
    })
  })

  it('即使邮箱属于 ADMIN_EMAIL_DOMAIN 提权域名，仍保持受限', () => {
    // 通用演示账号很可能就叫 demo@magicengine.com.au —— 正好落在提权域名里。
    // 判定顺序（DEMO_ADMINS 在最前）是唯一的防线，将来有人调换顺序
    // 会静默把演示账号提成完整管理员，所以必须锁死。
    process.env.DEMO_ADMINS = `demo@magicengine.com.au:${DEMO}`
    process.env.ADMIN_EMAIL_DOMAIN = 'magicengine.com.au'
    expect(getUserPermissions('demo@magicengine.com.au')).toEqual({
      role: 'admin',
      allowedClientId: DEMO,
    })
  })

  it('同域名的其他邮箱仍按域名规则拿到完整管理员', () => {
    // 确认上一条没有把整个域名规则误伤掉
    process.env.DEMO_ADMINS = `demo@magicengine.com.au:${DEMO}`
    process.env.ADMIN_EMAIL_DOMAIN = 'magicengine.com.au'
    expect(getUserPermissions('zhong@magicengine.com.au')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
  })

  it('不在名单里的邮箱仍然拿不到任何权限', () => {
    process.env.DEMO_ADMINS = `friend@example.com:${DEMO}`
    expect(getUserPermissions('stranger@example.com')).toBeNull()
  })

  it('格式不合法的条目被忽略，不会误放行', () => {
    process.env.DEMO_ADMINS = 'no-colon-entry, another@x.com:'
    expect(getUserPermissions('no-colon-entry')).toBeNull()
    expect(getUserPermissions('another@x.com')).toBeNull()
  })
})

describe('普通管理员行为不受影响', () => {
  it('ADMIN_EMAILS 仍然是 allowedClientId = null（可访问全部客户）', () => {
    process.env.ADMIN_EMAILS = 'boss@example.com'
    expect(getUserPermissions('boss@example.com')).toEqual({
      role: 'admin',
      allowedClientId: null,
    })
  })

  it('CLIENT_VIEWERS 仍然是 client-viewer 角色', () => {
    process.env.CLIENT_VIEWERS = `viewer@x.com:${DEMO}`
    expect(getUserPermissions('viewer@x.com')).toEqual({
      role: 'client-viewer',
      allowedClientId: DEMO,
    })
  })
})
