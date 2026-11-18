---
id: 2026-11-18-cts-confirmation-generator
title: ME 老版后台新增「确认单」：旅游客户员工填表，一键生成品牌 PDF / Word 确认单（样板：CTS4270729 那份）
status: decided
owner: agent
decided_on: 2026-11-18
source: session:b42135d2
verify_by: 2026-12-02
verify_how: 用 CTS 客户账号打开 /dashboard/clients/<CTS 客户 id>/confirmation：(1) 页面能打开、左侧栏「行业工具 · 旅游」里「定制行程」下面有「确认单」（PM 11-19 定：工作台工具卡片区已不显示，入口改回侧栏）；(2) 点「载入示例」后，右边预览完整，「下载 Word」能下到文件并用 Word 打开；(3) 点「下载 PDF」得到完整多页 PDF（本机没在 ME 后台里验过打印，只在官网后台验过）。不成时第一步：看 PDF 是不是只有一页，是的话打印样式在 ME 后台的滚动容器里被裁了
---
PM 11-18 要把 CTS 的确认单做成类似 Tailor-made 的后台功能，并指定放 ME 老版后台（不放 CTS 官网）。PR magic-engine#3896。
页面 /dashboard/clients/[id]/confirmation，接口 POST /api/clients/[id]/confirmation/docx（先验登录权限，再验旅游行业，与 Tailor-made 同一道闸）。
不建表、不迁移、不碰生产数据；草稿只存员工自己的浏览器。团号只填一次、全文同步；空白模板不带任何客户的联系人和日期性说法（签证、天气），员工出团前要自己核对小贴士。
合并闸判 A 级（新接口含鉴权检查），需 Codex 与 Claude Code 对当前提交签字。
