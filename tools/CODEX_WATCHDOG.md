# Codex watchdog

The watchdog keeps the Windows Codex desktop app running and records restarts.

Runtime files:

- `C:\Users\Stf x Rzv\.codex\codex_watchdog\state.json`
- `C:\Users\Stf x Rzv\.codex\codex_watchdog\events.log`

Create an empty `stop` file in the same directory to stop the watchdog cleanly.
Delete that file before starting it again.

On every resumed Codex run, read `state.json` and the final event from
`events.log` before continuing the current checkpoint.
