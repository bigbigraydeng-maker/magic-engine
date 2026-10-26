#!/bin/bash
# =============================================================================
# Magic Engine 发布脚本 —— 在 Ray 的机器上运行
#
# 作用：把协作仓里「测试通过」的某个 main 提交，以 PR 形式送进生产仓。
# 设计要点：生产仓是 git 自动部署，所以**绝不直接 push 生产 main**；
#          脚本只推 release 分支并开 PR，合并那一下（=上线授权）始终由 Ray 人工点。
#
# 使用：./release-to-production.sh <collab-main-commit-sha>
#
# -----------------------------------------------------------------------------
# 相对 Jundong 2026-09-02 草案的三处结构性修改（不是填空，是改设计）：
#
# 1. 【致命】原稿用 `rsync -a --delete` 把协作仓整体镜像到生产，靠 PROD_ONLY
#    黑名单保护少数路径。但协作仓只持有生产的一个**子集**（1536 vs 3482 文件），
#    所以那一行会从生产删掉 1785 个文件 —— 包括 src/app 全部 972 个（整个
#    Next.js 应用 + 所有 API 路由）、public、tools、templates、scripts、
#    绝大部分 docs、CLAUDE.md、next.config.js、tailwind.config.ts。
#    合并那个 PR = 生产站点整个消失。
#    → 改为 SYNC_PATHS 白名单：只同步协作仓真正拥有的路径。
#
# 2. 【严重】即使换成白名单，`--delete` 仍会删掉 27 个生产文件 —— 那些是
#    PR #18 迁移时为守 CTS 数据边界**故意排除**的（seo-meta 模块、
#    partner-outreach、microsoft/meta/messenger 里的 CTS 专用件）。
#    协作仓里"没有"它们不等于生产该删掉它们。
#    → 全面去掉 --delete。同步只做「新增 + 覆盖」，永不删除。
#      协作仓那边真删了文件，生产侧走一次单独的人工确认，不由本脚本代劳。
#
# 3. 【严重】supabase/migrations 不能整体覆盖回生产：协作仓里那 11 个
#    CTS-touching migration 是**脱敏版**（拿掉了 CTS 的 seed 行），覆盖回去
#    会把生产的真实版本冲掉。且 migration 一旦 apply 过就应视为不可变。
#    → 该路径用 new-only 模式（--ignore-existing）：只带新文件回来，
#      绝不改写生产已有的任何一个 migration。
#
# 另外把「变更预览」从 `--stat | tail -30` 换成分类统计 + 硬闸：
# 出现任何删除、或出现白名单外的改动，直接拒绝，不给 Ray 按 yes 的机会。
# =============================================================================
set -euo pipefail

# ---- 配置 --------------------------------------------------------------------
PROD_REPO="git@github.com:bigbigraydeng-maker/magic-engine.git"
PROD_MAIN="main"                    # 生产部署分支（推 main → Render 自动部署）

# 协作仓拥有、需要回流生产的路径。格式 "路径:模式"
#   overwrite = 新增 + 覆盖（协作仓是这块的上游）
#   new-only  = 只带新文件，绝不改写生产已有文件（用于 migration 这类不可变产物）
# 【维护提示】Jundong 之后在协作仓新写的代码若落在这几个路径之外
# （例如注册页面会落在 src/app），必须先加进这张表，否则不会被发布出去。
# 脚本会在预览阶段把「协作仓有改动但不在白名单」的路径列出来提醒。
SYNC_PATHS=(
  "src/lib:overwrite"
  "src/types:overwrite"
  "supabase/migrations:new-only"
)

# 协作仓专属基建：落在 SYNC_PATHS 里面，但**绝不能流回生产**。
# 实测确认（2026-09-03 dry run）：不排除的话首次发布会把这 6 个文件带进生产，
# 其中 dev-isolation.js 硬编码了协作仓 Dev 网关的 sha256 白名单，应用代码从它
# 取值 —— 一旦进生产，生产自己的 Supabase URL 不在白名单里，生产直接连不上库。
# foundation migration 带 app.collab_environment 前置守卫，进生产同样是 fail-closed。
COLLAB_ONLY=(
  "src/lib/security/dev-isolation.js"
  "src/lib/security/dev-isolation.d.ts"
  "src/lib/security/dev-isolation.test.ts"
  "src/lib/security/dev-api-auth.ts"
  "src/lib/supabase/admin.ts"
  "supabase/migrations/202608270001_collaboration_dev_foundation.sql"
)
# -----------------------------------------------------------------------------

