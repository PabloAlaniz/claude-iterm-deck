-- Envía "2" (sin Enter) a la sesión activa de iTerm2: responde la opción 2 del prompt de Claude Code.
tell application "iTerm2"
	tell current session of current window to write text "2" newline NO
end tell
