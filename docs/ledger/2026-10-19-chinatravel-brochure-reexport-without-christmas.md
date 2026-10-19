---
id: 2026-10-19-chinatravel-brochure-reexport-without-christmas
title: 官网公开小册子 PDF 仍整页卖已下架的 Christmas 团，需重新导出
status: decided
owner: agent
decided_on: 2026-10-19
source: session:ec90bb17
verify_by: 2026-10-30
verify_how: 官网 public/brochures 下的小册子重新导出后，用 pdftotext 搜不到 Christmas、22 Dec 2026 和两个旧团页链接；欢迎邮件里的小册子链接仍能打开；官网下架登记表里的「已知残留」条目已移除
---
小册子生成源在官网仓库 scripts/catalogue/data.py，需先摘掉两个团再导出；海报 PDF 是图片，文字抽不出，需人眼核对。
在重新导出前，该 PDF 登记为官网下架登记表的已知残留，不删文件（欢迎邮件在链它）。
