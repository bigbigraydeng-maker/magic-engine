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
  /** 某个场景被删（含已被别人删）时通知上层，上层据此清掉「当前场景」 */
  onDeleted?: (id: string) => void
  /** 已载入的场景被改名时通知上层，换成服务端返回的新名字和新版本 */
  onRenamed?: (scenario: ScenarioRow) => void
  /** 非空时保存按钮不可用，并说明原因（例如有数字超出可保存范围） */
  saveBlockedReason?: string
}): JSX.Element {
  const { clientId, currentInputs, dirty, loaded, onLoad, onSaved, onDeleted, onRenamed, saveBlockedReason } = props

  const basePath = `/api/clients/${clientId}/business-calculator/scenarios`

  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [message, setMessage] = useState<string>('')
  const [name, setName] = useState<string>(loaded?.name ?? '')
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [compareA, setCompareA] = useState<ScenarioRow | null>(null)
  const [compareB, setCompareB] = useState<ScenarioRow | null>(null)

  const refresh = useCallback(async (): Promise<ScenarioRow[] | null> => {
    setLoading(true)
    try {
      const res = await fetch(basePath, { method: 'GET' })
      const data = await readJson<ScenarioListResponse>(res)
      if (!res.ok || !data || !data.success) {
        setMessage('读取场景失败')
        return null
      }
      setScenarios(data.scenarios)
      return data.scenarios
    } catch {
      setMessage('读取场景失败')
      return null
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

  // 覆盖保存：带的是「用户看到的那一版」的 updated_at（载入时的或列表里的），
  // 不是点确认之后再取的最新版——否则别人在这期间改过，也会被静默盖掉。
  const overwrite = useCallback(
    async (target: ScenarioRow): Promise<void> => {
      const patchRes = await fetch(`${basePath}/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_updated_at: target.updated_at, inputs: currentInputs }),
      })
      if (patchRes.ok) {
        const patchData = await readJson<ScenarioResponse>(patchRes)
        if (patchData && patchData.success) {
          setCompareA(null)
          setCompareB(null)
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
        setMessage('这个场景刚刚在别处被改过，已刷新，请重新载入后再保存')
        await refresh()
        return
      }
      if (patchRes.status === 404) {
        setMessage('这个场景已被别人删除')
        await refresh()
        return
      }
      setMessage(patchErr?.error ?? '保存失败')
    },
    [basePath, currentInputs, onSaved, refresh],
  )

  const handleSave = useCallback(async (): Promise<void> => {
    if (saveBlockedReason) {
      setMessage(saveBlockedReason)
      return
    }
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 60) {
      setMessage('场景名需要 1 到 60 个字')
      return
    }

    setMessage('')
    try {
      // 已载入的场景再保存：直接按载入时的版本覆盖，不当成「同名」去问
      if (loaded && loaded.name === trimmed) {
        await overwrite(loaded)
        return
      }

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
        const existing = scenarios.find((row) => row.name === trimmed)
        if (!existing) {
          setMessage('列表里没找到这个同名场景，已刷新，请再试')
          await refresh()
          return
        }
        if (!window.confirm('同名场景已存在，覆盖吗？')) {
          return
        }
        await overwrite(existing)
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
  }, [basePath, currentInputs, loaded, name, onSaved, overwrite, refresh, saveBlockedReason, scenarios])

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
          const renamed = await readJson<ScenarioResponse>(res)
          setCompareA(null)
          setCompareB(null)
          if (renamed && renamed.success) {
            onRenamed?.(renamed.scenario)
          }
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
    [basePath, onRenamed, refresh],
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

        if (!res.ok && res.status !== 404) {
          const err = await readJson<ErrorResponse>(res)
          setMessage(err?.error ?? '删除失败')
          return
        }

        // 成功删除和「已经被别人删了（404）」都要把页面上的残留清干净
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

        onDeleted?.(row.id)
        await refresh()
        setMessage(res.status === 404 ? '该场景已被删除' : '已删除')
      } catch {
        setMessage('删除失败')
      }
    },
    [basePath, compareA, compareB, onDeleted, refresh, selectedA, selectedB],
  )

  const handleCompare = useCallback(async (): Promise<void> => {
    if (!selectedA || !selectedB || selectedA === selectedB) {
      return
    }

    setMessage('')
    const fresh = await refresh()
    if (fresh === null) {
      setMessage('读取场景失败，请重试')
      return
    }
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
          <p className="mt-1 text-xs text-me-charcoal/60">场景名只是备忘，别写「批准」「承诺」这类字样。</p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={Boolean(saveBlockedReason)}
          title={saveBlockedReason}
          className="rounded-lg border border-black/10 bg-me-charcoal px-4 py-2 text-sm text-white disabled:opacity-40"
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
