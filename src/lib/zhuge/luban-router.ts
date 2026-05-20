/**
 * 鲁班路由 — maps a Luban tool name to a Magic Engine page URL.
 *
 * Pure function; no side effects. Called by ZhugeDrawer to resolve
 * the "触发鲁班" CTA destination for each priority action.
 *
 * Reference: ROADMAP.md Phase 12.G (P12.G.5)
 */

export type LubanRoute =
  | { kind: 'navigate'; href: string; label: string }
  | { kind: 'none'; reason: string }

/**
 * Returns the destination route for a Luban tool, given a client ID.
 * Returns `{ kind: 'none' }` when the tool is null or not yet routed.
 */
export function getLubanRoute(tool: string | null, clientId: string): LubanRoute {
  if (!tool) {
    return { kind: 'none', reason: 'FDE 或外部完成，无法自动触发' }
  }

  switch (tool) {
    case 'luban.generate_blog_post':
      return {
        kind: 'navigate',
        href: `/dashboard/clients/${clientId}/blog`,
        label: '前往博客管理 →',
      }
    case 'luban.generate_geo_directive':
    case 'luban.publish_geo_snippet':
      return {
        kind: 'navigate',
        href: `/dashboard/geo-composer/${clientId}`,
        label: '前往 GEO Composer →',
      }
    case 'luban.generate_social_campaign':
    case 'luban.generate_social_post':
      return {
        kind: 'navigate',
        href: `/dashboard/clients/${clientId}`,
        label: '前往社媒矩阵 →',
      }
    default:
      return {
        kind: 'none',
        reason: `工具 ${tool} 暂未接入自动触发路由`,
      }
  }
}
