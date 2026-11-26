# 证据 · 2026-09-26-crm-priority-live-trial · 2026-11-15
fetched_at: 2026-11-15T21:40+13:00
查了什么：对生产库只读（全程 SELECT）重跑 scripts/probe-crm-priority-view.ts，客户为 CTS（脚本默认）。
数字：联系人 1609；两张名单 今天要联系(hot)=471、先放着(cold)=1138，SUM sections=1609 contacts=1609 match=true；旧平铺口径按 listOf 归堆后 CROSSCHECK expected {"hot":471,"cold":1138} = got {"hot":471,"cold":1138}，identical=true；进程退出码 0。
来源/命令：npx tsx --env-file=<主仓库 .env.local> scripts/probe-crm-priority-view.ts（未打印密钥）
注：分段现为 hot/cold 两段（卡写“四段”是创建时口径），两条断言（人数之和=总数；每段=平铺口径逐人归堆之和）都成立。
结论：成。分段没有让人凭空消失，也没有改判。
