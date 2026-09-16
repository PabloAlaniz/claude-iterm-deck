# Prior art and design notes

Several people built Stream Deck plugins for Claude Code before this one. This project owes ideas to
all of them; this page credits those ideas and explains where our design goes a different way, and why.

## Projects worth knowing

| Project | What it does well |
|---|---|
| [paultyng/agentsd](https://github.com/paultyng/agentsd) | Claude Code **HTTP hooks** into a local server, a clean state machine, and approve / deny buttons that answer the `PermissionRequest` hook directly. Shows permission mode and model on keys. Solid test setup (vitest + a fake `claude` agent). |
| [mark-mucchetti/stream-deck-claude-code](https://github.com/mark-mucchetti/stream-deck-claude-code) | One tile per session with rich state (thinking / working / waiting / done / error), focus for iTerm2, Terminal.app, VS Code and Cursor, animated tiles, and a thorough mapping of Claude Code hook events. |
| [JulienCr/streamdeck-claude](https://github.com/JulienCr/streamdeck-claude) | Reads `~/.claude/sessions/<pid>.json` (which Claude Code writes on its own), an event-log + reducer model, subagent depth, long-press actions, a hook-check key, Warp focus, and Windows/WSL support. |
| [etechlead/claude-deck](https://github.com/etechlead/claude-deck) | The first in the niche; a simple REST API for task status and a demo video that sells the idea well. |
| [saeedkolivand/claude-usage-streamdeck-plugin](https://github.com/saeedkolivand/claude-usage-streamdeck-plugin) | Usage limits (5 h / 7 d) from the same endpoint `/usage` uses, keychain token handling, ring gauge, burn rate, and per-session cost from transcripts. Published on the Elgato Marketplace. |
| [Corrugator/StreamDeck-Claude](https://github.com/Corrugator/StreamDeck-Claude), [Darhkfox/streamdeckclaude](https://github.com/Darhkfox/streamdeckclaude) | Usage meters with different token strategies (a signed Swift keychain helper, `.credentials.json`). |

## Ideas borrowed (thank you)

- **`~/.claude/sessions/<pid>.json` as a base source** of status and session name (JulienCr).
- **Permission mode, model, `transcript_path` and `permission_suggestions`** from the hook payloads, and
  the `SubagentStart/Stop`, `TaskCreated/Completed`, `PostToolUseFailure`, `PermissionDenied`,
  `Elicitation` events (agentsd, mark-mucchetti).
- **Error state** from `StopFailure`, and the "done vs idle" distinction with an elapsed-time hint
  (mark-mucchetti).
- **Long-press** on a key (clear / escalate) and a **setup / hook-check key** (JulienCr).
- **Usage endpoint, headers and token lookup**, per-session cost from the transcript with request
  dedupe and a pricing table (saeedkolivand; Corrugator for the keychain caveats).
- **Ship a video / preview**, a state simulator and hook fixtures for tests (etechlead, agentsd).

## Where this design differs, and why

- **Answers go to the terminal, not to the hook.** `agentsd` answers `PermissionRequest` by holding the
  hook's HTTP response open. We instead send the keystroke (`1`, `2`, `3`, Esc, Enter) to the exact
  iTerm2 pane with `it2 session send`. That keeps the terminal dialog usable from the keyboard at the
  same time, works for plan approvals and questions too, and reuses the "always allow" rule Claude itself
  suggests. The trade-off is that it is iTerm2-only.
- **Files instead of a local HTTP server.** The hook writes one JSON per session; the plugin watches
  the directory. No port, no auth surface, and Claude Code keeps working when the Stream Deck app is
  closed.
- **Liveness from processes.** Which sessions run Claude is decided by `claude` processes per tty
  (`ps`), so keys never outlive a session that was killed without a `SessionEnd` hook.
- **Columns follow iTerm's tab order**, not arrival order, so the deck matches Cmd+1…9 and does not
  reshuffle when a session ends. One column per tab (extra panes such as agent-team teammates do not
  take a column).
- **Views.** Instead of one layout, three bundled profiles (Focus / Standard / Dense) chosen by how
  many sessions are open, plus a prioritisation rule when there are more sessions than keys.
- **Bounded animation.** Stream Deck's `setImage` does not play GIFs; animation means repainting SVGs.
  We only blink on a transition to *waiting* and draw a progress ring during a long-press.

## Not adopted (for now)

Warp / VS Code / Cursor focus, Windows and WSL support, dials on the Stream Deck +, a REST API for
external status, and continuous "breathing" animations. Some are out of scope for an iTerm2-first
tool; others are welcome as contributions.
