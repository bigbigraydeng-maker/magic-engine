/**
 * Magic Engine 2.0 · GEO Measurement Storage —— 数据库行形状（Issue #875 / WP03）
 *
 * 🔴 **这个文件只描述「库里那一行长什么样」，不做任何事。**
 *    没有 supabase 客户端、没有查询、没有写入、没有落库函数。
 *    WP03 交付的是 migration + 行形状；真正的读写层是 WP04 的事
 *    （一个能插能读的 store 离「跑真实测量」只差一步，那超出本 WP 的边界）。
 *
 * 🔴 **手写，不是代码生成。** 全仓没有 `Database` 生成类型这套东西
 *    （`src/lib/supabase.ts` 的 createClient 不带泛型参数），
 *    每个域各自手写行接口再由调用方 cast —— `src/lib/kernel/types.ts` 就是这么写的。
 *    这里跟着来，不在本 WP 里引入一套新的 codegen。
 *
 * 🔴 列名与 `supabase/migrations/20260811000001_me2_geo_measurement_storage_v1.sql`
 *    逐字对应。**这份文件里的类型只从 WP02 冻结契约派生，不另立一套**：
 *    状态联合、未知理由码都直接 import 过来，让「库和契约悄悄分家」在编译期就过不去。
 */

import type { GeoBatch, GeoUnknownReason } from '@/lib/geo-measurement'

/**
 * 「不知道」的理由码列。
 * 对应库里的 `public.geo_unknown_reason` 域（三个值与 WP02 逐字一致）。
 */
export type GeoUnknownReasonColumn = GeoUnknownReason | null

/**
 * 批次状态。
 *
 * 🔴 直接从 WP02 的 `GeoBatch['status']` 派生，**刻意不重新写一遍字面量**：
 *    重写一遍就等于给「completed | partial | failed」开了第二个真相源，
 *    哪天契约加一个值而这里没跟上，编译器一声不吭。
 *    库里没有 `running` —— WP03 存的是测量真相，不是调度状态。
 */
export type GeoBatchStatusColumn = GeoBatch['status']

// ── geo_query_sets ───────────────────────────────────────────────────────────

/** `public.geo_query_sets` 的一行：版本化查询集。 */
export interface GeoQuerySetRow {
  readonly id: string
  readonly client_id: string
  readonly query_set_version: string
  /**
   * 非空即锁死。NULL → 时间戳 的转换在一行的一生里只允许发生一次，
   * 而且由触发器在首个批次落地时自己写上，不靠调用方自觉。
   */
  readonly locked_at: string | null
  readonly created_by: string
  readonly created_at: string
}

// ── geo_queries ──────────────────────────────────────────────────────────────

/**
 * `public.geo_queries` 的一行：集合里的单个问题。
 *
 * 🔴 `client_id` 是 NOT NULL 的，而且与父集合由复合外键绑成同租户 ——
 *    WP02 的 `GeoQuerySetQuery` 没有这个字段，因为契约描述的是「问题的形状」，
 *    而库还要回答「这是谁家的问题」。这是新增的存储关切，不是契约变更。
 */
export interface GeoQueryRow {
  readonly id: string
  readonly client_id: string
  readonly query_set_id: string
  readonly query_key: string
  readonly question_text: string
  readonly locale: string | null
  readonly locale_unknown_reason: GeoUnknownReasonColumn
  readonly market: string | null
  readonly market_unknown_reason: GeoUnknownReasonColumn
  readonly is_active: boolean
  readonly created_at: string
}

// ── geo_batches ──────────────────────────────────────────────────────────────

/**
 * `public.geo_batches` 的一行：一次采集执行。
 *
 * 🔴 行是在跑完（或跑挂）之后作为**终态**插入的，插入即不可变。
 *    没有「正在跑」这个状态：那属于执行层，不属于证据表。
 */
export interface GeoBatchRow {
  readonly id: string
  readonly client_id: string
  readonly query_set_id: string
  readonly started_at: string
  readonly completed_at: string | null
  readonly completed_at_unknown_reason: GeoUnknownReasonColumn
  readonly status: GeoBatchStatusColumn
  /** 形状对应 WP02 的 `GeoCoverageDescriptor`；库层用 CHECK 保证八个键齐全且类型对。 */
  readonly planned_coverage: Record<string, unknown>
  readonly actual_coverage: Record<string, unknown>
  readonly cost_usd: number | null
  readonly cost_usd_unknown_reason: GeoUnknownReasonColumn
  readonly triggered_by: string | null
  readonly triggered_by_unknown_reason: GeoUnknownReasonColumn
  readonly created_at: string
}

