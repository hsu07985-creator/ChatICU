"""Curated clinical constants for duplicate-medication detection.

This module holds the hand-maintained clinical knowledge tables (severity
ranks, downgrade reasons/windows, recommendation copy, ATC label maps,
subtype-coverage requirements, CNS sub-class partitioning, serotonergic
critical escalators, salt suffixes). Pure data — no behaviour.
"""
from __future__ import annotations

from typing import Dict, Set, Tuple

_LEVEL_RANK: Dict[str, int] = {
    "critical": 5,
    "high": 4,
    "moderate": 3,
    "low": 2,
    "info": 1,
}

# Auto-downgrade reasons
_REASON_DIFF_ROUTE = "route_switch"
_REASON_DIFF_SALT = "salt_switch"
_REASON_OVERLAP_TRANSITION = "transitional_overlap_le_48h"
_REASON_PRN_SCHEDULED = "prn_plus_scheduled"

# Overlap window (hours) for transitional-bridging downgrade
_OVERLAP_WINDOW_HOURS = 48
# Minimum spread between last_admin_at values for a same-L5/same-route pair to
# be treated as a switching window (vs a concurrent duplicate order error).
# 12h-apart same-L5/same-route admin ⇒ duplicate order; ≥ 24h-apart ⇒ transition.
_TRANSITION_MIN_SPREAD_HOURS = 24
# Any med whose last_admin_at is older than this is treated as inactive
_ACTIVE_WINDOW_HOURS = 48

# Target levels for the PRN+scheduled downgrade (guide §2.3 / §6.3).
# High → Low (two steps) & Critical → Moderate per guide tables.
_PRN_DOWNGRADE_MAP: Dict[str, str] = {
    "critical": "moderate",
    "high": "low",
    "moderate": "low",
}

# Long-acting opioid / BZD L5 codes — exempted from PRN+scheduled downgrade
# (per guide §2.3 footnote: "非長效 BZD／Opioid 才降")
_LONG_ACTING_OPIOID_BZD_ATC = {
    "N02AB03",  # Fentanyl (patch is long-acting; bolus IV may differ but we
                # err on the cautious side — don't auto-downgrade)
    "N02AE01",  # Buprenorphine
    "N07BC02",  # Methadone
    "N05BA01",  # Diazepam (long-acting BZD)
    "N05BA09",  # Clobazam
    "N03AE01",  # Clonazepam
}

