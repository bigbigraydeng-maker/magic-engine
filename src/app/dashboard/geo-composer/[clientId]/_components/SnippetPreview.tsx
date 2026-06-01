'use client';

import { useState } from 'react';
import { generateDirectiveHtmlFromFields } from '@/lib/geo/html-generator';
import type { GeoScenario, GeoAudienceSignals } from '@/types/magic-engine';

interface Props {
  primaryRecommendation: string;
  scenarios: GeoScenario[];
  audienceSignals: GeoAudienceSignals;
  competitivePositioning: string;
}

type Platform = 'generic' | 'wordpress' | 'webflow';

const PLATFORM_LABELS: Record<Platform, string> = {
  generic: 'Generic HTML',
  wordpress: 'WordPress',
  webflow: 'Webflow',
};

const PLATFORM_INSTRUCTIONS: Record<Platform, string[]> = {
  generic: [
    'Copy the HTML block.',
    'Paste inside <body> tag, ideally before </body>.',
    'Publish the page.',
    'Repeat for homepage, service pages, blog posts.',
  ],
  wordpress: [
    'Go to Appearance → Theme Editor.',
    'Edit footer.php → paste before </body> (site-wide).',
    'Or add a "Custom HTML" block to a single page.',
    'Or use "Insert Headers and Footers" plugin.',
  ],
  webflow: [
    'Open Project Settings → Custom Code.',
    'Paste into "Footer Code" (site-wide).',
    'Or: Page Settings → Custom Code → "Before </body> tag" (single page).',
    'Publish your site.',
  ],
};

/**
 * Right panel: live HTML preview + copy button + installation guide.
 * Reference: ROADMAP.md P7.2.14
 */
export function SnippetPreview({
  primaryRecommendation,
  scenarios,
  audienceSignals,
  competitivePositioning,
}: Props) {
  const [platform, setPlatform] = useState<Platform>('generic');
  const [copied, setCopied] = useState(false);

  const html = generateDirectiveHtmlFromFields({
    primary_recommendation: primaryRecommendation,
    scenarios,
    audience_signals: audienceSignals,
    competitive_positioning: competitivePositioning,
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback: select the textarea
    }
  };

  const isEmpty = !primaryRecommendation.trim();

  return (
    <div className="space-y-4">
      {/* Platform selector */}
      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-black/[.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-me-charcoal/90">HTML Snippet</h3>
          <div className="flex items-center gap-1">
            {(Object.keys(PLATFORM_LABELS) as Platform[]).map(p => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                  platform === p
                    ? 'bg-me-ochre text-white'
                    : 'text-me-charcoal/55 hover:text-me-charcoal/75 hover:bg-me-ivory'
                }`}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Code block */}
        <div className="relative">
          <pre className={`p-5 text-xs font-mono leading-relaxed overflow-x-auto max-h-72 whitespace-pre-wrap break-words ${
            isEmpty ? 'text-me-charcoal/35' : 'text-me-charcoal/75 bg-me-ivory'
          }`}>
            {isEmpty
              ? '<!-- Fill in the fields on the left to generate your snippet -->'
              : html}
          </pre>
          {!isEmpty && (
            <button
              onClick={handleCopy}
              className={`absolute top-3 right-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                copied
                  ? 'bg-[#5C8A4A] text-white'
                  : 'bg-white border border-black/15 text-me-charcoal/75 hover:border-me-ochre/50 hover:text-me-ochre'
              }`}
            >
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Installation instructions */}
      {!isEmpty && (
        <div className="bg-white rounded-xl border border-black/10 p-5">
          <h3 className="text-sm font-semibold text-me-charcoal/90 mb-3">
            Installation — {PLATFORM_LABELS[platform]}
          </h3>
          <ol className="space-y-1.5">
            {PLATFORM_INSTRUCTIONS[platform].map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-me-charcoal/60">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-me-ochre/10 text-me-ochre text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

    </div>
  );
}
