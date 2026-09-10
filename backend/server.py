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
from simulation.engine import (
    create_simulation, get_simulation, list_diseases, DISEASE_TEMPLATES,
)

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


def _create_orchestrator():
    """为每个连接创建独立的 orchestrator + 器官 Agent 实例。

    LLM 客户端可全局共享（无状态），但 orchestrator/agents 持有模拟状态，
    全局单例会导致多个浏览器标签同时运行 LLM 因果链时互相重置/串模拟。
    """
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

    organ_agents = {
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
    for oid, agent in organ_agents.items():
        agent.set_neighbors(graph.get_neighbors(oid))

    return Orchestrator(llm, LLM_MODEL, organ_agents, graph), organ_agents


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
    # 会话状态（可变容器，供 _handle_message 读写）
    session = {
        "orch": None,
        "organ_agents": None,
        "causal_steps": [],
        "previous_states": {},
    }

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

            try:
                await _handle_message(msg, session, send)
            except KeyError as e:
                # 未知 id / 非法参数：返回错误而非杀死连接（答辩现场可靠性）
                await send("error", {"message": f"无效参数: {e}"})
            except Exception as e:
                import traceback
                traceback.print_exc()
                await send("error", {"message": f"处理失败: {str(e)}"})

    except WebSocketDisconnect:
        pass


async def _handle_message(msg: dict, session: dict, send):
    """处理单条 WebSocket 消息。任何未捕获异常都会向上抛出（由外层转为 error 响应）。"""
    mtype = msg.get("type", "")
    orch = session["orch"]
    causal_steps = session["causal_steps"]
    previous_states = session["previous_states"]

    # ---- START SIMULATION ----
    if mtype == "start_simulation":
        scenario = msg.get("scenario", "")
        if not scenario:
            await send("error", {"message": "Missing scenario"})
            return

        await send("status", {"message": "正在生成因果链..."})
        orch, organ_agents = _create_orchestrator()
        session["orch"] = orch
        session["organ_agents"] = organ_agents
        orch.reset_all()
        session["previous_states"] = {}
        previous_states = session["previous_states"]

        # LLM 优先；无 Key/失败时自动回退本地确定性模板（答辩现场兜底）
        causal_steps, using_fallback = await orch.generate_causal_chain_safe(scenario)

        session["causal_steps"] = causal_steps
        if not causal_steps:
            await send("error", {"message": "无法生成因果链，请尝试其他场景"})
            return

        if using_fallback:
            await send("status", {"message": "⚠️ LLM 不可用，已使用内置教学模板演示"})
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

    # ---- CHAT BETWEEN STEPS ----
    elif mtype == "chat":
        if not orch:
            await send("error", {"message": "No active simulation"})
            return
        step_idx = msg.get("step", 0)
        reply = await orch.handle_chat(msg.get("message", ""), step_idx, causal_steps)
        await send("chat_reply", {"message": reply})

    # ---- ASK SPECIFIC ORGAN ----
    elif mtype == "ask_organ":
        if not orch:
            await send("error", {"message": "No active simulation"})
            return
        result = await orch.handle_organ_question(
            msg.get("organ_id", ""), msg.get("message", "")
        )
        await send("organ_reply", result)

    # ---- STEP CHANGED (user clicked next/prev) ----
    elif mtype == "step_changed":
        if not orch:
            await send("error", {"message": "No active simulation"})
            return
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
            return
        summary = await orch.generate_summary(causal_steps)
        await send("simulation_complete", {"summary": summary})

    # ============ 疾病模拟（MVP：状态演化引擎） ============

    # 获取疾病模板列表
    elif mtype == "list_diseases":
        await send("disease_list", {"diseases": list_diseases()})

    # 创建疾病模拟
    elif mtype == "create_disease_sim":
        disease_id = msg.get("disease_id", "acute_kidney_injury")
        if disease_id not in DISEASE_TEMPLATES:
            await send("error", {"message": f"未知疾病模板: {disease_id}"})
            return
        severity = msg.get("severity", "moderate")
        if severity not in DISEASE_TEMPLATES[disease_id]["severity"]:
            await send("error", {"message": f"未知严重程度: {severity}"})
            return
        try:
            time_step = float(msg.get("time_step_sec", 2.0))
        except (TypeError, ValueError):
            time_step = 2.0
        if not (0.5 <= time_step <= 10):
            time_step = 2.0
        engine = create_simulation(disease_id, severity, time_step)
        await send("sim_created", {
            "sim_id": engine.sim_id,
            "disease": DISEASE_TEMPLATES[disease_id]["name"],
            "severity": DISEASE_TEMPLATES[disease_id]["severity"][severity]["label"],
            "state": engine.store.snapshot(),
        })

    # 推进时间步（tick / 批量 run_to）
    elif mtype == "disease_tick":
        sim_id = msg.get("sim_id", "")
        engine = get_simulation(sim_id)
        if not engine:
            await send("error", {"message": "仿真不存在或已结束"})
            return
        try:
            steps = int(msg.get("steps", 1))
        except (TypeError, ValueError):
            steps = 1
        steps = max(1, min(steps, 100))  # 单次推进上限 100 步，防止误传超大值卡死
        before_step = engine.step
        results = engine.run_to_step(engine.step + steps)
        # 只返回本批次新增的警报（避免前端重复渲染历史警报）
        new_alerts = [a for a in engine.alerts if a["step"] > before_step]
        await send("disease_state", {
            "sim_id": sim_id,
            "steps": results,
            "total_steps": engine.step,
            "alerts": new_alerts,
        })

    # 治疗干预（教学型：如紧急透析）
    elif mtype == "disease_intervention":
        sim_id = msg.get("sim_id", "")
        engine = get_simulation(sim_id)
        if not engine:
            await send("error", {"message": "仿真不存在"})
            return
        iv_id = msg.get("intervention", "hemodialysis")
        ok = engine.apply_intervention(iv_id)
        if not ok:
            await send("error", {"message": f"未知干预类型: {iv_id}"})
            return
        await send("intervention_applied", {
            "sim_id": sim_id,
            "intervention": iv_id,
            "name": engine.INTERVENTIONS[iv_id]["name"],
            "state": engine.store.snapshot(),
            "events": engine.intervention_log[-10:],
        })

    # 查询当前状态（不推进）
    elif mtype == "disease_state":
        sim_id = msg.get("sim_id", "")
        engine = get_simulation(sim_id)
        if not engine:
            await send("error", {"message": "仿真不存在"})
            return
        await send("disease_state", {
            "sim_id": sim_id,
            "step": engine.step,
            "time": engine.time,
            "state": engine.store.snapshot(),
            "alerts": engine.alerts,
        })

    # 事件日志（追溯）
    elif mtype == "disease_log":
        sim_id = msg.get("sim_id", "")
        engine = get_simulation(sim_id)
        if not engine:
            await send("error", {"message": "仿真不存在"})
            return
        await send("disease_log", {
            "sim_id": sim_id,
            "events": engine.store.event_log[-50:],  # 最近 50 条
        })

    # ---- RESET ----
    elif mtype == "reset":
        if orch:
            orch.reset_all()
        session["causal_steps"] = []
        session["previous_states"] = {}
        agents = session["organ_agents"] or _get_organ_defs()
        for oid, agent in agents.items():
            await send("step_update", {
                "step": -1, "organ_id": oid,
                "state": agent.state.to_dict(),
            })
        await send("status", {"message": "已重置"})

    else:
        await send("error", {"message": f"Unknown: {mtype}"})


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
