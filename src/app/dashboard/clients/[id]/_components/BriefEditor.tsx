'use client';

import { useState } from 'react';
import type { MasterBrief, ContentPillar, BrandVoice, TargetAudience, VIColors } from '@/types/magic-engine';

interface Props {
  brief: MasterBrief;
  briefId: string;
  clientId: string;
  onUpdated: (b: MasterBrief) => void;
  onActivate: () => void;
}

type Section = 'basics' | 'voice' | 'audience' | 'content' | 'keywords' | 'vi' | 'narratives';

export function BriefEditor({ brief, briefId, clientId, onUpdated, onActivate }: Props) {
  const [open, setOpen] = useState<Section | null>('basics');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activating, setActivating] = useState(false);

  const toggle = (s: Section) => setOpen(prev => (prev === s ? null : s));

  const patch = async (fields: Partial<MasterBrief>) => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}/brief/${briefId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdated(json.brief);
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err) {
      setSaveMsg(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/brief/${briefId}/activate`, { method: 'POST' });
      if (res.ok) onActivate();
    } finally {
      setActivating(false);
    }
  };

  const isActive = brief.status === 'active';

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {isActive ? 'Active' : 'Draft'}
          </span>
          <span className="text-xs font-bold text-slate-400">v{brief.version}</span>
          {brief.model_used && (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">Strategy Engine</span>
          )}
          {saveMsg && <span className="text-xs font-bold text-emerald-700">{saveMsg}</span>}
        </div>
        {!isActive && (
          <button
            onClick={handleActivate}
            disabled={activating}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {activating ? 'Activating...' : 'Set as Active'}
          </button>
        )}
      </div>

      {/* Brand Basics — editable text */}
      <Section label="Brand Basics" id="basics" open={open} toggle={toggle}>
        <EditableText
          label="Brand Name"
          value={brief.brand_name ?? ''}
          onSave={v => patch({ brand_name: v })}
          saving={saving}
          placeholder="e.g. CTS Tours NZ"
        />
        <EditableText
          label="Core Proposition"
          value={brief.core_proposition ?? ''}
          onSave={v => patch({ core_proposition: v })}
          saving={saving}
          multiline
          placeholder="One sentence: what the brand does, for whom, and why it's different"
        />
      </Section>

      {/* Brand Voice — display only */}
      <Section label="Brand Voice" id="voice" open={open} toggle={toggle}>
        <VoiceDisplay voice={brief.brand_voice as BrandVoice | null} />
      </Section>

      {/* Target Audience — display only */}
      <Section label="Target Audience" id="audience" open={open} toggle={toggle}>
        <AudienceDisplay audience={brief.target_audience as TargetAudience | null} />
      </Section>

      {/* Content Pillars — display only */}
      <Section label="Content Pillars & Platforms" id="content" open={open} toggle={toggle}>
        <PillarsDisplay pillars={brief.content_pillars as ContentPillar[] | null} />
        <PlatformDisplay strategy={brief.platform_strategy as Record<string, { enabled: boolean; post_frequency: string; primary_content_type: string }> | null} />
      </Section>

      {/* Keywords — editable plain text */}
      <Section label="Keywords & Competitors" id="keywords" open={open} toggle={toggle}>
        <EditableList
          label="Keyword Seeds"
          values={brief.keyword_seeds ?? []}
          onSave={v => patch({ keyword_seeds: v })}
          saving={saving}
          placeholder="One keyword per line"
        />
        <EditableList
          label="Competitor Domains"
          values={brief.competitor_domains ?? []}
          onSave={v => patch({ competitor_domains: v })}
          saving={saving}
          placeholder="e.g. competitor.co.nz"
        />
      </Section>

      {/* Visual Identity — display only */}
      <Section label="Visual Identity" id="vi" open={open} toggle={toggle}>
        <VisualDisplay
          colors={brief.vi_colors as VIColors | null}
          styleKeywords={brief.vi_style_keywords ?? []}
          dos={brief.vi_dos ?? []}
          donts={brief.vi_donts ?? []}
        />
      </Section>

      {/* Brand Narratives — editable markdown */}
      <Section label="Brand Narratives" id="narratives" open={open} toggle={toggle}>
        <EditableText
          label="Brand Story"
          value={brief.brand_story_md ?? ''}
          onSave={v => patch({ brand_story_md: v })}
          saving={saving}
          multiline
          rows={6}
          placeholder="Brand narrative generated by Strategy Engine..."
        />
        <EditableText
          label="Style Guide"
          value={brief.style_guide_md ?? ''}
          onSave={v => patch({ style_guide_md: v })}
          saving={saving}
          multiline
          rows={5}
          placeholder="Writing style guidelines…"
        />
        <EditableText
          label="Competitive Notes"
          value={brief.competitive_notes_md ?? ''}
          onSave={v => patch({ competitive_notes_md: v })}
          saving={saving}
          multiline
          rows={4}
          placeholder="Competitive landscape notes…"
        />
      </Section>
    </div>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────────

function Section({ label, id, open, toggle, children }: {
  label: string; id: Section; open: Section | null; toggle: (s: Section) => void; children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <button
        onClick={() => toggle(id)}
        className="flex w-full items-center justify-between px-4 py-4 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
      >
        <span>{label}</span>
        <span className="text-xs font-black text-slate-400">{isOpen ? 'UP' : 'DN'}</span>
      </button>
      {isOpen && (
        <div className="space-y-4 border-t border-slate-50 px-4 pb-5 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-500">{children}</p>;
}

function EmptyState({ hint = 'Generate a brief or ask Strategy Engine to fill this in.' }: { hint?: string }) {
  return <p className="py-1 text-sm font-semibold italic text-slate-400">{hint}</p>;
}

function Chip({ label, color = 'gray' }: { label: string; color?: 'gray' | 'indigo' | 'green' | 'red' | 'amber' }) {
  const colors = {
    gray:   'bg-slate-100 text-slate-600',
    indigo: 'bg-cyan-50 text-cyan-800',
    green:  'bg-emerald-50 text-emerald-700',
    red:    'bg-red-50 text-red-700',
    amber:  'bg-amber-50 text-amber-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${colors[color]}`}>{label}</span>
  );
}

