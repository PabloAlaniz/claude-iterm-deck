-- Selecciona la tab anterior de la ventana actual de iTerm2 (con wrap). No requiere permisos de Accesibilidad.
tell application "iTerm2"
	tell current window
		set n to count of tabs
		if n < 2 then return
		set cur to 0
		repeat with i from 1 to n
			if tab i is current tab then set cur to i
		end repeat
		set target to ((cur - 1 + (-1) + n) mod n) + 1
		select tab target
	end tell
end tell
