"""
疾病模拟引擎 — 混合多 Agent 架构的「调度器 + 校验器」（重构图）

设计依据：优化意见书（混合多 Agent 架构改造）
核心思想：
  疾病控制器（只注入扰动）
    → BodyStateStore 快照
    → 确定性器官 Agent 独立提出状态提案（肾 → 血液 → 心血管）
    → 调度器汇总、解决冲突、统一提交
    → 生理校验器检查边界并触发警报
    → 前端实时展示 + Agent 执行轨迹

本文件中的 PhysiologyEngine 已从「集中式规则引擎」缩减为：
  - 时间调度器（分阶段时间步）
  - 提案汇总与冲突解决器
  - 生理校验器（边界 + 警报）
  - 干预管理器（保护期 + 持续清除）
所有器官响应公式移入 simulation/physio_agents.py 的确定性 Agent 中。
"""

import uuid
import time
from typing import Dict, Any, List, Optional

from simulation.physio_agents import (
    DiseaseController,
    StateProposal,
    create_physio_agents,
    AGENT_ORDER,
    AGENT_LABELS,
    clamp,
    get_path,
)


# ==================== 内环境状态仓库 ====================
class BodyStateStore:
    """统一状态存储，器官通过快照读取，通过提案提交变化（状态所有权分层）。"""

    def __init__(self, template: str = "healthy_adult"):
        base = BODY_TEMPLATES.get(template, BODY_TEMPLATES["healthy_adult"])
        # 深拷贝，避免多仿真共享引用
        self.state = _deepcopy(base)
        self.event_log: List[Dict[str, Any]] = []

    def snapshot(self) -> Dict[str, Any]:
        return _deepcopy(self.state)

    def commit(self, path: str, value: Any, source: str):
        keys = path.split(".")
        node = self.state
        for k in keys[:-1]:
            node = node.setdefault(k, {})
        old = node.get(keys[-1])
        node[keys[-1]] = value
        self.log("STATE_CHANGED", {"path": path, "old": old, "new": value, "source": source})

    def log(self, type_: str, payload: Dict[str, Any]):
        self.event_log.append({"type": type_, "payload": payload, "t": time.time()})


