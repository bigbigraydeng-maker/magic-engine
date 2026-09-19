'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Image from 'next/image'
import { STATE_LABELS, type Check, type ScanReport } from '@/lib/ad-path-checker/types'
import { exampleReport } from '@/lib/ad-path-checker/example'
import styles from './checker.module.css'

function Evidence({ checks }: { checks: Check[] }) {
  return <details className={styles.evidence}>
    <summary>查看检测依据 <span aria-hidden="true">＋</span></summary>
    <div className={styles.evidenceBody}>{checks.map(check => <div key={check.id}>
      <strong>{check.title}</strong>
      <ul>{check.evidence.map((text, i) => <li key={i}>{text}</li>)}</ul>
      {check.sources.map(source => <a key={source} href={source} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">来源：{source} ↗</a>)}
    </div>)}</div>
  </details>
}

export default function Checker({ enabled }: { enabled: boolean }) {
  const [url, setUrl] = useState('')
  const [adUrl, setAdUrl] = useState('')
  const [adExpanded, setAdExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ScanReport | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const nextStep = useRef<HTMLDetailsElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (report) { title.current?.focus(); window.scrollTo({ top: 0 }) } }, [report])

  function reset() { setReport(null); setError(''); window.scrollTo({ top: 0 }); setTimeout(() => input.current?.focus(), 0) }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    controller.current = new AbortController()
    const timeout = setTimeout(() => controller.current?.abort(), 28_000)
    try {
      const response = await fetch('/api/tools/ad-path-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.current.signal,
        body: JSON.stringify({ url, ...(adUrl.trim() ? { adUrl } : {}) }),
      })
      const result = await response.json() as { report?: ScanReport; error?: string }
      if (!response.ok || !result.report) throw new Error(result.error || '这次没有拿到完整结果，请稍后重试。')
      setReport(result.report)
    } catch (failure: unknown) {
      setError(failure instanceof Error && failure.name !== 'AbortError' ? failure.message : '读取时间较长，这次未完成。请稍后重试，或换成官网首页。')
    } finally { clearTimeout(timeout); setLoading(false) }
  }

  return <div className={styles.root} lang="zh-CN">
    <header className={styles.header}><div className={styles.nav}>
      <a href="/tools/ad-path-check" className={styles.brand} aria-label="Magic Engine 广告到询盘体检首页"><Image src="/ad-path-check/brand.svg" alt="" width={34} height={32} priority /><span>Magic Engine</span></a>
      {report ? <button className={styles.textButton} onClick={reset}>重新体检 ↗</button> : <span className={styles.navLabel}>广告到询盘体检</span>}
    </div></header>

    {!report ? <main>
      <section className={styles.hero}>
        <div className={styles.intro}><p className={styles.eyebrow}>给正在投广告的你</p>
          <h1>广告有人看，<br />询盘接得住吗？</h1>
          <p className={styles.description}>放上你的网站，看看客户能不能顺利联系你。<br className={styles.desktopBreak} />再加一条广告链接，补充你想检查的广告路径。</p>
          <p className={styles.reassurance}><span>无需注册</span><span>不用安装</span><span>免费查看结果</span></p>
        </div>
        <div className={styles.formCard}>
          <form onSubmit={submit} aria-busy={loading}>
            <h2>先从你的网站开始</h2><p className={styles.formHint}>只要一个网址，就能看看现在的情况。</p>
            <label htmlFor="website">公司官网或广告落地页</label>
            <input ref={input} id="website" name="website" type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="例如：www.yourcompany.com" value={url} onChange={event => setUrl(event.target.value)} required maxLength={2048} disabled={loading} aria-describedby={error ? 'scan-error' : 'scan-privacy'} aria-invalid={!!error} />
            <button className={styles.expandButton} type="button" disabled={loading} aria-expanded={adExpanded} aria-controls="ad-input" onClick={() => setAdExpanded(!adExpanded)}>{adExpanded ? '−' : '＋'} 添加广告链接<span>（选填）</span></button>
            <div id="ad-input" hidden={!adExpanded}>
              <label htmlFor="ad-url">Facebook 主页或广告资料库链接</label>
              <input id="ad-url" name="adUrl" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://www.facebook.com/…" value={adUrl} onChange={event => setAdUrl(event.target.value)} maxLength={2048} disabled={loading} />
              <p className={styles.small}>公开广告不一定能读取；看不到的内容会明确告诉你。</p>
            </div>
            {error && <p id="scan-error" className={styles.error} role="alert">{error}</p>}
            <button type="submit" disabled={loading || !enabled} className={styles.primary}>{loading ? <><span className={styles.spinner} aria-hidden="true" /> 正在查看公开页面…</> : enabled ? <>免费开始体检 <span aria-hidden="true">↗</span></> : '体检暂未开放'}</button>
            {loading && <p className={styles.loading} role="status">正在读取网页、检查入口并整理建议。通常十几秒；部分网站可能无法读取。</p>}
            <p className={styles.privacy} id="scan-privacy">只查看公开页面，不登录账户，不提交网站表单。<br />请不要填写后台、登录或包含私人信息的链接。</p>
          </form>
          <button type="button" disabled={loading} className={styles.exampleLink} onClick={() => setReport(exampleReport)}>先看看体检示例 <span aria-hidden="true">→</span></button>
        </div>
      </section>
      <section className={styles.explainer} aria-label="可以检查什么"><div className={styles.explainerInner}>
        {[['01', '客户能联系上你吗', '看看电话、邮箱、聊天和表单入口，哪些已经能在页面里找到。'], ['02', '广告路径清楚吗', '梳理已知的承接步骤，告诉你哪些还需要亲自确认。'], ['03', '追踪基础有哪些', '看一眼网站上的统计和广告追踪代码，用中文解释它们的作用。']].map(([number, heading, body]) => <div key={number}><span className={styles.number}>{number}</span><h3>{heading}</h3><p>{body}</p></div>)}
      </div></section>
    </main> : <main className={styles.report}>
      <p className={styles.eyebrow}>{report.mode === 'example' ? '体检示例 · 虚构演示数据，不是当前网站检测结果' : `公开页面体检 · ${report.site}`}</p>
      <h1 ref={title} tabIndex={-1}>{report.headline}</h1><p className={styles.reportSummary}>{report.summary}</p>
      {report.mode === 'live' && <p className={styles.small}>读取于 {new Date(report.scannedAt).toLocaleString('zh-CN')} · {report.coverage.pages} 个页面 / {report.coverage.scripts} 个脚本{report.coverage.incomplete ? ' · 部分内容未能读取' : ''}</p>}
      <section className={styles.card} aria-labelledby="path-title"><h2 id="path-title">客户怎么找到你</h2>
        <ol className={styles.path}>{report.path.map((step, index) => <li key={index}><span className={step.confirmed ? styles.confirmed : styles.unconfirmed}>{step.label}</span>{index < report.path.length - 1 && <span className={styles.pathArrow} aria-hidden="true">⇢</span>}</li>)}</ol>
        <p className={styles.small}>这是待核对的路径草图：有依据的入口已标出，虚线连接不代表整条广告路径已经打通。</p>
      </section>
      {report.suggestions.map((suggestion, index) => <section className={styles.priority} key={suggestion.title}>
        <p className={styles.eyebrow}>建议先确认 · 0{index + 1}</p><h2>{suggestion.title}</h2><p>{suggestion.reason}</p><p className={styles.action}>下一步：{suggestion.action}</p>
        <Evidence checks={report.checks.filter(check => suggestion.checkIds.includes(check.id))} />
      </section>)}
      <h2 className={styles.sectionTitle}>其他发现</h2>
      {report.checks.filter(check => ['contact', 'pixel', 'ad'].includes(check.id)).map(check => <section className={styles.card} key={check.id}>
        <p className={check.state === 'detected' ? styles.goodLabel : styles.eyebrow}>{STATE_LABELS[check.state]}</p><h2>{check.title}</h2><p>{check.detail}</p><Evidence checks={[check]} />
      </section>)}
      <details className={styles.allChecks}><summary>查看全部检测项目 <span aria-hidden="true">↓</span></summary>
        <div className={styles.checkList}>{report.checks.map(check => <section key={check.id}><div className={styles.checkHeading}><h3>{check.title}</h3><span>{STATE_LABELS[check.state]}</span></div><p>{check.detail}</p><Evidence checks={[check]} /></section>)}</div>
      </details>
      <section className={styles.help}><div><h2>想知道接下来怎么改？</h2><p>让 Magic Engine 帮你梳理下一步。</p></div><a href="#next-step" className={styles.primary} onClick={() => { if (nextStep.current) nextStep.current.open = true }}>了解下一步 <span aria-hidden="true">↗</span></a></section>
      <details ref={nextStep} id="next-step" className={styles.nextStep}><summary>下一步可以怎么做？</summary><div><p>先把上面的建议交给负责网站或投放的人，核对入口和追踪编号。需要进一步检查时，Magic Engine 可以协助梳理广告、网站和询盘之间的数据。</p><p>账户授权后的 CAPI 检查、有效询盘和成交回传属于后续服务。本版不会连接账户或修改你的设置。</p><a href="/contact" className={styles.textButton}>了解 Magic Engine 的帮助 ↗</a></div></details>
      <p className={styles.small}>本次只查看公开内容，不执行网页脚本。检测到代码不等于事件已经成功回传；本工具不能判断真人流量或买家身份。</p>
      {report.mode === 'example' && <button className={styles.primary} onClick={reset}>检查我的网站 ↗</button>}
    </main>}
    <footer className={styles.footer}><span>Magic Engine · 让营销的下一步更清楚</span><span>公开页面只读体检 · 不保存本次报告</span></footer>
  </div>
}
