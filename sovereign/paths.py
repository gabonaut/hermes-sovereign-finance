"""Where the plugin keeps its files."""
from __future__ import annotations

import os
from pathlib import Path

PLUGIN_ID = "sovereign-finance"
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
CLI_BUNDLE = PACKAGE_ROOT / "cli" / "dist" / "sovereign.mjs"
NETWORKS_FILE = PACKAGE_ROOT / "networks.json"
SKILLS_ROOT = PACKAGE_ROOT / "skills"


def data_dir() -> Path:
    """The plugin's data directory under the active Hermes home, private to the user."""
    try:
        from plugins.plugin_storage import plugin_data_dir

        root = plugin_data_dir(PLUGIN_ID)
    except ImportError:
        from hermes_constants import get_hermes_home

        root = get_hermes_home() / "plugin-data" / PLUGIN_ID
        root.mkdir(parents=True, exist_ok=True)
    try:
        if (root.stat().st_mode & 0o777) != 0o700:
            os.chmod(root, 0o700)
    except OSError:
        pass
    return root
