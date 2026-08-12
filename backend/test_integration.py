"""LLM 集成测试（需要有效 API Key）—— 标注为旧版接口已迁移。

⚠️ 本测试依赖外部大模型 API，网络/Key 不可用时无法通过。
✅ 无 LLM 依赖的确定性测试请运行：python test_disease_engine.py

接口迁移说明（2026-08）：
  旧接口 orch.simulate(...) 已废弃，协调器现在使用：
    - orch.generate_causal_chain(scenario)   # 生成因果链
    - orch.execute_step(step, prev_states)   # 执行单步
    - orch.handle_chat(msg, step_idx, steps) # 步骤间问答
    - orch.handle_organ_question(...)        # 指定器官问答
    - orch.generate_summary(steps)           # 总结
"""

import os, sys, asyncio

# Clear any socks proxy
for var in list(os.environ.keys()):
    if 'proxy' in var.lower():
        val = os.getenv(var, '')
        if 'socks' in val.lower():
            del os.environ[var]

sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from config import DEEPSEEK_API_KEY, LLM_MODEL
from llm import LLMClient
from models.graph import OrganGraph
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


def build_orchestrator():
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY 未配置，无法运行 LLM 集成测试。")
    llm = LLMClient(provider='deepseek', api_key=DEEPSEEK_API_KEY)
    graph = OrganGraph()
    agent_classes = [
        CardiovascularAgent, RespiratoryAgent, RenalAgent,
        HepaticAgent, ImmuneAgent, NervousAgent,
        BloodAgent, CoagulationAgent, MetabolicAgent,
    ]
    agents = {}
    for cls in agent_classes:
        a = cls(llm, LLM_MODEL)
        a.set_neighbors(graph.get_neighbors(a.organ_id))
        agents[a.organ_id] = a
    return Orchestrator(llm, LLM_MODEL, agents, graph), agents


async def main():
    print("=" * 60)
    print("LLM 集成测试：急性心肌梗死，患者胸痛伴大汗")
    print("=" * 60)
    orch, _ = build_orchestrator()
    orch.reset_all()
    steps = await orch.generate_causal_chain("急性心肌梗死，患者胸痛伴大汗")
    print(f"\n因果链（{len(steps)} 步）：")
    for i, s in enumerate(steps):
        print(f"  {i}. [{s.get('organ_name', s.get('organ_id'))}] {s.get('explanation', '')[:60]}")
    if not steps:
        print("✗ 未能生成因果链")
        return 1

    # 执行前两步验证状态推演
    prev = {}
    for i in range(min(2, len(steps))):
        state = await orch.execute_step(steps[i], prev)
        prev[steps[i]["organ_id"]] = state
        print(f"  执行步骤 {i} → {state.get('overall_status')}")

    summary = await orch.generate_summary(steps)
    print(f"\n总结：{summary[:100]}...")
    print("\n✓ LLM 全链路（生成因果链 → 执行步骤 → 总结）工作正常！")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
