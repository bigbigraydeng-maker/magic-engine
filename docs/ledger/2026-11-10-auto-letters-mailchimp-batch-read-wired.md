---
id: 2026-11-10-auto-letters-mailchimp-batch-read-wired
title: 「自动发信」页面接上 Mailchimp 那一批：活动标题＝模板键，12/2 那四封的发出、打开、点击显示进页面
status: done
owner: agent
decided_on: 2026-11-10
verify_by: 2026-12-03
source: session:37644f65
verify_how: 12/3（12/2 那批在 Mailchimp 发出、之后 Mailchimp 同步跑过一次）打开 ME 后台 CRM「自动发信」：「已过发信日的信」里 12/2 那四封显示「已发出」，点开每位客人能看到发出 / 打开 / 点击；Mailchimp 里同名活动不止一个的，页面上方会写「对不上：有 N 个同名活动」。样本＝4 封信、Mailchimp 名单里有的那些客人；对不上先查活动标题是不是一字不差等于模板键
done_on: 2026-11-10
done_ref: pr:3749
---
PM 11-10 16:14（经 126，已在 126 的原始记录里核到本人打字）回「接」：12/2 前要让页面显示走 Mailchimp 的那一批。126 已把这个客户的「记录 Mailchimp 发信」标题前缀加上 auto-countdown-，同步会写逐人「发出」，打开和点击本来就记。
对应规则（发信窗口 11-10 定）：Mailchimp 活动标题＝模板键，一字不差、区分大小写，只认已发出的活动；同一标题对上不止一个活动就不猜，页面写「对不上：有 N 个同名活动」；对不上显示「—」，不报错。读取只在 load-facts.ts / load.ts，只读，不调 Mailchimp，不读邮箱和 summary。
没有任何打开记录时显示「—」而不是「0」（同步一天一次，当天发的信打开还没进来）。日历：126 已建 12/3 09:30 查这一页。
发信窗口 11-10 确认两个新状态、提醒轻重、Mailchimp 优先；并要求：同一封信 ME 有真的收到的人、Mailchimp 也有同标题的已发活动时，页面上方提示「这封信 ME 和 Mailchimp 都发过，可能重复发了」并给出两边人数（已加，12/2 那批只有 Mailchimp 发，不受影响）。
