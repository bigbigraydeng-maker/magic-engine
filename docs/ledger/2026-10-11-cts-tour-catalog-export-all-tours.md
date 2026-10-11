---
id: 2026-10-11-cts-tour-catalog-export-all-tours
title: 团目录加「导出全部团」：一键下载一份 Excel 能直接打开的表格，每个团一行，含班期、价格、简介、主图等 30 列
status: done
owner: agent
decided_on: 2026-10-11
done_on: 2026-10-11
done_ref: pr:2453
source: session:1a85e0eb
verify_by: 2026-10-18
verify_how: 登录团目录点左栏下方「导出全部团」，得到 tours-日期.csv，Excel 打开中文不乱码，33 行；表里没有航司、机位、航线等内部信息
---
PM 2026-10-11 提出需要导出当前所有 Tour。导出的是工作稿（含还没上架的修改），能看团目录的人都能导出；班期的内部信息（航司、机位、航线）不会进文件，公式开头的内容会加引号防止 Excel 当公式执行。
本机用线上真实数据试跑：33 个团 × 30 列，13 个团有未来班期。代码：src/lib/tour-catalog/export-csv.ts 与 export/route.ts。每天行程全文不在表里（只给天数），要整份数据另说。
