"""Medical calculation tools for organ agents.

Each function is a precise, deterministic calculation — no LLM involved.
Agents can call these to get accurate numbers for their indicators.
"""

import math


# ===== Cardiovascular Tools =====

def calculate_map(systolic: float, diastolic: float) -> float:
    """Mean Arterial Pressure (MAP). Normal: 70-100 mmHg."""
    return round((systolic + 2 * diastolic) / 3, 1)


def calculate_cardiac_output(heart_rate: float, stroke_volume: float) -> float:
    """Cardiac Output = HR × SV. Normal: 4-8 L/min."""
    return round(heart_rate * stroke_volume / 1000, 1)


def calculate_pulse_pressure(systolic: float, diastolic: float) -> float:
    """Pulse Pressure = SBP - DBP. Normal: 30-50 mmHg."""
    return round(systolic - diastolic, 1)


def estimate_stroke_volume(map_val: float, cvp: float = 8, svr: float = 1200) -> float:
    """Rough SV estimate from MAP, CVP, SVR."""
    co = (map_val - cvp) / svr * 1000  # L/min → mL/min
    return round(co / 70, 1)  # assume HR ~70


# ===== Renal Tools =====

def calculate_egfr(creatinine: float, age: int, sex: str = "male", race: str = "non-black") -> float:
    """CKD-EPI eGFR (2021, without race). Normal: >=90 mL/min/1.73m².

    Args:
        creatinine: mg/dL
        age: years
        sex: 'male' or 'female'
    """
    if sex == "female":
        k, alpha = 0.7, -0.241
    else:
        k, alpha = 0.9, -0.302

    if sex == "female":
        factor = 1.012
    else:
        factor = 1.0

    cr_k = creatinine / k
    egfr = 142 * (min(cr_k, 1) ** alpha) * (max(cr_k, 1) ** -1.200) * (0.9938 ** age) * factor
    return round(egfr, 1)


def estimate_urine_output(gfr: float, fluid_intake: float = 2500) -> float:
    """Estimate daily urine output from GFR. Normal: 800-2000 mL/day.
    Rough: UO ≈ fluid_intake * (GFR/100) * 0.6
    """
    return round(fluid_intake * (gfr / 100) * 0.6)


def calculate_fe_na(urine_na: float, plasma_na: float, urine_cr: float, plasma_cr: float) -> float:
    """Fractional Excretion of Sodium (FENa). <1% = prerenal; >2% = ATN."""
    if plasma_na == 0 or urine_cr == 0 or plasma_cr == 0:
        return 0
    return round((urine_na / plasma_na) / (urine_cr / plasma_cr) * 100, 1)


# ===== Respiratory Tools =====

def calculate_pf_ratio(pao2: float, fio2: float = 0.21) -> float:
    """P/F Ratio = PaO2 / FiO2. Normal: >400. <300 = ALI; <200 = ARDS."""
    if fio2 == 0:
        return 0
    return round(pao2 / fio2)


def calculate_aado2(pao2: float, paco2: float, fio2: float = 0.21, pb: float = 760) -> float:
    """Alveolar-arterial O2 gradient. Normal: 5-15 mmHg (on room air)."""
    ph2o = 47
    pao2_ideal = fio2 * (pb - ph2o) - paco2 / 0.8
    return round(pao2_ideal - pao2, 1)


def calculate_minute_ventilation(rr: float, tidal_volume: float = 500) -> float:
    """Minute Ventilation = RR × TV. Normal: 5-8 L/min."""
    return round(rr * tidal_volume / 1000, 1)


# ===== Hepatic Tools =====

def calculate_child_pugh(bilirubin: float, albumin: float, inr: float,
                         ascites: int, encephalopathy: int) -> dict:
    """Child-Pugh score for liver cirrhosis severity.

    Args:
        bilirubin: mg/dL
        albumin: g/dL
        inr: INR value
        ascites: 0=none, 1=slight/moderate, 2=severe
        encephalopathy: 0=none, 1=grade I-II, 2=grade III-IV

    Returns: {score, class: 'A'|'B'|'C'}
    """
    score = 0
    # Bilirubin
    if bilirubin < 2: score += 1
    elif bilirubin < 3: score += 2
    else: score += 3
    # Albumin
    if albumin > 3.5: score += 1
    elif albumin > 2.8: score += 2
    else: score += 3
    # INR
    if inr < 1.7: score += 1
    elif inr < 2.3: score += 2
    else: score += 3
    # Ascites
    score += ascites + 1
    # Encephalopathy
    score += encephalopathy + 1

    cp_class = 'A' if score <= 6 else ('B' if score <= 9 else 'C')
    return {"score": score, "class": cp_class}


