import type {
  CmsConnectionStatus,
  ShopifyConnectionStatus,
  WordpressConnectionStatus,
} from './vocabulary'

export interface PageUpgradeProviders {
  github: CmsConnectionStatus | null
  wordpress: WordpressConnectionStatus | null
  shopify: ShopifyConnectionStatus | null
}

export type PageUpgradeExecutionPlan =
  | { provider: 'github'; mode: 'github_pr'; label: string; detail: string }
  | { provider: 'wordpress'; mode: 'wordpress_rewriter'; label: string; detail: string }
  | { provider: 'shopify'; mode: 'draft_only'; label: string; detail: string }
  | { provider: 'none'; mode: 'draft_only'; label: string; detail: string }

export function resolvePageUpgradeExecution(
  pageUrl: string,
  providers: PageUpgradeProviders,
): PageUpgradeExecutionPlan {
  if (
    providers.wordpress?.connected
    && sameHost(pageUrl, providers.wordpress.siteUrl)
  ) {
    return {
      provider: 'wordpress',
      mode: 'wordpress_rewriter',
      label: '在 WordPress 安全审核并更新',
      detail: '重新读取线上页面，逐项核对后才会写回。',
    }
  }

  if (providers.github?.connected) {
    return {
      provider: 'github',
      mode: 'github_pr',
      label: '创建网站更新 PR',
      detail: '在独立分支提交安全变更，审核并合并后才会部署。',
    }
  }

  if (providers.shopify?.connected) {
    return {
      provider: 'shopify',
      mode: 'draft_only',
      label: '保存升级草稿',
      detail: 'Shopify 已连接，但现有页面更新仍需人工审核，当前不会自动写回。',
    }
  }

  if (providers.wordpress?.connected) {
    return {
      provider: 'none',
      mode: 'draft_only',
      label: '保存升级草稿',
      detail: '页面域名与已连接的 WordPress 不匹配，为防止写错网站，本次只保存草稿。',
    }
  }

  return {
    provider: 'none',
    mode: 'draft_only',
    label: '保存升级草稿',
    detail: '尚未连接可执行的网站渠道。连接 GitHub、WordPress 或 Shopify 后可进入发布流程。',
  }
}

function sameHost(leftUrl: string, rightUrl: string): boolean {
  try {
    return normaliseHost(new URL(leftUrl).hostname) === normaliseHost(new URL(rightUrl).hostname)
  } catch {
    return false
  }
}

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}
