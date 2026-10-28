# Shared config check for the Claude git and gh wrappers.
# Sourced from the root-owned copies. Not a command.
#
# `git config -z` writes one record per entry, terminated by NUL.
# The key and the value are separated by the first newline, so a subsection
# such as [merge "evil=x"] stays inside the key. Splitting on "=" drops
# ".driver" and lets the command through.
#
# Include directives are refused and not opened. An include path can block,
# and the included file can change before exec. Refusing the directive means
# that file never becomes effective config.

file_has_nul() {
  local size trimmed
  size=$(wc -c < "$1")
  trimmed=$(tr -d '\0' < "$1" | wc -c)
  [[ "$size" -ne "$trimmed" ]]
}

# Return 0 when this parsed key/value can make git run a program.
config_entry_unsafe() {
  local key="${1,,}" value="$2"
  case "$value" in
    '!'*|*'ext::'*) return 0 ;;
  esac
  case "$key" in
    include.path|includeif.*|alias.*|*.insteadof|*.pushinsteadof|*.helper) return 0 ;;
    *.smudge|*.clean|*.process|*.textconv|*.driver|*.external|*.command|*.cmd) return 0 ;;
    *.sshcommand|*.fsmonitor|*.gitproxy|*.uploadpack|*.receivepack) return 0 ;;
    *.askpass|*.editor|*.program|*.difffilter|*.packobjectshook) return 0 ;;
    imap.tunnel|man.viewer|sendemail.smtpserver|remote.*.proxy|remote.*.vcs) return 0 ;;
    mergetool.*.path|difftool.*.path|browser.*.path|man.*.path) return 0 ;;
    core.pager|pager.*)
      case "$value" in
        true|false|"") return 1 ;;
        *) return 0 ;;
      esac
      ;;
    protocol.ext.allow|protocol.file.allow|protocol.ssh.allow)
      [[ "$value" == "never" || -z "$value" ]] && return 1
      return 0
      ;;
  esac
  # core.hooksPath is not listed. The wrappers override it on the command
  # line, and checkout must still work when the repo sets it.
  return 1
}

config_file_unsafe() {
  local file="$1" out record key value
  local bin="${GIT_BIN:-/usr/bin/git}"
  [[ -L "$file" || ! -f "$file" ]] && return 0
  if file_has_nul "$file"; then
    return 0
  fi
  out="$(mktemp)"
  if ! "$bin" config --file "$file" --list -z --no-includes >"$out" 2>/dev/null; then
    rm -f "$out"
    return 0
  fi
  while IFS= read -r -d '' record || [[ -n "$record" ]]; do
    if [[ "$record" != *$'\n'* ]]; then
      rm -f "$out"
      return 0
    fi
    key="${record%%$'\n'*}"
    value="${record#*$'\n'}"
    if config_entry_unsafe "$key" "$value"; then
      rm -f "$out"
      return 0
    fi
  done <"$out"
  rm -f "$out"
  return 1
}

