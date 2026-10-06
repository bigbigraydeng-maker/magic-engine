# 改前存档 · 表格脚本 CTS CRM Mailchimp Tag Sync（Code.gs，共 1275 行）里要改的三处原文（2026-10-07，PM 回「点头」后、保存前）

来源：PM 登录的脚本编辑器里逐屏读出（页面文本接口被拦，用截图逐行抄录），不含邮箱与密钥（密钥在脚本属性里，不在代码里）。
整份脚本的回滚办法：脚本编辑器左侧「项目历史（时钟图标）」里点改前那一版恢复；或把下面三处原文贴回原行号（改后行号会整体后移）。

## 原文 1：`runE1Batch_` 里 dry-run 分支（原第 139 行）

```js
  if (dryRun) { Logger.log('🧪 DRY-RUN, 不发送'); return; }
```

## 原文 2：`runE1Batch_` 里逐人排除循环（原第 141–150 行）

```js
  const sendable = [];
  targets.forEach(t => {
    Utilities.sleep(200);
    const reason = getExclusionReason_(t.email, apiKey);
    if (reason) {
      sheet.getRange(t.rowNum, S1_COL_E1_SENT).setValue('跳过(' + reason + ') ' + new Date().toISOString().slice(0, 10));
    } else {
      sendable.push(t);
    }
  });
```

## 原文 3：`getExclusionReason_` 里的标签排除（原第 248–253 行）

```js
  const tags = (JSON.parse(resp.getContentText()).tags || []).map(t => t.name);
  if (tags.indexOf(TAG_SALES_ACTIVE) >= 0) return '销售跟进中';
  if (tags.indexOf(TAG_SUPPRESSED) >= 0) return '已退订/禁止发送';
  if (tags.indexOf(TAG_NURTURE_2027) >= 0) return '客户要求明年再联系';
  return null;
}
```

## 背景（没动、仅作对照）

- 入口：第 100 行 `dailySendE1Batch`、第 101 行 `dryRunE1Batch`，分别调用 `runE1Batch_(false)` / `runE1Batch_(true)`。
- `getExclusionReason_` 同时被 E2/E3/E4 跟进批次使用（第 223 行附近），所以补排除项对整条链都生效。
- E2/E3/E4 要求 E1 那一格以「已发」开头并含 YYYY-MM-DD 日期才会排期，改后写入的格子保持这个格式。
