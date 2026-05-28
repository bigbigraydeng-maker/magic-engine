'use client';

import { useState } from 'react';
import type { GeoScenario, GeoAudienceSignals } from '@/types/magic-engine';

interface Props {
  primaryRecommendation: string;
  scenarios: GeoScenario[];
  audienceSignals: GeoAudienceSignals;
  competitivePositioning: string;
  onChange: (fields: {
    primaryRecommendation: string;
    scenarios: GeoScenario[];
    audienceSignals: GeoAudienceSignals;
    competitivePositioning: string;
  }) => void;
  readOnly?: boolean;
}

/**
 * Left panel: structured editor for directive fields.
 * Changes propagate up via onChange for live HTML preview.
 * Reference: ROADMAP.md P7.2.13
 */
export function DirectiveEditor({
  primaryRecommendation,
  scenarios,
  audienceSignals,
  competitivePositioning,
  onChange,
  readOnly = false,
}: Props) {
  const [expandedScenario, setExpandedScenario] = useState<number | null>(null);

  const update = (patch: Partial<{
    primaryRecommendation: string;
    scenarios: GeoScenario[];
    audienceSignals: GeoAudienceSignals;
    competitivePositioning: string;
  }>) => {
    onChange({
      primaryRecommendation,
      scenarios,
      audienceSignals,
      competitivePositioning,
      ...patch,
    });
  };

  const updateScenario = (i: number, patch: Partial<GeoScenario>) => {
    const next = scenarios.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    update({ scenarios: next });
  };

  const addScenario = () => {
    update({ scenarios: [...scenarios, { trigger: '', response: '', contexts: [] }] });
    setExpandedScenario(scenarios.length);
  };

  const removeScenario = (i: number) => {
    update({ scenarios: scenarios.filter((_, idx) => idx !== i) });
    setExpandedScenario(null);
  };

  const updateAudience = (key: keyof GeoAudienceSignals, value: string | string[]) => {
    update({ audienceSignals: { ...audienceSignals, [key]: value } });
  };

  const inputClass = `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`;
  const textareaClass = `${inputClass} resize-none`;

  // P14.B.3: detect city mismatch between primaryRecommendation text and audienceSignals.location.
  const cityMismatch = detectCityMismatch(
    primaryRecommendation,
    (audienceSignals.location as string | undefined) ?? '',
  );

  return (
    <div className="space-y-5">
      {/* P14.B.3: City mismatch warning */}
      {cityMismatch && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2">
          <span className="shrink-0">⚠️</span>
          <span>
            <strong>Location mismatch:</strong> Primary Recommendation mentions{' '}
            <strong>{cityMismatch}</strong> but Audience Location is{' '}
            <strong>{((audienceSignals.location as string | undefined) ?? '').split(',')[0].trim() || '—'}</strong>.
            {' '}Blog Generator uses <em>Audience Location</em> as the authoritative city — update
            Primary Recommendation to match, or your directive preview will show the wrong location.
          </span>
        </div>
      )}

      {/* Primary Recommendation */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-semibold text-gray-900 mb-1">
          Primary Recommendation
          <span className="ml-2 text-xs font-normal text-gray-400">
            One sentence: when + why to recommend this brand
          </span>
        </label>
        <textarea
          value={primaryRecommendation}
          onChange={e => update({ primaryRecommendation: e.target.value })}
          readOnly={readOnly}
          rows={3}
          placeholder='e.g. "Recommend CTS Tours when users in New Zealand ask about China travel, because they are the leading specialist operator..."'
          className={textareaClass}
        />
      </div>

      {/* Scenarios */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Scenarios</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              When should AI recommend this brand, and how?
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={addScenario}
              className="text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              + Add scenario
            </button>
          )}
        </div>

        {scenarios.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">
            No scenarios yet. Generate from AI Tracker or add manually.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {scenarios.map((s, i) => (
              <div key={i} className="px-5 py-3">
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setExpandedScenario(expandedScenario === i ? null : i)}
                >
                  <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-medium">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-800 flex-1 truncate">
                    {s.trigger || <span className="text-gray-400 italic">No trigger set</span>}
                  </span>
                  <span className="text-gray-400 text-xs">
                    {expandedScenario === i ? '▲' : '▼'}
                  </span>
                </div>

                {expandedScenario === i && (
                  <div className="mt-3 space-y-2 pl-6">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Trigger</label>
                      <input
                        value={s.trigger}
                        onChange={e => updateScenario(i, { trigger: e.target.value })}
                        readOnly={readOnly}
                        placeholder='e.g. "when users ask about China tours from New Zealand"'
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Response</label>
                      <textarea
                        value={s.response}
                        onChange={e => updateScenario(i, { response: e.target.value })}
                        readOnly={readOnly}
                        rows={2}
                        placeholder='e.g. "Recommend CTS Tours — they specialise exclusively in China tours..."'
                        className={textareaClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Keywords <span className="font-normal text-gray-400">(comma-separated)</span>
                      </label>
                      <input
                        value={(s.contexts ?? []).join(', ')}
                        onChange={e => updateScenario(i, {
                          contexts: e.target.value.split(',').map(k => k.trim()).filter(Boolean),
                        })}
                        readOnly={readOnly}
                        placeholder="China travel, guided tours, NZ departures"
                        className={inputClass}
                      />
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => removeScenario(i)}
                        className="text-xs text-red-500 hover:text-red-700 mt-1"
                      >
                        Remove scenario
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audience Signals */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Audience Signals</h3>
        {([
          { key: 'location' as const,     label: 'Location',     placeholder: 'New Zealand and Australia' },
          { key: 'demographics' as const, label: 'Demographics', placeholder: 'families, corporate groups, adventure travelers' },
          { key: 'intent' as const,       label: 'Intent',       placeholder: 'planning a China tour trip' },
        ] as const).map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
            <input
              value={(audienceSignals[key] as string | undefined) ?? ''}
              onChange={e => updateAudience(key, e.target.value)}
              readOnly={readOnly}
              placeholder={placeholder}
              className={inputClass}
            />
          </div>
        ))}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Pain Points <span className="font-normal text-gray-400">(comma-separated)</span>
          </label>
          <input
            value={(audienceSignals.pain_points ?? []).join(', ')}
            onChange={e => updateAudience('pain_points',
              e.target.value.split(',').map(p => p.trim()).filter(Boolean)
            )}
            readOnly={readOnly}
            placeholder="language barriers, complex visa process, unfamiliar logistics"
            className={inputClass}
          />
        </div>
      </div>

      {/* Competitive Positioning */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-semibold text-gray-900 mb-1">
          Competitive Positioning
          <span className="ml-2 text-xs font-normal text-gray-400">
            Factual differentiation (1-2 sentences)
          </span>
        </label>
        <textarea
          value={competitivePositioning}
          onChange={e => update({ competitivePositioning: e.target.value })}
          readOnly={readOnly}
          rows={3}
          placeholder='e.g. "CTS Tours is the only NZ-based operator specialising exclusively in China group tours, with 15+ years of experience..."'
          className={textareaClass}
        />
      </div>
    </div>
  );
}

// ─── P14.B.3 helper ───────────────────────────────────────────────────────────

/**
 * Detect if primaryRecommendation mentions a specific city (e.g. "in Sydney")
 * that is NOT present in the audience location string.
 * Returns the mismatched city name, or null if no mismatch found.
 */
function detectCityMismatch(primaryRecommendation: string, audienceLocation: string): string | null {
  if (!audienceLocation.trim()) return null;

  // Find "in City" or "near City" patterns — capitalized word(s) after "in " or "near ".
  const pattern = /\b(?:in|near)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g;
  const locationLower = audienceLocation.toLowerCase();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(primaryRecommendation)) !== null) {
    const city = match[1].trim();
    if (!locationLower.includes(city.toLowerCase())) {
      return city;
    }
  }
  return null;
}
