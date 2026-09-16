-- Selecciona la tab 5 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+5).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 5 then select tab 5
	end tell
end tell
