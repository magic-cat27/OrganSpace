"""Enhanced OrganAgent — LLM-powered organ with tools + independent perspective."""

import json
from models.state import OrganState, Indicator
from agents.tools import TOOL_REGISTRY


class OrganAgent:
    """An LLM-powered agent representing one physiological organ system.

    Capabilities:
    - update(): receive impact, adjust indicators via LLM + tools
    - ask(): answer user questions from this organ's perspective
    - run_tool(): execute precise medical calculations
    """

    organ_id: str = "base"
    organ_name: str = "Base"
    organ_name_en: str = "Base System"
    indicators_def: dict[str, dict] = {}
    system_prompt: str = ""

    def __init__(self, llm_client, model: str):
        self.llm = llm_client
        self.model = model
        self.tools = TOOL_REGISTRY.get(self.organ_id, [])
        self.state = OrganState(
            organ_id=self.organ_id,
            organ_name=self.organ_name,
            indicators=self._init_indicators(),
            overall_status="normal",
            narrative=f"{self.organ_name}功能正常。",
        )
        self.neighbors: list[dict] = []

    def _init_indicators(self) -> dict[str, Indicator]:
        result = {}
        for key, info in self.indicators_def.items():
            result[key] = Indicator(
                name=info["name"],
                value=info["normal_value"],
                unit=info.get("unit", ""),
                normal_min=info.get("normal_min", info["normal_value"] * 0.85),
                normal_max=info.get("normal_max", info["normal_value"] * 1.15),
                description=info.get("description", ""),
            )
        return result

    # ----- State Update -----

    def update(self, impact: str, neighbor_states: dict = None) -> dict:
        """Receive impact description, update indicators via LLM."""
        prompt = self._build_update_prompt(impact, neighbor_states)
        response = self.llm.chat(
            model=self.model, system=self.system_prompt,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024, temperature=0.3,
        )
        self._parse_response(response)

        # Run relevant tools for precision
        self._apply_tools()

        return self.state.to_dict()

    def _apply_tools(self):
        """Run applicable tools to refine indicator values."""
        indicators = self.state.indicators

        for func, name, _desc in self.tools:
            try:
                if name == "calculate_map":
                    if "nibp_systolic" in indicators and "nibp_diastolic" in indicators:
                        from agents.tools import calculate_map
                        map_val = calculate_map(
                            indicators["nibp_systolic"].value,
                            indicators["nibp_diastolic"].value,
                        )
                        # Store MAP in the state narrative but don't override existing indicators
                        self.state.narrative += f" | MAP={map_val}mmHg"

                elif name == "calculate_egfr":
                    if "creatinine" in indicators:
                        from agents.tools import calculate_egfr
                        egfr = calculate_egfr(indicators["creatinine"].value, age=60)
                        if "gfr" in indicators:
                            indicators["gfr"].value = egfr

                elif name == "calculate_anion_gap":
                    if all(k in indicators for k in ["sodium", "potassium"]):
                        pass  # Would need HCO3 too

                elif name == "calculate_nlr":
                    if "wbc" in indicators:
                        pass

                elif name == "calculate_pf_ratio":
                    if "po2" in indicators:
                        from agents.tools import calculate_pf_ratio
                        pf = calculate_pf_ratio(indicators["po2"].value)
                        self.state.narrative += f" | P/F={pf}"

            except Exception:
                pass  # Tool failure shouldn't break the simulation

    def _build_update_prompt(self, impact: str, neighbor_states: dict = None) -> str:
        current = json.dumps(
            {k: v.to_dict() for k, v in self.state.indicators.items()},
            ensure_ascii=False, indent=2,
        )
        neighbor_str = ""
        if neighbor_states:
            neighbor_str = "\n## 关联器官状态\n" + "\n".join(
                f"- {oid}: {s.get('overall_status', '?')}"
                for oid, s in neighbor_states.items() if isinstance(s, dict)
            )

        tool_list = "\n".join(f"- `{name}`: {desc}" for _, name, desc in self.tools) if self.tools else "无"

        return f"""## 当前指标
```json
{current}
```

## 外部影响
{impact}
{neighbor_str}

## 可用计算工具
{tool_list}

请更新指标，返回严格JSON（不要其他文字）：
```json
{{"indicators": {{"key": value, ...}}, "overall_status": "normal|stressed|impaired|failing", "explanation": "中文解释(100字内)"}}
```"""

    def _parse_response(self, text: str) -> None:
        try:
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            data = json.loads(text.strip())
        except (json.JSONDecodeError, IndexError):
            import re
            match = re.search(r'\{.*\}', text, re.DOTALL)
            data = json.loads(match.group()) if match else {}
            if not data:
                return

        if "indicators" in data:
            for key, value in data["indicators"].items():
                if key in self.state.indicators:
                    self.state.indicators[key].value = float(value)

        valid = {"normal", "stressed", "impaired", "failing"}
        if data.get("overall_status") in valid:
            self.state.overall_status = data["overall_status"]

        if "explanation" in data:
            self.state.narrative = data["explanation"]

    # ----- Independent Perspective (ask) -----

    def ask(self, question: str, context: str = "") -> str:
        """Answer user question from this organ's first-person perspective."""
        indicators_str = "\n".join(
            f"- {v.name}: {v.value} {v.unit} (正常: {v.normal_min}-{v.normal_max}, {v.status})"
            for v in self.state.indicators.values()
        )

        prompt = f"""用户对{self.organ_name}提出了一个问题。

## {self.organ_name}当前状态
{indicators_str}
整体状态: {self.state.overall_status}
描述: {self.state.narrative}

## 场景上下文
{context}

## 用户问题
{question}

请以{self.organ_name}的"第一人称"视角回答。就像这个器官在说话。用通俗易懂的中文解释，帮助用户理解这个器官正在经历什么、为什么会这样、以及它如何与其他器官互动。控制在200字以内。"""

        return self.llm.chat(
            model=self.model,
            system=f"你是人体{self.organ_name}的化身。你用第一人称\"我\"来回答关于自己状态的问题，像一个有自我意识的器官在说话。你既是专业的生理学专家，又善于用通俗比喻帮助理解。",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512, temperature=0.6,
        )

    # ----- Utility -----

    def run_tool(self, tool_name: str, **kwargs):
        """Execute a specific tool by name."""
        for func, name, _desc in self.tools:
            if name == tool_name:
                return func(**kwargs)
        raise ValueError(f"Tool '{tool_name}' not found for {self.organ_id}")

    def get_tool_descriptions(self) -> list[str]:
        """Return list of tool descriptions for the LLM prompt."""
        return [f"{name}: {desc}" for _, name, desc in self.tools]

    def set_neighbors(self, neighbors: list[dict]) -> None:
        self.neighbors = neighbors

    def reset(self) -> None:
        self.state = OrganState(
            organ_id=self.organ_id, organ_name=self.organ_name,
            indicators=self._init_indicators(),
            overall_status="normal",
            narrative=f"{self.organ_name}功能正常。",
        )
