/**
 * master_briefs.products 的规范化(纯函数,零 DB)。
 *
 * 结构由消费方定死:src/lib/content/brief-injector.ts 把它渲染成
 *   「主力产品:${name}(${usp});…」
 * 送进内容生成的 system prompt。所以每条就是 { name, usp } 两个字段,不多不少。
 *
 * 为什么这个字段要紧:三个客户(CTS / Oztop / Magic Lab Class)的 products 全是空的,
 * AI 拿到的那行一直是「主力产品:未设置」—— 它只能靠内容支柱和一句话定位去推,
 * 这正是「凭空编客户产品」类事故的结构性根因(Oztop 曾被编出 5 个根本不卖的品类)。
 */

export interface BriefProduct {
  name: string
  usp: string
}

export const MAX_PRODUCTS = 20
const MAX_NAME = 80
const MAX_USP = 120

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * 规范化 + 按名称去重(不分大小写)+ 限量。
 * 名称为空的整条丢弃 —— 只有卖点没有产品名的行对 AI 毫无意义,留着只会污染 prompt。
 */
export function normalizeProducts(raw: unknown): BriefProduct[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: BriefProduct[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const p = item as Record<string, unknown>
    const name = clean(p.name, MAX_NAME)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (out.length >= MAX_PRODUCTS) break
    seen.add(key)
    out.push({ name, usp: clean(p.usp, MAX_USP) })
  }
  return out
}
