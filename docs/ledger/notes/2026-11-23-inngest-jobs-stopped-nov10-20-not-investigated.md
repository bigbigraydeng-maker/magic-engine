# 2026-11-23-inngest-jobs-stopped-nov10-20-not-investigated · 详细记录

原是台账卡正文，2026-11-25 因超出卡片格式（正文≤5行、不写账户号）原样搬到这里，内容未改。卡片：docs/ledger/2026-11-23-inngest-jobs-stopped-nov10-20-not-investigated.md

11-22 只读核查发现（生产库 glbdnayojixmexgofbsd 的 cron_run_logs）：ad-heartbeat 最后 11-10、ad-breakdown-capture 最后 11-14、conversion-daily-pipeline 最后 11-14（CTS 成交回传 Meta 自此停发）、ads-tracking-launch-watch 最后 11-20；都走 Inngest 调度，疑似免费额度用尽（未核实）。
核查报告：https://claude.ai/artifact/5Lcze7YExnLqZhenAKytP5 。PM 回「先不用」查，什么时候查由 PM 定。
