#!/usr/bin/env bash
#
# link-env-local.sh
#
# Why:
#   When working with git worktrees, each worktree is a separate checkout and
#   therefore gets its own (usually stale) copy of `.env.local`. Keeping one
#   copy per worktree in sync is error-prone. This script makes the worktree's
#   `.env.local` a symlink to the MAIN repository's `.env.local`, so there is
#   only a single copy to keep fresh.
#
# Usage:
#   bash scripts/link-env-local.sh [--replace]
#
#   --replace   If the worktree already has a regular `.env.local` file, back
#               it up (never delete it) and replace it with the symlink.
#
# Notes:
#   - This script never prints the contents of any env file; only paths and
#     status words.
#   - Exit codes:
#       0  success / nothing to do
#       1  main `.env.local` missing (or other fatal error)
#       3  a local copy exists and --replace was not given
#
set -euo pipefail

replace=0
for arg in "$@"; do
    case "$arg" in
        --replace)
            replace=1
            ;;
        -h|--help)
            sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "error: unknown argument: $arg" >&2
            echo "usage: bash scripts/link-env-local.sh [--replace]" >&2
            exit 1
            ;;
    esac
done

# Resolve the main repository root and the current worktree root.
common=$(cd "$(git rev-parse --git-common-dir)" && pwd)
main_root=$(dirname "$common")
worktree_root=$(git rev-parse --show-toplevel)

# Normalise both paths so the equality check is reliable.
main_root=$(cd "$main_root" && pwd)
worktree_root=$(cd "$worktree_root" && pwd)

if [ "$main_root" = "$worktree_root" ]; then
    echo "already the main checkout; nothing to do"
    exit 0
fi

main_env="$main_root/.env.local"
target="$worktree_root/.env.local"

if [ ! -e "$main_env" ]; then
    echo "error: main .env.local not found at: $main_env" >&2
    exit 1
fi

# Case 1: target is already a symlink.
if [ -L "$target" ]; then
    current=$(readlink "$target")
    # Resolve relative symlink targets for comparison.
    case "$current" in
        /*) current_abs="$current" ;;
        *)  current_abs="$(dirname "$target")/$current" ;;
    esac
    if [ "$current_abs" = "$main_env" ]; then
        echo "already linked"
        exit 0
    fi
    ln -sfn "$main_env" "$target"
    echo "re-pointed symlink: $target -> $main_env"
    exit 0
fi

# Case 2: target is a regular file (or other non-symlink entry).
if [ -e "$target" ]; then
    if [ "$replace" -ne 1 ]; then
        echo "a local copy exists at: $target"
        echo "re-run with --replace to back it up and link to the main copy"
        exit 3
    fi
    stamp=$(date +%Y%m%d-%H%M%S)
    backup="$target.worktree-bak-$stamp"
    mv "$target" "$backup"
    echo "backed up local copy: $backup"
    ln -sfn "$main_env" "$target"
    echo "linked: $target -> $main_env"
    exit 0
fi

# Case 3: target does not exist.
ln -sfn "$main_env" "$target"
echo "linked: $target -> $main_env"
exit 0
