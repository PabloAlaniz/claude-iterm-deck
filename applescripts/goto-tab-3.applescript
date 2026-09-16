-- Selecciona la tab 3 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+3).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 3 then select tab 3
	end tell
end tell
