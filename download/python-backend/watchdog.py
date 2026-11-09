"""
watchdog.py
===========
Process-level watchdog for the Forex scalping backend
(BACKEND-100 Sprint 9, feature #11).

Provides:
    * ``Watchdog`` class - monitor a PID file and restart the backend
      process if it disappears or exceeds a memory threshold.
    * ``start_watchdog(pid_file, restart_cmd)`` - fork a child process that
      runs the watchdog loop in the background.

The watchdog is intentionally self-contained (no FastAPI / MT5 deps) so it
can be installed as a systemd ``Type=notify`` companion or as a Windows
service via NSSM.

Deployment artifacts (installed alongside this module):

    deploy/systemd/scalping-v2.service      - Linux systemd unit
    deploy/windows/install-service.bat      - NSSM install script
    deploy/windows/uninstall-service.bat    - NSSM uninstall script
"""

import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

logger = logging.getLogger(__name__)

# Default check interval (seconds).
DEFAULT_CHECK_INTERVAL_S: int = 30
# Memory threshold (MB) above which the watchdog will restart the backend.
DEFAULT_MEMORY_LIMIT_MB: int = 1024


@dataclass
class WatchdogConfig:
    """Watchdog runtime configuration."""
    pid_file: str
    restart_cmd: Sequence[str]
    check_interval_s: int = DEFAULT_CHECK_INTERVAL_S
    memory_limit_mb: int = DEFAULT_MEMORY_LIMIT_MB
    max_restart_attempts: int = 5
    restart_cooldown_s: int = 10


