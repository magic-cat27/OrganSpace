"""Renal System Agent."""
from agents.base import OrganAgent


class RenalAgent(OrganAgent):
    organ_id = "renal"
    organ_name = "肾脏系统"
    organ_name_en = "Renal System"

    indicators_def = {
        "bun": {
            "name": "血尿素氮", "normal_value": 15, "unit": "mg/dL",
            "normal_min": 7, "normal_max": 20,
            "description": "蛋白质代谢废物，反映肾小球滤过功能",
        },
        "creatinine": {
            "name": "血肌酐", "normal_value": 0.9, "unit": "mg/dL",
            "normal_min": 0.6, "normal_max": 1.2,
            "description": "肌肉代谢产物，评估肾功能的金指标",
        },
        "sodium": {
            "name": "血钠", "normal_value": 140, "unit": "mmol/L",
            "normal_min": 135, "normal_max": 145,
            "description": "主要细胞外阳离子",
        },
        "potassium": {
            "name": "血钾", "normal_value": 4.0, "unit": "mmol/L",
            "normal_min": 3.5, "normal_max": 5.0,
            "description": "主要细胞内阳离子，高钾可致心律失常",
        },
        "urine_output": {
            "name": "尿量", "normal_value": 1500, "unit": "mL/day",
            "normal_min": 800, "normal_max": 2000,
            "description": "24小时尿量，<400mL为少尿",
        },
        "gfr": {
            "name": "肾小球滤过率", "normal_value": 100, "unit": "mL/min",
            "normal_min": 90, "normal_max": 120,
            "description": "eGFR，评估肾功能分期",
        },
    }

    system_prompt = """你是一个肾脏系统生理模拟器。你模拟肾脏的滤过、重吸收、分泌和内分泌功能。

肾脏是维持内环境稳定的核心器官，负责清除代谢废物、调节水电解质和酸碱平衡、产生促红细胞生成素(EPO)和活化维生素D。

关键生理知识：
- 肾小球滤过率(GFR)是评估肾功能的核心指标
- 血肌酐和尿素氮(BUN)升高提示肾功能下降
- 肾脏通过RAAS系统(肾素-血管紧张素-醛固酮)调节血压
- 肾脏调节钠、钾、钙、磷等电解质平衡
- 与心血管系统紧密关联（肾灌注压、RAAS）
- 与肝脏系统关联（肝肾综合征）
- 与代谢系统关联（电解质、酸碱平衡）
- 与血液系统关联（EPO调节红细胞生成）
- 与凝血系统间接关联（尿毒症时血小板功能异常）

常见病理影响：
- 脱水/低血容量 → 肾前性肾损伤、BUN/Cr升高、尿量减少
- 高血压/糖尿病 → 慢性肾病、GFR逐渐下降
- 肝衰竭 → 肝肾综合征、肾血管收缩
- 感染/脓毒症 → 急性肾损伤(AKI)
- 心衰 → 肾灌注不足、水钠潴留
- 药物毒性(如NSAIDs, 氨基糖苷类) → 急性肾小管坏死

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
