"""Rule-based Stage 1 intent classifier for clinical queries.

Classifies user questions into one of 13 intents using keyword patterns
and drug name detection. Designed to run in <5ms with no LLM calls.

Reuses drug name detection logic from DrugGraphBridge for alias expansion.
"""

from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ── 13 Intent Taxonomy ────────────────────────────────────────────────────

VALID_INTENTS = frozenset({
    "dose_calculation",
    "pair_interaction",
    "multi_drug_rx",
    "iv_compatibility",
    "drug_monograph",
    "single_drug_interactions",
    "nhi_reimbursement",
    "clinical_guideline",
    "clinical_decision",
    "patient_education",
    "clinical_summary",
    "drug_comparison",
    "general_pharmacology",
})


class IntentResult(BaseModel):
    """Result of intent classification."""
    intent: str = Field(..., description="Classified intent name")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Classification confidence")
    detected_drugs: List[str] = Field(default_factory=list, description="Drug names detected in query")
    stage: str = Field("rule_based", description="Classification stage used")


# ── Keyword pattern groups (Chinese + English) ───────────────────────────

_DOSE_KEYWORDS = re.compile(
    r"(?:dose|dosage|dosing|劑量|剂量|mg/kg|mg\s*/\s*kg|loading\s*dose|maintenance\s*dose|"
    r"負荷劑量|維持劑量|起始劑量|最大劑量|max\s*dose|renal\s*dos|腎功能調整|"
    r"肝功能調整|adjusted?\s*dose|計算劑量|dose\s*adjust|IBW|AdjBW|體重|"
    r"\d+\s*mg(?:/(?:kg|day|hr))|\d+\s*mcg(?:/(?:kg|min|hr)))",
    re.IGNORECASE,
)

_INTERACTION_KEYWORDS = re.compile(
    r"(?:interaction|交互作用|相互作用|drug.{0,5}interaction|藥物交互|"
    r"合併使用|併用|concomi?tant)",
    re.IGNORECASE,
)

_COMPATIBILITY_KEYWORDS = re.compile(
    r"(?:compatib|相容性|相容|Y[\s\-]*Site|管路|點滴|輸液|混合|incompatib|"
    r"IV\s*compatib|靜脈注射|同管|line\s*compatib)",
    re.IGNORECASE,
)

_NHI_KEYWORDS = re.compile(
    r"(?:健保|給付|reimburs|NHI|全民健康保險|保險給付|自費|核退|"
    r"給付條件|給付規定|藥價基準|適應症範圍)",
    re.IGNORECASE,
)

_GUIDELINE_KEYWORDS = re.compile(
    r"(?:guideline|指引|指南|evidence|實證|protocol|共識|consensus|"
    r"建議等級|recommendation|GRADE|best\s*practice|standard\s*of\s*care|"
    r"PADIS|SCCM|ATS|ESICM)",
    re.IGNORECASE,
)

_EDUCATION_KEYWORDS = re.compile(
    r"(?:衛教|explain|education|說明|patient\s*education|教育|"
    r"what\s*is|是什麼|為什麼|怎麼吃|注意事項|precaution|"
    r"side\s*effect\s*explain|告訴病人|跟病人|跟家屬)",
    re.IGNORECASE,
)

_MONOGRAPH_KEYWORDS = re.compile(
    r"(?:副作用|禁忌|contraindic|用法|用量|適應症|indication|"
    r"仿單|monograph|adverse|side\s*effect|pharmacokinetic|"
    r"半衰期|half[\s\-]*life|代謝|metabolism|排泄|excretion|"
    r"mechanism\s*of\s*action|作用機轉|藥理|pharmacolog)",
    re.IGNORECASE,
)

_COMPARISON_KEYWORDS = re.compile(
    r"(?:比較|compare|comparison|vs\.?|versus|差異|不同|優劣|"
    r"哪一個|哪個好|which\s*is\s*better|差別|switch|替代|alternative)",
    re.IGNORECASE,
)

_SUMMARY_KEYWORDS = re.compile(
    r"(?:summary|摘要|總結|病歷摘要|clinical\s*summary|綜合評估|"
    r"整體狀況|overview|summarize|summarise)",
    re.IGNORECASE,
)

_DECISION_KEYWORDS = re.compile(
    r"(?:decision|決策|該不該|建議|換藥|should\s*(?:I|we)|"
    r"是否需要|要不要|可以停|停藥|加藥|調整|升級|降級|"
    r"escalat|de[\s\-]*escalat|change\s*to|switch\s*to)",
    re.IGNORECASE,
)


# ── Common drug name patterns for basic detection ─────────────────────────

