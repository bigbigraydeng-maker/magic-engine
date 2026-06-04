/**
 * ContentStateStrip — Kanban 卡片内容状态条
 *
 * 四档信号（文/图/视/发），FDE 不开抽屉就能看到每个任务的内容生产进度。
 *
 * 每档值：
 *   - ready      ✓  绿色 — 已就绪
 *   - generating ⏳ 蓝色脉冲 — 生成中
 *   - failed     ✗  红色 — 失败
 *   - pending    ·  灰色 — 未开始
 *   - na         —  灰色淡 — 不适用
 */

import type { CardContentState, ContentStateSignal, CardPrioritySignal } from '@/types/diagnostic'

interface Props {
  state: CardContentState | null
}

const SIGNAL_STYLE: Record<ContentStateSignal, { icon: string; cls: string }> = {
  ready:      { icon: '✓',  cls: 'text-green-700' },
  generating: { icon: '⏳', cls: 'text-cyan-700 animate-pulse' },
  failed:     { icon: '✗',  cls: 'text-red-700' },
  pending:    { icon: '·',  cls: 'text-slate-400' },
  na:         { icon: '—',  cls: 'text-slate-300' },
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const d = Math.floor(hr / 24)
  return `${d} 天前`
}

export function ContentStateStrip({ state }: Props) {
  if (!state) return null

  const pkg = state.package_progress

  return (
    <div className="flex items-center justify-between gap-2 text-[10px] font-bold mt-1">
      <div className="flex items-center gap-1.5">
        <SignalChip label="📝" signal={state.text} title="文案" />
        <SignalChip label="🖼" signal={state.image} title="图片" />
        <SignalChip label="🎬" signal={state.video} title="视频" />
        <SignalChip label="📤" signal={state.publish} title="发布" />
        {pkg && pkg.total > 1 && (
          <span
            className="ml-1 px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-700"
            title={`量产包：${pkg.ready} 就绪 / ${pkg.generating} 生成中 / ${pkg.failed} 失败`}
          >
            📦 {pkg.ready}/{pkg.total}
            {pkg.failed > 0 && <span className="text-red-600 ml-0.5">⚠</span>}
          </span>
        )}
      </div>
      {state.last_changed_at && (
        <span className="text-slate-400 shrink-0 truncate">{timeAgo(state.last_changed_at)}</span>
      )}
    </div>
  )
}

function SignalChip({ label, signal, title }: { label: string; signal: ContentStateSignal; title: string }) {
  const style = SIGNAL_STYLE[signal]
  return (
    <span title={`${title}: ${signal}`} className={`inline-flex items-center gap-0.5 ${style.cls}`}>
      <span>{label}</span>
      <span className="text-[11px] font-black">{style.icon}</span>
    </span>
  )
}

/**
 * 推导卡片边框 className — 优先级排序：failed > stale > generating > published > normal
 */
export function getPriorityBorderClass(priority: CardPrioritySignal | undefined, isActive: boolean): string {
  if (isActive) return 'border-cyan-300 bg-cyan-50 shadow-sm'
  switch (priority) {
    case 'failed':
      return 'border-red-300 bg-red-50/40 shadow-sm'
    case 'stale':
      return 'border-amber-300 bg-amber-50/40 shadow-sm'
    case 'generating':
      return 'border-cyan-200 bg-cyan-50/50 shadow-sm'
    case 'published':
      return 'border-green-200 bg-green-50/30'
    case 'normal':
    default:
      return 'border-slate-200 bg-white hover:border-cyan-200 hover:shadow-sm'
  }
}
