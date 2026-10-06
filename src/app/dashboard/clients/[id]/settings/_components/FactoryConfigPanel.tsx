'use client'

/**
 * FactoryConfigPanel — 视频工厂的客户级配置(clients.factory_config)。
 *
 * 存在理由:这一列此前没有任何写入界面,接一个客户就要人工进数据库敲一次
 * (违反 CLAUDE.md「FDE/PM 配置类数据必须有 UI」)。四个字段各有真实消费方,
 * 见 /api/clients/[id]/factory-config 头注。
 *
 * 沿用 SocialHandlesPanel 的 loading / error / ready 三态 + draft/保存 模式。
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface Config {
  publish_target: { platform: string; page_id: string } | null
  factory_goal_id: string | null
  verified_offer: {
    price_from: string
    offer_expiry: string
    /** 客户**真的提供**的服务承诺。空 = 文案里一条「免费 xx」都不许出现。 */
    verified_services?: string[]
  } | null
  verified_cta: {
    phone: string
    url: string
    departure: string
    price?: string
  } | null
  allow_b_track_landmark_ads: boolean
  auto_order_enabled: boolean
  creative_profile: Style
  /** 版本化 winner recipe(合同 5469105522 §1)。null = 走 legacy 分镜路径。 */
  creative_recipe: { id: string; version: number } | null
  /** 出片引擎（spec docs/specs/2026-09-09-creatomate-connector-spec-v1.md §9）。
   *  voice_id/avatar_image_url 是 lecture-render.ts 用的既有字段，这个面板不显示、不碰它们——
   *  PATCH 时子对象合并（见 client-config.ts::mergeFactoryConfig），不会被这里的保存覆盖掉。 */
  render: {
    engine: 'ffmpeg' | 'creatomate'
    creatomate: {
      templateId: string
      sceneFieldMap: { visual: string; caption?: string; voice?: string }[]
      /** 这条视频必须自己给值的元素名清单（如片尾团名/价格）。见 requiredPostFields 消费方
       *  post-fields.ts::resolvePostFields。 */
      requiredPostFields?: string[]
      /** 元素名 → 该去 offers[offerKey] 里取哪个字段名的映射。 */
      postFieldSources?: Record<string, string>
      /** 「档位名(如 11月团) → {字段名: 真实值}」的资料字典 —— 这条视频用哪个档位，
       *  见 content_posts.generation_context_snapshot.offer_key。 */
      offers?: Record<string, Record<string, string>>
    } | null
  } | null
}

/** 目前已注册的 recipe。新增 recipe = 平台层升级,必先走 me-platform-tier-gate。 */
const RECIPE_OPTIONS: ReadonlyArray<{ value: string; label: string; version: number }> = [
  { value: 'single_image_i2v_pullback_12s', label: '单图 · 推近 + 拉远 12 秒 (v1)', version: 1 },
  { value: 'single_image_i2v_multicut_9s', label: '单图 · 三镜头速切 9 秒 (v1)', version: 1 },
  { value: 'multi_image_i2v_multicut_9s', label: '多图 · 三镜头速切 9 秒 (v1)', version: 1 },
]

/** 字段名跟装配脚本真正读的键一致(worker.mjs assemble)。改名前先看那边。 */
interface Style {
  music: string | null
  music_mood: string | null
  look: string | null
  caption_mode: string | null
  xfade: number | null
  endcard_panel: boolean | null
}

const EMPTY_STYLE: Style = {
  music: null, music_mood: null, look: null, caption_mode: null, xfade: null, endcard_panel: null,
}

interface Goal {
  id: string
  title: string
}

/** 一个「资料包」（如"11月团"）：key + 若干字段名/值。字段名/值都是自由文本——
 *  不同客户/行业需要的字段不一样（团名/价格/日期，或者房源地址/代理人，随客户定），
 *  不在前端写死形状。 */
interface OfferDraft {
  key: string
  fields: { name: string; value: string }[]
}

