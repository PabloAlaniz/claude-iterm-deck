-- Selecciona la tab 6 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+6).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 6 then select tab 6
	end tell
end tell