def calculate_meld(bilirubin: float, creatinine: float, inr: float, dialysis: bool = False) -> float:
    """MELD score for liver transplant priority. Range: 6-40.

    bilirubin: mg/dL, creatinine: mg/dL
    """
    if dialysis:
        creatinine = 4.0  # capped for dialysis patients

    bili = max(bilirubin, 1.0)
    cr = max(creatinine, 1.0)
    inr_val = max(inr, 1.0)

    meld = 3.78 * math.log(bili) + 11.2 * math.log(inr_val) + 9.57 * math.log(cr) + 6.43
    return round(max(6, min(meld, 40)))


# ===== Metabolic Tools =====

def calculate_anion_gap(na: float, cl: float, hco3: float) -> float:
    """Anion Gap = Na - (Cl + HCO3). Normal: 8-12 mmol/L."""
    return round(na - (cl + hco3), 1)


def calculate_osmolality(na: float, glucose: float, bun: float) -> float:
    """Serum Osmolality. Normal: 275-295 mOsm/kg."""
    return round(2 * na + glucose / 18 + bun / 2.8, 1)


def estimate_insulin_resistance(glucose: float, insulin: float = 10) -> float:
    """HOMA-IR = glucose (mg/dL) × insulin (μU/mL) / 405. Normal <2."""
    return round(glucose * insulin / 405, 2)


# ===== Immune Tools =====

def calculate_nlr(neutrophils: float, lymphocytes: float) -> float:
    """Neutrophil-to-Lymphocyte Ratio. Normal: 1-3. >5 suggests severe inflammation."""
    if lymphocytes == 0:
        return float('inf')
    return round(neutrophils / lymphocytes, 1)


# ===== Tool Registry =====
# Maps organ_id → list of (function, name, description)

TOOL_REGISTRY = {
    "cardiovascular": [
        (calculate_map, "calculate_map", "计算平均动脉压 MAP = (SBP + 2×DBP)/3"),
        (calculate_cardiac_output, "calculate_cardiac_output", "计算心输出量 CO = HR × SV"),
        (calculate_pulse_pressure, "calculate_pulse_pressure", "计算脉压差 = SBP - DBP"),
    ],
    "respiratory": [
        (calculate_pf_ratio, "calculate_pf_ratio", "计算P/F比值 = PaO2/FiO2，评估ARDS严重度"),
        (calculate_aado2, "calculate_aado2", "计算肺泡-动脉氧梯度 A-aDO2"),
        (calculate_minute_ventilation, "calculate_minute_ventilation", "计算分钟通气量 = RR × TV"),
    ],
    "renal": [
        (calculate_egfr, "calculate_egfr", "CKD-EPI公式估算肾小球滤过率 eGFR"),
        (estimate_urine_output, "estimate_urine_output", "根据GFR估算24小时尿量"),
        (calculate_fe_na, "calculate_fe_na", "计算钠排泄分数FENa，鉴别肾前性vs肾性损伤"),
    ],
    "hepatic": [
        (calculate_child_pugh, "calculate_child_pugh", "计算Child-Pugh评分评估肝硬化严重度"),
        (calculate_meld, "calculate_meld", "计算MELD评分评估肝移植优先级"),
    ],
    "metabolic": [
        (calculate_anion_gap, "calculate_anion_gap", "计算阴离子间隙AG = Na - (Cl + HCO3)"),
        (calculate_osmolality, "calculate_osmolality", "计算血浆渗透压"),
        (estimate_insulin_resistance, "estimate_insulin_resistance", "HOMA-IR评估胰岛素抵抗"),
    ],
    "immune": [
        (calculate_nlr, "calculate_nlr", "计算中性粒/淋巴细胞比值NLR"),
    ],
    "blood": [],
    "coagulation": [],
    "nervous": [],
}
