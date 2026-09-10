"""
确定性生理器官 Agent（PhysioAgents）— 混合多 Agent 架构的核心。

设计（依据优化意见书）：
  疾病控制器只注入原始病理扰动；
  每个器官 Agent 独立读取全局快照，提出本器官状态所有权内的变更提案；
  调度器（PhysiologyEngine）汇总、解决冲突、统一提交；
  生理校验器检查数值边界并触发警报。

原则：
  - Agent 可以读取全局快照，但只能直接写入自己负责的状态（状态所有权）；
  - 所有公式为确定性机制，LLM 不参与任何数值决策（LLM 只负责解释层）；
  - 每个提案携带 reason，用于前端「Agent 执行轨迹」面板。
"""

from dataclasses import dataclass
from typing import Dict, Any, List

from agents.tools import calculate_anion_gap, calculate_osmolality


def clamp(v: float, mn: float, mx: float) -> float:
    return max(mn, min(mx, v))


def get_path(snapshot: Dict[str, Any], path: str):
    node = snapshot
    for k in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(k)
        if node is None:
            return None
    return node


@dataclass
class StateProposal:
    """器官 Agent 提出的状态变更提案。"""
    source_agent: str      # 提案来源 Agent id（renal/blood/cardiovascular）
    target_path: str       # 目标状态路径，如 "organs.kidney.egfr"
    value: float           # 提案值
    reason: str            # 教学理由（前端轨迹面板展示）
    priority: int = 0      # 冲突解决优先级（数值大者优先）


# ==================== 疾病控制器 ====================

class DiseaseController:
    """只描述疾病起点与持续扰动，不直接计算任何器官指标。"""

    def __init__(self, disease_id: str, severity: dict):
        self.disease_id = disease_id
        self.severity = severity

    def perturb(self, snapshot: Dict[str, Any], dt: float) -> Dict[str, Any]:
        """返回当前疾病对环境的扰动描述（供各 Agent 读取，不写状态）。"""
        return {
            "disease_id": self.disease_id,
            "active": True,
            "egfr_target": self.severity.get("egfr_target", 60),
            "dt": dt,
        }


# ==================== 肾脏 Agent ====================

class RenalPhysiologyAgent:
    """肾脏 Agent — 状态所有权：eGFR、尿量、肾灌注。

    读取：疾病扰动（egfr_target）、当前肾功能
    写入：organs.kidney.{egfr, urine_output, perfusion}
    """

    agent_id = "renal"
    label = "肾脏 Agent"
    owned_paths = [
        "organs.kidney.egfr",
        "organs.kidney.urine_output",
        "organs.kidney.perfusion",
    ]

    def propose(self, snapshot: Dict[str, Any], disease_event: Dict[str, Any], dt: float) -> List[StateProposal]:
        egfr0 = 100.0
        egfr = get_path(snapshot, "organs.kidney.egfr") or egfr0
        target = disease_event.get("egfr_target", 60)

        # 1. eGFR 指数衰减向疾病目标（达到后稳定，保证阈值警报可触发）
        new_egfr = egfr + (target - egfr) * (1 - pow(2.718281828, -dt / 32.0))
        if abs(new_egfr - target) < 0.5:
            new_egfr = target
        new_egfr = clamp(new_egfr, 5, 100)

        # 2. 尿量 / 灌注随 eGFR（用新 eGFR，体现本 Agent 内部先算后依赖）
        urine = clamp(100 * new_egfr / egfr0, 0, 120)
        perfusion = clamp(100 * new_egfr / egfr0 * 0.9, 0, 100)

        # 注意：eGFR 是自反馈积分状态，提交保留 2 位精度（1 位会造成量化不动点，
        # 无法继续衰减到目标值，导致阈值警报不触发）。展示精度由调度器轨迹统一处理。
        return [
            StateProposal(
                self.agent_id, "organs.kidney.egfr", round(new_egfr, 2),
                f"肾损伤扰动：eGFR 向目标 {target} 衰减（{egfr:.1f}→{new_egfr:.1f}）",
            ),
            StateProposal(
                self.agent_id, "organs.kidney.urine_output", round(urine, 1),
                "滤过率下降导致尿量减少",
            ),
            StateProposal(
                self.agent_id, "organs.kidney.perfusion", round(perfusion, 1),
                "肾灌注随滤过率下降",
            ),
        ]


# ==================== 血液 Agent ====================

