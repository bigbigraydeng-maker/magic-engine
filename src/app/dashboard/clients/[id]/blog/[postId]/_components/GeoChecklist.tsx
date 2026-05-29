'use client';

import type { GeoCheck } from '@/lib/blog/html-builder';

interface Props {
  checks: GeoCheck[];
}

/**
 * GEO + quality checklist panel for the blog viewer.
 * Shows pass/fail for each signal check with detail text.
 */
export function GeoChecklist({ checks }: Props) {
  const passed     = checks.filter(c => c.pass).length;
  const total      = checks.length;
  const allGood    = passed === total;
  const hasBlocker = checks.some(c => c.blocker && !c.pass);

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      hasBlocker ? 'border-red-300' : 'border-gray-200'
    }`}>
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Quality Checklist</h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          hasBlocker ? 'bg-red-100 text-red-700'
          : allGood   ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
        }`}>
          {passed}/{total} passed
        </span>
      </div>
      <div className="divide-y divide-gray-50">
        {checks.map(check => {
          const failBlocker = !check.pass && check.blocker;
          const iconColor   = check.pass    ? 'text-green-500'
                            : failBlocker   ? 'text-red-500'
                                            : 'text-amber-500';
          const icon        = check.pass    ? '✅'
                            : failBlocker   ? '❌'
                                            : '⚠️';
          return (
            <div key={check.key} className={`px-5 py-3 flex items-start gap-3 ${
              failBlocker ? 'bg-red-50' : ''
            }`}>
              <span className={`flex-shrink-0 mt-0.5 text-base ${iconColor}`}>
                {icon}
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${
                  failBlocker ? 'text-red-700' : check.pass ? 'text-gray-700' : 'text-gray-900'
                }`}>
                  {check.label}
                  {failBlocker && <span className="ml-1 text-[10px] uppercase tracking-wide">· blocks publish</span>}
                </p>
                {check.detail && (
                  <p className={`text-xs mt-0.5 ${failBlocker ? 'text-red-600' : 'text-gray-400'}`}>
                    {check.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
