"""Backend routes for the Sovereign Finance pane.

Hermes mounts this router at /api/plugins/sovereign-finance. The routes answer only the local
Hermes Desktop app. They are the only way to create a wallet, set permissions, activate, revoke
or withdraw, and each of those still needs a signature from the user's passkey in the browser.
"""
from __future__ import annotations

import hashlib
import importlib
import importlib.util
import json
import os
import secrets
import signal
import sys
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request

# Hermes imports this file on its own; load the sibling package by path, without touching sys.path.
_PACKAGE_PATH = Path(__file__).resolve().parents[1] / "sovereign"
_PACKAGE_NAME = "_sovereign_finance_dashboard_" + hashlib.sha256(str(_PACKAGE_PATH).encode()).hexdigest()[:16]
if _PACKAGE_NAME not in sys.modules:
    _spec = importlib.util.spec_from_file_location(_PACKAGE_NAME, _PACKAGE_PATH / "__init__.py", submodule_search_locations=[str(_PACKAGE_PATH)])
    if _spec is None or _spec.loader is None:
        raise ImportError("Sovereign Finance package unavailable")
    _package = importlib.util.module_from_spec(_spec)
    sys.modules[_PACKAGE_NAME] = _package
    try:
        _spec.loader.exec_module(_package)
    except Exception:
        sys.modules.pop(_PACKAGE_NAME, None)
        raise
cli = importlib.import_module(".cli", _PACKAGE_NAME)
paths = importlib.import_module(".paths", _PACKAGE_NAME)

STATUS_MAX_AGE = 8.0
JOB_MAX_SECONDS = 20 * 60
ADMIN_COMMANDS = ("create", "recover", "activate", "revoke", "withdraw")


def desktop_only(request: Request) -> None:
    """Allow the local Hermes Desktop app and nobody else.

    Hermes attaches a Desktop principal to requests it has authenticated as coming from the local
    app. Requests without one are refused, including under plugin host isolation.
    """
    state = getattr(request, "state", None)
    if getattr(state, "native_http_principal", None) is not None:
        return
    if getattr(state, "hosted_http_authenticated", None) is True and request.headers.get("x-hermes-gateway-ticket"):
        return
    raise HTTPException(status_code=403, detail="desktop_only")


router = APIRouter(dependencies=[Depends(desktop_only)])

_lock = threading.Lock()
_procs: dict[str, object] = {}
_status_cache: dict[str, dict] = {}
_refreshing: set[str] = set()
_preset_cache: dict[str, dict] = {}


def ok(data) -> dict:
    return {"ok": True, "data": data}


def fail(code: str, message: str) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}}


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _mode() -> str:
    state = _read_json(paths.data_dir() / "state.json") or {}
    return "mainnet" if state.get("mode") == "mainnet" else "testnet"


def _pid_alive(pid) -> bool:
    try:
        os.kill(int(pid), 0)
    except (OSError, TypeError, ValueError):
        return False
    return True


def _job_files() -> list[Path]:
    folder = paths.data_dir() / "jobs"
    return sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True) if folder.is_dir() else []


