---
id: 2026-10-19-agent-learning-board
title: ME 后台加「Agent 学习库」页，PM 能看到从视频学到的能力在学习中、待验证、pass 掉还是已合并进 ME
status: decided
owner: agent
decided_on: 2026-10-19
source: session:9c4ac99a
verify_by: 2026-10-23
verify_how: 合并部署后用管理员账号打开线上 /dashboard/learning：页面显示「共读到 N 张学习笔记」且 N 等于主干 docs/skill-cards 下带日期的卡数，四个数字非空、没有整页红色报错；整页报错（线上读不到 docs）= failed，改为构建时打包
---
PM 2026-10-19 要求，认为这些经验是 AI Agent 的核心壁垒。数据只读 docs/skill-cards 每张卡末尾「## 机器索引」与 docs/ledger 交接卡。
设计与实现各经子牙、魏征两审。