def _deepcopy(d):
    if isinstance(d, dict):
        return {k: _deepcopy(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_deepcopy(i) for i in d]
    return d


# ==================== 人体模板 ====================
BODY_TEMPLATES = {
    "healthy_adult": {
        "blood": {
            "systemic": {
                "glucose": 90, "insulin": 8, "creatinine": 1.0, "bun": 14,
                "potassium": 4.0, "sodium": 140, "chloride": 104, "hco3": 24,
                "calcium": 9.5, "ph": 7.40, "map": 85,
            },
        },
        "organs": {
            "kidney": {"egfr": 100, "urine_output": 100, "fe_na": 0.5, "perfusion": 100},
            "heart": {"cardiac_output": 5.0, "stroke_volume": 70, "heart_rate": 72,
                      "arrhythmia_risk": 0.05},
            "liver": {"albumin": 4.0, "bilirubin": 1.0},
            "lung": {"pao2": 95, "pfr": 450},
        },
        "signals": {"autonomic": {"sympathetic": 0.3, "parasympathetic": 0.7}},
    },
}


# ==================== 疾病模板（结构化扰动） ====================
DISEASE_TEMPLATES = {
    "acute_kidney_injury": {
        "name": "急性肾损伤",
        "description": "eGFR 骤降导致清除能力下降 → 肌酐/尿素氮/钾潴留、尿量减少、代谢性酸中毒",
        "severity": {
            "mild": {"egfr_target": 60, "label": "轻度"},
            "moderate": {"egfr_target": 35, "label": "中度"},
            "severe": {"egfr_target": 15, "label": "重度"},
        },
    },
}


# ==================== 生理引擎（调度器 + 校验器） ====================
class PhysiologyEngine:
    """混合多 Agent 调度器：推进时间步，协调确定性器官 Agent 提案并统一提交。"""

    # 干预类型注册（教学型）
    INTERVENTIONS = {
        "hemodialysis": {
            "name": "紧急透析",
            "description": "血液透析清除代谢废物：血钾/肌酐/尿素氮下降，HCO3 上升，pH 改善",
            "effects": {
                "blood.systemic.potassium": -1.8,
                "blood.systemic.creatinine": -1.2,
                "blood.systemic.bun": -6.0,
                "blood.systemic.hco3": +4.0,
            },
        },
    }

    def __init__(self, store: BodyStateStore, disease_id: str, severity: str = "moderate", time_step_sec: float = 2.0):
        self.store = store
        self.disease = DISEASE_TEMPLATES[disease_id]
        self.severity = self.disease["severity"].get(severity, self.disease["severity"]["moderate"])
        self.dt = time_step_sec
        self.time = 0.0
        self.step = 0
        self.sim_id = uuid.uuid4().hex[:8]
        self.alerts: List[Dict[str, Any]] = []
        self.intervention_log: List[Dict[str, Any]] = []
        self.intervention_boost = None  # 干预持续效果：{"remaining": n, "deltas": {path: per_step}}
        self._intervention_pause = 0    # 干预保护期（步数）：期间疾病恶化暂缓

        # 混合多 Agent 组件
        self.controller = DiseaseController(disease_id, self.severity)
        self.agents = create_physio_agents()          # 确定性器官 Agent（肾/血液/心血管）
        self.trace_log: List[Dict[str, Any]] = []     # Agent 执行轨迹（最近 MAX_TRACE_STEPS 步）
        self._trace_max = 30

    # ---- 状态读写（调度器统一提交用） ----
    def _get(self, path: str):
        return get_path(self.store.state, path)

    def _set(self, path: str, value):
        keys = path.split(".")
        node = self.store.state
        for k in keys[:-1]:
            node = node.setdefault(k, {})
        node[keys[-1]] = value

    # ---- 调度器：冲突解决 ----
    def _resolve_conflicts(self, proposals: List[StateProposal]) -> List[StateProposal]:
        """同一目标路径若出现多个提案，按 (priority, Agent 传播顺序) 取最优。

        当前三个 Agent 状态所有权互不重叠，该逻辑主要用于架构完整性。
        """
        order = {oid: i for i, oid in enumerate(AGENT_ORDER)}
        best: Dict[str, StateProposal] = {}
        for p in proposals:
            cur = best.get(p.target_path)
            if cur is None:
                best[p.target_path] = p
                continue
            cur_key = (cur.priority, order.get(cur.source_agent, 99))
            new_key = (p.priority, order.get(p.source_agent, 99))
            if new_key > cur_key:
                best[p.target_path] = p
        return list(best.values())

    # ---- 分阶段时间步 ----
    def tick(self) -> Dict[str, Any]:
        self.time += self.dt
        self.step += 1

        # 阶段 1-2：读取快照 + 疾病控制器产生外部扰动
        snapshot = self.store.snapshot()
        disease_event = self.controller.perturb(snapshot, self.dt)

        # 阶段 3：各器官 Agent 生成状态提案（按传播顺序，保护期内血液/心血管维持改善）
        proposals: List[StateProposal] = []
        if self._intervention_pause > 0:
            # 保护期：只让肾脏 Agent 继续推进 eGFR，血液/心血管暂缓（维持干预后改善）
            proposals += self.agents["renal"].propose(snapshot, disease_event, self.dt)
            self._intervention_pause -= 1
        else:
            proposals += self.agents["renal"].propose(snapshot, disease_event, self.dt)
            proposals += self.agents["blood"].propose(snapshot, disease_event, self.dt)
            proposals += self.agents["cardiovascular"].propose(snapshot, disease_event, self.dt)

        # 阶段 4：调度器解决依赖与冲突
        resolved = self._resolve_conflicts(proposals)

        # 阶段 5：统一提交 + 记录 Agent 执行轨迹
        trace_entries = []
        for p in resolved:
            old = self._get(p.target_path)
            self._set(p.target_path, p.value)
            trace_entries.append({
                "agent": p.source_agent,
                "agent_label": AGENT_LABELS.get(p.source_agent, p.source_agent),
                "path": p.target_path,
                "old": _fmt(old),
                "new": _fmt(p.value),
                "reason": p.reason,
            })
        # 干预持续清除效果（透析半衰期模拟）
        self._apply_intervention_boost()
        self.trace_log.append({"step": self.step, "time": round(self.time, 1), "entries": trace_entries})
        if len(self.trace_log) > self._trace_max:
            self.trace_log = self.trace_log[-self._trace_max:]

        # 阶段 6：生理校验与风险警报
        self._validate()

        return {
            "simId": self.sim_id,
            "step": self.step,
            "time": round(self.time, 1),
            "state": self.store.snapshot(),
            "alerts": [a for a in self.alerts if a["step"] == self.step],
            "traces": trace_entries,   # 本步 Agent 执行轨迹
        }

    def _apply_intervention_boost(self):
        """干预持续效果：后续数步内逐步清除代谢废物，模拟透析清除的半衰期。"""
        if not self.intervention_boost:
            return
        b = self.intervention_boost
        for path, step_delta in b["deltas"].items():
            node = self.store.state
            keys = path.split(".")
            for k in keys[:-1]:
                node = node.setdefault(k, {})
            node[keys[-1]] = max(0.1, node.get(keys[-1], 0) + step_delta)
        b["remaining"] -= 1
        if b["remaining"] <= 0:
            self.intervention_boost = None

    # ---- 生理校验（边界 + 警报） ----
    def _validate(self):
        s = self.store.state
        # 浓度不得为负
        for path in ["blood.systemic.creatinine", "blood.systemic.bun",
                     "blood.systemic.potassium", "blood.systemic.hco3"]:
            v = self._get(path)
            if v is not None and v < 0:
                self._set(path, 0)
        # 警报
        if s["blood"]["systemic"]["potassium"] >= 6.0 and not self._alerted("hyperkalemia"):
            self._push_alert("hyperkalemia", f"⚠️ 高钾血症：K⁺ {s['blood']['systemic']['potassium']:.1f} mmol/L（≥6.0 危险）")
        if s["blood"]["systemic"]["ph"] <= 7.30 and not self._alerted("acidosis"):
            self._push_alert("acidosis", f"⚠️ 代谢性酸中毒：pH {s['blood']['systemic']['ph']:.2f}（≤7.30）")
        if s["organs"]["kidney"]["egfr"] <= 15 and not self._alerted("renal_failure"):
            self._push_alert("renal_failure", f"🚨 肾衰竭：eGFR {s['organs']['kidney']['egfr']:.0f} mL/min（≤15）")

    def _alerted(self, key: str) -> bool:
        return any(a["key"] == key for a in self.alerts)

    def _push_alert(self, key: str, message: str):
        self.alerts.append({"key": key, "message": message, "step": self.step})
        self.store.log("PHYSIOLOGICAL_ALERT", {"key": key, "message": message})

    # ---- 治疗干预（教学型，非临床建议） ----
    def apply_intervention(self, intervention_id: str) -> bool:
        """应用治疗干预（教学型调整）。返回是否被接受。"""
        spec = self.INTERVENTIONS.get(intervention_id)
        if not spec:
            return False

        s = self.store.state
        # 1. 一次性效果
        for path, delta in spec["effects"].items():
            node = s
            keys = path.split(".")
            for k in keys[:-1]:
                node = node.setdefault(k, {})
            node[keys[-1]] = max(0.1, node.get(keys[-1], 0) + delta)

        # 2. pH 随 HCO3 改善（碳酸氢根每升 1 → pH 约升 0.01）
        hco3 = s["blood"]["systemic"]["hco3"]
        self._set("blood.systemic.ph", clamp(7.40 - (24 - hco3) * 0.01, 7.10, 7.40))

        # 3. 交感代偿回落（干预后应激略缓解）
        drop = (100.0 - s["organs"]["kidney"]["egfr"]) / 100.0
        self._set("signals.autonomic.sympathetic", clamp(0.3 + drop * 0.6, 0.3, 0.9))
        sym = s["signals"]["autonomic"]["sympathetic"]
        self._set("blood.systemic.map", clamp(85 + (sym - 0.3) * 40, 70, 130))

        # 4. 干预保护期：后续 12 步内疾病恶化暂缓，指标维持改善后反弹（教学叙事）
        self._intervention_pause = 12

        # 5. 记录治疗事件 + 设置持续清除效果（保护期内每步小幅清除，模拟透析清除半衰期）
        self.intervention_boost = {
            "remaining": 10,
            "total": 10,
            "deltas": {
                "blood.systemic.potassium": -0.08,   # 10 步累计 -0.8
                "blood.systemic.creatinine": -0.06,  # 10 步累计 -0.6
                "blood.systemic.bun": -0.4,          # 10 步累计 -4
            },
        }
        self.intervention_log.append({
            "type": intervention_id,
            "name": spec["name"],
            "description": spec["description"],
            "step": self.step,
            "time": round(self.time, 1),
        })
        self.store.log("INTERVENTION", {"type": intervention_id, "name": spec["name"]})
        return True

    def run_to_step(self, target_step: int) -> List[Dict[str, Any]]:
        results = []
        while self.step < target_step:
            results.append(self.tick())
        return results

    def recent_traces(self, n: int = 5) -> List[Dict[str, Any]]:
        """返回最近 n 步的 Agent 执行轨迹（供前端面板）。"""
        return self.trace_log[-n:]


def _fmt(v) -> Any:
    """轨迹值格式化：float 保留 2 位，其余原样。"""
    if isinstance(v, float):
        return round(v, 2)
    return v


# ==================== 仿真会话管理 ====================
simulations: Dict[str, PhysiologyEngine] = {}
MAX_SIMULATIONS = 50  # 防止长时间演示反复创建仿真导致内存无限增长

def create_simulation(disease_id: str, severity: str = "moderate", time_step_sec: float = 2.0) -> PhysiologyEngine:
    store = BodyStateStore("healthy_adult")
    engine = PhysiologyEngine(store, disease_id, severity, time_step_sec)
    simulations[engine.sim_id] = engine
    _trim_simulations()
    return engine

def _trim_simulations():
    """超限时淘汰最早的仿真，避免内存泄漏（按创建时间排序）。"""
    if len(simulations) <= MAX_SIMULATIONS:
        return
    # dict 保持插入顺序，淘汰最旧的
    for key in list(simulations.keys())[: len(simulations) - MAX_SIMULATIONS]:
        del simulations[key]

def get_simulation(sim_id: str) -> Optional[PhysiologyEngine]:
    return simulations.get(sim_id)

def list_diseases() -> List[Dict[str, Any]]:
    return [
        {
            "id": k,
            "name": v["name"],
            "description": v["description"],
            "severity": v["severity"],
        }
        for k, v in DISEASE_TEMPLATES.items()
    ]
