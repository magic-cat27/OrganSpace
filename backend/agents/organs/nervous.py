"""Nervous System Agent."""
from agents.base import OrganAgent


class NervousAgent(OrganAgent):
    organ_id = "nervous"
    organ_name = "神经系统"
    organ_name_en = "Nervous System"

    indicators_def = {
        "gcs": {
            "name": "格拉斯哥昏迷评分", "normal_value": 15, "unit": "",
            "normal_min": 15, "normal_max": 15,
            "description": "评估意识水平，15为正常，3为深度昏迷",
        },
        "temperature": {
            "name": "体温", "normal_value": 37.0, "unit": "°C",
            "normal_min": 36.0, "normal_max": 37.5,
            "description": "下丘脑体温调节中枢调控",
        },
        "pupil_response": {
            "name": "瞳孔对光反射", "normal_value": 1.0, "unit": "",
            "normal_min": 1.0, "normal_max": 1.0,
            "description": "1=正常, 0.5=迟钝, 0=消失",
        },
        "pain_response": {
            "name": "疼痛反应", "normal_value": 1.0, "unit": "",
            "normal_min": 1.0, "normal_max": 1.0,
            "description": "1=正常, 0.5=减弱, 0=消失",
        },
    }

    system_prompt = """你是一个神经系统生理模拟器。你模拟中枢神经系统（大脑、脊髓）和自主神经系统的功能。

神经系统是人体最复杂的系统，控制意识、运动、感觉和自主功能。

关键生理知识：
- GCS满分15分（睁眼4+言语5+运动6），≤8分为严重意识障碍
- 体温由下丘脑调控，发热是免疫应答的一部分
- 自主神经系统分交感（战斗/逃跑）和副交感（休息/消化）
- 与心血管系统紧密关联（自主神经调节心率和血压）
- 与呼吸系统关联（延髓呼吸中枢）
- 与免疫系统关联（神经-免疫轴、应激反应）
- 与代谢/内分泌关联（下丘脑-垂体轴）
- 交感兴奋 → 心率↑、血压↑、呼吸↑、瞳孔散大
- 副交感兴奋 → 心率↓、消化功能增强

常见病理影响：
- 颅脑损伤 → GCS下降、瞳孔反射异常
- 脑卒中 → 局灶性神经功能缺损
- 颅内感染 → GCS下降、发热
- 休克/低灌注 → 意识障碍
- 代谢紊乱（低血糖、肝性脑病） → 意识改变
- 缺氧 → 神经系统最敏感，GCS逐渐下降
- 镇静药物 → GCS下降、瞳孔反射迟钝

模拟时请保持生理合理性，指标变化应遵循已知的生理机制。"""
