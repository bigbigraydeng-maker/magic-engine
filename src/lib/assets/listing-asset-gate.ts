/**
 * 一张素材能不能拿去给某套房做广告。
 *
 * PM 2026-08-05 的要求原话：「这些推广素材必须要严谨，不能随意更改」。
 * 翻成机器判据，是三条**独立**的检查，缺一条都不算严谨：
 *
 *   1. **是这套房的** —— 不是同一个客户名下另一套房的，也不是没主的
 *   2. **来源够硬** —— 只有「客户实拍（已确认）」和「FDE 自己拍的」算数。
 *      图库、AI 生成、以及**只是从上传链接进来还没人确认的**，都不算
 *   3. **有审计签名** —— 查得到是谁、什么时候确认的
 *
 * ── 为什么第 1 条不能松 ────────────────────────────────────────────────
 * 拿 A 房的画面去卖 B 房，在 NZ 属于误导性广告，风险落在中介的执照上，不在我们。
 * 「同一个客户的照片，看起来差不多，先用着」是最容易发生也最贵的那种偷懒。
 *
 * ── 为什么第 2、3 条要分开 ─────────────────────────────────────────────
 * 上传链接是可以无限转发的：客户完全可能从网上存一张图再传进来。所以
 * 「从客户上传口进来的」只证明**是客户主动提供的**，不证明**是这套房实拍的**。
 * 两件事分成两个字段、两道判据 —— 合成一条就等于用弱证据冒充强证据。
 *
 * 纯函数，不碰 DB。取数在调用方。
 */

import { canBackRealPrice, type AssetSource } from './provenance'

export type { AssetSource }

export interface AssetRow {
  id: string
  clientId: string
  /** 绑定的房源。null = 客户级素材，没绑到任何一套房。 */
  listingId: string | null
  source: AssetSource | string | null
  /** 谁签的字。null = 没人逐张确认过。 */
  verifiedBy: string | null
  verifiedAt: string | null
  archivedAt: string | null
  mimeType: string | null
  storageUrl: string
}

export type RejectReason =
  | 'archived'
  /** 这张素材根本不属于这个客户。 */
  | 'wrong_client'
  | 'wrong_listing'
  | 'no_listing'
  /** 来源本身就不行（AI 生成 / 图库 / 来路不明）—— **点多少下都救不回来**。 */
  | 'source_unusable'
  /** 客户传的，只差一个人看一眼签字 —— 这一条是可以补的。 */
  | 'not_verified'

export interface AssetVerdict {
  usable: boolean
  reasons: RejectReason[]
  /** 人话，直接能显示给 FDE 看。 */
  why: string
}

const REASON_TEXT: Readonly<Record<RejectReason, string>> = {
  archived: '这张已经归档了',
  wrong_client: '这张素材不属于这个客户 —— 用别人的照片卖房，是最严重的那种误导',
  wrong_listing: '这张属于另一套房 —— 拿别的房子的画面卖这套，是误导性广告',
  no_listing: '这张没绑到任何房源（多半是老链接传的），不知道拍的是哪套',
  source_unusable:
    '这张的来源不能当真实房源画面（AI 生成 / 图库 / 来路不明）—— 这个补不了，得换一张客户自己给的',
  not_verified: '还没有人逐张确认过它确实是这套房 —— 看过之后点一下就能过',
}

/**
 * 能不能当这套房的真实画面 —— **直接用仓库既有的判据，不在这里另写一份**。
 *
 * 2026-08-05 自查：我第一版在这里自己写了 `source === 'client_provided'`，
 * 比 `provenance.ts` 里既有的模型**松**。那份模型是对的：
 * 上传链接不过期、可无限转发，客户完全可能传网图或 AI 图进来，所以
 * `client_provided` 只证明「客户给的」，**不能给真实价格背书**；
 * 要用它必须先由人逐张确认升成 `client_verified`（那一步带审计记录）。
 *
 * 造第二套判据的后果不是重复代码，是**两套判据松紧不一样**，
 * 而严的那套会被松的那套架空。
 */

/**
 * 判一张素材能不能给 `listingId` 这套房用。
 *
 * 把**所有**不通过的理由一次列全，不是撞到第一条就返回：FDE 修完一条又被
 * 挡一次，第三次就绕开这道闸了。
 */
