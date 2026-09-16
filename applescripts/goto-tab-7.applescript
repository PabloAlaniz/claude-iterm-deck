-- Selecciona la tab 7 de la ventana actual de iTerm2 y trae iTerm2 al frente (equivale a Cmd+7).
tell application "iTerm2"
	activate
	tell current window
		if (count of tabs) ≥ 7 then select tab 7
	end tell
end tell
