/**
 * clients.factory_config 的投影与合并(纯函数,零 DB)。
 *
 * 抽出来的原因:合并语义是这块最容易出事的地方 —— factory_config 是 jsonb,里面存着
 * UI 不认识的 key(如 factory_goal_note)。整体替换会把它们悄悄抹掉,而这种丢失不会
 * 报错、只会在某天发现某个客户的配置莫名其妙少了一半。路由层放不了测试(route.ts
 * 只允许导出 HTTP 方法),所以逻辑放这里,由 /api/clients/[id]/factory-config 调用。
 *
 * 各字段的真实消费方:
 *   publish_target             → publish/publish-worker.ts resolveTarget()
 *   factory_goal_id            → evaluate.ts → strategist.ts pickFactoryGoal()
 *   verified_offer             → evaluate.ts(B4 客户级持久真促销)
 *   verified_cta               → evaluate.ts → recipe brief → worker 端卡(客户级已验证联系方式)
 *   allow_b_track_landmark_ads → evaluate.ts + complete-work-order.ts(护栏 6 豁免)
 *   creative_recipe            → evaluate.ts(P21.J.M2 版本化 winner recipe:合同 5469105522 §1
 *                                          单图 · 推近 + 拉远 12 秒,配了 = 走强约束 recipe 路径)
 */

import {
  parseFactoryRecipeConfig,
  WINNER_RECIPE_IDS,
  type RecipeCtaFacts,
  type WinnerRecipeId,
} from './recipe'
import type { CreatomateTemplateContract } from '@/lib/creatomate/types'

/** 只有 facebook 有真实 adapter;publer 在 publish-worker.ts 仍是注释状态。
 *  放开别的平台 = 配了个必然 markFailed('no_adapter') 的目标。 */
export const SUPPORTED_PLATFORMS = ['facebook'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_ID_RE = /^\d{5,32}$/
const MAX_TEXT = 120
/**
 * 必须**严格小于** worker 的段时长地板 1.0s(worker.mjs assemble 里那个 Math.max(dur, 1.0))。
 * 转场 ≥ 段时长时,该段偏移不前进、整段被过渡吞掉 —— 这个 bug 修过一次,别用配置项放回来。
 */
const MAX_XFADE_SEC = 0.9

/**
 * 出片风格。字段名**必须**跟装配脚本真正读的键一致 —— worker.mjs 的 assemble() 只认
 * music / music_mood / look / caption_mode / xfade / endcard_panel 这几个。
 *
 * ⚠️ 真实教训:CTS 的 brandkit/factory_profile.json 里写的是 `caption_style` 和 `vo`,
 * 而 worker 读的是 `caption_mode`、根本不读 `vo` —— 那两条风格设置从来没生效过。
 * 所以这里只放脚本真吃的键,不放看着合理但没人读的字段。
 */
export interface CreativeProfile {
  /** 曲名(相对 _shared/music)或绝对路径。worker 找不到文件时按 music_mood 回退 */
  music: string | null
  /** 按情绪自动选曲(如 epic_cinematic / peaceful_serene),music 缺失时生效 */
  music_mood: string | null
  /** 调色(如 golden_hour) */
  look: string | null
  /** 字幕模式(注意是 caption_mode,不是 caption_style) */
  caption_mode: string | null
  /** 转场时长(秒) */
  xfade: number | null
  /** 结尾卡是否套白底面板。白字 logo(如 Oztop)要设 false,否则字消失 */
  endcard_panel: boolean | null
}

export const EMPTY_CREATIVE_PROFILE: CreativeProfile = {
  music: null, music_mood: null, look: null, caption_mode: null, xfade: null, endcard_panel: null,
}

export interface FactoryConfigView {
  publish_target: { platform: string; page_id: string } | null
  factory_goal_id: string | null
  verified_offer: { price_from: string; offer_expiry: string } | null
  /** 端卡客户事实；phone/url/departure 必须同时存在，price 可选。 */
  verified_cta: RecipeCtaFacts | null
  allow_b_track_landmark_ads: boolean
  /** 自动排产开关(factory-order-scheduler 读)。默认关 —— 自动下单 = 自动花钱。 */
  auto_order_enabled: boolean
  /** 出片风格。建单时注入工单 brief,worker 优先用它、本地 factory_profile.json 兜底。 */
  creative_profile: CreativeProfile
  /**
   * 版本化 winner recipe(合同 5469105522 §1)。null = 走 legacy 分镜路径,配了 = 服务端
   * planner 把 brief 改成 recipe 形状(2×5s I2V 同图不同镜),worker 走强约束 fail-closed。
   * 只允许 WINNER_RECIPE_IDS 白名单里的 id;version 显式且与已注册 recipe 不一致 → 拒。
   */
  creative_recipe: { id: WinnerRecipeId; version: number } | null
  /**
   * 出片引擎（spec docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.1/§9）。
   * 默认 ffmpeg（不配 = 维持现状，出片仍需人工处理）。voice_id/avatar_image_url 是
   * lecture-render.ts/render-pipeline.ts 的既有字段，这个投影不认识它们、也不会碰它们——
   * mergeFactoryConfig 对 render 做的是子对象合并，不是整体替换，见下方合并逻辑。
   */
  render: { engine: 'ffmpeg' | 'creatomate'; creatomate: CreatomateTemplateContract | null } | null
}

export type MergeResult =
  | { ok: true; config: Record<string, unknown>; goalIdToVerify: string | null }
  | { ok: false; error: string }

function asTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, MAX_TEXT) : null
}

