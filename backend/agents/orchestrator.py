"""Orchestrator v2 — step-by-step causal chain + Q&A + organ perspective."""

import json
import asyncio
from models.graph import OrganGraph, ORGAN_IDS, ORGAN_NAMES

# ===== 本地模板因果链（无 API Key / LLM 失败时回退） =====
# 保证答辩现场即使 Key 失效或断网，因果链演示模式仍可运行（确定性模板，结果稳定）。
FALLBACK_CHAINS = [
    {
        "keywords": ["心肌梗死", "心梗", "胸痛", "冠心病"],
        "scenario_name": "急性心肌梗死",
        "steps": [
            {"step": 1, "organ_id": "cardiovascular", "organ_name": "心血管系统",
             "status": "impaired",
             "explanation": "冠状动脉阻塞导致心肌缺血，心脏泵血能力下降，心输出量降低。",
             "indicators": {"heart_rate": {"value": 105, "status": "high"},
                            "nibp_systolic": {"value": 95, "status": "low"}}},
            {"step": 2, "organ_id": "respiratory", "organ_name": "呼吸系统",
             "status": "stressed",
             "explanation": "心输出量下降导致肺循环淤血与氧合效率降低，出现呼吸代偿。",
             "indicators": {"respiratory_rate": {"value": 24, "status": "high"},
                            "pao2": {"value": 80, "status": "low"}}},
            {"step": 3, "organ_id": "renal", "organ_name": "肾脏",
             "status": "stressed",
             "explanation": "肾灌注压下降激活肾素-血管紧张素系统，肾功能代偿性应激。",
             "indicators": {"egfr": {"value": 75, "status": "low"},
                            "urine_output": {"value": 70, "status": "low"}}},
            {"step": 4, "organ_id": "metabolic", "organ_name": "代谢系统",
             "status": "stressed",
             "explanation": "组织灌注不足引发无氧代谢，乳酸升高，代偿性应激状态。",
             "indicators": {"lactate": {"value": 2.8, "status": "high"}}},
        ],
    },
    {
        "keywords": ["吸烟", "吸烟30年", "肺"],
        "scenario_name": "长期吸烟",
        "steps": [
            {"step": 1, "organ_id": "respiratory", "organ_name": "呼吸系统",
             "status": "impaired",
             "explanation": "长期吸烟导致气道慢性炎症与肺泡结构破坏，肺功能进行性下降。",
             "indicators": {"respiratory_rate": {"value": 20, "status": "high"},
                            "pao2": {"value": 78, "status": "low"}}},
            {"step": 2, "organ_id": "cardiovascular", "organ_name": "心血管系统",
             "status": "stressed",
             "explanation": "缺氧加重心脏负荷，尼古丁导致血管收缩与血压升高。",
             "indicators": {"heart_rate": {"value": 92, "status": "high"},
                            "nibp_systolic": {"value": 135, "status": "high"}}},
            {"step": 3, "organ_id": "renal", "organ_name": "肾脏",
             "status": "stressed",
             "explanation": "慢性缺氧与高血压对肾血管造成持续压力，肾功能代偿性应激。",
             "indicators": {"egfr": {"value": 82, "status": "low"}}},
        ],
    },
    {
        "keywords": ["脱水", "严重脱水"],
        "scenario_name": "严重脱水",
        "steps": [
            {"step": 1, "organ_id": "renal", "organ_name": "肾脏",
             "status": "impaired",
             "explanation": "循环血量减少导致肾灌注下降，肾小球滤过率降低，尿液浓缩。",
             "indicators": {"egfr": {"value": 65, "status": "low"},
                            "urine_output": {"value": 30, "status": "low"}}},
            {"step": 2, "organ_id": "cardiovascular", "organ_name": "心血管系统",
             "status": "stressed",
             "explanation": "血容量不足触发交感代偿，心率加快、外周血管收缩以维持血压。",
             "indicators": {"heart_rate": {"value": 110, "status": "high"},
                            "nibp_systolic": {"value": 90, "status": "low"}}},
            {"step": 3, "organ_id": "blood", "organ_name": "血液",
             "status": "stressed",
             "explanation": "血液浓缩导致血细胞比容与电解质浓度相对升高。",
             "indicators": {"sodium": {"value": 148, "status": "high"}}},
        ],
    },
]