def _current_job() -> dict | None:
    """The newest job, with a job whose process died marked as failed."""
    for path in _job_files():
        job = _read_json(path)
        if not isinstance(job, dict):
            continue
        if job.get("status") in ("running", "waiting_passkey") and not _pid_alive(job.get("pid")):
            job.update(status="error", step="Failed", passkeyUrl=None, passkeyPrompt=None,
                       error={"code": "INTERRUPTED", "message": "This request stopped before it finished. Nothing more will be signed. Start it again."},
                       finishedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            try:
                path.write_text(json.dumps(job, indent=2), encoding="utf-8")
            except OSError:
                pass
        job.pop("pid", None)
        return job
    return None


def _job_running() -> bool:
    job = _current_job()
    return bool(job and job.get("status") in ("running", "waiting_passkey"))


def _refresh_status(mode: str) -> None:
    try:
        result = cli.run("status", {}, timeout=40)
        if result.get("ok"):
            _status_cache[mode] = {"at": time.time(), "data": result["data"]}
    finally:
        _refreshing.discard(mode)


def _status(mode: str, *, force: bool = False) -> dict | None:
    """Chain data for the pane. Serves the last read at once and refreshes it in the background."""
    cached = _status_cache.get(mode)
    stale = force or cached is None or time.time() - cached["at"] > STATUS_MAX_AGE
    if cached is None:
        _refresh_status(mode)
        return (_status_cache.get(mode) or {}).get("data")
    if stale and mode not in _refreshing:
        _refreshing.add(mode)
        threading.Thread(target=_refresh_status, args=(mode,), daemon=True).start()
    return cached["data"]


def _preset(mode: str) -> dict:
    if mode not in _preset_cache:
        result = cli.run("preset", {}, timeout=20)
        if result.get("ok"):
            _preset_cache[mode] = result["data"]
    return _preset_cache.get(mode) or {"id": "v3-lp", "title": "V3 LP", "durationDays": 7, "networks": {}}


def _draft(mode: str) -> dict | None:
    draft = _read_json(paths.data_dir() / "drafts" / f"{mode}.json")
    if not isinstance(draft, dict):
        return None
    draft.pop("inputs", None)
    return draft


def _start_job(command: str, payload: dict, network: str | None = None) -> dict:
    with _lock:
        if _job_running():
            return fail("JOB_RUNNING", "Another request is still waiting. Finish or cancel it first.")
        for old in _job_files():
            try:
                old.unlink()
            except OSError:
                pass
        job_id = secrets.token_hex(8)
        try:
            proc = cli.spawn(command, payload, job=job_id, network=network)
        except Exception as exc:
            return fail("CLI_UNAVAILABLE", str(exc))
        _procs[job_id] = proc

    def reap() -> None:
        try:
            proc.wait(timeout=JOB_MAX_SECONDS)
        except Exception:
            _terminate(proc)
        finally:
            _procs.pop(job_id, None)
            _status_cache.pop(_mode(), None)

    threading.Thread(target=reap, daemon=True).start()
    # Give the CLI a moment to write its first job state so the next /state already shows it.
    deadline = time.time() + 3
    target = paths.data_dir() / "jobs" / f"{job_id}.json"
    while time.time() < deadline and not target.is_file() and proc.poll() is None:
        time.sleep(0.05)
    return ok({"jobId": job_id})


def _terminate(proc) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (OSError, AttributeError):
        try:
            proc.terminate()
        except Exception:
            pass


@router.get("/state")
def get_state():
    mode = _mode()
    status = _status(mode) or {}
    return ok({
        "mode": mode,
        "wallet": status.get("wallet"),
        "networks": status.get("networks") or [],
        "job": _current_job(),
        "preset": _preset(mode),
        "draft": _draft(mode),
    })


@router.post("/mode")
def set_mode(body: dict = Body(default={})):
    mode = body.get("mode")
    if mode not in ("testnet", "mainnet"):
        return fail("BAD_INPUT", 'mode must be "testnet" or "mainnet".')
    if _job_running():
        return fail("JOB_RUNNING", "Finish or cancel the request in progress before switching mode.")
    result = cli.run("mode", {"mode": mode}, timeout=20)
    if not result.get("ok"):
        return result
    return ok({})


@router.post("/create")
def create(body: dict = Body(default={})):
    return _start_job("create", {})


@router.post("/recover")
def recover(body: dict = Body(default={})):
    return _start_job("recover", {})


@router.post("/grant")
def grant(body: dict = Body(default={})):
    result = cli.run("grant", {"durationDays": body.get("durationDays"), "networks": body.get("networks")}, timeout=45)
    return result if not result.get("ok") else ok(result["data"])


@router.post("/activate")
def activate(body: dict = Body(default={})):
    return _start_job("activate", {"draftId": body.get("draftId"), "networks": body.get("networks")})


@router.post("/revoke")
def revoke(body: dict = Body(default={})):
    network = body.get("network")
    if network not in ("bnb", "ethereum"):
        return fail("BAD_INPUT", "Pick a network.")
    return _start_job("revoke", {}, network=network)


@router.post("/withdraw")
def withdraw(body: dict = Body(default={})):
    network = body.get("network")
    if network not in ("bnb", "ethereum"):
        return fail("BAD_INPUT", "Pick a network.")
    return _start_job("withdraw", {"asset": body.get("asset"), "amount": body.get("amount"), "to": body.get("to")}, network=network)


@router.post("/job/dismiss")
def dismiss(body: dict = Body(default={})):
    if _job_running():
        return fail("JOB_RUNNING", "This request is still in progress. Cancel it instead.")
    for path in _job_files():
        try:
            path.unlink()
        except OSError:
            pass
    _status_cache.pop(_mode(), None)
    return ok({})


@router.post("/job/cancel")
def cancel(body: dict = Body(default={})):
    for job_id, proc in list(_procs.items()):
        _terminate(proc)
        _procs.pop(job_id, None)
    for path in _job_files():
        job = _read_json(path)
        if isinstance(job, dict) and job.get("status") in ("running", "waiting_passkey"):
            if _pid_alive(job.get("pid")):
                try:
                    os.kill(int(job["pid"]), signal.SIGTERM)
                except (OSError, ValueError):
                    pass
            job.update(status="error", step="Cancelled", passkeyUrl=None, passkeyPrompt=None,
                       error={"code": "CANCELLED", "message": "Cancelled. Anything already sent to the network may still confirm."},
                       finishedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            try:
                path.write_text(json.dumps(job, indent=2), encoding="utf-8")
            except OSError:
                pass
    return ok({})
