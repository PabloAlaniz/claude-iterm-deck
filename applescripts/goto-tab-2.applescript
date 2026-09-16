-- Selecciona la tab 2 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+2).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 2 then select tab 2
	end tell
end tell
