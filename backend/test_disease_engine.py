"""疾病引擎单元测试（无 LLM 依赖，纯确定性机制）。

覆盖优化意见书 P0 验收标准：
  推进时间步后：
    - eGFR 下降
    - 肌酐升高
    - 血钾升高
    - 尿量下降
    - 重度严重程度触发风险警报

运行方式（项目根目录下）：
    cd backend && python -m pytest test_disease_engine.py -v
或直接：
    cd backend && python test_disease_engine.py
"""

import os
import sys

# 确保可导入 backend 包（兼容直接运行与 pytest 两种方式）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from simulation.engine import create_simulation, PhysiologyEngine, DISEASE_TEMPLATES


def run_sim(severity: str, steps: int = 40, dt: float = 2.0) -> PhysiologyEngine:
    engine = create_simulation("acute_kidney_injury", severity=severity, time_step_sec=dt)
    engine.run_to_step(steps)
    return engine


def get(engine: PhysiologyEngine, path: str):
    node = engine.store.state
    for k in path.split("."):
        node = node.get(k)
        if node is None:
            return None
    return node


def test_severe_aki_baseline_assertions():
    """重度 AKI：推进 100 步后关键指标按生理预期方向变化，且触发肾衰竭警报。"""
    engine = run_sim("severe", steps=100)

    egfr0, egfr = 100.0, get(engine, "organs.kidney.egfr")
    cr0, cr = 1.0, get(engine, "blood.systemic.creatinine")
    k0, k = 4.0, get(engine, "blood.systemic.potassium")
    uo0, uo = 100.0, get(engine, "organs.kidney.urine_output")

    assert egfr < egfr0, f"eGFR 应下降：{egfr0} -> {egfr}"
    assert cr > cr0, f"肌酐应升高：{cr0} -> {cr}"
    assert k > k0, f"血钾应升高：{k0} -> {k}"
    assert uo < uo0, f"尿量应下降：{uo0} -> {uo}"

    # 重度目标 eGFR=15，40 步后应接近目标且已触发肾衰竭警报
    assert egfr <= 20, f"重度 eGFR 应接近目标 15（当前 {egfr:.1f}）"
    assert any(a["key"] == "renal_failure" for a in engine.alerts), "应触发肾衰竭警报"


def test_alerts_fired_on_severe():
    """重度 AKI 应触发至少一个风险警报（高钾血症 + 代谢性酸中毒）。"""
    engine = run_sim("severe", steps=60)
    assert len(engine.alerts) >= 1, "重度 AKI 应触发风险警报"
    keys = {a["key"] for a in engine.alerts}
    print(f"[alerts] {sorted(keys)}")
    # 高钾（K≥6.0）与酸中毒（pH≤7.30）在重度下均应触发
    assert "hyperkalemia" in keys, "重度应触发高钾血症警报"
    assert "acidosis" in keys, "重度应触发代谢性酸中毒警报"


def test_mild_does_not_trigger_critical_alerts():
    """轻度 AKI 不应触发重度警报（高钾/酸中毒/肾衰竭）。"""
    engine = run_sim("mild", steps=60)
    keys = {a["key"] for a in engine.alerts}
    # 轻度 eGFR 目标 60，不应出现 renal_failure
    assert "renal_failure" not in keys, f"轻度不应触发肾衰竭：{keys}"
    egfr = get(engine, "organs.kidney.egfr")
    assert 50 <= egfr <= 70, f"轻度 eGFR 应稳定在目标 60 附近（当前 {egfr:.1f}）"


def test_monotonic_progression():
    """eGFR 应单调下降（机制确定性验证）。"""
    engine = create_simulation("acute_kidney_injury", severity="severe", time_step_sec=2.0)
    egfrs = [100.0]
    for _ in range(20):
        engine.tick()
        egfrs.append(get(engine, "organs.kidney.egfr"))
    # 前 5 步内至少应严格下降
    assert all(egfrs[i + 1] < egfrs[i] for i in range(5)), f"eGFR 应单调下降：{egfrs[:6]}"