// ── geo_observations ─────────────────────────────────────────────────────────

/**
 * `public.geo_observations` 的一行：一个问题 × 一个引擎/模型 × 一次样本。
 *
 * 每一对 `<field>` / `<field>_unknown_reason` 恰好有一个非空 —— 库层用
 * `num_nonnulls(...) = 1` 强制。这样「不知道」永远是一个带理由的显式结论，
 * 而不是一个可以被下游读成「一样」或「零」的空值。
 */
export interface GeoObservationRow {
  readonly id: string
  readonly client_id: string
  readonly batch_id: string

  // 采集身份七项（GEO 契约 §3.1）。第 7 项 sample 按 §3.2 拆成三件事。
  readonly query_set_version: string | null
  readonly query_set_version_unknown_reason: GeoUnknownReasonColumn
  readonly query_key: string | null
  readonly query_key_unknown_reason: GeoUnknownReasonColumn
  readonly engine_family: string | null
  readonly engine_family_unknown_reason: GeoUnknownReasonColumn
  readonly model_version: string | null
  readonly model_version_unknown_reason: GeoUnknownReasonColumn
  readonly locale: string | null
  readonly locale_unknown_reason: GeoUnknownReasonColumn
  readonly market: string | null
  readonly market_unknown_reason: GeoUnknownReasonColumn
  readonly sample_planned_count: number | null
  readonly sample_planned_count_unknown_reason: GeoUnknownReasonColumn
  readonly sample_index: number | null
  readonly sample_index_unknown_reason: GeoUnknownReasonColumn
  readonly sampling_parameters: Record<string, unknown> | null
  readonly sampling_parameters_unknown_reason: GeoUnknownReasonColumn

  // 解释身份（§3.3）
  readonly parser_version: string | null
  readonly parser_version_unknown_reason: GeoUnknownReasonColumn
  readonly metric_rules_version: string | null
  readonly metric_rules_version_unknown_reason: GeoUnknownReasonColumn

  /** 质量信号与阈值，**不是身份维度**（§3.3 末段）。 */
  readonly confidence: number | null
  readonly confidence_unknown_reason: GeoUnknownReasonColumn

  readonly observed_at: string

  /** 失败也是观测：`outcome_ok = false` 的行必须落库，否则覆盖率永远算不准。 */
  readonly outcome_ok: boolean
  readonly error_code: string | null
  readonly error_message: string | null
  readonly error_message_unknown_reason: GeoUnknownReasonColumn

  /**
   * 存储层血缘：这一条是从哪条原始观测**重新解析**出来的。
   *
   * 🔴 正常采集恒为 `null`。重新解析走的是「新批次 + 新观测 + 新证据」，
   *    这一列指回原观测，原观测与原证据一个字都不动。
   *    WP02 的 `GeoObservation` 没有这个字段 —— 它描述的是一次观测的
   *    身份与结论，而「这条是从哪条重新解析来的」是存储侧的血缘关切。
   *    WP03 只让它**表达得出来**，不实现重新解析的执行器。
   */
  readonly source_observation_id: string | null

  readonly created_at: string
}

// ── geo_evidence ─────────────────────────────────────────────────────────────

/**
 * `public.geo_evidence` 的一行：原始响应逐字保留 + 引用来源。
 *
 * 🔴 与成功观测一一对应（库层 `UNIQUE (observation_id)`）。
 *    失败的观测**没有**证据行 —— 不是补一条空的假证据。
 */
export interface GeoEvidenceRow {
  readonly id: string
  readonly client_id: string
  readonly observation_id: string

  /** v1 就地存文本，不发明外部证据系统。 */
  readonly raw_response: string | null
  readonly raw_response_unknown_reason: GeoUnknownReasonColumn

  /**
   * 🔴 由数据库 `GENERATED ALWAYS AS ... STORED` 从证据自己的 id 推导，
   *    **写不进去**（写入方给它赋值会被 Postgres 拒绝）。
   *    原始响应记未知时它是 null，对应 WP02 的
   *    `rawResponseLocator: { known: false, reason }` —— 而不是一个指向空气的地址。
   */
  readonly raw_response_locator: string | null

  /**
   * 每个元素逐字保留 WP02 的 `GeoCitation`：
   * `{ url, domain, ownedDomain: {known,...}, ownedPage: {status,...} }`。
   *
   * 🔴 客户没有页面台账时，`ownedPage` 的诚实形态是
   *    `{ status: 'not_computable', reason: '...' }` —— 不是 0、不是 false、
   *    不是把字段省掉，更不是指向一张不存在的页面表的外键。
   */
  readonly citations: readonly unknown[]

  readonly created_at: string
}
