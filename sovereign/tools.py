"""The five tools the agent gets. All of them use the session key or only read."""
from __future__ import annotations

import json

from . import cli, skills

TOOLSET = "sovereign_finance"
_NETWORK = {"type": "string", "enum": ["bnb", "ethereum"],
            "description": 'Which network: "bnb" (BNB Chain) or "ethereum". The plugin maps it to mainnet or testnet from its current mode.'}

SCHEMAS = [
    {
        "name": "sovereign_status",
        "description": ("The user's onchain wallet in Hermes (Sovereign Finance: crypto, DeFi, BNB Chain, Ethereum). Read it: address, mode, balances, and the agent's session on each network "
                        "(status, expiry, what it may call, daily caps). Read-only. Call this before planning anything."),
        "parameters": {"type": "object", "properties": {"network": {**_NETWORK, "description": _NETWORK["description"] + " Omit for both."}},
                       "additionalProperties": False},
    },
    {
        "name": "sovereign_positions",
        "description": ("List the Sovereign Finance wallet's V3 liquidity positions (LP, pools) on one network: pool, range, whether the price is in range, "
                        "amounts and unclaimed fees. Read-only."),
        "parameters": {"type": "object", "properties": {"network": _NETWORK}, "required": ["network"], "additionalProperties": False},
    },
    {
        "name": "sovereign_quote",
        "description": ("Read-only planning for the Sovereign Finance wallet: pools, swap quotes and liquidity position plans. kind=pools lists the most traded V3 pools with fee tier, TVL and fee APR. "
                        "kind=swap quotes a swap. kind=lp-plan sizes a range for a new position and kind=exit-plan prepares closing one: "
                        "both return a planId, and sovereign_execute runs it from that id. To open or close without a preview, "
                        "skip this tool and call sovereign_execute with `open` or `close`."),
        "parameters": {
            "type": "object",
            "properties": {
                "network": _NETWORK,
                "kind": {"type": "string", "enum": ["pools", "swap", "lp-plan", "exit-plan"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 25, "description": "pools: how many rows. Default 10."},
                "tokenIn": {"type": "string", "description": "swap: symbol of the token to sell."},
                "tokenOut": {"type": "string", "description": "swap: symbol of the token to buy."},
                "amountIn": {"type": "string", "description": "swap: amount to sell, in token units, as a decimal string."},
                "fee": {"type": "integer", "description": "swap, lp-plan: fee tier in hundredths of a basis point, for example 500 for 0.05%."},
                "pool": {"type": "string", "description": "lp-plan: pool address. Alternative to token0, token1 and fee."},
                "pair": {"type": "string", "description": 'lp-plan: the pair, like "USDT/WBNB". Alternative to token0 and token1.'},
                "token0": {"type": "string", "description": "lp-plan: one token symbol of the pair."},
                "token1": {"type": "string", "description": "lp-plan: the other token symbol of the pair."},
                "rangePct": {"type": "number", "description": "lp-plan: half-width of the range as a percentage of the current price. Default 1."},
                "tickLower": {"type": "integer", "description": "lp-plan: explicit lower tick instead of rangePct."},
                "tickUpper": {"type": "integer", "description": "lp-plan: explicit upper tick instead of rangePct."},
                "budget": {"description": 'lp-plan: {"symbol": "BNB", "amount": "0.02"} to fund from one asset (the native coin is wrapped for you), or the string "balances" to use what the wallet holds of the pool\'s two tokens.'},
                "slippageBps": {"type": "integer", "description": "Allowed slippage in basis points. Default 100 for mints and exits, 50 for swaps."},
                "tokenId": {"type": "string", "description": "exit-plan: the position id."},
            },
            "required": ["network", "kind"],
        },
    },
    {
        "name": "sovereign_execute",
        "description": ("Act from the user's Sovereign Finance wallet: open or close a liquidity position (LP) in a pool, swap, wrap. Sends one batch with the agent's session key. The user is asked to approve it. "
                        "Fastest way, one call and no planning step: pass `open` to open a liquidity position, or `close` to close one, "
                        "and the plugin builds the whole batch (wrap, swap, approvals, mint). "
                        'Example: {"network": "bnb", "open": {"pair": "USDT/WBNB", "fee": 500, "budget": {"symbol": "BNB", "amount": "0.004"}, "rangePct": 3}}. '
                        'Example: {"network": "bnb", "close": {"tokenId": "123"}}. '
                        "Or pass the `planId` that sovereign_quote returned. Do not rebuild or edit an actions array yourself. "
                        "`actions` is only for a single step such as {type: wrap, amount}, or for a call outside the session's scope: "
                        "{type: transfer, token, to, amount} or {type: raw, to, data, value}, which the wallet refuses onchain unless the session "
                        "was granted them. If the wallet refuses a batch, report the refusal and do not look for another route."),
        "parameters": {
            "type": "object",
            "properties": {
                "network": _NETWORK,
                "open": {"type": "object", "description": ('Open a position. pair like "USDT/WBNB" (or pool address), fee tier (500 means 0.05%; omit for the deepest pool), '
                                                         'budget {"symbol": "BNB", "amount": "0.004"} or "balances", and rangePct (half-width in percent) '
                                                         "or tickLower and tickUpper.")},
                "close": {"type": "object", "description": 'Close a position and collect everything: {"tokenId": "123"}.'},
                "planId": {"type": "string", "description": "The planId from a sovereign_quote lp-plan or exit-plan, valid for ten minutes."},
                "actions": {"type": "array", "maxItems": 12, "items": {"type": "object", "properties": {"type": {"type": "string"}}, "required": ["type"]},
                            "description": "A hand-written batch, in order. Amounts are decimal strings in token units and tokens are symbols."},
            },
            "required": ["network"],
        },
    },
    {
        "name": "sovereign_skill",
        "description": ("Read skills from the Altana skills registry. action=list shows what is available, action=get returns one skill's text "
                        "after checking its sha256 against the registry index and this plugin's pinned list. Read-only."),
        "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["list", "get"]},
                                                         "id": {"type": "string", "description": "get: the skill id."}},
                       "required": ["action"], "additionalProperties": False},
    },
]

