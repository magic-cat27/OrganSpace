"""Orchestrator v2 — step-by-step causal chain + Q&A + organ perspective."""

import json
import asyncio
from models.graph import OrganGraph, ORGAN_IDS, ORGAN_NAMES


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

    def _parse_chain(self, text: str) -> list[dict]:
        try:
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            data = json.loads(text.strip())
            return data.get("steps", [])
        except (json.JSONDecodeError, IndexError):
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
        if step.get("indicators"):
            for key, val in step["indicators"].items():
                if isinstance(val, dict) and "value" in val and key in agent.state.indicators:
                    agent.state.indicators[key].value = float(val["value"])
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
