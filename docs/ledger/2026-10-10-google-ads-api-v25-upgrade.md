---
id: 2026-10-10-google-ads-api-v25-upgrade
title: 谷歌广告接口调用的版本号从已关停的 v17 升到 v25
status: done
owner: agent
decided_on: 2026-10-10
source: session:55d67ae9
done_on: 2026-10-10
done_ref: commit:38a81aa6aaf9c117e01ee0d3f09b4ec11cdd5990
verify_by: 2026-11-10
verify_how: 配好密钥后当场跑一次真实读取（列广告系列或关键词构思），看返回 200 且有数据；在那之前只能验静态事实——grep 仓库里 googleads.googleapis.com 不再出现 v17，且 curl 探测 $discovery/rest?version=v25 仍返回 200（v17/v20 返回 404）
---
v17 已于 2025-06-04 关停，curl 探测 $discovery 确认 v17 与 v20 均 404，在用的是 v22 到 v25。
改动只有版本字符串与注释共 6 行，分别在 client.ts 与 keyword-planner.ts，测试里一处断言同步更新。
已用 v25 的 discovery 文档逐项核对：五个接口路径与用到的全部字段（campaign 四项、campaign_budget 两项、metrics 四项、segments.date、生成关键词构思的请求与返回字段）在 v25 中全部存在，无改名。
代码由 DeepSeek 经 aider 写，一轮成功，花费约 0.003 美元；我审 diff 并改测试断言。
接口仍跑不通：刷新令牌不存在、项目里没有可用的 OAuth 客户端、线上五个环境变量未配，见 [[2026-10-10-google-ads-api-basic-upgrade]]。
