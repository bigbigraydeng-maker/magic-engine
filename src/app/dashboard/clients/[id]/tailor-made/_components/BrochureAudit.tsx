'use client';

import { useMemo, useState } from 'react';
import { auditBrochureImages, brochureAuditSummary } from '@/lib/tailor-made/brochure-audit';
import type { AuditFinding } from '@/lib/tailor-made/audit';
import type { TailorMadeBrochure } from '@/lib/tailor-made/brochure-types';

/**
 * 撞图体检面板。跟 ItineraryAudit 同一个视觉语言，检查的东西不同：
 * 那边看「空不空」，这边看「同一个城市板块里是不是有两张卡片用了同一张图」。
 *
 * 软提醒，不挡「标记已发送」——见 lib/tailor-made/brochure-audit.ts 顶部注释。
 */
export default function BrochureAudit({ brochure }: { brochure: TailorMadeBrochure }) {
  const findings = useMemo(() => auditBrochureImages(brochure), [brochure]);
  const [open, setOpen] = useState(false);

  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-[#5C8A4A]/25 bg-[#5C8A4A]/6 px-4 py-2.5 text-xs font-bold text-[#5C8A4A]">
        ✓ 没有撞图
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: '#B8860B40' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-black" style={{ color: '#B8860B' }}>
          · {brochureAuditSummary(findings)}
        </span>
        <span className="text-[11px] font-bold text-me-charcoal/40">{open ? '收起' : '看看是哪些'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-black/5 px-4 py-3">
          <ul className="space-y-1">
            {findings.map((f: AuditFinding, i) => (
              <li key={i} className="text-[11px] leading-relaxed">
                <span className="font-bold text-me-charcoal">{f.where}</span>
                <span className="text-me-charcoal/55"> —— {f.what}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-me-charcoal/45">
            这只是提醒，不影响能不能发——图库里实在挑不出第二张不一样的图时，
            换一张顾问自己拍的图，或者接受重复也是可以的，你自己拿主意。
          </p>
        </div>
      )}
    </div>
  );
}
