'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { ZhugeActionRow } from '@/app/api/clients/[id]/zhuge/latest-actions/route';
import {
  FLYWHEEL_BADGE,
  IMPACT_CLS,
  EFFORT_CLS,
  IMPACT_ZH,
  EFFORT_ZH,
} from '@/lib/zhuge/display-constants';
import { getLubanRoute } from '@/lib/zhuge/luban-router';

export type { ZhugeActionRow };

/** Collapsed view shows this many action cards; the rest fold behind a toggle. */
const COLLAPSED_COUNT = 2;

const EXEC_MODE_ZH: Record<string, { label: string }> = {
  in_house:        { label: '鲁班可自动执行' },
  third_party:     { label: '外部平台' },
  external_manual: { label: 'FDE 人工执行' },
};

const ACTION_TYPE_ZH: Record<string, string> = {
  generate_seo_geo_blog_post:       '生成 SEO+GEO 双信号博客',
  generate_geo_directive:           '部署 GEO 搜索优化指令',
  publish_geo_snippet:              '发布 GEO 内容片段',
  launch_social_campaign:           '启动社媒营销活动',
  generate_social_post:             '生成社媒帖子',
  generate_review_solicitation_post:'发布口碑邀评帖子',
  setup_google_ads:                 '搭建 Google Ads 广告',
  setup_meta_ads:                   '搭建 Meta 广告系列',
  fix_site_seo_issues:              '修复站点 SEO 技术问题',
  improve_ai_visibility:            '提升 AI 搜索品牌曝光',
  update_google_business_profile:   '完善 Google 商业档案',
};

// ── Action card (cached results display) ─────────────────────────────────────

function ActionCard({ action, clientId }: { action: ZhugeActionRow; clientId: string }) {
  const fw = FLYWHEEL_BADGE[action.flywheel] ?? {
    label: action.flywheel,
    cls: 'bg-me-ivory text-me-charcoal/60 border-black/10',
  };
  const p = action.payload;
  const execMode = EXEC_MODE_ZH[action.execution_mode] ?? { label: action.execution_mode };
  const actionNameZh = ACTION_TYPE_ZH[action.action_type] ?? action.action_type;
  const route = getLubanRoute(p.executable_by ?? null, clientId);

  return (
    <div className="flex gap-4 rounded-xl border border-black/10 bg-white p-4 transition-all hover:border-me-ochre/30 hover:shadow-sm">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-me-ochre/10 text-sm font-black text-me-ochre">
        {p.rank}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${fw.cls}`}>
            {fw.label}
          </span>
          <span className="text-base font-black text-me-charcoal">
            {actionNameZh}
          </span>
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${IMPACT_CLS[p.expected_impact] ?? ''}`}>
              {IMPACT_ZH[p.expected_impact] ?? p.expected_impact}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${EFFORT_CLS[p.effort] ?? ''}`}>
              {EFFORT_ZH[p.effort] ?? p.effort}
            </span>
          </div>
        </div>

        <p className="mb-3 text-sm font-semibold leading-relaxed text-me-charcoal/60">{p.why_now}</p>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-me-charcoal/45">
            <span className="h-2 w-2 rounded-full bg-me-ochre/70" />
            <span>{execMode.label}</span>
          </div>
          {route.kind === 'navigate' && (
            <Link
              href={route.href}
              className="shrink-0 rounded-lg border border-me-ochre/30 px-3 py-1.5 text-xs font-black text-me-ochre transition-colors hover:border-me-ochre/40 hover:bg-me-ochre/10"
            >
              {route.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

type WidgetState = 'loading' | 'empty' | 'loaded';

export interface ZhugePriorityWidgetProps {
  clientId: string;
  /** Whether 张骞 discovery is confirmed (gate for "询问诸葛亮" CTA). */
  discoveryConfirmed: boolean;
  /** Increment to trigger a cache refresh (e.g. after ZhugeDrawer completes). */
  refreshKey?: number;
  /** Called when user clicks "询问诸葛亮" or "重新计算". */
  onAskZhuge: () => void;
}

export function ZhugePriorityWidget({
  clientId,
  discoveryConfirmed,
  refreshKey = 0,
  onAskZhuge,
}: ZhugePriorityWidgetProps) {
  const [state, setState] = useState<WidgetState>('loading');
  const [actions, setActions] = useState<ZhugeActionRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadLatest = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/clients/${clientId}/zhuge/latest-actions`);
      if (!res.ok) { setState('empty'); return; }
      const data = await res.json() as {
        success: boolean;
        actions: ZhugeActionRow[];
        generated_at: string | null;
      };
      if (data.success && data.actions.length > 0) {
        setActions(data.actions);
        setGeneratedAt(data.generated_at);
        setState('loaded');
      } else {
        setState('empty');
      }
    } catch {
      setState('empty');
    }
  }, [clientId]);

  // Reload on mount and whenever refreshKey changes
  useEffect(() => { void loadLatest(); }, [loadLatest, refreshKey]);

  // ── Loading skeleton ──
  if (state === 'loading') {
    return (
      <div className="h-28 animate-pulse rounded-xl border border-black/10 bg-white p-4" />
    );
  }

  // ── Empty (no prior session) ──
  if (state === 'empty') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-me-ochre/30 bg-me-ochre/10 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-charcoal text-xs font-black text-white">ST</span>
          <div>
            <p className="text-sm font-black text-me-charcoal">诸葛亮 · 优先行动</p>
            <p className="mt-0.5 text-xs font-semibold text-me-charcoal/55">
              {discoveryConfirmed
                ? '尚无分析结果。点击「询问诸葛亮」打开 AI 分析抽屉。'
                : '请先完成张骞品牌扫描，再询问诸葛亮。'}
            </p>
          </div>
        </div>
        {discoveryConfirmed && (
          <button
            onClick={onAskZhuge}
            className="shrink-0 rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-charcoal/85"
          >
            询问诸葛亮 →
          </button>
        )}
      </div>
    );
  }

  // ── Loaded — show cached actions ──
  const canCollapse = actions.length > COLLAPSED_COUNT;
  const visibleActions = expanded ? actions : actions.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      {/* Widget header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-ochre/10 text-xs font-black text-me-ochre">ST</span>
          <div>
            <p className="text-base font-black text-me-charcoal">诸葛亮 · 优先行动清单</p>
            {generatedAt && (
              <p className="text-xs font-semibold text-me-charcoal/45">
                生成于{' '}
                {new Date(generatedAt).toLocaleDateString('zh-CN', {
                  timeZone: 'Pacific/Auckland',
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onAskZhuge}
          className="flex min-h-10 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-black text-me-charcoal/60 transition-colors hover:border-me-ochre/30 hover:text-me-ochre"
        >
          重新计算
        </button>
      </div>

      {/* Cached action cards — collapsed to COLLAPSED_COUNT until expanded */}
      <div className="space-y-2">
        {visibleActions.map((action) => (
          <ActionCard key={action.id} action={action} clientId={clientId} />
        ))}
      </div>

      {canCollapse && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded-lg border border-black/10 py-2 text-center text-xs font-black text-me-charcoal/55 transition-colors hover:border-me-ochre/30 hover:text-me-ochre"
        >
          {expanded ? '收起 ↑' : `展开剩余 ${actions.length - COLLAPSED_COUNT} 项 ↓`}
        </button>
      )}
    </div>
  );
}
