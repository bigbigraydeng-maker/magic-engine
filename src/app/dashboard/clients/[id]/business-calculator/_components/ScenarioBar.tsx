'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CalculatorInputs } from '@/lib/crm/industry/travel-business-calculator'
import { ComparePanel, type ScenarioRow } from './ComparePanel'

interface ScenarioListResponse {
  success: boolean
  scenarios: ScenarioRow[]
}

interface ScenarioResponse {
  success: boolean
  scenario: ScenarioRow
}

interface ErrorResponse {
  error?: string
  code?: string
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function ScenarioBar(props: {
  clientId: string
  currentInputs: CalculatorInputs
  dirty: boolean
  loaded: ScenarioRow | null
  onLoad: (scenario: ScenarioRow) => void
  onSaved: (scenario: ScenarioRow) => void
}): JSX.Element {
  const { clientId, currentInputs, dirty, loaded, onLoad, onSaved } = props

  const basePath = `/api/clients/${clientId}/business-calculator/scenarios`

  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [message, setMessage] = useState<string>('')
  const [name, setName] = useState<string>(loaded?.name ?? '')
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [compareA, setCompareA] = useState<ScenarioRow | null>(null)
  const [compareB, setCompareB] = useState<ScenarioRow | null>(null)

  const refresh = useCallback(async (): Promise<ScenarioRow[]> => {
    setLoading(true)
    try {
      const res = await fetch(basePath, { method: 'GET' })
      const data = await readJson<ScenarioListResponse>(res)
      if (!res.ok || !data || !data.success) {
        setMessage('读取场景失败')
        setScenarios([])
        return []
      }
      setScenarios(data.scenarios)
      return data.scenarios
    } catch {
      setMessage('读取场景失败')
      setScenarios([])
      return []
    } finally {
      setLoading(false)
    }
  }, [basePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setName(loaded?.name ?? '')
  }, [loaded])

  const handleSave = useCallback(async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 60) {
      setMessage('场景名需要 1 到 60 个字')
      return
    }

    setMessage('')
    try {
      const res = await fetch(basePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, inputs: currentInputs }),
      })

      if (res.status === 201) {
        const data = await readJson<ScenarioResponse>(res)
        if (data && data.success) {
          onSaved(data.scenario)
          await refresh()
          setMessage('已保存')
          return
        }
        setMessage('保存失败')
        return
      }

      const err = await readJson<ErrorResponse>(res)

      if (res.status === 409 && err?.code === 'duplicate_name') {
        const confirmed = window.confirm('同名场景已存在，覆盖吗？')
        if (!confirmed) {
          return
        }
        const fresh = await refresh()
        const existing = fresh.find((row) => row.name === trimmed)
        if (!existing) {
          setMessage('保存失败')
          return
        }
        const patchRes = await fetch(`${basePath}/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_updated_at: existing.updated_at,
            inputs: currentInputs,
          }),
        })
        if (patchRes.ok) {
          const patchData = await readJson<ScenarioResponse>(patchRes)
          if (patchData && patchData.success) {
            onSaved(patchData.scenario)
            await refresh()
            setMessage('已覆盖保存')
            return
          }
          setMessage('保存失败')
          return
        }
        const patchErr = await readJson<ErrorResponse>(patchRes)
        if (patchRes.status === 409 && patchErr?.code === 'stale') {
          setMessage('这个场景刚刚在别处被改过，已刷新，请再试')
          await refresh()
          return
        }
        setMessage(patchErr?.error ?? '保存失败')
        return
      }

      if (res.status === 409 && err?.code === 'limit_reached') {
        setMessage('每个客户最多 50 个场景')
        return
      }

      setMessage(err?.error ?? '保存失败')
    } catch {
      setMessage('保存失败')
    }
  }, [basePath, currentInputs, name, onSaved, refresh])

  const handleLoad = useCallback(
    (scenario: ScenarioRow): void => {
      if (dirty) {
        const confirmed = window.confirm('有未保存的修改，载入会丢掉，继续吗？')
        if (!confirmed) {
          return
        }
      }
      onLoad(scenario)
    },
    [dirty, onLoad],
  )

  const handleRename = useCallback(
    async (row: ScenarioRow): Promise<void> => {
      const input = window.prompt('新的场景名', row.name)
      if (input === null) {
        return
      }
      const trimmed = input.trim()
      if (trimmed.length < 1 || trimmed.length > 60) {
        setMessage('场景名需要 1 到 60 个字')
        return
      }

      setMessage('')
      try {
        const res = await fetch(`${basePath}/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_updated_at: row.updated_at,
            name: trimmed,
          }),
        })

        if (res.ok) {
          await refresh()
          setMessage('已改名')
          return
        }

        const err = await readJson<ErrorResponse>(res)
        if (res.status === 409 && err?.code === 'duplicate_name') {
          setMessage('已有同名场景')
          return
        }
        if (res.status === 409 && err?.code === 'stale') {
          setMessage('这个场景刚刚在别处被改过，已刷新，请再试')
          await refresh()
          return
        }
        setMessage(err?.error ?? '保存失败')
      } catch {
        setMessage('保存失败')
      }
    },
    [basePath, refresh],
  )

  const handleDelete = useCallback(
    async (row: ScenarioRow): Promise<void> => {
      const confirmed = window.confirm(`删除场景「${row.name}」？`)
      if (!confirmed) {
        return
      }

      setMessage('')
      try {
        const res = await fetch(`${basePath}/${row.id}`, { method: 'DELETE' })

        if (res.status === 404) {
          await refresh()
          return
        }

        if (!res.ok) {
          const err = await readJson<ErrorResponse>(res)
          setMessage(err?.error ?? '删除失败')
          return
        }

        if (selectedA === row.id) {
          setSelectedA(null)
        }
        if (selectedB === row.id) {
          setSelectedB(null)
        }
        if (compareA?.id === row.id) {
          setCompareA(null)
        }
        if (compareB?.id === row.id) {
          setCompareB(null)
        }

        await refresh()
        setMessage('已删除')
      } catch {
        setMessage('删除失败')
      }
    },
    [basePath, compareA, compareB, refresh, selectedA, selectedB],
  )

  const handleCompare = useCallback(async (): Promise<void> => {
    if (!selectedA || !selectedB || selectedA === selectedB) {
      return
    }

    setMessage('')
    const fresh = await refresh()
    const rowA = fresh.find((row) => row.id === selectedA)
    const rowB = fresh.find((row) => row.id === selectedB)

    if (!rowA || !rowB) {
      setMessage('有场景已被删除，请重新选择')
      setSelectedA(null)
      setSelectedB(null)
      setCompareA(null)
      setCompareB(null)
      return
    }

    setCompareA(rowA)
    setCompareB(rowB)
  }, [refresh, selectedA, selectedB])

  const canCompare =
    selectedA !== null && selectedB !== null && selectedA !== selectedB

  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label
            htmlFor="scenario-name"
            className="block text-xs text-me-charcoal/70"
          >
            场景名
          </label>
          <input
            id="scenario-name"
            type="text"
            value={name}
            maxLength={60}
            placeholder="场景名（别写批准、承诺类字样）"
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-me-charcoal"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          className="rounded-lg border border-black/10 bg-me-charcoal px-4 py-2 text-sm text-white"
        >
          保存当前
        </button>
      </div>

      {message ? (
        <p className="mt-2 text-xs text-me-charcoal/70">{message}</p>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-me-charcoal">已保存场景</h2>
        <button
          type="button"
          onClick={() => void handleCompare()}
          disabled={!canCompare}
          className="rounded-lg border border-black/10 px-3 py-1 text-sm text-me-charcoal disabled:opacity-40"
        >
          对比 A、B
        </button>
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-me-charcoal/70">读取中…</p>
      ) : null}

      <div data-testid="scenario-list" className="mt-2 space-y-2">
        {scenarios.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-me-charcoal/10 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-me-charcoal">{row.name}</p>
              <p className="text-xs text-me-charcoal/70">
                {new Date(row.updated_at).toLocaleString('zh-CN')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={`载入场景 ${row.name}`}
                onClick={() => handleLoad(row)}
                className="rounded-lg border border-black/10 px-2 py-1 text-xs text-me-charcoal"
              >
                载入
              </button>
              <button
                type="button"
                aria-label={`改名场景 ${row.name}`}
                onClick={() => void handleRename(row)}
                className="rounded-lg border border-black/10 px-2 py-1 text-xs text-me-charcoal"
              >
                改名
              </button>
              <button
                type="button"
                aria-label={`删除场景 ${row.name}`}
                onClick={() => void handleDelete(row)}
                className="rounded-lg border border-black/10 px-2 py-1 text-xs text-me-charcoal"
              >
                删除
              </button>
              <button
                type="button"
                aria-label={`把 ${row.name} 设为 A`}
                aria-pressed={selectedA === row.id}
                onClick={() => setSelectedA(row.id)}
                className={`rounded-lg border px-2 py-1 text-xs ${
                  selectedA === row.id
                    ? 'border-me-charcoal bg-me-charcoal text-white'
                    : 'border-black/10 text-me-charcoal'
                }`}
              >
                设为 A
              </button>
              <button
                type="button"
                aria-label={`把 ${row.name} 设为 B`}
                aria-pressed={selectedB === row.id}
                onClick={() => setSelectedB(row.id)}
                className={`rounded-lg border px-2 py-1 text-xs ${
                  selectedB === row.id
                    ? 'border-me-charcoal bg-me-charcoal text-white'
                    : 'border-black/10 text-me-charcoal'
                }`}
              >
                设为 B
              </button>
            </div>
          </div>
        ))}
      </div>

      {compareA && compareB ? (
        <div className="mt-4">
          <ComparePanel a={compareA} b={compareB} />
        </div>
      ) : null}
    </div>
  )
}