interface Payload {
  config: Config
  active_goals: Goal[]
  facebook_page_url: string | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

/** draft 用扁平字符串,省掉嵌套对象的空值分支 */
interface Draft {
  pageId: string
  goalId: string
  priceFrom: string
  offerExpiry: string
  /** 一行一条,客户真的提供的免费服务。空 = 文案里不许出现任何「免费 xx」。 */
  verifiedServices: string
  ctaPhone: string
  ctaUrl: string
  ctaDeparture: string
  ctaPrice: string
  allowLandmark: boolean
  autoOrder: boolean
  music: string
  musicMood: string
  look: string
  captionMode: string
  xfade: string
  endcardPanel: 'default' | 'on' | 'off'
  /** '' = 未配 recipe(legacy 路径);否则 = 已注册 recipe id */
  recipeId: string
  renderEngine: 'ffmpeg' | 'creatomate'
  creatomateTemplateId: string
  /** sceneFieldMap 的 JSON 文本 —— 结构不算简单，用文本框比拼 N 个输入框更不容易出错，
   *  保存前解析校验，解析失败直接报错不让保存。 */
  creatomateSceneFieldMapJson: string
  /** 一行一个元素名 —— 这条视频必须自己给值的字段清单（如 EndTour/EndDate）。 */
  requiredPostFieldsText: string
  /** 元素名 → 资料字段名 的映射，JSON 文本(跟 sceneFieldMap 同一个理由：结构对但
   *  拆 N 个输入框更容易出错，配置好基本不用再改，不需要专门做结构化表单)。 */
  postFieldSourcesJson: string
  /** 资料包列表 —— FDE/PM 自己维护的部分，结构化表格（跟上面两个不同，这个会
   *  经常增删，值得做成真表单）。 */
  offers: OfferDraft[]
}

const toDraft = (c: Config, activeGoals: Goal[] = []): Draft => ({
  pageId: c.publish_target?.page_id ?? '',
  // 存量数据可能指向一个已经不再活跃（或已被删除）的 Goal —— 下拉框里找不到这个选项，
  // 只能显示占位文字，但如果这里原样把这个失效 ID 塞进 draft，保存时后端会拒收整份表单
  // （包括这次真正要改的其它字段），且没有任何 UI 途径能清掉它（下拉框在零活跃目标时是
  // disabled 的）。所以只信一个「当前确实在活跃列表里」的 factory_goal_id，否则当空处理。
  goalId: c.factory_goal_id && activeGoals.some((g) => g.id === c.factory_goal_id) ? c.factory_goal_id : '',
  priceFrom: c.verified_offer?.price_from ?? '',
  offerExpiry: c.verified_offer?.offer_expiry ?? '',
  verifiedServices: (c.verified_offer?.verified_services ?? []).join('\n'),
  ctaPhone: c.verified_cta?.phone ?? '',
  ctaUrl: c.verified_cta?.url ?? '',
  ctaDeparture: c.verified_cta?.departure ?? '',
  ctaPrice: c.verified_cta?.price ?? '',
  allowLandmark: c.allow_b_track_landmark_ads,
  autoOrder: c.auto_order_enabled,
  music: c.creative_profile?.music ?? '',
  musicMood: c.creative_profile?.music_mood ?? '',
  look: c.creative_profile?.look ?? '',
  captionMode: c.creative_profile?.caption_mode ?? '',
  xfade: c.creative_profile?.xfade != null ? String(c.creative_profile.xfade) : '',
  endcardPanel: c.creative_profile?.endcard_panel == null ? 'default' : (c.creative_profile.endcard_panel ? 'on' : 'off'),
  recipeId: c.creative_recipe?.id ?? '',
  renderEngine: c.render?.engine ?? 'ffmpeg',
  creatomateTemplateId: c.render?.creatomate?.templateId ?? '',
  creatomateSceneFieldMapJson: c.render?.creatomate ? JSON.stringify(c.render.creatomate.sceneFieldMap, null, 2) : '',
  requiredPostFieldsText: (c.render?.creatomate?.requiredPostFields ?? []).join('\n'),
  postFieldSourcesJson: c.render?.creatomate?.postFieldSources
    ? JSON.stringify(c.render.creatomate.postFieldSources, null, 2) : '',
  offers: Object.entries(c.render?.creatomate?.offers ?? {}).map(([key, fields]) => ({
    key,
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
  })),
})

const eqDraft = (a: Draft, b: Draft) =>
  a.pageId === b.pageId && a.goalId === b.goalId && a.priceFrom === b.priceFrom &&
  a.offerExpiry === b.offerExpiry && a.verifiedServices === b.verifiedServices &&
  a.ctaPhone === b.ctaPhone && a.ctaUrl === b.ctaUrl &&
  a.ctaDeparture === b.ctaDeparture && a.ctaPrice === b.ctaPrice &&
  a.allowLandmark === b.allowLandmark &&
  a.autoOrder === b.autoOrder && a.music === b.music && a.musicMood === b.musicMood &&
  a.look === b.look && a.captionMode === b.captionMode && a.xfade === b.xfade &&
  a.endcardPanel === b.endcardPanel && a.recipeId === b.recipeId &&
  a.renderEngine === b.renderEngine && a.creatomateTemplateId === b.creatomateTemplateId &&
  a.creatomateSceneFieldMapJson === b.creatomateSceneFieldMapJson &&
  a.requiredPostFieldsText === b.requiredPostFieldsText &&
  a.postFieldSourcesJson === b.postFieldSourcesJson &&
  // offers 是数组套对象，逐字段比较太啰嗦——这里只是判断"要不要显示保存按钮"，
  // 不是判定正确性，序列化比较足够、跟 JSON 文本框那几个字段同一个偷懒理由。
  JSON.stringify(a.offers) === JSON.stringify(b.offers)

export function FactoryConfigPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<Draft>(toDraft({
    publish_target: null, factory_goal_id: null, verified_offer: null, verified_cta: null,
    allow_b_track_landmark_ads: false, auto_order_enabled: false, creative_profile: EMPTY_STYLE,
    creative_recipe: null, render: null,
  }))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/factory-config`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setDraft(toDraft(data.config, data.active_goals))
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)

    let creatomate: Record<string, unknown> | null = null
    if (draft.renderEngine === 'creatomate') {
      let sceneFieldMap: unknown
      try {
        sceneFieldMap = JSON.parse(draft.creatomateSceneFieldMapJson || '[]')
      } catch {
        setErrMsg('镜头槽位映射不是合法的 JSON —— 格式类似 [{"visual":"Video-1","caption":"Caption-1"}]')
        setSaving(false)
        return
      }

      let postFieldSources: unknown = undefined
      if (draft.postFieldSourcesJson.trim()) {
        try {
          postFieldSources = JSON.parse(draft.postFieldSourcesJson)
        } catch {
          setErrMsg('"元素名→资料字段映射"不是合法的 JSON —— 格式类似 {"EndTour":"tour","EndMeta":"price_line"}')
          setSaving(false)
          return
        }
      }

      const requiredPostFields = draft.requiredPostFieldsText
        .split('\n').map((x) => x.trim()).filter(Boolean)

      // 资料包：过滤掉没填档位名的行；每个档位内部再过滤掉没填字段名的行。
      // 🔴 2026-09-13 复审补（魏征 a9a67fc1）：档位名重复此前会静默覆盖——第二个
      // "11月团"悄悄吃掉第一个的内容，保存显示成功，FDE 看不出丢了什么。改成跟
      // 别处校验（如镜头槽位映射解析失败）一样的待遇：拦下、报错、不让保存。
      const offerKeys = draft.offers.map((o) => o.key.trim()).filter(Boolean)
      const dupKeys = [...new Set(offerKeys.filter((k, i) => offerKeys.indexOf(k) !== i))]
      if (dupKeys.length > 0) {
        setErrMsg(`资料包档位名重复了：${dupKeys.join('、')} —— 每个档位名只能用一次，改一下再保存`)
        setSaving(false)
        return
      }

      const offers: Record<string, Record<string, string>> = {}
      for (const o of draft.offers) {
        const key = o.key.trim()
        if (!key) continue
        const fields: Record<string, string> = {}
        for (const f of o.fields) {
          if (f.name.trim()) fields[f.name.trim()] = f.value
        }
        offers[key] = fields
      }

      creatomate = {
        template_id: draft.creatomateTemplateId.trim(),
        scene_field_map: sceneFieldMap,
        ...(requiredPostFields.length > 0 ? { required_post_fields: requiredPostFields } : { required_post_fields: null }),
        ...(postFieldSources ? { post_field_sources: postFieldSources } : { post_field_sources: null }),
        ...(Object.keys(offers).length > 0 ? { offers } : { offers: null }),
      }
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/factory-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publish_target: draft.pageId.trim() ? { platform: 'facebook', page_id: draft.pageId.trim() } : null,
          factory_goal_id: draft.goalId || null,
          // 服务承诺可以单独存在(有免费测量但没在做特价),所以只要两者之一有值就落库
          verified_offer: (draft.priceFrom.trim() || draft.verifiedServices.trim())
            ? {
                price_from: draft.priceFrom.trim(),
                offer_expiry: draft.offerExpiry.trim(),
                verified_services: draft.verifiedServices
                  .split('\n').map((x) => x.trim()).filter(Boolean),
              }
            : null,
          verified_cta: (draft.ctaPhone.trim() || draft.ctaUrl.trim()
            || draft.ctaDeparture.trim() || draft.ctaPrice.trim())
            ? {
                phone: draft.ctaPhone.trim(),
                url: draft.ctaUrl.trim(),
                departure: draft.ctaDeparture.trim(),
                price: draft.ctaPrice.trim(),
              }
            : null,
          allow_b_track_landmark_ads: draft.allowLandmark,
          auto_order_enabled: draft.autoOrder,
          creative_profile: {
            music: draft.music.trim() || null,
            music_mood: draft.musicMood.trim() || null,
            look: draft.look.trim() || null,
            caption_mode: draft.captionMode.trim() || null,
            xfade: draft.xfade.trim() === '' ? null : Number(draft.xfade),
            endcard_panel: draft.endcardPanel === 'default' ? null : draft.endcardPanel === 'on',
          },
          creative_recipe: draft.recipeId
            ? {
                id: draft.recipeId,
                version: RECIPE_OPTIONS.find((r) => r.value === draft.recipeId)?.version ?? 1,
              }
            : null,
          render: { engine: draft.renderEngine, creatomate },
        }),
      })
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState((s) => (s.phase === 'ready' ? { phase: 'ready', data: { ...s.data, config: json.config } } : s))
      setDraft(toDraft(json.config as Config, state.phase === 'ready' ? state.data.active_goals : []))
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载工厂配置…
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p>
        <p>{state.message}</p>
        <button onClick={load} className="mt-2 font-medium underline">重试</button>
      </div>
    )
  }

  const { data } = state
  const isDirty = !eqDraft(draft, toDraft(data.config, data.active_goals))
  const publishReady = Boolean(data.config.publish_target)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="text-xs text-slate-500">
          视频工厂给这个客户出片、发片时读的配置。<span className="font-medium text-slate-600">没配发布主页,片子做出来就无处可发。</span>
        </p>
        <span
          className={[
            'flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
            publishReady
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-amber-200 bg-amber-50 text-amber-700',
          ].join(' ')}
        >
          {publishReady ? '发布目标已配' : '缺发布目标'}
        </span>
      </div>

      <div className="space-y-4">
        {/* 发布主页 */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            发布到哪个 Facebook 主页(主页 ID)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={draft.pageId}
            onChange={(e) => setDraft((d) => ({ ...d, pageId: e.target.value }))}
            placeholder="例:1616575215312482"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-400">
            纯数字。<span className="font-medium text-amber-700">别填广告账户 ID</span> —— 这两个填反过一次。
            {data.facebook_page_url && <> 本客户已登记主页:<span className="font-mono">{data.facebook_page_url}</span></>}
          </p>
        </div>

        {/* 工厂目标 */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            这个客户的片子服务哪个目标
          </label>
          <select
            value={draft.goalId}
            onChange={(e) => setDraft((d) => ({ ...d, goalId: e.target.value }))}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            disabled={saving || data.active_goals.length === 0}
          >
            <option value="">（不指定 · 自动用最新的活跃目标）</option>
            {data.active_goals.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            {data.active_goals.length === 0
              ? '这个客户还没有活跃目标,先去 Goal 页建一个。'
              : '不指定的话,工厂会自动挑最新的活跃目标 —— 目标一换,出片方向就跟着变。'}
          </p>
        </div>

        {/* 真实促销 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            当前主打优惠(可留空)
          </label>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={draft.priceFrom}
              onChange={(e) => setDraft((d) => ({ ...d, priceFrom: e.target.value }))}
              placeholder="价格,例:$42/m²"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              disabled={saving}
            />
            <input
              type="text"
              value={draft.offerExpiry}
              onChange={(e) => setDraft((d) => ({ ...d, offerExpiry: e.target.value }))}
              placeholder="截止日,例:31 July"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              disabled={saving}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            会被写进片子的文案钩子。<span className="font-medium text-amber-700">优惠下架了就把价格清空</span>,
            否则系统会一直拿它去做片。
          </p>

          {/* 服务承诺白名单 —— 2026-08-03 Oztop 试跑,AI 自己写了「免费上门测量」,
              而资料里根本没这项。承诺一发出去客户就得兑现,必须逐条登记才准写。 */}
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
            客户真的提供的免费服务(一行一条)
          </label>
          <textarea
            value={draft.verifiedServices}
            onChange={(e) => setDraft((d) => ({ ...d, verifiedServices: e.target.value }))}
            rows={3}
            placeholder={'free in-home measure\nfree quote\n免费送货'}
            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-400">
            <span className="font-medium text-amber-700">留空 = 片子里一句「免费 xx」都不许出现</span>。
            这里没登记的免费服务,系统会当成编造的自动拦掉 —— 因为承诺一旦发出去,客户就得兑现。
          </p>
        </div>

        {/* 已验证端卡信息 —— recipe 只从这里取联系方式，不从模型自由生成。 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">视频端卡信息</p>
          <p className="mt-0.5 text-xs text-slate-400">
            三镜头 9 秒配方会把这些信息放在结尾。电话、网址和出发时间必须全部填写；价格可以留空。
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text" value={draft.ctaPhone} disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, ctaPhone: e.target.value }))}
              placeholder="联系电话"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <input
              type="text" value={draft.ctaUrl} disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, ctaUrl: e.target.value }))}
              placeholder="官网网址"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <input
              type="text" value={draft.ctaDeparture} disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, ctaDeparture: e.target.value }))}
              placeholder="出发时间 / 日期"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <input
              type="text" value={draft.ctaPrice} disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, ctaPrice: e.target.value }))}
              placeholder="价格(可留空)"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
        </div>

        {/* 出片风格 —— 此前只能手改 Dropbox 里的 JSON,ME 完全不知道它存在 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">出片风格</p>
          <p className="mt-0.5 text-xs text-slate-400">
            留空 = 用引擎默认。填了就以这里为准(会覆盖客户素材包里的同名设置)。
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-500">背景音乐(曲名)</span>
              <input
                type="text" value={draft.music} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, music: e.target.value }))}
                placeholder="例:龙旗破云.mp3"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">或按情绪自动选曲</span>
              <input
                type="text" value={draft.musicMood} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, musicMood: e.target.value }))}
                placeholder="例:epic_cinematic"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">调色</span>
              <input
                type="text" value={draft.look} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, look: e.target.value }))}
                placeholder="例:golden_hour"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">字幕模式</span>
              <input
                type="text" value={draft.captionMode} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, captionMode: e.target.value }))}
                placeholder="例:short_big"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">转场时长(秒,0–2)</span>
              <input
                type="number" step="0.05" min="0" max="2" value={draft.xfade} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, xfade: e.target.value }))}
                placeholder="例:0.35"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">结尾卡白底面板</span>
              <select
                value={draft.endcardPanel} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, endcardPanel: e.target.value as Draft['endcardPanel'] }))}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="default">默认</option>
                <option value="on">套白底</option>
                <option value="off">不套(白字 logo 用)</option>
              </select>
            </label>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            音乐文件要放在制作机的共享音乐目录里;找不到时会按上面的情绪自动挑一首。
            白字 logo(如 Oztop)结尾卡要选<span className="font-medium text-slate-600">「不套」</span>,否则字会看不见。
          </p>
        </div>

        {/* 出片配方 —— 版本化 winner recipe(合同 5469105522 §1)。选了 recipe = 走强约束路径:
            单张源图 + 推近 / 拉远 两段 5s I2V + ~2.8s 结尾卡 + 转场 0.35 → 成片 10–12s。 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">出片配方(可选)</p>
          <p className="mt-0.5 text-xs text-slate-400">
            默认<span className="font-medium text-slate-600">「不选」</span> = 走通用分镜路径(多段库存 + 生成拼)。
            选了配方后系统会严格按所选时长、镜头和字幕规则出片；任何不符
            (缺源图 / 端卡事实 / 时长 / 字幕格式)一律 fail-closed,不冒充成品发出去。
          </p>
          <select
            value={draft.recipeId}
            onChange={(e) => setDraft((d) => ({ ...d, recipeId: e.target.value }))}
            disabled={saving}
            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="">不选(默认 · 通用分镜)</option>
            {RECIPE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* 出片引擎 —— spec docs/specs/2026-09-09-creatomate-connector-spec-v1.md §9。
            默认 ffmpeg(维持现状,不强推)。选 Creatomate 才需要填模板信息。 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">出片引擎</p>
          <p className="mt-0.5 text-xs text-slate-400">
            默认<span className="font-medium text-slate-600">「ffmpeg」</span>(维持现状,"确认"按钮不会自动出片,需人工处理)。
            选 Creatomate 后,"确认"选题会自动提交渲染。模板要先在 Creatomate 编辑器里搭好,这里只填对应关系。
          </p>
          <select
            value={draft.renderEngine}
            onChange={(e) => setDraft((d) => ({ ...d, renderEngine: e.target.value as Draft['renderEngine'] }))}
            disabled={saving}
            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="ffmpeg">ffmpeg(默认 · 出片需人工处理)</option>
            <option value="creatomate">Creatomate 模板(自动提交渲染)</option>
          </select>

          {draft.renderEngine === 'creatomate' && (
            <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">模板 ID</label>
                <input
                  type="text"
                  value={draft.creatomateTemplateId}
                  onChange={(e) => setDraft((d) => ({ ...d, creatomateTemplateId: e.target.value }))}
                  disabled={saving}
                  placeholder="Creatomate 后台的 template_id"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">镜头槽位映射（JSON）</label>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  数组下标 = 分镜顺序。每项至少填 visual（画面元素名）；caption/voice 可选。
                </p>
                <textarea
                  value={draft.creatomateSceneFieldMapJson}
                  onChange={(e) => setDraft((d) => ({ ...d, creatomateSceneFieldMapJson: e.target.value }))}
                  disabled={saving}
                  rows={5}
                  placeholder='[{"visual":"Video-1","caption":"Caption-1","voice":"Voice-1"}]'
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                背景音乐等固定音频请在模板设计阶段配好，这版暂不支持通过这里动态替换。
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-600">必填结尾字段（一行一个元素名，可选）</label>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  比如片尾团名/价格这类"每条视频必须自己给值"的元素名。留空 = 这个模板没有这种字段。
                </p>
                <textarea
                  value={draft.requiredPostFieldsText}
                  onChange={(e) => setDraft((d) => ({ ...d, requiredPostFieldsText: e.target.value }))}
                  disabled={saving}
                  rows={3}
                  placeholder={'EndTour\nEndRoute\nEndMeta\nEndDate'}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">元素名 → 资料字段映射（JSON，配了必填结尾字段就要填）</label>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  上面每个元素名该去下面"资料包"里取哪个字段的值。配置一次，之后新增资料包不用再改这里。
                </p>
                <textarea
                  value={draft.postFieldSourcesJson}
                  onChange={(e) => setDraft((d) => ({ ...d, postFieldSourcesJson: e.target.value }))}
                  disabled={saving}
                  rows={4}
                  placeholder='{"EndTour":"tour","EndRoute":"route","EndMeta":"price_line","EndDate":"departure"}'
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-600">资料包（团/档位，各自的真实价格/行程/日期）</label>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setDraft((d) => ({ ...d, offers: [...d.offers, { key: '', fields: [{ name: '', value: '' }] }] }))}
                    className="text-xs font-medium text-cyan-700 hover:text-cyan-800"
                  >
                    + 新增资料包
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  同时有 ≥2 个资料包时，做视频要先选用哪一个（内容工厂看板"确认做"那一步），
                  系统不会自己猜——猜错了会把错的价格/日期印到视频上。
                </p>

                {draft.offers.length === 0 && (
                  <p className="mt-2 text-xs text-slate-400 italic">还没有资料包 —— 点上面"+ 新增资料包"加一个。</p>
                )}

                <div className="mt-2 space-y-3">
                  {draft.offers.map((offer, oi) => (
                    <div key={oi} className="rounded-lg border border-slate-300 bg-white p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={offer.key}
                          disabled={saving}
                          onChange={(e) => setDraft((d) => ({
                            ...d,
                            offers: d.offers.map((o, i) => i === oi ? { ...o, key: e.target.value } : o),
                          }))}
                          placeholder="档位名，例：11月团"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setDraft((d) => ({ ...d, offers: d.offers.filter((_, i) => i !== oi) }))}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          删除
                        </button>
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {offer.fields.map((f, fi) => (
                          <div key={fi} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={f.name}
                              disabled={saving}
                              onChange={(e) => setDraft((d) => ({
                                ...d,
                                offers: d.offers.map((o, i) => i !== oi ? o : {
                                  ...o,
                                  fields: o.fields.map((x, j) => j === fi ? { ...x, name: e.target.value } : x),
                                }),
                              }))}
                              placeholder="字段名，例：tour"
                              className="w-1/3 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <input
                              type="text"
                              value={f.value}
                              disabled={saving}
                              onChange={(e) => setDraft((d) => ({
                                ...d,
                                offers: d.offers.map((o, i) => i !== oi ? o : {
                                  ...o,
                                  fields: o.fields.map((x, j) => j === fi ? { ...x, value: e.target.value } : x),
                                }),
                              }))}
                              placeholder="真实值，例：China Discovery — Nov Departure"
                              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => setDraft((d) => ({
                                ...d,
                                offers: d.offers.map((o, i) => i !== oi ? o : { ...o, fields: o.fields.filter((_, j) => j !== fi) }),
                              }))}
                              className="text-xs text-slate-400 hover:text-red-600"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setDraft((d) => ({
                            ...d,
                            offers: d.offers.map((o, i) => i !== oi ? o : { ...o, fields: [...o.fields, { name: '', value: '' }] }),
                          }))}
                          className="text-[11px] font-medium text-cyan-700 hover:text-cyan-800"
                        >
                          + 加一个字段
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 自动排产 —— 这是唯一会自动花钱的开关,放在最显眼处并写清楚代价 */}
        <label
          className={[
            'flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3',
            draft.autoOrder ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white',
          ].join(' ')}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-700">每天自动排一条片</span>
            <span className="block text-xs text-slate-500">
              打开后系统每天早上自动给这个客户下一条出片单,不用人催。
              <span className="font-medium text-slate-700">这是唯一会自动花钱的开关</span> ——
              每条片子成本上限 $2,每个客户每天最多 3 条。余额不足会自动停,不会超支。
              {!publishReady && (
                <span className="mt-1 block font-medium text-amber-700">
                  ⚠️ 要先配好上面的发布主页才能打开,否则片子做出来无处可发,白花钱。
                </span>
              )}
            </span>
          </span>
          <input
            type="checkbox"
            checked={draft.autoOrder}
            onChange={(e) => setDraft((d) => ({ ...d, autoOrder: e.target.checked }))}
            disabled={saving || (!publishReady && !draft.autoOrder)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-emerald-600 disabled:opacity-40"
          />
        </label>

        {/* 护栏豁免 */}
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-700">允许 AI 画面里出现具体地标</span>
            <span className="block text-xs text-slate-500">
              默认关闭。关着时,AI 生成的画面只能是抽象场景,不能出现长城、天空塔这类具体地标 ——
              防止「AI 画的假地标」被当成实拍发出去。只有确认客户能接受时才打开。
            </span>
          </span>
          <input
            type="checkbox"
            checked={draft.allowLandmark}
            onChange={(e) => setDraft((d) => ({ ...d, allowLandmark: e.target.checked }))}
            disabled={saving}
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-amber-600"
          />
        </label>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {savedAt && !isDirty && <span className="text-emerald-700">✓ 已保存 · {savedAt}</span>}
          {errMsg && <span className="text-red-700">⚠ {errMsg}</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
