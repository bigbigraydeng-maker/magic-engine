'use client'

/**
 * 谁是自己人、谁是同行 —— 按公司邮箱域名认。
 *
 * 起因是客户 2026-08-04 的一句话：「contact 里面怎么还有工作人员？」
 * 判断逻辑当天就做好了，但清单只能改数据库 —— 也就是说以后新遇到一家同行，
 * FDE 加不进去。这个面板补上那一半。
 *
 * 为什么按域名而不是一个个标：CTS 那份手工 CRM 128 行里「阶段」列 0 个填了，
 * 就是「手工标必烂」的活证据。登记一次 `hot.co.nz`，House of Travel 全国所有
 * 门店、以后新来的人，第一天就自动归好类，不用任何人再动手。
 *
 * 填错的当场退回去，绝不默默存下 —— 存下来它永远不会命中任何邮箱，
 * 而填的人以为已经标好了，那批人就继续躺在散客名单里。
 */

import { useCallback, useEffect, useState } from 'react'

interface Config {
  ownEmailDomains: string[]
  tradeDomains: string[]
}

type Field = 'ownEmailDomains' | 'tradeDomains'

const COPY: Record<Field, { icon: string; title: string; hint: string; placeholder: string }> = {
  ownEmailDomains: {
    icon: '🏢',
    title: '客户自己的邮件域名',
    hint: '用这些域名写信来的是客户的同事，不会出现在客人名单里。关联公司也要填 —— 漏一个，那家公司的员工就会混进客人名单。',
    placeholder: 'ctstours.co.nz\nchinatravel.co.nz',
  },
  tradeDomains: {
    icon: '🤝',
    title: '同行 / 分销的域名',
    hint: '这些是真业务，但跟散客的跟进方式完全不同。填了之后他们会被单独归为「同行」，默认不出现在「今天该联系谁」里，切一下就能翻到。',
    placeholder: 'hot.co.nz\ntravelmanagers.co.nz',
  },
}

export function DomainRulesPanel({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  /** 正在编辑的文本，按框分开存 —— 一个框在改，另一个框不该被重新加载覆盖。 */
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({})
  const [saving, setSaving] = useState<Field | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [savedField, setSavedField] = useState<Field | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`)
      const json = (await res.json()) as { config?: Config; error?: string }
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      setConfig({
        ownEmailDomains: json.config?.ownEmailDomains ?? [],
        tradeDomains: json.config?.tradeDomains ?? [],
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const save = async (field: Field) => {
    const text = draft[field]
    if (text === undefined) return
    setSaving(field)
    setErr(null)
    setRejected([])
    setSavedField(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: text }),
      })
      const json = (await res.json()) as {
        config?: Config
        rejected?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? '保存失败')
      if (json.config) setConfig(json.config)
      // 存完把草稿清掉 —— 下面重新按存下来的清单渲染，
      // 人能直接看到系统实际认下了哪几条（而不是他打的那坨字）。
      setDraft((d) => ({ ...d, [field]: undefined }))
      setRejected(json.rejected ?? [])
      setSavedField(field)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(null)
    }
  }

  if (!config && !err) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      {(['ownEmailDomains', 'tradeDomains'] as const).map((field) => {
        const copy = COPY[field]
        const stored = config?.[field] ?? []
        const value = draft[field] ?? stored.join('\n')
        const dirty = draft[field] !== undefined && draft[field] !== stored.join('\n')

        return (
          <div key={field}>
            <p className="text-sm font-bold text-slate-800">
              {copy.icon} {copy.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{copy.hint}</p>

            <textarea
              value={value}
              rows={Math.min(8, Math.max(3, stored.length + 1))}
              placeholder={copy.placeholder}
              disabled={saving !== null}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 focus:border-cyan-500 focus:outline-none disabled:bg-slate-50"
            />

            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void save(field)}
                disabled={!dirty || saving !== null}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
              >
                {saving === field ? '保存中...' : '保存'}
              </button>
              <span className="text-xs text-slate-400">
                一行一个，也可以用逗号隔开。只要写域名，不要写 @ 前面那半截
              </span>
            </div>

            {savedField === field && !err && (
              <p className="mt-1.5 text-xs text-emerald-600">
                ✓ 已保存，认下 {stored.length} 个域名。已经在系统里的人会立刻重新归类
              </p>
            )}
          </div>
        )
      })}

      {err && <p className="text-xs text-red-600">⚠ {err}</p>}

      {rejected.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          ⚠ 这几条看不出是域名，<strong>没有存进去</strong>：{rejected.join('、')}
          <br />
          要填的是邮箱 @ 后面那一截（像 <code>hot.co.nz</code>），不是公司名字。
        </p>
      )}

      <p className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
        子域名会自动跟着算 —— 填了 <code>hot.co.nz</code>，
        <code>mail.hot.co.nz</code> 也算同一家。<br />
        两边都命中的算「自己人」（关联公司常常两个名单上都有）。
      </p>
    </div>
  )
}
