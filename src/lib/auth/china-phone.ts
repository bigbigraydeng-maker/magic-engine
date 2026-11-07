/** Normalize a mainland China mobile number to the E.164 form Supabase expects. */
export function normalizeChinaPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const compact = value.trim().replace(/[\s()-]/g, '')
  const national = compact.startsWith('+86')
    ? compact.slice(3)
    : compact.startsWith('0086')
      ? compact.slice(4)
      : compact.startsWith('86') && compact.length === 13
        ? compact.slice(2)
        : compact

  return /^1[3-9]\d{9}$/.test(national) ? `+86${national}` : null
}

export function maskChinaPhone(phone: string): string {
  const national = phone.replace(/^\+86/, '')
  return `+86 ${national.slice(0, 3)}****${national.slice(-4)}`
}
