# 线上读回：内容工厂看板（2026-10-21）

- 部署：Render crazycontent 主干提交 693b3595，状态 live（完成时间 2026-10-20 13:07:27 UTC）。
- 用 PM 已登录的浏览器读回：GET /api/clients/<CTS 客户编号>/content-factory/board → HTTP 200，counts：选题 50 / 备料 11 / 出片 8 / 发布 1 / 看表现 0。
- CTS 内容工厂页能打开，页面上没有红字 Unknown error。
- 未核对：服务器日志里那条「youtube_publish_receipts 读取失败」警告（没看日志，只确认了接口返回与页面）。
- 未验证：YouTube 阶段不显示（生产库那份 10-18 回执迁移仍未应用，要 PM 说 go apply 才应用）；这只是页面不再死，不是全修好。
