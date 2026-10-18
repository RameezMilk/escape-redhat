# Integration tests for the Escape from Red Hat Resources Server against the REAL nemo-gym 0.6.0 classes.
# Requires the Escape server (apps/server) reachable at $ESCAPE_API_URL (default http://127.0.0.1:8787);
# tests are skipped otherwise. Start it with e.g.:
#   PORT=8791 PLANNER_PROVIDER=scripted npx tsx apps/server/src/index.ts
import json
import os
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

from nemo_gym.server_utils import ServerClient
from resources_servers.escape_red_hat.app import EscapeResourcesServer, EscapeResourcesServerConfig

API = os.environ.get("ESCAPE_API_URL", "http://127.0.0.1:8787")
HERE = Path(__file__).parent
DATA = HERE.parent / "data"


def _server_up() -> bool:
    try:
        return httpx.get(f"{API}/health", timeout=2).status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _server_up(), reason=f"Escape server not reachable at {API}")


def _app():
    config = EscapeResourcesServerConfig(host="0.0.0.0", port=8080, entrypoint="", name="", escape_api_url=API)
    server = EscapeResourcesServer(config=config, server_client=MagicMock(spec=ServerClient))
    return server.setup_webserver()


def _rollout_client(app) -> TestClient:
    # One client (= one cookie jar) per rollout, like simple_agent carrying its resources-server cookies.
    return TestClient(app)


def _row(case_id: str, fname: str = "dev_v2.jsonl") -> dict:
    for line in (DATA / fname).read_text().splitlines():
        r = json.loads(line)
        if r["case_id"] == case_id:
            return r
    raise KeyError(case_id)


def test_seed_tool_verify_replays_to_verified_success() -> None:
    client = _rollout_client(_app())
    rec = json.loads((HERE / "dev-00-hero.calls.json").read_text())
    row = _row("dev-00-hero")

    seed = client.post("/seed_session", json=row)
    assert seed.status_code == 200, seed.text

    last = None
    for call in rec["calls"]:
        r = client.post(f"/{call['name']}", json=call["arguments"])
        assert r.status_code == 200, r.text
        last = r.json()
        assert "result" in last and "state" in last
        assert set(last["state"]["actors"][0]) >= {"id", "zone", "status", "alerted", "checked_in"}
    assert last is not None and last["done"] is True

    verify_body = {**row, "response": _fake_response()}
    v = client.post("/verify", json=verify_body)
    assert v.status_code == 200, v.text
    out = v.json()
    assert out["reward"] == rec["expected"]["reward"] == 1
    assert out["outcome_status"] == "success"
    assert out["success"] == 1.0


def test_invalid_call_is_a_model_visible_error_and_sessions_are_isolated() -> None:
    app = _app()
    a, b = _rollout_client(app), _rollout_client(app)
    row = _row("dev-01-fire_only")
    assert a.post("/seed_session", json=row).status_code == 200
    assert b.post("/seed_session", json=row).status_code == 200
    bad = a.post("/move", json={"actor_id": "nobody", "destination": "assembly"})
    assert bad.status_code == 200
    assert bad.json()["result"]["ok"] is False
    assert bad.json()["result"]["error"]["code"] == "INVALID_ARGUMENT"
    # session b is untouched by a's decision
    ob = b.post("/observe", json={"actor_id": "alex"}).json()
    assert ob["result"]["ok"] is True
    assert ob["state"]["decisions_remaining"] == 39
    # stopping early is scored honestly
    v = a.post("/verify", json={**row, "response": _fake_response()}).json()
    assert v["reward"] <= 0 and v["success"] == 0.0 and v["ended_by_verify"] is True


def _fake_response() -> dict:
    # Minimal Responses API object; verify() scores engine state, not the transcript.
    return {
        "id": "resp_test",
        "created_at": 0,
        "model": "test",
        "object": "response",
        "output": [],
        "parallel_tool_calls": False,
        "tool_choice": "auto",
        "tools": [],
    }
