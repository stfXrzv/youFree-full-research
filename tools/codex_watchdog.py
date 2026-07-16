"""Keep the Codex desktop app available and record unexpected restarts."""

from __future__ import annotations

import json
import os
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path


APP_ID = "OpenAI.Codex_2p2nqsd0c76g0!App"
POLL_SECONDS = 8
MISSING_CONFIRMATIONS = 3
RESTART_WINDOW_SECONDS = 10 * 60
MAX_RESTARTS_IN_WINDOW = 5
COOLDOWN_SECONDS = 15 * 60

STATE_DIR = Path.home() / ".codex" / "codex_watchdog"
STATE_PATH = STATE_DIR / "state.json"
EVENTS_PATH = STATE_DIR / "events.log"
STOP_PATH = STATE_DIR / "stop"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_event(event: str, **details: object) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"at": utc_now(), "event": event, **details}
    with EVENTS_PATH.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, ensure_ascii=True) + "\n")


def write_state(**state: object) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"updated_at": utc_now(), "watchdog_pid": os.getpid(), **state}
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8"
    )
    temporary.replace(STATE_PATH)


def find_main_codex_pid() -> int | None:
    command = (
        "$p=Get-CimInstance Win32_Process | Where-Object { "
        "$_.Name -eq 'ChatGPT.exe' -and "
        "$_.ExecutablePath -like '*OpenAI.Codex_*' -and "
        "($_.CommandLine -notmatch '--type=') } | Select-Object -First 1; "
        "if ($p) { [Console]::Write($p.ProcessId) }"
    )
    completed = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True,
        text=True,
        timeout=12,
        creationflags=subprocess.CREATE_NO_WINDOW,
        check=False,
    )
    value = completed.stdout.strip()
    return int(value) if value.isdigit() else None


def launch_codex() -> None:
    subprocess.Popen(
        ["explorer.exe", f"shell:AppsFolder\\{APP_ID}"],
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
        close_fds=True,
    )


def main() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    restart_times: deque[float] = deque()
    missing_checks = 0
    last_pid = find_main_codex_pid()
    write_event("watchdog_started", codex_pid=last_pid)
    write_state(
        status="monitoring",
        last_event="watchdog_started",
        app_present=last_pid is not None,
        codex_pid=last_pid,
        restart_count=0,
    )

    while not STOP_PATH.exists():
        try:
            pid = find_main_codex_pid()
        except (OSError, subprocess.SubprocessError) as error:
            write_event("probe_error", error=type(error).__name__)
            time.sleep(POLL_SECONDS)
            continue

        if pid is not None:
            missing_checks = 0
            if pid != last_pid:
                write_event("codex_detected", codex_pid=pid)
            last_pid = pid
            write_state(
                status="monitoring",
                last_event="codex_running",
                app_present=True,
                codex_pid=pid,
                restart_count=len(restart_times),
            )
            time.sleep(POLL_SECONDS)
            continue

        missing_checks += 1
        write_state(
            status="confirming_missing",
            last_event="codex_missing",
            app_present=False,
            codex_pid=None,
            missing_checks=missing_checks,
            restart_count=len(restart_times),
        )
        if missing_checks < MISSING_CONFIRMATIONS:
            time.sleep(POLL_SECONDS)
            continue

        now = time.monotonic()
        while restart_times and now - restart_times[0] > RESTART_WINDOW_SECONDS:
            restart_times.popleft()

        if len(restart_times) >= MAX_RESTARTS_IN_WINDOW:
            write_event("restart_cooldown", seconds=COOLDOWN_SECONDS)
            write_state(
                status="cooldown",
                last_event="restart_cooldown",
                app_present=False,
                codex_pid=None,
                restart_count=len(restart_times),
                cooldown_seconds=COOLDOWN_SECONDS,
            )
            time.sleep(COOLDOWN_SECONDS)
            restart_times.clear()
            missing_checks = 0
            continue

        launch_codex()
        restart_times.append(now)
        missing_checks = 0
        last_pid = None
        write_event("crashed_restarted", restart_count=len(restart_times))
        write_state(
            status="restarted",
            last_event="crashed_restarted",
            app_present=False,
            codex_pid=None,
            restart_count=len(restart_times),
        )
        time.sleep(15)

    pid = find_main_codex_pid()
    write_event("watchdog_stopped")
    write_state(
        status="stopped",
        last_event="watchdog_stopped",
        app_present=pid is not None,
        codex_pid=pid,
        restart_count=len(restart_times),
    )


if __name__ == "__main__":
    main()
