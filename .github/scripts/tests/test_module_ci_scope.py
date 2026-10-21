import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "module-ci-scope.py"
SPEC = importlib.util.spec_from_file_location("module_ci_scope", SCRIPT)
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)


class ScopePathsTest(unittest.TestCase):
    def test_docs_and_sibling_modules_skip_only_the_unrelated_suite(self):
        for module in SCOPE.MODULES:
            sibling = next(name for name in SCOPE.MODULES if name != module)
            for paths in (["docs/ledger/card.md"], ["docs/specs/new\nname.md"],
                          [f"tools/{sibling}/src/test.ts"],
                          ["docs/a.md", f"tools/{sibling}/src/test.ts"]):
                with self.subTest(module=module, paths=paths):
                    self.assertFalse(SCOPE.needs_heavy_checks(module, paths))

    def test_code_config_own_module_and_unknown_inputs_still_run(self):
        for module in SCOPE.MODULES:
            for path in (f"tools/{module}/README.md", "src/app/page.tsx",
                         "package.json", "package-lock.json", "tsconfig.json",
                         "vitest.config.ts", ".github/workflows/a.yml",
                         ".github/scripts/module-ci-scope.py", "README.md",
                         "docs/script.ts", "docs/../package.json", "unknown"):
                with self.subTest(module=module, path=path):
                    self.assertTrue(SCOPE.needs_heavy_checks(module, ["docs/a.md", path]))
            self.assertTrue(SCOPE.needs_heavy_checks(module, []))
        self.assertTrue(SCOPE.needs_heavy_checks("unknown", ["docs/a.md"]))


class RealMergeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = {**os.environ, "GIT_AUTHOR_NAME": "CI Test",
                    "GIT_COMMITTER_NAME": "CI Test",
                    "GIT_AUTHOR_EMAIL": "ci@example.invalid",
                    "GIT_COMMITTER_EMAIL": "ci@example.invalid"}
        self.git("init", "-b", "main")
        (self.root / "code.ts").write_text("export const n = 1\n")
        self.git("add", ".")
        self.git("commit", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "-c", "pr")

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, env=self.env,
                                       stderr=subprocess.DEVNULL).decode()

    def merge(self):
        self.git("add", "-A")
        self.git("commit", "-m", "change")
        self.head = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "main")
        self.git("merge", "--no-ff", "pr", "-m", "PR merge")

    def run_scope(self, base=None, head=None):
        return subprocess.check_output(
            ["python3", str(SCRIPT), "ai-orchestrator", base or self.base,
             head or self.head], cwd=self.root, env=self.env
        ).decode().strip()

    def test_real_docs_merge_skips_with_two_commit_checkout(self):
        (self.root / "docs").mkdir()
        (self.root / "docs" / "new\nname.md").write_text("docs\n")
        self.merge()
        self.assertEqual(self.run_scope(), "run_heavy=false")
        checkout = self.root / "shallow"
        self.git("clone", "--depth", "2", self.root.as_uri(), str(checkout))
        result = subprocess.check_output(
            ["python3", str(SCRIPT), "ai-orchestrator", self.base, self.head],
            cwd=checkout, env=self.env).decode().strip()
        self.assertEqual(result, "run_heavy=false")

    def test_renaming_code_into_docs_cannot_skip_tests(self):
        (self.root / "docs").mkdir()
        self.git("mv", "code.ts", "docs/hidden.md")
        self.merge()
        self.assertEqual(self.run_scope(), "run_heavy=true")

    def test_unknown_or_moved_refs_run_full_checks(self):
        (self.root / "docs").mkdir()
        (self.root / "docs" / "a.md").write_text("docs\n")
        self.merge()
        self.assertEqual(self.run_scope(base="0" * 40), "run_heavy=true")
        self.assertEqual(self.run_scope(head="not-a-sha"), "run_heavy=true")
        self.git("switch", "pr")
        self.assertEqual(self.run_scope(), "run_heavy=true")


if __name__ == "__main__":
    unittest.main()
