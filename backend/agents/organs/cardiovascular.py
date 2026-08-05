"""Cardiovascular System Agent."""
from agents.base import OrganAgent


class CardiovascularAgent(OrganAgent):
    organ_id = "cardiovascular"
    organ_name = "心血管系统"
    organ_name_en = "Cardiovascular System"

    indicators_def = {
        "heart_rate": {
            "name": "心率", "normal_value": 75, "unit": "bpm",
            "normal_min": 60, "normal_max": 100,
            "description": "每分钟心跳次数",
        },
        "nibp_systolic": {
            "name": "无创收缩压", "normal_value": 120, "unit": "mmHg",
            "normal_min": 90, "normal_max": 140,
            "description": "心脏收缩时动脉血压",
        },
        "nibp_diastolic": {
            "name": "无创舒张压", "normal_value": 80, "unit": "mmHg",
            "normal_min": 60, "normal_max": 90,
            "description": "心脏舒张时动脉血压",
        },
        "cardiac_output": {
            "name": "心输出量", "normal_value": 5.0, "unit": "L/min",
            "normal_min": 4.0, "normal_max": 8.0,
            "description": "每分钟心脏泵出的血量",
        },
        "troponin_t": {
            "name": "肌钙蛋白T", "normal_value": 0.01, "unit": "ng/mL",
            "normal_min": 0.0, "normal_max": 0.04,
            "description": "心肌损伤标志物",
        },
        "nt_probnp": {
            "name": "NT-proBNP", "normal_value": 125, "unit": "pg/mL",
            "normal_min": 0, "normal_max": 300,
            "description": "心衰标志物",
        },
    }

    system_prompt = """你是一个心血管系统生理模拟器。你模拟心脏、血管和循环系统的功能。

心血管系统是人体循环系统的核心，负责将氧气和营养物质输送到全身组织，同时带走代谢废物。

关键生理知识：
- 心率受自主神经系统（交感/副交感）调节
- 血压 = 心输出量 × 外周血管阻力
- 心脏通过冠状动脉供血，缺血会导致心肌损伤（肌钙蛋白升高）
- 心衰时 NT-proBNP 升高，反映心室壁张力增加
- 与呼吸系统紧密耦合（心肺循环）
- 与肾脏系统关联（肾素-血管紧张素-醛固酮系统调节血压和体液平衡）
- 与神经系统关联（压力感受器反射、自主神经调控）

常见病理影响：
- 出血/脱水 → 血压下降、心率代偿性升高
- 心肌梗死 → 肌钙蛋白升高、心输出量下降
- 高血压 → 收缩压/舒张压持续升高、长期导致心衰
- 感染/脓毒症 → 血管扩张、血压下降、心率升高
- 肝脏疾病 → 可能影响循环血量和凝血
- 肾脏疾病 → 水钠潴留导致血压升高

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
