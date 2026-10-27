#!/bin/bash
# Shows the draft wrapper cannot open a non-draft PR, and the git wrapper
# cannot be pointed at a local command. Uses a fake gh/git where the real
# command must not run. Branch creation uses real git.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'sudo rm -rf "$tmp"' EXIT

guard="$tmp/guards"
mock_bin="$tmp/bin"
mkdir -p "$mock_bin"
calls="$tmp/calls"
argv="$tmp/argv"
marker="$tmp/marker"
: > "$calls"
printf '0\n' > "$calls"

if ! sudo -n true; then
  echo "sudo is required to build a non-writable guard dir" >&2
  exit 1
fi

sudo install -d -o root -g root -m 0755 "$guard" "$guard/empty-gh"
sudo install -o root -g root -m 0644 /dev/null "$guard/empty-gitconfig"
printf '%s\n' "https://github.com/bigbigraydeng-maker/magic-engine.git" > "$tmp/origin-url"
sudo install -o root -g root -m 0644 "$tmp/origin-url" "$guard/origin-url"

install_copy() {
  local src="$1" dest="$2"
  shift 2
  sed "$@" "$src" > "$dest"
  chmod 755 "$dest"
}

cat > "$mock_bin/gh" << EOF
#!/bin/bash
printf '%s\\0' "\$@" > "$argv"
echo \$(( \$(cat "$calls") + 1 )) > "$calls"
exit 0
EOF
cat > "$mock_bin/git" << EOF
#!/bin/bash
printf '%s\\0' "\$@" > "$argv"
echo \$(( \$(cat "$calls") + 1 )) > "$calls"
exit 0
EOF
cat > "$mock_bin/gh-with-status" << EOF
#!/bin/bash
set -euo pipefail
printf '%s\\0' "\$@" > "$argv"
echo \$(( \$(cat "$calls") + 1 )) > "$calls"
env > "$tmp/gh-env"
/usr/bin/git status --porcelain >/dev/null
exit 0
EOF
chmod 755 "$mock_bin/gh" "$mock_bin/git" "$mock_bin/gh-with-status"

install_copy "$root/.github/scripts/gh-pr-create-draft.sh" "$tmp/gh-pr-create-draft" \
  -e "s#/opt/claude-guards#$guard#g" \
  -e "s#/usr/bin/gh#$mock_bin/gh#g"
install_copy "$root/.github/scripts/git-limited.sh" "$tmp/git-limited" \
  -e "s#/opt/claude-guards#$guard#g"
install_copy "$root/.github/scripts/git-limited.sh" "$tmp/git-limited-mock" \
  -e "s#/opt/claude-guards#$guard#g" \
  -e "s#/usr/bin/git#$mock_bin/git#g"
install_copy "$root/.github/scripts/gh-pr-create-draft.sh" "$tmp/gh-pr-create-draft-status" \
  -e "s#/opt/claude-guards#$guard#g" \
  -e "s#/usr/bin/gh#$mock_bin/gh-with-status#g"

reset_mock() {
  printf '0\n' > "$calls"
  rm -f "$argv" "$marker"
}

calls_count() { cat "$calls"; }

assert_eq() {
  if [[ "$1" != "$2" ]]; then
    echo "expected [$2] got [$1] ($3)" >&2
    exit 1
  fi
}

