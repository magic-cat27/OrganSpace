"""Metabolic & Endocrine System Agent."""
from agents.base import OrganAgent


class MetabolicAgent(OrganAgent):
    organ_id = "metabolic"
    organ_name = "代谢与内分泌系统"
    organ_name_en = "Metabolic & Endocrine System"

    indicators_def = {
        "glucose": {
            "name": "血糖", "normal_value": 95, "unit": "mg/dL",
            "normal_min": 70, "normal_max": 110,
            "description": "空腹血糖，反映糖代谢",
        },
        "anion_gap": {
            "name": "阴离子间隙", "normal_value": 10, "unit": "mmol/L",
            "normal_min": 8, "normal_max": 12,
            "description": "代谢性酸中毒指标",
        },
        "total_cholesterol": {
            "name": "总胆固醇", "normal_value": 180, "unit": "mg/dL",
            "normal_min": 125, "normal_max": 200,
            "description": "血脂指标",
        },
        "calcium": {
            "name": "血钙", "normal_value": 9.5, "unit": "mg/dL",
            "normal_min": 8.5, "normal_max": 10.5,
            "description": "受PTH和维生素D调控",
        },
        "lactate": {
            "name": "血乳酸", "normal_value": 1.0, "unit": "mmol/L",
            "normal_min": 0.5, "normal_max": 2.0,
            "description": "组织缺氧和休克的重要标志物",
        },
    }

    system_prompt = """你是一个代谢与内分泌系统生理模拟器。你模拟糖代谢、脂代谢、电解质平衡和激素调控。

代谢和内分泌系统通过激素信号网络协调全身各器官的功能，维持内环境稳定。

关键生理知识：
- 血糖由胰岛素（降糖）和胰高血糖素/肾上腺素/皮质醇（升糖）共同调控
- 阴离子间隙升高提示代谢性酸中毒（乳酸酸中毒、酮症酸中毒、尿毒症等）
- 血乳酸 > 2 mmol/L 提示组织低灌注；> 4 mmol/L 与脓毒症休克相关
- 血钙受PTH（甲状旁腺激素）和活性维生素D调控
- 甲状腺激素调控基础代谢率
- 皮质醇（应激激素）影响糖代谢、免疫和血压
- 与肝脏系统关联（糖异生、糖原分解/合成、脂蛋白合成）
- 与肾脏系统关联（电解质平衡、维生素D活化、酸碱调节）
- 与心血管系统关联（激素输送、血压调控）
- 与神经系统关联（下丘脑-垂体-靶腺轴）

常见病理影响：
- 糖尿病 → 血糖升高、长期导致多器官并发症
- 脓毒症 → 乳酸升高、血糖应激性升高
- 甲亢 → 代谢率升高、心率增快
- 肾上腺功能不全 → 低钠、高钾、低血压
- 甲状旁腺功能亢进 → 高钙血症
- 肝衰竭 → 低血糖（糖异生障碍）、乳酸升高
- 肾衰竭 → 高钾、高磷、低钙、代谢性酸中毒

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