export function parseVerifiedCta(raw: unknown): RecipeCtaFacts | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const cta = raw as Record<string, unknown>
  const phone = asTrimmed(cta.phone)
  const url = asTrimmed(cta.url)
  const departure = asTrimmed(cta.departure)
  if (!phone || !url || !departure) return null
  const price = asTrimmed(cta.price)
  return { phone, url, departure, ...(price ? { price } : {}) }
}

/** 库里的 jsonb → UI 认识的形状。脏数据一律降级成 null,不把半个对象抛给前端。 */
export function projectFactoryConfig(raw: unknown): FactoryConfigView {
  const cfg = (raw ?? {}) as Record<string, unknown>

  const pt = (cfg.publish_target ?? null) as Record<string, unknown> | null
  const platform = asTrimmed(pt?.platform)
  const pageId = asTrimmed(pt?.page_id)

  const vo = (cfg.verified_offer ?? null) as Record<string, unknown> | null
  const priceFrom = asTrimmed(vo?.price_from)

  return {
    // 只填一半的发布目标等于没配(resolveTarget 会 markFailed),投影成 null 让 UI 显示「缺发布目标」
    publish_target: platform && pageId ? { platform, page_id: pageId } : null,
    factory_goal_id: typeof cfg.factory_goal_id === 'string' ? cfg.factory_goal_id : null,
    verified_offer: priceFrom
      ? { price_from: priceFrom, offer_expiry: asTrimmed(vo?.offer_expiry) ?? '' }
      : null,
    verified_cta: parseVerifiedCta(cfg.verified_cta),
    allow_b_track_landmark_ads: cfg.allow_b_track_landmark_ads === true,
    auto_order_enabled: cfg.auto_order_enabled === true,
    creative_profile: projectCreativeProfile(cfg.creative_profile),
    // 投影不 throw:非法 recipe 一律降级 null,不把半个对象抛给前端。合法性由 mergeFactoryConfig 强校验。
    creative_recipe: (() => {
      try {
        return parseFactoryRecipeConfig(cfg.creative_recipe)
      } catch {
        return null
      }
    })(),
    render: projectRender(cfg.render),
  }
}

/** 校验 Record<string,string>——脏数据(非对象/含非字符串值)一律拒绝,不半收半弃。 */
function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
}

/** 校验 string[]，同上原则：脏数据一律拒绝。 */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** 校验 Record<string, Record<string,string>>（offers 的形状），同上原则：脏数据一律拒绝。 */
function isNestedStringRecord(v: unknown): v is Record<string, Record<string, string>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every((x) => isStringRecord(x))
}

