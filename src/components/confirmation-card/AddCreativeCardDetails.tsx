'use client'

import type { AddCreativeCardDetail } from '@/lib/ads-creative-card/display'

function Field({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? 'text-sm leading-relaxed text-me-charcoal' : 'text-sm text-me-charcoal'}>
      <span className="font-semibold text-me-charcoal/55">{label}</span>
      <span className={multiline ? 'mt-1 block whitespace-pre-wrap' : ''}>{value}</span>
    </div>
  )
}

export function AddCreativeCardDetails({
  detail,
  expiresLabel,
}: {
  detail: AddCreativeCardDetail
  expiresLabel: string
}) {
  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="shrink-0">
          {detail.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- factory public URL, not optimizable CDN
            <img
              src={detail.imageUrl}
              alt="待加的图片预览"
              width={200}
              height={200}
              className="max-h-[200px] max-w-[200px] rounded-lg border border-black/10 object-contain bg-me-charcoal/[0.03]"
            />
          ) : (
            <div className="flex h-[120px] w-[200px] items-center justify-center rounded-lg border border-dashed border-black/15 bg-me-charcoal/[0.03] text-xs text-me-charcoal/50">
              预览地址未记录
            </div>
          )}
          <p className="mt-2 max-w-[200px] break-all text-xs text-me-charcoal/55">{detail.imageFilename}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Field label="广告名称：" value={detail.adName} />
          <Field label="标题：" value={detail.headline} />
          <Field label="正文：" value={detail.primaryText} multiline />
          <Field label="按钮：" value={detail.ctaLabel} />
          <Field label="加到哪个广告组：" value={detail.adSetLabel} />
          <Field label="新广告状态：" value={detail.newAdStatusLabel} />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-me-charcoal/80">{detail.confirmSentence}</p>
      <p className="text-sm font-medium text-me-charcoal/70">{expiresLabel}</p>
    </div>
  )
}