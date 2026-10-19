#!/usr/bin/env node
// Playwright audit of all daily-todo email href landing pages.
// Persistent context reuses login cookies across runs.
//
// Usage:
//   PHASE=login node audit-hrefs.mjs   # open browser, wait for user to log in
//   PHASE=sweep node audit-hrefs.mjs   # visit every URL, screenshot + metadata

import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const PROFILE_DIR = '/tmp/me-audit-profile'
const REPO = '/Users/raydeng/Projects/magic-engine/.claude/worktrees/cts-meta-content-publish-c541c2'
const OUT_DIR = path.join(REPO, 'docs/audits/screenshots')
const META_FILE = path.join(REPO, 'docs/audits/2026-09-07-href-page-metadata.json')

const CTS = 'c0000000-0000-0000-0000-000000000000'
const GOAL_ID = '7e6d6ff0-f8c0-4e61-843a-ba5aa81843f5'
const CONTACT_ID = '0120f341-a530-4d02-accb-53a58ae653ec'
const PR_URL = 'https://github.com/bigbigraydeng-maker/chinatravel/pull/121'
const PLATFORM_REGISTRY_URL =
  'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md'

const APP = 'https://app.magicengine.com.au'

// { key, url, kinds, note }
const TARGETS = [
  { key: 'not_indexed',                  kinds: ['not_indexed'], url: `${APP}/dashboard/clients/${CTS}/site-audit/pages?filter=not-indexed` },
  { key: 'client_settings',              kinds: ['meta_stuck', 'mailchimp_export_broken', 'email_sync_stale_client', 'gbp_needs_location'], url: `${APP}/dashboard/clients/${CTS}/settings` },
  { key: 'site_audit',                   kinds: ['crawl_stale'], url: `${APP}/dashboard/clients/${CTS}/site-audit` },
  { key: 'assets',                       kinds: ['price_claim_unbacked'], url: `${APP}/dashboard/clients/${CTS}/assets` },
  { key: 'goal_page',                    kinds: ['goal_baseline_mismatch', 'leads_metric_untrusted'], url: `${APP}/dashboard/clients/${CTS}/goal/${GOAL_ID}` },
  { key: 'crm_contact_focused',          kinds: ['dnc_maybe_wrong', 'dm_maybe_stop', 'email_reply_due_focused'], url: `${APP}/dashboard/clients/${CTS}/crm/all?contact=${CONTACT_ID}` },
  { key: 'crm_all',                      kinds: ['email_reply_due_client'], url: `${APP}/dashboard/clients/${CTS}/crm/all` },
  { key: 'client_list',                  kinds: ['cross_client_leak', 'email_sync_stale_all'], url: `${APP}/dashboard/clients` },
  { key: 'blog_relative',                kinds: ['blog_draft_waiting_connected'], url: `${APP}/dashboard/clients/${CTS}/blog`, note: 'relative path in code — resolves via origin when absolute base assumed' },
  { key: 'execution',                    kinds: ['auto_run_blocked', 'auto_run_stuck', 'kernel_needs_human', 'diagnostic_findings', 'prescription_updated', 'action_unattributable', 'outcome_rows_orphaned'], url: `${APP}/dashboard/clients/${CTS}/execution` },
  { key: 'factory',                      kinds: ['factory_worker_idle'], url: `${APP}/dashboard/factory` },
  { key: 'conversions_focused',          kinds: ['conversion_needs_review'], url: `${APP}/dashboard/conversions?client=${CTS}&focus=fake-outcome-id` },
  { key: 'conversions_in_doubt',         kinds: ['conversion_send_in_doubt'], url: `${APP}/dashboard/conversions?client=${CTS}&status=in_doubt` },
  { key: 'google_connect',               kinds: ['gbp_needs_connect'], url: `${APP}/api/auth/google/connect?client_id=${CTS}`, note: 'oauth-start — 只看响应/重定向，别真授权' },
  // External third-party (login required elsewhere → probably see login page):
  { key: 'render_dashboard',             kinds: ['cron_not_running_render', 'cron_stuck', 'cron_blind', 'attribution_audit_failed', 'client_list_unreadable'], url: 'https://dashboard.render.com', external: true },
  { key: 'gh_actions',                   kinds: ['cron_not_running_github'], url: 'https://github.com/bigbigraydeng-maker/magic-engine/actions', external: true },
  { key: 'inngest',                      kinds: ['cron_not_running_inngest'], url: 'https://app.inngest.com', external: true },
  { key: 'muapi_topup',                  kinds: ['video_credits_out'], url: 'https://muapi.ai/topup', external: true },
  { key: 'dataforseo_dashboard',         kinds: ['dataforseo_credits_out'], url: 'https://app.dataforseo.com/', external: true },
  { key: 'mailchimp_audience',           kinds: ['paid_signal_needs_review'], url: 'https://admin.mailchimp.com/audience/contacts/', external: true },
  { key: 'meta_ads_manager',             kinds: ['ad_readback_blocker'], url: 'https://adsmanager.facebook.com/adsmanager/manage/adsets?act=REDACTED', external: true, note: 'CTS ad account id — 隐藏后测的是通用 Ads Manager 路径' },
  { key: 'graph_explorer',               kinds: ['comment_token_invalid', 'comment_scope_missing'], url: 'https://developers.facebook.com/tools/explorer/', external: true },
  { key: 'blog_pr',                      kinds: ['blog_pr_open'], url: PR_URL, external: true },
  { key: 'platform_registry',            kinds: ['platform_candidate_review_due'], url: PLATFORM_REGISTRY_URL, external: true },
]

