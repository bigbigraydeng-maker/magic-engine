// clients.factory_config 投影/合并测试。
//
// 重点防两件事:
// ① 合并把 UI 不认识的 key 抹掉(factory_goal_note 这类),这种丢失静默无声、事后极难查。
// ② 把「只填一半」「填错类型」的发布目标存进去 —— publish-worker 会 markFailed,
//    但那是几天后跑 cron 时才发现,配的时候就该拦住。

import { describe, expect, it } from 'vitest'
import {
  EMPTY_CREATIVE_PROFILE,
  compactCreativeProfile,
  mergeFactoryConfig,
  projectCreativeProfile,
  projectFactoryConfig,
} from './client-config'

const CTS_LIKE = {
  factory_goal_id: 'ef92d878-c283-4a1c-be7d-1462c8c4a83c',
  factory_goal_note: 'CTS social 片服务品牌搜索量提升(诸葛亮圈定 B0)',
  allow_b_track_landmark_ads: true,
}

describe('projectFactoryConfig — 投影', () => {
  it('空配置 → 全 null / false,不抛', () => {
    expect(projectFactoryConfig({})).toEqual({
      publish_target: null, factory_goal_id: null, verified_offer: null, verified_cta: null,
      allow_b_track_landmark_ads: false, auto_order_enabled: false,
      creative_profile: EMPTY_CREATIVE_PROFILE,
      creative_recipe: null,
      render: null,
    })
    expect(projectFactoryConfig(null).publish_target).toBeNull()
    expect(projectFactoryConfig(null).creative_recipe).toBeNull()
    expect(projectFactoryConfig(null).render).toBeNull()
  })

  it('render:配了 engine=creatomate 但模板槽位不合法 → creatomate 投影为 null（不把半个对象丢给前端）', () => {
    expect(
      projectFactoryConfig({ render: { engine: 'creatomate', creatomate: { template_id: 'tmpl-1' } } }).render,
    ).toEqual({ engine: 'creatomate', creatomate: null })
  })

  it('render:合法配置原样投影，camelCase 供内存使用', () => {
    const r = projectFactoryConfig({
      render: {
        engine: 'creatomate',
        creatomate: { template_id: 'tmpl-1', scene_field_map: [{ visual: 'Video-1' }], output_width: 1080, output_height: 1920, output_frame_rate: 30 },
      },
    }).render
    expect(r).toEqual({
      engine: 'creatomate',
      creatomate: { templateId: 'tmpl-1', sceneFieldMap: [{ visual: 'Video-1' }], outputWidth: 1080, outputHeight: 1920, outputFrameRate: 30 },
    })
  })

  it('render.creatomate.required_post_fields（2026-09-13 新增）：合法 string[] 原样投影为 requiredPostFields', () => {
    const r = projectFactoryConfig({
      render: {
        engine: 'creatomate',
        creatomate: { template_id: 'tmpl-1', scene_field_map: [{ visual: 'Video-1' }], required_post_fields: ['EndTour', 'EndDate'] },
      },
    }).render as { creatomate: { requiredPostFields?: string[] } | null } | null
    expect(r?.creatomate?.requiredPostFields).toEqual(['EndTour', 'EndDate'])
  })

  it('required_post_fields 混了非字符串（脏数据）→ 投影为 undefined，不半收半弃', () => {
    const r = projectFactoryConfig({
      render: {
        engine: 'creatomate',
        creatomate: { template_id: 'tmpl-1', scene_field_map: [{ visual: 'Video-1' }], required_post_fields: ['EndTour', 123] },
      },
    }).render as { creatomate: { requiredPostFields?: string[] } | null } | null
    expect(r?.creatomate?.requiredPostFields).toBeUndefined()
  })

  it('render.creatomate.offers/post_field_sources（2026-09-13 新增）：合法嵌套 Record 原样投影', () => {
    const r = projectFactoryConfig({
      render: {
        engine: 'creatomate',
        creatomate: {
          template_id: 'tmpl-1',
          scene_field_map: [{ visual: 'Video-1' }],
          offers: { default: { tour: 'Best of China', price_line: 'From NZD $4,080 pp' } },
          post_field_sources: { EndTour: 'tour', EndMeta: 'price_line' },
        },
      },
    }).render as {
      creatomate: { offers?: Record<string, Record<string, string>>; postFieldSources?: Record<string, string> } | null
    } | null
    expect(r?.creatomate?.offers).toEqual({ default: { tour: 'Best of China', price_line: 'From NZD $4,080 pp' } })
    expect(r?.creatomate?.postFieldSources).toEqual({ EndTour: 'tour', EndMeta: 'price_line' })
  })

  it('offers 某个档位混了非字符串值（脏数据）→ 整个 offers 投影为 undefined，不半收半弃', () => {
    const r = projectFactoryConfig({
      render: {
        engine: 'creatomate',
        creatomate: {
          template_id: 'tmpl-1',
          scene_field_map: [{ visual: 'Video-1' }],
          offers: { default: { tour: 'Best of China', price_line: 4080 } },
        },
      },
    }).render as { creatomate: { offers?: unknown } | null } | null
    expect(r?.creatomate?.offers).toBeUndefined()
  })

  it('🔴 只填一半的发布目标 → 投影成 null(等于没配,UI 才会提示「缺发布目标」)', () => {
    expect(projectFactoryConfig({ publish_target: { platform: 'facebook' } }).publish_target).toBeNull()
    expect(projectFactoryConfig({ publish_target: { page_id: '123456' } }).publish_target).toBeNull()
  })

  it('豁免开关严格取 true,truthy 值不算', () => {
    expect(projectFactoryConfig({ allow_b_track_landmark_ads: 'yes' }).allow_b_track_landmark_ads).toBe(false)
    expect(projectFactoryConfig({ allow_b_track_landmark_ads: 1 }).allow_b_track_landmark_ads).toBe(false)
    expect(projectFactoryConfig({ allow_b_track_landmark_ads: true }).allow_b_track_landmark_ads).toBe(true)
  })

  it('促销只有截止日没有价格 → null(没价格的促销钩子没意义)', () => {
    expect(projectFactoryConfig({ verified_offer: { offer_expiry: '31 July' } }).verified_offer).toBeNull()
  })

  it('端卡事实必须 phone/url/departure 齐全；price 可选', () => {
    const complete = {
      phone: '09 123 4567', url: 'example.com', departure: 'October 2026', price: 'From $1,999',
    }
    expect(projectFactoryConfig({ verified_cta: complete }).verified_cta).toEqual(complete)
    expect(projectFactoryConfig({ verified_cta: { phone: '09 123 4567' } }).verified_cta).toBeNull()
  })
})

