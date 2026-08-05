"""Coagulation System Agent."""
from agents.base import OrganAgent


class CoagulationAgent(OrganAgent):
    organ_id = "coagulation"
    organ_name = "凝血系统"
    organ_name_en = "Coagulation System"

    indicators_def = {
        "pt": {
            "name": "凝血酶原时间", "normal_value": 13.0, "unit": "秒",
            "normal_min": 11.0, "normal_max": 15.0,
            "description": "外源性凝血通路",
        },
        "ptt": {
            "name": "部分凝血活酶时间", "normal_value": 30, "unit": "秒",
            "normal_min": 25, "normal_max": 35,
            "description": "内源性凝血通路",
        },
        "fibrinogen": {
            "name": "纤维蛋白原", "normal_value": 300, "unit": "mg/dL",
            "normal_min": 200, "normal_max": 400,
            "description": "凝血级联的最终底物",
        },
        "d_dimer": {
            "name": "D-二聚体", "normal_value": 0.3, "unit": "mg/L",
            "normal_min": 0.0, "normal_max": 0.5,
            "description": "纤维蛋白降解产物，血栓形成标志物",
        },
    }

    system_prompt = """你是一个凝血系统生理模拟器。你模拟凝血级联反应和纤溶平衡。

凝血系统维持血液在血管内的流动性，同时在血管损伤时迅速形成血栓防止出血。

关键生理知识：
- PT反映外源性凝血通路（因子VII），受华法林影响
- PTT反映内源性凝血通路（因子VIII, IX, XI, XII），受肝素影响
- 纤维蛋白原是凝血级联的最终底物，肝脏合成
- D-二聚体升高提示血栓形成和继发性纤溶亢进
- 凝血系统与抗凝系统和纤溶系统处于动态平衡
- 与肝脏系统紧密关联（合成大多数凝血因子和抗凝蛋白）
- 与免疫系统关联（炎症激活凝血 → DIC风险）
- 与心血管系统关联（血流动力学影响血栓形成）
- 与血液系统关联（血小板是凝血的重要细胞成分）

常见病理影响：
- 肝病 → PT延长（因子合成减少）、纤维蛋白原降低
- 脓毒症 → DIC（广泛凝血激活 → 凝血因子消耗 → 出血）
- 深静脉血栓 → D-二聚体升高
- 维生素K缺乏 → PT延长（II, VII, IX, X合成障碍）
- 血友病 → PTT延长（VIII或IX缺乏）
- 创伤/手术 → 纤维蛋白原升高（急性时相反应）

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
