---
id: 2026-10-21-list-template-layout-fix
title: 清单（list）模板版式小改：价格卡真正居中、小字字号可选、价格放右下小卡、单房差细字加底
status: done
owner: agent
decided_on: 2026-10-21
source: pr:2961
verify_by: 2026-10-28
verify_how: 合并并升级出片机后，用上海两条（af1c35f6/1e0067cf 的重出版）渲染一次：价格卡水平居中（左右各 60px）、右下小卡版式生效、小字放大；已有 list 工单不带新字段时仍能出片（引擎 node --test 全过）。PM 10-21「放行 list 小改」（74 号转述原话）
done_on: 2026-10-21
done_ref: pr:2961
---
改动只限 list 模板版式：①价格卡容器原先 left:0 width:960，实际居中在 x=480（偏左 90px），list 现改为 left:90 width:900（居中在 540、右边界 990 内）；**PriceScene 默认仍是旧位置，postcard 不受影响（只有 ListReel 传 left=90）**；②价格对象新增可选 layout(center|corner)、qualifierSize、footnoteBackdrop，顶层新增可选 itemLabelSize；③片尾标题容器加 width:900（长标题换行点可能变化）；右下小卡版式（corner）限定语/脚注≤26 字、日期行≤24 字、字号上限 48/40，保证不越出 y=1248 与右边 960（魏征复核后加）。不带新字段的旧 props 仍合法（默认版式仅修正居中偏移）。本地证据：引擎 node --test 521 项全过、tsc 无报错；上海两条本地渲染 9 宫格对比见 PR。
