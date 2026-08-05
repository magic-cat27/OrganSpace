"""Blood System Agent."""
from agents.base import OrganAgent


class BloodAgent(OrganAgent):
    organ_id = "blood"
    organ_name = "血液系统"
    organ_name_en = "Blood System"

    indicators_def = {
        "hemoglobin": {
            "name": "血红蛋白", "normal_value": 14.0, "unit": "g/dL",
            "normal_min": 12.0, "normal_max": 16.0,
            "description": "红细胞中携氧蛋白",
        },
        "hematocrit": {
            "name": "红细胞比容", "normal_value": 42, "unit": "%",
            "normal_min": 36, "normal_max": 48,
            "description": "血液中红细胞体积占比",
        },
        "rbc": {
            "name": "红细胞计数", "normal_value": 5.0, "unit": "×10¹²/L",
            "normal_min": 4.2, "normal_max": 5.8,
            "description": "单位体积血液中红细胞数量",
        },
        "platelet_count": {
            "name": "血小板计数", "normal_value": 250, "unit": "×10⁹/L",
            "normal_min": 150, "normal_max": 400,
            "description": "参与止血和凝血",
        },
        "mcv": {
            "name": "平均红细胞体积", "normal_value": 90, "unit": "fL",
            "normal_min": 80, "normal_max": 100,
            "description": "反映红细胞大小，用于贫血分类",
        },
    }

    system_prompt = """你是一个血液系统生理模拟器。你模拟血液的组成、携氧功能和造血过程。

血液由血浆和血细胞（红细胞、白细胞、血小板）组成，是连接各器官系统的运输媒介。

关键生理知识：
- 血红蛋白(Hb)是红细胞中的携氧蛋白，Hb降低导致贫血和组织缺氧
- 红细胞比容(Hct)反映血液浓缩或稀释程度
- 血小板参与止血，过低有出血风险，过高增加血栓风险
- 红细胞由骨髓产生，受EPO（肾脏分泌）调控
- 铁、维生素B12、叶酸是红细胞生成的必需原料
- 与肾脏系统关联（EPO调节红细胞生成）
- 与免疫系统关联（白细胞是免疫细胞）
- 与呼吸系统关联（血红蛋白携氧）
- 与凝血系统关联（血小板参与止血）
- 与肝脏系统关联（肝脏储存铁和维生素B12）

常见病理影响：
- 急性出血 → Hb和Hct下降、血小板可能升高
- 缺铁性贫血 → Hb降低、MCV降低（小细胞低色素）
- 巨幼细胞性贫血 → Hb降低、MCV升高（大细胞性）
- 慢性肾病 → EPO减少导致肾性贫血
- 脱水 → Hb和Hct假性升高（血液浓缩）
- 脾功能亢进 → 血小板减少
- 骨髓抑制 → 全血细胞减少

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
