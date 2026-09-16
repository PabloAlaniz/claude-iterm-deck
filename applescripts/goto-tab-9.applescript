-- Selecciona la tab 9 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+9).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 9 then select tab 9
	end tell
end tell
