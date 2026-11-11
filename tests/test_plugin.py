"""Unit tests for the Python half. Run from the repo root:

    uv run --no-project --with fastapi --with httpx --with pyyaml python -m unittest discover -s tests -v
"""
from __future__ import annotations

import importlib
import importlib.machinery
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_package():
    """Load the plugin the way Hermes does: under a synthetic package name, relative imports only."""
    name = "hermes_plugins_test.sovereign_finance"
    if name in sys.modules:
        return sys.modules[name]
    parent = importlib.util.module_from_spec(importlib.machinery.ModuleSpec("hermes_plugins_test", None, is_package=True))
    parent.__path__ = []
    sys.modules["hermes_plugins_test"] = parent
    spec = importlib.util.spec_from_file_location(name, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


PKG = load_package()
guard = importlib.import_module(".sovereign.guard", PKG.__name__)
approvals = importlib.import_module(".sovereign.approvals", PKG.__name__)
cli = importlib.import_module(".sovereign.cli", PKG.__name__)
paths = importlib.import_module(".sovereign.paths", PKG.__name__)
tools = importlib.import_module(".sovereign.tools", PKG.__name__)


class GuardTests(unittest.TestCase):
    def blocked(self, tool, args):
        return guard.scan(tool, args) is not None

    def test_blocks_the_key_directory_in_every_spelling(self):
        self.assertTrue(self.blocked("terminal", {"command": "cat ~/.hermes/plugin-data/sovereign-finance/keys/session-97-abcd1234.key"}))
        self.assertTrue(self.blocked("terminal", {"command": "ls $HOME/.hermes/plugin-data/sovereign-finance"}))
        self.assertTrue(self.blocked("read_file", {"path": "/Users/x/.hermes/plugin-data/sovereign-finance/sessions/97.json"}))
        self.assertTrue(self.blocked("terminal", {"command": "cat ~/.hermes/plugin-data/sov*/keys/*"}))
        self.assertTrue(self.blocked("terminal", {"command": "tar c ~/.hermes/plugin-data/*/keys"}))
        self.assertTrue(self.blocked("execute_code", {"code": "open('/tmp/x/session-56-0a1b2c3d.key').read()"}))

    def test_blocks_the_cli_the_admin_routes_and_the_control_socket(self):
        self.assertTrue(self.blocked("terminal", {"command": "node ~/.hermes/plugins/sovereign-finance/cli/dist/sovereign.mjs activate"}))
        self.assertTrue(self.blocked("terminal", {"command": "curl -X POST http://127.0.0.1:5123/api/plugins/sovereign-finance/activate"}))
        self.assertTrue(self.blocked("execute_code", {"code": "open(os.path.expanduser('~/.hermes/gateway.sock'))"}))
        self.assertTrue(self.blocked("mcp__shell__run", {"cmd": ["sh", "-c", "echo session-ticket"]}))

    def test_leaves_ordinary_calls_alone(self):
        self.assertFalse(self.blocked("terminal", {"command": "ls ~/.hermes/plugins && git status"}))
        self.assertFalse(self.blocked("read_file", {"path": "~/.hermes/plugins/sovereign-finance/skills/v3-range/SKILL.md"}))
        self.assertFalse(self.blocked("terminal", {"command": "ls ~/.hermes/plugin-data"}))
        self.assertFalse(self.blocked("web_search", {"query": "sovereign finance hermes plugin"}))


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self._run = cli.run

    def tearDown(self):
        cli.run = self._run

    def test_other_sovereign_tools_pass_and_other_tools_are_guarded(self):
        self.assertIsNone(approvals.pre_tool_call(tool_name="sovereign_status", args={}))
        self.assertIsNone(approvals.pre_tool_call(tool_name="terminal", args={"command": "ls"}))
        blocked = approvals.pre_tool_call(tool_name="terminal", args={"command": "cat x/plugin-data/sovereign-finance/keys/a"})
        self.assertEqual(blocked["action"], "block")

    def test_execute_is_escalated_with_the_decoded_sentence_and_a_scoped_key(self):
        seen = {}

        def fake(command, payload=None, *, network=None, timeout=60):
            seen.update(command=command, network=network, timeout=timeout, payload=payload)
            return {"ok": True, "data": {"sentence": "On BNB Chain testnet, from wallet 0x12...ab: wrap 0.05 tBNB.", "ruleKey": "sovereign:97:abcd1234:lp:0xpool", "violations": []}}

        cli.run = fake
        out = approvals.pre_tool_call(tool_name="sovereign_execute", args={"network": "bnb", "actions": [{"type": "wrap", "amount": "0.05"}]})
        self.assertEqual(out, {"action": "approve", "message": "On BNB Chain testnet, from wallet 0x12...ab: wrap 0.05 tBNB.", "rule_key": "sovereign:97:abcd1234:lp:0xpool"})
        self.assertEqual(seen["command"], "describe")
        self.assertEqual(seen["network"], "bnb")
        self.assertLess(seen["timeout"], 30)

    def test_execute_is_blocked_on_violations_errors_and_bad_input(self):
        cli.run = lambda *a, **k: {"ok": True, "data": {"sentence": "x", "ruleKey": "k", "violations": ["A collect would send its proceeds to 0x22, not to the wallet."]}}
        out = approvals.pre_tool_call(tool_name="sovereign_execute", args={"network": "bnb", "actions": []})
        self.assertEqual(out["action"], "block")
        self.assertIn("not to the wallet", out["message"])
        cli.run = lambda *a, **k: {"ok": False, "error": {"code": "NO_SESSION", "message": "The agent has no session on BNB Chain testnet."}}
        self.assertEqual(approvals.pre_tool_call(tool_name="sovereign_execute", args={"network": "bnb", "actions": []})["action"], "block")
        self.assertEqual(approvals.pre_tool_call(tool_name="sovereign_execute", args={"network": "solana"})["action"], "block")

        def boom(*a, **k):
            raise RuntimeError("x")

        cli.run = boom
        self.assertEqual(approvals.pre_tool_call(tool_name="sovereign_execute", args={"network": "bnb", "actions": []})["action"], "block")

    def test_a_missing_rule_key_never_becomes_an_approval(self):
        cli.run = lambda *a, **k: {"ok": True, "data": {"sentence": "x", "ruleKey": "", "violations": []}}
        self.assertEqual(approvals.pre_tool_call(tool_name="sovereign_execute", args={"network": "bnb", "actions": []})["action"], "block")


class ToolTests(unittest.TestCase):
    def test_schemas_match_the_manifest(self):
        import yaml

        manifest = yaml.safe_load((ROOT / "plugin.yaml").read_text())
        self.assertEqual(sorted(s["name"] for s in tools.SCHEMAS), sorted(manifest["provides_tools"]))
        self.assertEqual(sorted(tools.HANDLERS), sorted(manifest["provides_tools"]))
        self.assertEqual(manifest["name"], paths.PLUGIN_ID)

    def test_bad_network_is_a_plain_error(self):
        out = tools.make_handler("sovereign_positions")({"network": "solana"})
        self.assertIn("BAD_INPUT", out)


class BackendAuthTests(unittest.TestCase):
    """The routes answer the local Desktop app only."""

    @classmethod
    def setUpClass(cls):
        from fastapi import FastAPI, Request
        from fastapi.testclient import TestClient

        cls.tmp = tempfile.TemporaryDirectory()
        spec = importlib.util.spec_from_file_location("sovereign_plugin_api_test", ROOT / "dashboard" / "plugin_api.py")
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        api.paths.data_dir = lambda: Path(cls.tmp.name)
        api.cli.run = lambda command, payload=None, **k: {"ok": True, "data": {"mode": "testnet", "wallet": None, "networks": [], "id": "v3-lp"}}
        cls.api = api
        app = FastAPI()

        @app.middleware("http")
        async def fake_hermes_auth(request: Request, call_next):
            kind = request.headers.get("x-test-auth")
            if kind == "desktop":
                request.state.native_http_principal = {"purpose": "native-http"}
            elif kind == "hosted":
                request.state.hosted_http_authenticated = True
            return await call_next(request)

        app.include_router(api.router, prefix="/api/plugins/sovereign-finance")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def get(self, headers):
        return self.client.get("/api/plugins/sovereign-finance/state", headers=headers)

    def test_desktop_ticket_is_served(self):
        r = self.get({"x-test-auth": "desktop"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])
        self.assertEqual(r.json()["data"]["mode"], "testnet")

    def test_plain_callers_and_session_tokens_get_403(self):
        self.assertEqual(self.get({}).status_code, 403)
        self.assertEqual(self.get({"x-hermes-session-token": "anything"}).status_code, 403)
        self.assertEqual(self.get({"x-test-auth": "hosted"}).status_code, 403)  # hosted, but no redeemed ticket
        self.assertEqual(self.get({"x-hermes-gateway-ticket": "unredeemed"}).status_code, 403)
        for path in ("create", "activate", "revoke", "withdraw", "grant", "mode"):
            self.assertEqual(self.client.post(f"/api/plugins/sovereign-finance/{path}", json={}).status_code, 403)

    def test_host_isolation_needs_the_redeemed_ticket_header(self):
        self.assertEqual(self.get({"x-test-auth": "hosted", "x-hermes-gateway-ticket": "redeemed"}).status_code, 200)

    def test_no_top_level_profile_key_is_ever_required(self):
        r = self.client.post("/api/plugins/sovereign-finance/mode", json={"mode": "sideways"}, headers={"x-test-auth": "desktop"})
        self.assertEqual(r.json()["error"]["code"], "BAD_INPUT")


if __name__ == "__main__":
    unittest.main()
