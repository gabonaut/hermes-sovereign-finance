"""Registration with Hermes. No files are created and no process is started here."""
from __future__ import annotations

from .paths import SKILLS_ROOT


def _skill_metadata(path) -> tuple[str, dict]:
    """Description and frontmatter for the skills index, read from the SKILL.md header."""
    description = "Concentrated liquidity on PancakeSwap V3 (BNB Chain) and Uniswap V3 (Ethereum): list pools, size a range, enter, check, rebalance, collect."
    try:
        text = path.read_text(encoding="utf-8")
        if text.startswith("---"):
            import yaml

            front = yaml.safe_load(text.split("---", 2)[1]) or {}
            if isinstance(front, dict):
                return str(front.get("description") or description), front
    except Exception:
        pass
    return description, {}


def register(ctx):
    from . import approvals, status_card, tools

    for schema in tools.SCHEMAS:
        ctx.register_tool(name=schema["name"], toolset=tools.TOOLSET, schema=schema, handler=tools.make_handler(schema["name"]),
                          description=schema["description"])
    ctx.register_hook("pre_tool_call", approvals.pre_tool_call)
    ctx.register_command("sovereign", status_card.render, description="Wallet, session and position status from Sovereign Finance")
    skill = SKILLS_ROOT / "v3-range" / "SKILL.md"
    if skill.is_file() and callable(getattr(ctx, "register_skill", None)):
        description, frontmatter = _skill_metadata(skill)
        ctx.register_skill("v3-range", skill, description=description, frontmatter=frontmatter)
