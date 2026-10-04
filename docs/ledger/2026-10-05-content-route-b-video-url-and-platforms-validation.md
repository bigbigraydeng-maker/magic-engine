---
id: 2026-10-05-content-route-b-video-url-and-platforms-validation
title: 内容生成 route-b 的 video_url 与三个路由的 platforms 字段没有校验
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
本次加了登录后，剩下的是付费用户自己烧额度的问题：video_url 可传任意网址进付费转录（Supadata），platforms 数组元素没校验就进提示词和数据库。
修法：video_url 限 http(s) 与白名单平台；platforms 限定枚举。
