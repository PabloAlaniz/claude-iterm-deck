-- Envía "1" (sin Enter) a la sesión activa de iTerm2: responde la opción 1 del prompt de Claude Code.
tell application "iTerm2"
	tell current session of current window to write text "1" newline NO
end tell
