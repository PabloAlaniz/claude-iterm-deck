#!/bin/bash
# Tests del hook: cada fixture es un JSON de evento; se comprueba el estado resultante.
set -euo pipefail
cd "$(dirname "$0")/.."
HOOK=./hooks/claude-deck-status
DIR="$(mktemp -d)"
export CLAUDE_DECK_STATE_DIR="$DIR" ITERM_SESSION_ID="w0t0p0:ABCDEF01-0000-4000-8000-000000000001"
FILE="$DIR/ABCDEF01-0000-4000-8000-000000000001.json"
fail=0

run() { printf '%s' "$1" | "$HOOK"; }
expect() { # expect <jq-expr> <esperado> <descripción>
  local got; got="$(jq -r "$1" "$FILE" 2>/dev/null || echo "(sin archivo)")"
  if [[ "$got" == "$2" ]]; then echo "  ok   $3"; else echo "  FAIL $3: esperado '$2', obtenido '$got'"; fail=1; fi
}

echo "hook: claude-deck-status"
run '{"hook_event_name":"SessionStart","session_id":"s1","cwd":"/x/proj","transcript_path":"/t.jsonl","permission_mode":"plan","model":"claude-opus-5"}'
expect .status idle "SessionStart → idle"
expect .permission_mode plan "guarda permission_mode"
expect .model claude-opus-5 "guarda model"
expect .transcript_path /t.jsonl "guarda transcript_path"

run '{"hook_event_name":"UserPromptSubmit","cwd":"/x/proj"}'
expect .status working "UserPromptSubmit → working"
expect .model claude-opus-5 "conserva model del evento anterior"

run '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm   test\n--watch"},"cwd":"/x/proj"}'
expect .kind tool "PreToolUse → kind tool"
expect .detail '$ npm test --watch' "resumen de Bash colapsa espacios"

run '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/a/b/foo.ts"},"cwd":"/x/proj"}'
expect .detail foo.ts "resumen de Edit = basename"

run '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"npm test"},"permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test:*"}],"behavior":"allow","destination":"session"}],"cwd":"/x/proj"}'
expect .status waiting "PermissionRequest → waiting"
expect .kind permission "kind permission"
expect .suggestion 'Bash(npm test:*)' "suggestion desde permission_suggestions"

run '{"hook_event_name":"SubagentStart","cwd":"/x/proj"}'; run '{"hook_event_name":"TaskCreated","cwd":"/x/proj"}'
expect .agents 2 "SubagentStart/TaskCreated suman agentes"
expect .status waiting "no cambian el status"
run '{"hook_event_name":"SubagentStop","cwd":"/x/proj"}'
expect .agents 1 "SubagentStop resta"

run '{"hook_event_name":"Notification","notification_type":"auth_success","cwd":"/x/proj"}'
expect .status waiting "Notification irrelevante no toca el estado"
run '{"hook_event_name":"Notification","notification_type":"idle_prompt","cwd":"/x/proj"}'
expect .status idle "idle_prompt → idle"

run '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"¿Qué DB?"}]},"cwd":"/x/proj"}'
expect .kind question "AskUserQuestion → question"
expect .detail '¿Qué DB?' "detalle = pregunta"
run '{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{},"cwd":"/x/proj"}'
expect .kind plan "ExitPlanMode → plan"

run '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"ls"},"error":"exit 1","cwd":"/x/proj"}'
expect .status working "PostToolUseFailure → working"
expect .error 'exit 1' "guarda error"
run '{"hook_event_name":"StopFailure","error":"API overloaded","cwd":"/x/proj"}'
expect .status error "StopFailure → error"
run '{"hook_event_name":"Stop","cwd":"/x/proj"}'
expect .status idle "Stop → idle"
expect .agents 0 "Stop resetea agentes"
expect .event Stop "guarda el evento"

run '{"hook_event_name":"SessionEnd"}'
[[ -f "$FILE" ]] && { echo "  FAIL SessionEnd debía borrar el archivo"; fail=1; } || echo "  ok   SessionEnd borra el archivo"

ITERM_SESSION_ID="" run '{"hook_event_name":"Stop"}'
[[ -f "$FILE" ]] && { echo "  FAIL sin ITERM_SESSION_ID no debe escribir"; fail=1; } || echo "  ok   sin ITERM_SESSION_ID no escribe"

rm -rf "$DIR"
exit $fail
