"""Blocks agent tool calls that reach for the plugin's keys, its CLI or its admin routes.

This is a text check on the arguments of other tools, not a sandbox. The agent's real limits are
the session key's onchain scope and the passkey that every admin action needs.
"""
from __future__ import annotations

import json
import re

from .paths import PLUGIN_ID

_PATTERNS = (
    # The data directory, however it is spelled, including globbed spellings under plugin-data.
    (re.compile(r"plugin-data[/\\]+[^\s\"']{0,60}(?:sovereign|sov[^\s\"'/\\]*[*?])", re.I), "the plugin's data directory"),
    (re.compile(r"plugin-data[/\\]+[*?\[]", re.I), "the plugin data directories"),
    (re.compile(r"session-\d+-[0-9a-f]{8}\.key", re.I), "a session key file"),
    # The CLI bundle and its source.
    (re.compile(r"sovereign\.mjs", re.I), "the plugin's CLI"),
    (re.compile(re.escape(PLUGIN_ID) + r"[/\\]+cli\b", re.I), "the plugin's CLI"),
    # The admin routes and the Hermes gateway control socket.
    (re.compile(r"api/plugins/" + re.escape(PLUGIN_ID), re.I), "the plugin's admin routes"),
    (re.compile(r"gateway\.sock", re.I), "the Hermes gateway control socket"),
    (re.compile(r"session-ticket", re.I), "the Hermes gateway control socket"),
)


def scan(tool_name: str, args) -> str | None:
    """Return a refusal sentence when the call names a guarded place, else None."""
    try:
        text = json.dumps(args, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(args)
    # Shell and code can hide a path behind escapes; compare a copy with common ones undone.
    plain = text.replace("\\\\", "\\").replace("\\/", "/").replace("\\ ", " ")
    for pattern, what in _PATTERNS:
        if pattern.search(text) or pattern.search(plain):
            return (f"Sovereign Finance blocked this {tool_name} call because it reaches for {what}. "
                    "Wallet admin actions belong to the user in the Sovereign Finance pane, and the agent's "
                    "onchain actions go through the sovereign_* tools.")
    return None
