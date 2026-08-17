#!/usr/bin/env python3
"""变异验证：逐个破坏一道闸，跑指定测试，确认它**真的红**，然后还原。

绿的测试和有效的测试是两回事。这个脚本产出的是后者的证据。

🔴 **这个文件只放 runner。** 探针定义在 `scripts/kernel_mutations/` 下按主题分模块
   （原来全挤在这里，到了 2501 行 > 仓库铁律的 800）。装配和一致性校验在
   `scripts/kernel_mutations/__init__.py` —— 漏加载一个模块会当场报错，
   不会出现「少跑一批但全绿」。

用法：
    python3 scripts/kernel-mutation-check.py
退出码：有任何一条不是 CAUGHT 就返回 1。
"""
import subprocess, sys, os, json, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kernel_mutations import load_all  # noqa: E402

ROOT = os.getcwd()

#: 全部探针（按 EXPECTED_MODULES 的固定顺序拼出来）
MUTATIONS = load_all()





#: 结构化结果落盘的地方。用 JSON reporter 而不是去 grep 终端输出 ——
#: 见 run_test 里那段说明。
RESULT_JSON = os.path.join(tempfile.gettempdir(), "kernel-mutation-result.json")


def run_test(path):
    """跑一个测试文件，返回 (退出码, 红掉的用例全名列表 | None, 原始输出)。

    🔴 **用 JSON reporter，不再从终端输出里 grep `×` 开头的行。**

       原来那种做法有一个**偶发**失效：`basic` reporter 的逐条用例行是
       带 ANSI 的终端输出，在负载高、输出被截断、或 reporter 换了行首标记时，
       一条 `×` 都 grep 不到 —— 而退出码仍然是 1。于是判定看到的是
       「红了，但一条红的用例都没有」，直接报 WRONG_TEST。
       实测就撞到过一次：单独重跑三次全是 CAUGHT，只有那次完整跑里解析成了空。

       结构化输出没有这个问题：用例名从 JSON 里读，不依赖任何排版。

    🔴 **解析不出来必须返回 None，不能返回空列表。**
       两者长得一样，处置完全相反：空列表 = 「确实没有用例红」（→ 判据没命中），
       None = 「我不知道有没有红」（→ 必须当失败停下来查）。
       把后者当成前者，正是上面那次 WRONG_TEST 的成因。
    """
    if os.path.exists(RESULT_JSON):
        os.remove(RESULT_JSON)
    r = subprocess.run(
        ["npx", "vitest", "run", path, "--reporter=json", "--outputFile", RESULT_JSON],
        capture_output=True, text=True, cwd=ROOT,
    )
    names = None
    try:
        with open(RESULT_JSON, encoding="utf-8") as fh:
            data = json.load(fh)
        names = [
            " > ".join(a.get("ancestorTitles", []) + [a.get("title", "")])
            for res in data.get("testResults", [])
            for a in res.get("assertionResults", [])
            if a.get("status") == "failed"
        ]
    except (OSError, ValueError):
        names = None
    return r.returncode, names, r.stdout + r.stderr


def judge(m, code, names, out):
    """判定一次变异到底有没有被**想验的那道闸**抓住。

    🔴 早先这里只看 `code != 0` —— 「CAUGHT」的真实含义只是
    「那个测试文件里有东西红了」，不是「我想验的那道闸红了」。
    测试文件一大（十几二十个用例），随便哪条附带地红一下就算过，
    等于把变异验证降级成了「跑一下试试」。

    现在 `expect_fail_contains` 是**强制**的：写了就必须有一条红掉的用例名
    包含它；红了但不是那一条 → WRONG_TEST，跟 MISSED 一样算没通过。
    留空表示「这条变异会牵连一大片，不指定具体用例」——那是刻意的例外，
    要在探针里写清楚为什么。
    """
    if names is None:
        # 🔴 单列一类。混进 WRONG_TEST 会把「工具没读到结果」说成
        #    「闸验错了地方」—— 前者要修脚本，后者要修测试，完全两回事。
        return (m["name"], "UNREADABLE", "拿不到结构化结果（vitest 没写出 JSON）——工具问题，不是判据结论")
    if code == 0:
        return (m["name"], "MISSED", "测试全绿 —— 这道闸没有被任何测试盯着")
    want = m.get("expect_fail_contains", "")
    if want and not any(want in n for n in names):
        return (
            m["name"],
            "WRONG_TEST",
            f"红了，但红的不是想验的那条（期望名字里含「{want}」）：" + "; ".join(names[:4]),
        )
    return (m["name"], "CAUGHT", "; ".join(names[:4]))


