#!/bin/bash
# Limited git for the Claude workflow: fetch, checkout, switch, cherry-pick.
# Installed root-owned outside the repo. The allowlist names that path.
# Raw `git fetch` / `checkout` / `switch` / `cherry-pick` are not allowed.
set -euo pipefail

export PATH=/usr/bin:/bin
export GIT_CONFIG_GLOBAL=/opt/claude-guards/empty-gitconfig
export GIT_CONFIG_NOSYSTEM=1
export GIT_PAGER=cat
export GIT_TERMINAL_PROMPT=0
export GIT_ATTR_NOSYSTEM=1

unset GIT_SSH_COMMAND GIT_EXEC_PATH GIT_DIR GIT_WORK_TREE GIT_NAMESPACE \
  GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_CONFIG_SYSTEM \
  GIT_ALLOW_PROTOCOL GIT_PROTOCOL_FROM_USER \
  GIT_EXTERNAL_DIFF GIT_EDITOR GIT_SEQUENCE_EDITOR EDITOR VISUAL PAGER \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_INDEX_FILE

while IFS= read -r _git_limited_name; do
  case "$_git_limited_name" in
    GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*) unset "$_git_limited_name" ;;
  esac
done < <(compgen -e)

# Fixed keys that name a command. These beat .git/config. Filter names are
# open-ended, so those are refused after Git parses the config instead.
export GIT_CONFIG_COUNT=4
export GIT_CONFIG_KEY_0=core.fsmonitor
export GIT_CONFIG_VALUE_0=false
export GIT_CONFIG_KEY_1=core.hooksPath
export GIT_CONFIG_VALUE_1=/dev/null
export GIT_CONFIG_KEY_2=core.attributesFile
export GIT_CONFIG_VALUE_2=/dev/null
export GIT_CONFIG_KEY_3=credential.helper
export GIT_CONFIG_VALUE_3=

refuse() {
  echo "git-limited: $*" >&2
  exit 2
}

assert_guards() {
  local guard=/opt/claude-guards
  local origin=$guard/origin-url
  local empty=$guard/empty-gitconfig
  if [[ ! -d "$guard" || -w "$guard" ]]; then
    refuse "guard dir must exist and not be writable"
  fi
  if [[ ! -f "$empty" || -w "$empty" ]]; then
    refuse "empty gitconfig must exist and not be writable"
  fi
  if [[ ! -f "$origin" || -w "$origin" ]]; then
    refuse "origin url file must exist and not be writable"
  fi
  if [[ ! -x /usr/bin/git ]]; then
    refuse "/usr/bin/git missing"
  fi
}

read_origin() {
  local url
  url="$(tr -d '\r\n' < /opt/claude-guards/origin-url)"
  if [[ ! "$url" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$ ]]; then
    refuse "origin url is not a fixed https GitHub repository"
  fi
  printf '%s' "$url"
}

# Git parsed this key/value. Includes are refused instead of followed: an
# include path can block, and the included file can change before exec.
config_entry_unsafe() {
  local key="${1,,}" value="$2"
  case "$value" in
    '!'*|*'ext::'*) return 0 ;;
  esac
  case "$key" in
    include.path|includeif.*|alias.*|insteadof|*.insteadof) return 0 ;;
    *.smudge|*.clean|*.process|*.textconv|*.driver|*.external|*.command) return 0 ;;
    *.sshcommand|*.fsmonitor|*.gitproxy|*.uploadpack|*.receivepack) return 0 ;;
  esac
  return 1
}

# `git config --file --list` understands `[filter.evil] smudge = ...`.
# A line-start regex does not. Empty output is safe only when git exits 0.
parsed_config_unsafe() {
  local file="$1" line key value out
  out="$(mktemp)"
  if ! /usr/bin/git config --file "$file" --list >"$out" 2>/dev/null; then
    rm -f "$out"
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    key="${line%%=*}"
    value="${line#*=}"
    if config_entry_unsafe "$key" "$value"; then
      rm -f "$out"
      return 0
    fi
  done <"$out"
  rm -f "$out"
  return 1
}

# filter.<name> cannot be wildcarded away. A filter= attribute would still
# run whatever smudge the config names, including one we failed to see.
attributes_request_filter() {
  local path
  if [[ -L .git/info/attributes ]]; then
    return 0
  fi
  if [[ -f .git/info/attributes ]] && grep -E -q '(^|[[:space:]])filter=' .git/info/attributes; then
    return 0
  fi
  while IFS= read -r -d '' path; do
    if [[ -L "$path" ]] || grep -E -q '(^|[[:space:]])filter=' "$path"; then
      return 0
    fi
  done < <(find . -path './.git' -prune -o -name .gitattributes -print0)
  return 1
}

