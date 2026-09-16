-- Envía Enter a la sesión activa de iTerm2.
tell application "iTerm2"
	tell current session of current window to write text "" newline YES
end tell