_TIMEOUTS = {"status": 60, "positions": 60, "quote": 60, "execute": 300}


def _out(envelope: dict) -> str:
    if envelope.get("ok"):
        return json.dumps(envelope.get("data"), ensure_ascii=False)
    error = envelope.get("error") or {}
    return json.dumps({"error": error.get("message", "The request failed."), "code": error.get("code", "FAILED"),
                       **{k: v for k, v in error.items() if k not in ("message", "code") and v is not None}}, ensure_ascii=False)


def _network(args: dict, required: bool = True):
    network = args.get("network")
    if network is None and not required:
        return None
    if network not in ("bnb", "ethereum"):
        raise ValueError('network must be "bnb" or "ethereum".')
    return network


def sovereign_status(args: dict, **_kw) -> str:
    return _out(cli.run("status", {}, network=_network(args, required=False), timeout=_TIMEOUTS["status"]))


def sovereign_positions(args: dict, **_kw) -> str:
    return _out(cli.run("positions", {}, network=_network(args), timeout=_TIMEOUTS["positions"]))


def sovereign_quote(args: dict, **_kw) -> str:
    payload = {k: v for k, v in args.items() if k != "network"}
    return _out(cli.run("quote", payload, network=_network(args), timeout=_TIMEOUTS["quote"]))


def batch_payload(args: dict) -> dict:
    """What a sovereign_execute call asks for, in the shape the CLI takes. The approval hook sends the same."""
    return {key: args[key] for key in ("actions", "planId", "open", "close") if args.get(key)}


def sovereign_execute(args: dict, **_kw) -> str:
    envelope = cli.run("execute", batch_payload(args), network=_network(args), timeout=_TIMEOUTS["execute"])
    if envelope.get("ok") and isinstance(envelope.get("data"), dict) and envelope["data"].get("ok") is False:
        data = envelope["data"]
        error = data.get("error") or {}
        return json.dumps({"error": error.get("message", "The batch failed."), "code": error.get("code", "FAILED"), "sent": False if error.get("revert") else None,
                           "revert": error.get("revert"), "relayCode": error.get("relayCode"), "attempted": data.get("did"), "detail": error.get("raw")}, ensure_ascii=False)
    return _out(envelope)


def sovereign_skill(args: dict, **_kw) -> str:
    action = args.get("action")
    if action == "list":
        return json.dumps(skills.list_skills(), ensure_ascii=False)
    if action == "get":
        return json.dumps(skills.get_skill(str(args.get("id") or "")), ensure_ascii=False)
    return json.dumps({"error": 'action must be "list" or "get".'})


HANDLERS = {
    "sovereign_status": sovereign_status,
    "sovereign_positions": sovereign_positions,
    "sovereign_quote": sovereign_quote,
    "sovereign_execute": sovereign_execute,
    "sovereign_skill": sovereign_skill,
}


def make_handler(name: str):
    fn = HANDLERS[name]

    def handler(args: dict, **kwargs) -> str:
        try:
            return fn(args if isinstance(args, dict) else {}, **kwargs)
        except ValueError as exc:
            return json.dumps({"error": str(exc), "code": "BAD_INPUT"})

    return handler
