"""Sovereign Finance for Hermes. Importing this file registers nothing and touches no files."""


def register(ctx):
    """Register tools, the guard hook and the /sovereign command when Hermes asks for them."""
    # Relative import: Hermes loads this directory under a synthetic package name.
    from .sovereign import plugin

    return plugin.register(ctx)