# ---------------------------------------------------------------------------
# Recommendation mapping — mechanism / group_key → clinician-facing sentence
# ---------------------------------------------------------------------------
_RECOMMENDATIONS: Dict[str, str] = {
    # §3.1 Critical — absolute duplicates
    "PPI × PPI": (
        "停用其中一 PPI；若為換藥過渡期，overlap ≤ 48h 後應停單方。"
    ),
    "SSRI × SSRI": (
        "血清素症候群風險；換藥需 cross-taper 4–7 天，避免同時併用。"
    ),
    "NSAID × NSAID": (
        "口服 NSAID 併用無加成止痛；GI 出血／AKI／CV 風險倍增，保留一品即可。"
    ),
    "ACEI × ARB": (
        "KDIGO 2024 任何情境皆不建議；高鉀／AKI 風險顯著，停一品。"
    ),
    "Statin × Statin": (
        "HMG-CoA reductase 抑制無加成 LDL 降幅；肌病／橫紋肌溶解風險，停一品。"
    ),
    "Oral anticoagulant × Oral anticoagulant": (
        "致命性出血；橋接換藥需依指引（Warfarin→DOAC 需 INR-gated）。"
    ),
    "Long-acting BZD × Long-acting BZD": (
        "呼吸抑制、跌倒、譫妄；Beers 2023 老人全面避免 BZD，若非短期明確必要應停一。"
    ),
    "Metformin mono + Metformin combo": (
        "開立複方時必須停 Metformin 單方；max 2,000–2,550 mg/d。"
    ),
    "β-blocker × β-blocker": (
        "心搏過緩、AV block、HF 惡化；換藥需 taper 後才停單方。"
    ),
    "α1-blocker × α1-blocker": (
        "直立性低血壓、暈厥（AUA／EAU 不建議併用），停一品。"
    ),
    "DHP CCB × DHP CCB": (
        "反射性心搏過速、水腫；同為 DHP 無加成降壓，停一品。"
    ),
    "5-HT3 × 5-HT3": (
        "QTc 延長疊加且無加成止吐效益，停一品。"
    ),
    "D2 antagonist × D2 antagonist": (
        "EPS／tardive dyskinesia／NMS 與 QTc 疊加，保留單一足夠。"
    ),
    # §3.4 mechanism groups (L3)
    "alpha1_blocker": (
        "同 α1 阻斷疊加（BPH + HTN），直立性低血壓、暈厥與跌倒風險；"
        "評估是否有加成療效，保留單一或改 class。"
    ),
    "serotonergic": (
        "多重促血清素機轉疊加，血清素症候群風險"
        "（高體溫、自主神經異常、肌陣攣、clonus）；立即評估停一藥或 cross-taper。"
    ),
    "qtc_prolonging": (
        "多重 QTc 延長藥疊加、Torsades de Pointes 風險；"
        "查 QTc baseline、校正 K／Mg，減少同時使用品項並 ECG 監測。"
    ),
    "anticholinergic_burden": (
        "抗膽鹼負荷累加（Beers 2023）；譫妄、認知惡化、尿滯留、便秘；"
        "老年族群尤應減量或停用。"
    ),
    "cns_depressant": (
        "BZD + Opioid + Z-drug + Gabapentinoid + 一代抗組織胺 疊加致呼吸抑制、"
        "鎮靜過深、跌倒（FDA Boxed Warning），應減量或停一。"
    ),
    "d2_antagonist_antiemetic": (
        "雙 D2 止吐 EPS／tardive dyskinesia／NMS 與 QTc 延長疊加且無加成，"
        "保留單一 agent。"
    ),
    "promotility": (
        "雙 promotility 疊加（膽鹼／D2／motilin）腹瀉、QTc 延長與心搏過緩，"
        "評估單一保留。"
    ),
    # §3.4 endpoint groups (L4)
    "raas_blockade": (
        "高血鉀、AKI、低血壓疊加（ONTARGET 2008、VA-NEPHRON-D 2013）；"
        "KDIGO 2024 任何組合皆不建議。"
    ),
    "bleeding_risk": (
        "GI 出血風險倍增；評估抗潰瘍保護或減藥。"
    ),
    "hyperkalemia": (
        "監測 K、停一藥或減劑；老年／CKD 尤其注意。"
    ),
    "nephrotoxic_triple_whammy": (
        "急性腎損傷高風險（NSAID + RAAS + 利尿劑）；立即評估停 NSAID 或利尿劑。"
    ),
    "qtc_stacking": (
        "QT 間期疊加；同 qtc_prolonging 建議（ECG 監測、校正 K/Mg）。"
    ),
}

_GENERIC_REC_FALLBACK = (
    "建議審視是否有加成療效與客觀適應症；若無，保留單一藥品並記錄原因。"
)

# ---------------------------------------------------------------------------
# Well-known L4 prefixes → human mechanism label used by L2 detector.
# These align with §3.1 of the guide; unknown prefixes fall through to a
# generic "ATC XYZAB duplication" label so the detector still works on
# previously-unseen drug classes.
# ---------------------------------------------------------------------------
_ATC_L4_LABELS: Dict[str, str] = {
    "A02BC": "PPI × PPI",
    "A04AA": "5-HT3 × 5-HT3",
    "M01AE": "NSAID × NSAID",
    "M01AB": "NSAID × NSAID",
    "M01AC": "NSAID × NSAID",
    "M01AH": "NSAID × NSAID",
    "N06AB": "SSRI × SSRI",
    "C07AB": "β-blocker × β-blocker",
    "C08CA": "DHP CCB × DHP CCB",
    "C10AA": "Statin × Statin",
    "N05BA": "Long-acting BZD × Long-acting BZD",
    "N02AA": "Oral opioid × Oral opioid",
    "N02AB": "Opioid × Opioid",
    "B01AF": "Oral anticoagulant × Oral anticoagulant",
    "B01AA": "Oral anticoagulant × Oral anticoagulant",
    "C09AA": "ACEI × ACEI",
    "C09CA": "ARB × ARB",
    "C03DA": "MRA × MRA",
    "C03CA": "Loop diuretic × Loop diuretic",
    "J01DD": "Cephalosporin × Cephalosporin",
    "J01DB": "Cephalosporin × Cephalosporin",
    "J01FA": "Macrolide × Macrolide",
    "J01MA": "Fluoroquinolone × Fluoroquinolone",
    "A10BA": "Metformin × Metformin",
    "R06AA": "H1 antihistamine × H1 antihistamine",
}