async function extractMetadata(page) {
  return await page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll('button, a, input[type=submit], input[type=button], [role=button]')
    )
      .map((el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim())
      .filter((s) => s && s.length < 200)
      .slice(0, 30)
    const forms = document.querySelectorAll('form').length
    const textareas = document.querySelectorAll('textarea').length
    const h1 = document.querySelector('h1')?.innerText?.trim() ?? ''
    const bodyText = (document.body.innerText || '').slice(0, 800)
    return {
      title: document.title,
      h1,
      currentUrl: location.href,
      controls,
      forms,
      textareas,
      bodyTextPreview: bodyText,
    }
  })
}

async function main() {
  const phase = process.env.PHASE || 'sweep'
  await fs.mkdir(OUT_DIR, { recursive: true })

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  })

  const page = ctx.pages()[0] ?? (await ctx.newPage())

  if (phase === 'login') {
    console.log('→ 打开 app.magicengine.com.au ...')
    await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
    console.log('')
    console.log('*** 请在浏览器里登录 Google → 直到看到你自己的 dashboard 首页 ***')
    console.log('*** 登好之后不用做任何事，等这个脚本自己关闭浏览器（120 秒后） ***')
    await page.waitForTimeout(120_000)
    await ctx.close()
    console.log('→ 登录会话已保存到 /tmp/me-audit-profile')
    return
  }

  const results = []
  for (const t of TARGETS) {
    console.log(`→ ${t.key}  ${t.url}`)
    let meta
    let error = null
    try {
      const resp = await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 })
      // Give SPA a moment for client-side render
      await page.waitForTimeout(1500)
      meta = await extractMetadata(page)
      meta.httpStatus = resp?.status() ?? null
    } catch (e) {
      error = e.message || String(e)
      try { meta = await extractMetadata(page) } catch { meta = { title: '(page unreachable)', currentUrl: t.url } }
    }
    try {
      await page.screenshot({
        path: path.join(OUT_DIR, `${t.key}.png`),
        fullPage: false,
      })
    } catch (e) {
      error = (error ? error + ' | ' : '') + 'screenshot: ' + e.message
    }
    results.push({
      key: t.key,
      url: t.url,
      external: !!t.external,
      note: t.note ?? null,
      kinds: t.kinds,
      error,
      ...meta,
    })
  }

  await fs.writeFile(META_FILE, JSON.stringify(results, null, 2), 'utf8')
  console.log(`→ 写入 ${META_FILE}`)
  console.log(`→ 截图目录 ${OUT_DIR}`)

  await ctx.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
