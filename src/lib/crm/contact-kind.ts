/**
 * 这个人是终端客户、同行、还是客户自己的员工。
 *
 * ## 为什么要分（PM 2026-08-04，客户直接反馈）
 *
 * CTS 的老板打开「今天该联系谁」，说了一句：**「contact 里面怎么还有工作人员？」**
 *
 * 查下来 info@ 接进来的 37 个新联系人里，只有一半是真正的散客。另一半是：
 *
 *   · **同行旅行社** —— House of Travel 四个门店、TravelManagers、Orbit、
 *     North Travel、Travel Point、Asiascape… 约 16 人。他们是真人、真业务
 *     （CTS 通过同行卖团），但跟「想去中国旅游的散客」是两种完全不同的跟进方式。
 *   · **CTS 自己的员工** —— `pa@chinatravel.co.nz`。系统里只登记了
 *     `ctstours.co.nz` 一个域名，所以「同事不建人」那条没拦住。
 *
 * PM 的口径：**同行单独标记、分类；「今天该联系谁」主要还是终端客户。**
 *
 * ## 为什么按域名判，不按人判
 *
 * 一个一个手工标必烂 —— CTS 那份手工 CRM 128 行里「阶段」列 0 个填了，
 * 就是活证据。而同行有一个天然的、稳定的标志：**公司邮箱域名**。
 * 登记一次 `hot.co.nz`，House of Travel 全国所有门店、以后新来的人，
 * 第一天就自动归好类，不需要任何人再动手。
 *
 * ## 为什么不存成一列
 *
 * 跟首次来源同一个道理：它是从邮箱地址算出来的，而地址不会变。存一列反而
 * 多一个会跟事实走散的地方 —— 而且域名清单一改，存下来的那一列就全是旧的。
 *
 * ## 员工优先于同行
 *
 * 两边都命中时算员工。CTS 和 chinatravel.co.nz 是关联公司，两个域名都可能
 * 出现在同行名单上；说「这是自己人」比说「这是同行」更准确，而且更该被排除。
 */

/** 这个人对客户来说是什么身份。 */
export type ContactKind =
  /** 终端客户 —— 「今天该联系谁」主要就是这批人。 */
  | 'retail'
  /** 同行 / 分销 —— 真业务，但跟进方式完全不同，单独分类。 */
  | 'trade'
  /** 客户自己的员工 —— 根本不该出现在客人名单里。 */
  | 'staff'

export interface DomainRules {
  /** 客户自己的邮件域名（可以有多个：主域名 + 关联公司）。 */
  own: string[]
  /** 同行 / 分销商的域名。 */
  trade: string[]
}

export const EMPTY_RULES: DomainRules = { own: [], trade: [] }

/** 去掉协议、www、路径、@、空格，统一小写。人填进设置页的东西什么形状都有。 */
export function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^.*@/, '') // 有人会整个邮箱粘进来
    .replace(/\/.*$/, '')
    .replace(/[.,;]+$/, '')
}

/**
 * 规整之后看起来是不是一个真域名。
 *
 * 设置页那两个框是给人填的，人会填进公司名（`House of Travel`）、
 * 半截地址、一句话。**这种东西必须当场退回去，不能默默存下来** ——
 * 存下来它永远不会命中任何邮箱，而填的人以为自己已经把同行标好了，
 * 于是那批人继续躺在散客名单里，谁也不知道为什么。
 */
export function isUsableDomain(domain: string): boolean {
  // 至少两段、只允许字母数字和连字符、末段是字母（排除 IP 和 `a.1`）
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)
}

export interface ParsedDomainList {
  domains: string[]
  /** 认不出来的原样退回，让填的人知道哪几条没生效。 */
  rejected: string[]
}

/**
 * 把人填进框里的一坨文字变成一份干净的域名清单。
 *
 * 换行、逗号、分号当分隔符 —— 从表格里粘过来是什么样都能收。
 *
 * **空格不是分隔符，除非拆开之后每一段都是域名。**
 * 拿空格无条件拆，`House of Travel` 会变成三段，退回去的话变成
 * 「House、of、Travel 不是域名」—— 填的人看了只会更懵，还以为系统坏了。
 * 而 `hot.co.nz travelmanagers.co.nz` 这种一行粘两个的又确实要拆。
 * 两个都要，判据就只能是「拆开之后是不是全都成立」。
 */
