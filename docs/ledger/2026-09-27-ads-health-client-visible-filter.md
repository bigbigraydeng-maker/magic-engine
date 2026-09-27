---
id: 2026-09-27-ads-health-client-visible-filter
title: 客户看广告健康页时只给看标了「客户可见」的问题，内部建议（如受众池断供要加钱）不再发到客户浏览器
status: done
owner: agent
decided_on: 2026-09-27
source: session:72d14b94
verify_by: 2026-10-02
verify_how: 上线后用付费客户账号打开广告健康页，接口返回里没有 D11 等内部条目、只有 D1/D2/D3/D10；员工账号同页仍能看到全部条目
done_on: 2026-09-27
done_ref: pr:2117
---
子牙在审 PR 2084 时发现的老问题：广告健康页接口对付费客户放行，但把每日巡察的全部问题/机会原样返回。
做法：服务端按查看人身份裁剪，员工原样、客户只拿白名单字段和 clientVisible 为真的条目。A 级，合并需 PM 本人同意。
