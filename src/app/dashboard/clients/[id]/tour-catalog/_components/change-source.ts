import type { ChangeSource } from '@/lib/tour-catalog/catalog-contract'

export const CHANGE_SOURCE_LABELS: Record<ChangeSource, string> = {
  manual: '手动',
  assistant: 'AI 助手',
  import: '出团表导入',
  rollback: '撤销导入',
  system: '系统',
}

export const CHANGE_SOURCES: ChangeSource[] = ['manual', 'assistant', 'import', 'rollback', 'system']

/** Tooltip next to the AI label: the browser reports this source itself. */
export const SELF_REPORTED_TITLE = '来源由浏览器上报'
export const SYSTEM_ACTOR_LABEL = '系统'

export interface ParsedActor {
  who: string
  source: ChangeSource
}

const ASSISTANT_SUFFIX = ' (AI 助手)'

function whoAfterLastBy(text: string): string {
  const index = text.lastIndexOf(' by ')
  return index === -1 ? '' : text.slice(index + ' by '.length).trim()
}

/** Split the change-log `actor` text into who did it and how. */
export function parseChangeActor(actor: string | null | undefined): ParsedActor {
  const text = (actor ?? '').trim()
  if (text === '' || text === 'system') {
    return { who: SYSTEM_ACTOR_LABEL, source: 'system' }
  }
  if (text.startsWith('import:')) {
    return { who: whoAfterLastBy(text), source: 'import' }
  }
  if (text.startsWith('rollback:')) {
    return { who: whoAfterLastBy(text), source: 'rollback' }
  }
  if (text.startsWith('edit by ')) {
    const rest = text.slice('edit by '.length)
    if (rest.endsWith(ASSISTANT_SUFFIX)) {
      return { who: rest.slice(0, -ASSISTANT_SUFFIX.length).trim(), source: 'assistant' }
    }
    return { who: rest.trim(), source: 'manual' }
  }
  return { who: text, source: 'system' }
}