describe('verified_cta — 客户级端卡事实', () => {
  it('完整事实可保存，空字段拒绝', () => {
    const good = mergeFactoryConfig({}, {
      verified_cta: { phone: '09 123 4567', url: 'example.com', departure: 'October 2026' },
    })
    expect(good.ok && good.config.verified_cta).toEqual({
      phone: '09 123 4567', url: 'example.com', departure: 'October 2026',
    })
    expect(mergeFactoryConfig({}, {
      verified_cta: { phone: '09 123 4567', url: '', departure: 'October 2026' },
    }).ok).toBe(false)
  })

  it('null 删除，body 未提及则保留', () => {
    const existing = { verified_cta: { phone: '1', url: 'x', departure: 'd' } }
    const kept = mergeFactoryConfig(existing, { allow_b_track_landmark_ads: false })
    expect(kept.ok && kept.config.verified_cta).toEqual(existing.verified_cta)
    const cleared = mergeFactoryConfig(existing, { verified_cta: null })
    expect(cleared.ok && 'verified_cta' in cleared.config).toBe(false)
  })
})

describe('mergeFactoryConfig — 合并语义', () => {
  it('🔴 只动 body 里出现过的 key,不认识的 key 原样保留', () => {
    const r = mergeFactoryConfig(CTS_LIKE, { allow_b_track_landmark_ads: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 整体替换的话这两个会被抹掉,而且不会有任何报错
    expect(r.config.factory_goal_note).toBe(CTS_LIKE.factory_goal_note)
    expect(r.config.factory_goal_id).toBe(CTS_LIKE.factory_goal_id)
    expect(r.config.allow_b_track_landmark_ads).toBe(false)
  })

  it('body 里没出现的字段一律不碰(空 body = 原样返回)', () => {
    const r = mergeFactoryConfig(CTS_LIKE, {})
    expect(r.ok && r.config).toEqual(CTS_LIKE)
  })

  it('显式传 null → 删掉该 key(不是留个 null 值)', () => {
    const r = mergeFactoryConfig({ ...CTS_LIKE, verified_offer: { price_from: '$35.50/m²' } }, { verified_offer: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('verified_offer' in r.config).toBe(false)
    expect(r.config.factory_goal_note).toBe(CTS_LIKE.factory_goal_note)
  })

  it('促销价清空 → 视同下架删掉(留着会继续被写进文案钩子)', () => {
    const r = mergeFactoryConfig(
      { verified_offer: { price_from: '$35.50/m²', offer_expiry: '31 July' } },
      { verified_offer: { price_from: '   ', offer_expiry: '31 July' } },
    )
    expect(r.ok && 'verified_offer' in r.config).toBe(false)
  })
})

describe('mergeFactoryConfig — 发布目标校验', () => {
  const ok = (page_id: string) => mergeFactoryConfig({}, { publish_target: { platform: 'facebook', page_id } })

  it('合法主页 ID → 存下', () => {
    const r = ok('1616575215312482')
    expect(r.ok && r.config.publish_target).toEqual({ platform: 'facebook', page_id: '1616575215312482' })
  })

  it('🔴 主页 ID 带 act_ 前缀 → 拒(广告账户 ID 填成主页 ID,真踩过)', () => {
    const r = ok('act_1616575215312482')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('纯数字')
  })

  it('🔴 填成主页网址 → 拒', () => {
    const r = ok('https://www.facebook.com/CTSTOURS/')
    expect(r.ok).toBe(false)
  })

  it('只填平台不填主页 ID → 拒(存进去发布必失败)', () => {
    const r = mergeFactoryConfig({}, { publish_target: { platform: 'facebook' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('只填一半')
  })

  it('🔴 publer 等无 adapter 的平台 → 拒(配了也只会 no_adapter 失败)', () => {
    const r = mergeFactoryConfig({}, { publish_target: { platform: 'publer', page_id: '123456' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('facebook')
  })
})

describe('mergeFactoryConfig — Goal 与开关', () => {
  it('合法 uuid → 存下并回传待查 id(归属由路由层查库确认)', () => {
    const id = 'ef92d878-c283-4a1c-be7d-1462c8c4a83c'
    const r = mergeFactoryConfig({}, { factory_goal_id: id })
    expect(r.ok && r.config.factory_goal_id).toBe(id)
    expect(r.ok && r.goalIdToVerify).toBe(id)
  })

  it('非 uuid → 拒,且不回传待查 id', () => {
    const r = mergeFactoryConfig({}, { factory_goal_id: 'latest' })
    expect(r.ok).toBe(false)
  })

  it('清空 Goal → 删 key,且不触发归属查库', () => {
    const r = mergeFactoryConfig(CTS_LIKE, { factory_goal_id: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('factory_goal_id' in r.config).toBe(false)
    expect(r.goalIdToVerify).toBeNull()
  })

  it('🔴 豁免开关传非布尔 → 拒(护栏 6 的开关,不能被字符串 "false" 误开)', () => {
    expect(mergeFactoryConfig({}, { allow_b_track_landmark_ads: 'false' }).ok).toBe(false)
    expect(mergeFactoryConfig({}, { allow_b_track_landmark_ads: 1 }).ok).toBe(false)
  })
})

describe('出片风格 — 投影与下发', () => {
  it('空配置 → 全 null(= 用引擎默认)', () => {
    expect(projectCreativeProfile(undefined)).toEqual(EMPTY_CREATIVE_PROFILE)
  })

  it('🔴 下发给装配脚本时剔掉空值 —— null 会被当成"显式要求默认",覆盖掉本地兜底', () => {
    const compact = compactCreativeProfile(projectCreativeProfile({ look: 'golden_hour' }))
    expect(compact).toEqual({ look: 'golden_hour' })
    expect('music' in compact).toBe(false)
  })

  it('全空 → 下发空对象(建单侧据此判断"不下发",让本地文件兜底)', () => {
    expect(compactCreativeProfile(projectCreativeProfile({}))).toEqual({})
  })

  it('🔴 转场超范围/非数字 → 拒(静默降级更糟:以为设了 1.5 秒,实际是引擎默认)', () => {
    expect(mergeFactoryConfig({}, { creative_profile: { xfade: 5 } }).ok).toBe(false)
    expect(mergeFactoryConfig({}, { creative_profile: { xfade: -1 } }).ok).toBe(false)
    expect(mergeFactoryConfig({}, { creative_profile: { xfade: '0.35' } }).ok).toBe(false)
  })

  it('🔴 转场必须小于 1 秒 —— worker 的段时长地板是 1.0s,转场 ≥ 段长会把整段吞掉', () => {
    // 这个 bug 修过一次,别用配置项放回来
    expect(mergeFactoryConfig({}, { creative_profile: { xfade: 1 } }).ok).toBe(false)
    expect(mergeFactoryConfig({}, { creative_profile: { xfade: 2 } }).ok).toBe(false)
  })

  it('🔴 转场边界值放行并如实落库(0 不能被当空值剔掉,跟 endcard_panel:false 同类)', () => {
    const zero = mergeFactoryConfig({}, { creative_profile: { xfade: 0 } })
    expect(zero.ok).toBe(true)
    expect(zero.ok && (zero.config.creative_profile as Record<string, unknown>).xfade).toBe(0)

    const max = mergeFactoryConfig({}, { creative_profile: { xfade: 0.9 } })
    expect(max.ok).toBe(true)
    expect(max.ok && (max.config.creative_profile as Record<string, unknown>).xfade).toBe(0.9)
  })

  it('endcard_panel 传非布尔 → 拒', () => {
    expect(mergeFactoryConfig({}, { creative_profile: { endcard_panel: 'off' } }).ok).toBe(false)
  })

  it('endcard_panel = false 要能存下(白字 logo 客户靠它,别被当成空值丢掉)', () => {
    const r = mergeFactoryConfig({}, { creative_profile: { endcard_panel: false } })
    expect(r.ok).toBe(true)
    expect(r.ok && (r.config.creative_profile as Record<string, unknown>).endcard_panel).toBe(false)
  })

  it('风格全清空 → 删掉整个 key(回到引擎默认 + 本地兜底)', () => {
    const r = mergeFactoryConfig({ creative_profile: { look: 'x' } }, { creative_profile: {} })
    expect(r.ok && 'creative_profile' in r.config).toBe(false)
  })

  it('改风格不碰其他配置', () => {
    const r = mergeFactoryConfig(
      { publish_target: { platform: 'facebook', page_id: '123456' }, factory_goal_note: '备注' },
      { creative_profile: { look: 'golden_hour' } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.publish_target).toBeDefined()
    expect(r.config.factory_goal_note).toBe('备注')
  })
})

describe('creative_recipe — 白名单 + 版本闸(合同 5469105522 §1)', () => {
  it('未配 recipe(投影)→ null,不影响其它字段', () => {
    expect(projectFactoryConfig({ factory_goal_id: 'ef92d878-c283-4a1c-be7d-1462c8c4a83c' }).creative_recipe).toBeNull()
  })

  it('🔴 合法 recipe id + 缺 version → 拒(禁止静默补齐 · R2 严格解析)', () => {
    const r = mergeFactoryConfig({}, { creative_recipe: { id: 'single_image_i2v_pullback_12s' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/version/)
  })

  it('合法 recipe id + version → 存下', () => {
    const r = mergeFactoryConfig({}, { creative_recipe: { id: 'single_image_i2v_pullback_12s', version: 1 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.creative_recipe).toEqual({ id: 'single_image_i2v_pullback_12s', version: 1 })
  })

  it('🔴 未登记的 recipe id → 拒(禁止「随便加个 id 试试」路径)', () => {
    const r = mergeFactoryConfig({}, { creative_recipe: { id: 'ai_montage_v3' } })
    expect(r.ok).toBe(false)
  })

  it('🔴 recipe id + 错版本 → 拒(升级 recipe = 显式换版本,不许静默继续)', () => {
    const r = mergeFactoryConfig({}, { creative_recipe: { id: 'single_image_i2v_pullback_12s', version: 999 } })
    expect(r.ok).toBe(false)
  })

  it('传 null → 删掉 recipe 配置(回到 legacy 路径)', () => {
    const r = mergeFactoryConfig(
      { creative_recipe: { id: 'single_image_i2v_pullback_12s', version: 1 } },
      { creative_recipe: null },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('creative_recipe' in r.config).toBe(false)
  })
})

describe('render — 子对象合并，不整体替换（子牙复审 B5：voice_id/avatar_image_url 是另一条管线的字段）', () => {
  it('只改 engine 时，既有 voice_id/avatar_image_url 原样保留', () => {
    const r = mergeFactoryConfig(
      { render: { engine: 'ffmpeg', voice_id: 'bigrayvoice01', avatar_image_url: 'https://x/a.jpg' } },
      { render: { engine: 'creatomate' } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.render).toEqual({
      engine: 'creatomate',
      voice_id: 'bigrayvoice01',
      avatar_image_url: 'https://x/a.jpg',
    })
  })

  it('配 creatomate 模板但缺 template_id → 拒', () => {
    const r = mergeFactoryConfig({}, { render: { engine: 'creatomate', creatomate: { scene_field_map: [{ visual: 'V-1' }] } } })
    expect(r.ok).toBe(false)
  })

  it('配 creatomate 模板但槽位为空 → 拒（模板容不下任何内容等于没配）', () => {
    const r = mergeFactoryConfig({}, { render: { engine: 'creatomate', creatomate: { template_id: 't1', scene_field_map: [] } } })
    expect(r.ok).toBe(false)
  })

  it('合法 creatomate 配置 → 存下（存储层 snake_case，跟 factory_config 其余字段同惯例）', () => {
    const r = mergeFactoryConfig({}, {
      render: {
        engine: 'creatomate',
        creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1', caption: 'C-1' }], output_width: 1080, output_height: 1920, output_frame_rate: 30 },
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.render).toEqual({
      engine: 'creatomate',
      creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1', caption: 'C-1' }], output_width: 1080, output_height: 1920, output_frame_rate: 30 },
    })
  })

  it('传 render: null → 整段删掉', () => {
    const r = mergeFactoryConfig({ render: { engine: 'creatomate' } }, { render: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('render' in r.config).toBe(false)
  })

  it('🔴 PATCH 只带 creatomate 不带 engine → 不覆写既有 engine（魏征复审：曾会把已经是 creatomate 的客户静默降级回 ffmpeg）', () => {
    const r = mergeFactoryConfig(
      { render: { engine: 'creatomate', creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1' }] } } },
      { render: { creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1', caption: 'C-1' }] } } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.config.render as { engine: string }).engine).toBe('creatomate')
  })

  // 2026-09-13 修复：static_overrides/required_post_fields/offers/post_field_sources
  // 此前在这段合并逻辑里完全没接（复审 ad68ebde 发现——资料包管理 UI 加了也白加，
  // 保存路径根本不认这几个字段，见 client-config.ts 365-408 行附近注释）。
  it('PATCH 带全部四个新字段 → 全部原样存下（跟 template_id/scene_field_map 同一次写入）', () => {
    const r = mergeFactoryConfig({}, {
      render: {
        engine: 'creatomate',
        creatomate: {
          template_id: 't1',
          scene_field_map: [{ visual: 'V-1' }],
          static_overrides: { EndLogo: 'https://x/logo.png' },
          required_post_fields: ['EndTour', 'EndDate'],
          offers: { default: { tour: 'Best of China', price_line: 'From NZD $4,080 pp' } },
          post_field_sources: { EndTour: 'tour', EndMeta: 'price_line' },
        },
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.render).toEqual({
      engine: 'creatomate',
      creatomate: {
        template_id: 't1',
        scene_field_map: [{ visual: 'V-1' }],
        static_overrides: { EndLogo: 'https://x/logo.png' },
        required_post_fields: ['EndTour', 'EndDate'],
        offers: { default: { tour: 'Best of China', price_line: 'From NZD $4,080 pp' } },
        post_field_sources: { EndTour: 'tour', EndMeta: 'price_line' },
      },
    })
  })

  it('🔴 这次 PATCH 只想改 template_id，没带 offers → 已存的 offers 原样保留，不会被清空', () => {
    const r = mergeFactoryConfig(
      {
        render: {
          engine: 'creatomate',
          creatomate: {
            template_id: 't1',
            scene_field_map: [{ visual: 'V-1' }],
            offers: { default: { tour: 'Best of China' } },
            post_field_sources: { EndTour: 'tour' },
          },
        },
      },
      { render: { creatomate: { template_id: 't2', scene_field_map: [{ visual: 'V-1' }] } } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const creatomate = (r.config.render as { creatomate: Record<string, unknown> }).creatomate
    expect(creatomate.template_id).toBe('t2')
    expect(creatomate.offers).toEqual({ default: { tour: 'Best of China' } })
    expect(creatomate.post_field_sources).toEqual({ EndTour: 'tour' })
  })

  it('显式传 offers: null → 清空已存的 offers（跟 verified_cta 等字段同一套"null=删除"惯例）', () => {
    const r = mergeFactoryConfig(
      {
        render: {
          engine: 'creatomate',
          creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1' }], offers: { default: { tour: 'x' } } },
        },
      },
      { render: { creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1' }], offers: null } } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('offers' in (r.config.render as { creatomate: Record<string, unknown> }).creatomate).toBe(false)
  })

  it('offers 形状不对（值不是字符串）→ 拒，报出人能看懂的错误', () => {
    const r = mergeFactoryConfig({}, {
      render: {
        engine: 'creatomate',
        creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1' }], offers: { default: { tour: 123 } } },
      },
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('offers')
  })

  it('required_post_fields 形状不对（混了非字符串）→ 拒', () => {
    const r = mergeFactoryConfig({}, {
      render: {
        engine: 'creatomate',
        creatomate: { template_id: 't1', scene_field_map: [{ visual: 'V-1' }], required_post_fields: ['EndTour', 123] },
      },
    })
    expect(r.ok).toBe(false)
  })

  it('body 未提及 recipe → 现有配置原样保留(合并语义)', () => {
    const r = mergeFactoryConfig(
      { creative_recipe: { id: 'single_image_i2v_pullback_12s', version: 1 } },
      { allow_b_track_landmark_ads: true },
    )
    expect(r.ok && r.config.creative_recipe).toEqual({ id: 'single_image_i2v_pullback_12s', version: 1 })
  })

  it('脏投影(旧行里存着未知 id)→ 前端读到 null,不炸,不误配', () => {
    expect(projectFactoryConfig({ creative_recipe: { id: 'legacy_x', version: 1 } }).creative_recipe).toBeNull()
  })
})

describe('mergeFactoryConfig — 自动排产开关(花钱闸)', () => {
  const WITH_TARGET = { publish_target: { platform: 'facebook', page_id: '1616575215312482' } }

  it('🔴 没配发布主页就想开自动排产 → 拒(片子照做照花钱,做完无处可发)', () => {
    const r = mergeFactoryConfig({}, { auto_order_enabled: true })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('发布主页')
  })

  it('已配发布主页 → 允许开', () => {
    const r = mergeFactoryConfig(WITH_TARGET, { auto_order_enabled: true })
    expect(r.ok && r.config.auto_order_enabled).toBe(true)
  })

  it('同一次请求里先配主页再开开关 → 允许(读的是合并后的状态,不是旧状态)', () => {
    const r = mergeFactoryConfig({}, { ...WITH_TARGET, auto_order_enabled: true })
    expect(r.ok && r.config.auto_order_enabled).toBe(true)
  })

  it('关掉开关不需要发布主页(随时能踩刹车)', () => {
    const r = mergeFactoryConfig({ auto_order_enabled: true }, { auto_order_enabled: false })
    expect(r.ok && r.config.auto_order_enabled).toBe(false)
  })

  it('🔴 传非布尔 → 拒(字符串 "true" 不能开这个花钱开关)', () => {
    expect(mergeFactoryConfig(WITH_TARGET, { auto_order_enabled: 'true' }).ok).toBe(false)
  })

  it('默认关:投影里没这个 key 时是 false', () => {
    expect(projectFactoryConfig({}).auto_order_enabled).toBe(false)
    expect(projectFactoryConfig({ auto_order_enabled: 'true' }).auto_order_enabled).toBe(false)
  })
})