# ---------------------------------------------------------------------------
# L4 subtype-coverage requirements (§3.4 — B 類 groups)
# ---------------------------------------------------------------------------
# Some endpoint groups only trigger when the hit ATC set spans multiple
# clinically distinct subtypes. Keyed by group_key → required subtype set.
# Each member's ``member_subtype`` in drug_endpoint_group_members.csv must
# match one of the required subtypes.
#
# Example: nephrotoxic_triple_whammy fires only when NSAID + RAAS + Diuretic
# coexist — two NSAIDs alone (or NSAID + RAAS without a diuretic) do not
# qualify, because the mechanism requires the synergistic three-hit on renal
# perfusion (afferent + efferent + volume).
_SUBTYPE_COVERAGE_GROUPS: Dict[str, Set[str]] = {
    "nephrotoxic_triple_whammy": {"nsaid", "raas", "diuretic"},
}


# ---------------------------------------------------------------------------
# L3 stacking knowledge (§3.4)
# ---------------------------------------------------------------------------
# Serotonergic "critical escalator" ingredients — if any of these ATC codes are
# present alongside another serotonergic drug, severity jumps to critical
# (MAOI-like activity → serotonin crisis risk).
_SEROTONERGIC_CRITICAL_ATCS: Set[str] = {
    "J01XX08",  # Linezolid
    "V03AB17",  # Methylene blue
    # Classic MAOIs (N06AF / N06AG) — not currently in CSV but listed per §3.4
    "N06AF03",  # Phenelzine
    "N06AF04",  # Tranylcypromine
    "N06AG02",  # Moclobemide
}

# ATC-code helpers used by cns_depressant stacking rule.
_CNS_OPIOID_ATC_PREFIXES: Tuple[str, ...] = ("N02A", "N07BC")
_CNS_BZD_ATC_PREFIXES: Tuple[str, ...] = ("N05BA", "N05CD", "N03AE")

# CNS-depressant sub-class partitioning — used by _detect_l3's guard to
# suppress same-sub-class cns_depressant hits (those are L2 / upgrade-pair
# territory, not cross-mechanism stacking). Buckets follow §3.4 narrative:
#   opioid     — N02A* (analgesic opioids), N07BC* (substitution opioids like Methadone)
#   bzd        — N05BA* (anxiolytic BZDs), N05CD* (hypnotic BZDs), N03AE* (Clonazepam-class AED)
#   zdrug      — N05CF* (Zolpidem / Zopiclone)
#   gabapentinoid — N03AX12 / N03AX16 (Gabapentin / Pregabalin)
#   h1         — R06AA*, R06AB*, R06AX* (first-gen H1 antihistamines)
#   sedating_h1_psy — N05BB* (Hydroxyzine) / N05AA* (sedating phenothiazines like Chlorpromazine)
_CNS_SUBCLASS_RULES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("opioid", ("N02A", "N07BC")),
    ("bzd", ("N05BA", "N05CD", "N03AE")),
    ("zdrug", ("N05CF",)),
    ("gabapentinoid", ("N03AX12", "N03AX16")),
    ("h1", ("R06AA", "R06AB", "R06AX")),
    ("sedating_h1_psy", ("N05BB", "N05AA")),
)


# Known salt suffixes used by _strip_salt_suffix (kept module-level for
# cheap look-ups inside hot loops).
_SALT_SUFFIXES: Tuple[str, ...] = (
    "sodium",
    "potassium",
    "magnesium",
    "calcium",
    "hydrochloride",
    "hcl",
    "sulfate",
    "sulphate",
    "tartrate",
    "maleate",
    "mesylate",
    "besylate",
    "tosylate",
    "phosphate",
    "succinate",
    "fumarate",
    "citrate",
    "acetate",
    "bitartrate",
    "trihydrate",
    "dihydrate",
    "tromethamine",
    "hydrobromide",
)