function projectRender(raw: unknown): FactoryConfigView['render'] {
  const r = (raw ?? null) as Record<string, unknown> | null
  if (!r) return null
  const engine = r.engine === 'creatomate' ? 'creatomate' : 'ffmpeg'
  const c = (r.creatomate ?? null) as Record<string, unknown> | null
  const creatomate =
    c && typeof c.template_id === 'string' && Array.isArray(c.scene_field_map)
      ? {
          templateId: c.template_id,
          sceneFieldMap: c.scene_field_map as CreatomateTemplateContract['sceneFieldMap'],
          outputWidth: typeof c.output_width === 'number' ? c.output_width : undefined,
          outputHeight: typeof c.output_height === 'number' ? c.output_height : undefined,
          outputFrameRate: typeof c.output_frame_rate === 'number' ? c.output_frame_rate : undefined,
          staticOverrides: isStringRecord(c.static_overrides) ? c.static_overrides : undefined,
          requiredPostFields: isStringArray(c.required_post_fields) ? c.required_post_fields : undefined,
          offers: isNestedStringRecord(c.offers) ? c.offers : undefined,
          postFieldSources: isStringRecord(c.post_field_sources) ? c.post_field_sources : undefined,
        }
      : null
  return { engine, creatomate }
}

/** 风格投影:脏数据一律降级 null,不把半个对象抛给前端或下发给装配脚本。 */
export function projectCreativeProfile(raw: unknown): CreativeProfile {
  const p = (raw ?? {}) as Record<string, unknown>
  const xfade = typeof p.xfade === 'number' && Number.isFinite(p.xfade) ? p.xfade : null
  return {
    music: asTrimmed(p.music),
    music_mood: asTrimmed(p.music_mood),
    look: asTrimmed(p.look),
    caption_mode: asTrimmed(p.caption_mode),
    xfade: xfade !== null && xfade >= 0 && xfade <= MAX_XFADE_SEC ? xfade : null,
    endcard_panel: typeof p.endcard_panel === 'boolean' ? p.endcard_panel : null,
  }
}

/** 只保留非空键:下发给装配脚本时,空值意味着"用引擎默认",不能塞 null 进去。 */
export function compactCreativeProfile(p: CreativeProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) if (v !== null) out[k] = v
  return out
}

/**
 * 把 PATCH body 合并进现有配置。**只动 body 里出现过的 key**,其余原样保留。
 * Goal 归属校验需要查库,这里只做格式校验并把待验 id 回传给路由层。
 */
