"""OrganSpace v2 backend — step-by-step simulation with Q&A."""

import json
import os
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

for var in list(os.environ.keys()):
    if 'proxy' in var.lower() and 'socks' in os.getenv(var, '').lower():
        del os.environ[var]

from config import LLM_PROVIDER, DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, ANTHROPIC_API_KEY, LLM_MODEL, HOST, PORT
from models.graph import OrganGraph
from llm import LLMClient

app = FastAPI(title="OrganSpace v2")

# Cache GLB/static assets for 1 hour to speed up subsequent loads
class CacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if any(path.endswith(ext) for ext in ('.glb', '.gltf', '.png', '.jpg', '.woff2')):
            response.headers['Cache-Control'] = 'public, max-age=3600'
        elif any(path.endswith(ext) for ext in ('.js', '.css', '.html')):
            response.headers['Cache-Control'] = 'no-cache'
        return response

app.add_middleware(CacheStaticMiddleware)

graph = OrganGraph()
_llm = None
_organ_agents = None
_orchestrator = None


def _get_llm():
    global _llm
    if _llm is None:
        if LLM_PROVIDER == "deepseek":
            if not DEEPSEEK_API_KEY:
                raise RuntimeError("DEEPSEEK_API_KEY not set.")
            _llm = LLMClient(provider="deepseek", api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        elif LLM_PROVIDER == "anthropic":
            if not ANTHROPIC_API_KEY:
                raise RuntimeError("ANTHROPIC_API_KEY not set.")
            _llm = LLMClient(provider="anthropic", api_key=ANTHROPIC_API_KEY)
        else:
            raise RuntimeError(f"Unknown provider: {LLM_PROVIDER}")
    return _llm


def _get_orchestrator():
    global _organ_agents, _orchestrator
    if _orchestrator is None:
        llm = _get_llm()

        from agents.organs.cardiovascular import CardiovascularAgent
        from agents.organs.respiratory import RespiratoryAgent
        from agents.organs.renal import RenalAgent
        from agents.organs.hepatic import HepaticAgent
        from agents.organs.immune import ImmuneAgent
        from agents.organs.nervous import NervousAgent
        from agents.organs.blood import BloodAgent
        from agents.organs.coagulation import CoagulationAgent
        from agents.organs.metabolic import MetabolicAgent
        from agents.orchestrator import Orchestrator

        _organ_agents = {
            "cardiovascular": CardiovascularAgent(llm, LLM_MODEL),
            "respiratory": RespiratoryAgent(llm, LLM_MODEL),
            "renal": RenalAgent(llm, LLM_MODEL),
            "hepatic": HepaticAgent(llm, LLM_MODEL),
            "immune": ImmuneAgent(llm, LLM_MODEL),
            "nervous": NervousAgent(llm, LLM_MODEL),
            "blood": BloodAgent(llm, LLM_MODEL),
            "coagulation": CoagulationAgent(llm, LLM_MODEL),
            "metabolic": MetabolicAgent(llm, LLM_MODEL),
        }
        for oid, agent in _organ_agents.items():
            agent.set_neighbors(graph.get_neighbors(oid))

        _orchestrator = Orchestrator(llm, LLM_MODEL, _organ_agents, graph)

    return _orchestrator, _organ_agents


def _get_organ_defs():
    from agents.organs.cardiovascular import CardiovascularAgent
    from agents.organs.respiratory import RespiratoryAgent
    from agents.organs.renal import RenalAgent
    from agents.organs.hepatic import HepaticAgent
    from agents.organs.immune import ImmuneAgent
    from agents.organs.nervous import NervousAgent
    from agents.organs.blood import BloodAgent
    from agents.organs.coagulation import CoagulationAgent
    from agents.organs.metabolic import MetabolicAgent

    agents = {}
    for cls in [CardiovascularAgent, RespiratoryAgent, RenalAgent, HepaticAgent,
                ImmuneAgent, NervousAgent, BloodAgent, CoagulationAgent, MetabolicAgent]:
        a = cls(None, "")
        agents[a.organ_id] = a
    return agents


@app.get("/api/health")
async def health():
    return {"status": "ok", "provider": LLM_PROVIDER}


@app.get("/api/organs")
async def list_organs():
    agents = _get_organ_defs()
    return {
        "organs": [{"id": oid, "name": a.organ_name,
                    "indicators": {k: {"name": v["name"], "unit": v.get("unit", ""),
                                       "normal_min": v.get("normal_min", 0),
                                       "normal_max": v.get("normal_max", 0)}
                                   for k, v in a.indicators_def.items()}}
                   for oid, a in agents.items()],
        "connections": graph.connections,
        "graph": graph.get_connection_graph(),
    }


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    orch = None
    organ_agents = None
    causal_steps = []      # The full chain
    previous_states = {}    # Accumulated organ states

    async def send(msg_type: str, data: dict):
        await ws.send_json({"type": msg_type, **data})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send("error", {"message": "Invalid JSON"})
                continue

            mtype = msg.get("type", "")

            # ---- START SIMULATION ----
            if mtype == "start_simulation":
                scenario = msg.get("scenario", "")
                if not scenario:
                    await send("error", {"message": "Missing scenario"})
                    continue

                await send("status", {"message": "正在生成因果链..."})
                try:
                    orch, organ_agents = _get_orchestrator()
                    orch.reset_all()
                    previous_states = {}

                    causal_steps = await orch.generate_causal_chain(scenario)
                    if not causal_steps:
                        await send("error", {"message": "无法生成因果链，请尝试其他场景"})
                        continue

                    await send("causal_chain", {"steps": causal_steps})

                    # Auto-execute step 0
                    if causal_steps:
                        state = await orch.execute_step(causal_steps[0], previous_states)
                        previous_states[causal_steps[0]["organ_id"]] = state
                        await send("step_update", {
                            "step": 0,
                            "organ_id": causal_steps[0]["organ_id"],
                            "state": state,
                        })
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    await send("error", {"message": f"模拟失败: {str(e)}"})

            # ---- CHAT BETWEEN STEPS ----
            elif mtype == "chat":
                if not orch:
                    await send("error", {"message": "No active simulation"})
                    continue
                step_idx = msg.get("step", 0)
                reply = await orch.handle_chat(msg.get("message", ""), step_idx, causal_steps)
                await send("chat_reply", {"message": reply})

            # ---- ASK SPECIFIC ORGAN ----
            elif mtype == "ask_organ":
                if not orch:
                    await send("error", {"message": "No active simulation"})
                    continue
                result = await orch.handle_organ_question(
                    msg.get("organ_id", ""), msg.get("message", "")
                )
                await send("organ_reply", result)

            # ---- STEP CHANGED (user clicked next/prev) ----
            elif mtype == "step_changed":
                if not orch:
                    await send("error", {"message": "No active simulation"})
                    continue
                step_idx = msg.get("step", 0)
                if step_idx < len(causal_steps):
                    state = await orch.execute_step(causal_steps[step_idx], previous_states)
                    previous_states[causal_steps[step_idx]["organ_id"]] = state
                    await send("step_update", {
                        "step": step_idx,
                        "organ_id": causal_steps[step_idx]["organ_id"],
                        "state": state,
                    })

            # ---- FINISH ----
            elif mtype == "finish_simulation":
                if not orch:
                    await send("error", {"message": "No active simulation"})
                    continue
                summary = await orch.generate_summary(causal_steps)
                await send("simulation_complete", {"summary": summary})

            # ---- RESET ----
            elif mtype == "reset":
                if orch:
                    orch.reset_all()
                causal_steps = []
                previous_states = {}
                # Send default states for all organs
                agents = organ_agents or _get_organ_defs()
                for oid, agent in agents.items():
                    await send("step_update", {
                        "step": -1, "organ_id": oid,
                        "state": agent.state.to_dict(),
                    })
                await send("status", {"message": "已重置"})

            else:
                await send("error", {"message": f"Unknown: {mtype}"})

    except WebSocketDisconnect:
        pass


# Frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(os.path.join(frontend_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn
    print(f"OrganSpace v2 → http://{HOST}:{PORT}")
    print(f"Provider: {LLM_PROVIDER} | Model: {LLM_MODEL}")
    if not (DEEPSEEK_API_KEY or ANTHROPIC_API_KEY):
        print("⚠️  No API key configured!")
    uvicorn.run(app, host=HOST, port=PORT)
