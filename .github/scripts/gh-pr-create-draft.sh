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

for arg in "$@"; do
  case "$arg" in
    --|--draft|--draft=*|--draf|--draf=*|--dra|--dra=*|--ready|--ready=*|--web|--web=*|--editor|--editor=*|--recover|--recover=*)
      echo "gh-pr-create-draft: refusing override flag" >&2
      exit 2
      ;;
  esac
  # -d / -e / -w are draft, editor, and web. A cluster such as -fd=false
  # still sets draft to false, so reject any short flag that includes them.
  if [[ "$arg" == -* && "$arg" != --* ]]; then
    shorts="${arg#-}"
    shorts="${shorts%%=*}"
    if [[ "$shorts" == *d* || "$shorts" == *e* || "$shorts" == *w* ]]; then
      echo "gh-pr-create-draft: refusing short override flag" >&2
      exit 2
    fi
  fi
done

exec /usr/bin/gh pr create "$@" --draft
