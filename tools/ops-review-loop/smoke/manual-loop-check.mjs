// 人工验证脚本 — 用来确认 ME2-OPS02 的 Codex→Claude 自动修复循环在
// `claude/me2-*` 分支上到底会不会真的触发（此前 100/100 次运行全是
// "skipped"，根因是分支名不匹配，见 tools/ops-review-loop/src/fix-scope.mjs）。
//
// 本文件及所在分支不会被合并进 main，验证完成后由 Product Owner 决定
// 是否关闭 PR（不会自动删除分支 —— 仓库规则禁止删除 claude/* 分支）。
//
// 下面这个函数留了一个刻意的越界 bug，用来看 Codex 会不会审出来并打上
// P0/P1/P2 标签，从而触发自动修复那条腿。

export function averageScore(scores) {
  let total = 0;
  for (let i = 0; i < scores.length; i++) {
    total += scores[i];
  }
  return total / scores.length;
}
