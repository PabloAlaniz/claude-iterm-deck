# Claude iTerm Deck — notas para Claude Code

Plugin de Stream Deck (SDK Elgato v2, TypeScript) para controlar sesiones de Claude Code en iTerm2.

## Estructura
- `hooks/claude-deck-status`: hook bash (una sola llamada a `jq`) → `~/.local/state/claude-deck/sessions/<UUID>.json`.
  `hooks/install.sh` lo registra en `~/.claude/settings.json` (idempotente, con backup, `--uninstall`).
- `plugin/src/logic.ts`: lógica pura (sin I/O) que deriva los slots. **Testeada** en `plugin/tests/logic.test.ts` (`node:test`).
- `plugin/src/state.ts`: I/O (it2, ps, archivos) + store con eventos `change`/`tick`.
- `plugin/src/render.ts`: SVG → data URI por tecla. `plugin/src/views.ts`: cambio de vista (perfiles empaquetados).
- `plugin/src/actions/*`: una clase por acción del manifest. `SlotAction` cachea settings y deduplica `setImage`.
- `profile/build-profile.mjs`: genera los `.streamDeckProfile` (vistas XL + otros dispositivos). Los nombres
  de perfil deben coincidir con `views.ts` y `manifest.json → Profiles`.

## Reglas
- El hook **nunca** escribe en stdout (se inyecta como contexto en `UserPromptSubmit`) y siempre sale 0.
- Fuente de verdad de "hay un Claude acá": proceso `claude` en la tty (`ps`), no los archivos.
- Nada de servidores HTTP ni puertos: los archivos JSON son la API.
- Sin `System Events`/Accesibilidad: sólo `it2` y AppleScript de iTerm2.
- `setImage` no anima GIFs; cualquier animación es repintar SVG y debe ser acotada (CPU).

## Comandos
```bash
cd plugin && nvm use 24
npm run build && npm run restart      # o npm run watch
npm test                              # logic (node:test) + hook (bash fixtures)
npm run profiles                      # regenerar perfiles dentro del .sdPlugin
npm run pack                          # dist/com.pabloalaniz.claude-iterm-deck.streamDeckPlugin
../scripts/simulate.sh demo|clear     # estados falsos en el deck
open "streamdeck://plugins/message/com.pabloalaniz.claude-iterm-deck/switch/focus"  # deep link
tail -f com.pabloalaniz.claude-iterm-deck.sdPlugin/logs/*.log
```