export function mergeFactoryConfig(
  existing: unknown,
  body: Record<string, unknown>,
): MergeResult {
  const next = { ...((existing ?? {}) as Record<string, unknown>) }
  let goalIdToVerify: string | null = null

  if ('publish_target' in body) {
    const pt = body.publish_target as Record<string, unknown> | null
    if (pt === null) {
      delete next.publish_target
    } else {
      const platform = asTrimmed(pt?.platform)
      const pageId = asTrimmed(pt?.page_id)
      if (!platform || !pageId) {
        return { ok: false, error: '发布目标要同时填平台和主页 ID,只填一半会让发布任务必然失败' }
      }
      if (!(SUPPORTED_PLATFORMS as readonly string[]).includes(platform)) {
        return { ok: false, error: `暂不支持平台「${platform}」,目前只有 facebook 有可用的发布程序` }
      }
      if (!PAGE_ID_RE.test(pageId)) {
        return { ok: false, error: '主页 ID 必须是纯数字(不是主页网址,也不是广告账户 ID)' }
      }
      next.publish_target = { platform, page_id: pageId }
    }
  }

  if ('factory_goal_id' in body) {
    const goalId = asTrimmed(body.factory_goal_id)
    if (goalId === null) {
      delete next.factory_goal_id
    } else {
      if (!UUID_RE.test(goalId)) return { ok: false, error: 'Goal ID 格式不对' }
      next.factory_goal_id = goalId
      goalIdToVerify = goalId // 归属 + 活跃状态由路由层查库确认
    }
  }

  if ('verified_offer' in body) {
    const vo = body.verified_offer as Record<string, unknown> | null
    const priceFrom = asTrimmed(vo?.price_from)
    if (vo === null || !priceFrom) {
      // 促销下架就真删掉:留着会继续被写进文案钩子
      delete next.verified_offer
    } else {
      next.verified_offer = { price_from: priceFrom, offer_expiry: asTrimmed(vo?.offer_expiry) ?? '' }
    }
  }

  if ('verified_cta' in body) {
    if (body.verified_cta === null) {
      delete next.verified_cta
    } else {
      const parsed = parseVerifiedCta(body.verified_cta)
      if (!parsed) {
        return { ok: false, error: '端卡信息要同时填写电话、网址和出发时间；价格可以留空' }
      }
      next.verified_cta = parsed
    }
  }

  if ('allow_b_track_landmark_ads' in body) {
    if (typeof body.allow_b_track_landmark_ads !== 'boolean') {
      return { ok: false, error: 'allow_b_track_landmark_ads 必须是 true/false' }
    }
    next.allow_b_track_landmark_ads = body.allow_b_track_landmark_ads
  }

  if ('creative_profile' in body) {
    const raw = body.creative_profile as Record<string, unknown> | null
    if (raw === null) {
      delete next.creative_profile
    } else {
      // xfade 单独硬校验:传字符串或超范围会让装配脚本行为诡异(段被过渡吞掉),
      // 静默降级成 null 更糟 —— 用户以为设了 1.5 秒,实际是引擎默认。宁可报错。
      if (raw.xfade != null) {
        const x = Number(raw.xfade)
        if (typeof raw.xfade !== 'number' || !Number.isFinite(x) || x < 0 || x > MAX_XFADE_SEC) {
          return { ok: false, error: `转场时长要填 0 到 ${MAX_XFADE_SEC} 之间的数字` }
        }
      }
      if (raw.endcard_panel != null && typeof raw.endcard_panel !== 'boolean') {
        return { ok: false, error: 'endcard_panel 必须是 true/false' }
      }
      const cleaned = compactCreativeProfile(projectCreativeProfile(raw))
      if (Object.keys(cleaned).length === 0) delete next.creative_profile
      else next.creative_profile = cleaned
    }
  }

  if ('auto_order_enabled' in body) {
    if (typeof body.auto_order_enabled !== 'boolean') {
      return { ok: false, error: 'auto_order_enabled 必须是 true/false' }
    }
    // 开自动排产必须先配发布目标:否则片子每天照做照花钱,做完却无处可发,
    // 只会在「已通过·待发布」堆着 —— 白烧。
    if (body.auto_order_enabled === true && !next.publish_target) {
      return { ok: false, error: '开自动排产前要先配好发布主页,否则片子做出来无处可发,只会白花钱' }
    }
    next.auto_order_enabled = body.auto_order_enabled
  }

  if ('creative_recipe' in body) {
    const raw = body.creative_recipe
    if (raw === null) {
      delete next.creative_recipe
    } else {
      try {
        const parsed = parseFactoryRecipeConfig(raw)
        if (parsed === null) delete next.creative_recipe
        else next.creative_recipe = parsed
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  }

  if ('render' in body) {
    const raw = body.render as Record<string, unknown> | null
    if (raw === null) {
      delete next.render
    } else {
      // 子对象合并，不是整体替换：existing.render 里的 voice_id/avatar_image_url
      // （lecture-render.ts/render-pipeline.ts 用，这个表单不认识、也不该动）原样保留。
      const existingRender = (next.render ?? {}) as Record<string, unknown>
      const merged: Record<string, unknown> = { ...existingRender }

      // 🔴 只在 body 真的带了 engine 时才覆写——第二轮复审指出，PATCH 只带
      //    { render: { creatomate: {...} } } 而不带 engine 时，无条件覆写会把已经是
      //    creatomate 的客户静默降级回 ffmpeg（"确认"从此不出片也不报错，同类事故
      //    Meta targeting 局部传值清空兄弟字段那次已经吃过一次教训）。
      if ('engine' in raw) {
        merged.engine = raw.engine === 'creatomate' ? 'creatomate' : 'ffmpeg'
      }

      if ('creatomate' in raw) {
        const c = raw.creatomate as Record<string, unknown> | null
        if (c === null) {
          delete merged.creatomate
        } else {
          const templateId = asTrimmed(c.template_id)
          const sceneFieldMap = c.scene_field_map
          if (!templateId) return { ok: false, error: 'Creatomate 模板 ID 不能为空' }
          if (!Array.isArray(sceneFieldMap) || sceneFieldMap.length === 0) {
            return { ok: false, error: 'Creatomate 镜头槽位映射不能为空（至少配一个镜头对应的元素名）' }
          }
          for (const slot of sceneFieldMap) {
            if (!slot || typeof (slot as Record<string, unknown>).visual !== 'string') {
              return { ok: false, error: '每个镜头槽位至少要填 visual（画面元素名）' }
            }
          }
          const outputWidth = c.output_width != null ? Number(c.output_width) : undefined
          const outputHeight = c.output_height != null ? Number(c.output_height) : undefined
          const outputFrameRate = c.output_frame_rate != null ? Number(c.output_frame_rate) : undefined

          // 🔴 2026-09-13 修复：这四个字段此前完全没接进 PATCH 合并——即便调用方传了
          // static_overrides/required_post_fields/offers/post_field_sources，这里重新拼
          // merged.creatomate 时全部丢弃，写库前悄悄没了（复审 ad68ebde 发现：资料包管理
          // UI 加了也白加，因为保存路径根本不认这几个字段）。跟 `render` 顶层同一个原则——
          // 每个字段各自判断"这次 PATCH 有没有带"：带了就校验+覆盖（`null` = 清空），没带
          // 就沿用已存的值，不能因为这次 PATCH 只想改 template_id 就把其它字段清空。
          const existingCreatomate = (existingRender.creatomate ?? {}) as Record<string, unknown>

          let staticOverrides = existingCreatomate.static_overrides
          if ('static_overrides' in c) {
            if (c.static_overrides === null) staticOverrides = undefined
            else if (isStringRecord(c.static_overrides)) staticOverrides = c.static_overrides
            else return { ok: false, error: 'static_overrides 必须是元素名→文字/链接的键值对（值只能是字符串）' }
          }

          let requiredPostFields = existingCreatomate.required_post_fields
          if ('required_post_fields' in c) {
            if (c.required_post_fields === null) requiredPostFields = undefined
            else if (isStringArray(c.required_post_fields)) requiredPostFields = c.required_post_fields
            else return { ok: false, error: 'required_post_fields 必须是元素名组成的字符串数组' }
          }

          let offers = existingCreatomate.offers
          if ('offers' in c) {
            if (c.offers === null) offers = undefined
            else if (isNestedStringRecord(c.offers)) offers = c.offers
            else return { ok: false, error: 'offers 必须是「档位名 → {字段名: 字符串值}」这样的两层键值对' }
          }

          let postFieldSources = existingCreatomate.post_field_sources
          if ('post_field_sources' in c) {
            if (c.post_field_sources === null) postFieldSources = undefined
            else if (isStringRecord(c.post_field_sources)) postFieldSources = c.post_field_sources
            else return { ok: false, error: 'post_field_sources 必须是元素名→档位字段名的键值对（值只能是字符串）' }
          }

          merged.creatomate = {
            template_id: templateId,
            scene_field_map: sceneFieldMap,
            ...(outputWidth ? { output_width: outputWidth } : {}),
            ...(outputHeight ? { output_height: outputHeight } : {}),
            ...(outputFrameRate ? { output_frame_rate: outputFrameRate } : {}),
            ...(staticOverrides ? { static_overrides: staticOverrides } : {}),
            ...(requiredPostFields ? { required_post_fields: requiredPostFields } : {}),
            ...(offers ? { offers } : {}),
            ...(postFieldSources ? { post_field_sources: postFieldSources } : {}),
          }
        }
      }
      next.render = merged
    }
  }

  return { ok: true, config: next, goalIdToVerify }
}

/** 暴露给 UI / API 层的 recipe 白名单。改配方等于改产品,加/改必先走 tier-gate。 */
export { WINNER_RECIPE_IDS } from './recipe'
