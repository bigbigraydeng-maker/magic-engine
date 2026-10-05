# 出片机开机自启（一页纸）

**作用**：Mac 开机登录后，出片机自己起来；崩了自己重启；不用人手动开。
**还没装。** 装上去是改这台 Mac 的常驻配置，要 PM 同意后再装。

## 装

在**放着代码主目录**的那台 Mac 上，终端里一段一段跑（`REPO` 换成代码主目录，不要用临时的 worktree 目录）：

```bash
REPO=/Users/raydeng/Projects/magic-engine
sed -e "s#__NODE__#$(which node)#" -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  $REPO/scripts/factory-worker/launchd/com.magicengine.factory-worker.plist \
  > ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
plutil -lint ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
```

装之前确认：`node -v` 是 22.18 以上；`scripts/factory-worker/.env` 里已经有出片用的密钥（模板里不放任何密钥）。

## 看它在不在

```bash
launchctl print gui/$(id -u)/com.magicengine.factory-worker | grep -E "state|pid"
tail -f ~/Library/Logs/magicengine-factory-worker.log
```

日志里每 30 秒一行「无 queued 工单,等待…」就是正常。如果日志里反复出现 `FATAL` 或找不到 `.env`，是 `.env` 没配好（它每 30 秒会被拉起一次），先补 `.env`，再重启。

## 重启（改了代码、或今日待办提示出片机离线时）

```bash
launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker
```

## 卸载

```bash
launchctl bootout gui/$(id -u)/com.magicengine.factory-worker
rm ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
```

## 要知道的三件事

1. **合盖睡觉不算崩，但睡久了会提醒。** Mac 睡着时它也睡着；醒来继续。睡着超过 10 分钟，在做的单会被系统收回队列，醒来重新领，不扣重试次数。队列里有活、又睡了 30 分钟以上，今日待办会提醒——这时唤醒那台 Mac 就行，不用重启。
2. **掉线怎么发现。** 出片机空闲时每 4 分钟报一次「我还活着」。队列里有活、等了 30 分钟、又没收到任何信号，今日待办会出现「出片机离线」，机器恢复后自己消失。
3. **更新代码后要重启一次**（上面的重启命令），它跑的是启动时那份代码。
