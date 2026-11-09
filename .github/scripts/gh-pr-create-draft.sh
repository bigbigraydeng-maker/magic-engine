#!/bin/bash
# Draft-only pull request create.
# The workflow copies this file from the default branch to a root-owned path
# before Claude starts. The allowlist names that path, not this working copy.
set -euo pipefail

export PATH=/usr/bin:/bin
GIT_BIN=/usr/bin/git
# shellcheck disable=SC1091
source /opt/claude-guards/git-command-config.sh
export GH_CONFIG_DIR=/opt/claude-guards/empty-gh
export GH_PROMPT_DISABLED=1
export GH_NO_UPDATE_NOTIFIER=1
unset GH_FORCE_TTY GH_REPO GH_HOST GH_ENTERPRISE_TOKEN \
  EDITOR VISUAL GIT_EDITOR BROWSER \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH

if [[ ! -d "$GH_CONFIG_DIR" || -w "$GH_CONFIG_DIR" ]]; then
  echo "gh-pr-create-draft: config dir must exist and not be writable" >&2
  exit 2
fi
if [[ ! -x /usr/bin/gh ]]; then
  echo "gh-pr-create-draft: /usr/bin/gh missing" >&2
  exit 127
fi
if [[ ! -f /opt/claude-guards/git-command-config.sh || -w /opt/claude-guards/git-command-config.sh ]]; then
  echo "gh-pr-create-draft: config checker must exist and not be writable" >&2
  exit 2
fi

refuse() {
  echo "gh-pr-create-draft: $*" >&2
  exit 2
}

# gh runs git status and other git reads. Those child processes do not get
# our -c flags, so pin the fixed command keys here. Caller-supplied git
# config in the environment is cleared first.
isolate_git_env() {
  unset GIT_SSH_COMMAND GIT_EXEC_PATH GIT_DIR GIT_WORK_TREE GIT_NAMESPACE \
    GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_CONFIG_SYSTEM \
    GIT_ALLOW_PROTOCOL GIT_PROTOCOL_FROM_USER \
    GIT_EXTERNAL_DIFF GIT_EDITOR GIT_SEQUENCE_EDITOR \
    GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_INDEX_FILE
  local name
  while IFS= read -r name; do
    case "$name" in
      GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*) unset "$name" ;;
    esac
  done < <(compgen -e)
  export GIT_CONFIG_NOSYSTEM=1
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_ATTR_NOSYSTEM=1
  # Fixed keys only. Filter and merge drivers are open-ended, so those are
  # refused by repo_git_unsafe before gh starts, not overridden here.
  local -a keys=(
    core.fsmonitor core.hooksPath core.sshCommand
    protocol.ext.allow protocol.file.allow protocol.ssh.allow
    credential.helper diff.external core.attributesFile
    core.pager core.editor sequence.editor core.askPass gpg.program
    submodule.recurse fetch.recurseSubmodules status.submoduleSummary
    core.gitProxy alias.status alias.diff alias.rev-parse
    commit.gpgsign tag.gpgsign
  )
  local -a vals=(
    false /dev/null /usr/bin/ssh
    never never never
    "" "" /dev/null
    cat true true /usr/bin/true /usr/bin/true
    false false false
    "" "" "" ""
    false false
  )
  local i
  export GIT_CONFIG_COUNT=${#keys[@]}
  for i in "${!keys[@]}"; do
    export "GIT_CONFIG_KEY_${i}=${keys[$i]}"
    export "GIT_CONFIG_VALUE_${i}=${vals[$i]}"
  done
}

# Bool flags. Draft itself is not here: the wrapper adds it, and a caller
# must not be able to set it again.
is_bool_flag() {
  case "$1" in
    --fill|--fill-first|--fill-verbose|--no-maintainer-edit|--dry-run) return 0 ;;
    *) return 1 ;;
  esac
}

# Flags that take the next argument, or an inline --flag=value.
is_value_flag() {
  case "$1" in
    --assignee|--attach|--base|--body|--body-file|--head|--label|--milestone|--project|--reviewer|--template|--title|--repo) return 0 ;;
    *) return 1 ;;
  esac
}

# Reject anything that can turn draft off, open an editor, or end flag parsing.
# Checked on every argument, including values, so a missing-value parse cannot
# disagree with gh about which token is a flag.
reject_dangerous() {
  case "$1" in
    --|--draft|--draft=*|--draf|--draf=*|--dra|--dra=*|--no-draft|--no-draft=*|--ready|--ready=*|--web|--web=*|--editor|--editor=*|--recover|--recover=*)
      refuse "refusing override flag"
      ;;
  esac
  if [[ "$1" == -* && "$1" != --* ]]; then
    refuse "refusing short flag"
  fi
}

# Every caller argument is classified. Unknown flags and a value flag with no
# value are refused, so gh is never started in a state where a dangling flag
# could swallow the draft marker.
validate_args() {
  local -a args=("$@")
  local i=0 arg name
  while [[ "$i" -lt ${#args[@]} ]]; do
    arg="${args[$i]}"
    reject_dangerous "$arg"
    if [[ "$arg" == --*=* ]]; then
      name="${arg%%=*}"
      if is_bool_flag "$name" || is_value_flag "$name"; then
        i=$((i + 1))
        continue
      fi
      refuse "refusing unknown flag"
    fi
    if is_bool_flag "$arg"; then
      i=$((i + 1))
      continue
    fi
    if is_value_flag "$arg"; then
      if [[ $((i + 1)) -ge ${#args[@]} ]]; then
        refuse "flag needs a value: $arg"
      fi
      reject_dangerous "${args[$((i + 1))]}"
      i=$((i + 2))
      continue
    fi
    refuse "refusing unknown argument"
  done
}

isolate_git_env
validate_args "$@"
# gh runs git status in the work tree, including from a subdirectory.
# That child reads local, worktree, and included config, and it runs
# clean filters named by .gitattributes. Refuse before starting gh.
repo_root=""
if repo_root="$(repo_root_of_cwd)"; then
  if repo_git_unsafe "$repo_root"; then
    refuse "refusing unsafe git config"
  fi
fi
# --draft is before caller args. A dangling value flag cannot consume it,
# and validate_args already refused that shape.
exec /usr/bin/gh pr create --draft "$@"