# Text after a quoted pattern. Git attributes quote only the pattern.
attributes_after_quoted_pattern() {
  local s="$1" i=1 n=${#s} c esc=0
  while (( i < n )); do
    c="${s:i:1}"
    if (( esc )); then
      esc=0
    elif [[ "$c" == '\' ]]; then
      esc=1
    elif [[ "$c" == '"' ]]; then
      printf '%s' "${s:$((i + 1))}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

# filter=<name> always runs a clean/smudge/process command when one is set,
# including a name that itself contains "=". diff=<driver> names an external
# diff. merge=<driver> names a merge command except the built-ins and
# timestamp-ours, which this repo's .gitattributes uses and which does not
# run a program unless merge.timestamp-ours.driver is set (refused above).
attribute_token_unsafe() {
  local token="$1" name value
  [[ "$token" == -* || "$token" == '!'* ]] && return 1
  if [[ "$token" == *=* ]]; then
    name="${token%%=*}"
    value="${token#*=}"
  else
    return 1
  fi
  case "$name" in
    filter|diff) return 0 ;;
    merge)
      case "$value" in
        text|binary|union|timestamp-ours) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
}

attributes_line_unsafe() {
  local line="$1" rest token
  line="${line%$'\r'}"
  [[ ${#line} -ge 2048 ]] && return 1
  rest="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$rest" || "$rest" == \#* || "$rest" == '!'* ]] && return 1
  if [[ "$rest" == \"* ]]; then
    rest="$(attributes_after_quoted_pattern "$rest")" || return 0
  elif [[ "$rest" != *[[:space:]]* ]]; then
    return 1
  else
    rest="${rest#*[[:space:]]}"
  fi
  rest="${rest#"${rest%%[![:space:]]*}"}"
  while [[ -n "$rest" ]]; do
    if [[ "$rest" != *[[:space:]]* ]]; then
      token="$rest"
      rest=""
    else
      token="${rest%%[[:space:]]*}"
      rest="${rest#*[[:space:]]}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
    fi
    if attribute_token_unsafe "$token"; then
      return 0
    fi
  done
  return 1
}

attributes_file_unsafe() {
  local file="$1" line first=1 size
  [[ -L "$file" || ! -f "$file" ]] && return 0
  size=$(wc -c < "$file")
  [[ "$size" -ge 104857600 ]] && return 0
  if file_has_nul "$file"; then
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$first" -eq 1 ]]; then
      first=0
      line="${line#$'\xEF\xBB\xBF'}"
    fi
    if attributes_line_unsafe "$line"; then
      return 0
    fi
  done <"$file"
  return 1
}

worktree_attributes_unsafe() {
  local path info=".git/info/attributes"
  if [[ -L "$info" || -d "$info" ]]; then
    return 0
  fi
  if [[ -e "$info" ]] && attributes_file_unsafe "$info"; then
    return 0
  fi
  while IFS= read -r -d '' path; do
    if [[ -L "$path" || ! -f "$path" ]]; then
      return 0
    fi
    if attributes_file_unsafe "$path"; then
      return 0
    fi
  done < <(find . -path './.git' -prune -o -name .gitattributes -print0)
  return 1
}

index_attributes_unsafe() {
  local out entry mode rest oid path blob
  local bin="${GIT_BIN:-/usr/bin/git}"
  out="$(mktemp)"
  if ! "$bin" ls-files -s -z >"$out" 2>/dev/null; then
    rm -f "$out"
    return 0
  fi
  while IFS= read -r -d '' entry || [[ -n "$entry" ]]; do
    [[ -z "$entry" ]] && continue
    mode="${entry%% *}"
    rest="${entry#* }"
    oid="${rest%% *}"
    rest="${rest#* }"
    path="${rest#*$'\t'}"
    case "$path" in
      .gitattributes|*/.gitattributes) ;;
      *) continue ;;
    esac
    if [[ "$mode" == 120000 ]]; then
      rm -f "$out"
      return 0
    fi
    [[ "$mode" == 160000 ]] && continue
    blob="$(mktemp)"
    if ! "$bin" cat-file blob "$oid" >"$blob" 2>/dev/null; then
      rm -f "$out" "$blob"
      return 0
    fi
    if attributes_file_unsafe "$blob"; then
      rm -f "$out" "$blob"
      return 0
    fi
    rm -f "$blob"
  done <"$out"
  rm -f "$out"
  return 1
}

# Return 0 when this work tree's effective config or attributes can run a command.
# Pass the work tree root. Defaults to the current directory, which must be
# the root: git-limited refuses any other shape.
repo_git_unsafe() {
  local root="${1:-.}"
  local cfg="$root/.git/config" wt="$root/.git/config.worktree"
  if [[ -L "$root/.git" || ! -d "$root/.git" || -L "$cfg" || ! -f "$cfg" ]]; then
    return 0
  fi
  if [[ -L "$wt" ]]; then
    return 0
  fi
  if config_file_unsafe "$cfg"; then
    return 0
  fi
  if [[ -e "$wt" ]]; then
    if [[ -L "$wt" || ! -f "$wt" ]] || config_file_unsafe "$wt"; then
      return 0
    fi
  fi
  if (
    cd "$root" || exit 0
    if worktree_attributes_unsafe; then
      exit 0
    fi
    if index_attributes_unsafe; then
      exit 0
    fi
    exit 1
  ); then
    return 0
  fi
  return 1
}

# Walk up to the work tree that contains this directory. Print nothing and
# return 1 when none exists, so gh outside a repo is unchanged.
repo_root_of_cwd() {
  local dir="$PWD"
  while true; do
    if [[ -e "$dir/.git" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    [[ "$dir" == "/" ]] && return 1
    dir="${dir%/*}"
    [[ -n "$dir" ]] || dir=/
  done
}
