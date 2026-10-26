#!/usr/bin/env python3
"""Fail-closed local executor bridge for one allowlisted, signed profile."""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable


MARKER = "<!-- ME_LOCAL_EXECUTOR_ENVELOPE_V1 -->"
SCHEMA = "ME_LOCAL_EXECUTOR_ENVELOPE_V1"
NAMESPACE = "magic-engine-local-executor-v1"
SIGNER_IDENTITY = "magic-engine-build-control"
ENVELOPE_KEYS = {
    "schema", "issue", "contract_comment_id", "contract_sha256", "executor_id",
    "profile", "issued_at", "expires_at", "nonce", "attempt_limit", "policy_sha256",
}
TERMINAL = {"READY_FOR_RAY_TEST", "BLOCKED"}


class BridgeError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise BridgeError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def load_json_bytes(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BridgeError(f"invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise BridgeError("JSON root must be an object")
    return value


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def policy_digest(policy: dict[str, Any]) -> str:
    return sha256(canonical(policy))


def parse_receipt(comment: str) -> tuple[dict[str, Any], str]:
    if MARKER not in comment:
        raise BridgeError("signed envelope marker missing")
    tail = comment.split(MARKER, 1)[1]
    match = re.search(r"```json\s*(\{.*?\})\s*```", tail, re.DOTALL)
    if not match:
        raise BridgeError("signed receipt JSON fence missing")
    receipt = load_json_bytes(match.group(1).encode())
    if set(receipt) != {"envelope", "signature"}:
        raise BridgeError("receipt must contain only envelope and signature")
    envelope = receipt["envelope"]
    signature = receipt["signature"]
    if not isinstance(envelope, dict) or not isinstance(signature, str):
        raise BridgeError("receipt envelope/signature types are invalid")
    return envelope, signature


def _flatten_comments(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        if all(isinstance(item, dict) for item in payload):
            return payload
        if all(isinstance(page, list) for page in payload):
            return [item for page in payload for item in page if isinstance(item, dict)]
    raise BridgeError("GitHub comments response has an unsupported shape")


def newest_receipt_comment(payload: Any) -> str:
    comments = _flatten_comments(payload)
    marked = [item for item in comments if MARKER in str(item.get("body") or "")]
    if not marked:
        raise BridgeError("no signed local-executor envelope found")
    def ordering(item: dict[str, Any]) -> tuple[str, int]:
        comment_id = item.get("id")
        if not isinstance(comment_id, int):
            raise BridgeError("GitHub comment id is invalid")
        return str(item.get("created_at") or ""), comment_id

    newest = max(marked, key=ordering)
    return str(newest.get("body") or "")


def contract_body_from_comment(payload: dict[str, Any], repo: str, issue: int, comment_id: int) -> str:
    expected_url = f"https://api.github.com/repos/{repo}/issues/{issue}"
    if payload.get("id") != comment_id or payload.get("issue_url") != expected_url:
        raise BridgeError("contract comment does not belong to the signed issue")
    body = payload.get("body")
    if not isinstance(body, str):
        raise BridgeError("contract comment body is missing")
    return body


def _gh_json(gh_path: str, endpoint: str, paginate: bool = False) -> Any:
    command = [gh_path, "api"]
    if paginate:
        command.extend(["--paginate", "--slurp"])
    command.append(endpoint)
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise BridgeError(f"GitHub read failed: {result.stderr.strip()[:300]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise BridgeError("GitHub returned invalid JSON") from exc


def fetch_receipt_and_contract(gh_path: str, repo: str, issue: int) -> tuple[str, str]:
    payload = _gh_json(gh_path, f"repos/{repo}/issues/{issue}/comments?per_page=100", paginate=True)
    comment = newest_receipt_comment(payload)
    envelope, _ = parse_receipt(comment)
    comment_id = envelope.get("contract_comment_id")
    if not isinstance(comment_id, int):
        raise BridgeError("contract comment id is invalid")
    contract = _gh_json(gh_path, f"repos/{repo}/issues/comments/{comment_id}")
    if not isinstance(contract, dict):
        raise BridgeError("contract comment response is invalid")
    return comment, contract_body_from_comment(contract, repo, issue, comment_id)


def validate_runtime_config(config: dict[str, Any], policy: dict[str, Any]) -> tuple[str, str, int]:
    gh_path = config.get("gh_path")
    repo = config.get("repo")
    issue = config.get("issue")
    if not isinstance(gh_path, str) or gh_path != policy.get("github_cli_path"):
        raise BridgeError("GitHub CLI path is not pinned by policy")
    if not isinstance(repo, str) or repo != policy.get("repository"):
        raise BridgeError("GitHub repository is not pinned by policy")
    if not isinstance(issue, int) or issue not in policy.get("allowed_issues", []):
        raise BridgeError("configured issue is not allowlisted")
    return gh_path, repo, issue


def _instant(value: Any, field: str) -> dt.datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise BridgeError(f"{field} must be an ISO UTC timestamp")
    try:
        return dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise BridgeError(f"{field} is invalid") from exc


def validate_envelope(envelope: dict[str, Any], policy: dict[str, Any], now: dt.datetime) -> None:
    if set(envelope) != ENVELOPE_KEYS:
        raise BridgeError("envelope fields do not match the frozen schema")
    if envelope["schema"] != SCHEMA:
        raise BridgeError("unsupported envelope schema")
    if envelope["executor_id"] != policy.get("executor_id"):
        raise BridgeError("executor id is not pinned by policy")
    if envelope["issue"] not in policy.get("allowed_issues", []):
        raise BridgeError("issue is not allowlisted")
    if envelope["profile"] not in policy.get("allowed_profiles", []):
        raise BridgeError("profile is not allowlisted")
    if envelope["attempt_limit"] != 1 or policy.get("attempt_limit") != 1:
        raise BridgeError("only one-attempt envelopes are supported")
    if envelope["policy_sha256"] != policy_digest(policy):
        raise BridgeError("policy hash mismatch")
    if not isinstance(envelope["contract_comment_id"], int) or envelope["contract_comment_id"] <= 0:
        raise BridgeError("contract comment id is invalid")
    if not re.fullmatch(r"[0-9a-f]{64}", str(envelope["contract_sha256"])):
        raise BridgeError("contract hash is invalid")
    if not re.fullmatch(r"[0-9a-f]{32,64}", str(envelope["nonce"])):
        raise BridgeError("nonce is invalid")
    issued = _instant(envelope["issued_at"], "issued_at")
    expires = _instant(envelope["expires_at"], "expires_at")
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    if issued > now + dt.timedelta(minutes=1):
        raise BridgeError("envelope was issued in the future")
    if expires <= now:
        raise BridgeError("envelope has expired")
    max_ttl = int(policy.get("max_ttl_seconds", 0))
    if max_ttl <= 0 or expires - issued > dt.timedelta(seconds=max_ttl):
        raise BridgeError("envelope TTL exceeds policy")


def verify_contract(envelope: dict[str, Any], contract_body: str) -> None:
    if sha256(contract_body.encode("utf-8")) != envelope["contract_sha256"]:
        raise BridgeError("contract body hash mismatch")


def verify_signature(envelope: dict[str, Any], signature: str, allowed_signers: Path) -> None:
    if not allowed_signers.is_file():
        raise BridgeError("pinned allowed-signers file is missing")
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
        handle.write(signature)
        signature_path = Path(handle.name)
    try:
        result = subprocess.run(
            [
                "/usr/bin/ssh-keygen", "-Y", "verify", "-f", str(allowed_signers),
                "-I", SIGNER_IDENTITY, "-n", NAMESPACE, "-s", str(signature_path),
            ],
            input=canonical(envelope), capture_output=True, check=False,
        )
    finally:
        signature_path.unlink(missing_ok=True)
    if result.returncode != 0:
        raise BridgeError("envelope signature is not trusted")


def _read_ledger(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema": "ME_LOCAL_EXECUTOR_LEDGER_V1", "claims": {}}
    value = load_json_bytes(path.read_bytes())
    if value.get("schema") != "ME_LOCAL_EXECUTOR_LEDGER_V1" or not isinstance(value.get("claims"), dict):
        raise BridgeError("ledger schema is invalid")
    return value


def _atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(canonical(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class Ledger:
    def __init__(self, path: Path):
        self.path = path
        self.lock_path = path.with_suffix(path.suffix + ".lock")

    def transition(self, nonce: str, status: str, envelope_hash: str | None = None, detail: str | None = None) -> None:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            ledger = _read_ledger(self.path)
            claims = ledger["claims"]
            existing = claims.get(nonce)
            if status == "CLAIMED":
                if existing is not None:
                    raise BridgeError("nonce has already been claimed; automatic retry denied")
                claims[nonce] = {"status": status, "envelope_sha256": envelope_hash, "history": []}
                existing = claims[nonce]
            elif not isinstance(existing, dict):
                raise BridgeError("cannot transition an unclaimed nonce")
            elif existing.get("status") in TERMINAL:
                raise BridgeError("terminal claim cannot transition")
            existing["status"] = status
            existing["history"].append({
                "status": status,
                "at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                **({"detail": detail[:500]} if detail else {}),
            })
            _atomic_write(self.path, ledger)


def run_obsidian_skin_profile(profile_config: dict[str, Any]) -> str:
    source = Path(str(profile_config.get("sync_source", "")))
    tests = Path(str(profile_config.get("tests_dir", "")))
    python = str(profile_config.get("python_path", "/usr/bin/python3"))
    expected = str(profile_config.get("expected_renderer", "obsidian_skin_v1"))
    if not source.is_file() or not tests.is_dir():
        raise BridgeError("installed Obsidian sync source/tests are missing")
    if expected not in source.read_text(encoding="utf-8"):
        raise BridgeError("installed renderer does not match the pinned profile")
    result = subprocess.run(
        [python, "-m", "unittest", "discover", "-s", str(tests), "-p", "test_*.py"],
        text=True, capture_output=True, check=False,
    )
    if result.returncode != 0:
        raise BridgeError(f"profile tests failed: {result.stderr[-400:]}")
    return "installed source matched; tests passed"


def execute_receipt(
    comment: str,
    policy: dict[str, Any],
    allowed_signers: Path,
    ledger: Ledger,
    profile_config: dict[str, Any],
    contract_body: str,
    now: dt.datetime | None = None,
    handler: Callable[[dict[str, Any]], str] = run_obsidian_skin_profile,
) -> str:
    envelope, signature = parse_receipt(comment)
    validate_envelope(envelope, policy, now or dt.datetime.now(dt.timezone.utc))
    verify_contract(envelope, contract_body)
    verify_signature(envelope, signature, allowed_signers)
    nonce = str(envelope["nonce"])
    digest = sha256(canonical(envelope))
    ledger.transition(nonce, "CLAIMED", digest)
    ledger.transition(nonce, "STARTED")
    try:
        detail = handler(profile_config)
        ledger.transition(nonce, "TESTED", detail=detail)
        ledger.transition(nonce, "READY_FOR_RAY_TEST")
        return "READY_FOR_RAY_TEST"
    except Exception as exc:
        ledger.transition(nonce, "BLOCKED", detail=str(exc))
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = load_json_bytes(args.config.read_bytes())
        required = {
            "gh_path", "repo", "issue", "policy_path", "allowed_signers_path",
            "ledger_path", "profile_config_path",
        }
        if set(config) != required:
            raise BridgeError("bridge config fields do not match the frozen schema")
        root = args.config.parent
        policy = load_json_bytes((root / str(config["policy_path"])).read_bytes())
        gh_path, repo, issue = validate_runtime_config(config, policy)
        receipt, contract = fetch_receipt_and_contract(gh_path, repo, issue)
        status = execute_receipt(
            receipt,
            policy,
            root / str(config["allowed_signers_path"]),
            Ledger(root / str(config["ledger_path"])),
            load_json_bytes((root / str(config["profile_config_path"])).read_bytes()),
            contract,
        )
        print(status)
        return 0
    except (BridgeError, OSError) as exc:
        print(f"BLOCKED: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
