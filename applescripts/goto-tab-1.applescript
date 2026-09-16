-- Selecciona la tab 1 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+1).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 1 then select tab 1
	end tell
end tell
