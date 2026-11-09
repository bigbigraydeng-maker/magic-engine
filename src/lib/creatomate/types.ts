// Creatomate（对外化名：Video Studio）L3 Connector 共享类型。
// Spec：docs/specs/2026-09-09-creatomate-connector-spec-v1.md §3/§4.3

/** 官方状态机（2026-09-09 实测抓取 creatomate.com/llms/quick-start.md）。 */
export type CreatomateRenderStatus =
  | 'planned'
  | 'waiting'
  | 'transcribing'
  | 'rendering'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export const CREATOMATE_TERMINAL_STATUSES: readonly CreatomateRenderStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
]

export function isTerminalStatus(status: CreatomateRenderStatus): boolean {
  return CREATOMATE_TERMINAL_STATUSES.includes(status)
}

/** POST /v2/renders 请求体。modifications 的 key 是模板里的元素名，value 是要填的内容。 */
export interface CreateRenderParams {
  templateId: string
  modifications: Record<string, string>
  webhookUrl?: string
}

/** GET /v2/renders/{id} 返回的 render 对象（官方文档未列全字段，只声明确认过的）。 */
export interface CreatomateRender {
  id: string
  status: CreatomateRenderStatus
  url?: string
  errorMessage?: string
}

/** 400/401/402/404 的错误响应体（官方文档确认字段）。 */
export interface CreatomateErrorBody {
  hint: string
  documentation?: string
}

/** client.ts 统一抛出的错误类型，携带足够信息让调用方按状态码分支处理（spec §4.4 失败分类表）。 */
export class CreatomateApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly hint?: string,
  ) {
    super(message)
    this.name = 'CreatomateApiError'
  }
}

/** 一个模板"镜头槽位"对应到哪几个 Creatomate 元素名。数组下标 = PreparedScene.index
 *  的顺序（模板槽位数量在编辑器里是固定的，PM 设计模板时定好，不是运行时动态的）。 */
export interface SceneSlotFieldMap {
  visual: string
  caption?: string
  voice?: string
}

/** 模板契约（clients.factory_config.render.creatomate，spec §4.7）。连接器不认识任何具体客户的
 *  模板结构，只按这份声明取值/校验——换客户只是换一份这个对象，不改连接器代码（红线4）。 */
export interface CreatomateTemplateContract {
  templateId: string
  /** 镜头槽位映射，见 SceneSlotFieldMap。 */
  sceneFieldMap: SceneSlotFieldMap[]
  /** 模板的输出画布（credits 估算用，spec §7）。不填按 1080×1920@30fps 估（spec 全篇示例口径）。 */
  outputWidth?: number
  outputHeight?: number
  outputFrameRate?: number
  /**
   * 固定图层覆盖(2026-09-13 新增)——模板里那些不随镜头轮换、平时"锁定"的品牌元素
   * (如 Watermark/EndLogo/EndBG，见 spec §1 已验证的元素清单)：Creatomate 本身没有
   * "锁定"这个概念，只是这些元素不在逐镜头循环里，所以平时没人去改它们；只要知道
   * 真实元素名，一样能用 modifications 直接指定内容。每个客户品牌资产不同，这里
   * 按元素名→URL 的键值对存，跟 sceneFieldMap 一样是纯客户配置，不进共享代码。
   */
  staticOverrides?: Record<string, string>
  /**
   * 这条视频专属、真的会随视频变化的文字元素名清单(2026-09-13 新增，如 EndCard 的
   * 团名/路线/天数价格/出发日期)——跟 staticOverrides 刻意分开：staticOverrides 是
   * "客户级、所有视频共用一份值"，这里声明的每个元素名，每条视频必须各自提供一份
   * 不同的值(读自 content_posts.generation_context_snapshot.endcard，见
   * factory-creatomate-render.ts::resolvePostEndcardOverrides)。只声明"要哪些
   * 元素名"，不声明值——值是每条视频自己的内容，不是客户级配置（红线2：不把单
   * 视频事实塞进共享/客户级配置）。声明了却漏填 = 直接拦渲染，绝不允许静默套用
   * 模板作者写的示例内容当真发布（魏征复审 ①②）。 */
  requiredPostFields?: string[]
  /**
   * 这条视频"该用哪个真实产品/团"的事实字典(2026-09-13 新增，子牙+魏征设计复审要求)。
   * key 是客户自己起的档位名(如 "best_of_china"/"family_edition")，value 是这个档位
   * 下每个真实事实的键值对(如 {tour, route, price_line, departure})，具体有哪些 key
   * 由 postFieldSources 决定，客户自己定，不在这里写死形状。
   *
   * 为什么不能只有一份客户级事实：CTS 同时有多个团/多个出发城市变体在打广告(如
   * 圣诞团奥克兰16天5城/基督城15天4城，两个都对，互不覆盖)，只存一份会把 A 团的
   * 价格套到 B 团的视频上——魏征复审②指出这比模板写死的占位文字更危险，因为看起来
   * 像是"这条视频专属核实过的数字"，其实可能张冠李戴。哪条视频用哪个档位，见
   * content_posts.generation_context_snapshot.offer_key。
   */
  offers?: Record<string, Record<string, string>>
  /**
   * requiredPostFields 里每个 Creatomate 元素名，该去 offers[offerKey] 里取哪个 key
   * 的值(如 {"EndTour":"tour","EndMeta":"price_line"})——单纯字段名映射，不经过任何
   * LLM改写/组合(子牙复审①：这几个字段是纯粹的真实数字/事实，交给 LLM 写只会引入
   * 幻觉或"看似搬运实为改写"的风险，用确定性映射零成本、零幻觉风险)。
   */
  postFieldSources?: Record<string, string>
}
