"""Skip only module work proven unrelated to the checked-out PR merge."""

import re
import subprocess
import sys
from pathlib import PurePosixPath

MODULES = {"ai-orchestrator", "ops-review-loop"}


def needs_heavy_checks(module, paths):
    if module not in MODULES or not paths:
        return True
    for path in paths:
        parts = PurePosixPath(path).parts
        if not parts or ".." in parts:
            return True
        if path.startswith("docs/") and path.endswith(".md"):
            continue
        if len(parts) > 2 and parts[0] == "tools" and parts[1] != module:
            continue
        return True
    return False


def inspect_merge(module, base, head):
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
        return True
    try:
        parents = subprocess.check_output(
            ["git", "show", "-s", "--format=%P", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().split()
        if parents != [base, head]:
            return True
        changed = subprocess.check_output(
            ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD", "--"],
            stderr=subprocess.DEVNULL,
        )
        paths = changed.decode("utf-8").split("\0")
        if paths[-1] != "":
            return True
        return needs_heavy_checks(module, paths[:-1])
    except (OSError, subprocess.CalledProcessError, UnicodeError):
        return True


if __name__ == "__main__":
    run = len(sys.argv) != 4 or inspect_merge(*sys.argv[1:])
    print(f"run_heavy={str(run).lower()}")