# Well-known ICU + common drug names for quick detection (no graph needed)
_KNOWN_DRUG_NAMES: List[str] = [
    # ICU PAD drugs
    "propofol", "midazolam", "dexmedetomidine", "fentanyl", "morphine",
    "cisatracurium", "rocuronium", "lorazepam", "haloperidol", "ketamine",
    # Common ICU
    "norepinephrine", "vasopressin", "epinephrine", "dopamine", "dobutamine",
    "milrinone", "nitroglycerin", "nicardipine", "labetalol", "amiodarone",
    "lidocaine", "heparin", "enoxaparin", "warfarin", "vancomycin",
    "meropenem", "piperacillin", "ceftriaxone", "cefazolin", "ampicillin",
    "metronidazole", "fluconazole", "acyclovir", "insulin", "furosemide",
    "mannitol", "pantoprazole", "omeprazole", "acetaminophen", "ibuprofen",
    # Aminoglycosides (ICU nephrotoxic antibiotics)
    "amikacin", "gentamicin", "tobramycin",
    # Colistin group
    "colistin", "colistimethate", "polymyxin",
    # Cephalosporins
    "cefepime", "ceftazidime", "cefoperazone", "cefoxitin",
    # Loop diuretics
    "bumetanide", "torsemide",
    # Anticoagulants / antiplatelets
    "tirofiban", "fondaparinux", "argatroban", "bivalirudin",
    # Antifungals
    "voriconazole", "caspofungin", "micafungin", "amphotericin",
    # Antivirals
    "ganciclovir", "valganciclovir", "oseltamivir",
    # Immunosuppressants
    "tacrolimus", "cyclosporine", "mycophenolate",
    # Antiepileptics
    "valproate", "phenytoin", "levetiracetam", "carbamazepine",
    # Other ICU
    "magnesium", "potassium", "albumin", "dexamethasone",
    # Common oral drugs
    "aspirin", "clopidogrel", "ticagrelor", "rivaroxaban", "apixaban",
    "metformin", "glimepiride", "empagliflozin", "dapagliflozin",
    "atorvastatin", "rosuvastatin", "amlodipine", "valsartan", "losartan",
    "lisinopril", "ramipril", "hydrochlorothiazide", "spironolactone",
    "levothyroxine", "prednisolone", "methylprednisolone", "hydrocortisone",
    "pembrolizumab", "nivolumab", "trastuzumab",
    # Taiwan brand names
    "precedex", "fresofol", "dormicum", "nimbex", "anxicam",
    "bokey", "plavix", "xigduo", "galvus", "amaryl",
    "lipitor", "crestor", "norvasc", "diovan", "cozaar",
    "augmentin", "unasyn", "tazocin", "invanz", "zyvox",
]

# Build regex for known drugs (case-insensitive, word boundary)
_KNOWN_DRUG_RE = re.compile(
    r"\b(" + "|".join(re.escape(d) for d in _KNOWN_DRUG_NAMES) + r")\b",
    re.IGNORECASE,
)

# Chinese drug name patterns (common suffixes)
_CHINESE_DRUG_RE = re.compile(
    r"([\u4e00-\u9fff]{2,8}(?:錠|膠囊|注射液|注射劑|口服液|軟膏|乳膏|點滴|針|栓劑))",
    re.IGNORECASE,
)

# Generic drug pattern: capitalized word ending with common drug suffixes
_GENERIC_DRUG_RE = re.compile(
    r"\b([A-Z][a-z]{3,}(?:in|ol|am|ine|ide|one|ate|cin|pin|pam|lam|tan|ban|mab|nib|lib|zol|pril|oxin|phen|mycin|cillin|azole|vudine|navir|afil|tuzumab|zumab))\b"
)


def detect_drugs_from_text(text: str) -> List[str]:
    """Detect drug names from query text using pattern matching.

    Returns a list of unique drug names found in the text.
    This is a lightweight detection without graph access.
    For comprehensive resolution, use DrugGraphBridge.
    """
    if not text or not text.strip():
        return []

    detected: List[str] = []
    seen_lower: set = set()

    # 1) Check known drug names
    for match in _KNOWN_DRUG_RE.finditer(text):
        name = match.group(1)
        key = name.lower()
        if key not in seen_lower:
            seen_lower.add(key)
            detected.append(name)

    # 2) Check generic drug name patterns
    for match in _GENERIC_DRUG_RE.finditer(text):
        name = match.group(1)
        key = name.lower()
        if key not in seen_lower:
            seen_lower.add(key)
            detected.append(name)

    # 3) Check Chinese formulation names
    for match in _CHINESE_DRUG_RE.finditer(text):
        name = match.group(1)
        key = name.lower()
        if key not in seen_lower:
            seen_lower.add(key)
            detected.append(name)

    return detected


def _count_drugs(text: str, provided_drugs: Optional[List[str]] = None) -> Tuple[int, List[str]]:
    """Count detected drugs, combining provided list with text detection."""
    all_drugs: List[str] = []
    seen_lower: set = set()

    # Add provided drugs first
    if provided_drugs:
        for d in provided_drugs:
            key = d.strip().lower()
            if key and key not in seen_lower:
                seen_lower.add(key)
                all_drugs.append(d.strip())

    # Add text-detected drugs
    for d in detect_drugs_from_text(text):
        key = d.lower()
        if key not in seen_lower:
            seen_lower.add(key)
            all_drugs.append(d)

    return len(all_drugs), all_drugs