COLLAB_ORG_REPO="magic-engine-dev/magic-engine-jundong-collab"
COLLAB_REPO="git@github.com:${COLLAB_ORG_REPO}.git"
SHA="${1:?用法: $0 <协作仓 main 上的 commit sha>}"
WORK=$(mktemp -d /tmp/me-release.XXXXXX); trap 'rm -rf "$WORK"' EXIT

echo "==> 1/5 校验 $SHA 在协作仓 main 上且 CI 绿"
git clone --quiet "$COLLAB_REPO" "$WORK/collab"
git -C "$WORK/collab" merge-base --is-ancestor "$SHA" origin/main \
  || { echo "该提交不在协作仓 main 上，拒绝发布"; exit 1; }
gh api "repos/${COLLAB_ORG_REPO}/commits/$SHA/check-runs" \
  --jq '[.check_runs[] | select(.name=="verify")][0].conclusion' | grep -qx success \
  || { echo "该提交的 CI verify 未通过，拒绝发布"; exit 1; }
git -C "$WORK/collab" checkout --quiet "$SHA"

echo "==> 2/5 取生产仓，建 release 分支"
git clone --quiet "$PROD_REPO" "$WORK/prod"
git -C "$WORK/prod" checkout --quiet "$PROD_MAIN"
BRANCH="release/collab-$(date +%Y%m%d)-${SHA:0:7}"
git -C "$WORK/prod" checkout --quiet -b "$BRANCH"

