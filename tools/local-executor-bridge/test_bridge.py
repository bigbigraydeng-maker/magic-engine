from __future__ import annotations

import datetime as dt
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("local_executor_bridge", HERE / "bridge.py")
BRIDGE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(BRIDGE)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.key = self.root / "signer"
        subprocess.run(
            ["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(self.key)],
            check=True,
        )
        pub = (self.key.with_suffix(".pub")).read_text(encoding="utf-8").strip()
        self.allowed = self.root / "allowed_signers"
        self.allowed.write_text(f"{BRIDGE.SIGNER_IDENTITY} {pub}\n", encoding="utf-8")
        self.policy = json.loads((HERE / "policy.v1.json").read_text(encoding="utf-8"))
        self.now = dt.datetime(2026, 8, 29, 4, 0, tzinfo=dt.timezone.utc)
        self.contract = "fixed Build Control contract for Issue #1222\n"
        self.envelope = {
            "schema": BRIDGE.SCHEMA,
            "issue": 1222,
            "contract_comment_id": 5453778927,
            "contract_sha256": BRIDGE.sha256(self.contract.encode("utf-8")),
            "executor_id": "com.magicengine.obsidian-control-sync",
            "profile": "obsidian_skin_v1",
            "issued_at": "2026-08-29T03:59:00Z",
            "expires_at": "2026-08-29T04:10:00Z",
            "nonce": "b" * 32,
            "attempt_limit": 1,
            "policy_sha256": BRIDGE.policy_digest(self.policy),
        }

    def tearDown(self):
        self.temp.cleanup()

    def receipt(self, envelope=None):
        envelope = envelope or self.envelope
        raw = BRIDGE.canonical(envelope)
        payload = self.root / "envelope.json"
        payload.write_bytes(raw)
        sig = payload.with_suffix(".json.sig")
        sig.unlink(missing_ok=True)
        subprocess.run(
            [
                "/usr/bin/ssh-keygen", "-Y", "sign", "-f", str(self.key),
                "-n", BRIDGE.NAMESPACE, str(payload),
            ],
            check=True, capture_output=True,
        )
        body = {
            "envelope": envelope,
            "signature": sig.read_text(encoding="utf-8"),
        }
        return f"{BRIDGE.MARKER}\n```json\n{json.dumps(body)}\n```"

    def execute(self, comment, handler=lambda _: "tests passed", contract=None):
        ledger = BRIDGE.Ledger(self.root / "ledger.json")
        status = BRIDGE.execute_receipt(
            comment,
            self.policy,
            self.allowed,
            ledger,
            {},
            self.contract if contract is None else contract,
            now=self.now,
            handler=handler,
        )
        return status, json.loads((self.root / "ledger.json").read_text(encoding="utf-8"))

    def test_signed_allowlisted_envelope_reaches_ready_for_ray_test(self):
        status, ledger = self.execute(self.receipt())
        self.assertEqual(status, "READY_FOR_RAY_TEST")
        claim = ledger["claims"]["b" * 32]
        self.assertEqual(claim["status"], "READY_FOR_RAY_TEST")
        self.assertEqual(
            [item["status"] for item in claim["history"]],
            ["CLAIMED", "STARTED", "TESTED", "READY_FOR_RAY_TEST"],
        )

    def test_same_nonce_can_never_dispatch_twice(self):
        calls = []
        comment = self.receipt()
        self.execute(comment, lambda _: calls.append("run") or "ok")
        with self.assertRaisesRegex(BRIDGE.BridgeError, "already been claimed"):
            self.execute(comment, lambda _: calls.append("run") or "ok")
        self.assertEqual(calls, ["run"])

    def test_non_allowlisted_issue_fails_closed(self):
        envelope = {**self.envelope, "issue": 1188}
        with self.assertRaisesRegex(BRIDGE.BridgeError, "not allowlisted"):
            self.execute(self.receipt(envelope))
        self.assertFalse((self.root / "ledger.json").exists())

    def test_expired_envelope_fails_before_claim(self):
        envelope = {**self.envelope, "expires_at": "2026-08-29T03:59:59Z"}
        with self.assertRaisesRegex(BRIDGE.BridgeError, "expired"):
            self.execute(self.receipt(envelope))
        self.assertFalse((self.root / "ledger.json").exists())

    def test_tampering_after_signature_is_rejected(self):
        receipt = self.receipt().replace('"profile": "obsidian_skin_v1"', '"profile": "shell"')
        with self.assertRaises(BRIDGE.BridgeError):
            self.execute(receipt)
        self.assertFalse((self.root / "ledger.json").exists())

    def test_contract_body_must_match_the_signed_hash(self):
        with self.assertRaisesRegex(BRIDGE.BridgeError, "contract body hash mismatch"):
            self.execute(self.receipt(), contract="changed contract\n")
        self.assertFalse((self.root / "ledger.json").exists())

    def test_arbitrary_payload_field_is_rejected(self):
        envelope = {**self.envelope, "shell": "rm -rf /"}
        with self.assertRaisesRegex(BRIDGE.BridgeError, "frozen schema"):
            self.execute(self.receipt(envelope))

    def test_policy_hash_change_requires_a_new_signature_and_policy(self):
        envelope = {**self.envelope, "policy_sha256": "0" * 64}
        with self.assertRaisesRegex(BRIDGE.BridgeError, "policy hash mismatch"):
            self.execute(self.receipt(envelope))

    def test_profile_failure_leaves_a_durable_blocked_receipt(self):
        def fail(_):
            raise RuntimeError("profile test failed")

        with self.assertRaisesRegex(RuntimeError, "profile test failed"):
            self.execute(self.receipt(), fail)
        ledger = json.loads((self.root / "ledger.json").read_text(encoding="utf-8"))
        claim = ledger["claims"]["b" * 32]
        self.assertEqual(claim["status"], "BLOCKED")
        self.assertEqual(
            [item["status"] for item in claim["history"]],
            ["CLAIMED", "STARTED", "BLOCKED"],
        )

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaisesRegex(BRIDGE.BridgeError, "duplicate JSON key"):
            BRIDGE.load_json_bytes(b'{"schema":"a","schema":"b"}')

    def test_newest_marked_comment_is_selected_without_falling_back_to_prose(self):
        payload = [[
            {"id": 1, "created_at": "2026-08-29T01:00:00Z", "body": BRIDGE.MARKER + " old"},
            {"id": 2, "created_at": "2026-08-29T02:00:00Z", "body": "ordinary discussion"},
        ], [
            {"id": 3, "created_at": "2026-08-29T03:00:00Z", "body": BRIDGE.MARKER + " newest"},
        ]]
        self.assertEqual(BRIDGE.newest_receipt_comment(payload), BRIDGE.MARKER + " newest")

    def test_contract_comment_must_belong_to_the_same_issue(self):
        payload = {
            "id": 55,
            "issue_url": "https://api.github.com/repos/acme/repo/issues/999",
            "body": "contract",
        }
        with self.assertRaisesRegex(BRIDGE.BridgeError, "does not belong"):
            BRIDGE.contract_body_from_comment(payload, "acme/repo", 1222, 55)

    def test_runtime_source_is_pinned_by_policy(self):
        config = {
            "gh_path": "/opt/homebrew/bin/gh",
            "repo": "attacker/repo",
            "issue": 1222,
        }
        with self.assertRaisesRegex(BRIDGE.BridgeError, "repository is not pinned"):
            BRIDGE.validate_runtime_config(config, self.policy)

    def test_runtime_issue_type_cannot_be_coerced(self):
        config = {
            "gh_path": "/opt/homebrew/bin/gh",
            "repo": "bigbigraydeng-maker/magic-engine",
            "issue": "1222",
        }
        with self.assertRaisesRegex(BRIDGE.BridgeError, "issue is not allowlisted"):
            BRIDGE.validate_runtime_config(config, self.policy)


if __name__ == "__main__":
    unittest.main()
