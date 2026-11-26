---
id: 2026-11-08-nzcpe-northmedia-ga4-quality-check
title: NZCPE 官网 GA4 核对 North Media 投放——Demand Gen 量大质差（5 天近 400 次访问 0 个专业买家），搜索广告质量好但量太小，节目方承诺的程序化投放在数据里看不到
status: decided
owner: pm
decided_on: 2026-11-08
source: session:a82cdfaa
verify_by: 2026-11-12
verify_how: 11/12 在 GA4（NZCPE 2026 属性）拉 11/9–11/11 按「Session campaign」看：Demand Gen 有没有调（参与率是否 ≥30%、是否带来 ≥1 个 buyer_registration）；搜索广告每天访问是否明显多于 6 次；有没有出现带标签的程序化/电台来源；三项都没变 = North Media 没改，要 PM 当面问 Kyle
---
数据窗口 11/3–11/7（NZ 时间），GA4 后台只读取数，未改任何设置。
North Media 11/4 自建了 buyer/visitor/exhibitor 三个派生报名事件并全部设为关键事件，所以 GA4「关键事件」总数会把同一次报名算两遍，看报名只能看 generate_lead 或 buyer_registration。
报名通知邮件与 GA4 的逐条对数没做完（Gmail 线程合并，逐封读太慢），只看到 11/4–11/7 每天都有买家报名邮件，方向一致。
