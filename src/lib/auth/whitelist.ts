// Fail-closed: if no config, nobody gets in

export type UserRole = 'admin' | 'client-viewer'

export interface UserPermissions {
  role: UserRole
  allowedClientId: string | null  // null = all clients; UUID for restricted access
}

export function isAllowedEmail(email: string): boolean {
  return getUserPermissions(email) !== null
}

/**
 * 全局管理员精确判定——只认 `ADMIN_EMAILS` 写死名单里的精确匹配，
 * **不**认 `ADMIN_EMAIL_DOMAIN` 的域名匹配。
 *
 * 用途：客户知识库双签闸（Issue #1644）判定"这个邮箱是不是 ME 全局管理员"时，
 * 域名匹配太松——`ADMIN_EMAIL_DOMAIN=magicengine.cloud` 会让公司里任何一个人
 * 的邮箱都被当成"全局管理员"，而这里要拦的是"内部人员冒充客户去确认自己批
 * 准过的事实"，判据必须收紧到真正登记过的管理员名单。
 */
export function isGlobalAdminEmail(email: string): boolean {
  const normalised = email.toLowerCase().trim()
  if (!normalised) return false
  const allowedEmails = process.env.ADMIN_EMAILS
  if (!allowedEmails) return false
  const list = allowedEmails.split(',').map((e) => e.toLowerCase().trim())
  return list.includes(normalised)
}

/** 解析 "email:clientId,email2:clientId2" 这类映射 */
function lookupScopedEntry(raw: string, normalisedEmail: string): string | null {
  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const colonIndex = entry.indexOf(':')
    if (colonIndex === -1) continue
    const entryEmail = entry.slice(0, colonIndex).toLowerCase().trim()
    const clientId = entry.slice(colonIndex + 1).trim()
    if (entryEmail === normalisedEmail && clientId) return clientId
  }
  return null
}

export function getUserPermissions(email: string): UserPermissions | null {
  const normalised = email.toLowerCase().trim()

  // DEMO_ADMINS —— 受限管理员（格式同 CLIENT_VIEWERS："email:clientId"）。
  //
  // 用途：给演示 / 试用账号完整的 FDE 视角，但**只在指定的那一个客户范围内**。
  // 与 ADMIN_EMAILS 的区别是后者 allowedClientId = null，可以访问全部客户 ——
  // 拿它开演示账号会把全部真实客户的品牌简报、联系人、广告账户暴露出去。
  //
  // 必须排在 ADMIN_EMAILS 之前：同一个邮箱若两边都配，取更严格的一方。
  const demoAdminClientId = lookupScopedEntry(process.env.DEMO_ADMINS ?? '', normalised)
  if (demoAdminClientId) {
    return { role: 'admin', allowedClientId: demoAdminClientId }
  }

  // Check CLIENT_VIEWERS first (format: "email:clientId,email2:clientId2")
  const clientViewers = process.env.CLIENT_VIEWERS ?? ''
  for (const entry of clientViewers.split(',').map((e) => e.trim()).filter(Boolean)) {
    const colonIndex = entry.indexOf(':')
    if (colonIndex === -1) continue
    const viewerEmail = entry.slice(0, colonIndex).toLowerCase().trim()
    const clientId = entry.slice(colonIndex + 1).trim()
    if (viewerEmail === normalised) {
      return { role: 'client-viewer', allowedClientId: clientId }
    }
  }

  // Check ADMIN_EMAILS
  const allowedEmails = process.env.ADMIN_EMAILS
  if (allowedEmails) {
    const list = allowedEmails.split(',').map((e) => e.toLowerCase().trim())
    if (list.includes(normalised)) return { role: 'admin', allowedClientId: null }
  }

  // Check ADMIN_EMAIL_DOMAIN
  const allowedDomain = process.env.ADMIN_EMAIL_DOMAIN
  if (allowedDomain) {
    if (normalised.endsWith('@' + allowedDomain.toLowerCase().trim())) {
      return { role: 'admin', allowedClientId: null }
    }
  }

  return null
}
