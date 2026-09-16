#!/bin/bash
# Registra (idempotente) el hook claude-deck-status en ~/.claude/settings.json,
# como entrada adicional en cada evento, sin tocar los hooks existentes
# (p. ej. cc-status de iTerm2). Hace backup antes de escribir.
set -euo pipefail

SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/claude-deck-status"
EVENTS=(SessionStart UserPromptSubmit PreToolUse PostToolUse PostToolBatch PostToolUseFailure PermissionRequest PermissionDenied Elicitation ElicitationResult Notification SubagentStart SubagentStop TaskCreated TaskCompleted Stop StopFailure SessionEnd)

command -v jq >/dev/null || { echo "Falta jq (brew install jq)"; exit 1; }
[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"

if [[ "${1:-}" == "--uninstall" ]]; then
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  jq --arg hook "$HOOK" '
    .hooks |= with_entries(
      .value |= map(select((.hooks // []) | any(.command == $hook) | not))
    ) | .hooks |= with_entries(select(.value | length > 0))
  ' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
  echo "Hook eliminado de $SETTINGS"
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
jq --arg hook "$HOOK" --argjson events "$(printf '%s\n' "${EVENTS[@]}" | jq -R . | jq -s .)" '
  .hooks //= {} |
  reduce $events[] as $ev (.;
    if ((.hooks[$ev] // []) | any((.hooks // []) | any(.command == $hook)))
    then .
    else .hooks[$ev] = ((.hooks[$ev] // []) + [{hooks: [{type: "command", command: $hook, timeout: 5}]}])
    end
  )
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
echo "Hook registrado en $SETTINGS para: ${EVENTS[*]}"
echo "Reiniciá las sesiones de Claude Code para que tomen el hook."
