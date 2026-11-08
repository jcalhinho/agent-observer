#!/usr/bin/env bash
# End-to-end test of the real desktop app (Linux): starts the binary under a virtual display, in a
# throwaway HOME, and checks the collector from the outside — hooks, the Claude Code status line,
# Codex subscription limits read from its log, the read-only activity summary, the MCP server, and
# that private text never leaks.
#
#   bash apps/desktop/scripts/e2e.sh target/debug/repowatcher-agent-observer
#
# Needs: Xvfb, curl, node. Port 43821 must be free.
set -uo pipefail

BIN="${1:?usage: e2e.sh <path to the repowatcher-agent-observer binary>}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
[[ -x "$BIN" ]] || { echo "not an executable: $BIN" >&2; exit 2; }
command -v Xvfb >/dev/null || { echo "Xvfb is required" >&2; exit 2; }

T="$(mktemp -d)"
export HOME="$T" XDG_CONFIG_HOME="$T/.config" XDG_DATA_HOME="$T/.local/share" XDG_CACHE_HOME="$T/.cache"
export CODEX_HOME="$T/.codex"
# WebKitGTK cannot use GPU buffers under Xvfb; the collector does not care, the window does.
export WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1

XVFB=""
APP=""
cleanup() {
  [[ -n "$APP" ]] && kill "$APP" 2>/dev/null
  [[ -n "$XVFB" ]] && kill "$XVFB" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$T" 2>/dev/null || true
}
trap cleanup EXIT

# Start a virtual display and wait until it accepts connections: GTK aborts if the app starts first.
# A display number already taken makes Xvfb exit: try another one.
DISPLAY_NUMBER=""
for _ in 1 2 3 4 5; do
  candidate=$(( 90 + RANDOM % 9 ))
  [[ -e "/tmp/.X11-unix/X$candidate" ]] && continue
  Xvfb ":$candidate" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  XVFB=$!
  for _ in $(seq 1 100); do
    [[ -e "/tmp/.X11-unix/X$candidate" ]] && break
    kill -0 "$XVFB" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$XVFB" 2>/dev/null && [[ -e "/tmp/.X11-unix/X$candidate" ]]; then
    DISPLAY_NUMBER="$candidate"
    break
  fi
  kill "$XVFB" 2>/dev/null
  XVFB=""
done
[[ -n "$DISPLAY_NUMBER" ]] || { echo "could not start Xvfb" >&2; exit 1; }

# A Codex session log that already holds subscription limits, written before the app starts.
mkdir -p "$CODEX_HOME/sessions/2026/11/08"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RESET=$(( $(date +%s) + 3600 ))
cat > "$CODEX_HOME/sessions/2026/11/08/rollout-2026-11-08T10-00-00-e2e.jsonl" <<EOF
{"timestamp":"$NOW","type":"session_meta","payload":{"id":"e2e-codex","cwd":"/work/api"}}
{"timestamp":"$NOW","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":86.0,"window_minutes":300,"resets_at":$RESET},"secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":$(( RESET + 86400 ))},"plan_type":"plus"}}}
EOF

DISPLAY=":$DISPLAY_NUMBER" "$BIN" > "$T/app.log" 2>&1 &
APP=$!

for _ in $(seq 1 120); do
  curl -s -o /dev/null http://127.0.0.1:43821/ 2>/dev/null && break
  kill -0 "$APP" 2>/dev/null || { echo "the app exited:"; cat "$T/app.log"; exit 1; }
  sleep 0.5
done
KEYFILE="$XDG_CONFIG_HOME/dev.repowatcher.agentobserver/collector-token"
for _ in $(seq 1 20); do [[ -s "$KEYFILE" ]] && break; sleep 0.25; done
KEY="$(cat "$KEYFILE" 2>/dev/null || true)"

