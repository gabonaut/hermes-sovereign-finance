"""The pre_tool_call hook: the guard for other tools, and the approval prompt for sovereign_execute."""
from __future__ import annotations

import logging

from . import cli, guard, tools

log = logging.getLogger(__name__)

# The hook must answer inside Hermes's 30 second limit, or every tool is blocked for a minute.
# Describing a batch given as `open` or `close` plans it first, which reads the chain.
_DESCRIBE_TIMEOUT = 22


def _block(message: str) -> dict:
    return {"action": "block", "message": message}


def _approve_execute(args) -> dict:
    args = args if isinstance(args, dict) else {}
    network = args.get("network")
    if network not in ("bnb", "ethereum"):
        return _block('sovereign_execute needs network "bnb" or "ethereum".')
    result = cli.run("describe", tools.batch_payload(args), network=network, timeout=_DESCRIBE_TIMEOUT)
    if not result.get("ok"):
        error = result.get("error") or {}
        return _block(f"Nothing was sent. {error.get('message', 'The batch could not be checked.')}")
    data = result.get("data") or {}
    violations = data.get("violations") or []
    if violations:
        return _block("Nothing was sent. " + " ".join(str(v) for v in violations))
    sentence, rule_key = data.get("sentence"), data.get("ruleKey")
    if not sentence or not rule_key:
        return _block("Nothing was sent. The batch could not be described.")
    # The sentence comes from the encoded calls. The rule key scopes an "always" answer to one
    # pool or one swap direction on one network, for the current session key only.
    return {"action": "approve", "message": sentence, "rule_key": rule_key}


def pre_tool_call(tool_name: str = "", args=None, **_kwargs):
    if tool_name == "sovereign_execute":
        try:
            return _approve_execute(args)
        except Exception:  # fail closed: an unchecked batch is never sent
            log.exception("sovereign_execute approval check failed")
            return _block("Nothing was sent. The batch could not be checked.")
    if tool_name.startswith("sovereign_"):
        return None
    try:
        message = guard.scan(tool_name, args)
    except Exception:
        log.exception("sovereign guard scan failed")
        return None
    return _block(message) if message else None
