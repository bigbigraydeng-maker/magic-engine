'use client'

/**
 * ME2 产品地图控制台 —— 三视图。
 *
 * 顺序按「PM 打开是为了做决定」排(板桥 S1):等你拍板 → 各条线做到哪了 → 一件件看。
 * 依赖关系并进「一件件看」的行展开(板桥 S2),不做独立视图。
 */

import { Fragment, useMemo, useState } from 'react'
import {
  MeButton,
  MeChip,
  MePanel,
  MePanelHeader,
  MePill,
  MeStatCard,
  MeTable,
  MeTd,
  MeTh,
  MeTr,
} from '@/components/ui/me-primitives'
import { cx } from '@/components/ui/me-theme'
import { BUCKET_LABEL } from '@/lib/product-map/presenter'
import type { ComponentView, ConsolePresentation, DecisionView } from '@/lib/product-map/presenter'

type ViewKey = 'decisions' | 'lanes' | 'list' | 'search' | 'graph'

// 顺序:决策入口永远第一(板桥 S1);查阅类(查一件事 / 谁垫着谁)排最后,检索在关系图前(板桥建议 5)。
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'decisions', label: '等你拍板' },
  { key: 'lanes', label: '各条线做到哪了' },
  { key: 'list', label: '一件件看' },
  { key: 'search', label: '查一件事' },
  { key: 'graph', label: '谁垫着谁' },
]

// 「在不在跑」的颜色(节点主色):在跑 > 建到哪一步(板桥 M1)。
const BUCKET_COLOR: Record<string, string> = {
  operating: '#4B7A3A',
  built_not_live: '#B5852A',
  building: '#8A9099',
}
const BUCKET_TEXT: Record<string, string> = {
  operating: '在生产干活',
  built_not_live: '建好了但没通电',
  building: '还在建',
}
const LANE_PALETTE = ['#2F6E7A', '#4B7A3A', '#3E5C8A', '#6E4E8A', '#9A6B1E']

function trustTone(v: ConsolePresentation['trust']): 'track' | 'exec' | 'rej' {
  if (v.loadOutcome === 'sync_error' || v.health === 'run_error') return 'rej'
  if (v.loadOutcome === 'ok' && v.health === 'fresh') return 'track'
  return 'exec'
}

