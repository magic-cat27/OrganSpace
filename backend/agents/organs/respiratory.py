"""Respiratory System Agent."""
from agents.base import OrganAgent


class RespiratoryAgent(OrganAgent):
    organ_id = "respiratory"
    organ_name = "呼吸系统"
    organ_name_en = "Respiratory System"

    indicators_def = {
        "respiratory_rate": {
            "name": "呼吸频率", "normal_value": 16, "unit": "次/分",
            "normal_min": 12, "normal_max": 20,
            "description": "每分钟呼吸次数",
        },
        "o2_saturation": {
            "name": "血氧饱和度", "normal_value": 98, "unit": "%",
            "normal_min": 95, "normal_max": 100,
            "description": "动脉血氧饱和度(SpO2)",
        },
        "ph": {
            "name": "动脉血pH", "normal_value": 7.40, "unit": "",
            "normal_min": 7.35, "normal_max": 7.45,
            "description": "血液酸碱度",
        },
        "pco2": {
            "name": "动脉血CO2分压", "normal_value": 40, "unit": "mmHg",
            "normal_min": 35, "normal_max": 45,
            "description": "二氧化碳分压(PaCO2)",
        },
        "po2": {
            "name": "动脉血O2分压", "normal_value": 95, "unit": "mmHg",
            "normal_min": 80, "normal_max": 100,
            "description": "氧分压(PaO2)",
        },
    }

    system_prompt = """你是一个呼吸系统生理模拟器。你模拟肺、气道和气体交换的功能。

呼吸系统负责氧气摄入和二氧化碳排出，是维持细胞代谢的基础。

关键生理知识：
- 呼吸频率受延髓呼吸中枢调控，对CO2水平最敏感
- 血氧饱和度(SpO2) < 90% 为低氧血症
- PaCO2升高 → 呼吸性酸中毒；PaCO2降低 → 呼吸性碱中毒
- 与心血管系统紧密耦合（心肺循环：右心→肺→左心）
- 与血液系统关联（血红蛋白携氧能力）
- 与神经系统关联（呼吸中枢在延髓）
- 与代谢系统关联（代谢性酸中毒时呼吸代偿性增快）

常见病理影响：
- 肺部感染/肺炎 → 氧饱和度下降、呼吸频率升高
- COPD → 长期CO2潴留、氧饱和度降低
- 气胸/胸腔积液 → 肺扩张受限、氧合下降
- 心衰 → 肺水肿、气体交换障碍
- 代谢性酸中毒 → 呼吸深快(Kussmaul呼吸)
- 贫血 → 氧含量降低但SpO2可能正常

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
