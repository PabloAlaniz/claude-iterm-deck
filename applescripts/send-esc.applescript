-- Envía Escape a la sesión activa de iTerm2 (interrumpe a Claude Code).
tell application "iTerm2"
	tell current session of current window to write text (character id 27) newline NO
end tell
