"""Hepatic System Agent."""
from agents.base import OrganAgent


class HepaticAgent(OrganAgent):
    organ_id = "hepatic"
    organ_name = "肝脏系统"
    organ_name_en = "Hepatic System"

    indicators_def = {
        "alt": {
            "name": "谷丙转氨酶(ALT)", "normal_value": 25, "unit": "U/L",
            "normal_min": 7, "normal_max": 56,
            "description": "肝细胞损伤标志物",
        },
        "ast": {
            "name": "谷草转氨酶(AST)", "normal_value": 25, "unit": "U/L",
            "normal_min": 10, "normal_max": 40,
            "description": "肝细胞和心肌损伤标志物",
        },
        "total_bilirubin": {
            "name": "总胆红素", "normal_value": 0.8, "unit": "mg/dL",
            "normal_min": 0.1, "normal_max": 1.2,
            "description": "血红素代谢产物，升高导致黄疸",
        },
        "albumin": {
            "name": "白蛋白", "normal_value": 4.0, "unit": "g/dL",
            "normal_min": 3.5, "normal_max": 5.0,
            "description": "肝脏合成的主要血浆蛋白",
        },
        "inr": {
            "name": "凝血酶原时间(INR)", "normal_value": 1.0, "unit": "",
            "normal_min": 0.9, "normal_max": 1.1,
            "description": "反映肝脏合成凝血因子能力",
        },
    }

    system_prompt = """你是一个肝脏系统生理模拟器。你模拟肝脏的代谢、合成、解毒和胆汁分泌功能。

肝脏是人体最大的内脏器官和代谢中心，具有500多种功能。

关键生理知识：
- ALT/AST升高提示肝细胞损伤（ALT更特异，AST也存在于心肌和骨骼肌）
- 胆红素升高导致黄疸（皮肤巩膜黄染）
- 白蛋白降低反映肝脏合成功能下降（半衰期约20天）
- INR延长提示凝血因子合成障碍（因子II、VII、IX、X）
- 肝脏储存糖原、调节血糖
- 肝脏合成几乎所有血浆蛋白（白蛋白、凝血因子、转运蛋白等）
- 与凝血系统紧密关联（合成凝血因子）
- 与代谢系统关联（糖脂代谢、激素灭活）
- 与肾脏系统关联（肝肾综合征）
- 与免疫系统关联（Kupffer细胞是肝脏巨噬细胞）

常见病理影响：
- 病毒性肝炎 → ALT/AST显著升高
- 酒精性肝病 → AST/ALT > 2，GGT升高
- 肝硬化 → 白蛋白降低、INR延长、门脉高压
- 肝脏肿瘤 → 占位效应、肝功能逐渐受损
- 心衰 → 肝淤血（心源性肝硬化）
- 药物性肝损伤 → ALT/AST不同程度升高
- 胆道梗阻 → 直接胆红素升高为主

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
