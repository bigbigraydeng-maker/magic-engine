---
id: 2026-10-21-old-cron-frequency-wording-sweep
title: 旧的运行间隔文字还留在界面和状态文档里：评论自动回复设置页写「每 30 分钟」实际每小时，状态文档 6 个任务的运行时间是旧的
status: done
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-10-28
verify_how: 主干上对照 render.yaml 核对：评论自动回复设置页那句写「每小时」；docs/STATE.md §4.1 里 prospecting-sweep、social-comment-autoreply、meta-leads-hourly、goal-current-value-refresh、google-data-pullback-daily、ai-tracker-weekly 六行的调度与 render.yaml 一致，表头下有「标已暂停的未必真停」的提醒。全部对上算成，少一处就是没成。
done_on: 2026-10-21
done_ref: pr:3005
---
统管 18 号转述子牙对 PR 3000 的审查：登记表对齐之外，仓库里其余写着旧频率的文字也要扫掉。2026-09-16 降频（commit 2a17a85f2）时只改了调度，没改这些文字。
本卡只改一句界面文案和状态文档，不改任何调度、不改任何逻辑；render.yaml 里的旧标题行已在 PR 3000 改掉。接口文件头注释里的旧频率因为在生产定时任务路由里（机器判 A，哪怕只改注释），另走 A 级草稿。
STATE.md 另加了一条带日期的提醒：标「已暂停」的几个任务只是 render.yaml 里被注释掉，服务器上并没有因此停，见台账卡 2026-10-21-render-orphan-cron-services-9。
