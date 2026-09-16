-- Selecciona la tab 4 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+4).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 4 then select tab 4
	end tell
end tell
