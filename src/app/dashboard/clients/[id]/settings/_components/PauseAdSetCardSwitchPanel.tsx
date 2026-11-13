'use client'

/**
 * PauseAdSetCardSwitchPanel — per-client «暂停广告组确认卡» operator switch.
 * Writes only through /api/clients/[id]/ad-strategy-config/pause-ad-set-card.
 */

import { usePauseAdSetCardSwitch } from './use-pause-ad-set-card-switch'

interface Props {
  clientId: string
}

export function PauseAdSetCardSwitchPanel({ clientId }: Props) {
  const { phase, enabled, loadError, saving, saveError, reload, toggle } = usePauseAdSetCardSwitch(clientId)

  if (phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{loadError}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-800">暂停广告组确认卡</p>
          <p className="mt-1 text-xs text-slate-500">
            打开后，暂停某个广告组会先出一张确认卡，有人点确认才会真的在 Meta 里暂停；
            关掉则仍走原来的暂停路径（不经这张卡）。
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-slate-500">{enabled ? '已开启' : '已关闭'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="开关暂停广告组确认卡"
            disabled={saving}
            onClick={() => void toggle(!enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              enabled ? 'bg-cyan-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
      {saving && <p className="mt-2 text-xs text-slate-400">保存中…</p>}
      {!saving && saveError && <p className="mt-2 text-xs text-red-600">⚠ {saveError}</p>}
    </div>
  )
}