# Old shape: a missing --title consumes a trailing --draft and leaves draft false.
simulate_old_swallow() {
  local -a args=(pr create --head feature --body text --title --draft)
  local i=0 draft=false
  while [[ "$i" -lt ${#args[@]} ]]; do
    case "${args[$i]}" in
      pr|create) i=$((i + 1)) ;;
      --draft) draft=true; i=$((i + 1)) ;;
      --head|--body|--title)
        i=$((i + 1))
        [[ "$i" -lt ${#args[@]} ]] && i=$((i + 1))
        ;;
      *) i=$((i + 1)) ;;
    esac
  done
  printf '%s' "$draft"
}

assert_eq "$(simulate_old_swallow)" "false" "old swallow still demonstrates the bug"

simulate_recorded_draft() {
  local -a args=()
  local i=0 draft=false piece
  while IFS= read -r -d '' piece; do
    args+=("$piece")
  done < "$argv"
  while [[ "$i" -lt ${#args[@]} ]]; do
    case "${args[$i]}" in
      pr|create) i=$((i + 1)) ;;
      --draft) draft=true; i=$((i + 1)) ;;
      --draft=false|--draft=0|--draft=f) draft=false; i=$((i + 1)) ;;
      --draft=*) draft=true; i=$((i + 1)) ;;
      --assignee|--attach|--base|--body|--body-file|--head|--label|--milestone|--project|--reviewer|--template|--title|--repo)
        i=$((i + 1))
        [[ "$i" -lt ${#args[@]} ]] && i=$((i + 1))
        ;;
      --*=*) i=$((i + 1)) ;;
      *) i=$((i + 1)) ;;
    esac
  done
  printf '%s' "$draft"
}

expect_git_refused() {
  local name="$1"
  shift
  rm -f "$marker"
  set +e
  ( cd "$repo" && "$@" ) >"$tmp/out" 2>"$tmp/err"
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "$name: expected refusal" >&2
    cat "$tmp/err" >&2
    exit 1
  fi
  if [[ -e "$marker" ]]; then
    echo "$name: command ran" >&2
    exit 1
  fi
  if ! grep -q 'refusing unsafe git config' "$tmp/err"; then
    echo "$name: git ran or failed for another reason" >&2
    cat "$tmp/err" >&2
    exit 1
  fi
}

expect_reject() {
  local name="$1"
  shift
  reset_mock
  set +e
  "$@" >"$tmp/out" 2>"$tmp/err"
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "$name: expected rejection, command succeeded" >&2
    cat "$tmp/err" >&2
    exit 1
  fi
  assert_eq "$(calls_count)" "0" "$name must not run gh or git"
  if [[ -e "$marker" ]]; then
    echo "$name: command marker was created" >&2
    exit 1
  fi
}

expect_draft() {
  local name="$1"
  shift
  reset_mock
  "$@" >"$tmp/out" 2>"$tmp/err"
  assert_eq "$(calls_count)" "1" "$name should call gh once"
  assert_eq "$(simulate_recorded_draft)" "true" "$name draft bit"
  local -a args=()
  local piece
  while IFS= read -r -d '' piece; do
    args+=("$piece")
  done < "$argv"
  assert_eq "${args[0]}" "pr" "$name argv0"
  assert_eq "${args[1]}" "create" "$name argv1"
  assert_eq "${args[2]}" "--draft" "$name draft is first flag"
}

draft="$tmp/gh-pr-create-draft"
expect_reject "dangling title" "$draft" --head feature --body text --title
expect_reject "draft=false" "$draft" --title Hello --body text --draft=false
expect_reject "short draft" "$draft" --title Hello -d=false
expect_reject "web" "$draft" --title Hello --web
expect_reject "unknown flag" "$draft" --title Hello --evil
expect_reject "editor" "$draft" --editor --title Hello
expect_draft "normal long flags" "$draft" --head feature --body text --title Hello
expect_draft "equals form" "$draft" --head=feature --body=text --title=Hello
expect_draft "fill bool" "$draft" --fill --title Hello --body text

git_real="$tmp/git-limited"
git_mock="$tmp/git-limited-mock"
repo="$tmp/repo"
git init -q "$repo"
git -C "$repo" config user.email t@example.com
git -C "$repo" config user.name t
echo a > "$repo/a.txt"
git -C "$repo" add a.txt
git -C "$repo" commit -qm init
echo b >> "$repo/a.txt"
git -C "$repo" add a.txt
git -C "$repo" commit -qm second
side_sha="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" checkout -q HEAD~1

expect_reject "fetch upload-pack" "$git_real" fetch --upload-pack="touch $marker" .
expect_reject "fetch local dot" "$git_real" fetch .
expect_reject "fetch ext" "$git_real" fetch "ext::touch $marker"
expect_reject "fetch -c" "$git_real" fetch -c core.sshCommand="touch $marker"
expect_reject "fetch --exec" "$git_real" fetch --exec="touch $marker"
expect_reject "leading -c" "$git_real" -c core.sshCommand="touch $marker" fetch
expect_reject "checkout upload-pack" "$git_real" checkout --upload-pack="touch $marker"
expect_reject "checkout --exec" "$git_real" checkout --exec="touch $marker"
expect_reject "checkout -c config" "$git_real" checkout -c core.sshCommand=evil
expect_reject "switch upload-pack" "$git_real" switch --upload-pack="touch $marker"
expect_reject "switch config-looking name" "$git_real" switch -c "core.sshCommand=evil"
expect_reject "cherry-pick --exec" "$git_real" cherry-pick --exec="touch $marker"
expect_reject "cherry-pick -c" "$git_real" cherry-pick -c HEAD

hook_dir="$tmp/hooks"
mkdir -p "$hook_dir"
printf '#!/bin/sh\ntouch %s\n' "$marker" > "$hook_dir/post-checkout"
printf '#!/bin/sh\ntouch %s\n' "$marker" > "$hook_dir/post-commit"
chmod 755 "$hook_dir/post-checkout" "$hook_dir/post-commit"
git -C "$repo" config core.hooksPath "$hook_dir"
rm -f "$marker"
(
  cd "$repo"
  "$git_real" switch -c feature-a
  "$git_real" checkout -b feature-b
  "$git_real" checkout feature-a
  "$git_real" cherry-pick "$side_sha"
)
if [[ -e "$marker" ]]; then
  echo "checkout or commit hook ran" >&2
  exit 1
fi
assert_eq "$(git -C "$repo" branch --show-current)" "feature-a" "cherry-pick stays on feature-a"
assert_eq "$(git -C "$repo" log -1 --format=%s)" "second" "cherry-pick kept the commit subject"
grep -q '^b$' <(git -C "$repo" show HEAD:a.txt)
( cd "$repo" && "$git_real" checkout -b feature-from feature-a )
assert_eq "$(git -C "$repo" branch --show-current)" "feature-from" "checkout -b accepts a start point"

git -C "$repo" config core.fsmonitor "touch $marker"
rm -f "$marker"
set +e
( cd "$repo" && "$git_real" switch feature-b ) >"$tmp/out" 2>"$tmp/err"
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "fsmonitor config should be refused" >&2
  exit 1
fi
if [[ -e "$marker" ]]; then
  echo "fsmonitor command ran" >&2
  exit 1
fi
git -C "$repo" config --unset core.fsmonitor

git -C "$repo" config remote.origin.uploadpack "touch $marker"
rm -f "$marker"
set +e
( cd "$repo" && "$git_real" fetch ) >"$tmp/out" 2>"$tmp/err"
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "uploadpack config should be refused" >&2
  exit 1
fi
if [[ -e "$marker" ]]; then
  echo "uploadpack config command ran" >&2
  exit 1
fi
git -C "$repo" config --unset remote.origin.uploadpack

git -C "$repo" config alias.checkout "!touch $marker; exit 9"
rm -f "$marker"
set +e
( cd "$repo" && "$git_real" checkout -b feature-alias ) >"$tmp/out" 2>"$tmp/err"
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "alias config should be refused" >&2
  exit 1
fi
if [[ -e "$marker" ]]; then
  echo "alias command ran" >&2
  exit 1
fi

git -C "$repo" config --remove-section alias
git -C "$repo" config diff.evil.command "touch $marker"
rm -f "$marker"
set +e
( cd "$repo" && "$git_real" switch feature-a ) >"$tmp/out" 2>"$tmp/err"
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "diff command config should be refused" >&2
  exit 1
fi
if [[ -e "$marker" ]]; then
  echo "diff command ran" >&2
  exit 1
fi
git -C "$repo" config --unset diff.evil.command

reset_mock
( cd "$repo" && "$git_mock" fetch --prune main )
assert_eq "$(calls_count)" "2" "safe fetch lists config, then calls git once"
python3 - "$argv" "$guard/origin-url" << 'PY'
import pathlib, sys
argv = pathlib.Path(sys.argv[1]).read_bytes().split(b"\0")
argv = [a.decode() for a in argv if a]
origin = pathlib.Path(sys.argv[2]).read_text().strip()
text = "\n".join(argv)
need = [
    "protocol.ext.allow=never",
    "protocol.file.allow=never",
    "protocol.ssh.allow=never",
    "core.sshCommand=/usr/bin/ssh",
    "core.fsmonitor=false",
    "core.hooksPath=/dev/null",
    "core.attributesFile=/dev/null",
    "credential.helper=",
    "alias.fetch=",
    "core.askPass=/usr/bin/true",
    "fetch.recurseSubmodules=false",
    "gpg.program=/usr/bin/true",
]
for item in need:
    if item not in argv:
        raise SystemExit(f"missing safety config {item}")
if "--upload-pack" in text or "--exec" in text:
    raise SystemExit("exec flag leaked into git argv")
fetch_at = argv.index("fetch")
if any(arg == "-c" or arg.startswith("--config") for arg in argv[fetch_at + 1:]):
    raise SystemExit("config flag after subcommand")
if origin not in argv:
    raise SystemExit("fixed origin url missing")
if "." in argv or any(arg.startswith("ext::") for arg in argv):
    raise SystemExit("local or ext remote leaked")
if "refs/heads/main:refs/remotes/origin/main" not in argv:
    raise SystemExit("branch refspec missing")
PY

perm="$(awk '
  $1 == "permissions:" { show=1 }
  show { print }
  show && $1 == "steps:" { exit }
' "$root/.github/workflows/claude.yml")"
expected="$(printf '%s\n' \
  '    permissions:' \
  '      contents: read' \
  '      pull-requests: read' \
  '      issues: read' \
  '      id-token: write' \
  '      actions: read # Required for Claude to read CI results on PRs' \
  '    steps:')"
assert_eq "$perm" "$expected" "job permissions changed"
if grep -E -q 'Bash\(git (fetch|checkout|switch|cherry-pick):' "$root/.github/workflows/claude.yml"; then
  echo "raw git prefix is still allowed" >&2
  exit 1
fi

# Old line-start regex misses `[filter.evil] smudge = ...` on one line.
# No attributes file: only Git's parsed keys can see this smudge command.
config_backup="$tmp/config.bak"
cp "$repo/.git/config" "$config_backup"
printf '\n[filter.evil] smudge = touch %s\n' "$marker" >> "$repo/.git/config"
expect_git_refused "one-line filter key" "$git_real" checkout a.txt
printf 'a.txt filter=evil\n' > "$repo/.git/info/attributes"
rm -f "$repo/a.txt"
expect_git_refused "one-line filter smudge" "$git_real" checkout a.txt
cp "$config_backup" "$repo/.git/config"
rm -f "$repo/.git/info/attributes" "$marker"
git -C "$repo" checkout -q -- a.txt

# .git/config only enables the worktree file. The smudge lives in that file,
# with no attributes, so refusing means the worktree file was parsed.
git -C "$repo" config extensions.worktreeConfig true
printf '[filter "evil"]\n\tsmudge = touch %s\n' "$marker" > "$repo/.git/config.worktree"
expect_git_refused "worktree filter key" "$git_real" checkout a.txt
printf 'a.txt filter=evil\n' > "$repo/.git/info/attributes"
rm -f "$repo/a.txt"
expect_git_refused "worktree filter smudge" "$git_real" checkout a.txt
cp "$config_backup" "$repo/.git/config"
rm -f "$repo/.git/config.worktree" "$repo/.git/info/attributes" "$marker"
git -C "$repo" checkout -q -- a.txt

# gh pr create runs git status, which honors core.fsmonitor unless the
# wrapper isolates git's config for that child.
git -C "$repo" config core.fsmonitor "touch $marker"
rm -f "$marker"
reset_mock
( cd "$repo" && "$tmp/gh-pr-create-draft-status" --title Hello --body text )
assert_eq "$(calls_count)" "1" "fsmonitor still lets gh start"
if [[ -e "$marker" ]]; then
  echo "gh git status ran fsmonitor" >&2
  exit 1
fi
grep -q '^GIT_CONFIG_NOSYSTEM=1$' "$tmp/gh-env"
grep -q '^GIT_CONFIG_GLOBAL=/dev/null$' "$tmp/gh-env"
grep -q '^GIT_CONFIG_KEY_0=core.fsmonitor$' "$tmp/gh-env"
grep -q '^GIT_CONFIG_VALUE_0=false$' "$tmp/gh-env"
git -C "$repo" config --unset core.fsmonitor

echo "claude-guards tests passed"
