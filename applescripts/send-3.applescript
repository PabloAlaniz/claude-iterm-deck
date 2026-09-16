-- Envía "3" (sin Enter) a la sesión activa de iTerm2: responde la opción 3 del prompt de Claude Code.
tell application "iTerm2"
	tell current session of current window to write text "3" newline NO
end tell
