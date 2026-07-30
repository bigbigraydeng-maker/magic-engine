/**
 * 来源归因 —— 「这个人是哪条广告 / 哪条视频带来的」
 *
 * 学习链条是「房子 → 内容 → 广告 → 买家质量 → 成交结果」。contacts 原来一个
 * 来源字段都没有,所以能看到「成交了」却看不到「谁带来的」—— 赢家拆不出来、
 * 输家也停不掉。这个模块是那条链的第三环:把渠道给的归因收敛成一组固定字段,
 * 一处定义、四个写入方共用(见文末「谁在用」)。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Meta 实测能拿到什么(字段只按这里的证据设计,拿不到的一律 NULL,绝不编)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ✅ 有仓内证据 —— CTS 真实 lead 导出里存在的列
 *    `scripts/import-cts-fb-leads.ts` 按名字读表头,证明这些列真的在:
 *      id · created_time · full_name · email · phone_number · ad_name
 *      + 自定义问题 'which_tour_interests_you_most?'
 *    所以 attr_ad_name 一定填得上,attr_ad_id 在这份存量文件里**填不上**。
 *
 * ⚠️ 未证实(Meta 标准 lead 导出/Graph `/{form_id}/leads` 的常规列,但本仓没有
 *    任何文件或 API 调用证明过它们在 CTS 那份导出里):
 *      ad_id · adset_id · adset_name · campaign_id · campaign_name
 *      form_id · platform · is_organic
 *    → 因此 fromMetaLeadRow() **防御式读取**:表头没有这一列就是 null,
 *      不假设、不报错。将来接了 Graph 直读再把这几列升级成「已证实」。
 *
 * ❌ 拿不到的
 *    · creative id —— Meta 的 lead 导出不返回创意 id。attr_creative_ref 的
 *      真相源只能是 ME 自己的出片管道(reels_draft / 成片 id),由调用方显式传。
 *    · Messenger 私信的 ad_id / ctwa_clid —— ME 的私信同步走 Graph
 *      `/{page}/conversations`(见 src/lib/meta/conversations.ts,messages 只请求
 *      `id,created_time,message,from,tags`)。CTWA / 广告点进来的 referral 只在
 *      **Webhook** 的 messaging_referrals 事件里出现,读接口拿不到。所以私信
 *      触点的 attr_* 全部 NULL —— 留白是事实,标成 'organic_social' 反而是撒谎
 *      (那条私信可能真的是广告点进来的,我们只是不知道)。
 *
 * 谁在用
 * ------
 *   src/lib/crm/identity.ts           resolveContact() 建人 / 回填 first-touch
 *   scripts/import-cts-fb-leads.ts    Meta lead 导入(唯一有 ad 级归因的入口)
 *   src/app/api/clients/[id]/crm/contacts/route.ts   手工录入(platform='manual')
 *   src/lib/messenger/link-contacts.ts 私信:显式不写 attr_*(理由见上)
 */

/**
 * 渠道大类。真相源在这里,库里**不加 CHECK** —— 加渠道就要 migration + PM 拍板,
 * 漏同步则写入直接报错(CLAUDE.md 记的 superseded 事故)。
 *
 *   meta            Facebook / Instagram 付费(即时表单 / CTWA / 站外落地页)
 *   google          Google Ads
 *   email           邮件营销(Mailchimp 等)
 *   web             客户官网表单(自然流量或 utm 未知)
 *   organic_social  自然社媒(能确证不是广告时才用)
 *   referral        转介绍 / 口碑
 *   manual          员工手工录入(线下认识的、电话打进来的)
 */
export const ATTRIBUTION_PLATFORMS = [
  'meta',
  'google',
  'email',
  'web',
  'organic_social',
  'referral',
  'manual',
] as const

export type AttributionPlatform = (typeof ATTRIBUTION_PLATFORMS)[number]

export interface Attribution {
  platform: AttributionPlatform | null
  campaignId: string | null
  adsetId: string | null
  adId: string | null
  adName: string | null
  /** ME 自己的素材指纹(reels_draft / 成片 id)。Meta 不给 creative id。 */
  creativeRef: string | null
}

export const EMPTY_ATTRIBUTION: Attribution = {
  platform: null,
  campaignId: null,
  adsetId: null,
  adId: null,
  adName: null,
  creativeRef: null,
}

/** 空串 / 全空白 / Meta 导出里的字面量 'null' 一律当没有。 */
function clean(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null
  return s
}