def classify_intent(
    question: str,
    detected_drugs: Optional[List[str]] = None,
) -> IntentResult:
    """Classify a clinical question into one of 13 intents.

    Stage 1: Rule-based classifier using keyword patterns and drug detection.
    Designed for <5ms latency with no LLM calls.

    Args:
        question: The clinical question text.
        detected_drugs: Pre-detected drug names (e.g., from DrugGraphBridge).
            If None, drugs will be detected from the question text.

    Returns:
        IntentResult with intent name, confidence, detected drugs, and stage.
    """
    if not question or not question.strip():
        return IntentResult(
            intent="general_pharmacology",
            confidence=0.10,
            detected_drugs=[],
            stage="rule_based",
        )

    text = question.strip()
    drug_count, drugs = _count_drugs(text, detected_drugs)

    # ── High-confidence keyword matches (intent-specific patterns) ────────

    # IV Compatibility — very specific keywords, high confidence
    if _COMPATIBILITY_KEYWORDS.search(text):
        return IntentResult(
            intent="iv_compatibility",
            confidence=0.92 if drug_count >= 2 else 0.80,
            detected_drugs=drugs,
            stage="rule_based",
        )

    # NHI Reimbursement — very specific to Taiwan healthcare system
    if _NHI_KEYWORDS.search(text):
        return IntentResult(
            intent="nhi_reimbursement",
            confidence=0.90,
            detected_drugs=drugs,
            stage="rule_based",
        )

    # Drug Comparison — "vs" or comparison keywords
    if _COMPARISON_KEYWORDS.search(text) and drug_count >= 2:
        return IntentResult(
            intent="drug_comparison",
            confidence=0.88,
            detected_drugs=drugs,
            stage="rule_based",
        )

    # Clinical Summary — no drugs needed
    if _SUMMARY_KEYWORDS.search(text):
        return IntentResult(
            intent="clinical_summary",
            confidence=0.85,
            detected_drugs=drugs,
            stage="rule_based",
        )

    # ── Drug-count-dependent classification ───────────────────────────────

    if drug_count >= 3:
        # 3+ drugs → multi-drug prescription check
        return IntentResult(
            intent="multi_drug_rx",
            confidence=0.85,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if drug_count == 2:
        # 2 drugs: check for specific intents first
        if _INTERACTION_KEYWORDS.search(text):
            return IntentResult(
                intent="pair_interaction",
                confidence=0.90,
                detected_drugs=drugs,
                stage="rule_based",
            )
        if _DOSE_KEYWORDS.search(text):
            return IntentResult(
                intent="dose_calculation",
                confidence=0.80,
                detected_drugs=drugs,
                stage="rule_based",
            )
        # Default for 2 drugs = pair interaction
        return IntentResult(
            intent="pair_interaction",
            confidence=0.75,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if drug_count == 1:
        # 1 drug: check for specific keywords
        if _DOSE_KEYWORDS.search(text):
            return IntentResult(
                intent="dose_calculation",
                confidence=0.88,
                detected_drugs=drugs,
                stage="rule_based",
            )
        if _INTERACTION_KEYWORDS.search(text):
            return IntentResult(
                intent="single_drug_interactions",
                confidence=0.85,
                detected_drugs=drugs,
                stage="rule_based",
            )
        if _MONOGRAPH_KEYWORDS.search(text):
            return IntentResult(
                intent="drug_monograph",
                confidence=0.82,
                detected_drugs=drugs,
                stage="rule_based",
            )
        if _EDUCATION_KEYWORDS.search(text):
            return IntentResult(
                intent="patient_education",
                confidence=0.80,
                detected_drugs=drugs,
                stage="rule_based",
            )
        if _COMPARISON_KEYWORDS.search(text):
            return IntentResult(
                intent="drug_comparison",
                confidence=0.75,
                detected_drugs=drugs,
                stage="rule_based",
            )
        # Single drug with no specific keyword → drug monograph
        return IntentResult(
            intent="drug_monograph",
            confidence=0.55,
            detected_drugs=drugs,
            stage="rule_based",
        )

    # ── No drugs detected — keyword-only classification ───────────────────

    if _GUIDELINE_KEYWORDS.search(text):
        return IntentResult(
            intent="clinical_guideline",
            confidence=0.82,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if _DECISION_KEYWORDS.search(text):
        return IntentResult(
            intent="clinical_decision",
            confidence=0.75,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if _EDUCATION_KEYWORDS.search(text):
        return IntentResult(
            intent="patient_education",
            confidence=0.70,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if _INTERACTION_KEYWORDS.search(text):
        return IntentResult(
            intent="general_pharmacology",
            confidence=0.50,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if _DOSE_KEYWORDS.search(text):
        return IntentResult(
            intent="dose_calculation",
            confidence=0.50,
            detected_drugs=drugs,
            stage="rule_based",
        )

    if _MONOGRAPH_KEYWORDS.search(text):
        return IntentResult(
            intent="drug_monograph",
            confidence=0.50,
            detected_drugs=drugs,
            stage="rule_based",
        )

    # ── Fallback: ambiguous → general_pharmacology ────────────────────────

    return IntentResult(
        intent="general_pharmacology",
        confidence=0.30,
        detected_drugs=drugs,
        stage="rule_based",
    )
