#!/bin/bash
set -uo pipefail

LAUNCH_AGENT_PATH="${AGENT_STATUSBAR_LAUNCH_AGENT_PATH:-$HOME/Library/LaunchAgents/com.agentstatusbar.monitor.plist}"
PLIST_BUDDY="${AGENT_STATUSBAR_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"

resolve_command() {
  local name="$1" resolved
  resolved=$(command -v "$name" 2>/dev/null || true)
  if [ -n "$resolved" ] && [ -x "$resolved" ]; then
    printf '%s\n' "$resolved"
  fi
}

resolve_launch_agent_node() {
  local node_path
  [ -r "$LAUNCH_AGENT_PATH" ] || return
  [ -x "$PLIST_BUDDY" ] || return
  node_path=$("$PLIST_BUDDY" -c 'Print :ProgramArguments:0' "$LAUNCH_AGENT_PATH" 2>/dev/null || true)
  if [ -x "$node_path" ]; then
    printf '%s\n' "$node_path"
  fi
}

version_is_newer() {
  local candidate="$1" current="$2"
  local candidate_major candidate_minor candidate_patch current_major current_minor current_patch
  [ -z "$current" ] && return 0
  IFS=. read -r candidate_major candidate_minor candidate_patch <<< "$candidate"
  IFS=. read -r current_major current_minor current_patch <<< "$current"
  (( 10#$candidate_major > 10#$current_major \
    || (10#$candidate_major == 10#$current_major && 10#$candidate_minor > 10#$current_minor) \
    || (10#$candidate_major == 10#$current_major && 10#$candidate_minor == 10#$current_minor \
      && 10#$candidate_patch > 10#$current_patch) ))
}

find_best_nvm_node() {
  local requested_major="${1:-}" requested_minor="${2:-}"
  local candidate version major minor patch best_path="" best_version=""
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node; do
    [ -x "$candidate" ] || continue
    version="${candidate#"$HOME/.nvm/versions/node/v"}"
    version="${version%/bin/node}"
    [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || continue
    major=${BASH_REMATCH[1]}
    minor=${BASH_REMATCH[2]}
    patch=${BASH_REMATCH[3]}
    [ -z "$requested_major" ] || [ "$major" = "$requested_major" ] || continue
    [ -z "$requested_minor" ] || [ "$minor" = "$requested_minor" ] || continue
    if version_is_newer "$major.$minor.$patch" "$best_version"; then
      best_version="$major.$minor.$patch"
      best_path="$candidate"
    fi
  done
  [ -n "$best_path" ] && printf '%s\n' "$best_path"
}

resolve_nvm_spec() {
  local spec="$1" depth="${2:-0}" alias_file alias_spec candidate candidate_version
  local best_path="" best_version=""
  [ "$depth" -lt 6 ] || return

  if [[ "$spec" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    candidate="$HOME/.nvm/versions/node/v${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}/bin/node"
    [ -x "$candidate" ] && printf '%s\n' "$candidate"
    return
  fi
  if [[ "$spec" =~ ^v?([0-9]+)\.([0-9]+)$ ]]; then
    find_best_nvm_node "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi
  if [[ "$spec" =~ ^v?([0-9]+)$ ]]; then
    find_best_nvm_node "${BASH_REMATCH[1]}"
    return
  fi

  case "$spec" in
    node|stable)
      find_best_nvm_node
      return
      ;;
    lts/*)
      if [ "$spec" != "lts/*" ]; then
        alias_file="$HOME/.nvm/alias/lts/${spec#lts/}"
        [ -r "$alias_file" ] || return
        IFS= read -r alias_spec < "$alias_file" || true
        resolve_nvm_spec "$alias_spec" $((depth + 1))
        return
      fi
      for alias_file in "$HOME"/.nvm/alias/lts/*; do
        [ -r "$alias_file" ] || continue
        IFS= read -r alias_spec < "$alias_file" || true
        candidate=$(resolve_nvm_spec "$alias_spec" $((depth + 1)))
        [ -n "$candidate" ] || continue
        candidate_version="${candidate#"$HOME/.nvm/versions/node/v"}"
        candidate_version="${candidate_version%/bin/node}"
        if version_is_newer "$candidate_version" "$best_version"; then
          best_version="$candidate_version"
          best_path="$candidate"
        fi
      done
      [ -n "$best_path" ] && printf '%s\n' "$best_path"
      return
      ;;
  esac

  alias_file="$HOME/.nvm/alias/$spec"
  [ -r "$alias_file" ] || return
  IFS= read -r alias_spec < "$alias_file" || true
  resolve_nvm_spec "$alias_spec" $((depth + 1))
}

resolve_nvm_node() {
  local alias_file="$HOME/.nvm/alias/default" default_alias resolved
  if [ -r "$alias_file" ]; then
    IFS= read -r default_alias < "$alias_file" || true
    [ "$default_alias" = "system" ] && return
    resolved=$(resolve_nvm_spec "$default_alias")
    if [ -n "$resolved" ]; then
      printf '%s\n' "$resolved"
      return
    fi
  fi
  find_best_nvm_node
}

resolve_standard_node() {
  local paths candidate previous_ifs
  paths="${AGENT_STATUSBAR_STANDARD_NODE_PATHS-/opt/homebrew/bin/node:/usr/local/bin/node}"
  previous_ifs="$IFS"
  IFS=:
  for candidate in $paths; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      IFS="$previous_ifs"
      return
    fi
  done
  IFS="$previous_ifs"
}

RESOLVED_NODE_PATH=$(resolve_launch_agent_node)
if [ -n "$RESOLVED_NODE_PATH" ]; then
  printf '%s\n' "$RESOLVED_NODE_PATH"
else
  RESOLVED_NODE_PATH=$(resolve_command node)
  if [ -n "$RESOLVED_NODE_PATH" ]; then
    printf '%s\n' "$RESOLVED_NODE_PATH"
  else
    RESOLVED_NODE_PATH=$(resolve_nvm_node)
    if [ -n "$RESOLVED_NODE_PATH" ]; then
      printf '%s\n' "$RESOLVED_NODE_PATH"
    else
      resolve_standard_node
    fi
  fi
fi