export function judgeAsset(
  asset: AssetRow,
  listingId: string,
  /**
   * 这套房属于哪个客户。给了就查素材是不是同一个客户的。
   *
   * 🔴 2026-08-05 魏征 P2-1：这个函数原来**一次都没读过 `asset.clientId`**，
   * 而文件头第一条判据白纸黑字写着「不是同一个客户名下另一套房的」。
   * 实测 `judgeAsset({clientId:'别的客户', listingId:'L1'}, 'L1')` → `usable: true`。
   * 测试里那条「同客户另一套房也不行」之所以绿，是因为 listingId 不同 ——
   * 它测的是第二个条件，**跨客户方向零覆盖**。
   *
   * 现在唯一守着跨客户的是两个路由的 `.eq('client_id', …)`，而 migration
   * 注释自己说过「应用层会被绕过，库层不会」—— 这一条恰恰只有应用层守着。
   * 所以判据本身也要能查，不能只靠取数时筛干净。
   */
  expectedClientId?: string,
): AssetVerdict {
  const reasons: RejectReason[] = []

  if (asset.archivedAt) reasons.push('archived')

  // 客户对不上是最重的一条，排在最前 —— 用别人的照片卖房比用错自己的房还严重。
  if (expectedClientId && asset.clientId !== expectedClientId) reasons.push('wrong_client')

  if (!asset.listingId) reasons.push('no_listing')
  else if (asset.listingId !== listingId) reasons.push('wrong_listing')

  // ── 来源分三档，**不能压成一个理由码** ────────────────────────────────
  // 2026-08-05 魏征抽查抓到的真 bug：原来「AI 生成的」和「客户传的还没签字」
  // 共用一个 `not_client_provided`。界面上那个「我看过，确认是这套房」按钮
  // 靠数理由条数决定出不出，于是 **AI 生成的图也长出了按钮**，点一下就洗成
  // 「客户实拍」。生产库 83 张素材全是 `unknown`，补挂那一刻每张都会长出来。
  //
  //   · 已经够硬（client_verified / fde_shot）→ 不报
  //   · 客户传的但没签字 → 只报 not_verified（**可以补**）
  //   · 其余（ai_generated / stock / unknown）→ 报 source_unusable（**补不了**）
  if (!canBackRealPrice(asset.source)) {
    if (asset.source === 'client_provided') reasons.push('not_verified')
    else reasons.push('source_unusable')
  } else if (!asset.verifiedBy || !asset.verifiedAt) {
    // 来源写着已确认，却查不到是谁、什么时候确认的 —— 签名不全等于没签。
    reasons.push('not_verified')
  }

  return {
    usable: reasons.length === 0,
    reasons,
    why: reasons.length === 0
      ? '可用：属于这套房、来源够硬、有人签过字。'
      : reasons.map((r) => REASON_TEXT[r]).join('；'),
  }
}

export interface PickResult {
  usable: AssetRow[]
  rejected: { asset: AssetRow; verdict: AssetVerdict }[]
  /** 一句话交代这套房现在能不能出广告。 */
  summary: string
}

/**
 * 从一堆素材里挑出这套房能用的。
 *
 * **被挡下的一律带着理由返回**，不是悄悄过滤掉。悄悄过滤的后果是
 * 「传了 10 张却一张都用不了」，而屏幕上只显示「没有素材」—— 人会以为是没传。
 */
export function pickUsableForListing(
  assets: readonly AssetRow[],
  listingId: string,
  expectedClientId?: string,
): PickResult {
  const usable: AssetRow[] = []
  const rejected: { asset: AssetRow; verdict: AssetVerdict }[] = []

  for (const a of assets) {
    const v = judgeAsset(a, listingId, expectedClientId)
    if (v.usable) usable.push(a)
    else rejected.push({ asset: a, verdict: v })
  }

  let summary: string
  if (usable.length > 0) {
    summary = `这套房有 ${usable.length} 张可用素材` +
      (rejected.length > 0 ? `，另有 ${rejected.length} 张不能用（理由逐张列出）。` : '。')
  } else if (rejected.length > 0) {
    // 「有素材但都不能用」和「一张都没传」是完全不同的两件事，必须分开说。
    summary = `这套房有 ${rejected.length} 张素材，但一张都不能用于投放 —— 不是没传，是没过关。`
  } else {
    summary = '这套房还没有任何素材。'
  }

  return { usable, rejected, summary }
}

/** 图片 / 视频 —— 建广告时要按类型分开取。 */
export function isVideoAsset(a: AssetRow): boolean {
  return (a.mimeType ?? '').startsWith('video/')
}
