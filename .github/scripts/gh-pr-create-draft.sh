#!/bin/bash
# Draft-only pull request create.
# The workflow copies this file from the default branch to a root-owned path
# before Claude starts. The allowlist names that path, not this working copy.
set -euo pipefail

export PATH=/usr/bin:/bin
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

refuse() {
  echo "gh-pr-create-draft: $*" >&2
  exit 2
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

validate_args "$@"
# --draft is before caller args. A dangling value flag cannot consume it,
# and validate_args already refused that shape.
exec /usr/bin/gh pr create --draft "$@"