/** 数据可信度横幅:第一行给结论,不是并列状态词。 */
function TrustBanner({ trust }: { trust: ConsolePresentation['trust'] }) {
  const tone = trustTone(trust)
  const bg =
    tone === 'track'
      ? 'border-[#5C8A4A]/25 bg-[#5C8A4A]/[.06]'
      : tone === 'rej'
        ? 'border-[#C2453A]/30 bg-[#C2453A]/[.06]'
        : 'border-[#C4912E]/30 bg-[#C4912E]/[.06]'
  return (
    <MePanel className={bg}>
      <div className="font-display text-[15px] font-semibold text-me-charcoal">{trust.verdict}</div>
      <p className="mt-1 text-[13px] text-black/60">{trust.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <MeChip>{trust.freshnessText}</MeChip>
        <MeChip>来源:{trust.factsSourceLabel}</MeChip>
      </div>
      {trust.coverageGapPrs.length > 0 && (
        <p className="mt-2.5 rounded-lg bg-white/70 px-3 py-2 text-[12.5px] text-black/70">
          ⚠️ 有 {trust.coverageGapPrs.length} 个 PR 这轮没同步到(
          {trust.coverageGapPrs.map((n) => `#${n}`).join('、')})——
          <strong>相关条目的进度可能被低估</strong>,不是它们没做。
        </p>
      )}
      {trust.syncIssues.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-white/70 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-me-charcoal">这轮没拉全的部分</div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-black/65">
            {trust.syncIssues.slice(0, 8).map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
      )}
      {trust.registryWarnings.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-white/70 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-me-charcoal">
            这张表自己查出 {trust.registryWarnings.length} 处要留意的(agent 的活)
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-black/65">
            {trust.registryWarnings.slice(0, 5).map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}
      {trust.registryErrors.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-[#C2453A]/30 bg-white/70 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-[#C2453A]">
            这张表自己查出 {trust.registryErrors.length} 处对不上(agent 的活)
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-black/65">
            {trust.registryErrors.slice(0, 5).map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
        </div>
      )}
    </MePanel>
  )
}

function MaturityCell({ c }: { c: ComponentView }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] text-me-charcoal">{c.maturityLabel}</span>
      {c.isLegacy && <span className="text-[11px] text-black/40">{c.legacyNote}</span>}
    </div>
  )
}

function RunPill({ c }: { c: ComponentView }) {
  const tone = c.bucket === 'operating' ? 'track' : c.bucket === 'built_not_live' ? 'exec' : 'attn'
  return <MePill tone={tone}>{c.operationalLabel}</MePill>
}

function DecisionCard({ d, muted }: { d: DecisionView; muted?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-xl border p-4',
        muted ? 'border-black/10 bg-[#FBF8F3]' : 'border-me-ochre/30 bg-me-ochre/[.07]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[15px] font-semibold text-me-charcoal">{d.componentName}</span>
        <MeChip>{d.kindLabel}</MeChip>
        {typeof d.unresolvedThreads === 'number' && (
          <MeChip gold={d.unresolvedThreads > 0}>
            {d.unresolvedThreads > 0 ? `复审还有 ${d.unresolvedThreads} 条没解决` : '复审意见已清'}
          </MeChip>
        )}
      </div>
      {d.waitingReason && (
        <p className="mt-1.5 text-[12.5px] font-semibold text-black/55">{d.waitingReason}</p>
      )}
      <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-black/75">{d.decision}</p>
      {d.links.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {d.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12.5px] font-semibold text-me-ochre hover:underline"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function DecisionsView({ data }: { data: ConsolePresentation }) {
  return (
    <div className="space-y-6">
      <MePanel>
        <MePanelHeader title={`现在就等你一句话(${data.decisionsNow.length} 件)`} />
        {data.decisionsNow.length === 0 ? (
          <p className="text-[13px] text-black/55">目前没有需要你拍板的事。</p>
        ) : (
          <div className="space-y-3">
            {data.decisionsNow.map((d, i) => (
              <DecisionCard key={`${d.componentName}-${i}`} d={d} />
            ))}
          </div>
        )}
      </MePanel>

      {data.decisionsLater.length > 0 && (
        <MePanel>
          <MePanelHeader title={`条件到了会来找你(${data.decisionsLater.length} 件)`} />
          <p className="mb-3 text-[12.5px] text-black/50">
            这些还没轮到你 —— 每条下面写了在等什么,条件到了会自动挪到上面那一栏。
          </p>
          <div className="space-y-3">
            {data.decisionsLater.map((d, i) => (
              <DecisionCard key={`${d.componentName}-later-${i}`} d={d} muted />
            ))}
          </div>
        </MePanel>
      )}

      <MePanel>
        <MePanelHeader title={`卡住的事(${data.blocked.length} 件)`} />
        {data.blocked.length === 0 ? (
          <p className="text-[13px] text-black/55">没有卡住的事。</p>
        ) : (
          <div className="overflow-x-auto">
            <MeTable>
              <thead>
                <MeTr>
                  <MeTh>是什么</MeTh>
                  <MeTh>在不在跑</MeTh>
                  <MeTh>卡在哪</MeTh>
                </MeTr>
              </thead>
              <tbody>
                {data.blocked.map((c) => (
                  <MeTr key={c.key}>
                    <MeTd>
                      <div className="text-[13px] text-me-charcoal">{c.businessOutcome}</div>
                      <div className="text-[11.5px] text-black/45">{c.name}</div>
                    </MeTd>
                    <MeTd>
                      <RunPill c={c} />
                    </MeTd>
                    <MeTd>
                      <div className="space-y-1">
                        {c.blockers.map((b) => (
                          <div key={b.summary} className="text-[12.5px] text-black/70">
                            <MeChip>{b.kindLabel}</MeChip> <span className="ml-1">{b.summary}</span>
                          </div>
                        ))}
                        {c.blockedByUpstream.map((name) => (
                          <div key={name} className="text-[12.5px] text-black/55">
                            在等「{name}」先做完
                          </div>
                        ))}
                      </div>
                    </MeTd>
                  </MeTr>
                ))}
              </tbody>
            </MeTable>
          </div>
        )}
      </MePanel>
    </div>
  )
}

function LanesView({ data }: { data: ConsolePresentation }) {
  const [showUnclassified, setShowUnclassified] = useState(false)
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MeStatCard value={data.buckets.operating} label={BUCKET_LABEL.operating} tone="track" goldValue />
        <MeStatCard value={data.buckets.built_not_live} label={BUCKET_LABEL.built_not_live} tone="ochre" />
        <MeStatCard value={data.buckets.building} label={BUCKET_LABEL.building} tone="stone" />
      </section>

      {data.lanes.map((lane) => (
        <MePanel key={lane.laneLabel}>
          <MePanelHeader title={`${lane.laneLabel}(${lane.components.length})`} />
          <div className="space-y-2">
            {lane.components.map((c) => (
              <div
                key={c.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-black/[.07] bg-[#FBF8F3] px-3 py-2"
              >
                <RunPill c={c} />
                <span className="text-[13px] text-me-charcoal">{c.businessOutcome}</span>
                <span className="text-[11.5px] text-black/40">{c.name}</span>
                <span className="ml-auto text-[12px] text-black/55">{c.maturityLabel}</span>
                {c.isBlocked && <span className="text-[12px] text-[#C2453A]">● 卡住</span>}
                {c.isLegacy && (
                  <span className="w-full text-[11px] text-black/40">{c.legacyNote}</span>
                )}
              </div>
            ))}
          </div>
        </MePanel>
      ))}

      {data.unclassified.length > 0 && (
      <MePanel>
        <button
          type="button"
          onClick={() => setShowUnclassified((v) => !v)}
          className="text-[12.5px] text-black/50 hover:text-black/75"
        >
          {data.unclassified.length} 项代码活儿还没挂到具体事项上(agent 的活,不用你管){showUnclassified ? ' ▲' : ' ▼'}
        </button>
        {showUnclassified && (
          <ul className="mt-3 space-y-1">
            {data.unclassified.map((u) => (
              <li key={`${u.kind}-${u.number}`} className="text-[12.5px] text-black/65">
                <a href={u.url} target="_blank" rel="noreferrer" className="text-me-ochre hover:underline">
                  {u.kind === 'pr' ? 'PR' : 'Issue'} #{u.number}
                </a>{' '}
                {u.title}
              </li>
            ))}
          </ul>
        )}
      </MePanel>
      )}
    </div>
  )
}

function ComponentDetail({ c }: { c: ComponentView }) {
  return (
    <div className="space-y-3 rounded-lg border border-black/[.07] bg-[#FBF8F3] p-4">
      <p className="text-[13px] leading-relaxed text-black/75">{c.description}</p>

      <div className="flex flex-wrap gap-1.5">
        <MeChip>{c.typeLabel}</MeChip>
        {c.stageLabels.map((s) => (
          <MeChip key={s}>{s}</MeChip>
        ))}
      </div>

      {c.isLegacy ? (
        <div className="text-[12.5px] text-black/65">
          <strong className="text-me-charcoal">老系统:</strong>
          它天天在生产干活。这里只算它「接进新体系的程度」,所以看着分低不是问题。
        </div>
      ) : (
        <div className="text-[12.5px] text-black/65">
          <strong className="text-me-charcoal">现有证据只能证明到:</strong>
          {c.ceilingLabel} —— {c.ceilingReasonHuman}
          {c.evidenceUnverified && (
            <span className="ml-1 text-[#C4912E]">(这条是人手工填的,程序还没去复核)</span>
          )}
        </div>
      )}

      {c.productionEvidence.length > 0 && (
        <div className="rounded-lg border border-[#5C8A4A]/25 bg-[#5C8A4A]/[.06] px-3 py-2 text-[12.5px] text-black/75">
          <strong className="text-me-charcoal">真跑过:</strong>
          {c.productionEvidence.map((e) => (
            <div key={e.ref}>
              {e.observedAt ? `${e.observedAt} · ` : ''}
              {e.ref}
              {e.note ? `(${e.note})` : ''}
            </div>
          ))}
        </div>
      )}

      {c.coverageGapPrs.length > 0 && (
        <p className="text-[12.5px] text-[#C4912E]">
          ⚠️ 进度可能被低估:{c.coverageGapPrs.map((n) => `#${n}`).join('、')} 这轮没同步到。
        </p>
      )}

      {(c.upstream.length > 0 || c.downstream.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {c.upstream.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-black/40">要先有它</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {c.upstream.map((u) => (
                  <MeChip key={u.name}>
                    {u.name}({u.note})
                  </MeChip>
                ))}
              </div>
            </div>
          )}
          {c.downstream.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-black/40">它在等这件事</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {c.downstream.map((d) => (
                  <MeChip key={d.name}>
                    {d.name}({d.note})
                  </MeChip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(c.linkedPrs.length > 0 || c.linkedIssues.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {c.linkedPrs.map((pr) => (
            <a
              key={pr.url}
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-me-ochre hover:underline"
            >
              PR #{pr.number}({pr.stateLabel}
              {typeof pr.unresolvedThreads === 'number' && pr.unresolvedThreads > 0
                ? `,复审剩 ${pr.unresolvedThreads} 条`
                : ''}
              )↗
            </a>
          ))}
          {c.linkedIssues.map((i) => (
            <a
              key={i.url}
              href={i.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-black/55 hover:underline"
            >
              #{i.number}({i.stateLabel})↗
            </a>
          ))}
        </div>
      )}

      {c.nextMilestone && (
        <div className="text-[12.5px] text-black/65">
          <strong className="text-me-charcoal">下一步到:</strong>
          {c.nextMilestone.targetLabel}
          {c.nextMilestone.unlockedBy.length > 0 && (
            <span> —— 要先解决:{c.nextMilestone.unlockedBy.join(';')}</span>
          )}
        </div>
      )}

      <div className="text-[11.5px] text-black/40">谁在做:{c.ownerLabel}</div>
    </div>
  )
}

function ListView({ data }: { data: ConsolePresentation }) {
  const [lane, setLane] = useState<string>('全部')
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const laneOptions = useMemo(() => ['全部', ...data.lanes.map((l) => l.laneLabel)], [data.lanes])
  const rows = useMemo(
    () =>
      data.components.filter(
        (c) => (lane === '全部' || c.laneLabel === lane) && (!onlyBlocked || c.isBlocked),
      ),
    [data.components, lane, onlyBlocked],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          {laneOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLane(opt)}
              className={cx(
                'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                lane === opt ? 'bg-me-charcoal text-[#FBF8F3]' : 'text-black/55 hover:bg-me-stone',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOnlyBlocked((v) => !v)}
          className={cx(
            'rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition',
            onlyBlocked
              ? 'border-me-ochre bg-me-ochre/10 text-me-ochre'
              : 'border-black/10 bg-white text-black/55 hover:border-me-ochre/40',
          )}
        >
          只看卡住的
        </button>
        <span className="text-[12px] text-black/40">
          {rows.length} / {data.totalComponents}
        </span>
      </div>

      <MePanel>
        <div className="overflow-x-auto">
          <MeTable>
            <thead>
              <MeTr>
                <MeTh>这东西是干嘛的</MeTh>
                <MeTh>在不在跑</MeTh>
                <MeTh>建到哪一步</MeTh>
                <MeTh>哪条线</MeTh>
                <MeTh> </MeTh>
              </MeTr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.key}>
                  <MeTr>
                    <MeTd>
                      <div className="text-[13px] text-me-charcoal">{c.businessOutcome}</div>
                      <div className="text-[11.5px] text-black/45">
                        {c.name}
                        {c.isBlocked && <span className="ml-1.5 text-[#C2453A]">● 卡住</span>}
                      </div>
                    </MeTd>
                    <MeTd>
                      <RunPill c={c} />
                    </MeTd>
                    <MeTd>
                      <MaturityCell c={c} />
                    </MeTd>
                    <MeTd>{c.laneLabel}</MeTd>
                    <MeTd>
                      <button
                        type="button"
                        onClick={() => setOpenKey(openKey === c.key ? null : c.key)}
                        className="text-[12px] font-semibold text-me-ochre hover:underline"
                      >
                        {openKey === c.key ? '收起' : '详情'}
                      </button>
                    </MeTd>
                  </MeTr>
                  {openKey === c.key && (
                    <MeTr>
                      {/* colSpan 铺满 —— 否则详情被挤进第一列的宽度里 */}
                      <MeTd colSpan={5} className="p-0">
                        <div className="px-4 pb-4">
                          <ComponentDetail c={c} />
                        </div>
                      </MeTd>
                    </MeTr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </MeTable>
        </div>
      </MePanel>
    </div>
  )
}

// ── 查一件事:issue/PR 检索 ─────────────────────────────────────────────
function SearchView({ data }: { data: ConsolePresentation }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'pr' | 'issue'>('all')

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return data.catalog.filter((it) => {
      if (kind !== 'all' && it.kind !== kind) return false
      if (!ql) return true
      // id 参与不到匹配(catalog 里根本没有 id)——只在人话字段上搜(板桥必改 5)
      // 纯数字按编号精确/前缀匹配,不用子串——否则搜「86」会把 863/8600/1863 全冒出来,
      // 而 PM 多半是照着一个具体编号找(魏征实施后复审)。
      const isNumericQuery = /^\d+$/.test(ql)
      return (
        (isNumericQuery
          ? String(it.number) === ql || String(it.number).startsWith(ql)
          : String(it.number).includes(ql)) ||
        it.title.toLowerCase().includes(ql) ||
        it.components.some(
          (c) => c.name.toLowerCase().includes(ql) || c.businessOutcome.toLowerCase().includes(ql),
        )
      )
    })
  }, [data.catalog, q, kind])

  // 同步没开通 → catalog 全空:说清「要等同步」,不是「查无结果」(子牙 S4 / 板桥必改 9)
  if (data.catalog.length === 0) {
    return (
      <MePanel>
        <p className="text-[13px] text-black/60">
          还没有从 GitHub 同步到任何 issue / PR —— <strong>检索要等同步开通</strong>。
          同步跑起来后,这里就能按编号 / 标题 / 组件名查了。
        </p>
      </MePanel>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜编号 / 标题 / 组件名 —— 例:内核、863、审批"
          className="min-w-[240px] flex-1 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[14px] text-me-charcoal shadow-[0_1px_2px_rgba(26,26,26,.04)] outline-none placeholder:text-black/35 focus:border-me-ochre/50"
        />
        <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          {(
            [
              ['all', '全部'],
              ['pr', 'PR'],
              ['issue', 'Issue'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cx(
                'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                kind === k ? 'bg-me-charcoal text-[#FBF8F3]' : 'text-black/55 hover:bg-me-stone',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-black/40">
          {filtered.length} / {data.catalog.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <MePanel>
          <p className="text-[13px] text-black/60">
            没找到匹配的。如果你确定它存在,可能是同步还没覆盖到 —— agent 会处理,不代表它不存在。
          </p>
        </MePanel>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((it) => (
            <a
              key={`${it.kind}-${it.number}`}
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-xl border border-black/10 bg-white p-3.5 transition hover:border-me-ochre/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <MeChip>{it.kind === 'pr' ? 'PR' : 'Issue'}</MeChip>
                <span className="font-display text-[15px] font-semibold tabular-nums text-me-charcoal">
                  #{it.number}
                </span>
                <MeChip gold={it.stateLabel.includes('开着') || it.stateLabel.includes('草稿')}>
                  {it.stateLabel}
                </MeChip>
                <span className="text-[12.5px] text-me-ochre">在 GitHub 打开 ↗</span>
              </div>
              <div className="mt-1.5 text-[13.5px] text-me-charcoal">{it.title}</div>
              {/* 让 PM 把陌生编号挂回「哦这是那件事」——给业务人话名(板桥必改 6) */}
              {it.components.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-black/45">
                  还没挂到任何组件(老系统 / 或还没开工)—— 不代表它无关。
                </p>
              ) : (
                <div className="mt-1.5 space-y-0.5">
                  {it.components.map((c, ci) => (
                    <div key={`${c.name}-${ci}`} className="text-[12px] text-black/55">
                      属于「<span className="text-black/75">{c.name}</span>」· {c.businessOutcome} · {c.laneLabel}
                    </div>
                  ))}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 谁垫着谁:全局依赖图(横轴=先后)────────────────────────────────────
function GraphPanel({ data }: { data: ConsolePresentation }) {
  const [sel, setSel] = useState<string | null>(null)

  const laneColor = useMemo(() => {
    const m: Record<string, string> = {}
    data.lanes.forEach((l, i) => {
      m[l.laneLabel] = LANE_PALETTE[i % LANE_PALETTE.length]
    })
    return m
  }, [data.lanes])

  const connected = useMemo(() => data.graph.nodes.filter((n) => !n.isolated), [data.graph.nodes])
  const isolated = useMemo(() => data.graph.nodes.filter((n) => n.isolated), [data.graph.nodes])

  const layout = useMemo(() => {
    const NW = 148,
      NH = 46,
      COLGAP = 52,
      ROWGAP = 12,
      LEFT = 16,
      TOP = 10,
      LANEPAD = 30,
      LANEGAP = 14
    const colX = (d: number) => LEFT + d * (NW + COLGAP)
    const laneOrder = data.lanes
      .map((l) => l.laneLabel)
      .filter((ll) => connected.some((n) => n.laneLabel === ll))
    const pos: Record<string, { x: number; y: number }> = {}
    const bands: { label: string; top: number; height: number; color: string }[] = []
    let y = TOP
    let maxDepth = 0
    for (const n of connected) maxDepth = Math.max(maxDepth, n.depth)
    for (const ll of laneOrder) {
      const laneNodes = connected.filter((n) => n.laneLabel === ll)
      const byDepth: Record<number, typeof laneNodes> = {}
      for (const n of laneNodes) (byDepth[n.depth] = byDepth[n.depth] || []).push(n)
      const maxRows = Math.max(1, ...Object.values(byDepth).map((a) => a.length))
      const bandTop = y
      const bandH = LANEPAD + maxRows * (NH + ROWGAP)
      for (const d of Object.keys(byDepth)) {
        byDepth[+d].forEach((n, i) => {
          pos[n.key] = { x: colX(+d), y: bandTop + LANEPAD + i * (NH + ROWGAP) }
        })
      }
      bands.push({ label: ll, top: bandTop, height: bandH, color: laneColor[ll] })
      y = bandTop + bandH + LANEGAP
    }
    return { pos, bands, width: colX(maxDepth) + NW + 14, height: y - LANEGAP + 10, NW, NH }
  }, [connected, data.lanes, laneColor])

  const neighbourKeys = useMemo(() => {
    const s = new Set<string>()
    if (!sel) return s
    s.add(sel)
    for (const e of data.graph.edges) {
      if (e.fromKey === sel) s.add(e.toKey)
      if (e.toKey === sel) s.add(e.fromKey)
    }
    return s
  }, [sel, data.graph.edges])

  const nameOf = (k: string) => data.graph.nodes.find((n) => n.key === k)?.name ?? '(未知)'
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
  const selNode = sel ? data.graph.nodes.find((n) => n.key === sel) : null
  const selUp = sel ? data.graph.edges.filter((e) => e.toKey === sel) : []
  const selDown = sel ? data.graph.edges.filter((e) => e.fromKey === sel) : []
  const { pos, bands, width, height, NW, NH } = layout
  const edges = data.graph.edges.filter((e) => pos[e.fromKey] && pos[e.toKey])

  return (
    <div className="space-y-4">
      {/* 导览:别把横轴读成时间表(板桥必改 1) */}
      <MePanel>
        <p className="text-[13px] text-black/70">
          <strong className="text-me-charcoal">怎么读:</strong>越靠左的,是越底层、别人要先靠它才能动的(总闸、口径、插头);越靠右越依赖别人。
          <strong> 这不是「先做哪个后做哪个」的时间表,是「谁垫在谁下面」。</strong>
        </p>
        <p className="mt-1.5 text-[12.5px] text-black/50">
          日常拍板不用看这个 —— 想一眼看清全局怎么搭起来时才点它。竖着按业务线分组;颜色是「在不在跑」。
        </p>
      </MePanel>

      {/* 图例(板桥必改 2) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-black/10 bg-white px-4 py-3 text-[12px] text-black/60">
        <span className="font-semibold text-black/45">颜色=在不在跑</span>
        {(['operating', 'built_not_live', 'building'] as const).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span
              className={cx('h-3 w-3 rounded-sm', b === 'building' && 'motion-safe:animate-pulse')}
              style={{ background: BUCKET_COLOR[b] }}
            />
            {BUCKET_TEXT[b]}
            {b === 'building' && <span className="text-black/40">(跳动的=正在开发中)</span>}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden="true">
            {/* 跟画布真箭头同一个灰(#B7B2A8),别跟「还在建」状态色(#8A9099)撞(板桥实施后复审) */}
            <line x1="0" y1="4" x2="20" y2="4" stroke="#B7B2A8" strokeWidth="1.5" />
            <polygon points="20,1 26,4 20,7" fill="#B7B2A8" />
          </svg>
          箭头:左边这件要先有,右边才动
        </span>
      </div>

      {connected.length === 0 ? (
        // 没有任何已登记依赖时,画布会是一条几乎看不见的空条 —— 那不是「图坏了」,
        // 是「还没登记依赖」,必须说出来,不能让空白被读成故障(魏征实施后复审)
        <MePanel>
          <p className="text-[13px] text-black/60">还没有任何登记的依赖关系,所以暂时画不出图。</p>
        </MePanel>
      ) : (
      <MePanel className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="max-w-full"
          role="img"
          aria-label="全局依赖图:横轴为谁垫着谁,纵向按业务线分组"
          onClick={() => setSel(null)}
        >
          <defs>
            <marker id="pm-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="#B7B2A8" />
            </marker>
            <marker id="pm-arrow-on" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="#3A3A3A" />
            </marker>
          </defs>
          {bands.map((b) => (
            <g key={b.label}>
              <rect x={0} y={b.top} width={width} height={b.height - 2} rx={10} fill={b.color} opacity={0.06} />
              <text x={12} y={b.top + 17} fontSize={12} fontWeight={700} fill={b.color}>
                {b.label}
              </text>
            </g>
          ))}
          {edges.map((e, i) => {
            const a = pos[e.fromKey],
              z = pos[e.toKey]
            const x1 = a.x + NW,
              y1 = a.y + NH / 2,
              x2 = z.x,
              y2 = z.y + NH / 2
            const mx = (x1 + x2) / 2
            const on = !!sel && (e.fromKey === sel || e.toKey === sel)
            const dim = !!sel && !on
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 4},${y2}`}
                fill="none"
                stroke={on ? '#3A3A3A' : '#B7B2A8'}
                strokeWidth={on ? 2 : 1.3}
                opacity={dim ? 0.12 : 0.85}
                markerEnd={`url(#pm-arrow${on ? '-on' : ''})`}
              />
            )
          })}
          {connected.map((n) => {
            const p = pos[n.key]
            if (!p) return null
            const c = BUCKET_COLOR[n.bucket]
            const dim = !!sel && !neighbourKeys.has(n.key)
            return (
              <g
                key={n.key}
                onClick={(e) => {
                  e.stopPropagation() // 别冒泡到背景的「点空白取消选中」(魏征实施后复审)
                  setSel(sel === n.key ? null : n.key)
                }}
                style={{ cursor: 'pointer' }}
                opacity={dim ? 0.32 : 1}
              >
                <title>{n.name}</title>
                <rect
                  x={p.x}
                  y={p.y}
                  width={NW}
                  height={NH}
                  rx={9}
                  fill="#fff"
                  stroke={c}
                  strokeWidth={sel === n.key ? 2.4 : 1.4}
                />
                {/* 「还在建」的件跳动提示「正在开发中」——静态色块+文字本就够区分,
                    动画是锦上添花,所以 prefers-reduced-motion 时安心退化成静态(不额外做降级标记)。 */}
                <rect
                  x={p.x}
                  y={p.y}
                  width={4}
                  height={NH}
                  rx={2}
                  fill={c}
                  className={n.bucket === 'building' ? 'motion-safe:animate-pulse' : undefined}
                />
                <text x={p.x + 13} y={p.y + 19} fontSize={12.5} fontWeight={600} fill="#2A2A2A">
                  {trunc(n.name, 9)}
                </text>
                <text x={p.x + 13} y={p.y + 35} fontSize={10} fill="#8A8A8A">
                  {BUCKET_TEXT[n.bucket]}
                  {n.bucket === 'building' && (
                    <tspan className="motion-safe:animate-pulse" fill="#B5852A">
                      {' '}●
                    </tspan>
                  )}
                </text>
              </g>
            )
          })}
        </svg>
      </MePanel>
      )}

      {selNode && (
        <MePanel>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[15px] font-semibold text-me-charcoal">{selNode.name}</span>
            <MeChip>{selNode.laneLabel}</MeChip>
            <MePill
              tone={
                selNode.bucket === 'operating' ? 'track' : selNode.bucket === 'built_not_live' ? 'exec' : 'attn'
              }
            >
              {BUCKET_TEXT[selNode.bucket]}
            </MePill>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              {/* 跟「一件件看」行展开用同一套词(要先有它/它在等这件事),别让 PM 对照时要多想一步(板桥实施后复审) */}
              <div className="text-[11px] uppercase tracking-wide text-black/40">要先有它</div>
              {selUp.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-black/45">不依赖别的组件 —— 是条地基。</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selUp.map((e, i) => (
                    <MeChip key={i}>
                      {nameOf(e.fromKey)}({e.typeLabel})
                    </MeChip>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-black/40">它在等这件事</div>
              {selDown.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-black/45">目前没有别的组件依赖它。</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selDown.map((e, i) => (
                    <MeChip key={i}>
                      {nameOf(e.toKey)}({e.typeLabel})
                    </MeChip>
                  ))}
                </div>
              )}
            </div>
          </div>
        </MePanel>
      )}

      {isolated.length > 0 && (
        <MePanel>
          <MePanelHeader title={`这些暂时没登记依赖关系(${isolated.length})`} />
          <p className="mb-2.5 text-[12.5px] text-black/55">
            可能是<strong>真的独立</strong>,也可能是<strong>关系还没登记</strong> —— 两者不同,先如实标出来,不当成「确认无依赖」。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {isolated.map((n) => (
              <span
                key={n.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-1 text-[12px] text-black/60"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[n.bucket] }} />
                {n.name}
              </span>
            ))}
          </div>
        </MePanel>
      )}
    </div>
  )
}

export default function ProductMapClient({ data }: { data: ConsolePresentation }) {
  const [view, setView] = useState<ViewKey>('decisions')

  return (
    <div className="font-sans">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">ME2 产品地图</h1>
          <p className="mt-0.5 text-[13px] text-black/55">
            这是 ME2 自己的建设进度表,数据来自代码仓库 + GitHub。<strong>不含客户业绩数据。</strong>
          </p>
        </div>
        <MeButton href="/dashboard" variant="secondary" size="sm">
          ← 回总览
        </MeButton>
      </header>

      <div className="space-y-6 px-8 py-7">
        <TrustBanner trust={data.trust} />

        <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          {VIEWS.map((v) => {
            const active = view === v.key
            const count =
              v.key === 'decisions'
                ? data.decisionsNow.length
                : v.key === 'list'
                  ? data.totalComponents
                  : v.key === 'search'
                    ? data.catalog.length
                    : undefined
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={cx(
                  'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                  active ? 'bg-me-charcoal text-[#FBF8F3]' : 'text-black/55 hover:bg-me-stone',
                )}
              >
                {v.label}
                {count !== undefined && (
                  <span className={cx('ml-1.5 tabular-nums', active ? 'text-[#FBF8F3]/65' : 'text-black/35')}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {view === 'decisions' && <DecisionsView data={data} />}
        {view === 'lanes' && <LanesView data={data} />}
        {view === 'list' && <ListView data={data} />}
        {view === 'search' && <SearchView data={data} />}
        {view === 'graph' && <GraphPanel data={data} />}
      </div>
    </div>
  )
}
