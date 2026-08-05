"""Immune System Agent."""
from agents.base import OrganAgent


class ImmuneAgent(OrganAgent):
    organ_id = "immune"
    organ_name = "免疫系统"
    organ_name_en = "Immune System"

    indicators_def = {
        "wbc": {
            "name": "白细胞计数", "normal_value": 7.0, "unit": "×10⁹/L",
            "normal_min": 4.0, "normal_max": 10.0,
            "description": "炎症和感染的主要指标",
        },
        "neutrophils": {
            "name": "中性粒细胞", "normal_value": 4.0, "unit": "×10⁹/L",
            "normal_min": 2.0, "normal_max": 7.0,
            "description": "急性炎症和细菌感染时升高",
        },
        "lymphocytes": {
            "name": "淋巴细胞", "normal_value": 2.0, "unit": "×10⁹/L",
            "normal_min": 1.0, "normal_max": 3.5,
            "description": "病毒感染时可能降低",
        },
        "crp": {
            "name": "C反应蛋白", "normal_value": 2, "unit": "mg/L",
            "normal_min": 0, "normal_max": 8,
            "description": "急性时相反应蛋白，炎症标志物",
        },
    }

    system_prompt = """你是一个免疫系统生理模拟器。你模拟先天免疫、适应性免疫和炎症反应。

免疫系统保护机体免受病原体、肿瘤细胞和其他有害物质的侵害。

关键生理知识：
- 白细胞(WBC)升高提示感染或炎症（特别是细菌感染）
- 中性粒细胞升高 → 急性细菌感染
- 淋巴细胞升高 → 病毒感染；淋巴细胞降低 → 免疫抑制
- CRP是敏感的炎症标志物，感染或组织损伤时急剧升高
- 与凝血系统紧密关联（炎症激活凝血级联→DIC风险）
- 与血液系统关联（骨髓产生血细胞）
- 与神经系统关联（神经-免疫轴、应激抑制免疫）
- 免疫系统遍布全身，通过淋巴循环和血液循环联系各器官

常见病理影响：
- 细菌感染 → WBC和中性粒细胞显著升高、CRP升高
- 病毒感染 → 淋巴细胞可能降低、WBC正常或轻度升高
- 脓毒症 → WBC极度升高或降低（免疫麻痹）、CRP极高
- 自身免疫病 → 免疫系统攻击自身组织
- 肿瘤 → 可能引起副肿瘤性免疫反应
- 化疗/放疗 → 骨髓抑制、WBC降低（特别是中性粒细胞）
- 应激 → 皮质醇升高抑制免疫

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
