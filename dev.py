#!/usr/bin/env python3
"""Apply migrations and run both development servers; Ctrl+C stops both."""

import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent


def listening_pids(port):
    result = subprocess.run(
        ["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
        capture_output=True, text=True,
    )
    # lsof returns 1 when no matching listener exists.
    if result.returncode not in (0, 1) or result.stderr.strip():
        raise OSError(f"Cannot inspect port {port}: {result.stderr.strip()}")
    return {int(pid) for pid in result.stdout.split()}


def free_port(port):
    notified = set()
    # Allow graceful shutdown first, then force-stop stubborn listeners.
    for sig, timeout in ((signal.SIGTERM, 5), (signal.SIGKILL, 2)):
        deadline = time.monotonic() + timeout
        signaled = set()
        while True:
            pids = listening_pids(port)
            if not pids:
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    probe.bind(("127.0.0.1", port))
                return
            for pid in pids - signaled:
                if pid not in notified:
                    print(f"Port {port} is occupied; stopping process {pid}.", flush=True)
                    notified.add(pid)
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
                except PermissionError as error:
                    raise PermissionError(f"Cannot stop process {pid} on port {port}: {error}") from error
                signaled.add(pid)
            if time.monotonic() >= deadline:
                break
            time.sleep(0.2)
    raise OSError(f"Port {port} is still occupied after attempting to stop its listeners.")


def main():
    python = ROOT / "back/.venv/bin/python"
    npm = shutil.which("npm")
    if not python.is_file():
        print("Missing back/.venv. Follow the backend setup in README.md.", file=sys.stderr)
        return 1
    if not npm or not shutil.which("node"):
        print("Install Node.js and npm before starting the servers.", file=sys.stderr)
        return 1
    if not shutil.which("lsof"):
        print("Install lsof so the launcher can free ports 8000 and 5173.", file=sys.stderr)
        return 1
    if not (ROOT / "front/node_modules/vite/bin/vite.js").is_file():
        print(f'Install frontend dependencies first: cd "{ROOT / "front"}" && npm install', file=sys.stderr)
        return 1

    processes = []

    def stop_requested(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop_requested)
    signal.signal(signal.SIGHUP, stop_requested)

    try:
        for port in (8000, 5173):
            free_port(port)
        print("Applying pending database migrations...", flush=True)
        migration = subprocess.Popen(
            [str(python), "manage.py", "migrate", "--noinput"],
            cwd=ROOT / "back", start_new_session=True,
        )
        processes.append(("Migrations", migration))
        migration_status = migration.wait()
        if migration_status != 0:
            print("Migrations failed; servers were not started. Fix the error above and retry.", file=sys.stderr)
            return migration_status
        processes.remove(("Migrations", migration))
        commands = (
            ("Backend", ROOT / "back", [str(python), "manage.py", "runserver", "127.0.0.1:8000"]),
            ("Frontend", ROOT / "front", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]),
        )
        for name, directory, command in commands:
            processes.append((name, subprocess.Popen(command, cwd=directory, start_new_session=True)))
        print("\nStarting Troqueles development servers:", flush=True)
        print("  App: http://localhost:5173/\n  API: http://localhost:8000/api/", flush=True)
        print("Keep this terminal open. Press Ctrl+C to stop both servers.\n", flush=True)
        while True:
            for name, process in processes:
                if process.poll() is not None:
                    print(f"{name} exited ({process.returncode}); stopping both servers.", file=sys.stderr)
                    return process.returncode or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping both servers...", flush=True)
        return 0
    except OSError as error:
        print(f"Could not start servers: {error}", file=sys.stderr)
        return 1
    finally:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        for _, process in processes:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 5
        for _, process in processes:
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                pass
        # A reloader or npm child may outlive its parent; clean up the group.
        for _, process in processes:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


if __name__ == "__main__":
    sys.exit(main())