/** 不在白名单里的渠道名当作未知 —— 存一个拼错的 platform 会让后续聚合永远漏这批人。 */
export function normalisePlatform(raw: unknown): AttributionPlatform | null {
  const s = clean(raw)?.toLowerCase()
  if (!s) return null
  return (ATTRIBUTION_PLATFORMS as readonly string[]).includes(s)
    ? (s as AttributionPlatform)
    : null
}

/** 至少有一项能说明「他从哪来」。全空的归因不该占掉 first-touch 的位置。 */
export function isAttributed(a: Attribution): boolean {
  return Boolean(a.platform ?? a.campaignId ?? a.adsetId ?? a.adId ?? a.adName ?? a.creativeRef)
}

/**
 * 转成数据库列。contacts 和 contact_touchpoints 用**同一套** attr_* 列名,
 * 所以一个函数够两边用。
 */
export function attributionColumns(a: Attribution): Record<string, string | null> {
  return {
    attr_platform: a.platform,
    attr_campaign_id: a.campaignId,
    attr_adset_id: a.adsetId,
    attr_ad_id: a.adId,
    attr_ad_name: a.adName,
    attr_creative_ref: a.creativeRef,
  }
}

/**
 * contacts 上的 first-touch 补丁。空归因返回 {} —— 调用方原样展开即可,
 * 不会把已有的归因清成 null。
 *
 * first-touch 而不是 last-touch:地产买家从看到广告到成交要几周,中间被邮件、
 * 私信、电话碰无数次。last-touch 会把功劳全记给最后那封提醒邮件,真正带来人的
 * 那条视频反而是零 —— 学出来的结论是反的。
 */
export function firstTouchColumns(
  a: Attribution,
  attributedAt: string,
): Record<string, string | null> {
  if (!isAttributed(a)) return {}
  return { ...attributionColumns(a), first_attributed_at: attributedAt }
}

/**
 * Meta lead 导出的一行 → 归因。
 *
 * 传进来的是「列名 → 值」的映射(调用方自己按表头组装,因为 CSV 解析各处不同)。
 * 每一列都是**可能不存在**的:CTS 那份存量导出只有 ad_name,新导出才带 ad_id。
 * 缺就是 null,不假装。
 *
 * platform 列(Meta 用 'fb' / 'ig' / 'facebook' / 'instagram' 之类)不进白名单,
 * 因为对 ME 来说 FB 和 IG 都是同一个买量渠道 'meta';要区分位置的时候看 adset。
 * 只要这一行来自 Meta lead 导出,platform 就是 'meta' —— 这是调用方给的事实,
 * 不是从数据里猜的。
 */
export function attributionFromMetaLeadRow(row: {
  ad_id?: string | null
  ad_name?: string | null
  adset_id?: string | null
  campaign_id?: string | null
  /** ME 出片管道给的素材指纹。Meta 不给,只能由调用方传。 */
  creative_ref?: string | null
}): Attribution {
  return {
    platform: 'meta',
    campaignId: clean(row.campaign_id),
    adsetId: clean(row.adset_id),
    adId: clean(row.ad_id),
    adName: clean(row.ad_name),
    creativeRef: clean(row.creative_ref),
  }
}

/**
 * 官网表单的 utm 参数 → 归因。
 *
 * utm 只到 campaign 级(utm_campaign 是人手写的字符串,不是 Meta 的 campaign_id),
 * 所以 adId / adsetId 一律 NULL —— 把 utm_campaign 塞进 attr_campaign_id 是
 * 唯一诚实的做法,但要知道它跟 Meta 后台的 campaign_id 对不上,聚合时按
 * platform 分开看。
 */
export function attributionFromUtm(input: {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
}): Attribution {
  const source = clean(input.utm_source)?.toLowerCase() ?? null
  const medium = clean(input.utm_medium)?.toLowerCase() ?? null

  // 'facebook' / 'fb' / 'ig' / 'instagram' 都是 Meta 买量;没写 utm 就是自然进站。
  let platform: AttributionPlatform | null = 'web'
  if (source && ['facebook', 'fb', 'ig', 'instagram', 'meta'].includes(source)) platform = 'meta'
  else if (source && ['google', 'adwords', 'googleads'].includes(source)) platform = 'google'
  else if (medium === 'email' || source === 'mailchimp') platform = 'email'
  else if (medium === 'referral') platform = 'referral'

  return {
    platform,
    campaignId: clean(input.utm_campaign),
    adsetId: null,
    adId: null,
    adName: null,
    creativeRef: clean(input.utm_content),
  }
}
