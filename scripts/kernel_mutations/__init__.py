"""变异探针的装配层 —— 把各主题模块按**固定顺序**拼成一张总表。

🔴 **顺序是契约的一部分。** 探针一条条改文件再还原，顺序变了不影响正确性，
   但会让「拆分前后完全一致」这件事没法逐条比对。所以 `EXPECTED_MODULES`
   是一份**写死的有序清单**，不靠目录扫描 —— 扫描出来的顺序取决于文件系统。

🔴 **漏加载一个模块必须当场失败，不能「少跑一批但全绿」。**
   这是这个文件存在的主要理由：拆成多模块之后，最危险的退化不是探针写错，
   而是某个模块**没被 import** —— 那一批探针一条都不跑，而汇总数字看起来
   完全正常（总数变小了，但没人盯着总数）。下面三道校验各堵一种走法：
     ① 清单里的模块必须**真的存在**且导得进来（拼错名字 / 文件被删 → 报错）；
     ② 磁盘上的 `*.py` 必须**全部在清单里**（新加模块忘了登记 → 报错）；
     ③ 总数必须等于 `EXPECTED_TOTAL`（探针被删 / 被合并 → 报错）。
"""

import importlib
import os

#: 主题模块，**有序**。加模块必须同时改这里，否则 ② 会失败。
EXPECTED_MODULES = [
    'authorization',
    'recovery',
    'execution',
    'contracts',
    'approval',
    'approval_rollout',
]

#: 探针总数。改动探针数量时必须同步 —— 它是「有没有人偷偷删探针压行数」的闸。
EXPECTED_TOTAL = 247


class MutationRegistryError(RuntimeError):
    """装配出了问题。**一律当失败**，绝不降级成「少跑几条」。"""


def _module_files():
    here = os.path.dirname(os.path.abspath(__file__))
    return sorted(
        f[:-3]
        for f in os.listdir(here)
        if f.endswith('.py') and f != '__init__.py'
    )


def load_all():
    """按 `EXPECTED_MODULES` 的顺序拼出总表，并做三道一致性校验。"""
    on_disk = set(_module_files())
    listed = set(EXPECTED_MODULES)

    # ② 磁盘上有、清单里没有 —— 新模块忘了登记，那一批会静静地不跑
    orphan = sorted(on_disk - listed)
    if orphan:
        raise MutationRegistryError(
            f'这些探针模块没登记进 EXPECTED_MODULES，不会被加载：{orphan}。'
            '漏加载一个模块 = 那一批探针一条都不跑，而汇总数字看起来完全正常。'
        )

    # ① 清单里有、磁盘上没有 —— 拼错名字 / 文件被删
    missing = sorted(listed - on_disk)
    if missing:
        raise MutationRegistryError(
            f'EXPECTED_MODULES 里这些模块在磁盘上不存在：{missing}'
        )

    mutations = []
    for name in EXPECTED_MODULES:
        mod = importlib.import_module(f'{__name__}.{name}')
        if not hasattr(mod, 'MUTATIONS'):
            raise MutationRegistryError(f'模块 {name} 没有 MUTATIONS')
        mutations.extend(mod.MUTATIONS)

    # ③ 总数 —— 防「删探针 / 合并探针」压行数
    if len(mutations) != EXPECTED_TOTAL:
        raise MutationRegistryError(
            f'探针总数是 {len(mutations)}，清单说好的是 {EXPECTED_TOTAL}。'
            '要么有人删/合并了探针，要么加了新的却没更新 EXPECTED_TOTAL。'
        )

    names = [m['name'] for m in mutations]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise MutationRegistryError(f'探针重名（会让报告对不上号）：{dupes}')

    return mutations
