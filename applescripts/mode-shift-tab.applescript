-- Envía Shift+Tab (CSI Z) a la sesión activa de iTerm2: cicla el modo de permisos de Claude Code.
tell application "iTerm2"
	tell current session of current window to write text ((character id 27) & "[Z") newline NO
end tell