// ── Display components ─────────────────────────────────────────────────────────

function VoiceDisplay({ voice }: { voice: BrandVoice | null }) {
  if (!voice || !voice.tone_keywords?.length) return <EmptyState />;
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Tone</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {voice.tone_keywords.map(k => <Chip key={k} label={k} color="indigo" />)}
        </div>
      </div>
      {voice.avoid_keywords?.length > 0 && (
        <div>
          <FieldLabel>Avoid</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {voice.avoid_keywords.map(k => <Chip key={k} label={k} color="red" />)}
          </div>
        </div>
      )}
      <div className="flex gap-3">
        {voice.formality && (
          <div>
            <FieldLabel>Formality</FieldLabel>
            <Chip label={voice.formality} color="gray" />
          </div>
        )}
        {voice.emoji_usage && (
          <div>
            <FieldLabel>Emoji</FieldLabel>
            <Chip label={voice.emoji_usage} color="gray" />
          </div>
        )}
      </div>
    </div>
  );
}

function AudienceDisplay({ audience }: { audience: TargetAudience | null }) {
  if (!audience || !audience.interests?.length) return <EmptyState />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {audience.age_range && (
          <div><span className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Age </span><span className="text-gray-800">{audience.age_range}</span></div>
        )}
        {audience.location && (
          <div><span className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Location </span><span className="text-gray-800">{audience.location}</span></div>
        )}
        {audience.gender && (
          <div><span className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Gender </span><span className="text-gray-800">{audience.gender}</span></div>
        )}
      </div>
      {audience.interests?.length > 0 && (
        <div>
          <FieldLabel>Interests</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {audience.interests.map(i => <Chip key={i} label={i} color="indigo" />)}
          </div>
        </div>
      )}
      {audience.pain_points?.length > 0 && (
        <div>
          <FieldLabel>Pain Points</FieldLabel>
          <ul className="space-y-1">
            {audience.pain_points.map(p => (
              <li key={p} className="text-sm text-gray-700 flex gap-1.5 items-start">
                <span className="text-amber-500 mt-0.5">•</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {audience.platforms?.length > 0 && (
        <div>
          <FieldLabel>Active Platforms</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {audience.platforms.map(p => <Chip key={p} label={p} color="gray" />)}
          </div>
        </div>
      )}
    </div>
  );
}

function PillarsDisplay({ pillars }: { pillars: ContentPillar[] | null }) {
  if (!pillars?.length) return <EmptyState />;
  return (
    <div>
      <FieldLabel>Content Pillars</FieldLabel>
      <div className="space-y-2">
        {pillars.map(p => (
          <div key={p.id} className="bg-gray-50 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800">{p.name}</span>
              <span className="text-xs text-indigo-600 font-medium">{Math.round(p.post_ratio * 100)}%</span>
            </div>
            <p className="text-xs text-gray-500 mb-1.5">{p.description}</p>
            <div className="flex flex-wrap gap-1">
              {p.content_types?.map(t => <Chip key={t} label={t} color="indigo" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformDisplay({ strategy }: { strategy: Record<string, { enabled: boolean; post_frequency: string; primary_content_type: string }> | null }) {
  if (!strategy) return null;
  const enabled = Object.entries(strategy).filter(([, v]) => v.enabled);
  if (!enabled.length) return null;
  return (
    <div className="mt-3">
      <FieldLabel>Platform Strategy</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {enabled.map(([platform, cfg]) => (
          <div key={platform} className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-xs font-semibold text-gray-700 capitalize">{platform}</p>
            <p className="text-xs text-gray-500">{cfg.post_frequency} · {cfg.primary_content_type}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function VisualDisplay({ colors, styleKeywords, dos, donts }: {
  colors: VIColors | null; styleKeywords: string[]; dos: string[]; donts: string[];
}) {
  const hasContent = colors || styleKeywords.length || dos.length || donts.length;
  if (!hasContent) return <EmptyState />;
  return (
    <div className="space-y-3">
      {colors && Object.values(colors).some(Boolean) && (
        <div>
          <FieldLabel>Brand Colors</FieldLabel>
          <div className="flex gap-2">
            {Object.entries(colors).map(([name, hex]) => hex ? (
              <div key={name} className="text-center">
                <div className="w-8 h-8 rounded-lg border border-gray-200 shadow-sm" style={{ backgroundColor: hex }} />
                <p className="text-xs text-gray-400 mt-1 capitalize">{name}</p>
              </div>
            ) : null)}
          </div>
        </div>
      )}
      {styleKeywords.length > 0 && (
        <div>
          <FieldLabel>Style</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {styleKeywords.map(k => <Chip key={k} label={k} color="gray" />)}
          </div>
        </div>
      )}
      {(dos.length > 0 || donts.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {dos.length > 0 && (
            <div>
              <FieldLabel>Visual DOs</FieldLabel>
              <ul className="space-y-1">
                {dos.map(d => <li key={d} className="text-xs text-green-700 flex gap-1"><span>✓</span>{d}</li>)}
              </ul>
            </div>
          )}
          {donts.length > 0 && (
            <div>
              <FieldLabel>Visual DON&apos;Ts</FieldLabel>
              <ul className="space-y-1">
                {donts.map(d => <li key={d} className="text-xs text-red-600 flex gap-1"><span>✕</span>{d}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Editable components (only for simple text/list fields) ─────────────────────

function EditableText({ label, value: initial, onSave, saving, multiline = false, rows = 3, placeholder }: {
  label: string; value: string; onSave: (v: string) => void; saving: boolean;
  multiline?: boolean; rows?: number; placeholder?: string;
}) {
  const [val, setVal] = useState(initial);
  const base = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors';
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {multiline ? (
        <textarea
          value={val}
          onChange={e => setVal(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={`${base} resize-none`}
        />
      ) : (
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder={placeholder}
          className={base}
        />
      )}
      {val !== initial && (
        <div className="flex justify-end mt-1">
          <SaveButton onClick={() => onSave(val)} saving={saving} />
        </div>
      )}
    </div>
  );
}

function EditableList({ label, values, onSave, saving, placeholder }: {
  label: string; values: string[]; onSave: (v: string[]) => void; saving: boolean; placeholder?: string;
}) {
  const [text, setText] = useState(values.join('\n'));
  const isDirty = text !== values.join('\n');
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        placeholder={placeholder}
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white resize-none transition-colors"
      />
      {isDirty && (
        <div className="flex justify-end mt-1">
          <SaveButton onClick={() => onSave(text.split('\n').map(s => s.trim()).filter(Boolean))} saving={saving} />
        </div>
      )}
    </div>
  );
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="text-xs bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap transition-colors"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  );
}
