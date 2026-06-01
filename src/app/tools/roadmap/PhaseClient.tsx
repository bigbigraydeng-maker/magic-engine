'use client'

import { useState, useEffect, useCallback } from 'react'
import { Phase, PhaseStatus, FlywheelTag, searchPhases, PHASES } from './phaseData'
import ArchDiagram from './ArchDiagram'

type ViewMode = 'phases' | 'arch'

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<PhaseStatus, { label: string; color: string; bg: string; dot: string }> = {
  done:    { label: '✅ 已完成', color: '#166534', bg: '#dcfce7', dot: '#16a34a' },
  active:  { label: '🔄 进行中', color: '#92400e', bg: '#fef3c7', dot: '#d97706' },
  planned: { label: '📋 规划中', color: '#374151', bg: '#f3f4f6', dot: '#9ca3af' },
  paused:  { label: '⏸ 已暂缓', color: '#6b7280', bg: '#f9fafb', dot: '#d1d5db' },
}

const TAG_COLORS: Record<FlywheelTag, string> = {
  seo:      '#dbeafe',
  geo:      '#e0e7ff',
  ads:      '#fef3c7',
  social:   '#fce7f3',
  content:  '#f0fdf4',
  infra:    '#f3f4f6',
  ux:       '#ecfdf5',
  security: '#fee2e2',
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function phaseIdToFindPhase(id: string): Phase | undefined {
  return PHASES.find(p => p.id === id)
}

// ── Commit types ─────────────────────────────────────────────────────────────
interface Commit { sha: string; message: string; author: string; date: string; url: string }

// ── Main Component ────────────────────────────────────────────────────────────
export default function PhaseClient() {
  const [view, setView] = useState<ViewMode>('phases')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<PhaseStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState<FlywheelTag | 'all'>('all')
  const [selected, setSelected] = useState<Phase | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(true)
  const [commitsError, setCommitsError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  // filtered results
  const results = searchPhases(query).filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (tagFilter !== 'all' && !p.tags.includes(tagFilter)) return false
    return true
  })

  const fetchCommits = useCallback(async () => {
    try {
      const res = await fetch('/api/tools/github-commits', { cache: 'no-store' })
      const data = await res.json()
      if (data.commits) setCommits(data.commits)
      if (data.error) setCommitsError(data.error)
      setLastRefresh(new Date())
    } catch {
      setCommitsError('无法连接 GitHub API')
    } finally {
      setCommitsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCommits()
    const interval = setInterval(fetchCommits, 60000)
    return () => clearInterval(interval)
  }, [fetchCommits])

  // keyboard shortcut: Esc to close detail
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div style={{ fontFamily: '-apple-system, "Segoe UI", Arial, sans-serif', background: '#0f172a', minHeight: '100vh', color: '#e2e8f0' }}>
      {/* ── Top Bar ── */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 20px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9' }}>⚙️ Magic Engine — Roadmap Dictionary</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Phase 搜索 · 依赖链 · 架构图 · Git 动态</div>
        </div>

        {/* Search — only relevant in phases view */}
        {view === 'phases' && (
          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='搜索 Phase ID（如 phase 18, 12.a, 7.3）或关键词（如 memory, ads）…'
              style={{
                width: '100%', padding: '8px 14px', borderRadius: 8,
                background: '#0f172a', border: '1px solid #334155',
                color: '#f1f5f9', fontSize: 13, outline: 'none',
              }}
              autoFocus
            />
          </div>
        )}
        {view === 'arch' && <div style={{ flex: 1 }} />}

        {/* View toggle tabs */}
        <div style={{ display: 'flex', background: '#0f172a', borderRadius: 8, padding: 2, gap: 2 }}>
          <button
            onClick={() => setView('phases')}
            style={{
              padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: view === 'phases' ? '#3b82f6' : 'transparent',
              color: view === 'phases' ? '#fff' : '#64748b',
            }}
          >
            📋 Phase 字典
          </button>
          <button
            onClick={() => setView('arch')}
            style={{
              padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: view === 'arch' ? '#7c3aed' : 'transparent',
              color: view === 'arch' ? '#fff' : '#64748b',
            }}
          >
            🗺️ 架构图
          </button>
        </div>

        <a href="https://github.com/bigbigraydeng-maker/magic-engine" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          📂 GitHub
        </a>
      </div>

      {/* ── Architecture View ── */}
      {view === 'arch' && <ArchDiagram />}

      {/* ── Phase Dictionary View ── */}
      {view === 'phases' && (
        <div style={{ display: 'flex', gap: 0 }}>
          {/* Left Panel: Phase Dictionary */}
          <div style={{ flex: 1, minWidth: 0, padding: '16px 20px', overflowX: 'hidden' }}>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {(['all', 'done', 'active', 'planned', 'paused'] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  style={{
                    padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: statusFilter === s ? '#3b82f6' : '#1e293b',
                    color: statusFilter === s ? '#fff' : '#94a3b8',
                  }}>
                  {s === 'all' ? '全部' : STATUS_META[s].label}
                </button>
              ))}
              <div style={{ width: 1, background: '#334155', margin: '0 4px' }} />
              {(['all', 'seo', 'geo', 'ads', 'social', 'infra', 'security'] as const).map(t => (
                <button key={t} onClick={() => setTagFilter(t as FlywheelTag | 'all')}
                  style={{
                    padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: tagFilter === t ? '#7c3aed' : '#1e293b',
                    color: tagFilter === t ? '#fff' : '#94a3b8',
                  }}>
                  {t === 'all' ? '全飞轮' : t.toUpperCase()}
                </button>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569', alignSelf: 'center' }}>
                {results.length} / {PHASES.length} 个 Phase
              </span>
            </div>

            {/* Phase Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {results.map(phase => {
                const sm = STATUS_META[phase.status]
                const isSelected = selected?.id === phase.id
                return (
                  <div key={phase.id} onClick={() => setSelected(isSelected ? null : phase)}
                    style={{
                      background: isSelected ? '#1e3a5f' : '#1e293b',
                      border: `1.5px solid ${isSelected ? '#3b82f6' : '#334155'}`,
                      borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
                      transition: 'all .15s',
                      boxShadow: isSelected ? '0 0 0 3px rgba(59,130,246,.2)' : 'none',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                      <span style={{ background: '#0f172a', color: '#94a3b8', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        Phase {phase.id}
                      </span>
                      <span style={{ background: sm.bg, color: sm.color, fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>
                        {sm.label}
                      </span>
                      {phase.pr && (
                        <span style={{ background: '#312e81', color: '#a5b4fc', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 5, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                          {phase.pr}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9', marginBottom: 4, lineHeight: 1.4 }}>{phase.name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginBottom: 8 }}>{phase.description}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {phase.tags.map(t => (
                        <span key={t} style={{ background: TAG_COLORS[t], color: '#374151', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10 }}>{t}</span>
                      ))}
                      {phase.completedDate && (
                        <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>{phase.completedDate}</span>
                      )}
                    </div>
                    {phase.notes && (
                      <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24', background: '#292524', borderRadius: 5, padding: '4px 8px' }}>{phase.notes}</div>
                    )}
                  </div>
                )
              })}
              {results.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#475569', padding: '40px 0', fontSize: 14 }}>
                  没有找到 &ldquo;{query}&rdquo; 相关的 Phase。试试 &ldquo;18&rdquo; / &ldquo;phase 12&rdquo; / &ldquo;memory&rdquo;
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Detail + Git Feed */}
          <div style={{ width: 360, flexShrink: 0, borderLeft: '1px solid #1e293b', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 65px)', position: 'sticky', top: 65 }}>
            {/* Phase Detail */}
            <div style={{ flex: selected ? '0 0 auto' : '0 0 0', overflow: 'hidden', transition: 'flex .2s', maxHeight: selected ? 500 : 0, overflowY: 'auto', background: '#1e293b', borderBottom: selected ? '1px solid #334155' : 'none' }}>
              {selected && <PhaseDetail phase={selected} onClose={() => setSelected(null)} />}
            </div>

            {/* Git Feed */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>📡 Git 最新推送</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#475569' }}>更新于 {lastRefresh.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <button onClick={fetchCommits}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer' }}>
                    ↺
                  </button>
                </div>
              </div>

              {commitsLoading && (
                <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>加载中…</div>
              )}
              {commitsError && !commitsLoading && (
                <div style={{ color: '#fbbf24', fontSize: 12, background: '#292524', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                  ⚠️ {commitsError}<br />
                  <span style={{ color: '#6b7280', fontSize: 11 }}>请在 Render 后台添加 GITHUB_TOKEN 环境变量</span>
                </div>
              )}
              {commits.map((c, i) => (
                <CommitCard key={i} commit={c} />
              ))}
              {!commitsLoading && commits.length === 0 && !commitsError && (
                <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>暂无提交记录</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Phase Detail Panel ────────────────────────────────────────────────────────
function PhaseDetail({ phase, onClose }: { phase: Phase; onClose: () => void }) {
  const sm = STATUS_META[phase.status]
  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', marginBottom: 3 }}>Phase {phase.id}</div>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9', lineHeight: 1.3 }}>{phase.name}</div>
          <div style={{ marginTop: 4 }}>
            <span style={{ background: sm.bg, color: sm.color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>{sm.label}</span>
            {phase.completedDate && <span style={{ fontSize: 11, color: '#475569', marginLeft: 8 }}>{phase.completedDate}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: '#0f172a', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '2px 6px', borderRadius: 5 }}>✕</button>
      </div>

      <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, marginBottom: 10 }}>{phase.detail}</p>

      {phase.notes && (
        <div style={{ background: '#292524', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#fbbf24', marginBottom: 10 }}>{phase.notes}</div>
      )}

      {/* Dependencies */}
      {phase.dependsOn.length > 0 && (
        <DetailSection title="依赖（先完成这些）">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {phase.dependsOn.map(id => {
              const dep = phaseIdToFindPhase(id)
              return (
                <span key={id} style={{ background: '#1e3a5f', color: '#93c5fd', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, fontFamily: 'monospace' }}>
                  {id} {dep ? `· ${dep.name.slice(0, 16)}` : ''}
                  {dep && <span style={{ marginLeft: 3 }}>{dep.status === 'done' ? '✅' : '🔄'}</span>}
                </span>
              )
            })}
          </div>
        </DetailSection>
      )}

      {/* Blocks */}
      {phase.blocks.length > 0 && (
        <DetailSection title="解锁（完成后可做）">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {phase.blocks.map(id => (
              <span key={id} style={{ background: '#1a2e1a', color: '#86efac', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, fontFamily: 'monospace' }}>Phase {id}</span>
            ))}
          </div>
        </DetailSection>
      )}

      {/* Sub-tasks */}
      {phase.subTasks && phase.subTasks.length > 0 && (
        <DetailSection title="子任务">
          {phase.subTasks.map(t => (
            <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
              <span style={{ fontSize: 13, marginTop: 1 }}>{t.done ? '✅' : '⬜'}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b', whiteSpace: 'nowrap', marginTop: 2 }}>{t.id}</span>
              <span style={{ fontSize: 12, color: t.done ? '#86efac' : '#94a3b8' }}>{t.title}</span>
            </div>
          ))}
        </DetailSection>
      )}

      {/* Key files */}
      {phase.keyFiles.length > 0 && (
        <DetailSection title="关键文件">
          {phase.keyFiles.map(f => (
            <div key={f} style={{ fontFamily: 'monospace', fontSize: 10, color: '#7dd3fc', background: '#0f172a', padding: '3px 6px', borderRadius: 4, marginBottom: 3, wordBreak: 'break-all' }}>{f}</div>
          ))}
        </DetailSection>
      )}

      {/* Key tables */}
      {phase.keyTables.length > 0 && (
        <DetailSection title="Supabase 表">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {phase.keyTables.map(t => (
              <span key={t} style={{ fontFamily: 'monospace', fontSize: 11, color: '#c4b5fd', background: '#1e1b4b', padding: '2px 7px', borderRadius: 5 }}>{t}</span>
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: '.5px', marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  )
}

// ── Commit Card ───────────────────────────────────────────────────────────────
function CommitCard({ commit }: { commit: Commit }) {
  const type = commit.message.split(':')[0].toLowerCase()
  const typeColors: Record<string, string> = {
    feat: '#86efac', fix: '#fca5a5', refactor: '#c4b5fd',
    docs: '#93c5fd', chore: '#9ca3af', style: '#fdba74',
  }
  const color = typeColors[type] || '#94a3b8'

  return (
    <a href={commit.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ padding: '8px 10px', borderRadius: 7, background: '#0f172a', marginBottom: 6, border: '1px solid #1e293b', transition: 'border-color .1s' }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 3 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b', background: '#1e293b', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{commit.sha}</span>
          <span style={{ fontSize: 11, color: timeAgo(commit.date).includes('m') ? '#86efac' : '#94a3b8', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{timeAgo(commit.date)}</span>
        </div>
        <div style={{ fontSize: 12, color, fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word' }}>{commit.message}</div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{commit.author}</div>
      </div>
    </a>
  )
}