echo "==> 3/5 按白名单同步（不删除任何生产文件）"
ALLOW_PREFIXES=()
for entry in "${SYNC_PATHS[@]}"; do
  p="${entry%%:*}"; mode="${entry##*:}"
  ALLOW_PREFIXES+=( "$p" )
  if [ ! -d "$WORK/collab/$p" ]; then
    echo "    - $p：协作仓里没有这个路径，跳过"
    continue
  fi
  mkdir -p "$WORK/prod/$p"
  # 把 COLLAB_ONLY 里属于本路径的项，转成相对本路径的 rsync --exclude
  EX=()
  for c in "${COLLAB_ONLY[@]}"; do
    case "$c" in ("$p"/*) EX+=( --exclude "${c#"$p"/}" ) ;; esac
  done
  case "$mode" in
    overwrite) rsync -a ${EX[@]+"${EX[@]}"}                    "$WORK/collab/$p/" "$WORK/prod/$p/" ;;
    new-only)  rsync -a ${EX[@]+"${EX[@]}"} --ignore-existing  "$WORK/collab/$p/" "$WORK/prod/$p/" ;;
    *) echo "SYNC_PATHS 里 $entry 的模式无法识别，中止"; exit 1 ;;
  esac
  echo "    - $p（$mode，排除 $(( ${#EX[@]} / 2 )) 项协作仓专属）已同步"
done

echo "==> 4/5 变更预览"
git -C "$WORK/prod" add -A

N_ADD=$(git -C "$WORK/prod" diff --cached --name-only --diff-filter=A | wc -l | tr -d ' ')
N_MOD=$(git -C "$WORK/prod" diff --cached --name-only --diff-filter=M | wc -l | tr -d ' ')
N_DEL=$(git -C "$WORK/prod" diff --cached --name-only --diff-filter=D | wc -l | tr -d ' ')
echo "    新增 $N_ADD 个 / 修改 $N_MOD 个 / 删除 $N_DEL 个"

# 硬闸 1：本脚本不做删除。出现删除 = 逻辑有问题，直接拒绝。
if [ "$N_DEL" -ne 0 ]; then
  echo ""
  echo "🛑 出现了 $N_DEL 个删除，但本脚本设计上不删任何生产文件。中止。"
  git -C "$WORK/prod" diff --cached --name-only --diff-filter=D | head -30
  exit 1
fi

# 硬闸 2：所有改动必须落在白名单内。
OUTSIDE=$(git -C "$WORK/prod" diff --cached --name-only | while IFS= read -r f; do
  ok=no
  for p in "${ALLOW_PREFIXES[@]}"; do
    case "$f" in ("$p"/*) ok=yes; break ;; esac
  done
  [ "$ok" = no ] && echo "$f"
done || true)
if [ -n "$OUTSIDE" ]; then
  echo ""
  echo "🛑 有改动落在 SYNC_PATHS 白名单之外，中止："
  echo "$OUTSIDE" | head -30
  exit 1
fi

# 硬闸 3：COLLAB_ONLY 里的东西一个都不许出现在生产。
LEAKED=""
for c in "${COLLAB_ONLY[@]}"; do
  [ -e "$WORK/prod/$c" ] && LEAKED="$LEAKED$c"$'\n'
done
if [ -n "$LEAKED" ]; then
  echo ""
  echo "🛑 协作仓专属文件混进了生产树，中止（这些一旦上线会打死生产）："
  echo "$LEAKED"
  exit 1
fi

if [ "$((N_ADD + N_MOD))" -eq 0 ]; then
  echo ""
  echo "没有任何变化 —— 生产已经是这个版本了，无需发布。"
  exit 0
fi

# 新增文件要人眼过一遍：新文件要么是 Jundong 该上线的新功能，
# 要么是协作仓专属基建漏网。脚本分不出来，Ray 必须看。
if [ "$N_ADD" -gt 0 ]; then
  echo ""
  echo "    ⚠️ 本次会往生产新增 $N_ADD 个文件，逐个确认它们该上线："
  git -C "$WORK/prod" diff --cached --name-only --diff-filter=A | sed 's/^/        /'
fi

echo ""
echo "    改动明细："
git -C "$WORK/prod" diff --cached --stat

# 提醒：协作仓改了、但不在白名单里 = 这次发不出去
CHANGED_IN_COLLAB=$(git -C "$WORK/collab" diff --name-only "origin/main~1" "$SHA" 2>/dev/null || true)
if [ -n "$CHANGED_IN_COLLAB" ]; then
  MISSED=$(echo "$CHANGED_IN_COLLAB" | while IFS= read -r f; do
    ok=no
    for p in "${ALLOW_PREFIXES[@]}"; do
      case "$f" in ("$p"/*) ok=yes; break ;; esac
    done
    [ "$ok" = no ] && echo "$f"
  done || true)
  if [ -n "$MISSED" ]; then
    echo ""
    echo "ℹ️  协作仓这些改动不在白名单内，本次不会发布（如果该发，先加进 SYNC_PATHS）："
    echo "$MISSED" | head -20
  fi
fi

NEW_MIG=$(git -C "$WORK/prod" diff --cached --name-only --diff-filter=A -- 'supabase/migrations/*' || true)
if [ -n "$NEW_MIG" ]; then
  echo ""
  echo "⚠️  本次包含新 migration，合并后需按 docs/sops/ 的流程单独 apply："
  echo "$NEW_MIG"
fi

echo ""
read -rp "确认推送 release 分支并开 PR？(yes/N) " OK
[ "$OK" = "yes" ] || { echo "已取消，未产生任何生产侧改动"; exit 0; }

echo "==> 5/5 提交、推分支、开 PR（不动 $PROD_MAIN）"
git -C "$WORK/prod" commit -qm "release: sync collab main @ ${SHA:0:7}

Source: ${COLLAB_ORG_REPO}@$SHA (CI verify: green)
Synced paths: ${SYNC_PATHS[*]}
Files: +$N_ADD ~$N_MOD (no deletions by design)"
git -C "$WORK/prod" push -q origin "$BRANCH"
gh pr create --repo "$(echo "$PROD_REPO" | sed 's/.*github.com[:/]//;s/\.git$//')" \
  --base "$PROD_MAIN" --head "$BRANCH" \
  --title "Release: collab@${SHA:0:7}" \
  --body "来自协作仓 main 的已测版本（\`$SHA\`，CI verify 绿）。

同步路径：\`${SYNC_PATHS[*]}\`
变更：新增 $N_ADD 个、修改 $N_MOD 个、**删除 0 个**（脚本设计上不删生产文件）。

合并即触发生产自动部署；回滚 = revert 本合并。"
echo "完成：合并该 PR 即上线；回滚 revert 即可。"
