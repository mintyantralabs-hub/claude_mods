# claude_mods

Claude Code mods (function-hook plugins). This repo is a plugin marketplace.

## clear-view

A live session dashboard pane. One glance tells you what Claude is doing and what it has done.

```
● Running Bash · 14.2s
6 turns · last 41.0s
tokens in 182k · out 9.4k · cache 87%

Tools
Bash              12    3.1s avg ✗2
Read               9    40ms avg
Edit               5    55ms avg

Files (7)
M src/drivers/uart.c
W include/board.h
R CMakeLists.txt

Errors (2)
Bash exit 2: make: *** [all] Error 1

[ Reset ]
```

- **Status**: idle / thinking / running `<tool>`, with a live turn timer and subagent activity.
- **Turns**: count, last duration, non-normal endings (`aborted`, `error`, `refusal`).
- **Tokens**: input (incl. cache), output, cache hit rate. Subagent usage included.
- **Tools**: calls, average latency, errors (`✗`) and permission denies (`⊘`) per tool.
- **Files**: every file read (`R`), edited (`M`) or written (`W`), most recent first, paths relative to the session cwd.
- **Errors**: last failed or denied tool calls, one line each.
- Status line summary after each turn: `✓ 41.0s · 26 tools · 7 files`.

### Install

```
/plugin install clear-view --marketplace mintyantralabs-hub/claude_mods
```

Answer `y` to add the marketplace, then pick a scope.

### Use

| Command | Effect |
| --- | --- |
| `/clearview` | Open the pane |
| `/clearview reset` | Zero all stats (or press `Reset` / `r` in the pane) |
| `/clearview close` | Close the pane |

The pane opens on its own at session start when the terminal is at least 144 columns wide (docked as a sidebar in fullscreen). Narrower than that, run `/clearview` to open it inline.

### Limits

- Stats live in session state: they survive a hot reload, not a new session.
- Only `Read`, `Edit`, `Write` and `NotebookEdit` count as file touches. Files changed via `Bash` (`sed -i`, `make`) are not tracked.
- Token totals come from `turn.complete`; an interrupted turn or an API error reports no usage, so it adds nothing.

### Develop

```
claude plugin validate clear-view
claude plugin test clear-view
claude --plugin-dir ./clear-view
```