# Local config can still name commands. Also read .git/config.worktree:
# extensions.worktreeConfig makes Git load it in addition to .git/config.
assert_config_safe() {
  local cfg=".git/config" wt=".git/config.worktree"
  if [[ -L .git || ! -d .git || -L "$cfg" || ! -f "$cfg" ]]; then
    refuse "refusing to run without a normal .git directory"
  fi
  if [[ -L "$wt" ]]; then
    refuse "refusing unsafe git config"
  fi
  if parsed_config_unsafe "$cfg"; then
    refuse "refusing unsafe git config"
  fi
  if [[ -e "$wt" ]]; then
    if [[ ! -f "$wt" ]] || parsed_config_unsafe "$wt"; then
      refuse "refusing unsafe git config"
    fi
  fi
  if attributes_request_filter; then
    refuse "refusing unsafe git config"
  fi
}

is_branch_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$ ]] || return 1
  [[ "$1" != *..* && "$1" != *//* && "$1" != */.* && "$1" != *.lock ]] || return 1
  [[ "$1" != */ && "$1" != -* ]] || return 1
  return 0
}

is_rev() {
  if is_branch_name "$1"; then
    return 0
  fi
  [[ "$1" =~ ^[0-9a-fA-F]{7,64}$ ]] && return 0
  [[ "$1" =~ ^HEAD(~[0-9]+)?$ ]] && return 0
  [[ "$1" =~ ^HEAD\^[0-9]*$ ]] && return 0
  return 1
}

# Safety -c flags are before the subcommand, so they are global config and
# win over repo config. Caller args never include these flags.
git_exec() {
  assert_config_safe
  exec /usr/bin/git --no-pager \
    -c protocol.ext.allow=never \
    -c protocol.file.allow=never \
    -c protocol.ssh.allow=never \
    -c core.sshCommand=/usr/bin/ssh \
    -c core.fsmonitor=false \
    -c core.hooksPath=/dev/null \
    -c core.attributesFile=/dev/null \
    -c core.pager=cat \
    -c core.editor=true \
    -c sequence.editor=true \
    -c commit.gpgsign=false \
    -c tag.gpgsign=false \
    -c gpg.program=/usr/bin/true \
    -c core.askPass=/usr/bin/true \
    -c fetch.recurseSubmodules=false \
    -c submodule.recurse=false \
    -c alias.fetch= \
    -c alias.checkout= \
    -c alias.switch= \
    -c alias.cherry-pick= \
    -c credential.helper= \
    -c safe.directory='*' \
    "$@"
}

run_fetch() {
  local -a flags=() refs=()
  local url
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prune|--tags|--no-tags|--quiet|--verbose|--dry-run|--no-recurse-submodules)
        flags+=("$1")
        shift
        ;;
      --depth)
        [[ $# -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || refuse "bad depth"
        flags+=(--depth "$2")
        shift 2
        ;;
      --depth=*)
        [[ "${1#--depth=}" =~ ^[1-9][0-9]*$ ]] || refuse "bad depth"
        flags+=("$1")
        shift
        ;;
      -*)
        refuse "flag not allowed: $1"
        ;;
      *)
        is_branch_name "$1" || refuse "ref not allowed"
        refs+=("refs/heads/$1:refs/remotes/origin/$1")
        shift
        ;;
    esac
  done
  url="$(read_origin)"
  if [[ ${#refs[@]} -eq 0 ]]; then
    refs+=('+refs/heads/*:refs/remotes/origin/*')
  fi
  git_exec fetch "${flags[@]}" "$url" "${refs[@]}"
}

run_checkout() {
  if [[ $# -eq 1 ]] && is_branch_name "$1"; then
    git_exec checkout "$1"
  elif [[ $# -eq 2 && "$1" == "-b" ]] && is_branch_name "$2"; then
    git_exec checkout -b "$2"
  elif [[ $# -eq 3 && "$1" == "-b" ]] && is_branch_name "$2" && is_rev "$3"; then
    git_exec checkout -b "$2" "$3"
  else
    refuse "checkout allows a branch, or -b <new> [<start>]"
  fi
}

run_switch() {
  if [[ $# -eq 1 ]] && is_branch_name "$1"; then
    git_exec switch "$1"
  elif [[ ($# -eq 2) && ("$1" == "-c" || "$1" == "--create") ]] && is_branch_name "$2"; then
    git_exec switch -c "$2"
  elif [[ ($# -eq 3) && ("$1" == "-c" || "$1" == "--create") ]] && is_branch_name "$2" && is_rev "$3"; then
    git_exec switch -c "$2" "$3"
  else
    refuse "switch allows a branch, or -c <new> [<start>]"
  fi
}

run_cherry_pick() {
  local rev
  if [[ $# -eq 1 && "$1" =~ ^--(abort|continue|quit|skip)$ ]]; then
    git_exec cherry-pick "$1"
  fi
  [[ $# -ge 1 ]] || refuse "cherry-pick needs a commit"
  for rev in "$@"; do
    is_rev "$rev" || refuse "revision not allowed"
  done
  git_exec cherry-pick "$@"
}

main() {
  local cmd
  [[ $# -ge 1 ]] || refuse "need a subcommand"
  assert_guards
  cmd="$1"
  shift
  case "$cmd" in
    fetch) run_fetch "$@" ;;
    checkout) run_checkout "$@" ;;
    switch) run_switch "$@" ;;
    cherry-pick) run_cherry_pick "$@" ;;
    *) refuse "subcommand not allowed" ;;
  esac
}

main "$@"
