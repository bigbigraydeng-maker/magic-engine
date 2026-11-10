'use client'

import { MeButton } from '@/components/ui/me-primitives'

interface Props {
  open: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** 放量草稿二次确认（Figma 4-2）；只拦 UI，仍走既有 stage-proposal 接口。 */
export function ScaleDraftConfirmDialog({ open, busy, onCancel, onConfirm }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scale-draft-title"
    >
      <div className="w-full max-w-md rounded-[24px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(26,26,26,.18)]">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#C2453A]/12 text-lg text-[#C2453A]">
          ⚠
        </div>
        <h2 id="scale-draft-title" className="text-center font-display text-base font-semibold text-[#1A1A1A]">
          要另外做一份「放量」草稿吗？
        </h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-black/70">
          <li>• 正在跑的这一版不会被改动，也不会自动批准。</li>
          <li>• 系统只会另建一份草稿；你看完再决定要不要批准。</li>
          <li>• 生成后页面会切到新草稿；记得切回正在执行的那一份。</li>
          <li>• 这不是立刻花钱；金额仍要等你批准后才生效。</li>
        </ul>
        <p className="mt-3 text-xs text-black/45">
          这个按钮和「标为稳住」「确认这一周」不是一类动作，所以单独问你一次。
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <MeButton type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            先不生成
          </MeButton>
          <MeButton
            type="button"
            variant="ghost"
            size="sm"
            className="border-[#C2453A]/40 text-[#C2453A] hover:bg-[#C2453A]/8"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '正在生成草稿…' : '生成草稿'}
          </MeButton>
        </div>
      </div>
    </div>
  )
}
