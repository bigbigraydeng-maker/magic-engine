/**
 * The shared confirmer-identity predicate (issue #1646).
 *
 * Each rule gets its own test so the mutation checklist in the design doc
 * §9.14 D (items 7 and 8) can delete exactly one `if` in `dual-sign.ts` and
 * see exactly one test go red.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkConfirmerIdentity, isAcceptableConfirmerIdentity, normaliseEmail } from '../dual-sign'

const ADMIN = 'ray@magicengine.cloud'
const savedAdminEmails = process.env.ADMIN_EMAILS
const savedAdminDomain = process.env.ADMIN_EMAIL_DOMAIN

beforeEach(() => {
  process.env.ADMIN_EMAILS = ADMIN
  // 🔴 §9.14 A.B：公司域名**不算**全局管理员。故意把域名变量设上，证明
  // 这里用的判据是精确名单匹配，而不是"看着像公司邮箱就放行/拦截"。
  process.env.ADMIN_EMAIL_DOMAIN = 'magicengine.cloud'
})
afterEach(() => {
  if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = savedAdminEmails
  if (savedAdminDomain === undefined) delete process.env.ADMIN_EMAIL_DOMAIN
  else process.env.ADMIN_EMAIL_DOMAIN = savedAdminDomain
})

const registered = new Set(['owner@ctstours.co.nz'])

describe('checkConfirmerIdentity', () => {
  it('accepts a registered confirmer who is neither the approver nor an admin', () => {
    expect(
      checkConfirmerIdentity({
        confirmerEmail: 'owner@ctstours.co.nz',
        approverEmail: 'fde@magicengine.cloud',
        registeredConfirmerEmails: registered,
      }),
    ).toBeNull()
  })

  it('refuses a blank or whitespace-only email', () => {
    expect(
      checkConfirmerIdentity({ confirmerEmail: '   ', approverEmail: null, registeredConfirmerEmails: registered }),
    ).toBe('missing')
    expect(
      checkConfirmerIdentity({ confirmerEmail: null, approverEmail: null, registeredConfirmerEmails: registered }),
    ).toBe('missing')
  })

  it('refuses the approver confirming their own draft', () => {
    expect(
      checkConfirmerIdentity({
        confirmerEmail: 'owner@ctstours.co.nz',
        approverEmail: 'owner@ctstours.co.nz',
        registeredConfirmerEmails: registered,
      }),
    ).toBe('same_as_approver')
  })

  it('refuses the approver even when the two spellings differ only by case and padding', () => {
    // 🔴 狄仁杰 2026-09-14 实测过的绕过手法：尾随空格让同一个人在三处比较
    // 里看起来像三个不同的人。
    expect(
      checkConfirmerIdentity({
        confirmerEmail: ' Owner@CTStours.co.nz ',
        approverEmail: 'owner@ctstours.co.nz',
        registeredConfirmerEmails: registered,
      }),
    ).toBe('same_as_approver')
  })

  it('refuses a global admin standing in for the customer', () => {
    const withAdminRegistered = new Set([ADMIN])
    expect(
      checkConfirmerIdentity({
        confirmerEmail: ADMIN,
        approverEmail: 'someone-else@magicengine.cloud',
        registeredConfirmerEmails: withAdminRegistered,
      }),
    ).toBe('global_admin')
  })

  it('does NOT treat a company-domain account as a global admin (exact ADMIN_EMAILS list only)', () => {
    // fde@magicengine.cloud 是公司域名账号但不在 ADMIN_EMAILS 名单里。
    // 如果这里返回 'global_admin'，说明判据偷偷用了 ADMIN_EMAIL_DOMAIN。
    const list = new Set(['fde@magicengine.cloud'])
    expect(
      checkConfirmerIdentity({
        confirmerEmail: 'fde@magicengine.cloud',
        approverEmail: null,
        registeredConfirmerEmails: list,
      }),
    ).toBeNull()
  })

  it('refuses an email that is not a currently-registered confirmer for this client', () => {
    expect(
      checkConfirmerIdentity({
        confirmerEmail: 'random@example.com',
        approverEmail: null,
        registeredConfirmerEmails: registered,
      }),
    ).toBe('not_registered')
  })

  it('matches the registry case-insensitively and ignoring padding', () => {
    expect(
      checkConfirmerIdentity({
        confirmerEmail: '  OWNER@ctstours.co.nz ',
        approverEmail: null,
        registeredConfirmerEmails: registered,
      }),
    ).toBeNull()
  })

  it('isAcceptableConfirmerIdentity is the boolean view of the same decision', () => {
    expect(
      isAcceptableConfirmerIdentity({
        confirmerEmail: 'owner@ctstours.co.nz',
        approverEmail: null,
        registeredConfirmerEmails: registered,
      }),
    ).toBe(true)
    expect(
      isAcceptableConfirmerIdentity({
        confirmerEmail: 'nobody@example.com',
        approverEmail: null,
        registeredConfirmerEmails: registered,
      }),
    ).toBe(false)
  })
})

describe('normaliseEmail', () => {
  it('trims and lower-cases, and turns null/undefined into an empty string', () => {
    expect(normaliseEmail('  Ray@X.com ')).toBe('ray@x.com')
    expect(normaliseEmail(null)).toBe('')
    expect(normaliseEmail(undefined)).toBe('')
  })
})
