/**
 * 「把一条成交/咨询送到某个广告平台」的通用契约（Issue #1397）。
 *
 * 状态机（PR3 的 writeback-service）只认这个接口，不认识 Meta。
 * Meta 特有的东西 —— pixel id、7 天窗口、错误码、限流头 —— 全部关在
 * `src/lib/meta/capi/` 里。将来加 Google Ads Enhanced Conversions 时，
 * 新增一个实现即可，状态机一行不用改。
 *
 * 🔴 `send` 与 `accept` 刻意分开：`send` 只负责把请求发出去并把结果**原样带回**
 *    （包括异常，序列化成返回值而不是抛出）；判定成功失败是 `accept` 的事。
 *    分开是因为"请求发出去了但不知道结果"这个状态必须能被单独识别 ——
 *    Meta 的转化 API 没有去重也没有删除端点，盲目重发一次就是永久多记一笔。
 */

// 目前只有一个。Phase B 的客户名单上线时再加，别提前占位。
export type DestinationKind = 'meta_capi'

/** 发送结果的分类。状态机据此决定下一步。 */
export type SendVerdict =
  /** 平台确认收到。终态。 */
  | { kind: 'accepted'; receipt: Record<string, unknown>; }
  /** 事件太旧，平台不收。终态，不是错误。 */
  | { kind: 'expired'; detail: string }
  /** 授权问题（令牌失效、权限不足、pixel 不属于这个账户）。要人去重新授权。 */
  | { kind: 'auth'; detail: string }
  /** 可以重试：限流、平台 5xx。`retryAfterMs` 来自平台自己给的建议等待时间。 */
  | { kind: 'retry'; detail: string; retryAfterMs?: number }
  /** 请求本身错了（字段缺失、格式不对），重试多少次都一样。 */
  | { kind: 'permanent'; detail: string }
  /**
   * 🔴 **不知道平台收没收**：连接中断、超时、网关错误。
   *    绝不自动重发 —— 停下来交人工去平台后台核对。
   */
  | { kind: 'in_doubt'; detail: string }

/** `send` 的原样返回。异常也走这里，不抛出 —— 抛出的话调用方无法区分"没发出去"和"发了但没接住回应"。 */
export type RawSendResult =
  | { ok: true; status: number; headers: Record<string, string>; bodyText: string; latencyMs: number }
  | { ok: false; errorName: string; errorMessage: string; latencyMs: number }

/** 一条待发送的事实，已经是 destination 无关的形状。 */
export type OutcomeForSend = {
  id: string
  clientId: string
  contactId: string | null
  outcomeKind: 'purchase' | 'balance' | 'lead'
  customerEmail: string | null
  customerPhone: string | null
  customerFirst: string | null
  customerLast: string | null
  orderRef: string | null
  amountMinor: number | null
  currency: string | null
  occurredAt: string
  /**
   * 没有邮箱/电话时的第三种匹配键——Facebook Messenger 私信身份（不哈希发送，
   * 见 `src/lib/meta/capi/writer.ts`）。CTS 这类走结构化数据源的记录恒为 null。
   */
  pageScopedUserId: string | null
  /**
   * 这笔事实来自哪个渠道，由调用方（intake 层）按 `sourceKind` 决定，
   * `writer.ts` 只做字段拼装，不从 `pageScopedUserId` 是否存在反推——
   * 见 `src/lib/conversions/intake.ts::actionSourceForSourceKind` 的注释。
   */
  actionSource: 'email' | 'business_messaging'
}

/** 客户侧配置。谁去读库是调用方的事，这一层只拿现成的值。 */
export type ClientSendConfig = {
  clientId: string
  /** '64' / '61'，用于电话转国际格式。来自 clients.default_phone_country。 */
  defaultPhoneCountry: string | null
  /** Facebook 主页 id，配合 pageScopedUserId 一起发。来自 clients.facebook_page_id。 */
  facebookPageId: string | null
}

export interface DestinationWriter<TPayload = unknown> {
  readonly kind: DestinationKind

  /** 平台接受的事件最大年龄（天）。超过就别发了，发了也是整批被拒。 */
  readonly maxEventAgeDays: number

  /** 事实 → 平台要的请求体。纯函数，不发网络。 */
  build(outcome: OutcomeForSend, config: ClientSendConfig): TPayload

  /** 给人看的打码预览（试运行时给 PM 核对用）。绝不能返回明文或哈希。 */
  preview(outcome: OutcomeForSend, config: ClientSendConfig): Record<string, unknown>

  /** 只读探活：令牌还有效吗、目标账户是不是这个客户的。试运行时顺带跑。 */
  preflight(
    config: ClientSendConfig,
    opts: { fetcher: typeof fetch },
  ): Promise<{ ok: boolean; detail: Record<string, unknown> }>

  /** 发出去。异常序列化成返回值，不抛。 */
  send(
    payload: TPayload,
    config: ClientSendConfig,
    opts: { fetcher: typeof fetch },
  ): Promise<RawSendResult>

  /** 判定结果。纯函数，可以单独测每一种平台响应。 */
  accept(raw: RawSendResult): SendVerdict
}
