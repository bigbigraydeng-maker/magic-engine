import { describe, expect, it } from 'vitest'
import {
  activeCrmNavKey,
  buildCrmNavItems,
  CRM_SIDEBAR_STORAGE_KEY,
  isSamePagePath,
  readSidebarCollapsed,
  writeSidebarCollapsed,
  type StorageLike,
} from '../workspace-shell'

const CLIENT = 'client-123'
const BASE = `/dashboard/clients/${CLIENT}`

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>
} {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    },
    setItem(key: string, value: string): void {
      data[key] = value
    },
  }
}

describe('readSidebarCollapsed', () => {
  it('defaults to collapsed when nothing is stored', () => {
    expect(readSidebarCollapsed(makeStorage())).toBe(true)
  })

  it("returns false only for the literal '0'", () => {
    expect(readSidebarCollapsed(makeStorage({ [CRM_SIDEBAR_STORAGE_KEY]: '0' }))).toBe(false)
  })

  it("returns true for '1'", () => {
    expect(readSidebarCollapsed(makeStorage({ [CRM_SIDEBAR_STORAGE_KEY]: '1' }))).toBe(true)
  })

  it('returns true for garbage values', () => {
    expect(readSidebarCollapsed(makeStorage({ [CRM_SIDEBAR_STORAGE_KEY]: 'nope' }))).toBe(true)
    expect(readSidebarCollapsed(makeStorage({ [CRM_SIDEBAR_STORAGE_KEY]: '' }))).toBe(true)
  })

  it('returns true when storage is null or undefined', () => {
    expect(readSidebarCollapsed(null)).toBe(true)
    expect(readSidebarCollapsed(undefined)).toBe(true)
  })

  it('returns true when getItem throws', () => {
    const throwing: StorageLike = {
      getItem() {
        throw new Error('boom')
      },
      setItem() {
        /* noop */
      },
    }
    expect(readSidebarCollapsed(throwing)).toBe(true)
  })
})

describe('writeSidebarCollapsed', () => {
  it("writes '1' when collapsed", () => {
    const storage = makeStorage()
    writeSidebarCollapsed(true, storage)
    expect(storage.data[CRM_SIDEBAR_STORAGE_KEY]).toBe('1')
  })

  it("writes '0' when expanded", () => {
    const storage = makeStorage()
    writeSidebarCollapsed(false, storage)
    expect(storage.data[CRM_SIDEBAR_STORAGE_KEY]).toBe('0')
  })

  it('does not throw when setItem throws', () => {
    const throwing: StorageLike = {
      getItem() {
        return null
      },
      setItem() {
        throw new Error('quota')
      },
    }
    expect(() => writeSidebarCollapsed(true, throwing)).not.toThrow()
  })

  it('does not throw when storage is null', () => {
    expect(() => writeSidebarCollapsed(true, null)).not.toThrow()
    expect(() => writeSidebarCollapsed(false, undefined)).not.toThrow()
  })
})

describe('buildCrmNavItems', () => {
  it('returns items in the expected order', () => {
    const keys = buildCrmNavItems(CLIENT).map((item) => item.key)
    expect(keys).toEqual(['today', 'all', 'sales', 'calendar', 'mail', 'settings'])
  })

  it('uses the exact Chinese labels', () => {
    const labels = buildCrmNavItems(CLIENT).map((item) => item.label)
    expect(labels).toEqual(['今天先联系', '全部客人', '销售进度', '到期日历', '邮件 / 短信', '设置'])
  })

  it('marks the mail item as a placeholder with no href', () => {
    const mail = buildCrmNavItems(CLIENT).find((item) => item.key === 'mail')
    expect(mail).toBeDefined()
    expect(mail?.href).toBeNull()
  })

  it('only sales and calendar need bookings access', () => {
    const needing = buildCrmNavItems(CLIENT)
      .filter((item) => item.needsBookingsAccess)
      .map((item) => item.key)
    expect(needing).toEqual(['sales', 'calendar'])
  })

  it('embeds the clientId in every non-null href', () => {
    for (const item of buildCrmNavItems(CLIENT)) {
      if (item.href !== null) {
        expect(item.href).toContain(CLIENT)
      }
    }
  })
})

describe('activeCrmNavKey', () => {
  it('all with no query => today', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, '', CLIENT)).toBe('today')
  })

  it('?view=all => all', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, '?view=all', CLIENT)).toBe('all')
  })

  it('?view=smart => today', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, '?view=smart', CLIENT)).toBe('today')
  })

  it('?contact=x => all', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, '?contact=x', CLIENT)).toBe('all')
  })

  it('?assignee=me => all', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, '?assignee=me', CLIENT)).toBe('all')
  })

  it('?view=smart&contact=x => today (smart wins)', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, '?view=smart&contact=x', CLIENT)).toBe('today')
  })

  it('accepts a query string without a leading ?', () => {
    expect(activeCrmNavKey(`${BASE}/crm/all`, 'view=all', CLIENT)).toBe('all')
  })

  it('calendar => calendar', () => {
    expect(activeCrmNavKey(`${BASE}/crm/calendar`, '', CLIENT)).toBe('calendar')
  })

  it('sales-progress => sales', () => {
    expect(activeCrmNavKey(`${BASE}/sales-progress`, '', CLIENT)).toBe('sales')
  })

  it('sales-progress sub-path => sales', () => {
    expect(activeCrmNavKey(`${BASE}/sales-progress/tour-1`, '', CLIENT)).toBe('sales')
  })

  it('settings => settings', () => {
    expect(activeCrmNavKey(`${BASE}/settings`, '?tab=crm', CLIENT)).toBe('settings')
  })

  it('payments page => null', () => {
    expect(activeCrmNavKey(`${BASE}/payments`, '', CLIENT)).toBeNull()
  })

  it("a different client's path => null", () => {
    expect(activeCrmNavKey('/dashboard/clients/other/crm/all', '?view=all', CLIENT)).toBeNull()
  })
})

describe('isSamePagePath', () => {
  it('is true for an equal path with a query string', () => {
    expect(isSamePagePath(`${BASE}/crm/all`, `${BASE}/crm/all?view=all`)).toBe(true)
  })

  it('is true for an equal path with no query string', () => {
    expect(isSamePagePath(`${BASE}/crm/calendar`, `${BASE}/crm/calendar`)).toBe(true)
  })

  it('is false for a different path', () => {
    expect(isSamePagePath(`${BASE}/crm/all`, `${BASE}/crm/calendar`)).toBe(false)
  })

  it('is false when the pathname has an extra segment', () => {
    expect(isSamePagePath(`${BASE}/crm/all/extra`, `${BASE}/crm/all`)).toBe(false)
  })
})