def find_fallback_chain(scenario: str) -> list[dict]:
    """按关键词匹配本地模板因果链；无匹配返回空列表。"""
    for chain in FALLBACK_CHAINS:
        if any(kw in scenario for kw in chain["keywords"]):
            return [dict(step) for step in chain["steps"]]
    return []


class Orchestrator:
    """Main agent: generates causal chain, executes steps, handles Q&A."""

    def __init__(self, llm_client, model: str, organ_agents: dict, graph: OrganGraph):
        self.llm = llm_client
        self.model = model
        self.organ_agents = organ_agents
        self.graph = graph
        self._scenario_context = ""

    # ===== Causal Chain Generation =====

    async def generate_causal_chain(self, user_input: str) -> list[dict]:
        """Generate a step-by-step causal chain from user scenario.

        Returns list of {step, organ_id, organ_name, status, explanation, indicators: {...}}
        One LLM call generates all steps at once.
        """
        self._scenario_context = user_input

        organ_list = "\n".join(
            f"- {oid} ({ORGAN_NAMES[oid]}): 主要指标={list(agent.indicators_def.keys())}"
            for oid, agent in self.organ_agents.items()
        )

        prompt = f"""你是一位临床生理学教育专家。用户描述了一个医学场景，你需要生成一个**逐步推演**的因果链，展示"牵一发而动全身"的效果。

## 可用器官系统
{organ_list}

## 器官连接关系
{json.dumps(self.graph.connections, ensure_ascii=False)}

## 用户场景
{user_input}

请生成一个逐步推演的因果链。从最直接受影响的器官开始，每步一个器官，展示病变如何在器官系统间传播。

返回严格JSON（不要其他文字）：
```json
{{
  "scenario_name": "场景名称（10字内）",
  "severity": "mild|moderate|severe|critical",
  "steps": [
    {{
      "step": 1,
      "organ_id": "cardiovascular",
      "organ_name": "心血管系统",
      "status": "stressed|impaired|failing",
      "explanation": "这一步发生了什么，为什么这个器官会受影响（教学语言，150字内）",
      "indicators": {{
        "heart_rate": {{"value": 95, "status": "high"}},
        "nibp_systolic": {{"value": 145, "status": "high"}}
      }}
    }},
    ...
  ]
}}
```

规则：
1. 步骤数3-6步，覆盖主要受影响器官
2. 每步精确改变该器官的2-5个关键指标（根据indicators_def选择）
3. 指标值变化幅度合理（通常不超过正常值±30%）
4. explanation要面向医学生教学，解释因果机制
5. 步骤顺序反映真实的病理生理传播路径
6. severity影响所有步骤的严重程度"""

        text = await self.llm.chat_async(
            model=self.model,
            system="你是一位临床医学教育专家，擅长将复杂病理生理过程拆解为清晰的因果链。严格按JSON格式输出。",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048, temperature=0.3,
        )

        return self._parse_chain(text)

    async def generate_causal_chain_with_fallback(self, user_input: str) -> list[dict]:
        """生成因果链；LLM 不可用（无 Key/超时/网络失败/解析失败）时回退到本地模板。

        保证答辩现场因果链模式不因外部依赖失效而报错。
        """
        self._scenario_context = user_input
        try:
            chain = await self.generate_causal_chain(user_input)
            if chain:
                return chain
        except Exception:
            pass
        # 回退：本地确定性模板
        return find_fallback_chain(user_input)

    async def generate_causal_chain_safe(self, user_input: str):
        """返回 (因果链, 是否使用了本地模板回退)。"""
        self._scenario_context = user_input
        try:
            chain = await self.generate_causal_chain(user_input)
            if chain:
                return chain, False
        except Exception:
            pass
        return find_fallback_chain(user_input), True

    def _parse_chain(self, text: str) -> list[dict]:
        """解析 LLM 返回的因果链。任何异常/非预期结构都返回空列表（由上层提示重试）。"""
        try:
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            data = json.loads(text.strip())
            steps = data.get("steps", [])
            # LLM 偶尔返回 dict 或 null，防御性校验
            if not isinstance(steps, list):
                return []
            # 清洗：丢弃缺 organ_id 的脏步骤，保证前端渲染安全
            clean = []
            for s in steps:
                if isinstance(s, dict) and s.get("organ_id"):
                    clean.append(s)
            return clean
        except (json.JSONDecodeError, IndexError, AttributeError):
            return []

    # ===== Step Execution =====

    async def execute_step(self, step: dict, previous_states: dict) -> dict:
        """Execute one causal chain step — update the affected organ agent.

        Returns the organ's updated state dict.
        """
        organ_id = step["organ_id"]
        agent = self.organ_agents.get(organ_id)
        if not agent:
            return {}

        # Gather neighbor states
        neighbor_states = {}
        for nb in self.graph.get_neighbors(organ_id):
            oid = nb["organ"]
            if oid in previous_states:
                neighbor_states[oid] = previous_states[oid]

        # Run update in thread
        await asyncio.to_thread(
            agent.update, step["explanation"], neighbor_states
        )

        # Merge LLM output with the step's pre-defined indicator template
        state = agent.state.to_dict()
        # Override with step's explicitly set indicators if available
        # （值解析失败时跳过该指标，不让单个脏值破坏整步执行）
        if step.get("indicators"):
            for key, val in step["indicators"].items():
                try:
                    if isinstance(val, dict) and "value" in val and key in agent.state.indicators:
                        agent.state.indicators[key].value = float(val["value"])
                except (TypeError, ValueError):
                    continue
            state = agent.state.to_dict()

        return state

    # ===== Chat / Q&A =====

    async def handle_chat(self, message: str, step_idx: int, steps: list) -> str:
        """Handle general chat between steps."""
        if step_idx >= len(steps):
            step_info = "所有步骤已完成"
        else:
            step = steps[step_idx]
            step_info = f"当前步骤: 第{step['step']}步 - {step['organ_name']} - {step.get('explanation', '')}"

        prompt = f"""用户正在学习一个人体器官模拟场景，现在处于某一步骤之间，提出了问题。

## 场景
{self._scenario_context}

## {step_info}

## 用户问题
{message}

请用教学口吻回答，帮助用户理解相关的生理病理机制。控制在200字以内。"""

        return await self.llm.chat_async(
            model=self.model,
            system="你是一位耐心的临床医学教育专家。用通俗易懂的语言解释复杂的医学概念，善用比喻。",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512, temperature=0.5,
        )

    async def handle_organ_question(self, organ_id: str, message: str) -> dict:
        """Forward a user question to a specific organ agent.

        Returns {organ_name, reply}.
        """
        agent = self.organ_agents.get(organ_id)
        if not agent:
            return {"organ_name": organ_id, "reply": "该器官系统暂不可用。"}

        reply = await asyncio.to_thread(
            agent.ask, message, self._scenario_context
        )
        return {"organ_name": agent.organ_name, "reply": reply}

    # ===== Summary =====

    async def generate_summary(self, steps: list) -> str:
        """Generate final summary after all steps completed."""
        steps_str = json.dumps(steps, ensure_ascii=False, indent=2)

        prompt = f"""模拟已完成。请基于以下步骤生成一个教学总结。

## 场景
{self._scenario_context}

## 因果链步骤
```json
{steps_str}
```

请写一个总结（250字以内），包括：
1. 这个场景的核心病理机制
2. 器官系统间的因果传播路径
3. 关键的生理指标变化
4. 一句话总结"牵一发而动全身"的启示

语言通俗易懂，面向医学生。"""

        return await self.llm.chat_async(
            model=self.model,
            system="你是一位临床医学教育专家，擅长总结归纳。",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800, temperature=0.5,
        )

    def reset_all(self) -> None:
        for agent in self.organ_agents.values():
            agent.reset()
        self._scenario_context = ""