pass=0
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1 (expected [$3], got [$2])"; fail=$((fail + 1)); fi; }
contains() { if [[ "$2" == *"$3"* ]]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1 (missing [$3]) in: ${2:0:400}"; fail=$((fail + 1)); fi; }
absent() { if [[ "$2" != *"$3"* ]]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1 (found [$3])"; fail=$((fail + 1)); fi; }

check "the key file exists" "$([[ -n "$KEY" ]] && echo yes)" "yes"
AUTH="Authorization: Bearer $KEY"
post() { curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "$AUTH" --data "$2" "http://127.0.0.1:43821/$1"; }

check "hook UserPromptSubmit accepted" "$(post claude-hook '{"hook_event_name":"UserPromptSubmit","session_id":"e2e-claude","cwd":"/work/api","prompt":"PRIVATE-PROMPT-XYZ"}')" "204"
check "hook PreToolUse accepted" "$(post claude-hook '{"hook_event_name":"PreToolUse","session_id":"e2e-claude","cwd":"/work/api","tool_name":"Edit","tool_input":{"file_path":"/work/api/src/main.rs"}}')" "204"
check "hook PostToolUse accepted" "$(post claude-hook '{"hook_event_name":"PostToolUse","session_id":"e2e-claude","cwd":"/work/api","tool_name":"Edit","tool_input":{"file_path":"/work/api/src/main.rs"},"tool_response":{"success":true}}')" "204"
check "hook without the key refused" "$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" --data '{}' http://127.0.0.1:43821/claude-hook)" "401"

STATUS_INPUT='{"model":{"display_name":"Opus"},"context_window":{"used_percentage":8},"cwd":"/work/api","rate_limits":{"five_hour":{"used_percentage":23.5,"resets_at":'"$RESET"'},"seven_day":{"used_percentage":41.2,"resets_at":'"$(( RESET + 86400 ))"'}}}'
LINE="$(curl -s -X POST -H "Content-Type: application/json" -H "$AUTH" --data-binary "$STATUS_INPUT" http://127.0.0.1:43821/claude-statusline)"
check "status line text" "$LINE" "Opus · ctx 8% · 5h 24% · 7d 41%"
check "status line without the key refused" "$(curl -s -o /dev/null -w "%{http_code}" -X POST --data-binary "$STATUS_INPUT" http://127.0.0.1:43821/claude-statusline)" "401"

# The Codex reader polls every few seconds: wait for its limits instead of sleeping blindly.
ACT=""
for _ in $(seq 1 40); do
  ACT="$(curl -s -H "$AUTH" "http://127.0.0.1:43821/v1/activity?minutes=30")"
  [[ "$ACT" == *'"provider":"codex"'* && "$ACT" == *'"session_id":"e2e-claude"'* ]] && break
  sleep 0.5
done
contains "activity: Claude Code session" "$ACT" '"session_id":"e2e-claude"'
contains "activity: edited file" "$ACT" '"files_edited":["/work/api/src/main.rs"]'
contains "limits: Claude Code" "$ACT" '"provider":"claude_code"'
contains "limits: Codex, read from its log" "$ACT" '"provider":"codex"'
contains "limits: Codex plan" "$ACT" '"plan":"plus"'
absent "never the prompt text" "$ACT" "PRIVATE-PROMPT-XYZ"
check "activity without the key refused" "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:43821/v1/activity)" "401"
check "activity from a web page refused" "$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" -H "Origin: https://example.com" http://127.0.0.1:43821/v1/activity)" "403"

MCP="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"who_else_is_here","arguments":{"path":"/work/api/src"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"subscription_limits","arguments":{}}}' \
  | { AGENT_OBSERVER_TOKEN_FILE="$KEYFILE" node "$ROOT/tools/mcp/agent-observer-mcp.mjs" <&0 & MCP_PID=$!; sleep 3; kill "$MCP_PID" 2>/dev/null; } 2>&1)"
contains "MCP: who is working here" "$MCP" "claude_code"
contains "MCP: edited file" "$MCP" "files edited: /work/api/src/main.rs"
contains "MCP: Codex limits" "$MCP" "codex (plus)"

echo "---- $pass passed, $fail failed"
if (( fail > 0 )); then
  echo "---- app log"
  cat "$T/app.log"
  exit 1
fi
