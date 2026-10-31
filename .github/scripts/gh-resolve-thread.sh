#!/bin/bash
# Resolve ONE review thread on the pull request that started this run.
#   gh-resolve-thread --list        list unresolved threads on this PR (read only)
#   gh-resolve-thread PRRT_<id>     resolve that one thread
# The workflow copies this file from the default branch to a root-owned path
# before Claude starts. The allowlist names that path, not this working copy.
#
# Raw `gh api graphql` stays forbidden: the Claude app token can merge, mark
# ready, approve, and edit branches through GraphQL. This wrapper sends only
# one fixed query and one fixed mutation, with the thread id as a variable.
#
# A thread is resolved only when all of these hold (checked before the write):
#   - the id looks like PRRT_<base64url>,
#   - GraphQL says the node is a PullRequestReviewThread,
#   - it belongs to the pinned repository and the pinned PR number,
#   - it is still unresolved,
#   - its first comment was written by a login in the pinned author list.
#     This workflow pins only "claude". A person or Codex is refused.
set -euo pipefail

export PATH=/usr/bin:/bin
guard=/opt/claude-guards
export GH_CONFIG_DIR=$guard/empty-gh
export GH_PROMPT_DISABLED=1
export GH_NO_UPDATE_NOTIFIER=1
export GH_PAGER=cat
unset GH_FORCE_TTY GH_REPO GH_HOST GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN \
  GH_DEBUG DEBUG PAGER EDITOR VISUAL GIT_EDITOR BROWSER \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy \
  SSL_CERT_FILE SSL_CERT_DIR \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH

GH_BIN=/usr/bin/gh

refuse() {
  echo "gh-resolve-thread: $*" >&2
  exit 2
}

read_pinned() {
  local file="$guard/$1"
  if [[ ! -f "$file" || -L "$file" || -w "$file" ]]; then
    refuse "$1 must exist and not be writable"
  fi
  tr -d '\r\n' < "$file"
}

if [[ ! -d "$guard" || -w "$guard" ]]; then
  refuse "guard dir must exist and not be writable"
fi
if [[ ! -d "$GH_CONFIG_DIR" || -w "$GH_CONFIG_DIR" ]]; then
  refuse "gh config dir must exist and not be writable"
fi
if [[ ! -x "$GH_BIN" ]]; then
  refuse "$GH_BIN missing"
fi

[[ $# -eq 1 ]] || refuse "usage: gh-resolve-thread --list | PRRT_<id>"
mode=resolve
thread_id="$1"
if [[ "$1" == "--list" ]]; then
  mode=list
elif [[ ! "$thread_id" =~ ^PRRT_[A-Za-z0-9_-]{1,120}$ ]]; then
  refuse "thread id must look like PRRT_<id>"
fi

repo="$(read_pinned repo)"
if [[ ! "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  refuse "pinned repository is not owner/name"
fi
pr_number="$(read_pinned pr-number)"
if [[ ! "$pr_number" =~ ^[1-9][0-9]{0,9}$ ]]; then
  refuse "this run was not started from a pull request"
fi
authors="$(read_pinned resolve-thread-authors)"
if [[ ! "$authors" =~ ^[A-Za-z0-9-]+(,[A-Za-z0-9-]+)*$ ]]; then
  refuse "pinned author list is malformed"
fi

# gh api graphql does not need a work tree. Run outside the checkout so no
# repo config is read.
cd /

if [[ "$mode" == list ]]; then
  read -r -d '' list_query << 'GQL' || true
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved path line
          comments(first: 1) { nodes { author { login } body } }
        }
      }
    }
  }
}
GQL
  # Read only. One line per unresolved thread: id, opener, path:line, and
  # the first 160 characters of the opening comment.
  exec "$GH_BIN" api graphql -f query="$list_query" \
    -f owner="${repo%%/*}" -f name="${repo#*/}" -F number="$pr_number" \
    --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | [.id, (.comments.nodes[0].author.login // "unknown"), "\(.path // ""):\(.line // "")", ((.comments.nodes[0].body // "") | gsub("[\\r\\n\\t]+"; " ") | .[0:160])] | @tsv'
fi

read -r -d '' query << 'GQL' || true
query($id: ID!) {
  node(id: $id) {
    __typename
    ... on PullRequestReviewThread {
      isResolved
      pullRequest { number repository { nameWithOwner } }
      comments(first: 1) { nodes { author { login } } }
    }
  }
}
GQL

read -r -d '' mutation << 'GQL' || true
mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) {
    thread { id isResolved }
  }
}
GQL

# Fixed jq program. One line, "|" separated (no field can contain "|"):
# type, resolved, pr number, repo, author. "|" is not whitespace, so an
# empty field stays in place instead of shifting the others.
# isResolved uses tostring, not `// ""`: jq treats false as missing.
facts="$("$GH_BIN" api graphql -f query="$query" -f id="$thread_id" \
  --jq '[.data.node.__typename // "", (.data.node.isResolved | tostring), (.data.node.pullRequest.number | tostring), .data.node.pullRequest.repository.nameWithOwner // "", .data.node.comments.nodes[0].author.login // ""] | join("|")')" \
  || refuse "could not read the thread"

IFS='|' read -r kind resolved number owner_repo author <<< "$facts"
[[ "$kind" == "PullRequestReviewThread" ]] || refuse "node is not a review thread"
[[ "${owner_repo,,}" == "${repo,,}" ]] || refuse "thread is in another repository"
[[ "$number" == "$pr_number" ]] || refuse "thread is on another pull request"
if [[ "$resolved" == "true" ]]; then
  echo "gh-resolve-thread: already resolved $thread_id"
  exit 0
fi
[[ "$resolved" == "false" ]] || refuse "could not read the thread state"

# GraphQL returns bot logins without the [bot] suffix. Normalise both sides.
author="${author%\[bot\]}"
author="${author,,}"
allowed=0
IFS=',' read -r -a allow_list <<< "${authors,,}"
for a in "${allow_list[@]}"; do
  if [[ "$author" == "$a" ]]; then
    allowed=1
  fi
done
[[ "$allowed" -eq 1 ]] || refuse "thread was opened by ${author:-unknown}, which this wrapper may not resolve"

after="$("$GH_BIN" api graphql -f query="$mutation" -f id="$thread_id" \
  --jq '.data.resolveReviewThread.thread.isResolved | tostring')" \
  || refuse "resolve failed"
[[ "$after" == "true" ]] || refuse "resolve did not take effect"
echo "gh-resolve-thread: resolved $thread_id on $repo#$pr_number (opened by $author)"
