#!/bin/bash
# Simula estados en el deck escribiendo archivos de estado falsos para las sesiones de
# Claude Code abiertas en iTerm2 (para ver todos los estados sin provocar prompts reales).
#   scripts/simulate.sh demo     # cada sesión recibe un estado distinto (working/waiting×3 kinds/idle/error/listo)
#   scripts/simulate.sh waiting  # todas en waiting/permission (o working|idle|error|plan|question)
#   scripts/simulate.sh clear    # borra los archivos: el próximo hook real restaura el estado
set -euo pipefail
IT2=/Applications/iTerm.app/Contents/Resources/utilities/it2
DIR="${CLAUDE_DECK_STATE_DIR:-$HOME/.local/state/claude-deck/sessions}"
mode="${1:-demo}"
mkdir -p "$DIR"

if [[ "$mode" == "clear" ]]; then rm -f "$DIR"/*.json; echo "estado simulado borrado"; exit 0; fi

# sesiones de iTerm con un proceso claude en su tty
ttys="$(ps -axo tty=,comm= | awk '$2 ~ /(^|\/)claude$/ || $2 ~ /\/claude\/versions\// {print $1}')"
i=0
"$IT2" session list --json | jq -r '.[] | "\(.id)\t\(.tty | gsub("\\\\/"; "/") | split("/") | last)"' | while IFS=$'\t' read -r id tty; do
  grep -qx "$tty" <<<"$ttys" || continue
  case "$mode" in
    demo) states=(working permission plan question idle error done); s="${states[$((i % ${#states[@]}))]}" ;;
    *) s="$mode" ;;
  esac
  i=$((i + 1))
  status=working; kind=""; detail=""; event=PreToolUse; suggestion=""; err=""
  case "$s" in
    working) kind=tool; detail='$ npm run build' ;;
    waiting|permission) status=waiting; kind=permission; detail='$ npm test --watch'; event=PermissionRequest; suggestion='Bash(npm test:*)' ;;
    plan) status=waiting; kind=plan; detail="Aprobar plan"; event=PreToolUse ;;
    question) status=waiting; kind=question; detail="¿Qué base de datos usamos?"; event=PreToolUse ;;
    idle) status=idle; event=UserPromptSubmit ;;
    done) status=idle; event=Stop ;;
    error) status=error; detail="API overloaded"; err="API overloaded"; event=StopFailure ;;
  esac
  jq -nc --arg id "$id" --arg status "$status" --arg kind "$kind" --arg detail "$detail" --arg event "$event" \
    --arg suggestion "$suggestion" --arg err "$err" --argjson agents "$((i % 3))" \
    '{iterm_session_id:$id, status:$status, kind:$kind, detail:$detail, event:$event, cwd:"/tmp/demo", project:"demo",
      claude_session_id:"sim", transcript_path:"", permission_mode:(["default","plan","acceptEdits"][($agents)]), model:"claude-opus-5",
      suggestion:$suggestion, error:$err, agents:$agents, ts:(now|floor)}' > "$DIR/$id.json"
  echo "$id → $s"
done
echo "listo: scripts/simulate.sh clear para volver al estado real"