class BloodPhysiologyAgent:
    """血液 Agent — 状态所有权：肌酐、尿素氮、血钾、HCO₃⁻、pH、阴离子间隙、渗透压。

    读取：肾脏清除能力（eGFR）、当前血液成分
    写入：blood.systemic.{creatinine, bun, potassium, hco3, ph, anion_gap, osmolality}
    """

    agent_id = "blood"
    label = "血液 Agent"
    owned_paths = [
        "blood.systemic.creatinine",
        "blood.systemic.bun",
        "blood.systemic.potassium",
        "blood.systemic.hco3",
        "blood.systemic.ph",
        "blood.systemic.anion_gap",
        "blood.systemic.osmolality",
    ]

    def propose(self, snapshot: Dict[str, Any], disease_event: Dict[str, Any], dt: float) -> List[StateProposal]:
        s = snapshot.get("blood", {}).get("systemic", {})
        egfr = get_path(snapshot, "organs.kidney.egfr") or 100.0
        egfr0 = 100.0

        ratio = egfr0 / max(egfr, 5)
        drop = (egfr0 - egfr) / egfr0

        creatinine = 1.0 * min(ratio, 5.0)
        bun = 14 * min(ratio, 4.0)
        potassium = clamp(4.0 + drop * 3.0, 3.5, 6.5)
        hco3 = clamp(24 - drop * 14, 10, 24)
        # pH 由碳酸氢根推演（每降 1 → pH 降 0.01）
        ph = clamp(7.40 - (24 - hco3) * 0.01, 7.10, 7.40)
        anion_gap = calculate_anion_gap(s.get("sodium", 140), s.get("chloride", 104), hco3)
        osmolality = calculate_osmolality(s.get("sodium", 140), s.get("glucose", 90), bun)

        return [
            StateProposal(self.agent_id, "blood.systemic.creatinine", round(creatinine, 2),
                          "肾清除能力下降导致肌酐潴留"),
            StateProposal(self.agent_id, "blood.systemic.bun", round(bun, 1),
                          "尿素氮清除减少"),
            StateProposal(self.agent_id, "blood.systemic.potassium", round(potassium, 2),
                          "钾排出受阻导致高钾血症风险"),
            StateProposal(self.agent_id, "blood.systemic.hco3", round(hco3, 1),
                          "肾脏泌酸保碱能力下降 → 碳酸氢根减少"),
            StateProposal(self.agent_id, "blood.systemic.ph", round(ph, 3),
                          "代谢性酸中毒：pH 随 HCO₃⁻ 下降"),
            StateProposal(self.agent_id, "blood.systemic.anion_gap", round(anion_gap, 1),
                          "阴离子间隙随酸中毒升高"),
            StateProposal(self.agent_id, "blood.systemic.osmolality", round(osmolality, 1),
                          "溶质潴留导致渗透压升高"),
        ]


# ==================== 心血管 Agent ====================

class CardiovascularPhysiologyAgent:
    """心血管 Agent — 状态所有权：心输出量、心率、心律失常风险、MAP、交感信号。

    读取：血钾、MAP、交感信号、肾功能（代偿程度）
    写入：organs.heart.{cardiac_output, heart_rate, arrhythmia_risk},
          blood.systemic.map, signals.autonomic.sympathetic
    """

    agent_id = "cardiovascular"
    label = "心血管 Agent"
    owned_paths = [
        "organs.heart.cardiac_output",
        "organs.heart.heart_rate",
        "organs.heart.arrhythmia_risk",
        "blood.systemic.map",
        "signals.autonomic.sympathetic",
    ]

    def propose(self, snapshot: Dict[str, Any], disease_event: Dict[str, Any], dt: float) -> List[StateProposal]:
        s = snapshot.get("blood", {}).get("systemic", {})
        sym0 = get_path(snapshot, "signals.autonomic.sympathetic") or 0.3
        egfr = get_path(snapshot, "organs.kidney.egfr") or 100.0
        egfr0 = 100.0
        drop = (egfr0 - egfr) / egfr0
        potassium = s.get("potassium", 4.0)
        map_ = s.get("map", 85)

        # 1. 交感代偿激活（肾损伤 → 应激）→ MAP 上升
        sympathetic = clamp(0.3 + drop * 0.6, 0.3, 0.9)
        map_new = clamp(85 + (sympathetic - 0.3) * 40, 70, 130)

        # 2. 后负荷增加 → 心输出量略降
        cardiac_output = clamp(5.0 - (map_new - 85) * 0.01, 3.5, 6.5)

        # 3. 心率：高钾/应激 → 心率加快（教学型简化）
        heart_rate = clamp(72 + (potassium - 4.0) * 6 + (sympathetic - 0.3) * 20, 55, 120)

        # 4. 心律失常风险：由血钾驱动（0=低，1=高）
        if potassium >= 6.0:
            arrhythmia = 0.85
        elif potassium >= 5.5:
            arrhythmia = 0.55
        elif potassium >= 5.0:
            arrhythmia = 0.25
        else:
            arrhythmia = 0.05

        return [
            StateProposal(self.agent_id, "signals.autonomic.sympathetic", round(sympathetic, 2),
                          "肾损伤触发交感代偿"),
            StateProposal(self.agent_id, "blood.systemic.map", round(map_new, 1),
                          "交感激活 → 平均动脉压升高"),
            StateProposal(self.agent_id, "organs.heart.cardiac_output", round(cardiac_output, 2),
                          "后负荷增加 → 心输出量下降"),
            StateProposal(self.agent_id, "organs.heart.heart_rate", round(heart_rate, 1),
                          f"高钾与应激 → 心率变化（K⁺ {potassium:.1f}）"),
            StateProposal(self.agent_id, "organs.heart.arrhythmia_risk", round(arrhythmia, 2),
                          f"高钾血症 → 心律失常风险{'升高' if potassium >= 5.5 else '正常'}"),
        ]


# ==================== 调度器使用的顺序与标签 ====================

# Agent 传播顺序（肾脏 → 血液 → 心血管，体现器官间依赖链）
AGENT_ORDER = ["renal", "blood", "cardiovascular"]

AGENT_LABELS = {
    "renal": "肾脏 Agent",
    "blood": "血液 Agent",
    "cardiovascular": "心血管 Agent",
}


def create_physio_agents() -> Dict[str, Any]:
    """构建确定性生理 Agent 实例字典（按传播顺序）。"""
    return {
        "renal": RenalPhysiologyAgent(),
        "blood": BloodPhysiologyAgent(),
        "cardiovascular": CardiovascularPhysiologyAgent(),
    }