def preflight():
    """跑之前先把**所有**探针的锚点核一遍，不命中的一次性全列出来。

    🔴 锚点失配是**静默**的：脚本会把那条记成 SKIP 接着跑下去，
       而 SKIP 长得跟「探针本来就少几条」一模一样。真正的代价是时间 ——
       上一轮拆了个模块，一条锚点跟着漂了，等整套跑完两小时才看见。
       这里几秒钟就能把同样的事说清楚。

    返回不命中的清单；空 = 可以跑。
    """
    bad = []
    for m in MUTATIONS:
        if "rename" in m:
            if not os.path.exists(m["rename"][0]):
                bad.append((m["name"], "rename 源文件不存在：" + m["rename"][0]))
            continue
        try:
            src = open(m["file"], encoding="utf-8").read()
        except OSError:
            bad.append((m["name"], "目标文件不存在：" + m["file"]))
            continue
        if m["old"] not in src:
            bad.append((m["name"], "old 锚点没命中（代码改过了，探针要跟着更新）"))
        elif "old2" in m and m["old2"] not in src.replace(m["old"], m["new"], 1):
            bad.append((m["name"], "old2 锚点没命中"))
        if not os.path.exists(m["test"]):
            bad.append((m["name"], "目标测试文件不存在：" + m["test"]))
    return bad


def run_one(m):
    """跑一条探针：破坏 → 跑测试 → **无论如何都还原**。"""
    # 改名型变异：P1-4 防的是文件名撞车，破坏点不在代码里
    if "rename" in m:
        src, dst = m["rename"]
        os.rename(src, dst)
        try:
            return judge(m, *run_test(m["test"]))
        finally:
            os.rename(dst, src)

    f = m["file"]
    original = open(f, encoding="utf-8").read()
    if m["old"] not in original:
        return (m["name"], "SKIP", "锚点没匹配上（代码改过了，变异脚本要跟着更新）")
    mutated = original.replace(m["old"], m["new"], 1)
    # 有些变异要同时动两处（比如「把两条语句调个个儿」= 从这儿删、到那儿加）
    if "old2" in m:
        if m["old2"] not in mutated:
            return (m["name"], "SKIP", "第二个锚点没匹配上（变异脚本要跟着更新）")
        mutated = mutated.replace(m["old2"], m["new2"], 1)
    open(f, "w", encoding="utf-8").write(mutated)
    try:
        return judge(m, *run_test(m["test"]))
    finally:
        open(f, "w", encoding="utf-8").write(original)


def report(results):
    """打印结果并返回退出码。"""
    print(json.dumps(results, ensure_ascii=False, indent=2))
    # 🔴 各类分开报。把 SKIP 混进「漏掉」里看不出「那道闸从没被验过」——
    #    锚点失配是**静默**的，它长得跟「探针少了几条」一模一样。
    counts = {k: sum(1 for r in results if r[1] == k)
              for k in ("CAUGHT", "SKIP", "MISSED", "WRONG_TEST", "UNREADABLE")}
    print(
        f"\n总计 {len(results)} | CAUGHT={counts['CAUGHT']} "
        f"SKIP={counts['SKIP']} MISSED={counts['MISSED']} WRONG_TEST={counts['WRONG_TEST']} "
        f"UNREADABLE={counts['UNREADABLE']}"
    )
    for r in results:
        if r[1] != "CAUGHT":
            print(f"  [{r[1]}] {r[0]} | {r[2][:200]}")
    return 0 if counts["CAUGHT"] == len(results) else 1


def main():
    drifted = preflight()
    if drifted:
        print(f"🔴 预检：{len(drifted)} 条探针的锚点没命中，先修它们再跑（跑完再发现要花两小时）：")
        for name, why in drifted:
            print(f"  [ANCHOR] {name} | {why}")
        return 1
    return report([run_one(m) for m in MUTATIONS])


if __name__ == "__main__":
    sys.exit(main())
