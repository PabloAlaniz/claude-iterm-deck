-- Selecciona la tab 8 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+8).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 8 then select tab 8
	end tell
end tell
