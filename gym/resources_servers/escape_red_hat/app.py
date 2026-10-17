# Escape from Red Hat — NeMo Gym Resources Server (nemo-gym==0.6.0).
#
# A thin, stateless proxy over the TypeScript engine's /api/gym API (apps/server/src/gymApi.ts), so Gym
# rollouts run the exact simulation, tool validation and scoring the app uses. Per-rollout state lives in
# the TS server, keyed by Gym's per-session id (SESSION_ID_KEY from the session cookie middleware).
#
# Tools: observe, consult_plan, notify, plan_route, move, request_assistance, assist, check_in, verify_roster.
# Each tool result returned to the model is JSON: {result, done, outcome, state(compact)}.
# Reward (from the engine's score): +1 verified success with required procedures, 0 incomplete / timeout /
# unresolved, -1 critical violation (repeated invalid calls after feedback, repeated moves into known hazards).
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, Request
from pydantic import BaseModel, ConfigDict

from nemo_gym.base_resources_server import (
    BaseResourcesServerConfig,
    BaseSeedSessionRequest,
    BaseSeedSessionResponse,
    BaseVerifyRequest,
    BaseVerifyResponse,
    SimpleResourcesServer,
)
from nemo_gym.server_utils import SESSION_ID_KEY

TOOL_NAMES = (
    "observe",
    "consult_plan",
    "notify",
    "plan_route",
    "move",
    "request_assistance",
    "assist",
    "check_in",
    "verify_roster",
)


class EscapeResourcesServerConfig(BaseResourcesServerConfig):
    # Base URL of the Escape from Red Hat server (apps/server). Env ESCAPE_API_URL overrides.
    escape_api_url: str = "http://127.0.0.1:8787"
    max_decisions: int = 24
    request_timeout_s: float = 60.0


class EscapeSeedSessionRequest(BaseSeedSessionRequest):
    model_config = ConfigDict(extra="allow")
    case_id: str
    harness: str = "v2"


class EscapeSeedSessionResponse(BaseSeedSessionResponse):
    model_config = ConfigDict(extra="allow")


class ToolArgs(BaseModel):
    # Arguments are validated by the engine (strict zod schemas); invalid calls come back as
    # model-visible errors with a hint, never as HTTP failures.
    model_config = ConfigDict(extra="allow")


class EscapeVerifyRequest(BaseVerifyRequest):
    model_config = ConfigDict(extra="allow")
    case_id: str


class EscapeVerifyResponse(BaseVerifyResponse):
    model_config = ConfigDict(extra="allow")
    # Top-level numeric fields are picked up by Gym aggregate metrics.
    success: float = 0.0
    decisions: float = 0.0
    invalid_calls: float = 0.0
    recoveries: float = 0.0
    sim_time_s: float = 0.0
    outcome_status: str = ""
    ended_by_verify: bool = False


class EscapeResourcesServer(SimpleResourcesServer):
    config: EscapeResourcesServerConfig

    def _api(self) -> str:
        return os.environ.get("ESCAPE_API_URL", self.config.escape_api_url).rstrip("/")

    async def _post(self, path: str, payload: Optional[Dict[str, Any]] = None) -> httpx.Response:
        async with httpx.AsyncClient(timeout=self.config.request_timeout_s) as client:
            return await client.post(f"{self._api()}{path}", json=payload or {})

    def setup_webserver(self) -> FastAPI:
        app = super().setup_webserver()
        for name in TOOL_NAMES:
            app.post(f"/{name}")(self._make_tool_route(name))
        return app

    def _make_tool_route(self, name: str):
        async def tool_route(request: Request, body: ToolArgs) -> Dict[str, Any]:
            session_id = request.session[SESSION_ID_KEY]
            res = await self._post(
                f"/api/gym/sessions/{session_id}/tools/{name}?view=compact",
                {"arguments": body.model_dump()},
            )
            if res.status_code != 200:
                # Unknown session etc.: surface to the model as a tool error rather than crashing the rollout.
                return {"result": {"ok": False, "error": {"code": "SESSION_ERROR", "message": res.text[:300]}}, "done": True}
            return res.json()

        tool_route.__name__ = f"tool_{name}"
        return tool_route

    async def seed_session(self, request: Request, body: EscapeSeedSessionRequest) -> EscapeSeedSessionResponse:
        session_id = request.session[SESSION_ID_KEY]
        res = await self._post(
            "/api/gym/sessions",
            {
                "session_id": session_id,
                "case_id": body.case_id,
                "harness": body.harness,
                "max_decisions": self.config.max_decisions,
            },
        )
        res.raise_for_status()
        data = res.json()
        return EscapeSeedSessionResponse(case_id=data["case_id"], harness=data["harness"], sim_time=data["sim_time"])

    async def verify(self, request: Request, body: EscapeVerifyRequest) -> EscapeVerifyResponse:
        session_id = request.session[SESSION_ID_KEY]
        res = await self._post(f"/api/gym/sessions/{session_id}/verify")
        if res.status_code != 200:
            return EscapeVerifyResponse(
                **body.model_dump(),
                reward=0.0,
                failure_reason=f"engine session unavailable: HTTP {res.status_code}",
            )
        v = res.json()
        m = v.get("metrics") or {}
        return EscapeVerifyResponse(
            **body.model_dump(),
            reward=float(v["reward"]),
            success=1.0 if v.get("success") else 0.0,
            decisions=float(m.get("decisions", 0)),
            invalid_calls=float(m.get("invalidCalls", 0)),
            recoveries=float(m.get("recoveries", 0)),
            sim_time_s=float(m.get("simTime", 0.0)),
            outcome_status=str((v.get("outcome") or {}).get("status", "")),
            ended_by_verify=bool(v.get("ended_by_verify", False)),
            failure_reason=None if v.get("success") else (v.get("outcome") or {}).get("reason"),
        )


if __name__ == "__main__":
    EscapeResourcesServer.run_webserver()