export function parseDomainList(input: unknown): ParsedDomainList {
  const pieces = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === 'string')
    : typeof input === 'string'
      ? input.split(/[\n\r,;、，；]+/)
      : []

  const domains: string[] = []
  const rejected: string[] = []

  const take = (t: string) => {
    const d = normaliseDomain(t)
    if (d && isUsableDomain(d)) {
      if (!domains.includes(d)) domains.push(d)
      return true
    }
    return false
  }

  for (const piece of pieces) {
    const t = piece.trim()
    if (!t) continue

    if (/\s/.test(t)) {
      // 全都是域名才拆；只要有一段不是，整条当作一个填错的东西退回去。
      const parts = t.split(/\s+/).filter(Boolean)
      const allDomains = parts.every((p) => {
        const d = normaliseDomain(p)
        return !!d && isUsableDomain(d)
      })
      if (allDomains) {
        parts.forEach(take)
        continue
      }
      if (!rejected.includes(t)) rejected.push(t)
      continue
    }

    if (!take(t) && !rejected.includes(t)) rejected.push(t)
  }

  return { domains, rejected }
}

/**
 * 地址的域名是不是命中了清单里某一条。
 *
 * 子域名也算（`mail.hot.co.nz` 命中 `hot.co.nz`）—— 大公司的分部经常挂子域名，
 * 漏掉它们就等于这条规则只覆盖一半。但**必须是真的子域**（前面带一个点），
 * 不能拿 `endsWith` 硬判：那样 `nothot.co.nz` 会命中 `hot.co.nz`。
 */
function domainMatches(domain: string, listed: string): boolean {
  return domain === listed || domain.endsWith(`.${listed}`)
}

function domainOf(address: string): string | null {
  const at = address.trim().toLowerCase().lastIndexOf('@')
  if (at <= 0) return null
  const d = address.trim().toLowerCase().slice(at + 1)
  return d || null
}

/**
 * 这个人算哪一类。
 *
 * 一个人可以挂多个邮箱（同行的人也会用私人 Gmail 来问事）。**只要有一个邮箱
 * 命中就算数** —— 用公司邮箱写过信的人，就是那家公司的人。
 */
export function contactKindOf(emails: readonly string[], rules: DomainRules): ContactKind {
  const own = rules.own.map(normaliseDomain).filter(Boolean)
  const trade = rules.trade.map(normaliseDomain).filter(Boolean)
  const domains = emails.map(domainOf).filter((d): d is string => !!d)

  // 员工优先 —— 两边都命中时说「自己人」更准确，也更该被排除。
  if (domains.some((d) => own.some((o) => domainMatches(d, o)))) return 'staff'
  if (domains.some((d) => trade.some((t) => domainMatches(d, t)))) return 'trade'
  return 'retail'
}

/**
 * 从 `clients.leads_config` 里读两份域名清单。
 *
 * 存在这里而不是新开两列：`leads_config` 已经是这个客户的「获客相关配置」
 * 的 jsonb，而且设置页上已经有它的面板 —— 不用改表、不用 PM 批 migration，
 * FDE 今天就能填。
 *
 * 读得宽容：不是数组、混进非字符串、有空格大小写，都不炸，直接清干净。
 * 一个填错的配置不该让整块看板打不开。
 */
export function readDomainRules(leadsConfig: unknown): DomainRules {
  const cfg = (leadsConfig ?? {}) as Record<string, unknown>
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? Array.from(
          new Set(
            v
              .filter((x): x is string => typeof x === 'string')
              .map(normaliseDomain)
              .filter(Boolean),
          ),
        )
      : []
  return { own: list(cfg.own_email_domains), trade: list(cfg.trade_domains) }
}

/** 卡片上那个小标记。终端客户不标 —— 他们是默认，标了只是噪音。 */
export const CONTACT_KIND_LABEL: Record<Exclude<ContactKind, 'retail'>, string> = {
  trade: '🤝 同行',
  staff: '🏢 自己人',
}