class Watchdog:
    """Monitor a PID file and restart the backend when needed.

    The watchdog is designed to run in a forked child process (see
    :func:`start_watchdog`).  It polls the PID file every
    ``check_interval_s`` seconds and:

      * If the PID file is missing or the PID is no longer alive, runs
        ``restart_cmd`` to relaunch the backend.
      * If the PID is alive but its RSS memory exceeds
        ``memory_limit_mb``, kills it (SIGTERM, then SIGKILL after 5s) and
        restarts.
      * Honours ``max_restart_attempts`` within a 5-minute window to avoid
        a crash-loop.

    The class is also usable synchronously via :meth:`tick` for testing.
    """

    def __init__(self, config: WatchdogConfig) -> None:
        self.config = config
        self._restart_count = 0
        self._restart_window_start = time.time()

    # ---- PID file helpers ------------------------------------------------ #

    def _read_pid(self) -> int | None:
        """Read the PID from ``pid_file``.  Returns ``None`` if missing."""
        try:
            with open(self.config.pid_file, "r") as fh:
                txt = fh.read().strip()
            return int(txt) if txt.isdigit() else None
        except FileNotFoundError:
            return None
        except Exception as exc:
            logger.warning("Watchdog: failed to read PID file %s: %s",
                           self.config.pid_file, exc)
            return None

    @staticmethod
    def _is_alive(pid: int) -> bool:
        """Return True if ``pid`` is running on the current host."""
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # Process exists but we don't have permission to signal it.
            return True
        except OSError:
            return False

    @staticmethod
    def _rss_mb(pid: int) -> int:
        """Best-effort RSS memory in MB for ``pid`` (Linux /proc only)."""
        try:
            # /proc/<pid>/status -> VmRSS line.
            with open(f"/proc/{pid}/status", "r") as fh:
                for line in fh:
                    if line.startswith("VmRSS:"):
                        # "VmRSS:    12345 kB"
                        parts = line.split()
                        return int(parts[1]) // 1024
        except Exception:
            pass
        return 0

    # ---- restart logic --------------------------------------------------- #

    def _within_restart_window(self) -> bool:
        """Return True if we're still in the 5-minute restart-count window."""
        now = time.time()
        if now - self._restart_window_start > 300:
            # Reset the window.
            self._restart_window_start = now
            self._restart_count = 0
            return False
        return True

    def _restart(self, reason: str, kill_pid: int | None = None) -> bool:
        """Restart the backend via ``restart_cmd``.  Returns True if started."""
        if self._within_restart_window() and \
                self._restart_count >= self.config.max_restart_attempts:
            logger.critical(
                "Watchdog: refusing to restart (max_restart_attempts=%d in "
                "5min window reached).  Reason: %s",
                self.config.max_restart_attempts, reason,
            )
            return False
        if kill_pid is not None and kill_pid > 0:
            logger.warning("Watchdog: killing pid=%d (%s)", kill_pid, reason)
            try:
                os.kill(kill_pid, signal.SIGTERM)
                # Wait up to 5s for graceful shutdown.
                for _ in range(50):
                    if not self._is_alive(kill_pid):
                        break
                    time.sleep(0.1)
                if self._is_alive(kill_pid):
                    logger.warning("Watchdog: SIGKILL pid=%d", kill_pid)
                    os.kill(kill_pid, signal.SIGKILL)
            except Exception as exc:  # pragma: no cover
                logger.error("Watchdog: kill(%d) failed: %s", kill_pid, exc)
        # Remove stale PID file so the new process can recreate it.
        try:
            if os.path.exists(self.config.pid_file):
                os.unlink(self.config.pid_file)
        except Exception:  # pragma: no cover
            pass
        logger.info("Watchdog: restarting backend via %s (reason=%s)",
                    self.config.restart_cmd, reason)
        try:
            # Detach from controlling terminal so the backend survives the
            # watchdog's own exit if needed.
            if sys.platform == "win32":
                proc = subprocess.Popen(
                    list(self.config.restart_cmd),
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,  # type: ignore[attr-defined]
                )
            else:
                proc = subprocess.Popen(
                    list(self.config.restart_cmd),
                    start_new_session=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        except Exception as exc:
            logger.error("Watchdog: restart failed: %s", exc)
            return False
        self._restart_count += 1
        logger.info("Watchdog: backend restarted (new pid=%d, attempts=%d)",
                    proc.pid, self._restart_count)
        time.sleep(self.config.restart_cooldown_s)
        return True

    # ---- one check iteration -------------------------------------------- #

    def tick(self) -> dict[str, Any]:
        """Run a single watchdog check.  Returns a status dict."""
        pid = self._read_pid()
        if pid is None or not self._is_alive(pid):
            restarted = self._restart(reason="pid_missing_or_dead",
                                      kill_pid=pid)
            return {"alive": False, "pid": pid, "action": "restart"
                    if restarted else "no_action",
                    "restart_count": self._restart_count}
        # Process alive - check memory.
        rss = self._rss_mb(pid)
        if self.config.memory_limit_mb > 0 and rss > self.config.memory_limit_mb:
            restarted = self._restart(reason=f"memory_limit_exceeded "
                                       f"({rss}MB > {self.config.memory_limit_mb}MB)",
                                      kill_pid=pid)
            return {"alive": True, "pid": pid, "rss_mb": rss,
                    "action": "restart_on_memory" if restarted else "no_action",
                    "restart_count": self._restart_count}
        return {"alive": True, "pid": pid, "rss_mb": rss,
                "action": "noop", "restart_count": self._restart_count}

    def run_forever(self) -> None:
        """Loop forever, ticking every ``check_interval_s`` seconds."""
        logger.info("Watchdog starting (pid_file=%s, interval=%ds, "
                    "mem_limit=%dMB)",
                    self.config.pid_file, self.config.check_interval_s,
                    self.config.memory_limit_mb)
        while True:
            try:
                status = self.tick()
                logger.debug("Watchdog tick: %s", status)
            except Exception as exc:  # pragma: no cover
                logger.exception("Watchdog tick raised: %s", exc)
            time.sleep(self.config.check_interval_s)


# --------------------------------------------------------------------------- #
# Fork-on-start helper
# --------------------------------------------------------------------------- #

def start_watchdog(pid_file: str,
                   restart_cmd: Sequence[str],
                   *,
                   check_interval_s: int = DEFAULT_CHECK_INTERVAL_S,
                   memory_limit_mb: int = DEFAULT_MEMORY_LIMIT_MB,
                   fork: bool = True) -> int:
    """Launch the watchdog.

    Parameters
    ----------
    pid_file : str
        Path to the backend's PID file (the backend writes its own PID
        there at startup).
    restart_cmd : sequence of str
        Argv used to relaunch the backend, e.g.
        ``["python", "main.py"]`` or ``["systemctl", "start",
        "scalping-v2"]``.
    check_interval_s : int
        Seconds between checks (default 30).
    memory_limit_mb : int
        RSS threshold in MB above which the backend is killed+restarted.
        Set to 0 to disable memory checks.
    fork : bool
        If True (default), fork a child process to run the watchdog loop
        in the background and return immediately.  If False, run the loop
        in-process (useful for systemd which manages forking itself).

    Returns
    -------
    int
        The watchdog's PID (or 0 if running in-process).
    """
    config = WatchdogConfig(
        pid_file=pid_file,
        restart_cmd=list(restart_cmd),
        check_interval_s=check_interval_s,
        memory_limit_mb=memory_limit_mb,
    )
    wd = Watchdog(config)
    if not fork:
        wd.run_forever()
        return 0
    if sys.platform == "win32":
        # Windows doesn't have os.fork; spawn a subprocess running the
        # watchdog module's __main__ block.
        proc = subprocess.Popen(
            [sys.executable, __file__,
             "--pid-file", pid_file,
             "--interval", str(check_interval_s),
             "--mem-limit", str(memory_limit_mb),
             "--", *restart_cmd],
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,  # type: ignore[attr-defined]
        )
        return proc.pid
    pid = os.fork()  # type: ignore[attr-defined]
    if pid == 0:
        # Child process - detach and run forever.
        os.setsid()
        try:
            sys.stdout = open(os.devnull, "w")  # type: ignore[assignment]
            sys.stderr = open(os.devnull, "w")  # type: ignore[assignment]
        except Exception:  # pragma: no cover
            pass
        wd.run_forever()
        os._exit(0)
    return pid


def _main() -> None:
    """CLI entry point for forked watchdog processes (Windows path)."""
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid-file", required=True)
    parser.add_argument("--interval", type=int,
                        default=DEFAULT_CHECK_INTERVAL_S)
    parser.add_argument("--mem-limit", type=int,
                        default=DEFAULT_MEMORY_LIMIT_MB)
    parser.add_argument("restart_cmd", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    cmd = [c for c in args.restart_cmd if c != "--"]
    start_watchdog(
        pid_file=args.pid_file,
        restart_cmd=cmd,
        check_interval_s=args.interval,
        memory_limit_mb=args.mem_limit,
        fork=False,
    )


__all__ = [
    "Watchdog", "WatchdogConfig", "start_watchdog",
    "DEFAULT_CHECK_INTERVAL_S", "DEFAULT_MEMORY_LIMIT_MB",
]


if __name__ == "__main__":
    _main()
