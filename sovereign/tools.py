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
        "description": ("Read the Sovereign Finance wallet: address, mode, balances, and the agent's session on each network "
                        "(status, expiry, what it may call, daily caps). Read-only. Call this before planning anything."),
        "parameters": {"type": "object", "properties": {"network": {**_NETWORK, "description": _NETWORK["description"] + " Omit for both."}},
                       "additionalProperties": False},
    },
    {
        "name": "sovereign_positions",
        "description": ("List the wallet's V3 liquidity positions on one network: pool, range, whether the price is in range, "
                        "amounts and unclaimed fees. Read-only."),
        "parameters": {"type": "object", "properties": {"network": _NETWORK}, "required": ["network"], "additionalProperties": False},
    },
    {
        "name": "sovereign_quote",
        "description": ("Read-only planning. kind=pools lists the most traded V3 pools with fee tier, TVL and fee APR. "
                        "kind=swap quotes a swap. kind=lp-plan sizes a range and returns the exact actions to open a position. "
                        "kind=exit-plan returns the actions that close a position. Pass a returned actions array unchanged to sovereign_execute."),
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
        "description": ("Send one batch of actions from the wallet with the agent's session key. Action types: wrap, unwrap, swap, mint, "
                        "increase, decrease, collect, burn. The plugin encodes them, adds exact approvals in the same batch and makes the wallet "
                        "the recipient of everything. Get the actions from sovereign_quote rather than writing them by hand. The user is asked to "
                        "approve each batch. A raw action {type: raw, to, data, value} exists only for calls outside the session scope, which the "
                        "wallet refuses onchain. If the wallet refuses a batch, report the refusal and do not look for another route."),
        "parameters": {
            "type": "object",
            "properties": {
                "network": _NETWORK,
                "actions": {"type": "array", "minItems": 1, "maxItems": 12, "items": {"type": "object", "properties": {"type": {"type": "string"}}, "required": ["type"]},
                            "description": "The batch, in order. Amounts are decimal strings in token units and tokens are symbols."},
            },
            "required": ["network", "actions"],
            "additionalProperties": False,
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


def sovereign_execute(args: dict, **_kw) -> str:
    envelope = cli.run("execute", {"actions": args.get("actions")}, network=_network(args), timeout=_TIMEOUTS["execute"])
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
