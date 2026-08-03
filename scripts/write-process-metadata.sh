#!/bin/bash
set -uo pipefail

SNAPSHOT_FILE="${1:-/tmp/agent-statusbar-processes}"
OUTPUT_FILE="${2:-/tmp/agent-statusbar-process-metadata}"
STATE_FILE="${3:-/tmp/agent-statusbar-process-metadata-state}"
RETRY_FILE="${4:-/tmp/agent-statusbar-process-metadata-retry}"
TRACKED_ROOTS_FILE="${5:-/tmp/agent-statusbar-process-roots}"
TEMP_FILE="${OUTPUT_FILE}.$$"
TEMP_STATE="${STATE_FILE}.$$"
ROOTS_FILE="${OUTPUT_FILE}.$$.roots"
PROBE_FILE="${OUTPUT_FILE}.$$.probe"
PROBE_OUTPUT="${OUTPUT_FILE}.$$.lsof"
LSOF_CMD="${AGENT_STATUSBAR_LSOF_CMD:-/usr/sbin/lsof}"
NOW="${AGENT_STATUSBAR_NOW:-$(date +%s)}"
STABLE_REFRESH_SEC="${AGENT_STATUSBAR_METADATA_REFRESH_SEC:-30}"
NEEDS_RETRY=0

cleanup() {
  /bin/rm -f "$TEMP_FILE" "$TEMP_STATE" "$ROOTS_FILE" "$PROBE_FILE" "$PROBE_OUTPUT"
}
trap cleanup EXIT

: > "$TEMP_FILE"
: > "$TEMP_STATE"
: > "$PROBE_FILE"
printf 'roots\t%s\n' "$(stat -f '%i' "$TRACKED_ROOTS_FILE" 2>/dev/null || echo 0)" > "$TEMP_STATE"

/usr/bin/awk '
  {
    executable = $5
    sub(/^.*\//, "", executable)
    if (executable == "codex" || executable == "opencode") {
      print $1 "\t" executable
    }
  }
' "$SNAPSHOT_FILE" > "$ROOTS_FILE" 2>/dev/null || true

cache_is_valid() {
  local pid="$1" name="$2" cwd file
  cwd=$(/usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid && $2 == "cwd" { print $3; exit }' "$OUTPUT_FILE" 2>/dev/null)
  [ -n "$cwd" ] && [ -d "$cwd" ] || return 1
  [ "$name" = "opencode" ] && return 0
  while IFS= read -r file; do
    [ -f "$file" ] && return 0
  done < <(/usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid && $2 == "file" { print $3 }' "$OUTPUT_FILE" 2>/dev/null)
  return 1
}

copy_cached_metadata() {
  local pid="$1"
  /usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid' "$OUTPUT_FILE" 2>/dev/null >> "$TEMP_FILE"
}

while IFS=$'\t' read -r pid name; do
  [ -n "${pid:-}" ] || continue
  last_probe=$(/usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid { print $2; exit }' "$STATE_FILE" 2>/dev/null)
  last_probe="${last_probe:-0}"
  if cache_is_valid "$pid" "$name" && [ $((NOW - last_probe)) -lt "$STABLE_REFRESH_SEC" ]; then
    copy_cached_metadata "$pid"
    printf '%s\t%s\n' "$pid" "$last_probe" >> "$TEMP_STATE"
  else
    printf '%s\t%s\n' "$pid" "$name" >> "$PROBE_FILE"
  fi
done < "$ROOTS_FILE"

PID_LIST=$(/usr/bin/awk -F '\t' 'BEGIN { sep = "" } { printf "%s%s", sep, $1; sep = "," } END { if (NR) print "" }' "$PROBE_FILE")
if [ -n "$PID_LIST" ]; then
  "$LSOF_CMD" -Fn -p "$PID_LIST" 2>/dev/null \
    | /usr/bin/awk '
        /^p[0-9]+$/ { pid = substr($0, 2); want_cwd = 0; next }
        $0 == "fcwd" { want_cwd = 1; next }
        want_cwd && /^n/ {
          print pid "\tcwd\t" substr($0, 2)
          want_cwd = 0
          next
        }
        /^n/ {
          file = substr($0, 2)
          if ((file ~ /\/\.codex\/sessions\// && file ~ /\.jsonl$/) ||
              (file ~ /\/opencode\// && file ~ /\/storage\//)) {
            print pid "\tfile\t" file
          }
        }
      ' > "$PROBE_OUTPUT" || true

  while IFS=$'\t' read -r pid name; do
    [ -n "${pid:-}" ] || continue
    new_cwd=$(/usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid && $2 == "cwd" { print $3; exit }' "$PROBE_OUTPUT")
    new_file=$(/usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid && $2 == "file" { print $3; exit }' "$PROBE_OUTPUT")
    new_valid=false
    if [ -n "$new_cwd" ] && [ -d "$new_cwd" ]; then
      if [ "$name" = "opencode" ] || { [ -n "$new_file" ] && [ -f "$new_file" ]; }; then
        new_valid=true
      fi
    fi

    if [ "$new_valid" = true ]; then
      /usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid' "$PROBE_OUTPUT" >> "$TEMP_FILE"
      printf '%s\t%s\n' "$pid" "$NOW" >> "$TEMP_STATE"
    elif cache_is_valid "$pid" "$name"; then
      # Keep the last known-good mapping after a transient lsof failure, but
      # record the attempt so stable PIDs do not spin on lsof every 2 seconds.
      copy_cached_metadata "$pid"
      printf '%s\t%s\n' "$pid" "$NOW" >> "$TEMP_STATE"
    else
      /usr/bin/awk -F '\t' -v pid="$pid" '$1 == pid' "$PROBE_OUTPUT" >> "$TEMP_FILE"
      NEEDS_RETRY=1
    fi
  done < "$PROBE_FILE"
fi

/bin/mv -f "$TEMP_FILE" "$OUTPUT_FILE"
/bin/mv -f "$TEMP_STATE" "$STATE_FILE"
if [ "$NEEDS_RETRY" -eq 1 ]; then
  printf '%s\n' "$NOW" > "$RETRY_FILE"
else
  /bin/rm -f "$RETRY_FILE"
fi
trap - EXIT
cleanup