def test_intervention_hemodialysis():
    """紧急透析干预：血钾/肌酐/尿素氮下降，HCO3/pH 改善，保护期后疾病反弹。"""
    engine = run_sim("severe", steps=40)
    k_before = get(engine, "blood.systemic.potassium")
    cr_before = get(engine, "blood.systemic.creatinine")
    hco3_before = get(engine, "blood.systemic.hco3")

    applied = engine.apply_intervention("hemodialysis")
    assert applied is True, "紧急透析干预应被接受"

    k_after = get(engine, "blood.systemic.potassium")
    cr_after = get(engine, "blood.systemic.creatinine")
    hco3_after = get(engine, "blood.systemic.hco3")

    assert k_after < k_before, f"透析后血钾应下降：{k_before} -> {k_after}"
    assert cr_after < cr_before, f"透析后肌酐应下降：{cr_before} -> {cr_after}"
    assert hco3_after > hco3_before, f"透析后 HCO3 应上升：{hco3_before} -> {hco3_after}"

    # 治疗事件应被记录
    events = engine.intervention_log
    assert any(e["type"] == "hemodialysis" for e in events), "透析事件应记录到干预日志"

    # 保护期（12 步）：指标维持改善（K 继续下降或保持低位）
    engine.run_to_step(engine.step + 6)
    k_mid = get(engine, "blood.systemic.potassium")
    assert k_mid <= k_after + 0.5, f"保护期内血钾应维持低位：{k_after} -> {k_mid}"

    # 保护期结束后：疾病机制恢复 → 指标反弹
    engine.run_to_step(engine.step + 14)
    k_rebound = get(engine, "blood.systemic.potassium")
    assert k_rebound > k_mid, f"保护期后血钾应反弹：{k_mid} -> {k_rebound}"

    print(f"[intervention] K {k_before:.1f}->{k_after:.1f}->维持{k_mid:.1f}->反弹{k_rebound:.1f}, "
          f"Cr {cr_before:.1f}->{cr_after:.1f}, HCO3 {hco3_before:.1f}->{hco3_after:.1f}")


def test_acidosis_alert_triggerable():
    """代谢性酸中毒警报应可在重度 AKI 下触发（pH≤7.30）。"""
    engine = run_sim("severe", steps=60)
    ph = get(engine, "blood.systemic.ph")
    assert ph <= 7.30, f"重度 60 步后 pH 应低于 7.30（当前 {ph:.3f}）"
    assert any(a["key"] == "acidosis" for a in engine.alerts), "应触发酸中毒警报"
    print(f"[acidosis] pH {ph:.3f}")


def test_physiology_values_within_sane_bounds():
    """生理值应始终在合理范围内（引擎边界校验）。"""
    engine = run_sim("severe", steps=80)
    ph = get(engine, "blood.systemic.ph")
    k = get(engine, "blood.systemic.potassium")
    assert 7.0 <= ph <= 7.5, f"pH 应在生理范围（当前 {ph:.2f}）"
    assert 3.0 <= k <= 7.0, f"血钾应在生理范围（当前 {k:.2f}）"
    assert get(engine, "blood.systemic.creatinine") >= 0
    assert get(engine, "blood.systemic.bun") >= 0


def test_multi_agent_chain_and_traces():
    """混合多 Agent：肾脏 → 血液 → 心血管传播链 + 每步执行轨迹。"""
    engine = run_sim("severe", steps=10)
    # 1. 每个 tick 都应产生跨 Agent 的轨迹（肾/血/心血管）
    trace_steps = engine.recent_traces(3)
    assert len(trace_steps) >= 1, "应有 Agent 执行轨迹"
    agents_seen = {t["agent"] for t in trace_steps[-1]["entries"]}
    assert {"renal", "blood", "cardiovascular"} <= agents_seen, \
        f"单步轨迹应覆盖三 Agent（实际 {agents_seen}）"

    # 2. 传播链语义：肾脏先动，血液依赖肾脏新 eGFR，心血管依赖血液新钾
    #    用 step 1 的轨迹验证：肾提出 eGFR 下降，血液随后基于新 eGFR 提案
    first = engine.trace_log[0]
    renal_entries = [t for t in first["entries"] if t["agent"] == "renal"]
    blood_entries = [t for t in first["entries"] if t["agent"] == "blood"]
    cardio_entries = [t for t in first["entries"] if t["agent"] == "cardiovascular"]
    assert renal_entries and blood_entries and cardio_entries, "第一步应三个 Agent 均有提案"
    # 血液的肌酐提案 reason 应指向肾脏清除能力
    cr_entry = next(t for t in blood_entries if t["path"] == "blood.systemic.creatinine")
    assert "清除" in cr_entry["reason"] or "潴留" in cr_entry["reason"], "血液 Agent 理由应体现对肾功能的依赖"

    # 3. 心血管提案应包含心律失常风险（新指标）
    cardio_paths = {t["path"] for t in cardio_entries}
    assert "organs.heart.arrhythmia_risk" in cardio_paths, "心血管 Agent 应提出心律失常风险"

    # 4. 轨迹中 eGFR 变化方向正确（old > new）
    egfr_entry = next(t for t in renal_entries if t["path"] == "organs.kidney.egfr")
    assert egfr_entry["old"] > egfr_entry["new"], "eGFR 应下降"

    print(f"[agents] step10 轨迹 Agents={sorted(agents_seen)} | 肾{len(renal_entries)}条 血{len(blood_entries)}条 心{len(cardio_entries)}条")


if __name__ == "__main__":
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {t.__name__}: {e}")
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} tests passed")
    sys.exit(0 if passed == len(tests) else 1)
