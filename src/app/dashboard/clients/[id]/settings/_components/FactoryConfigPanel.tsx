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
  allow_b_track_landmark_ads: boolean
  auto_order_enabled: boolean
  creative_profile: Style
}

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
  allowLandmark: boolean
  autoOrder: boolean
  music: string
  musicMood: string
  look: string
  captionMode: string
  xfade: string
  endcardPanel: 'default' | 'on' | 'off'
}

const toDraft = (c: Config): Draft => ({
  pageId: c.publish_target?.page_id ?? '',
  goalId: c.factory_goal_id ?? '',
  priceFrom: c.verified_offer?.price_from ?? '',
  offerExpiry: c.verified_offer?.offer_expiry ?? '',
  verifiedServices: (c.verified_offer?.verified_services ?? []).join('\n'),
  allowLandmark: c.allow_b_track_landmark_ads,
  autoOrder: c.auto_order_enabled,
  music: c.creative_profile?.music ?? '',
  musicMood: c.creative_profile?.music_mood ?? '',
  look: c.creative_profile?.look ?? '',
  captionMode: c.creative_profile?.caption_mode ?? '',
  xfade: c.creative_profile?.xfade != null ? String(c.creative_profile.xfade) : '',
  endcardPanel: c.creative_profile?.endcard_panel == null ? 'default' : (c.creative_profile.endcard_panel ? 'on' : 'off'),
})

const eqDraft = (a: Draft, b: Draft) =>
  a.pageId === b.pageId && a.goalId === b.goalId && a.priceFrom === b.priceFrom &&
  a.offerExpiry === b.offerExpiry && a.verifiedServices === b.verifiedServices &&
  a.allowLandmark === b.allowLandmark &&
  a.autoOrder === b.autoOrder && a.music === b.music && a.musicMood === b.musicMood &&
  a.look === b.look && a.captionMode === b.captionMode && a.xfade === b.xfade &&
  a.endcardPanel === b.endcardPanel

export function FactoryConfigPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<Draft>(toDraft({
    publish_target: null, factory_goal_id: null, verified_offer: null,
    allow_b_track_landmark_ads: false, auto_order_enabled: false, creative_profile: EMPTY_STYLE,
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
      setDraft(toDraft(data.config))
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
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
        }),
      })
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState((s) => (s.phase === 'ready' ? { phase: 'ready', data: { ...s.data, config: json.config } } : s))
      setDraft(toDraft(json.config as Config))
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
  const isDirty = !eqDraft(draft, toDraft(data.config))
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
