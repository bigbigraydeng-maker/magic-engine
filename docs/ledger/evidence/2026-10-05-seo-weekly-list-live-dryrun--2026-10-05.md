# SEO 每周清单 · 线上"只演练"当面试跑回执 — 2026-10-05（NZ）

- 触发：`gh workflow run manual-cron-trial.yml -f job=seo-weekly-list -f dry_run=true`（PR #2234 的手动试跑入口），Actions 运行 37200611928（部署 #2232 版本）与 37201461996（部署 #2235 版本）。
- 结果（两次均 success）：HTTP 200；服务端返回 `dry_run=true`（与请求一致）；1 个客户；失败 0；预览 5 项；`item_errors=0`；`error=null`。
- 写入核对（每次运行后查生产库）：该客户 `steps_json.loop='seo_goal_v1'` 的清单卡 0 张、`cron_run_logs` 中 `seo-weekly-list` 0 条、近 60 分钟 `execution_logs` 0 条 → 演练确实零写入。
- 诊断读取：第二次运行预览里"点击率偏低"的前 2 项带"诊断：同主题有别的自家页面在分食曝光｜该页搜索词已取到"——线上读谷歌该页搜索词成功；其余点击率项因每次最多读 3 页而无诊断（设计如此）。
- 数据缺口如实出现在回执 `stale_crawl_pages`：3 个高潜力页面因站点抓取过期被跳过（站点抓取修复由另一窗口跟进）。
- 未验证：①定时任务的真实自动运行（要 Render 同步 blueprint）；②真写入模式（未执行，需确认词）；③诊断的具体搜索词内容（预览只显示是否取到）。
