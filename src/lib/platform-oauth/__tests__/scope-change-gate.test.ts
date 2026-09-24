/**
 * 🔴 **改授权权限清单的闸门** —— 这个测试挂了不是 bug，是提醒。
 *
 * ## 你为什么会看到这条失败
 *
 * 你改了某个 `*_SCOPES` 常量（加了/删了/改了一项权限）。改之前请先读完下面
 * 这段，再把本文件里钉住的清单同步过去 —— 钉住这份清单的唯一目的，就是**逼
 * 你在改的那一刻看到这段话**，而不是等客户断线九天之后才有人想起来。
 *
 * ## 2026-09-15 真实事故
 *
 * 那天给 `MICROSOFT_MAIL_SCOPES` 加了 `Mail.ReadWrite`（做邮件回复功能）。
 * 提交说明里写了一句「Existing connections (currently only CTS) will need to
 * reconnect」——**然后就没有然后了**。微软刷新令牌时会重放 scope 清单，带上
 * 客户从没同意过的新权限直接被拒（AADSTS65001），CTS 的 `info@` 和 `bdm@`
 * 两个邮箱当场断掉，客人发来的询价 **9 天**没进过客户管理系统，没有任何报错，
 * 每小时的同步任务照样报成功（它只捞 `status = active` 的连接）。
 *
 * **写在提交说明里不算下发**（CLAUDE.md 铁律 3 下半句：发现不许死在日志里，
 * 也不许死在提交说明里）。
 *
 * ## 改之前必须一起带上的三件事
 *
 * 1. **受影响客户的重连待办**：谁要重连、怎么重连、点哪里。现在只要判据接上
 *    就是自动的 —— 见 `connection-health.ts` 的 `SCOPE_REPLAYED_ON_REFRESH`：
 *    权限清单比要求的少会在**断掉之前**就进今日待办。新加的平台要自己进那张表。
 * 2. **断线监控**：这个平台在 `HEARTBEAT_POLICY` 里有没有心跳节奏？没有的话
 *    要写清为什么（`why` 字段），不许留空。
 * 3. **「N 天没新数据就报警」的判据**：就是上面那个 `staleHours`。
 *
 * ## 两家平台的差别（这一条决定后果有多严重）
 *
 * · **微软**：刷新时**重放** scope → 加新权限会**弄死**已有连接。必须在上线
 *   同一时间下发重连待办。
 * · **谷歌**：刷新时**不带** scope（见 token-manager 的 `refreshGoogleToken`）
 *   → 加新权限**不会**弄死已有连接，但老客户的令牌里没有新权限，用到它的
 *   功能会被判 403。所以要么让那个功能自己兜底报错，要么下发重连待办。
 *   2026-09-24 实测：全部 7 条谷歌连接都只有 `spreadsheets.readonly`，
 *   没有一条有读写版 —— 写客户表格那条新功能对所有老客户都还没通。
 */

import { describe, expect, it } from 'vitest'
import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'
import { COMBINED_GOOGLE_SCOPES } from '@/lib/google-oauth/client'

describe('授权权限清单变更闸门（改了就来读文件头注）', () => {
  it('微软邮箱的权限清单没有被悄悄改动', () => {
    expect([...MICROSOFT_MAIL_SCOPES]).toEqual([
      'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
    ])
  })

  it('谷歌合并授权的权限清单没有被悄悄改动', () => {
    expect([...COMBINED_GOOGLE_SCOPES]).toEqual([
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/indexing',
      'https://www.googleapis.com/auth/business.manage',
      'https://www.googleapis.com/auth/spreadsheets',
      'email',
    ])
  })
})
