# 证据：2026-10-09-calendar-cts-title-wrongly-changed-0928 · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下 CTS 网站标题周一晚自动改了哪几条、有没有改错

## 结论

9/28 晚改了 3 页（PR #213）全部改错：李子坝指南被改成 How Many Days in Chongqing、重庆夜景被改成 The Forbidden City、china-tours-from-new-zealand 描述丢掉 4 线路名与全部价格（NZD 3,399-7,999）；客户站上挂了约 6 天，10/3 由 #219 撤回。另有 #214（北京到西安高铁）改对了。

## 怎么查的

gh pr view 213 body/files；台账 2026-10-04-cts-retired-seo-optimizer-zombie-run 的表格；#219 merged 2026-10-03。线上当前标题未现取（curl 域名无返回），撤回状态以 #219 merged 为准，台账 verify_by 10/12 待核线上三页。
