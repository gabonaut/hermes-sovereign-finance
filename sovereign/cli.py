"""Runs the bundled Node CLI. Every call gets a small fixed environment, never Hermes's own."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from .paths import CLI_BUNDLE, data_dir

# Variables a Node process needs to start and reach the network. Nothing else is passed on.
_PASS_THROUGH = ("HOME", "TMPDIR", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
                 "https_proxy", "http_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS")


class CliUnavailable(RuntimeError):
    pass


def node_path() -> str:
    """Hermes's managed Node when it is installed, else the one on PATH."""
    try:
        from hermes_constants import find_node_executable

        found = find_node_executable("node")
        if found:
            return found
    except Exception:
        pass
    found = shutil.which("node")
    if not found:
        raise CliUnavailable("Node.js was not found. Sovereign Finance needs Node 22 or newer.")
    return found


def clean_env(node: str) -> dict[str, str]:
    env = {k: os.environ[k] for k in _PASS_THROUGH if os.environ.get(k)}
    env["PATH"] = os.pathsep.join([str(Path(node).parent), "/usr/bin", "/bin"])
    env["NODE_OPTIONS"] = "--no-warnings"
    return env


def command_line(command: str, *, network: str | None = None, job: str | None = None) -> list[str]:
    if not CLI_BUNDLE.is_file():
        raise CliUnavailable(f"The plugin's CLI bundle is missing at {CLI_BUNDLE}.")
    argv = [node_path(), str(CLI_BUNDLE), command, "--data-dir", str(data_dir())]
    if network:
        argv += ["--network", network]
    if job:
        argv += ["--job", job]
    return argv


def _fail(code: str, message: str) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}}


def parse_envelope(stdout: str) -> dict:
    """The CLI prints exactly one JSON envelope as its last line."""
    for line in reversed([ln for ln in stdout.splitlines() if ln.strip()]):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and "ok" in value:
            return value
    return _fail("CLI_OUTPUT", "The plugin's CLI returned no result.")


def run(command: str, payload: dict | None = None, *, network: str | None = None, timeout: float = 60) -> dict:
    """Run one CLI command to completion and return its envelope. Never raises."""
    try:
        argv = command_line(command, network=network)
        done = subprocess.run(argv, input=json.dumps(payload or {}), capture_output=True, text=True,
                              timeout=timeout, env=clean_env(argv[0]), shell=False)
    except CliUnavailable as exc:
        return _fail("CLI_UNAVAILABLE", str(exc))
    except subprocess.TimeoutExpired:
        return _fail("TIMEOUT", f"The plugin's CLI did not answer within {int(timeout)} seconds.")
    except OSError as exc:
        return _fail("CLI_SPAWN", f"The plugin's CLI could not start: {exc}")
    return parse_envelope(done.stdout)


def spawn(command: str, payload: dict | None, *, job: str, network: str | None = None) -> subprocess.Popen:
    """Start a long admin command. Its progress is in the data directory under jobs/<job>.json."""
    argv = command_line(command, network=network, job=job)
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            text=True, env=clean_env(argv[0]), shell=False, start_new_session=True)
    try:
        proc.stdin.write(json.dumps(payload or {}))
        proc.stdin.close()
    except OSError:
        pass
    return proc
