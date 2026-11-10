"""The /sovereign slash command: a plain-text card, no model turn."""
from __future__ import annotations

import datetime as _dt

from . import cli


def _short(value: str, head: int = 6, tail: int = 4) -> str:
    return value if len(value) <= head + tail + 3 else f"{value[:head]}...{value[-tail:]}"


def _trim(amount: str, places: int = 6) -> str:
    try:
        number = float(amount)
    except (TypeError, ValueError):
        return str(amount)
    return f"{number:.{places}f}".rstrip("0").rstrip(".") or "0"


def render(_raw_args: str = "", **_kwargs) -> str:
    result = cli.run("status", {}, timeout=45)
    if not result.get("ok"):
        return f"Sovereign Finance: {(result.get('error') or {}).get('message', 'status is unavailable.')}"
    data = result["data"]
    wallet = data.get("wallet")
    lines = [f"Sovereign Finance ({data.get('mode')})"]
    if not wallet:
        lines.append("No wallet yet. Open the Sovereign Finance pane in Hermes Desktop to create one.")
        return "\n".join(lines)
    lines.append(f"Wallet {wallet['address']}")
    for net in data.get("networks", []):
        lines.append("")
        lines.append(net["name"])
        if net.get("error"):
            lines.append(f"  {net['error']}")
            continue
        balances = net.get("balances") or {}
        held = [f"{_trim(balances.get('native', '0'))} {net['nativeSymbol']}"]
        held += [f"{_trim(t['amount'])} {t['symbol']}" for t in balances.get("tokens", []) if float(t.get("amount") or 0) > 0]
        lines.append("  Balance: " + ", ".join(held))
        session = net.get("session")
        if not session:
            lines.append("  Session: none. Set permissions and activate them in the pane.")
        else:
            until = _dt.datetime.fromtimestamp(session["expiry"], _dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            caps = ", ".join(f"{c['capPerDay']} {c['symbol']}" for c in session.get("caps", []))
            lines.append(f"  Session: {session['status']}, key {_short(session['keyId'], 10, 6)}, until {until}")
            lines.append(f"  Daily caps: {caps}")
            lines.append(f"  Keystore: {session['keystoreKeyUrl']}")
        positions = net.get("positions") or []
        if not positions:
            lines.append("  Positions: none")
        for p in positions:
            state = "in range" if p["inRange"] else "OUT OF RANGE"
            fees = ", ".join(f"{_trim(f['amount'])} {f['symbol']}" for f in p["unclaimedFees"])
            lines.append(f"  Position #{p['tokenId']} {p['pair']} {p['feePct']}%: {state}, {p['priceLower']} to {p['priceUpper']} "
                         f"(now {p['priceCurrent']} {p['priceUnit']}), unclaimed {fees}")
    return "\n".join(lines)
