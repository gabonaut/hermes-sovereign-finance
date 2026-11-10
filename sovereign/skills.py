"""Read-only loader for the Altana skills registry.

A registry skill is text the agent reads. It is fetched live, its sha256 is checked against the
registry index, and it is also checked against the hashes pinned in networks.json. A skill that
changed after this plugin release was reviewed is refused until the pin is updated in a new release.
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from urllib.parse import urljoin, urlparse

from .paths import NETWORKS_FILE, SKILLS_ROOT, data_dir

_TIMEOUT = 15
_MAX_BYTES = 512 * 1024
_LOCAL = "v3-range"


def _config() -> dict:
    return json.loads(NETWORKS_FILE.read_text(encoding="utf-8"))["skills"]


def _fetch(url: str, allowed_host: str) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != allowed_host:
        raise ValueError(f"Refusing to fetch {url}: registry files must be on https://{allowed_host}.")
    request = urllib.request.Request(url, headers={"User-Agent": "hermes-sovereign-finance"})
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:  # noqa: S310 - https only, host pinned above
        body = response.read(_MAX_BYTES + 1)
    if len(body) > _MAX_BYTES:
        raise ValueError("The registry file is larger than expected.")
    return body


def _index() -> tuple[dict, str, str]:
    cfg = _config()
    index_url = cfg["indexUrl"]
    host = urlparse(index_url).hostname or ""
    return json.loads(_fetch(index_url, host)), index_url, host


def list_skills() -> dict:
    cfg = _config()
    rows = [{"id": _LOCAL, "source": "bundled with this plugin", "name": "V3 range liquidity",
             "description": "PancakeSwap V3 on BNB Chain and Uniswap V3 on Ethereum: list pools, size a range, enter, check, rebalance, collect.",
             "available": (SKILLS_ROOT / _LOCAL / "SKILL.md").is_file()}]
    try:
        index, _url, _host = _index()
    except Exception as exc:
        return {"skills": rows, "registryError": f"The registry could not be read: {exc}"}
    for entry in index.get("skills", []):
        pinned = cfg["pinned"].get(entry.get("id"))
        rows.append({"id": entry.get("id"), "source": "Altana skills registry", "name": entry.get("name"), "description": entry.get("description"),
                     "chain": entry.get("chain"), "scope": entry.get("scope"),
                     "available": bool(pinned) and str(entry.get("sha256", "")).lower() == pinned.lower(),
                     "note": None if pinned else "Not pinned by this plugin release, so it cannot be loaded here."})
    return {"skills": rows}


def get_skill(skill_id: str) -> dict:
    if skill_id == _LOCAL:
        path = SKILLS_ROOT / _LOCAL / "SKILL.md"
        if not path.is_file():
            return {"error": "The bundled v3-range skill is missing from this install."}
        return {"id": _LOCAL, "source": "bundled with this plugin", "text": path.read_text(encoding="utf-8")}
    cfg = _config()
    pinned = cfg["pinned"].get(skill_id)
    if not pinned:
        return {"error": f'"{skill_id}" is not a registry skill this plugin release pins. Pinned: {", ".join(sorted(cfg["pinned"]))}.'}
    try:
        index, index_url, host = _index()
        entry = next((e for e in index.get("skills", []) if e.get("id") == skill_id), None)
        if entry is None:
            return {"error": f'The registry no longer lists "{skill_id}".'}
        listed = str(entry.get("sha256", "")).lower()
        if listed != pinned.lower():
            return {"error": f'The registry copy of "{skill_id}" changed after this plugin release was reviewed, so it was not loaded.',
                    "registrySha256": listed, "pinnedSha256": pinned}
        cache = data_dir() / "cache" / "skills"
        cache.mkdir(parents=True, exist_ok=True)
        cached = cache / f"{pinned}.md"
        body = cached.read_bytes() if cached.is_file() else _fetch(urljoin(index_url, entry["path"]), host)
        digest = hashlib.sha256(body).hexdigest()
        if digest != pinned.lower():
            cached.unlink(missing_ok=True)
            return {"error": f'The file served for "{skill_id}" does not match its registry hash, so it was not loaded.', "sha256": digest, "expected": pinned}
        if not cached.is_file():
            cached.write_bytes(body)
    except Exception as exc:
        return {"error": f"The registry could not be read: {exc}"}
    header = ("Registry skill, sha256 " + digest + ", matching the registry index and this plugin's pinned list.\n"
              "It was written for agents that send raw calls with an Altana session. Here, read with sovereign_status, "
              "sovereign_positions and sovereign_quote, and send with sovereign_execute. This plugin's session covers V3 "
              "swaps and positions only; calls the session does not cover are refused onchain.\n\n")
    return {"id": skill_id, "source": "Altana skills registry", "sha256": digest, "text": header + body.decode("utf-8", errors="replace")}
