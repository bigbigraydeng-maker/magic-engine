/**
 * Shared display constants for Zhuge UI components.
 * Imported by ZhugePriorityWidget and ZhugeDrawer — do not duplicate.
 */

export const FLYWHEEL_BADGE: Record<string, { label: string; cls: string }> = {
  seo:    { label: 'SEO',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  geo:    { label: 'GEO',    cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  ads:    { label: 'Ads',    cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  social: { label: 'Social', cls: 'bg-green-100 text-green-700 border-green-200' },
}

export const IMPACT_CLS: Record<string, string> = {
  high:   'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-700',
  low:    'bg-gray-50 text-gray-500',
}

export const EFFORT_CLS: Record<string, string> = {
  low:    'bg-green-50 text-green-700',
  medium: 'bg-amber-50 text-amber-700',
  high:   'bg-red-50 text-red-700',
}

export const IMPACT_ZH: Record<string, string> = {
  high: '高影响', medium: '中影响', low: '低影响',
}

export const EFFORT_ZH: Record<string, string> = {
  high: '高投入', medium: '中投入', low: '低投入',
}
