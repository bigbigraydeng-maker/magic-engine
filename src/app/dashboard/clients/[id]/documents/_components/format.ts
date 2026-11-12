/** Display helpers for the document library page. Pure functions, no I/O. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** YYYY-MM-DD in New Zealand time (the team's day), whatever the viewer's own time zone is. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Auckland' }).format(date)
}

export function fileKindLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.includes('wordprocessingml')) return 'Word'
  if (mimeType.includes('spreadsheetml')) return 'Excel'
  if (mimeType.includes('presentationml')) return 'PowerPoint'
  if (mimeType.startsWith('image/')) return '图片'
  return '文件'
}
